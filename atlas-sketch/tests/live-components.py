"""Runs the tools that are SDK components (Legend, Measure, Coordinates, Swipe, Table) of Atlas 5.0 in Chromium against the real services.

Run:  python3 atlas-sketch/tests/live-components.py [--shots DIR] [--proxy URL] [--axe PATH]
Needs network access to js.arcgis.com and www.arcgis.com, and Python Playwright with Chromium.

Checks: none of the SDK's widget classes is downloaded; the Legend panel and a layer's own legend show the layer's
symbols; Measure gives a distance and an area, with no units menu of its own, and Clear takes the measurement off the
map; Coordinates captures the place clicked and Copy is enabled; Swipe goes on and off; the table lists the layer's
rows and closes; accessibility scans of each.
"""
import argparse, functools, glob, http.server, json, math, os, pathlib, re, sys, threading
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
APP = HERE.parent
V = "document.querySelector('arcgis-map').view"
CSV = "Site,Latitude,Longitude,Count\nAlpha,39.5,-8.5,3\nBravo,38.9,-9.2,7\nCharlie,39.2,-10.4,5\n"
# all the text inside an element, through any shadow roots
DEEP = """(sel) => { const out = []; const walk = (n) => { if (!n) return; if (n.nodeType === 3) { const t = n.nodeValue.trim(); if (t) out.push(t); return; } if (n.nodeType !== 1 && n.nodeType !== 11) return; if (n.nodeType === 1 && (n.tagName === 'STYLE' || n.tagName === 'SCRIPT')) return; if (n.shadowRoot) walk(n.shadowRoot); for (const c of n.childNodes) walk(c); }; walk(document.querySelector(sel)); return out.join(' | '); }"""
COUNT = """([sel, what]) => { let n = 0; const walk = (e) => { if (!e) return; if (e.nodeType === 1 && e.matches && e.matches(what)) n++; if (e.shadowRoot) walk(e.shadowRoot); for (const c of (e.children || [])) walk(c); }; walk(document.querySelector(sel)); return n; }"""

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
        page = browser.new_context(viewport={"width": 1366, "height": 768}, timezone_id="Europe/London", locale="en-GB").new_page(); errors = []; urls = []
        page.on("pageerror", lambda e: errors.append((getattr(e, "stack", "") or str(e))[:700])); page.on("request", lambda r: urls.append(r.url)); page.on("dialog", lambda d: d.accept())
        def axe(sel, what):
            if not a.axe: return
            page.add_script_tag(path=a.axe)
            res = page.evaluate("async (sel) => { const r = await axe.run(sel, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }); return r.violations.map(v => v.id + ': ' + v.nodes.length + ' ' + (v.nodes[0] && v.nodes[0].target.join(' '))); }", sel)
            check(not res, what + " passes the accessibility scan" + (": " + "; ".join(res) if res else ""))
        def deep(sel): return page.evaluate(DEEP, sel)
        def wait_text(sel, pattern, timeout=40000):
            import time; end = time.time() + timeout / 1000
            while time.time() < end:
                t = deep(sel)
                if re.search(pattern, t): return t
                page.wait_for_timeout(500)
            return deep(sel)
        analyses = lambda: page.evaluate(V + ".analyses.length")

        page.goto(f"{base}/index.html?config=mapmaker"); page.wait_for_function(V + " && " + V + ".ready", timeout=120000); page.wait_for_timeout(1500)
        page.evaluate("async () => { await " + V + ".goTo({ center: [-9.6, 39.0], zoom: 8 }, { animate: false }); }"); page.wait_for_timeout(1200)
        page.evaluate("""([name, text]) => { const dt = new DataTransfer(); dt.items.add(new File([text], name, { type: 'text/csv' })); window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); }""", ["places.csv", CSV])
        page.wait_for_selector("#dataSubmit:not([disabled])", timeout=60000); page.click("#dataSubmit")
        page.wait_for_function(V + ".map.layers.some(l => l.type === 'feature' && l.title && l.title.includes('places'))", timeout=60000); page.wait_for_timeout(2500)
        page.evaluate("document.querySelectorAll('.panel:not([hidden]) [data-close]').forEach(b => b.click())"); page.wait_for_timeout(600)

        print("== Legend")
        page.click("#tool-legend"); page.wait_for_selector("#legendBody arcgis-legend", timeout=60000)
        lt = wait_text("#legendBody", r"places")
        check("places" in lt, "the Legend panel lists the spreadsheet layer: " + lt[:120])
        check(page.evaluate(COUNT, ["#legendBody", "svg, img, canvas"]) > 0, "with its symbol drawn")
        page.screenshot(path=str(shots / "components-legend.png")); axe("#legendPanel", "the Legend panel")
        page.evaluate("document.querySelector('#legendPanel [data-close]').click()"); page.wait_for_timeout(500)
        page.click("#tool-layers"); page.wait_for_selector("#layersPanel:not([hidden])", timeout=30000); page.wait_for_timeout(800)
        page.evaluate("document.querySelector('#layersPanel [data-key$=\":legend\"]').click()"); page.wait_for_selector("#layersPanel .lyr-legend arcgis-legend", timeout=60000); page.wait_for_timeout(2500)
        check(page.evaluate(COUNT, ["#layersPanel .lyr-legend", "svg, img, canvas"]) > 0, "a layer's own legend, in the layer list, draws its symbol")
        page.screenshot(path=str(shots / "components-layer-legend.png")); axe("#layersPanel", "the layer list with a legend open")

        print("== Table")
        page.evaluate("document.querySelector('#layersPanel [data-key$=\":table\"]').click()"); page.wait_for_selector("#tableBody arcgis-feature-table", timeout=60000)
        tt = wait_text("#tableBody", r"Alpha.*Bravo.*Charlie|Charlie.*Bravo.*Alpha|Bravo")
        check(all(x in tt for x in ("Alpha", "Bravo", "Charlie", "Site", "Count")), "the table lists the layer's three rows and its columns: " + tt[:140])
        box = page.evaluate("(() => { const d = document.getElementById('tableDock').getBoundingClientRect(), e = document.querySelector('#tableBody arcgis-feature-table').getBoundingClientRect(); return [d.width, d.height, e.width, e.height, innerWidth]; })()")
        check(box[2] > box[4] - 40 and box[3] > 120, "it fills the dock under the map: %dx%d" % (box[2], box[3]))
        page.screenshot(path=str(shots / "components-table.png")); axe("#tableDock", "the table dock")
        page.click("#tableClose"); page.wait_for_timeout(800)
        check(page.is_hidden("#tableDock") and page.evaluate("!document.querySelector('arcgis-feature-table')"), "closing it takes the table away")

        print("== Swipe")
        page.evaluate("document.querySelector('#layersPanel [data-key$=\":swipe\"]').click()"); page.wait_for_selector("arcgis-map arcgis-swipe", timeout=60000); page.wait_for_timeout(2500)
        sw = page.evaluate("(() => { const s = document.querySelector('arcgis-swipe'), b = s.getBoundingClientRect(), m = document.querySelector('arcgis-map').getBoundingClientRect(); return { lead: s.leadingLayers.length, pos: s.swipePosition, dir: s.direction, state: s.state, w: b.width, h: b.height, mw: m.width, mh: m.height, pressed: document.querySelector('#layersPanel [data-key$=\":swipe\"]').getAttribute('aria-pressed') }; })()")
        check(sw["lead"] == 1 and sw["pos"] == 50 and sw["dir"] == "horizontal" and sw["pressed"] == "true", "Swipe is on for the layer, half way across: " + json.dumps(sw))
        check(page.evaluate(COUNT, ["arcgis-swipe", "[role=slider], [role=separator], button, calcite-handle, .esri-swipe__handle"]) > 0, "its handle is on the map")
        page.screenshot(path=str(shots / "components-swipe.png"))
        page.evaluate("document.querySelector('#layersPanel [data-key$=\":swipe\"]').click()"); page.wait_for_timeout(800)
        check(page.evaluate("!document.querySelector('arcgis-swipe')") and page.evaluate("document.querySelector('#layersPanel [data-key$=\":swipe\"]').getAttribute('aria-pressed')") == "false", "and off again")
        page.evaluate("document.querySelector('#layersPanel [data-close]').click()"); page.wait_for_timeout(500)

        print("== Measure")
        page.click("#tool-measure"); page.wait_for_selector("#measurePanel:not([hidden])", timeout=30000)
        page.click("#mDist"); page.wait_for_selector("#measureBody arcgis-distance-measurement-2d", timeout=60000); page.wait_for_timeout(2500)
        # the pointer has to have been over the map for a moment before the first click counts (seen in a probe)
        page.mouse.move(300, 200); page.mouse.move(350, 250, steps=10); page.wait_for_timeout(2500); page.mouse.move(400, 300, steps=10); page.wait_for_timeout(800)
        page.mouse.click(400, 300); page.wait_for_timeout(700); page.mouse.move(600, 320, steps=6); page.wait_for_timeout(400); page.mouse.dblclick(600, 320)
        mt = wait_text("#measureBody", r"\d[ |]*km")
        check(re.search(r"\d[ |]*km", mt) is not None and analyses() == 1, "a distance is measured, in kilometres here: " + mt[:120])
        check(page.evaluate(COUNT, ["#measureBody", "calcite-select, select, calcite-combobox"]) == 0 and page.evaluate("document.querySelector('#measureBody arcgis-distance-measurement-2d').hideUnitSelect") is True, "the component has no units menu of its own")
        page.click("#measurePanel .units-seg button[data-units='imperial']")
        mt2 = wait_text("#measureBody", r"\d[ |]*mi")
        check(re.search(r"\d[ |]*mi", mt2) is not None, "the km / mi switch changes it to miles: " + mt2[:120])
        page.click("#measurePanel .units-seg button[data-units='metric']"); page.wait_for_timeout(500)
        page.screenshot(path=str(shots / "components-measure.png")); axe("#measurePanel", "the Measure panel with a distance")
        page.click("#mArea"); page.wait_for_selector("#measureBody arcgis-area-measurement-2d", timeout=60000); page.wait_for_timeout(2500)
        check(page.evaluate("document.querySelectorAll('#measureBody > *').length") == 1 and analyses() == 1, "choosing Area replaces the distance tool and its line")
        page.mouse.move(300, 200); page.mouse.move(340, 230, steps=10); page.wait_for_timeout(2500)
        for x, y in ((380, 250), (560, 260), (540, 400)): page.mouse.move(x, y, steps=6); page.wait_for_timeout(300); page.mouse.click(x, y); page.wait_for_timeout(500)
        page.mouse.move(390, 390, steps=3); page.mouse.dblclick(390, 390)
        at = wait_text("#measureBody", r"\d[ |]*km²")
        check(re.search(r"\d[ |]*km²", at) is not None, "an area is measured: " + at[:140])
        page.click("#mClear"); page.wait_for_timeout(800)
        check(analyses() == 0 and page.evaluate("document.querySelectorAll('#measureBody > *').length") == 0 and page.get_attribute("#mArea", "aria-pressed") == "false", "Clear takes the measurement off the map")

        print("== Coordinates")
        page.click("#mCoord"); page.wait_for_selector("#coordBody arcgis-coordinate-conversion", timeout=60000); page.wait_for_timeout(2500)
        check(page.evaluate("document.querySelector('arcgis-coordinate-conversion').mode") == "capture" and page.is_disabled("#coordCopy"), "Coordinates waits for a click on the map (capture), with Copy off")
        page.mouse.click(500, 330); page.wait_for_timeout(600); page.mouse.move(700, 200); page.wait_for_timeout(1500)
        ct = wait_text("#coordBody", r"\d")
        try: page.wait_for_selector("#coordCopy:not([disabled])", timeout=15000)
        except Exception: pass
        txt = page.evaluate("(() => { const c = document.querySelector('arcgis-coordinate-conversion'); const k = c.conversions && c.conversions.length ? c.conversions.getItemAt(0) : null; return k ? k.displayCoordinate : ''; })()")
        check(bool(txt) and re.search(r"\d", txt) is not None and not page.is_disabled("#coordCopy"), "the place clicked is captured and Copy is on: " + str(txt) + " / " + ct[:60])
        page.screenshot(path=str(shots / "components-coordinates.png")); axe("#measurePanel", "the Measure panel with coordinates")

        src = (APP / "app.js").read_text()
        check(not re.search(r"core/widgets/[A-Za-z]+\.js", src) and "new Legend(" not in src and "new Measurement(" not in src, "the app's code asks for none of the SDK's widget classes")
        wrapped = sorted(set(re.search(r"esri/widgets/([A-Za-z0-9]+)\.js", u).group(1) for u in urls if re.search(r"esri/widgets/(Legend|Measurement|DistanceMeasurement2D|AreaMeasurement2D|CoordinateConversion|Swipe|FeatureTable)\.js", u)))
        print("  note the SDK's own components still download these widget classes inside themselves: " + (", ".join(wrapped) or "none"))
        check(not errors, "no script errors" + (": " + " | ".join(errors[:3]) if errors else ""))
        browser.close()
    srv.shutdown()
    print(f"\n{checks[0] - len(failures)} of {checks[0]} checks passed")
    sys.exit(1 if failures else 0)

if __name__ == "__main__":
    main()
