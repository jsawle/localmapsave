"""Runs the units choice of Atlas 5.0 (atlas-sketch) in Chromium against the real services.

Run:  python3 atlas-sketch/tests/live-units.py [--shots DIR] [--proxy URL] [--axe PATH]
Needs network access to js.arcgis.com, www.arcgis.com and elevation3d.arcgis.com, and Python Playwright with Chromium.

Checks: with units on auto a device in a US time zone starts in miles and feet and one in a UK time zone in kilometres
and metres (whatever the browser's language), in Elevation, Measure and Sketch's tooltips and side labels; the km / mi
switch changes all three at once and is remembered after a reload; a configuration can fix the units; units= in the
link comes first; no request is made to find out where the device is; an accessibility scan of the switch.
"""
import argparse, functools, glob, http.server, json, math, os, pathlib, re, sys, threading
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
APP = HERE.parent
V = "document.querySelector('arcgis-map').view"
SK = "document.querySelector('arcgis-sketch')"
TEXTS = """(() => { const out = []; const root = document.querySelector('arcgis-map').shadowRoot; const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n;
  while ((n = w.nextNode())) { const t = (n.nodeValue || '').trim(); if (/\\d\\s?(km²|mi²|m²|ft²|km|mi|m|ft)(?![\\w²])/.test(t)) out.push(t); } return out; })()"""
