"""Runs filtering and spreadsheet data in 3D for Atlas 5.0 (atlas-sketch) in Chromium against the real services.

Run:  python3 atlas-sketch/tests/live-3d-data.py [--shots DIR] [--proxy URL] [--axe FILE]
Needs network access to js.arcgis.com and www.arcgis.com, and Python Playwright with Chromium.

Checks: a layer's filter in the 3D view of a web map (the globe follows a typed value without Apply, Cancel puts
it back, Apply keeps it in 3D and in 2D); a spreadsheet added while in 3D is drawn on the globe, can be filtered,
and is saved; a spreadsheet added to a web scene is saved in the scene file and comes back, with its filter.
"""
import argparse, functools, glob, http.server, io, json, os, pathlib, sys, threading
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
APP = HERE.parent
QUAKES = "85997c9571e74256af71dc20566b47f1"
SCENE = "94e00add11334767afb0abdce49c9a43"   # Rotterdam, the Netherlands Scene (esri_3d): every layer public
CSV = "Site,Latitude,Longitude,Area,Plastic,Glass,Metal\nMarket St,32.7115,-117.1601,Street,12,3,4\nIsland Ave,32.7098,-117.1585,Park,5,8,2\nJ St,32.7076,-117.1612,Street,9,1,7\nK St,32.7066,-117.1590,Park,2,2,1\n"
CSV_NL = "Site,Latitude,Longitude,Plastic\nErasmusbrug,51.9093,4.4868,12\nMarkthal,51.9200,4.4869,5\nEuromast,51.9054,4.4666,9\nCentraal,51.9244,4.4690,2\n"
AXE = "axe.run('#filterPanel', { runOnly: ['wcag2a','wcag2aa','wcag21a','wcag21aa'] }).then(r => r.violations.map(v => v.id + ': ' + v.nodes.map(n => n.target.join(' ')).slice(0,3).join(', ')))"

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
        ctx.add_init_script("delete window.showSaveFilePicker; delete window.showOpenFilePicker;")   # saves become downloads the test can read
        # The test browser draws 3D in software. A city seen at an angle from close by takes it about three seconds a
        # frame, and nothing else in the page gets a turn. So, on its way to the app, the scene's 3D buildings are left
        # out (as in live-scenes.py) and its opening camera is lifted to look straight down from 30 km.
        def lighter(route):
            r = route.fetch(); j = r.json()
            if isinstance(j.get("operationalLayers"), list): j["operationalLayers"] = [l for l in j["operationalLayers"] if l.get("layerType") != "ArcGISSceneServiceLayer"]
            cam = ((j.get("initialState") or {}).get("viewpoint") or {}).get("camera")
            if cam: cam["position"] = {"x": 4.4777, "y": 51.9144, "z": 30000, "spatialReference": {"wkid": 4326}}; cam["tilt"] = 0; cam["heading"] = 0
            route.fulfill(response=r, json=j)
        ctx.route(lambda u: f"/content/items/{SCENE}/data" in u, lighter)
        ctx.add_init_script("""window.addEventListener('unhandledrejection', (e) => { const r = e.reason || {}; console.error('UNHANDLED ' + [String(r.name), String(r.message).slice(0, 200), String(r.stack || '').slice(0, 600), JSON.stringify(r.details || null).slice(0, 200)].join(' | ')); });""")
        page = ctx.new_page(); errors = []
        page.on("pageerror", lambda e: errors.append((str(e) + " @ " + str(getattr(e, "stack", "") or "")).replace("\n", " ")[:700]))
        page.on("dialog", lambda d: d.accept())
        rejs = []; page.on("console", lambda m: rejs.append(m.text[:900]) if m.text.startswith("UNHANDLED") else None)
        # The test browser draws 3D in software, at a frame or two a second. Playwright's own waits check once a frame,
        # so these check on a timer instead.
        def wf(expr, arg=None, timeout=90000):
            try: return page.wait_for_function(expr, arg=arg, timeout=timeout, polling=500)
            except Exception: print("  (timed out waiting for: " + expr[:110] + (" | " + str(arg) if arg else "") + ")", flush=True); raise
        def wv(sel, timeout=90000): return wf("s => { const e = document.querySelector(s); return !!e && e.getClientRects().length > 0; }", arg=sel, timeout=timeout)
        def click(sel):   # in 3D the software-drawn view can leave no idle frame for a pointer click; then the element's own click
            try: page.click(sel, timeout=8000)
            except Exception: page.evaluate("(s) => document.querySelector(s).click()", sel)
        def select(part, value, card=0):
            page.evaluate("""([part, value, card]) => { const s = document.querySelectorAll('#filterConds .flt-cond')[card].querySelector('[data-part="' + part + '"]'); s.value = value; s.dispatchEvent(new CustomEvent('calciteSelectChange')); }""", [part, value, card])
            page.wait_for_timeout(600)
        def type_number(value, card=0, part="value"):
            page.evaluate("""([value, card, part]) => { const n = document.querySelectorAll('#filterConds .flt-cond')[card].querySelector('[data-part="' + part + '"]'); n.value = value; n.dispatchEvent(new CustomEvent('calciteInputNumberInput')); }""", [value, card, part])
        def val(part, card=0):
            return page.evaluate("""([part, card]) => { const c = document.querySelectorAll('#filterConds .flt-cond')[card]; const e = c && c.querySelector('[data-part="' + part + '"]'); return e ? String(e.value ?? '') : null; }""", [part, card])
        def count_is(text, timeout=90000):
            try: wf("t => document.querySelector('#filterCount').textContent.includes(t)", arg=text, timeout=timeout); return True
            except Exception: return False
        def count(): return page.inner_text("#filterCount")
        def open_layers():
            if not page.is_visible("#layersPanel"): click("#tool-layers")
            wv('#layersList [data-key$=":filter"]', timeout=90000)
        def open_filter():
            open_layers(); page.evaluate("document.querySelector('#layersList [data-key$=\":filter\"]').click()")
            wv("#filterPanel:not([hidden]) .flt-cond", timeout=90000)
        def filter_on(): return "on" in (page.locator('#layersList [data-key$=":filter"]').first.get_attribute("class") or "").split()
        def save_map(name):
            if not page.is_visible("#savePanel"): click("#tool-save")
            click("#saveTile"); wv("#nameModal:not([hidden])"); page.fill("#fileNameInput", name)
            with page.expect_download() as dl: click("#nameConfirm")
            return json.loads(pathlib.Path(dl.value.path()).read_text())
        def drop(name, text, mime):
            page.evaluate("""([name, text, mime]) => { const dt = new DataTransfer(); dt.items.add(new File([text], name, { type: mime })); window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); }""", [name, text, mime])
        def orange():
            from PIL import Image
            im = Image.open(io.BytesIO(page.screenshot(clip={"x": 60, "y": 80, "width": 900, "height": 560}))).convert("RGB")
            return sum(1 for r, g, b in im.get_flattened_data() if r > 200 and 120 < g < 200 and b < 70)
        def to_3d():
            click("#tg3d")
            wf("(() => { const s = document.querySelector('arcgis-scene'); return !!(s && s.view && s.view.ready) && document.querySelector('#tg3d').getAttribute('aria-pressed') === 'true'; })()", timeout=120000)
        # features the 3D view holds for a layer, and how many of them its filter lets through
        DRAWN = """async (prefix) => { const v = document.querySelector('arcgis-scene').view; const l = v.map.layers.find(x => String(x.id).startsWith(prefix) || x.title === prefix); if (!l) return null;
          const lv = await v.whenLayerView(l); await new Promise(r => { const t = setInterval(() => { if (!lv.updating) { clearInterval(t); r(); } }, 200); setTimeout(() => { clearInterval(t); r(); }, 20000); });
          const q = lv.filter ? lv.filter.createQuery() : lv.createQuery(); return { held: await lv.queryFeatureCount(), shown: await lv.queryFeatureCount(q), expr: l.definitionExpression || '', elev: l.elevationInfo ? l.elevationInfo.mode : null, type: lv.declaredClass }; }"""

        def drawn(prefix, want=None, tries=20):   # asks until the 3D view holds the number of features expected
            d = None
            for _ in range(tries):
                d = page.evaluate(DRAWN, prefix)
                if want is None or (d and d["held"] == want): break
                page.wait_for_timeout(2000)
            return d
        print("== a web map's layer filtered in 3D")
        page.goto(f"{base}/index.html?config=mapmaker&webmap={QUAKES}")
        wf("document.querySelector('#layersBadge') && document.querySelector('#layersBadge').textContent === '1'", timeout=120000)
        to_3d(); page.wait_for_timeout(12000)
        open_filter()
        check(count_is("Showing all 949 features"), "in 3D the Filter panel opens on the layer: " + count())
        wv("#filterConds arcgis-slider", timeout=90000); page.wait_for_timeout(4000)
        before = orange(); d0 = page.evaluate(DRAWN, "Earthquakes (Major)")
        select("field", "mag"); wv("#filterConds arcgis-slider arcgis-histogram", timeout=90000)
        type_number("8")
        check(count_is(" of 949") and "all" not in count(), "Magnitude is at least 8: " + count())
        page.wait_for_timeout(6000); after = orange(); d1 = page.evaluate(DRAWN, "Earthquakes (Major)")
        check(d1 and d0 and d1["shown"] < d0["shown"] * 0.5 and d1["shown"] > 0, f"the 3D view's own filter lets through fewer features without Apply ({d0['shown']} -> {d1['shown']} of {d1['held']} held)")
        check(before > 300 and after < before * 0.6, f"and the globe shows it (earthquake-coloured pixels {before} -> {after})")
        page.screenshot(path=str(shots / "3d-filter.png"))
        if a.axe:
            page.add_script_tag(path=a.axe); v = page.evaluate(AXE)
            check(not v, "Filter panel in 3D: no WCAG 2.1 A/AA violations (axe-core): " + "; ".join(v))
        click("#filterCancel"); wv("#layersPanel:not([hidden])"); page.wait_for_timeout(4000)
        d2 = page.evaluate(DRAWN, "Earthquakes (Major)")
        check(not filter_on() and d2["shown"] == d2["held"] and d2["expr"] == "", f"Cancel puts every feature back ({d2['shown']} of {d2['held']})")
        open_filter(); select("field", "mag"); wv("#filterConds arcgis-slider", timeout=90000); type_number("8"); count_is(" of 949")
        click("#filterApply"); wv("#layersPanel:not([hidden])"); page.wait_for_timeout(5000)
        d3 = page.evaluate(DRAWN, "Earthquakes (Major)")
        check(filter_on() and d3["expr"] == "mag >= 8" and d3["held"] < d0["held"], f"Apply keeps the filter on the layer in 3D ({d3['expr']}; the view now holds {d3['held']})")
        click("#tg2d"); wf("document.querySelector('#tg2d').getAttribute('aria-pressed') === 'true'", timeout=60000); page.wait_for_timeout(1500)
        open_layers(); check(filter_on(), "back in 2D the layer is still filtered")
        saved = save_map("quakes_3d_filter")
        op = next(o for o in saved["operationalLayers"] if o.get("title") == "Earthquakes (Major)")
        check((op.get("layerDefinition") or {}).get("definitionExpression") == "mag >= 8", "and the saved map holds it")

        print("== a spreadsheet added in 3D")
        click("#tool-open"); click("#newMapBtn"); page.wait_for_timeout(1500)
        to_3d(); page.wait_for_timeout(5000)
        drop("litter.csv", CSV, "text/csv")
        wv("#dataPanel:not([hidden]) #dataSubmit", timeout=90000); page.wait_for_timeout(1500); click("#dataSubmit")
        wf("document.querySelector('#layersBadge').textContent === '1'", timeout=90000); page.wait_for_timeout(6000)
        c0 = drawn("__data_", 4)
        check(c0 and c0["held"] == 4, f"its 4 rows are drawn by the 3D view: {c0}")
        check(c0 and c0["elev"] == "on-the-ground", "they are set to sit on the ground: " + str(c0 and c0["elev"]))
        try: wf("(() => { const v = document.querySelector('arcgis-scene').view; return Math.abs(v.center.longitude + 117.16) < 0.05 && v.camera.position.z < 200000; })()", timeout=90000)
        except Exception: pass
        cam = page.evaluate("(() => { const v = document.querySelector('arcgis-scene').view, c = v.camera; return [v.center.longitude, v.center.latitude, c.position.z]; })()")
        check(abs(cam[0] + 117.16) < 1 and abs(cam[1] - 32.71) < 1 and cam[2] < 200000, "the view goes to the new layer (looking at %.2f, %.2f from %.0f m up)" % tuple(cam))
        page.screenshot(path=str(shots / "3d-csv.png"))
        open_filter(); select("field", "Plastic"); wv("#filterConds arcgis-slider", timeout=90000); type_number("9")
        check(count_is("Showing 2 of 4 features"), "Plastic is at least 9: " + count())
        page.wait_for_timeout(3000); c1 = page.evaluate(DRAWN, "__data_")
        check(c1["shown"] == 2, f"the 3D view shows 2 of the 4 without Apply: {c1['shown']}")
        click("#filterApply"); wv("#layersPanel:not([hidden])")
        csvmap = save_map("litter_3d")
        own = next(o for o in csvmap["operationalLayers"] if str(o.get("id", "")).startswith("__data_"))
        check("viewingMode" not in csvmap and own["featureCollection"]["layers"][0]["layerDefinition"].get("definitionExpression") == "Plastic >= 9" and len(own["featureCollection"]["layers"][0]["featureSet"]["features"]) == 4, "saved as a web map, with the filter and all 4 rows")

        print("== a spreadsheet added to a web scene")
        page.goto(f"{base}/index.html?config=mapmaker&webscene={SCENE}")
        wf("(() => { const s = document.querySelector('arcgis-scene'); return !!(s && s.view && s.view.ready && s.view.map.declaredClass === 'esri.WebScene') && document.querySelector('#tg2d').getAttribute('aria-disabled') === 'true'; })()", timeout=180000)
        page.wait_for_timeout(8000)
        drop("rotterdam.csv", CSV_NL, "text/csv")
        wv("#dataPanel:not([hidden]) #dataSubmit", timeout=90000); page.wait_for_timeout(1500); click("#dataSubmit")
        wf("document.querySelector('#layersBadge') && Number(document.querySelector('#layersBadge').textContent) >= 1 && !!document.querySelector('arcgis-scene').view.map.layers.find(l => String(l.id).startsWith('__data_'))", timeout=90000); page.wait_for_timeout(6000)
        s0 = drawn("__data_", 4)
        check(s0 and s0["held"] == 4, f"its 4 rows are drawn in the scene: {s0}")
        page.screenshot(path=str(shots / "scene-csv.png"))
        open_filter(); select("field", "Plastic"); wv("#filterConds arcgis-slider", timeout=90000); type_number("9")
        check(count_is("Showing 2 of 4 features"), "it can be filtered in the scene: " + count())
        click("#filterApply"); wv("#layersPanel:not([hidden])")
        scene = save_map("rotterdam_data")
        own = [o for o in scene["operationalLayers"] if str(o.get("id", "")).startswith("__data_")]
        check(scene.get("viewingMode") == "global" and len(own) == 1 and own[0]["featureCollection"]["layers"][0]["layerDefinition"].get("definitionExpression") == "Plastic >= 9", "the scene file holds the spreadsheet layer and its filter")
        page.goto(f"{base}/index.html?config=mapmaker"); wf("document.querySelector('arcgis-map') && document.querySelector('arcgis-map').view && document.querySelector('arcgis-map').view.ready", timeout=120000); page.wait_for_timeout(1500)
        drop("rotterdam_data.amap", json.dumps(scene), "application/json")
        wf("document.querySelector('#toast').textContent.includes('rotterdam data')", timeout=180000); page.wait_for_timeout(8000)
        s1 = drawn("__data_", 2)
        check(s1 and s1["expr"] == "Plastic >= 9" and s1["held"] == 2, f"opened again, the layer is back in the scene with its filter: {s1}")
        open_filter()
        ok_count = count_is("Showing 2 of 4 features")
        try: wf("""() => { const s = document.querySelector('#filterConds .flt-cond [data-part="field"]'); return !!s && s.value === 'Plastic'; }""", timeout=30000)   # the select fills in once it has drawn
        except Exception: pass
        got = [val("field"), val("op"), val("value")]
        check(ok_count and got == ["Plastic", "atLeast", "9"], "and the Filter panel shows the condition: " + str(got) + ", " + count())
        click("#filterCancel")
        if rejs: print("  (promise rejections nobody handled: " + " ;; ".join(rejs[:4]) + ")")
        real = [e for e in errors if "ResizeObserver" not in e]
        check(not real, "no script errors: " + " | ".join(real[:3]))
        browser.close()
    print(f"{checks[0] - len(failures)}/{checks[0]} checks passed")
    sys.exit(1 if failures else 0)

if __name__ == "__main__":
    main()
