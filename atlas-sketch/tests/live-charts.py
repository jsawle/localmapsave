"""Runs charts in Atlas 5.0 (atlas-sketch) in Chromium against the real services.

Run:  python3 atlas-sketch/tests/live-charts.py [--shots DIR] [--proxy URL] [--axe PATH]
Needs network access to js.arcgis.com, www.arcgis.com and the map's services, and Python Playwright with Chromium.
Uses the test content group's map "Real-Time Earthquakes with chart" (69874ffe9be341afbe2e93a51dbfc5c3).

Checks: opening a map that has a chart says so; in Map layers only the layer with a chart has a Chart button; the
button opens the chart under the map, drawn from the map author's set-up (its title, a scatter plot), with the
chart's own toolbar; the chart fills the dock; a selection made on the chart is highlighted on the map; the table
and the chart take turns in the dock; closing returns focus to the button; an accessibility scan.
"""
import argparse, functools, glob, http.server, json, math, os, pathlib, re, sys, threading
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
APP = HERE.parent
V = "document.querySelector('arcgis-map').view"
MAP = "69874ffe9be341afbe2e93a51dbfc5c3"
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
        ctx = browser.new_context(viewport={"width": 1366, "height": 900}); ctx.add_init_script("delete window.showSaveFilePicker; delete window.showOpenFilePicker;")   # saves become downloads the test can read
        page = ctx.new_page(); errors = []
        page.on("pageerror", lambda e: errors.append((getattr(e, "stack", "") or str(e))[:400])); page.on("dialog", lambda d: d.accept())
        def axe(sel, what):
            if not a.axe: return
            page.add_script_tag(path=a.axe)
            res = page.evaluate("async (sel) => { const r = await axe.run(sel, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }); return r.violations.map(v => v.id + ': ' + v.nodes.length + ' ' + (v.nodes[0] && v.nodes[0].target.join(' '))); }", sel)
            check(not res, what + " passes the accessibility scan" + (": " + "; ".join(res) if res else ""))
        toasts = []
        page.goto(f"{base}/index.html?config=test&webmap={MAP}")
        page.wait_for_function(V + " && " + V + ".ready && " + V + ".map.loaded && " + V + ".map.portalItem && " + V + ".map.portalItem.id === '" + MAP + "'", timeout=120000)
        for _ in range(12):
            toasts.append(page.inner_text("#toast")); page.wait_for_timeout(500)
        check(any("has a chart" in x for x in toasts), "opening the map says it has a chart and where to find it: " + next((x for x in toasts if "chart" in x), "")[:140])
        page.wait_for_timeout(3000)
        page.click("#tool-layers"); page.wait_for_selector("#layersPanel:not([hidden])", timeout=30000); page.wait_for_timeout(1500)
        page.evaluate("document.querySelectorAll('#layersPanel [aria-expanded=\"false\"]').forEach(b => { if (b.querySelector('calcite-icon[icon=\"chevron-right\"]')) b.click(); })"); page.wait_for_timeout(1200)
        btns = page.evaluate("[...document.querySelectorAll('#layersPanel [data-key$=\":chart\"]')].map(b => b.getAttribute('aria-label') || b.title)")
        check(len(btns) == 1 and "Events by Magnitude" in btns[0] and "Chart" in btns[0], "only the layer with a chart has a Chart button: " + json.dumps(btns))

        print("== the chart")
        page.evaluate("document.querySelector('#layersPanel [data-key$=\":chart\"]').click()"); page.wait_for_selector("#tableBody arcgis-chart", timeout=60000)
        try: page.wait_for_function(COUNT.replace("([sel, what]) =>", "(() => { const [sel, what] = ['#tableBody', 'canvas']; return (") + ")(null) > 0; })()" if False else "document.querySelector('#tableBody arcgis-chart') && (() => { let n = 0; const walk = (e) => { if (!e) return; if (e.tagName === 'CANVAS') n++; if (e.shadowRoot) walk(e.shadowRoot); for (const c of (e.children || [])) walk(c); }; walk(document.querySelector('#tableBody')); return n > 0; })()", timeout=90000)
        except Exception: pass
        page.wait_for_timeout(6000)
        st = page.evaluate("(() => { const c = document.querySelector('#tableBody arcgis-chart'), b = c.getBoundingClientRect(), d = document.getElementById('tableDock').getBoundingClientRect(); return { head: document.getElementById('tableH').textContent, type: c.model && c.model.series && c.model.series[0].type, layer: c.layer && c.layer.title, view: !!c.view, w: b.width, h: b.height, dw: d.width, dh: d.height, pick: !document.getElementById('chartPickWrap').hidden, pressed: document.querySelector('#layersPanel [data-key$=\":chart\"]').getAttribute('aria-pressed'), docked: document.getElementById('app').classList.contains('docked') }; })()")
        check(st["head"] == "Chart: Events by Magnitude" and st["type"] == "scatterSeries" and st["layer"] == "Events by Magnitude" and st["view"] and st["pressed"] == "true" and st["docked"], "the Chart button opens the layer's chart under the map, from the author's set-up: " + json.dumps({k: st[k] for k in ("head", "type", "pressed")}))
        check(st["w"] > st["dw"] - 30 and st["h"] > 200 and not st["pick"], "the chart fills the dock (%dx%d); with one chart there is no chooser" % (st["w"], st["h"]))
        txt = page.evaluate(DEEP, "#tableBody")
        check(page.evaluate(COUNT, ["#tableBody", "canvas"]) > 0, "the chart is drawn (a canvas)")
        check(page.evaluate(COUNT, ["#tableBody", "arcgis-charts-action-bar calcite-action, arcgis-charts-action-bar"]) > 0 and page.evaluate(COUNT, ["#tableBody", "calcite-action"]) >= 3, "with the chart's own toolbar: %d tools" % page.evaluate(COUNT, ["#tableBody", "calcite-action"]))
        page.screenshot(path=str(shots / "chart-earthquakes.png")); axe("#tableDock", "the chart dock")

        print("== making the dock taller and shorter")
        hgt = lambda: page.evaluate("Math.round(document.getElementById('tableDock').getBoundingClientRect().height)")
        maph = lambda: page.evaluate("Math.round(document.querySelector('arcgis-map').getBoundingClientRect().height)")
        chh = lambda: page.evaluate("Math.round(document.querySelector('#tableBody arcgis-chart').getBoundingClientRect().height)")
        h0, m0, c0 = hgt(), maph(), chh()
        g = page.evaluate("(() => { const b = document.querySelector('#tableDock .dock-grip').getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2, b.width, document.getElementById('tableDock').getBoundingClientRect().width]; })()")
        check(g[2] >= g[3] - 2, "the bar along the top of the dock runs its whole width")
        page.mouse.move(g[0], g[1]); page.mouse.down(); page.mouse.move(g[0], g[1] - 60, steps=4); page.mouse.move(g[0], g[1] - 150, steps=6); page.mouse.up(); page.wait_for_timeout(1200)
        h1, m1, c1 = hgt(), maph(), chh()
        check(abs((h1 - h0) - 150) <= 3 and abs((m0 - m1) - 150) <= 4 and c1 - c0 > 130, "dragging the bar up 150px makes the dock 150px taller, the chart with it, and the map shorter: dock %d to %d, chart %d to %d, map %d to %d" % (h0, h1, c0, c1, m0, m1))
        page.mouse.move(g[0], g[1] - 150); page.mouse.down(); page.mouse.move(g[0], g[1] + 900, steps=8); page.mouse.up(); page.wait_for_timeout(800)
        check(hgt() == 150, "it can't be made shorter than 150px: %d" % hgt())
        page.focus("#tableDock .dock-grip"); page.keyboard.press("ArrowUp"); page.keyboard.press("ArrowUp"); page.keyboard.press("PageUp"); page.wait_for_timeout(600)
        ar = page.evaluate("(() => { const s = document.querySelector('#tableDock .dock-grip'); return [s.getAttribute('role'), +s.getAttribute('aria-valuenow'), +s.getAttribute('aria-valuemin'), +s.getAttribute('aria-valuemax'), s.getAttribute('aria-valuetext'), s.getAttribute('aria-label')]; })()")
        check(hgt() == 290 and ar[0] == "separator" and ar[1] == 290 and ar[2] == 150 and "290" in ar[4] and "arrow keys" in ar[5], "with the keyboard: two Up arrows and a Page Up make it 140px taller, and the bar says its height: " + json.dumps(ar))
        page.keyboard.press("Home"); page.wait_for_timeout(600)
        check(hgt() == ar[3] and maph() >= 100, "Home makes it as tall as it can be, leaving some map: dock %d, map %d" % (hgt(), maph()))
        page.keyboard.press("PageDown"); page.keyboard.press("PageDown"); page.wait_for_timeout(600); kept = hgt()
        axe("#tableDock", "the dock with its resize bar")
        page.screenshot(path=str(shots / "chart-resized.png"))
        page.click("#tableClose"); page.wait_for_timeout(700)
        page.evaluate("document.querySelector('#layersPanel [data-key$=\":chart\"]').click()"); page.wait_for_selector("#tableBody arcgis-chart", timeout=60000); page.wait_for_timeout(2500)
        check(hgt() == kept, "closed and opened again, the chart is the height it was left at: %d" % hgt())
        g = page.evaluate("(() => { const b = document.querySelector('#tableDock .dock-grip').getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; })()")
        page.mouse.dblclick(g[0], g[1]); page.wait_for_timeout(800)
        check(abs(hgt() - h0) <= 2, "a double-click on the bar puts it back to its usual height: %d" % hgt())

        print("== chart and map share a selection")
        from PIL import Image, ImageChops
        import io
        mb = page.evaluate("(() => { const b = document.querySelector('arcgis-map').getBoundingClientRect(); return { x: b.left, y: b.top + 4, width: Math.min(b.width, 900), height: b.height - 30 }; })()")
        page.mouse.move(5, 5); page.wait_for_timeout(1500)
        before = Image.open(io.BytesIO(page.screenshot(clip=mb))).convert("RGB")
        again = Image.open(io.BytesIO(page.screenshot(clip=mb))).convert("RGB")
        noise = sum(1 for px in ImageChops.difference(before, again).getdata() if max(px) > 40)
        r = page.evaluate("""async () => { const c = document.querySelector('#tableBody arcgis-chart'), v = document.querySelector('arcgis-map').view;
          const lv = await v.whenLayerView(c.layer); const fs = await lv.queryFeatures({ geometry: v.extent, returnGeometry: false, outFields: [c.layer.objectIdField] });
          const ids = fs.features.slice(0, 12).map(f => f.attributes[c.layer.objectIdField]);
          c.selectionData = { selectionOIDs: ids }; await new Promise(r => setTimeout(r, 5000));
          const sel = c.selectionData && (c.selectionData.selectionOIDs || []);
          return { asked: ids.length, sel: (sel || []).length, sync: c.syncSelectionsBetweenChartAndLayerViewPolicy }; }""")
        after = Image.open(io.BytesIO(page.screenshot(clip=mb))).convert("RGB")
        changed = sum(1 for px in ImageChops.difference(before, after).getdata() if max(px) > 40)
        check(r["sel"] == r["asked"] and r["asked"] >= 3 and r["sync"] == "enabled", "earthquakes selected on the chart stay selected: " + json.dumps(r))
        check(changed > noise + 150, "and they are highlighted on the map: %d pixels of the map changed (%d between two pictures with nothing done)" % (changed, noise))
        page.screenshot(path=str(shots / "chart-selection.png"))

        print("== the dock takes turns")
        page.evaluate("document.querySelector('#layersPanel [data-key$=\":table\"]').click()"); page.wait_for_selector("#tableBody arcgis-feature-table", timeout=60000); page.wait_for_timeout(1500)
        check(page.evaluate("!document.querySelector('arcgis-chart')") and page.inner_text("#tableH").startswith("Table:") and page.evaluate("document.querySelector('#layersPanel [data-key$=\":chart\"]').getAttribute('aria-pressed')") == "false", "opening a table replaces the chart")
        page.evaluate("document.querySelector('#layersPanel [data-key$=\":chart\"]').click()"); page.wait_for_selector("#tableBody arcgis-chart", timeout=60000); page.wait_for_timeout(1500)
        check(page.evaluate("!document.querySelector('arcgis-feature-table')") and page.inner_text("#tableH").startswith("Chart:"), "and the chart replaces the table")
        page.click("#tableClose"); page.wait_for_timeout(900)
        check(page.is_hidden("#tableDock") and page.evaluate("!document.querySelector('arcgis-chart')") and page.evaluate("document.activeElement && document.activeElement.dataset.key || ''").endswith(":chart"), "Close takes the chart away and puts focus back on the Chart button")
        print("== saved and opened again")
        if not page.is_visible("#savePanel"): page.click("#tool-save")
        page.click("#saveTile"); page.wait_for_selector("#nameModal:not([hidden])"); page.fill("#fileNameInput", "quakes_chart")
        with page.expect_download() as dl: page.click("#nameConfirm")
        saved = json.loads(pathlib.Path(dl.value.path()).read_text())
        def layers(ls, out):
            for l in ls or []: out.append(l); layers(l.get("layers"), out)
            return out
        withc = [l for l in layers(saved.get("operationalLayers"), []) if l.get("charts")]
        check(len(withc) == 1 and withc[0]["charts"][0]["series"][0]["type"] == "scatterSeries" and "Depth and Magnitude" in json.dumps(withc[0]["charts"][0]["title"]), "the saved file keeps the layer's chart set-up")
        page.goto(f"{base}/index.html?config=test"); page.wait_for_function(V + " && " + V + ".ready", timeout=120000); page.wait_for_timeout(1500)
        page.evaluate("""([name, text]) => { const dt = new DataTransfer(); dt.items.add(new File([text], name, { type: 'application/json' })); window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); }""", ["quakes_chart.amap", json.dumps(saved)])
        page.wait_for_function(V + ".map.allLayers.some(l => l.title === 'Events by Magnitude')", timeout=90000); page.wait_for_timeout(4000)
        if page.is_hidden("#layersPanel"): page.click("#tool-layers")
        page.wait_for_timeout(1500); page.evaluate("document.querySelectorAll('#layersPanel [aria-expanded=\"false\"]').forEach(b => { if (b.querySelector('calcite-icon[icon=\"chevron-right\"]')) b.click(); })"); page.wait_for_timeout(1200)
        n = page.evaluate("document.querySelectorAll('#layersPanel [data-key$=\":chart\"]').length")
        check(n == 1, "opened from the file, the layer has its Chart button again")
        if n:
            page.evaluate("document.querySelector('#layersPanel [data-key$=\":chart\"]').click()"); page.wait_for_selector("#tableBody arcgis-chart", timeout=60000); page.wait_for_timeout(6000)
            check(page.evaluate(COUNT, ["#tableBody", "canvas"]) > 0, "and the chart is drawn")
        check(not errors, "no script errors" + (": " + " | ".join(errors[:2]) if errors else ""))
        browser.close()
    srv.shutdown()
    print(f"\n{checks[0] - len(failures)} of {checks[0]} checks passed")
    sys.exit(1 if failures else 0)

if __name__ == "__main__":
    main()
