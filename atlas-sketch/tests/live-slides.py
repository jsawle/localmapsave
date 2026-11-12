#!/usr/bin/env python3
"""Live check: a 3D map's slides, as bookmarks, turn layers on and off as the slide says.

Uses two scenes of the test group (public):
  Garden   98dafc87ffe94961a96fea4b0750c930  every layer off to start; slide 4 shows two layers, slide 5 five, slide 1 none
  La Palma 87bf66faa047472bb3bf3d8cfe23ffc2  the last slide shows only the 25 October imagery
What each slide should show is read from the scene's own JSON, not written here.

  python3 live-slides.py [--shots DIR] [--axe path/to/axe.min.js]
"""
import argparse, functools, glob, http.server, json, os, pathlib, sys, threading, urllib.request
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent; APP = HERE.parent
GARDEN = "98dafc87ffe94961a96fea4b0750c930"; PALMA = "87bf66faa047472bb3bf3d8cfe23ffc2"
AXE = "(sel) => axe.run(sel, { runOnly: ['wcag2a','wcag2aa','wcag21a','wcag21aa'] }).then(r => r.violations.map(v => v.id + ': ' + v.nodes.map(n => n.target.join(' ')).slice(0,3).join(', ')))"

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass

def scene_json(item):
    with urllib.request.urlopen(f"https://www.arcgis.com/sharing/rest/content/items/{item}/data?f=json", timeout=60) as r: return json.load(r)

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
        checks[0] += 1; print(("  ok   " if cond else "  FAIL ") + msg)
        if not cond: failures.append(msg)
    with sync_playwright() as p:
        launch = {"args": ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]}
        if chrome: launch["executable_path"] = chrome
        if a.proxy: launch["proxy"] = {"server": a.proxy, "bypass": "localhost,127.0.0.1"}
        browser = p.chromium.launch(**launch)
        ctx = browser.new_context(viewport={"width": 1366, "height": 768})
        ctx.add_init_script("delete window.showSaveFilePicker; delete window.showOpenFilePicker;")
        page = ctx.new_page(); errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("dialog", lambda d: d.accept())
        def axe(sel, what):
            if not a.axe: return
            if not page.evaluate("typeof axe !== 'undefined'"): page.add_script_tag(path=a.axe)
            v = page.evaluate(AXE, sel); check(not v, what + ": no WCAG 2.1 A/AA violations (axe-core): " + "; ".join(v))
        SCENE_READY = "(() => { const s = document.querySelector('arcgis-scene'); return !!(s && s.view && s.view.ready && s.view.map && s.view.map.declaredClass === 'esri.WebScene' && s.view.map.loaded); })()"
        ON = "document.querySelector('arcgis-scene').view.map.layers.toArray().filter(l => l.visible && l.listMode !== 'hide' && l.type !== 'graphics').map(l => l.id).sort()"
        SKETCH = "(() => { const l = document.querySelector('arcgis-scene').view.map.findLayerById('__sketch'); return l ? l.visible : null; })()"
        def open_scene(item):
            page.goto(f"{base}/index.html?config=mapmaker&webscene={item}")
            page.wait_for_function(SCENE_READY, timeout=180000)
            page.wait_for_function("document.querySelector('#toast').textContent.length > 0", timeout=120000); page.wait_for_timeout(1500)
            if not page.is_visible("#bookmarksPanel"): page.evaluate("document.querySelector('#tool-bookmarks').click()")
            page.wait_for_selector("#bookmarksPanel:not([hidden])"); page.wait_for_function("document.querySelectorAll('#bmList .bm-go').length > 0", timeout=60000)
        def go(i):
            page.evaluate("(i) => document.querySelectorAll('#bmList .bm-go')[i].click()", i); page.wait_for_timeout(1500)
            return page.evaluate(ON)
        def expected(data, i):
            ops = {o["id"] for o in data["operationalLayers"]}
            return sorted(v["id"] for v in data["presentation"]["slides"][i]["visibleLayers"] if v["id"] in ops)
        def names(data, ids):
            t = {o["id"]: o["title"] for o in data["operationalLayers"]}; return ", ".join(t[i] for i in ids) or "none"

        for label, item, order in (("Garden", GARDEN, [3, 4, 0, 8]), ("La Palma", PALMA, [0, 10, 9, 1])):
            print(f"== {label}")
            data = scene_json(item); open_scene(item)
            start = sorted(o["id"] for o in data["operationalLayers"] if o.get("visibility", True))
            check(page.evaluate(ON) == start, "opens with the scene's own layers on: " + names(data, start))
            for i in order:
                want = expected(data, i); got = go(i)
                check(got == want, f"slide {i + 1} \"{data['presentation']['slides'][i]['title']['text']}\" shows: {names(data, want)}" + ("" if got == want else f" (got {names(data, got)})"))
            sk = page.evaluate(SKETCH); check(sk is True, "the sketch layer is left on (" + str(sk) + ")")
            page.wait_for_timeout(4000); page.screenshot(path=str(shots / f"slides-{label.lower().replace(' ', '-')}.png"))

        print("== the Map layers panel follows")
        want = expected(data, 9); go(9)
        page.evaluate("document.querySelector('#tool-layers').click()"); page.wait_for_selector("#layersPanel:not([hidden])"); page.wait_for_timeout(800)
        rows = page.evaluate("[...document.querySelectorAll('#layersPanel input[type=checkbox]')].map(c => [c.getAttribute('aria-label') || (c.closest('label') || c.parentElement).textContent.trim(), c.checked])")
        on = sorted(n for n, c in rows if c and "ketch" not in n); titles = {o["id"]: o["title"] for o in data["operationalLayers"]}
        check(len(on) == len(want) and all(any(titles[i] in n for n in on) for i in want), "Map layers has the slide's layers ticked: " + "; ".join(on))
        axe("#layersPanel", "Map layers after a slide")

        print("== saved and reopened")
        if not page.is_visible("#savePanel"): page.evaluate("document.querySelector('#tool-save').click()")
        page.evaluate("document.querySelector('#saveTile').click()"); page.wait_for_selector("#nameModal:not([hidden])"); page.fill("#fileNameInput", "palma")
        with page.expect_download() as dl: page.evaluate("document.querySelector('#nameConfirm').click()")
        saved = json.loads(pathlib.Path(dl.value.path()).read_text())
        data = scene_json(PALMA); ops = {o["id"] for o in data["operationalLayers"]}
        same = all(sorted(v["id"] for v in s["visibleLayers"] if v["id"] in ops) == expected(data, i) for i, s in enumerate(saved["presentation"]["slides"]))
        check(len(saved["presentation"]["slides"]) == len(data["presentation"]["slides"]) and same, "the saved file's slides keep each slide's layers")

        check(not errors, "no script errors: " + "; ".join(errors[:3]))
        browser.close()
    print(f"\n{checks[0] - len(failures)}/{checks[0]} checks passed"); sys.exit(1 if failures else 0)

if __name__ == "__main__": main()
