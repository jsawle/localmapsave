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

        ANIMALS = "1fbb242c54e4415d9b8e8a343ca7a9d0"
        print("== one toolbar, and a panel that says what to do")
        page.goto(f"{base}/index.html?config=mapmaker")
        page.wait_for_function("document.querySelector('arcgis-map') && document.querySelector('arcgis-map').view && document.querySelector('arcgis-map').view.ready", timeout=120000)
        page.click("#tool-sketch")
        page.wait_for_function(SK + ".state === 'ready' && !!" + SK + ".view", timeout=120000); page.wait_for_timeout(2500)
        box = page.evaluate("(() => { const r = " + SK + ".getBoundingClientRect(), p = document.querySelector('#sketchPanel').getBoundingClientRect(); return { w: r.width, h: r.height, right: r.right, panelLeft: p.left, layout: " + SK + ".layout }; })()")
        check(box["layout"] == "vertical" and box["h"] > box["w"] * 3, "the drawing toolbar is vertical (%d wide, %d tall)" % (box["w"], box["h"]))
        check(0 <= box["panelLeft"] - box["right"] <= 24, "it stands on the right of the map, just beside the Sketch panel (%d px between them)" % (box["panelLeft"] - box["right"]))
        check(shown() == ["sketchHint"] and "Choose a drawing tool" in page.inner_text("#sketchHint"), "with no tool chosen the panel only says how to start: " + page.inner_text("#sketchHint"))
        axe("Sketch panel, no tool")

        print("== a point: Change symbol, as in Map Viewer")
        start("point"); page.wait_for_function("!document.querySelector('#secSymbol').hidden", timeout=10000)
        check(shown() == ["sketchHint", "skKind", "secSymbol", "secColour", "secSize"] and page.inner_text("#skKind") == "Point" and page.inner_text("#sketchHint") == "Click the map to add a point.", "the point tool: what to do, then Current symbol, Colour and Size: " + ", ".join(shown()))
        check("Circle" in page.get_attribute("#skSymbolOpen", "aria-label"), "Current symbol starts as the circle: " + page.get_attribute("#skSymbolOpen", "aria-label"))
        page.click("#skSymbolOpen"); page.wait_for_selector("#skSymbols:not([hidden])")
        check(page.evaluate("document.activeElement.id") == "skSymbolsH" and page.is_hidden("#skMain"), "it opens Change symbol, a view of its own, with focus on its heading")
        sets = page.evaluate("[...document.querySelectorAll('#symbolSet option')].map(o => o.textContent)")
        check(len(sets) == 14 and {"Animals", "Buildings", "Pins", "Numbers", "Vehicles", "Trees", "Landforms"} <= set(sets), "14 categories, from Esri's sketch styles: " + ", ".join(sets))
        counts = {}
        for key in ["pins", "numbers", "shapes", "places", "animals"]:
            page.select_option("#symbolSet", key); page.wait_for_function("document.querySelector('#symbolStatus').textContent === '' && document.querySelectorAll('#symbolGrid .sym-btn').length > 5", timeout=60000)
            counts[key] = page.locator("#symbolGrid .sym-btn").count()
        check(counts["pins"] >= 16 and counts["numbers"] >= 40 and counts["shapes"] >= 70 and counts["places"] >= 55 and counts["animals"] >= 48, "symbols per category: " + json.dumps(counts))
        check(page.evaluate("[...document.querySelectorAll('#symbolGrid .sym-btn')].every(b => (b.getAttribute('aria-label') || '').length > 1 && b.hasAttribute('aria-pressed'))") and page.locator('#symbolGrid .sym-btn[aria-label="Fox"]').count() == 1, "every symbol is a button with a name (Fox, Bear...)")
        grid = page.evaluate("(() => { const g = document.querySelector('#symbolGrid').getBoundingClientRect(), p = document.querySelector('#sketchPanel').getBoundingClientRect(); return [g.height, p.height]; })()")
        check(grid[0] > grid[1] * 0.55, "the symbols take most of the panel's height (%d of %d px)" % (grid[0], grid[1]))
        page.fill("#symbolSearch", "bear"); page.wait_for_function("document.querySelectorAll('#symbolGrid .sym-btn').length <= 3 && document.querySelector('#symbolStatus').textContent.includes('symbol')", timeout=10000)
        check(page.locator('#symbolGrid .sym-btn[aria-label="Bear"]').count() == 1, "Search narrows the category: " + page.inner_text("#symbolStatus"))
        page.fill("#symbolSearch", ""); page.wait_for_function("document.querySelectorAll('#symbolGrid .sym-btn').length > 40")
        axe("Change symbol")
        page.screenshot(path=str(shots / "sketch-change-symbol.png"))
        page.click('#symbolGrid .sym-btn[aria-label="Fox"]'); page.click("#skSymbolsDone"); page.wait_for_selector("#skMain:not([hidden])")
        check(page.evaluate("document.activeElement.id") == "skSymbolOpen" and "Fox" in page.inner_text("#skSymbolOpen"), "Done goes back to Current symbol, now Fox")
        check("secColour" not in shown(), "a drawn symbol keeps its own colours, so Colour isn't offered")
        check(page.locator("#recentRow .sym-btn").count() == 1 and page.get_attribute("#recentRow .sym-btn", "aria-label") == "Fox", "Fox is the first of the Recent symbols")
        page.wait_for_timeout(2500)   # the symbol is fetched once
        page.mouse.click(500, 300); ok = count(1); sk = page.evaluate(SKETCHES)
        check(ok and sk[0]["shape"] == "web:" + ANIMALS + "/Fox", "a point drawn now is a Fox: " + str(sk[0]["shape"] if sk else None))
        page.wait_for_function(SKETCHES + "[0].sym === 'cim'", timeout=30000)
        check(True, "drawn with the vector symbol itself (a CIM symbol)")
        page.wait_for_function("!document.querySelector('#secFeature').hidden", timeout=10000)
        check(shown() == ["sketchHint", "skKind", "secFeature", "secSymbol", "secSize"] and page.is_visible("#fTitle") and page.is_visible("#skPopupOpen") and page.is_visible("#skDuplicate") and page.is_visible("#skDelete"), "selected, it has its Name, Pop-up, Duplicate and Delete: " + ", ".join(shown()))
        bar = page.evaluate("(() => { const out = []; const walk = (r) => { for (const el of r.querySelectorAll('*')) { if (el.tagName === 'CALCITE-ACTION' && el.offsetParent !== null) out.push(el.text || el.label || ''); if (el.shadowRoot) walk(el.shadowRoot); } }; walk(" + SK + ".shadowRoot || " + SK + "); const r = " + SK + ".getBoundingClientRect(); return { names: out, w: r.width }; })()")
        check(bar["w"] < 60 and not any(("uplicate" in n) or ("elete" in n) for n in bar["names"]), "with a sketch selected there is still one bar on the map (%d px wide), with no Duplicate or Delete of its own" % bar["w"])
        page.fill("#fTitle", "Den"); page.click("#skPopupOpen"); page.wait_for_selector("#skPopup:not([hidden])")
        check(page.evaluate("document.activeElement.id") == "skPopupH" and page.is_visible("#fDesc") and page.is_visible("#imgPick"), "Pop-up is a view of its own: description and image")
        page.fill("#fDesc", "A fox lives here"); axe("Pop-up view"); page.click("#skPopupDone"); page.wait_for_selector("#skMain:not([hidden])")
        check(page.inner_text("#skPopupState") == "added", "back on the main view, Pop-up says something was added")
        axe("Sketch panel, point selected")
        page.screenshot(path=str(shots / "sketch-point-panel.png"))
        page.click("#skDuplicate"); ok = count(2)
        check(ok, "Duplicate makes a second one")
        page.wait_for_timeout(800); page.click("#skDelete"); ok = count(1)
        check(ok and page.evaluate("document.activeElement.id") == "sketchH", "Delete removes the selected one, and focus goes to the panel's heading")
        start("point"); page.wait_for_timeout(500); page.click("#skSymbolOpen"); page.select_option("#symbolSet", "pins"); page.wait_for_function("document.querySelectorAll('#symbolGrid .sym-btn').length >= 16", timeout=60000)
        page.locator("#symbolGrid .sym-btn").first.click(); page.click("#skSymbolsDone")
        check("secColour" in shown() and page.locator("#recentRow .sym-btn").count() == 2, "a pin takes the chosen colour, so Colour is offered; two Recent symbols now")
        finish()

        print("== a line: pattern and arrows")
        start("polyline"); page.wait_for_function("!document.querySelector('#secArrow').hidden", timeout=10000)
        check(shown() == ["sketchHint", "skKind", "secColour", "secSize", "secPattern", "secArrow"] and page.inner_text("#sizeLabel") == "Width" and "double-click to finish" in page.inner_text("#sketchHint"), "the line tool shows Colour, Width, Pattern and Arrow: " + ", ".join(shown()))
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
        check(shown() == ["sketchHint", "skKind", "secColour", "secPattern", "secFill"] and page.inner_text("#patternLabel") == "Outline", "the area tool shows Colour, Outline and Fill: " + ", ".join(shown()))
        page.evaluate("(() => { const f = document.querySelector('#fFill'); f.value = 60; f.dispatchEvent(new Event('input', { bubbles: true })); })()"); page.click('#patternRow [data-pattern="long-dash"]')
        axe("Sketch panel, area")
        for x, y in [(300, 180), (420, 180), (420, 260)]: page.mouse.click(x, y); page.wait_for_timeout(300)
        page.mouse.dblclick(300, 260); ok = count(3); sk = page.evaluate(SKETCHES)
        check(ok and sk[2]["fill"] == 60 and abs(sk[2]["alpha"] - 0.6) < 0.01 and sk[2]["outline"] == "long-dash", "an area drawn now is 60% solid with a long-dashed outline: " + json.dumps(sk[2:3]))
        finish()

        print("== text")
        start("text"); page.wait_for_function("!document.querySelector('#rotSection').hidden", timeout=10000)
        check(shown() == ["sketchHint", "skKind", "secColour", "secSize", "rotSection"], "the text tool shows Colour, Size and Rotation: " + ", ".join(shown()))
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
        check(fa.get("shape") == "web:" + ANIMALS + "/Fox" and ops["__sketch_lines"]["featureSet"]["features"][0]["attributes"].get("arrow") == "both", "each sketch also carries its choices, so it can be edited again")
        page.goto(f"{base}/index.html?config=mapmaker"); page.wait_for_function("document.querySelector('arcgis-map') && document.querySelector('arcgis-map').view && document.querySelector('arcgis-map').view.ready", timeout=120000); page.wait_for_timeout(1200)
        drop("sketch_styles.amap", json.dumps(saved)); page.wait_for_function("document.querySelector('#toast').textContent.includes('sketch styles')", timeout=60000)
        count(3); page.wait_for_function(SKETCHES + ".some(s => s.sym === 'cim')", timeout=40000)
        back = page.evaluate(SKETCHES); by = {s["kind"]: s for s in back}
        check(by["point"]["shape"] == "web:" + ANIMALS + "/Fox" and by["point"]["sym"] == "cim" and by["polyline"]["marker"] == "begin-end" and by["polyline"]["style"] == "dot" and abs(by["polygon"]["alpha"] - 0.6) < 0.01 and by["polygon"]["outline"] == "long-dash", "opened from the file, all three look as they did")
        b5 = json.loads(json.dumps(saved))   # a file from 5.0.0-beta.5 named a Places symbol without its style
        for o in b5["operationalLayers"]:
            if o.get("id") == "__sketch_points":
                for f in o["featureCollection"]["layers"][0]["featureSet"]["features"]: f["attributes"]["shape"] = "web:school"
        page.goto(f"{base}/index.html?config=mapmaker"); page.wait_for_function("document.querySelector('arcgis-map') && document.querySelector('arcgis-map').view && document.querySelector('arcgis-map').view.ready", timeout=120000); page.wait_for_timeout(1200)
        drop("beta5_file.amap", json.dumps(b5)); page.wait_for_function("document.querySelector('#toast').textContent.includes('beta5 file')", timeout=60000); count(3)
        page.wait_for_function(SKETCHES + ".some(s => s.sym === 'cim')", timeout=40000)
        check({s["kind"]: s for s in page.evaluate(SKETCHES)}["point"]["shape"] == "web:school", "a file from beta.5 (\"web:school\") still shows its School symbol")
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
