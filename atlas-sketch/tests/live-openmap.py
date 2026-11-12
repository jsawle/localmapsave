"""Runs Open map's 2D / 3D choice in Atlas 5.0 (atlas-sketch) in Chromium against the real services.

Run:  python3 atlas-sketch/tests/live-openmap.py [--shots DIR] [--proxy URL] [--axe PATH]
Uses the test content group (config=test), which has web maps and three web scenes; and the live MapMaker group
(config=mapmaker-live), which has no scenes.

Checks: with scenes in the collection a row above the maps offers All, 2D maps and 3D scenes with how many of each;
choosing 3D scenes lists only scenes, each marked 3D on its picture with an "Open 3D scene" button; the counts follow
the category chosen and the search; 2D maps lists no scene; a collection without scenes has no row; an accessibility scan.
"""
import argparse, functools, glob, http.server, json, math, os, pathlib, re, sys, threading
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
APP = HERE.parent
V = "document.querySelector('arcgis-map').view"
GROUP = "c3ac404ac811494ea6fa116abc0cf39b"
DIMS = "[...document.querySelectorAll('#omBrowser .cat-dims button')].map(b => ({ key: b.dataset.dim, label: b.querySelector('span').textContent, n: +b.querySelector('.cat-dim-n').textContent, pressed: b.getAttribute('aria-pressed'), aria: b.textContent.replace(/\\s+/g, ' ').trim() }))"
CARDS = "[...document.querySelectorAll('#omList .cat-card')].map(c => ({ title: c.querySelector('.cat-card-title').textContent.trim(), scene: c.classList.contains('is-scene'), badge: !!c.querySelector('.cat-thumb .cat-3d'), act: c.querySelector('.cat-act').textContent.trim() }))"

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--shots", default=str(HERE / ".shots")); ap.add_argument("--proxy", default=os.environ.get("HTTPS_PROXY", "")); ap.add_argument("--axe", default="")
    a = ap.parse_args()
    shots = pathlib.Path(a.shots); shots.mkdir(parents=True, exist_ok=True)
    srv = http.server.ThreadingHTTPServer(("localhost", 0), functools.partial(Quiet, directory=str(APP)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://localhost:{srv.server_port}"
    found = sorted(glob.glob("/opt/pw-browsers/chromium-*/chrome-linux*/chrome"))
    chrome = os.environ.get("CHROME") or (found[-1] if found else None)
    failures, checks = [], [0]
    def check(cond, msg):
        checks[0] += 1; print(("  ok   " if cond else "  FAIL ") + msg, flush=True)
        if not cond: failures.append(msg)
    with sync_playwright() as p:
        launch = {"args": ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]}
        if chrome: launch["executable_path"] = chrome
        if a.proxy: launch["proxy"] = {"server": a.proxy, "bypass": "localhost,127.0.0.1"}
        browser = p.chromium.launch(**launch)
        page = browser.new_context(viewport={"width": 1366, "height": 900}).new_page(); errors = []
        page.on("pageerror", lambda e: errors.append((getattr(e, "stack", "") or str(e))[:300]))
        def axe(sel, what):
            if not a.axe: return
            page.add_script_tag(path=a.axe)
            res = page.evaluate("async (sel) => { const r = await axe.run(sel, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }); return r.violations.map(v => v.id + ': ' + v.nodes.length + ' ' + (v.nodes[0] && v.nodes[0].target.join(' '))); }", sel)
            check(not res, what + " passes the accessibility scan" + (": " + "; ".join(res) if res else ""))
        def open_browser(cfg):
            page.goto(f"{base}/index.html?config={cfg}"); page.wait_for_function("(() => { const m = document.querySelector('arcgis-map'); return !!(m && m.view && m.view.ready); })()", timeout=120000); page.wait_for_timeout(1500)
            page.click("#tool-open"); page.wait_for_selector("#omList .cat-card", timeout=120000); page.wait_for_timeout(1500)
        def dim(key): page.click(f"#omBrowser .cat-dims button[data-dim='{key}']"); page.wait_for_timeout(700)

        print("== a collection with scenes (the test group)")
        open_browser("test")
        d = page.evaluate(DIMS)
        check([x["label"] for x in d] == ["All", "2D maps", "3D scenes"] and d[0]["pressed"] == "true", "a row above the maps: All, 2D maps, 3D scenes: " + json.dumps([(x["label"], x["n"]) for x in d]))
        check(d[2]["n"] == 3 and d[0]["n"] == d[1]["n"] + 3 and d[1]["n"] > 100 and d[2]["aria"] == "3D scenes 3", "with how many of each: %d in all, %d 2D maps, 3 3D scenes" % (d[0]["n"], d[1]["n"]))
        above = page.evaluate("(() => { const r = document.querySelector('#omBrowser .cat-dims').getBoundingClientRect(), l = document.querySelector('#omList').getBoundingClientRect(); return r.bottom <= l.top + 1 && r.height >= 36; })()")
        check(above, "the row is above the list, and its buttons are a good size to press")
        axe("#omBrowser", "Open map with the 2D / 3D row")
        dim("3d"); cards = page.evaluate(CARDS)
        check(len(cards) == 3 and all(c["scene"] and c["badge"] and c["act"] == "Open 3D scene" for c in cards), "3D scenes lists the three scenes, each marked 3D on its picture, with an Open 3D scene button: " + ", ".join(c["title"][:28] for c in cards))
        check(page.inner_text("#omStatus") == "3 3D scenes" and page.evaluate(DIMS)[2]["pressed"] == "true", "and says so: " + page.inner_text("#omStatus"))
        check(all("(3D scene)" in c["title"] for c in cards), "a screen reader is told each is a 3D scene")
        page.screenshot(path=str(shots / "openmap-3d-scenes.png")); axe("#omBrowser", "Open map showing 3D scenes")
        dim("2d"); cards = page.evaluate(CARDS)
        check(len(cards) > 0 and not any(c["scene"] or c["badge"] for c in cards) and all(c["act"] == "Open map" for c in cards) and re.match(r"^\d+ maps$", page.inner_text("#omStatus")), "2D maps lists no scene: " + page.inner_text("#omStatus"))
        dim("all")
        page.fill("#omSearch", "river"); page.wait_for_timeout(1200); d = page.evaluate(DIMS)
        check(d[2]["n"] == 1 and d[0]["n"] == d[1]["n"] + 1, "the counts follow the search (river): " + json.dumps([(x["label"], x["n"]) for x in d]))
        dim("3d"); cards = page.evaluate(CARDS)
        check(len(cards) == 1 and "River Tees" in cards[0]["title"], "searching within the 3D scenes finds the River Tees scene")
        page.fill("#omSearch", ""); page.wait_for_timeout(1000)
        # which categories hold scenes is the group's to say, and it changes as scenes are given categories: asked of the group
        import urllib.request
        gs = json.load(urllib.request.urlopen("https://www.arcgis.com/sharing/rest/content/groups/" + GROUP + "/search?f=json&num=100&q=type:%22Web%20Scene%22", timeout=40))["results"]
        tops = page.evaluate("[...document.querySelectorAll('#omTree > li > .tree-row > .tree-name')].map(b => b.querySelector('span').textContent.trim())")
        per = {}
        for it in gs:
            cats = {c.strip("/").split("/")[1] for c in (it.get("groupCategories") or []) if len(c.strip("/").split("/")) > 1}
            for c in (cats & set(tops)) or {"Other"}: per[c] = per.get(c, 0) + 1
        empty = next(tname for tname in tops if tname not in per and tname != "Other")
        def pick(name): page.evaluate("(n) => [...document.querySelectorAll('#omTree > li > .tree-row > .tree-name')].find(b => b.querySelector('span').textContent.trim() === n).click()", name); page.wait_for_timeout(1000)
        pick(empty); d = page.evaluate(DIMS)
        check(d[2]["n"] == 0 and d[2]["pressed"] == "true" and page.inner_text("#omStatus").startswith("0 3D scenes in " + empty) and len(page.evaluate(CARDS)) == 0, "in a category with no scenes the row says 0 (the choice is kept): " + page.inner_text("#omStatus"))
        full, want = max(per.items(), key=lambda kv: kv[1])
        pick(full)
        check(page.evaluate(DIMS)[2]["n"] == want and len(page.evaluate(CARDS)) == want, "and in a category that has them (%s), %d" % (full, want))
        page.screenshot(path=str(shots / "openmap-3d-row.png"))

        print("== a collection without scenes (the live MapMaker group)")
        open_browser("mapmaker-live")
        check(page.evaluate("!document.querySelector('#omBrowser .cat-dims') || document.querySelector('#omBrowser .cat-dims').hidden"), "no row when the collection has no scenes")
        page.evaluate("document.querySelectorAll('.modal:not([hidden]) [data-close], #openModal [data-close]').forEach(b => b.click())")
        check(not errors, "no script errors" + (": " + " | ".join(errors[:2]) if errors else ""))
        browser.close()
    srv.shutdown()
    print(f"\n{checks[0] - len(failures)} of {checks[0]} checks passed")
    sys.exit(1 if failures else 0)

if __name__ == "__main__":
    main()
