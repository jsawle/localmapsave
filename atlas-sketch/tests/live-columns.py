#!/usr/bin/env python3
"""Live check: Columns in 3D (lab, config=lab). A spreadsheet sized by a number column can stand a column on each
point in the 3D view; 2D, and the saved style, stay as they were. Without the switch (config=mapmaker) it isn't offered.

  python3 live-columns.py [--shots DIR] [--axe path/to/axe.min.js]
"""
import argparse, functools, glob, http.server, json, os, pathlib, sys, threading
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent; APP = HERE.parent
CSV = ("Site,Latitude,Longitude,Area,Fast Food wrappers,Bottles,Cans\n"
       "Market St,32.7115,-117.1601,Street,12,3,1\nIsland Ave,32.7098,-117.1585,Park,5,8,2\nJ St,32.7076,-117.1612,Street,9,1,3\n"
       "K St,32.7066,-117.1590,Park,2,2,4\nG St,32.7127,-117.1570,Street,20,6,5\nHarbor Dr,32.7060,-117.1640,Park,0,4,6\n")
AXE = "(sel) => axe.run(sel, { runOnly: ['wcag2a','wcag2aa','wcag21a','wcag21aa'] }).then(r => r.violations.map(v => v.id + ': ' + v.nodes.map(n => n.target.join(' ')).slice(0,3).join(', ')))"
LAYER = "(() => { const s = document.querySelector('arcgis-scene'), m = document.querySelector('arcgis-map'); const v = (s && !document.querySelector('#sceneDiv').hidden) ? s.view : m.view; return v.map.layers.toArray().filter(l => String(l.id).startsWith(PFX))[0]; })()"
REND = "(() => { const l = " + LAYER + "; if (!l) return null; const r = l.renderer, sym = r.symbol || (r.uniqueValueInfos && r.uniqueValueInfos[0] && r.uniqueValueInfos[0].symbol) || {}; const sl = sym.symbolLayers && sym.symbolLayers.getItemAt(0); const h = (r.visualVariables || []).find(v => v.type === 'size' && v.axis === 'height'); return { type: r.type, sym: sym.type, prim: sl && sl.resource && sl.resource.primitive, width: sl && sl.width, color: sl && sl.material && sl.material.color && sl.material.color.toHex(), field: h && h.field, stops: h && h.stops && h.stops.map(s => [s.value, s.size]) }; })()"

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
        page.on("pageerror", lambda e: errors.append((str(e) + " @ " + str(getattr(e, "stack", "") or "")).replace("\n", " ")[:900]))
        page.on("dialog", lambda d: d.accept())
        def wf(expr, arg=None, timeout=120000): return page.wait_for_function(expr, arg=arg, timeout=timeout, polling=500)
        def wv(sel, timeout=90000): return wf("s => { const e = document.querySelector(s); return !!e && e.getClientRects().length > 0; }", arg=sel, timeout=timeout)
        def js(sel): page.evaluate("(s) => document.querySelector(s).click()", sel)
        def rend(pfx): return page.evaluate(REND.replace("PFX", json.dumps(pfx)))
        def drop(name, text):
            page.evaluate("""([name, text]) => { const dt = new DataTransfer(); dt.items.add(new File([text], name, { type: 'text/csv' })); window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); }""", [name, text])
        def mark(w): print(f"  .. {w}: {len(errors)} errors", flush=True)
        def start(config):
            page.goto(f"{base}/index.html?config={config}")
            wf("document.querySelector('arcgis-map') && document.querySelector('arcgis-map').view && document.querySelector('arcgis-map').view.ready"); page.wait_for_timeout(1500)
        def to_3d():
            js("#tg3d"); wf("(() => { const s = document.querySelector('arcgis-scene'); return !!(s && s.view && s.view.ready) && document.querySelector('#tg3d').getAttribute('aria-pressed') === 'true'; })()", timeout=180000); page.wait_for_timeout(4000)
        def style(sid):
            page.evaluate("(i) => document.querySelectorAll('#styleList .style-card')[i].click()", ["simple", "categorical", "graduated", "numeric_color_size", "categorical_size", "pie_chart"].index(sid)); page.wait_for_timeout(400)

        print("== without the switch (config=mapmaker)")
        start("mapmaker"); drop("litter.csv", CSV); wv("#dataPanel:not([hidden]) #dataSubmit"); page.wait_for_timeout(800); style("graduated")
        check(page.evaluate("!document.querySelector('#columns3dBox')"), "By size has no columns choice")
        style("numeric_color_size"); page.wait_for_timeout(600)
        RAMP = "(() => { const l = " + LAYER.replace("PFX", json.dumps("csvPreview")) + " || " + LAYER.replace("PFX", json.dumps("__data_csvPreview")) + "; const v = l && (l.renderer.visualVariables || []).find(x => x.type === 'color'); return v ? v.stops.map(s => s.color.toHex()) : null; })()"
        check(page.evaluate("!document.querySelector('#rampRevRow').hidden && !document.querySelector('#rampReverse').checked"), "Color & size has Reverse colours, off to start")
        page.wait_for_timeout(1200); c0 = page.evaluate(RAMP); bg0 = page.evaluate("document.querySelector('#rampList .ramp-btn').style.background")
        js("#rampReverse"); page.wait_for_timeout(1500); c1 = page.evaluate(RAMP); bg1 = page.evaluate("document.querySelector('#rampList .ramp-btn').style.background")
        check(bool(c0) and bool(c1) and c1 == c0[::-1], f"ticked, the preview's colours run the other way ({c0[0]}…{c0[-1]} → {c1[0]}…{c1[-1]})")
        check(bg0 != bg1 and "270deg" in bg1, "and the ramp buttons show it")
        if a.axe:
            page.add_script_tag(path=a.axe); v = page.evaluate(AXE, "#dataPanel"); check(not v, "the panel with Reverse colours: no WCAG 2.1 A/AA violations (axe-core): " + "; ".join(v))
        style("graduated"); check(page.evaluate("document.querySelector('#rampRevRow').hidden"), "By size has no Reverse colours (no ramp)")
        PIE = "(() => { const b = document.querySelectorAll('#styleList .style-card')[5]; return [b.disabled, b.title]; })()"
        pie = page.evaluate(PIE); check(pie[0] is False, "in 2D Pie charts is offered")
        js("#tg3d"); wf("document.querySelector('#tg3d').getAttribute('aria-pressed') === 'true'", timeout=180000); page.wait_for_timeout(1500)
        pie = page.evaluate(PIE); check(pie[0] is True and "2D" in pie[1], "in 3D Pie charts is greyed out, with the reason: " + pie[1])
        js("#tg2d"); wf("document.querySelector('#tg2d').getAttribute('aria-pressed') === 'true'"); page.wait_for_timeout(1000)
        check(page.evaluate(PIE)[0] is False, "back in 2D, with the panel still open, it is offered again")

        print("== with it (config=lab)")
        start("lab"); drop("litter.csv", CSV); wv("#dataPanel:not([hidden]) #dataSubmit"); page.wait_for_timeout(800); style("graduated")
        check(page.evaluate("!document.querySelector('#columns3dBox')"), "in 2D the columns choice isn't shown")
        js("#tg3d"); wf("(() => { const s = document.querySelector('arcgis-scene'); return !!(s && s.view && s.view.ready) && document.querySelector('#tg3d').getAttribute('aria-pressed') === 'true'; })()", timeout=180000); page.wait_for_timeout(1500)
        check(page.evaluate("!!document.querySelector('#columns3dBox')"), "switching to 3D with the panel open shows it")
        # the switch keeps the place: every point of the spreadsheet is still on screen, seen at an angle
        try: wf("document.querySelector('arcgis-scene').view.camera.tilt > 50 && !document.querySelector('arcgis-scene').view.interacting && !document.querySelector('arcgis-scene').view.animation", timeout=60000)
        except Exception: pass
        # wait until the camera has stopped (the same for 3 seconds)
        last = None
        for _ in range(20):
            page.wait_for_timeout(3000); cur = page.evaluate("(() => { const c = document.querySelector('arcgis-scene').view.camera; return [c.position.latitude.toFixed(5), c.position.z.toFixed(0), c.tilt.toFixed(1)].join(); })()")
            if cur == last: break
            last = cur
        on = page.evaluate("""async (pts) => { const Point = await $arcgis.import("@arcgis/core/geometry/Point.js"); const v = document.querySelector('arcgis-scene').view; return { tilt: v.camera.tilt, lat: v.center.latitude, lon: v.center.longitude,
          on: pts.filter(([lon, lat]) => { const s = v.toScreen(new Point({ longitude: lon, latitude: lat })); return s && s.x > 0 && s.x < v.width && s.y > 0 && s.y < v.height; }).length }; }""",
          [[-117.1601, 32.7115], [-117.1585, 32.7098], [-117.1612, 32.7076], [-117.1590, 32.7066], [-117.1570, 32.7127], [-117.1640, 32.7060]])
        check(on["on"] == 6 and on["tilt"] > 50 and abs(on["lat"] - 32.7094) < 0.006 and abs(on["lon"] + 117.1605) < 0.006, "the switch to 3D keeps the place: %d of 6 points on screen, tilt %.0f°, looking at %.4f, %.4f" % (on["on"], on["tilt"], on["lat"], on["lon"]))
        page.wait_for_timeout(15000); page.screenshot(path=str(shots / "switch-3d.png"))
        start("lab"); to_3d()
        drop("litter.csv", CSV); wv("#dataPanel:not([hidden]) #dataSubmit"); page.wait_for_timeout(1500)
        TILT = "document.querySelector('arcgis-scene').view.camera.tilt"
        try: wf("document.querySelector('arcgis-scene').view.camera.tilt > 40 && Math.abs(document.querySelector('arcgis-scene').view.center.longitude + 117.16) < 0.05", timeout=60000)
        except Exception: pass
        tilt = page.evaluate(TILT); check(50 < tilt < 60, "the 3D view goes to the dropped points at an angle (tilt %.0f°)" % tilt)
        mark("3d + drop"); style("simple"); check(page.evaluate("!document.querySelector('#columns3dBox')"), "Locations has no columns choice (no number to show)")
        style("graduated"); check(page.evaluate("!!document.querySelector('#columns3dBox') && !document.querySelector('#columns3dBox').checked"), "By size offers 'Show as columns in 3D', off to start")
        page.evaluate("(() => { const s = document.querySelector('#fieldRows select'); s.value = [...s.options].find(o => o.textContent === 'Fast Food wrappers').value; s.dispatchEvent(new Event('change')); })()")
        js("#columns3dBox"); page.wait_for_timeout(2500)
        r = rend("csvPreview") or rend("__data_csvPreview")
        check(bool(r) and r["sym"] == "point-3d" and r["prim"] == "cylinder" and r["color"] == "#0079c1", "the preview is drawn as blue columns: " + json.dumps(r))
        w12 = r["width"]; h12 = r["stops"][1][1]
        page.evaluate("(() => { const s = document.querySelector('#dataSize'); s.value = 24; s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true })); })()"); page.wait_for_timeout(2500)
        r24 = rend("csvPreview") or rend("__data_csvPreview")
        check(bool(r24) and abs(r24["width"] / w12 - 2) < 0.01 and r24["stops"][1][1] == h12, "the Size slider at 24 makes the columns twice as thick, the same height (%.0f m → %.0f m)" % (w12, r24["width"]))
        page.evaluate("(() => { const s = document.querySelector('#dataSize'); s.value = 12; s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true })); })()"); page.wait_for_timeout(2500)
        if a.axe:
            page.add_script_tag(path=a.axe); v = page.evaluate(AXE, "#dataPanel"); check(not v, "the panel with the choice: no WCAG 2.1 A/AA violations (axe-core): " + "; ".join(v))
        page.screenshot(path=str(shots / "columns-panel.png"))
        mark("preview"); js("#dataSubmit"); wf("document.querySelector('#layersBadge').textContent === '1'"); page.wait_for_timeout(1500); mark("added")
        r = rend("__data_")
        check(bool(r) and r["prim"] == "cylinder" and r["field"] == "Fast_Food_wrappers" or (r and r["prim"] == "cylinder" and "wrappers" in str(r["field"])), "on the map the layer is columns, height by the chosen column: " + json.dumps(r))
        st = r["stops"]; check(st[0][0] == 0 and st[0][1] < 3 and st[1][0] == 20 and 60 < st[1][1] < 400 and 5 < r["width"] < 40, "height runs from zero to the top value (20 → %.0f m tall, %.0f m wide)" % (st[1][1], r["width"]))
        # look at them from the side
        page.evaluate("""(() => { const v = document.querySelector('arcgis-scene').view; const c = v.camera.clone(); c.position = { x: -117.1600, y: 32.6985, z: 700, spatialReference: { wkid: 4326 } }; c.heading = 0; c.tilt = 62; return v.goTo(c, { animate: false }); })()""")
        page.wait_for_timeout(20000); page.screenshot(path=str(shots / "columns-3d.png"))

        js("#tool-legend"); wv("#legendPanel:not([hidden])"); page.wait_for_timeout(6000); page.screenshot(path=str(shots / "columns-legend.png"))
        # the legend is looked at in the screenshot: its text is inside the component and isn't read here
        mark("after columns"); print("== type and size")
        js("#tool-layers"); wv("#layersPanel:not([hidden])"); page.evaluate("document.querySelector('#layersList [data-style-for]').click()"); wv("#dataPanel:not([hidden]) #dataSubmit"); page.wait_for_timeout(1000)
        check(page.evaluate("document.querySelector('#columns3dBox') && document.querySelector('#columns3dBox').checked"), "Change style shows the choice still ticked")
        style("categorical_size"); js("#columns3dBox") if not page.evaluate("document.querySelector('#columns3dBox').checked") else None
        js("#dataSubmit"); page.wait_for_timeout(2500); r = rend("__data_")
        check(bool(r) and r["type"] == "unique-value" and r["prim"] == "cylinder" and r["color"] != "#ffffff", "Type & size: columns coloured by type: " + json.dumps(r))
        page.wait_for_timeout(15000); page.screenshot(path=str(shots / "columns-3d-type.png"))

        mark("after type"); print("== 2D and saving")
        js("#tg2d"); wf("document.querySelector('#tg2d').getAttribute('aria-pressed') === 'true'"); page.wait_for_timeout(1500); r2 = rend("__data_")
        check(bool(r2) and r2["sym"] == "simple-marker", "in 2D the points are ordinary sized markers: " + json.dumps(r2)); page.screenshot(path=str(shots / "columns-2d.png"))
        js("#tool-save"); js("#saveTile"); wv("#nameModal:not([hidden])"); page.fill("#fileNameInput", "cols")
        with page.expect_download() as dl: js("#nameConfirm")
        saved = json.loads(pathlib.Path(dl.value.path()).read_text())
        own = next(o for o in saved["operationalLayers"] if str(o.get("id", "")).startswith("__data_"))
        dr = own["featureCollection"]["layers"][0]["layerDefinition"]["drawingInfo"]["renderer"]
        check(dr["type"] == "uniqueValue" and dr["defaultSymbol"]["type"] == "esriSMS" and own.get("atlasColumns3d") is True, "the saved map holds the 2D style (no 3D symbols in a web map) and notes the columns")
        mark("after save"); to_3d(); r = rend("__data_"); check(bool(r) and r["prim"] == "cylinder", "back in 3D the columns return"); mark("end")
        print("== saved in 3D, opened again")
        page.evaluate("(() => { const v = document.querySelector('arcgis-scene').view; const c = v.camera.clone(); c.position = { x: -117.1600, y: 32.6985, z: 700, spatialReference: { wkid: 4326 } }; c.heading = 0; c.tilt = 62; return v.goTo(c, { animate: false }); })()"); page.wait_for_timeout(3000)
        js("#tool-save"); js("#saveTile"); wv("#nameModal:not([hidden])"); page.fill("#fileNameInput", "cols3d")
        with page.expect_download() as dl: js("#nameConfirm")
        text3d = pathlib.Path(dl.value.path()).read_text(); saved3d = json.loads(text3d)
        own = next(o for o in saved3d["operationalLayers"] if str(o.get("id", "")).startswith("__data_"))
        check(own.get("atlasColumns3d") is True and abs(saved3d.get("atlas3d", {}).get("camera", {}).get("tilt", 0) - 62) < 1 and "viewingMode" not in saved3d, "the file is a web map that notes the 3D view (tilt 62°) and the layer's columns")
        check("atlas3d" not in saved, "the copy saved from 2D has no 3D view noted")
        def reopen(config, text):
            start(config)
            page.evaluate("""([name, text]) => { const dt = new DataTransfer(); dt.items.add(new File([text], name, { type: 'application/json' })); window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); }""", ["cols3d.amap", text])
            wf("document.querySelector('#toast').textContent.includes('cols3d')", timeout=120000)
        reopen("lab", text3d)
        wf("document.querySelector('#tg3d').getAttribute('aria-pressed') === 'true' && !!document.querySelector('arcgis-scene') && !!document.querySelector('arcgis-scene').view.camera", timeout=180000)
        try: wf("Math.abs(document.querySelector('arcgis-scene').view.camera.tilt - 62) < 2 && Math.abs(document.querySelector('arcgis-scene').view.camera.position.latitude - 32.6985) < 0.002", timeout=60000)
        except Exception: pass
        cam = page.evaluate("(() => { const c = document.querySelector('arcgis-scene').view.camera; return [c.position.longitude, c.position.latitude, c.position.z, c.tilt]; })()")
        check(abs(cam[0] + 117.16) < 0.002 and abs(cam[1] - 32.6985) < 0.002 and abs(cam[2] - 700) < 60 and abs(cam[3] - 62) < 2, "it opens in 3D, seen from where it was saved (%.4f, %.4f, %.0f m, tilt %.0f°)" % tuple(cam))
        r = rend("__data_"); check(bool(r) and r["prim"] == "cylinder" and r["type"] == "unique-value", "and the layer is columns again: " + json.dumps(r)[:120])
        DRAWN = """async () => { const v = document.querySelector('arcgis-scene').view; const l = v.map.layers.toArray().find(l => String(l.id).startsWith('__data_'));
          const lv = await Promise.race([v.whenLayerView(l), new Promise(r => setTimeout(() => r(null), 20000))]); if (!lv) return { n: -1 };
          let n = -2; try { n = (await lv.queryFeatures()).features.length; } catch (e) { n = String(e.message); }
          return { n, vis: l.visible, lvVisible: lv.visible, suspended: lv.suspended, updating: lv.updating }; }"""
        d = None
        for _ in range(12):
            d = page.evaluate(DRAWN)
            if d.get("n") == 6: break
            page.wait_for_timeout(5000)
        check(d.get("n") == 6 and d.get("vis") and not d.get("suspended"), "the 3D view is drawing its 6 columns: " + json.dumps(d))
        page.wait_for_timeout(15000); page.screenshot(path=str(shots / "columns-reopened.png"))
        reopen("lab", json.dumps(saved))
        page.wait_for_timeout(2500); check(page.evaluate("document.querySelector('#tg2d').getAttribute('aria-pressed') === 'true'"), "the copy saved from 2D opens in 2D")
        to_3d(); r = rend("__data_"); check(bool(r) and r["prim"] == "cylinder", "its columns are kept too: switch to 3D and they are there")
        reopen("mapmaker", text3d)
        wf("document.querySelector('#tg3d').getAttribute('aria-pressed') === 'true' && !!document.querySelector('arcgis-scene')", timeout=180000); page.wait_for_timeout(2500)
        r = rend("__data_"); check(bool(r) and r["sym"] == "simple-marker", "without the lab switch the file still opens in 3D, with ordinary sized points")
        start("lab"); to_3d()

        print("== Cancel puts the 3D view back")
        js("#tool-open"); wv("#newMapBtn"); js("#newMapBtn"); page.wait_for_timeout(2500)
        page.evaluate("(() => { const v = document.querySelector('arcgis-scene').view; const c = v.camera.clone(); c.position = { x: -117.16, y: 32.71, z: 3000, spatialReference: { wkid: 4326 } }; c.tilt = 0; c.heading = 0; return v.goTo(c, { animate: false }); })()"); page.wait_for_timeout(2500)
        drop("litter.csv", CSV); wv("#dataPanel:not([hidden]) #dataSubmit")
        try: wf(TILT + " > 40", timeout=60000)
        except Exception: pass
        t1 = page.evaluate(TILT); js("#dataCancel")
        try: wf(TILT + " < 5", timeout=60000)
        except Exception: pass
        t2 = page.evaluate(TILT); check(t1 > 40 and t2 < 5, "tilted for the preview (%.0f°), straight down again after Cancel (%.0f°)" % (t1, t2))
        page.evaluate("(() => { const v = document.querySelector('arcgis-scene').view; const c = v.camera.clone(); c.tilt = 30; return v.goTo(c, { animate: false }); })()"); page.wait_for_timeout(2500)
        drop("litter.csv", CSV); wv("#dataPanel:not([hidden]) #dataSubmit"); page.wait_for_timeout(6000)
        t3 = page.evaluate(TILT); check(25 < t3 < 35, "a tilt already set is kept (30° → %.0f°)" % t3); js("#dataCancel"); page.wait_for_timeout(1000)
        # Known before this feature: replacing the preview layer in the 3D view raises an error whose whole message is "n"
        # (it happens with columns never switched on). It is reported here, not counted against columns.
        known = [e for e in errors if e.split(" @")[0].strip() == "n"]; real = [e for e in errors if e not in known]
        if known: print(f"  note {len(known)} 'n' error(s) from the 3D preview (known)")
        check(not real, "no other script errors: " + "; ".join(real[:3]))
        browser.close()
    print(f"\n{checks[0] - len(failures)}/{checks[0]} checks passed"); sys.exit(1 if failures else 0)

if __name__ == "__main__": main()
