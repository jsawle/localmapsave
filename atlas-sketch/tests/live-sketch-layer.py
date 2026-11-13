#!/usr/bin/env python3
"""Live check: sketch layers in Map layers. The first is listed only when there are sketches, and has transparency,
compare (2D) and delete-all like other layers; its transparency is kept in a saved file. With the lab switch
(config=lab) further sketch layers can be made (Add layer, or the Sketch panel), drawn on, renamed, moved in the
drawing order and removed, and they come back from a saved file, also in a config without the switch.

  python3 live-sketch-layer.py [--shots DIR] [--axe path/to/axe.min.js]
"""
import argparse, functools, glob, http.server, json, os, pathlib, sys, threading
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent; APP = HERE.parent
QUAKES = "85997c9571e74256af71dc20566b47f1"
SK = "document.querySelector('arcgis-sketch')"
LYR = "document.querySelector('arcgis-map').view.map.layers.find(x => x.id === '__sketch')"
ROWS = "[...document.querySelectorAll('#layersList > li.lyr')].map(li => li.querySelector('.li-title').textContent.trim())"
TOOLS = "(() => { const li = [...document.querySelectorAll('#layersList > li.lyr')].find(li => li.querySelector('.li-title').textContent.trim() === 'My sketches'); return li ? [...li.querySelectorAll('.lyr-tools button')].map(b => b.getAttribute('aria-label') || b.title) : null; })()"
AXE = "(sel) => axe.run(sel, { runOnly: ['wcag2a','wcag2aa','wcag21a','wcag21aa'] }).then(r => r.violations.map(v => v.id + ': ' + v.nodes.map(n => n.target.join(' ')).slice(0,3).join(', ')))"

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
        page = ctx.new_page(); errors = []; dialogs = []
        page.on("pageerror", lambda e: errors.append(str(e)[:300]))
        answer = [""]   # what to type into a prompt
        page.on("dialog", lambda d: (dialogs.append(d.message), d.accept(answer[0]) if d.type == "prompt" else d.accept()))
        def js(sel): page.evaluate("(s) => document.querySelector(s).click()", sel)
        def tool(label): page.evaluate("(label) => { const li = [...document.querySelectorAll('#layersList > li.lyr')].find(li => li.querySelector('.li-title').textContent.trim() === 'My sketches'); [...li.querySelectorAll('.lyr-tools button')].find(b => (b.getAttribute('aria-label') || '').startsWith(label)).click(); }", label); page.wait_for_timeout(600)
        def draw(x, y):
            page.evaluate("async () => { await " + SK + ".create('point'); }"); page.wait_for_timeout(900)
            page.mouse.move(x - 30, y - 20); page.mouse.move(x, y, steps=6); page.wait_for_timeout(900); page.mouse.click(x, y); page.wait_for_timeout(700)
            page.evaluate("(() => { const s = " + SK + "; try { if (s.state === 'active') s.cancel(); } catch (e) {} })()"); page.wait_for_timeout(500)
        def axe(sel, what):
            if not a.axe: return
            if not page.evaluate("typeof axe !== 'undefined'"): page.add_script_tag(path=a.axe)
            v = page.evaluate(AXE, sel); check(not v, what + ": no WCAG 2.1 A/AA violations (axe-core): " + "; ".join(v))

        print("== a web map with no sketches")
        page.goto(f"{base}/index.html?config=mapmaker&webmap={QUAKES}")
        page.wait_for_function("document.querySelector('#layersBadge') && document.querySelector('#layersBadge').textContent === '1'", timeout=120000)
        js("#tool-layers"); page.wait_for_selector("#layersList li", timeout=30000)
        rows = page.evaluate(ROWS); check(len(rows) == 1 and "My sketches" not in rows, "Map layers lists the map's layer and no sketch layer: " + str(rows))

        print("== a sketch is drawn")
        js("#tool-sketch"); page.wait_for_function(SK + ".state === 'ready' && !!" + SK + ".view", timeout=120000); page.wait_for_timeout(2500)
        draw(420, 330); draw(520, 380)
        n = page.evaluate(LYR + ".graphics.length"); check(n == 2, f"two sketches drawn ({n})")
        js("#tool-layers"); page.wait_for_selector("#layersPanel:not([hidden])"); page.wait_for_timeout(600)
        rows = page.evaluate(ROWS); check(rows[:1] == ["My sketches"] and len(rows) == 2, "now the sketch layer is listed, on top: " + str(rows))
        tools = page.evaluate(TOOLS); joined = " | ".join(tools or [])
        check(tools is not None and all(any(t.startswith(w) for t in tools) for w in ("Zoom to", "Adjust transparency", "Compare", "Delete all sketches")) or (tools is not None and "transparency" in joined and "Delete all sketches" in joined and len(tools) == 4), "its tools: " + joined)
        axe("#layersPanel", "Map layers with the sketch layer's tools")

        print("== transparency")
        tool("Adjust transparency")
        page.evaluate("(() => { const li = [...document.querySelectorAll('#layersList > li.lyr')][0]; const r = li.querySelector('input[type=range]'); r.value = 40; r.dispatchEvent(new Event('input', { bubbles: true })); })()"); page.wait_for_timeout(400)
        check(abs(page.evaluate(LYR + ".opacity") - 0.6) < 0.001, "the slider at 40% makes the sketch layer 40% transparent")
        axe("#layersPanel", "with the transparency slider open")

        print("== compare")
        tool(tools[2].split(":")[0] if tools else "Compare"); page.wait_for_timeout(3000)
        sw = page.evaluate("(() => { const s = document.querySelector('arcgis-swipe'); return s ? (s.leadingLayers ? s.leadingLayers.map(l => l.id).toArray ? s.leadingLayers.map(l => l.id).toArray() : [...s.leadingLayers].map(l => l.id) : []) : null; })()")
        check(sw == ["__sketch"], "Compare puts the sketch layer under the swipe handle: " + str(sw)); page.screenshot(path=str(shots / "sketch-layer-swipe.png"))
        tool(tools[2].split(":")[0] if tools else "Compare"); page.wait_for_timeout(800)
        check(page.evaluate("!document.querySelector('arcgis-swipe')"), "and again takes it off")

        print("== saved and opened again")
        js("#tool-save"); js("#saveTile"); page.wait_for_selector("#nameModal:not([hidden])"); page.fill("#fileNameInput", "sk")
        with page.expect_download() as dl: js("#nameConfirm")
        text = pathlib.Path(dl.value.path()).read_text(); saved = json.loads(text)
        ops = [o for o in saved["operationalLayers"] if str(o.get("id", "")).startswith("__sketch_")]
        check(len(ops) == 1 and abs(ops[0]["opacity"] - 0.6) < 0.001, "the file has the sketch layer at opacity 0.6")
        page.goto(f"{base}/index.html?config=mapmaker"); page.wait_for_function("document.querySelector('arcgis-map') && document.querySelector('arcgis-map').view && document.querySelector('arcgis-map').view.ready", timeout=120000); page.wait_for_timeout(1500)
        page.evaluate("""([name, text]) => { const dt = new DataTransfer(); dt.items.add(new File([text], name, { type: 'application/json' })); window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); }""", ["sk.amap", text])
        page.wait_for_function("document.querySelector('#toast').textContent.includes('sk')", timeout=120000); page.wait_for_timeout(1500)
        check(page.evaluate(LYR + ".graphics.length") == 2 and abs(page.evaluate(LYR + ".opacity") - 0.6) < 0.001, "opened again: two sketches, still 40% transparent")

        print("== delete all sketches")
        js("#tool-layers"); page.wait_for_selector("#layersPanel:not([hidden])"); page.wait_for_timeout(600)
        page.evaluate(LYR + ".visible = false"); n0 = len(dialogs); tool("Delete all sketches"); page.wait_for_timeout(800)
        check(len(dialogs) == n0 + 1 and "Delete all your sketches (2)?" in dialogs[-1], "it asks first: " + (dialogs[-1] if dialogs else ""))
        rows = page.evaluate(ROWS); check(page.evaluate(LYR + ".graphics.length") == 0 and "My sketches" not in rows, "the sketches are gone and so is the row: " + str(rows))
        check(page.evaluate(LYR + ".visible") is True and page.evaluate(LYR + ".opacity") == 1, "the empty layer is shown and solid again, ready for the next sketch")
        check(page.evaluate("document.activeElement.id") == "layersH", "focus goes to the panel heading")
        js("#tool-sketch"); page.wait_for_function(SK + ".state === 'ready' && !!" + SK + ".view", timeout=120000); page.wait_for_timeout(1500)
        js("#tool-layers"); page.wait_for_selector("#layersPanel:not([hidden])"); draw(420, 330); page.wait_for_timeout(600)
        rows = page.evaluate(ROWS); check("My sketches" in rows, "with Map layers open, drawing a sketch brings the row back: " + str(rows))

        print("== more than one sketch layer (config=lab)")
        MAPL = "document.querySelector('arcgis-map').view.map.layers"
        STACK = MAPL + ".toArray().map(l => l.id).reverse()"   # top first
        COUNTS = "Object.fromEntries(" + MAPL + ".toArray().filter(l => l.type === 'graphics' && String(l.id).startsWith('__sketch')).map(l => [l.title, l.graphics.length]))"
        PICK = "(() => { const s = document.querySelector('#skLayerPick'); return { hidden: document.querySelector('#skLayerRow').hidden, value: s.selectedOptions[0] ? s.selectedOptions[0].textContent : null, options: [...s.options].map(o => o.textContent) }; })()"
        def boot(config, extra=""):
            page.goto(f"{base}/index.html?config={config}{extra}")
            page.wait_for_function("document.querySelector('arcgis-map') && document.querySelector('arcgis-map').view && document.querySelector('arcgis-map').view.ready", timeout=120000); page.wait_for_timeout(1500)
        def sketch_on():
            if not page.is_visible("#sketchPanel"): js("#tool-sketch")
            page.wait_for_function(SK + ".state === 'ready' && !!" + SK + ".view", timeout=120000); page.wait_for_timeout(2000)
        boot("mapmaker"); js("#tool-add"); page.wait_for_selector("#addModal:not([hidden])")
        check(page.evaluate("document.querySelector('#tabSketchLayer').hidden") is True, "without the switch Add layer has no New sketch layer")
        js("#addModal [data-modal-close]"); sketch_on()
        check(page.evaluate(PICK)["hidden"] is True, "and Sketch has no layer picker")

        boot("lab", f"&webmap={QUAKES}")
        page.wait_for_function("document.querySelector('#layersBadge') && document.querySelector('#layersBadge').textContent === '1'", timeout=120000)
        sketch_on(); pk = page.evaluate(PICK)
        check(pk["hidden"] is False and pk["value"] == "My sketches" and pk["options"] == ["My sketches", "New sketch layer…"], "Sketch shows what it is drawing on: " + json.dumps(pk, ensure_ascii=False))
        draw(420, 330)
        js("#tool-add"); page.wait_for_selector("#addModal:not([hidden])")
        check(page.evaluate("document.querySelector('#tabSketchLayer').hidden") is False, "Add layer has a New sketch layer tab")
        js("#tabSketchLayer"); page.wait_for_selector("#paneSketchLayer:not([hidden])")
        check(page.input_value("#sketchLayerName") == "Sketches 2", "it suggests a name: " + page.input_value("#sketchLayerName"))
        axe("#addModal", "Add layer with the New sketch layer tab")
        page.fill("#sketchLayerName", "Rivers"); js("#sketchLayerCreate"); page.wait_for_timeout(1200)
        pk = page.evaluate(PICK)
        check(page.is_hidden("#addModal") and page.is_visible("#sketchPanel") and pk["value"] == "Rivers", "Create closes it and opens Sketch, drawing on the new layer: " + json.dumps(pk, ensure_ascii=False))
        sketch_on(); draw(520, 380); draw(600, 300)
        c = page.evaluate(COUNTS); check(c == {"My sketches": 1, "Rivers": 2}, "sketches go on the layer being drawn on: " + json.dumps(c))
        axe("#sketchPanel", "Sketch with the layer picker")
        # the picker's own New sketch layer…
        answer[0] = "Notes"; page.select_option("#skLayerPick", "__new"); page.wait_for_timeout(1000); pk = page.evaluate(PICK)
        check(pk["value"] == "Notes" and pk["options"] == ["My sketches", "Rivers", "Notes", "New sketch layer…"], "the picker can make one too: " + json.dumps(pk["options"], ensure_ascii=False))
        page.select_option("#skLayerPick", label="My sketches"); page.wait_for_timeout(800); draw(460, 420)
        c = page.evaluate(COUNTS); check(c == {"My sketches": 2, "Rivers": 2, "Notes": 0}, "switching back draws on the first layer again: " + json.dumps(c))

        print("== in Map layers")
        js("#tool-layers"); page.wait_for_selector("#layersPanel:not([hidden])"); page.wait_for_timeout(600)
        rows = page.evaluate(ROWS); check(rows == ["Notes", "Rivers", "My sketches", "Earthquakes (Major)"], "each sketch layer has a row, the empty one too: " + str(rows))
        def row_tools(name): return page.evaluate("(name) => { const li = [...document.querySelectorAll('#layersList > li.lyr')].find(li => li.querySelector('.li-title').textContent.trim() === name); return [...li.querySelectorAll('.lyr-tools button')].map(b => (b.getAttribute('aria-label') || '').split(':')[0]); }", name)
        def row_tool(name, label): page.evaluate("([name, label]) => { const li = [...document.querySelectorAll('#layersList > li.lyr')].find(li => li.querySelector('.li-title').textContent.trim() === name); [...li.querySelectorAll('.lyr-tools button')].find(b => (b.getAttribute('aria-label') || '').startsWith(label)).click(); }", [name, label]); page.wait_for_timeout(700)
        check(row_tools("Rivers") == ["Zoom to layer", "Adjust transparency", "Swipe", "Rename layer", "Remove layer"] and row_tools("My sketches")[-1] == "Delete all sketches", "a further layer can be renamed and removed; the first is emptied, not removed: " + str(row_tools("Rivers")))
        axe("#layersPanel", "Map layers with three sketch layers")
        answer[0] = "Rivers and lakes"; row_tool("Rivers", "Rename layer")
        check("Rivers and lakes" in page.evaluate(ROWS) and "Rivers and lakes" in page.evaluate(PICK)["options"], "Rename changes the row and the picker")
        # move it below the map's layer with the keyboard (two steps down)
        for _ in range(2):
            page.evaluate("(() => { const li = [...document.querySelectorAll('#layersList > li.lyr')].find(li => li.querySelector('.li-title').textContent.trim() === 'Rivers and lakes'); const h = li.querySelector('.lyr-drag'); h.focus(); h.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); })()"); page.wait_for_timeout(500)
        rows = page.evaluate(ROWS); check(rows == ["Notes", "My sketches", "Earthquakes (Major)", "Rivers and lakes"], "a sketch layer moves like any other, here to the bottom: " + str(rows))
        stack = page.evaluate(STACK); check([x for x in stack if x.startswith("__sketch")][-1] != "__sketch" and stack[-1].startswith("__sketch_L"), "and the map draws it under the map's layer: " + str(stack))
        page.screenshot(path=str(shots / "sketch-layers.png"))
        # a layer added now goes under the sketch layers that are on top, and above the one that was moved down
        page.evaluate("""([name, text]) => { const dt = new DataTransfer(); dt.items.add(new File([text], name, { type: 'text/csv' })); window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); }""", ["towns.csv", "Name,Latitude,Longitude\nA,10,100\nB,12,104\n"])
        page.wait_for_function("(() => { const e = document.querySelector('#dataSubmit'); return !!e && e.getClientRects().length > 0; })()", timeout=90000); page.wait_for_timeout(800)
        js("#dataSubmit"); page.wait_for_function("document.querySelector('#layersBadge').textContent === '2'", timeout=60000); page.wait_for_timeout(800)
        js("#tool-layers"); page.wait_for_selector("#layersPanel:not([hidden])"); page.wait_for_timeout(600)
        rows = page.evaluate(ROWS); check(rows == ["Notes", "My sketches", "towns", "Earthquakes (Major)", "Rivers and lakes"], "a layer added afterwards goes under the sketch layers on top: " + str(rows))

        print("== saved, and opened without the switch")
        js("#tool-save"); js("#saveTile"); page.wait_for_selector("#nameModal:not([hidden])"); page.fill("#fileNameInput", "three")
        with page.expect_download() as dl: js("#nameConfirm")
        text = pathlib.Path(dl.value.path()).read_text(); saved = json.loads(text)
        opids = [o["id"] for o in saved["operationalLayers"]]
        riv = [o for o in saved["operationalLayers"] if (o.get("atlasSketchLayer") or {}).get("title") == "Rivers and lakes"]
        check(len(riv) == 1 and opids.index(riv[0]["id"]) == 0 and opids[-1].endswith("_points") and "__sketch_points" in opids and opids.index("__data_" + [o for o in opids if o.startswith("__data_")][0][7:]) == 2, "the file has each sketch layer in its place: " + str([i[:22] for i in opids]))
        boot("mapmaker")
        page.evaluate("""([name, text]) => { const dt = new DataTransfer(); dt.items.add(new File([text], name, { type: 'application/json' })); window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); }""", ["three.amap", text])
        page.wait_for_function("document.querySelector('#toast').textContent.includes('three')", timeout=120000); page.wait_for_timeout(2500)
        c = page.evaluate(COUNTS); check(c == {"My sketches": 2, "Rivers and lakes": 2, "Notes": 0}, "opened again: the same layers and sketches: " + json.dumps(c))
        js("#tool-layers"); page.wait_for_selector("#layersPanel:not([hidden])"); page.wait_for_timeout(800)
        rows = page.evaluate(ROWS); check(rows == ["Notes", "My sketches", "towns", "Earthquakes (Major)", "Rivers and lakes"], "in the same order, the spreadsheet layer too: " + str(rows))
        sketch_on(); pk = page.evaluate(PICK)
        check(pk["hidden"] is False and pk["options"] == ["My sketches", "Rivers and lakes", "Notes"] or pk["options"] == ["My sketches", "Notes", "Rivers and lakes"], "a map with several sketch layers shows the picker even without the switch (no New…): " + json.dumps(pk, ensure_ascii=False))
        page.select_option("#skLayerPick", label="Rivers and lakes"); page.wait_for_timeout(800); draw(640, 430)
        c = page.evaluate(COUNTS); check(c["Rivers and lakes"] == 3, "and its layers can be drawn on")

        print("== remove a sketch layer")
        js("#tool-layers"); page.wait_for_selector("#layersPanel:not([hidden])"); page.wait_for_timeout(600)
        n0 = len(dialogs); row_tool("Rivers and lakes", "Remove layer")
        check(len(dialogs) == n0 + 1 and "Rivers and lakes" in dialogs[-1] and "(3)" in dialogs[-1], "it asks first, saying how many sketches go: " + dialogs[-1])
        c = page.evaluate(COUNTS); rows = page.evaluate(ROWS)
        check("Rivers and lakes" not in c and "Rivers and lakes" not in rows and c["My sketches"] == 2, "the layer and its sketches are gone; the others stay: " + json.dumps(c))
        n0 = len(dialogs); row_tool("Notes", "Remove layer")
        check(len(dialogs) == n0 and "Notes" not in page.evaluate(ROWS), "an empty one goes without asking")
        sketch_on(); pk = page.evaluate(PICK); check(pk["value"] == "My sketches" and pk["hidden"] is True, "Sketch is drawing on the first layer again, and the picker is gone")
        # Remove all layers keeps the sketches
        js("#tool-layers"); page.wait_for_selector("#layersPanel:not([hidden])"); page.wait_for_timeout(600)
        js("#layersRemoveAll"); page.wait_for_timeout(1000)
        check(page.evaluate(ROWS) == ["My sketches"] and "(2)" in dialogs[-1], "Remove all layers counts and removes the map's layers only: " + dialogs[-1][:40] + " → " + str(page.evaluate(ROWS)))
        check(not errors, "no script errors: " + "; ".join(errors[:3]))
        browser.close()
    print(f"\n{checks[0] - len(failures)}/{checks[0]} checks passed"); sys.exit(1 if failures else 0)

if __name__ == "__main__": main()
