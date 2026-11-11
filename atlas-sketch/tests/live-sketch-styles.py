"""Runs the Sketch styles of Atlas 5.0 (atlas-sketch) in Chromium against the real services.

Run:  python3 atlas-sketch/tests/live-sketch-styles.py [--shots DIR] [--proxy URL] [--axe FILE]
Needs network access to js.arcgis.com, cdn.arcgis.com and www.arcgis.com, and Python Playwright with Chromium.

Checks: the drawing toolbar runs down the right of the map beside the Sketch panel; the panel shows what suits the
tool in use (point: symbols, colour, size; line: colour, width, pattern, arrow; area: colour, fill, outline; text:
colour, size, rotation) and the sketch selected; a point takes one of Esri's vector symbols; a line takes a pattern
and arrows; an area a fill and outline; all of it is saved, in a form Map Viewer reads, and comes back.
"""
import argparse, functools, glob, http.server, json, os, pathlib, sys, threading
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
APP = HERE.parent
SK = "document.querySelector('arcgis-sketch')"
SHOWN = "(() => [...document.querySelectorAll('#sketchPanel .section, #sketchHint, #skKind')].filter(e => !e.hidden && e.getClientRects().length).map(e => e.id))()"
SKETCHES = "(() => { const v = document.querySelector('arcgis-map').view; const l = v.map.layers.find(x => x.id === '__sketch'); return l.graphics.map(g => ({ kind: g.attributes.kind, shape: g.attributes.shape, pattern: g.attributes.pattern, arrow: g.attributes.arrow, fill: g.attributes.fill, color: g.attributes.color, sym: g.symbol && g.symbol.type, style: g.symbol && g.symbol.style, marker: g.symbol && g.symbol.marker ? g.symbol.marker.placement : null, alpha: g.symbol && g.symbol.type === 'simple-fill' ? g.symbol.color.a : null, outline: g.symbol && g.symbol.outline ? g.symbol.outline.style : null })).toArray(); })()"
AXE = "axe.run('#sketchPanel', { runOnly: ['wcag2a','wcag2aa','wcag21a','wcag21aa'] }).then(r => r.violations.map(v => v.id + ': ' + v.nodes.map(n => n.target.join(' ')).slice(0,3).join(', ')))"

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
        ctx = browser.new_context(viewport={"width": 1366, "height": 768})
        ctx.add_init_script("delete window.showSaveFilePicker; delete window.showOpenFilePicker;")
        page = ctx.new_page(); errors = []
        page.on("pageerror", lambda e: errors.append(str(e)[:300]))
        page.on("dialog", lambda d: d.accept())
        def axe(what):
            if not a.axe: return
            if not page.evaluate("typeof axe !== 'undefined'"): page.add_script_tag(path=a.axe)
            v = page.evaluate(AXE); check(not v, what + ": no WCAG 2.1 A/AA violations (axe-core): " + "; ".join(v))
        def start(tool):
            r = page.evaluate("async (t) => { try { await " + SK + ".create(t); return 'ok'; } catch (e) { return String(e && e.message || e); } }", tool)
            page.wait_for_timeout(900); return r
        def finish():
            page.evaluate("(() => { const s = " + SK + "; try { if (s.state === 'active') { if (s.createGraphic) s.cancel(); else s.complete(); } } catch (e) {} })()"); page.wait_for_timeout(700)
        def shown(): return page.evaluate(SHOWN)
        def count(n):
            try: page.wait_for_function("n => " + SKETCHES + ".length === n", arg=n, timeout=20000); return True
            except Exception: return False
        def save_map(name):
            if not page.is_visible("#savePanel"): page.click("#tool-save")
            page.click("#saveTile"); page.wait_for_selector("#nameModal:not([hidden])"); page.fill("#fileNameInput", name)
            with page.expect_download() as dl: page.click("#nameConfirm")
            return json.loads(pathlib.Path(dl.value.path()).read_text())
        def drop(name, text):
            page.evaluate("""([name, text]) => { const dt = new DataTransfer(); dt.items.add(new File([text], name, { type: 'application/json' })); window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); }""", [name, text])

        print("== the toolbar and the panel")
        page.goto(f"{base}/index.html?config=mapmaker")
        page.wait_for_function("document.querySelector('arcgis-map') && document.querySelector('arcgis-map').view && document.querySelector('arcgis-map').view.ready", timeout=120000)
        page.click("#tool-sketch")
        page.wait_for_function(SK + ".state === 'ready' && !!" + SK + ".view", timeout=120000); page.wait_for_timeout(2500)
        box = page.evaluate("(() => { const r = " + SK + ".getBoundingClientRect(), p = document.querySelector('#sketchPanel').getBoundingClientRect(); return { w: r.width, h: r.height, right: r.right, panelLeft: p.left, layout: " + SK + ".layout }; })()")
        check(box["layout"] == "vertical" and box["h"] > box["w"] * 3, "the drawing toolbar is vertical (%d wide, %d tall)" % (box["w"], box["h"]))
        check(0 <= box["panelLeft"] - box["right"] <= 24, "it stands on the right of the map, just beside the Sketch panel (%d px between them)" % (box["panelLeft"] - box["right"]))
        check(shown() == ["sketchHint"], "with no tool chosen the panel only says how to start: " + ", ".join(shown()))
        page.screenshot(path=str(shots / "sketch-toolbar.png"))
        axe("Sketch panel, no tool")

        print("== a point: Esri's vector symbols")
        start("point"); page.wait_for_function("!document.querySelector('#secSymbol').hidden", timeout=10000)
        check(shown() == ["skKind", "secSymbol", "secColour", "secSize"] and page.inner_text("#skKind").startswith("Point"), "the point tool shows Symbol, Colour and Size: " + ", ".join(shown()))
        page.wait_for_function("document.querySelectorAll('#symbolGrid .sym-btn').length > 20", timeout=60000)
        n_shapes = page.locator("#symbolGrid .sym-btn").count()
        page.select_option("#symbolSet", "POI-Large"); page.wait_for_function("document.querySelectorAll('#symbolGrid .sym-btn').length > 40")
        names = page.evaluate("[...document.querySelectorAll('#symbolGrid .sym-btn')].map(b => b.dataset.shape.slice(4))")
        check(n_shapes > 20 and len(names) > 50 and "school" in names and "park" in names, f"two sets of symbols: {n_shapes} shapes, {len(names)} places and pins")
        check(not ({"bar", "casino", "vineyard"} & set(names)), "Bar, Casino and Vineyard are left out")
        check(page.evaluate("[...document.querySelectorAll('#symbolGrid .sym-btn')].every(b => (b.getAttribute('aria-label') || '').length > 1 && b.hasAttribute('aria-pressed'))"), "every symbol is a button with a name")
        page.click('#symbolGrid .sym-btn[data-shape="web:school"]'); page.click('#swatches .swatch >> nth=4')
        page.wait_for_timeout(2500)   # the symbol is fetched once
        axe("Sketch panel, point")
        page.screenshot(path=str(shots / "sketch-point-panel.png"))
        page.mouse.click(500, 300); ok = count(1); sk = page.evaluate(SKETCHES)
        check(ok and sk[0]["shape"] == "web:school", "a point drawn now is a School: " + json.dumps(sk[:1]))
        page.wait_for_function(SKETCHES + "[0].sym === 'cim'", timeout=30000)
        check(True, "drawn with the vector symbol itself (a CIM symbol)")
        check(shown() == ["skKind", "secPopup", "secSymbol", "secColour", "secSize"], "selected, it also has its Pop-up: " + ", ".join(shown()))
        page.click('#symbolGrid .sym-btn[data-shape="web:park"]'); page.wait_for_function(SKETCHES + "[0].shape === 'web:park'"); page.wait_for_timeout(1500)
        check(page.evaluate(SKETCHES)[0]["sym"] == "cim", "choosing another symbol changes the selected point (Park)")
        finish()

        print("== a line: pattern and arrows")
        start("polyline"); page.wait_for_function("!document.querySelector('#secArrow').hidden", timeout=10000)
        check(shown() == ["skKind", "secColour", "secSize", "secPattern", "secArrow"] and page.inner_text("#sizeLabel") == "Width", "the line tool shows Colour, Width, Pattern and Arrow: " + ", ".join(shown()))
        check(page.evaluate("[...document.querySelectorAll('#patternRow button')].map(b => b.dataset.pattern).join()") == "solid,dash,dot,dash-dot,long-dash" and page.evaluate("[...document.querySelectorAll('#arrowRow button')].map(b => b.dataset.arrow).join()") == "none,end,start,both", "5 patterns and 4 arrow choices")
        page.click('#patternRow [data-pattern="dash"]'); page.click('#arrowRow [data-arrow="end"]')
        axe("Sketch panel, line")
        page.mouse.click(300, 420); page.wait_for_timeout(300); page.mouse.click(450, 380); page.wait_for_timeout(300); page.mouse.dblclick(640, 430); ok = count(2)
        sk = page.evaluate(SKETCHES)
        check(ok and sk[1]["pattern"] == "dash" and sk[1]["arrow"] == "end" and sk[1]["style"] == "dash" and sk[1]["marker"] == "end", "a line drawn now is dashed with an arrow at its end: " + json.dumps(sk[1:2]))
        page.click('#arrowRow [data-arrow="both"]'); page.click('#patternRow [data-pattern="dot"]'); page.wait_for_timeout(400); sk = page.evaluate(SKETCHES)
        check(sk[1]["marker"] == "begin-end" and sk[1]["style"] == "dot", "changing them restyles the selected line (dotted, arrows at both ends)")
        page.wait_for_timeout(800); page.screenshot(path=str(shots / "sketch-line-panel.png"))
        finish()

        print("== an area: fill and outline")
        start("polygon"); page.wait_for_function("!document.querySelector('#secFill').hidden", timeout=10000)
        check(shown() == ["skKind", "secColour", "secPattern", "secFill"] and page.inner_text("#patternLabel") == "Outline", "the area tool shows Colour, Outline and Fill: " + ", ".join(shown()))
        page.evaluate("(() => { const f = document.querySelector('#fFill'); f.value = 60; f.dispatchEvent(new Event('input', { bubbles: true })); })()"); page.click('#patternRow [data-pattern="long-dash"]')
        axe("Sketch panel, area")
        for x, y in [(300, 180), (420, 180), (420, 260)]: page.mouse.click(x, y); page.wait_for_timeout(300)
        page.mouse.dblclick(300, 260); ok = count(3); sk = page.evaluate(SKETCHES)
        check(ok and sk[2]["fill"] == 60 and abs(sk[2]["alpha"] - 0.6) < 0.01 and sk[2]["outline"] == "long-dash", "an area drawn now is 60% solid with a long-dashed outline: " + json.dumps(sk[2:3]))
        finish()

        print("== text")
        start("text"); page.wait_for_function("!document.querySelector('#rotSection').hidden", timeout=10000)
        check(shown() == ["skKind", "secColour", "secSize", "rotSection"], "the text tool shows Colour, Size and Rotation: " + ", ".join(shown()))
        finish(); page.wait_for_timeout(600)
        check(shown() == ["sketchHint"], "with the tool put down, only the hint again")
        page.wait_for_timeout(1500); page.screenshot(path=str(shots / "sketch-styles-map.png"))

        print("== saved and opened again")
        saved = save_map("sketch_styles")
        ops = {o["id"]: o["featureCollection"]["layers"][0] for o in saved["operationalLayers"] if str(o.get("id", "")).startswith("__sketch_")}
        pt = ops["__sketch_points"]["layerDefinition"]["drawingInfo"]["renderer"]["uniqueValueInfos"][0]["symbol"]
        ln = ops["__sketch_lines"]["layerDefinition"]["drawingInfo"]["renderer"]["uniqueValueInfos"][0]["symbol"]
        ar = ops["__sketch_areas"]["layerDefinition"]["drawingInfo"]["renderer"]["uniqueValueInfos"][0]["symbol"]
        check(pt.get("type") == "CIMSymbolReference", "the point's symbol in the file is the vector symbol (CIMSymbolReference), as Map Viewer saves one")
        check(ln.get("style") == "esriSLSDot" and (ln.get("marker") or {}).get("placement") == "begin-end" and (ln.get("marker") or {}).get("style") == "arrow", "the line's is dotted with arrows at both ends: " + json.dumps({k: ln.get(k) for k in ("style", "marker")}))
        check(ar.get("color", [0, 0, 0, 0])[3] == 153 and ar["outline"]["style"] == "esriSLSLongDash", "the area's is 60% solid with a long-dashed outline")
        fa = ops["__sketch_points"]["featureSet"]["features"][0]["attributes"]
        check(fa.get("shape") == "web:park" and ops["__sketch_lines"]["featureSet"]["features"][0]["attributes"].get("arrow") == "both", "each sketch also carries its choices, so it can be edited again")
        page.goto(f"{base}/index.html?config=mapmaker"); page.wait_for_function("document.querySelector('arcgis-map') && document.querySelector('arcgis-map').view && document.querySelector('arcgis-map').view.ready", timeout=120000); page.wait_for_timeout(1200)
        drop("sketch_styles.amap", json.dumps(saved)); page.wait_for_function("document.querySelector('#toast').textContent.includes('sketch styles')", timeout=60000)
        count(3); page.wait_for_function(SKETCHES + ".some(s => s.sym === 'cim')", timeout=40000)
        back = page.evaluate(SKETCHES); by = {s["kind"]: s for s in back}
        check(by["point"]["shape"] == "web:park" and by["point"]["sym"] == "cim" and by["polyline"]["marker"] == "begin-end" and by["polyline"]["style"] == "dot" and abs(by["polygon"]["alpha"] - 0.6) < 0.01 and by["polygon"]["outline"] == "long-dash", "opened from the file, all three look as they did")
        old = json.loads(json.dumps(saved))
        for o in old["operationalLayers"]:
            if str(o.get("id", "")).startswith("__sketch_"):
                for f in o["featureCollection"]["layers"][0]["featureSet"]["features"]:
                    for k in ("shape", "pattern", "arrow", "fill"): f["attributes"].pop(k, None)
        page.goto(f"{base}/index.html?config=mapmaker"); page.wait_for_function("document.querySelector('arcgis-map') && document.querySelector('arcgis-map').view && document.querySelector('arcgis-map').view.ready", timeout=120000); page.wait_for_timeout(1200)
        drop("older_file.amap", json.dumps(old)); page.wait_for_function("document.querySelector('#toast').textContent.includes('older file')", timeout=60000); count(3)
        by = {s["kind"]: s for s in page.evaluate(SKETCHES)}
        check(by["point"]["sym"] == "simple-marker" and by["polyline"]["style"] == "solid" and by["polyline"]["marker"] is None and abs(by["polygon"]["alpha"] - 0.25) < 0.01, "a file saved before these styles opens as before: circle, solid line, light fill")
        check(not errors, "no script errors: " + " | ".join(errors[:3]))
        browser.close()
    print(f"{checks[0] - len(failures)}/{checks[0]} checks passed")
    sys.exit(1 if failures else 0)

if __name__ == "__main__":
    main()