KNOWN = ("localhost", "js.arcgis.com", "arcgis.com", "arcgisonline.com", "esri.com")

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
        hosts = set()
        def session(tz, locale):
            ctx = browser.new_context(viewport={"width": 1366, "height": 768}, timezone_id=tz, locale=locale); page = ctx.new_page(); errors = []
            page.on("pageerror", lambda e: errors.append(str(e)[:300])); page.on("request", lambda r: hosts.add(r.url.split("/")[2] if "//" in r.url else r.url[:20]))
            return ctx, page, errors
        def load(page, query="config=mapmaker"):
            page.goto(f"{base}/index.html?{query}"); page.wait_for_function(V + " && " + V + ".ready", timeout=120000); page.wait_for_timeout(1500)
            page.evaluate("async () => { await " + V + ".goTo({ center: [-9.6, 39.0], zoom: 8 }, { animate: false }); }"); page.wait_for_timeout(1200)
        def profile(page):
            page.click("#tool-profile"); page.wait_for_selector("#profChart .prof-msg, #profChart .prof-land", timeout=60000); page.wait_for_timeout(600)
            r = page.evaluate("(() => { const b = document.getElementById('mapWrap').getBoundingClientRect(); return [b.left, b.top, b.width, b.height]; })()")
            y = r[1] + r[3] / 2; page.mouse.click(r[0] + r[2] * 0.7, y); page.wait_for_timeout(700); page.mouse.move(r[0] + r[2] * 0.3, y, steps=4); page.mouse.dblclick(r[0] + r[2] * 0.3, y)
            page.wait_for_selector("#profChart .prof-land", timeout=60000); page.wait_for_timeout(400)
        def chart_units(page):
            t = " ".join(page.evaluate("[...document.querySelectorAll('#profChart .prof-tick'), ...document.querySelectorAll('#profStats dd')].map(x => x.textContent)"))
            return sorted(set(re.findall(r"\d (km|mi|m|ft)\b", t)))
        def pressed(page, panel): return page.evaluate("(p) => [...document.querySelectorAll('#' + p + ' .units-seg button')].filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.dataset.units)", panel)
        def close(page, panel): page.evaluate("(p) => document.querySelector('#' + p + ' [data-close]').click()", panel); page.wait_for_timeout(700)
        def sketch_units(page):   # the tooltip and side labels while a rectangle is drawn
            page.click("#tool-sketch"); page.wait_for_function(SK + ".state === 'ready' && !!" + SK + ".view", timeout=120000); page.wait_for_timeout(2000)
            page.evaluate("async () => { await " + SK + ".create('rectangle'); }"); page.wait_for_timeout(900)
            page.mouse.move(300, 250); page.mouse.down(); page.mouse.move(380, 300, steps=5); page.mouse.move(470, 361, steps=6); page.wait_for_timeout(1200)
            texts = page.evaluate(TEXTS); page.mouse.up(); page.wait_for_timeout(600)
            page.evaluate("(() => { const s = " + SK + "; try { s.cancel(); } catch (e) {} })()"); page.wait_for_timeout(500); page.click("#tool-sketch"); page.wait_for_timeout(600)
            return texts, sorted(set(u for t in texts for u in re.findall(r"\d\s?(km²|mi²|m²|ft²|km|mi|m|ft)(?![\w²])", t)))
        def measure_units(page):
            page.click("#tool-measure"); page.wait_for_selector("#measurePanel:not([hidden])", timeout=30000); page.click("#mDist"); page.wait_for_timeout(2500)
            page.mouse.click(400, 300); page.wait_for_timeout(600); page.mouse.move(600, 320, steps=4); page.mouse.dblclick(600, 320); page.wait_for_timeout(2000)
            t = page.inner_text("#measureBody"); return t.replace("\n", " "), sorted(set(re.findall(r"\d\s?(km|mi|m|ft)\b", t)))
        def axe(page, sel, what):
            if not a.axe: return
            page.add_script_tag(path=a.axe)
            res = page.evaluate("async (sel) => { const r = await axe.run(sel, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }); return r.violations.map(v => v.id + ': ' + v.nodes.length + ' ' + (v.nodes[0] && v.nodes[0].target.join(' '))); }", sel)
            check(not res, what + " passes the accessibility scan" + (": " + "; ".join(res) if res else ""))

        print("== a US time zone, with a British-English browser")
        ctx, page, errors = session("America/Chicago", "en-GB"); load(page)
        profile(page); cu = chart_units(page)
        check(cu == ["ft", "mi"] and pressed(page, "profilePanel") == ["imperial"], "Elevation is in miles and feet, and the switch says so: " + json.dumps(cu))
        page.screenshot(path=str(shots / "units-us.png")); axe(page, "#profilePanel", "the Elevation dock with the switch"); close(page, "profilePanel")
        texts, su = sketch_units(page)
        check(su and all(u in ("mi", "ft", "mi²", "ft²") for u in su), "Sketch's tooltip and side labels are in miles or feet: " + " | ".join(texts))
        mt, mu = measure_units(page)
        check(mu and all(u in ("mi", "ft") for u in mu) and pressed(page, "measurePanel") == ["imperial"], "Measure is in miles: " + mt[:80])
        axe(page, "#measurePanel", "the Measure panel with the switch")

        print("== the switch")
        page.click("#measurePanel .units-seg button[data-units='metric']"); page.wait_for_timeout(1500)
        mt = page.inner_text("#measureBody").replace("\n", " "); mu = sorted(set(re.findall(r"\d\s?(km|mi|m|ft)\b", mt)))
        check(mu and all(u in ("km", "m") for u in mu) and pressed(page, "measurePanel") == ["metric"], "choosing km changes the measurement already made: " + mt[:80])
        page.screenshot(path=str(shots / "units-switch-measure.png")); close(page, "measurePanel")
        texts, su = sketch_units(page)
        check(su and all(u in ("km", "m", "km²", "m²") for u in su), "Sketch follows: " + " | ".join(texts))
        page.click("#tool-profile"); page.wait_for_selector("#profChart .prof-land", timeout=60000); cu = chart_units(page)
        check(cu == ["km", "m"] and pressed(page, "profilePanel") == ["metric"], "Elevation follows: " + json.dumps(cu))
        page.click("#profilePanel .units-seg button[data-units='imperial']"); page.wait_for_timeout(600)
        check(chart_units(page) == ["ft", "mi"], "the switch in Elevation redraws the chart in miles and feet")
        page.click("#profilePanel .units-seg button[data-units='metric']"); page.wait_for_timeout(400)
        load(page); profile(page)
        check(chart_units(page) == ["km", "m"] and pressed(page, "profilePanel") == ["metric"], "the choice is remembered when the app is opened again")
        load(page, "config=mapmaker&units=imperial"); profile(page)
        check(chart_units(page) == ["ft", "mi"], "units=imperial in the link comes before the remembered choice")
        check(not errors, "no script errors" + (": " + " | ".join(errors[:3]) if errors else "")); ctx.close()

        print("== a UK time zone, with a US-English browser")
        ctx, page, errors = session("Europe/London", "en-US"); load(page)
        profile(page); cu = chart_units(page)
        check(cu == ["km", "m"] and pressed(page, "profilePanel") == ["metric"], "Elevation is in kilometres and metres: " + json.dumps(cu))
        page.screenshot(path=str(shots / "units-uk.png")); close(page, "profilePanel")
        texts, su = sketch_units(page)
        check(su and all(u in ("km", "m", "km²", "m²") for u in su), "Sketch's tooltip and side labels are in kilometres or metres: " + " | ".join(texts))
        mt, mu = measure_units(page)
        check(mu and all(u in ("km", "m") for u in mu), "Measure is in kilometres: " + mt[:80])
        check(not errors, "no script errors" + (": " + " | ".join(errors[:3]) if errors else "")); ctx.close()

        print("== a configuration that fixes the units")
        ctx, page, errors = session("America/Chicago", "en-US"); load(page, "config=example-es"); profile(page)
        check(chart_units(page) == ["km", "m"], "units: metric in the configuration is kilometres, in a US time zone too")
        ctx.close()
        odd = sorted(h for h in hosts if not any(h.split(":")[0] == k or h.split(":")[0].endswith("." + k) for k in KNOWN))
        check(not odd, "nothing was asked of any other service to find the place: " + (", ".join(odd) or "only the app, js.arcgis.com and ArcGIS services"))
        browser.close()
    srv.shutdown()
    print(f"\n{checks[0] - len(failures)} of {checks[0]} checks passed")
    sys.exit(1 if failures else 0)

if __name__ == "__main__":
    main()
