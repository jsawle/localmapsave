"""Runs Sketch in 3D for Atlas 5.0 (atlas-sketch) in Chromium against the real services.

Run:  python3 atlas-sketch/tests/live-sketch3d.py [--shots DIR] [--proxy URL] [--axe FILE]
Needs network access to js.arcgis.com and www.arcgis.com, and Python Playwright with Chromium.

Checks: in the 3D view of a map the Sketch toolbar offers the same drawing tools as in 2D; a point, a line, an area
and text are drawn with the pointer; they lie on the ground, are there in 2D too, and are saved (as flat shapes) and
come back; in a web scene a sketch is drawn, saved in the scene file and comes back.
"""
import argparse, functools, glob, http.server, json, os, pathlib, sys, threading
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
APP = HERE.parent
SCENE = "94e00add11334767afb0abdce49c9a43"   # Rotterdam, the Netherlands Scene (esri_3d): every layer public
SK = "document.querySelector('arcgis-sketch')"
TOOLS = "(() => { const out = []; const walk = (r) => { for (const el of r.querySelectorAll('*')) { if (el.tagName === 'CALCITE-ACTION' && el.offsetParent !== null) out.push(el.text || el.label || ''); if (el.shadowRoot) walk(el.shadowRoot); } }; walk(" + SK + ".shadowRoot || " + SK + "); return out; })()"
SKETCHES = "(() => { const s = document.querySelector('arcgis-scene'), m = document.querySelector('arcgis-map'); const v = (s && !document.querySelector('#sceneDiv').hidden) ? s.view : m.view; const l = v.map.layers.find(x => x.id === '__sketch'); return l ? l.graphics.map(g => ({ kind: g.attributes && g.attributes.kind, type: g.geometry.type, title: g.attributes && g.attributes.title, sym: g.symbol && g.symbol.type })).toArray() : null; })()"
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
        ctx = browser.new_context(viewport={"width": 1000, "height": 700})
        ctx.add_init_script("delete window.showSaveFilePicker; delete window.showOpenFilePicker;")   # saves become downloads the test can read
        # The test browser draws 3D in software (see live-3d-data.py): the scene comes without its 3D buildings and
        # with its camera looking straight down from 30 km.
        def lighter(route):
            r = route.fetch(); j = r.json()
            if isinstance(j.get("operationalLayers"), list): j["operationalLayers"] = [l for l in j["operationalLayers"] if l.get("layerType") != "ArcGISSceneServiceLayer"]
            cam = ((j.get("initialState") or {}).get("viewpoint") or {}).get("camera")
            if cam: cam["position"] = {"x": 4.4777, "y": 51.9144, "z": 30000, "spatialReference": {"wkid": 4326}}; cam["tilt"] = 0; cam["heading"] = 0
            route.fulfill(response=r, json=j)
        ctx.route(lambda u: f"/content/items/{SCENE}/data" in u, lighter)
        page = ctx.new_page(); errors = []
        page.on("pageerror", lambda e: errors.append(str(e)[:300]))
        page.on("dialog", lambda d: d.accept())
        def wf(expr, arg=None, timeout=120000):   # checked on a timer: the software-drawn 3D view gives a frame or two a second
            try: return page.wait_for_function(expr, arg=arg, timeout=timeout, polling=500)
            except Exception: print("  (timed out waiting for: " + expr[:120] + ")", flush=True); raise
        def jsclick(sel): page.evaluate("(s) => document.querySelector(s).click()", sel)
        def open_sketch(kind):
            if not page.evaluate("!document.querySelector('#sketchPanel').hidden"): jsclick("#tool-sketch")
            wf(SK + ".state === 'ready' && !!" + SK + ".view && " + SK + ".view.type === '" + kind + "'"); page.wait_for_timeout(3000)
        def start(tool):
            r = page.evaluate("async (t) => { try { await " + SK + ".create(t); return 'ok'; } catch (e) { return String(e && e.message || e); } }", tool)
            page.wait_for_timeout(3000); return r
        def tap(x, y): page.mouse.move(x, y); page.wait_for_timeout(2000); page.mouse.click(x, y); page.wait_for_timeout(3000)
        def finish():   # ends drawing or editing, as choosing another tool does
            page.evaluate("(() => { const s = " + SK + "; try { if (s.state === 'active') { if (s.createGraphic) s.cancel(); else s.complete(); } } catch (e) {} })()"); page.wait_for_timeout(2500)
        def count(n, timeout=40000):
            try: wf("n => { const a = " + SKETCHES + "; return !!a && a.length === n; }", arg=n, timeout=timeout); return True
            except Exception: return False
        def save_map(name):
            if not page.evaluate("!document.querySelector('#savePanel').hidden"): jsclick("#tool-save")
            page.wait_for_timeout(800); jsclick("#saveTile"); wf("!document.querySelector('#nameModal').hidden"); page.fill("#fileNameInput", name)
            with page.expect_download() as dl: jsclick("#nameConfirm")
            return json.loads(pathlib.Path(dl.value.path()).read_text())
        def drop(name, text):
            page.evaluate("""([name, text]) => { const dt = new DataTransfer(); dt.items.add(new File([text], name, { type: 'application/json' })); window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); }""", [name, text])
        def to_3d():
            jsclick("#tg3d"); wf("(() => { const s = document.querySelector('arcgis-scene'); return !!(s && s.view && s.view.ready) && document.querySelector('#tg3d').getAttribute('aria-pressed') === 'true'; })()"); page.wait_for_timeout(12000)

        print("== Sketch in the 3D view of a map")
        page.goto(f"{base}/index.html?config=mapmaker")
        wf("document.querySelector('arcgis-map') && document.querySelector('arcgis-map').view && document.querySelector('arcgis-map').view.ready")
        open_sketch("2d"); tools2d = page.evaluate(TOOLS)
        jsclick("#tool-sketch"); page.wait_for_timeout(1000)
        to_3d(); open_sketch("3d"); tools3d = page.evaluate(TOOLS)
        draw = lambda ts: sorted({w for t in ts for w in ["point", "polyline", "polygon", "rectangle", "circle", "text"] if w in t.lower()})
        check(draw(tools3d) == draw(tools2d) == ["circle", "point", "polygon", "polyline", "rectangle", "text"], "the 3D toolbar offers the same drawing tools as 2D: " + ", ".join(draw(tools3d)))
        if a.axe:
            page.add_script_tag(path=a.axe); v = page.evaluate(AXE)
            check(not v, "Sketch panel in 3D: no WCAG 2.1 A/AA violations (axe-core): " + "; ".join(v))
        start("point"); tap(500, 300)
        check(count(1) and page.evaluate(SKETCHES)[0]["kind"] == "point", "a point is drawn with one click")
        finish()
        start("polyline"); tap(300, 200); tap(450, 220); page.mouse.move(540, 200); page.wait_for_timeout(1500); page.mouse.dblclick(540, 200); page.wait_for_timeout(4000)
        check(count(2) and page.evaluate(SKETCHES)[1]["kind"] == "polyline", "a line: click, click, double-click to finish")
        finish()
        start("polygon"); tap(350, 380); tap(550, 380); tap(550, 480); page.mouse.move(350, 480); page.wait_for_timeout(1500); page.mouse.dblclick(350, 480); page.wait_for_timeout(4000)
        check(count(3) and page.evaluate(SKETCHES)[2]["kind"] == "polygon", "an area: three clicks and a double-click")
        finish()
        start("text"); tap(380, 300); page.wait_for_timeout(3000)
        got_text = count(4, timeout=20000)
        sk = page.evaluate(SKETCHES)
        check(got_text and sk[3]["kind"] == "text", "text is placed with one click" + ("" if got_text else " (no text was made; sketches: " + json.dumps(sk) + ")"))
        page.wait_for_timeout(1500)
        check(page.evaluate("document.activeElement && document.activeElement.id") == "fTitle", "and the Title box is ready for its words")
        page.keyboard.type("Hello 3D", delay=60); page.wait_for_timeout(800)
        sk = page.evaluate(SKETCHES)
        check(len(sk) == 4 and sk[3]["title"] == "Hello 3D" and sk[3]["sym"] == "text", "typing there changes the text on the globe: " + str(sk[3]["title"] if len(sk) == 4 else sk))
        finish(); n3d = len(page.evaluate(SKETCHES))
        info = page.evaluate("(() => { const v = document.querySelector('arcgis-scene').view, l = v.map.layers.find(x => x.id === '__sketch'); return { elev: l.elevationInfo && l.elevationInfo.mode, z: l.graphics.map(g => { const j = g.geometry.toJSON(); const c = j.rings ? j.rings[0][0] : j.paths ? j.paths[0][0] : [j.x, j.y, j.z || 0]; return c[2] || 0; }).toArray() }; })()")
        check(info["elev"] == "on-the-ground" and all(abs(z) < 0.001 for z in info["z"]), "the sketches lie on the ground (no heights of their own)")
        page.wait_for_timeout(3000); page.screenshot(path=str(shots / "3d-sketch.png"))
        saved = save_map("sketch_3d")
        ops = [o for o in saved["operationalLayers"] if str(o.get("id", "")).startswith("__sketch_")]
        feats = [f for o in ops for l in o["featureCollection"]["layers"] for f in l["featureSet"]["features"]]
        flat = all(("z" not in f["geometry"]) and all(len(c) == 2 for part in (f["geometry"].get("rings") or f["geometry"].get("paths") or []) for c in part) for f in feats)
        check(len(feats) == n3d and flat and "viewingMode" not in saved, f"the saved web map holds the {n3d} sketches as flat shapes")
        jsclick("#tg2d"); wf("document.querySelector('#tg2d').getAttribute('aria-pressed') === 'true'"); page.wait_for_timeout(2000)
        check(len(page.evaluate(SKETCHES)) == n3d, "back in 2D the same sketches are on the map")
        page.screenshot(path=str(shots / "3d-sketch-in-2d.png"))
        page.goto(f"{base}/index.html?config=mapmaker"); wf("document.querySelector('arcgis-map') && document.querySelector('arcgis-map').view && document.querySelector('arcgis-map').view.ready"); page.wait_for_timeout(1500)
        drop("sketch_3d.amap", json.dumps(saved)); wf("document.querySelector('#toast').textContent.includes('sketch 3d')")
        check(count(n3d), "and they come back from the file")

        print("== Sketch in a web scene")
        page.goto(f"{base}/index.html?config=mapmaker&webscene={SCENE}")
        wf("(() => { const s = document.querySelector('arcgis-scene'); return !!(s && s.view && s.view.ready && s.view.map.declaredClass === 'esri.WebScene') && document.querySelector('#tg2d').getAttribute('aria-disabled') === 'true'; })()", timeout=180000)
        page.wait_for_timeout(10000)
        open_sketch("3d")
        start("point"); tap(500, 300); ok1 = count(1); finish()
        start("polygon"); tap(350, 380); tap(550, 380); tap(550, 480); page.mouse.move(350, 480); page.wait_for_timeout(1500); page.mouse.dblclick(350, 480); page.wait_for_timeout(4000)
        ok2 = count(2); finish()
        check(ok1 and ok2, "a point and an area are drawn in the scene: " + json.dumps([s["kind"] for s in page.evaluate(SKETCHES)]))
        page.wait_for_timeout(3000); page.screenshot(path=str(shots / "scene-sketch.png"))
        scene = save_map("scene_sketch")
        ops = [o for o in scene["operationalLayers"] if str(o.get("id", "")).startswith("__sketch_")]
        nf = sum(len(l["featureSet"]["features"]) for o in ops for l in o["featureCollection"]["layers"])
        check(scene.get("viewingMode") == "global" and nf == 2, f"the scene file holds them ({nf} features in {len(ops)} sketch layers)")
        page.goto(f"{base}/index.html?config=mapmaker"); wf("document.querySelector('arcgis-map') && document.querySelector('arcgis-map').view && document.querySelector('arcgis-map').view.ready"); page.wait_for_timeout(1500)
        drop("scene_sketch.amap", json.dumps(scene)); wf("document.querySelector('#toast').textContent.includes('scene sketch')", timeout=180000)
        wf("(() => { const s = document.querySelector('arcgis-scene'); return !!(s && s.view && s.view.ready); })()")
        check(count(2), "and they come back when the scene file is opened")
        real = [e for e in errors if "ResizeObserver" not in e]
        check(not real, "no script errors: " + " | ".join(real[:3]))
        browser.close()
    print(f"{checks[0] - len(failures)}/{checks[0]} checks passed")
    sys.exit(1 if failures else 0)

if __name__ == "__main__":
    main()
