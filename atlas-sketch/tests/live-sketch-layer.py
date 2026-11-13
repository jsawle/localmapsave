#!/usr/bin/env python3
"""Live check: the sketch layer in Map layers. It is listed only when there are sketches, and has transparency,
compare (2D) and delete-all like other layers; its transparency is kept in a saved file.

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
        page.on("dialog", lambda d: (dialogs.append(d.message), d.accept()))
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
        check(not errors, "no script errors: " + "; ".join(errors[:3]))
        browser.close()
    print(f"\n{checks[0] - len(failures)}/{checks[0]} checks passed"); sys.exit(1 if failures else 0)

if __name__ == "__main__": main()
