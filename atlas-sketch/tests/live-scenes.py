"""Runs the 3D scene work of Atlas 5.0 (atlas-sketch) in Chromium against the real services.

Run:  python3 atlas-sketch/tests/live-scenes.py [--shots DIR] [--proxy URL] [--axe FILE]
Needs network access to js.arcgis.com and www.arcgis.com, and Python Playwright with Chromium.

Checks: the views are the SDK's map and scene components; a web scene opens from a link (webscene=<id>) in 3D and
can't be switched to 2D; its slides are the bookmarks; it saves as a web scene and reopens from the file; a web map
tagged atlas-2d-only can't be switched to 3D, and its saved copy keeps that; scenes are listed in Open map, marked 3D,
and Share copies a webscene link. The collection has no scene and no tagged map yet, so those two are made by
changing the services' answers on their way to the app.
"""
import argparse, functools, glob, http.server, json, os, pathlib, sys, threading
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
APP = HERE.parent
QUAKES = "85997c9571e74256af71dc20566b47f1"
SCENE = "94e00add11334767afb0abdce49c9a43"   # Rotterdam, the Netherlands Scene (esri_3d): 3 slides, every layer public
SLIDES = 3
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
        checks[0] += 1; print(("  ok   " if cond else "  FAIL ") + msg)
        if not cond: failures.append(msg)
    with sync_playwright() as p:
        launch = {"args": ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]}
        if chrome: launch["executable_path"] = chrome
        if a.proxy: launch["proxy"] = {"server": a.proxy, "bypass": "localhost,127.0.0.1"}
        browser = p.chromium.launch(**launch)
        ctx = browser.new_context(viewport={"width": 1366, "height": 768}, permissions=["clipboard-read", "clipboard-write"])
        ctx.add_init_script("delete window.showSaveFilePicker; delete window.showOpenFilePicker;")   # saves become downloads the test can read
        page = ctx.new_page(); errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("dialog", lambda d: d.accept())
        def axe(sel, what):
            if not a.axe: return
            if not page.evaluate("typeof axe !== 'undefined'"): page.add_script_tag(path=a.axe)
            v = page.evaluate(AXE, sel); check(not v, what + ": no WCAG 2.1 A/AA violations (axe-core): " + "; ".join(v))
        MODE = "({ p2: document.querySelector('#tg2d').getAttribute('aria-pressed'), p3: document.querySelector('#tg3d').getAttribute('aria-pressed'), d2: document.querySelector('#tg2d').getAttribute('aria-disabled'), d3: document.querySelector('#tg3d').getAttribute('aria-disabled'), sceneShown: !document.querySelector('#sceneDiv').hidden, mapShown: !document.querySelector('#viewDiv').hidden })"
        SCENE_READY = "(() => { const s = document.querySelector('arcgis-scene'); return !!(s && s.view && s.view.ready && s.view.map && s.view.map.declaredClass === 'esri.WebScene' && s.view.map.loaded); })()"
        CAM = "(() => { const c = document.querySelector('arcgis-scene').view.camera; return { x: c.position.longitude, y: c.position.latitude, z: c.position.z, heading: c.heading, tilt: c.tilt }; })()"
        def toast(): return page.inner_text("#toast")
        def click(sel):
            # While the test browser draws 3D in software there may be no idle frame for a pointer click; then the
            # element's own click is used.
            try: page.click(sel, timeout=8000)
            except Exception: page.evaluate("(s) => document.querySelector(s).click()", sel)
        def save_map(name):
            if not page.is_visible("#savePanel"): click("#tool-save")
            click("#saveTile"); page.wait_for_selector("#nameModal:not([hidden])"); page.fill("#fileNameInput", name)
            with page.expect_download() as dl: click("#nameConfirm")
            return json.loads(pathlib.Path(dl.value.path()).read_text())
        def drop(name, text):
            page.evaluate("""([name, text]) => { const dt = new DataTransfer(); dt.items.add(new File([text], name, { type: 'application/json' })); window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); }""", [name, text])
        def bm_titles():
            if not page.is_visible("#bookmarksPanel"): click("#tool-bookmarks")
            page.wait_for_selector("#bookmarksPanel:not([hidden])")
            return page.evaluate("[...document.querySelectorAll('#bmList .bm-title')].map(e => e.textContent)")

        print("== the views are SDK components")
        page.goto(f"{base}/index.html?config=mapmaker&webmap={QUAKES}")
        page.wait_for_function("document.querySelector('#layersBadge') && document.querySelector('#layersBadge').textContent === '1'", timeout=120000)
        check(page.inner_text("#verBtn").startswith("v5.0.0-beta.2"), "the app is " + page.inner_text("#verBtn"))
        info = page.evaluate("(() => { const m = document.querySelector('#viewDiv arcgis-map'); return { map: !!(m && m.view && m.view.declaredClass === 'esri.views.MapView'), kids: [...m.children].map(c => c.tagName.toLowerCase() + ':' + c.slot), scenes: document.querySelectorAll('arcgis-scene').length }; })()")
        check(info["map"], "the 2D view is an arcgis-map component")
        check(all(k in info["kids"] for k in ["arcgis-expand:top-left", "arcgis-home:top-left", "arcgis-zoom:top-left"]) and page.evaluate("!!document.querySelector('arcgis-map arcgis-expand arcgis-search') && !!document.querySelector('arcgis-map arcgis-scale-bar')"), "Search, Home, Zoom and the scale bar are components in its slots: " + ", ".join(info["kids"]))
        check(info["scenes"] == 0, "the 3D view isn't made until it's asked for")
        st = page.evaluate(MODE); check(st["d2"] is None and st["d3"] is None, "an ordinary web map can be shown in 2D and 3D")
        page.wait_for_timeout(1500); axe("arcgis-map", "the map and its controls")
        page.click("#tg3d"); page.wait_for_function("document.querySelector('arcgis-scene') && document.querySelector('arcgis-scene').view && document.querySelector('arcgis-scene').view.ready", timeout=120000)
        check(page.evaluate("document.querySelector('#sceneDiv arcgis-scene').view.declaredClass") == "esri.views.SceneView" and page.evaluate("!!document.querySelector('arcgis-scene arcgis-navigation-toggle[slot=top-left]')"), "3D is an arcgis-scene component, with the navigation toggle")

        # The test browser draws 3D in software, and a city's 3D buildings keep it too busy to take clicks in time. So the
        # scene's 3D building layers are taken out of the item's data on its way to the app; its other layers, ground,
        # camera and slides are the real ones.
        def lighter(route):
            r = route.fetch(); j = r.json()
            if isinstance(j.get("operationalLayers"), list): j["operationalLayers"] = [l for l in j["operationalLayers"] if l.get("layerType") != "ArcGISSceneServiceLayer"]
            route.fulfill(response=r, json=j)
        ctx.route(lambda u: f"/content/items/{SCENE}/data" in u, lighter)
        print("== a web scene from a link (webscene=)")
        page.goto(f"{base}/index.html?config=mapmaker&webscene={SCENE}")
        page.wait_for_function(SCENE_READY, timeout=180000)
        page.wait_for_function("document.querySelector('#docTitle').value.includes('Rotterdam')", timeout=60000)
        st = page.evaluate(MODE)
        check(st["p3"] == "true" and st["sceneShown"] and not st["mapShown"], "it opens in 3D: " + page.input_value("#docTitle"))
        check(st["d2"] == "true" and "3D scene" in (page.get_attribute("#tg2d", "title") or ""), "2D is marked unavailable, with the reason: " + str(page.get_attribute("#tg2d", "title")))
        page.click("#tg2d", force=True); page.wait_for_timeout(800); st = page.evaluate(MODE)
        check(st["p3"] == "true" and st["sceneShown"] and "3D scene" in toast(), "choosing 2D leaves it in 3D and says why: " + toast())
        axe("#toolbar", "the toolbar with 2D unavailable")
        page.wait_for_timeout(6000); page.screenshot(path=str(shots / "scene-open.png"))
        titles = bm_titles()
        check(len(titles) == SLIDES, f"the scene's {SLIDES} slides are the bookmarks: " + "; ".join(titles))
        before = page.evaluate(CAM)
        page.evaluate("document.querySelectorAll('#bmList .bm-go')[1].click()"); page.wait_for_timeout(5000); after = page.evaluate(CAM)
        check(abs(after["x"] - before["x"]) + abs(after["y"] - before["y"]) + abs(after["heading"] - before["heading"]) + abs(after["tilt"] - before["tilt"]) > 0.001, "a bookmark moves the camera (heading %.0f, tilt %.0f)" % (after["heading"], after["tilt"]))
        click("#bmAddBtn"); page.fill("#bmTitleInput", "My view"); click("#bmSave"); page.wait_for_timeout(500)
        check(bm_titles()[-1] == "My view" and len(bm_titles()) == SLIDES + 1, "a bookmark can be added in the scene")
        page.keyboard.press("Escape")

        print("== both in one link")
        page2 = ctx.new_page(); page2.goto(f"{base}/index.html?config=mapmaker&webmap={QUAKES}&webscene={SCENE}")
        page2.wait_for_function(SCENE_READY, timeout=180000)
        check("Rotterdam" in page2.input_value("#docTitle") or page2.wait_for_function("document.querySelector('#docTitle').value.includes('Rotterdam')", timeout=60000) is not None, "with webmap and webscene in the link, the scene opens")
        page2.close()

        print("== saved as a web scene, and opened again")
        cam = page.evaluate(CAM)
        saved = save_map("rotterdam_scene")
        check(saved.get("viewingMode") == "global" and isinstance(saved.get("ground"), dict) and saved.get("version") == "1.40", "the file is a web scene: viewingMode %s, version %s" % (saved.get("viewingMode"), saved.get("version")))
        check("bookmarks" not in saved and len(saved.get("presentation", {}).get("slides", [])) == SLIDES + 1 and all("camera" in s["viewpoint"] for s in saved["presentation"]["slides"]), "its bookmarks are slides, each with a camera")
        c = saved.get("initialState", {}).get("viewpoint", {}).get("camera", {})
        check(abs(c.get("tilt", -1) - cam["tilt"]) < 0.5 and abs(c.get("heading", -1) - cam["heading"]) < 0.5, "the camera is saved (tilt %.1f, heading %.1f)" % (c.get("tilt", -1), c.get("heading", -1)))
        check(len(saved["operationalLayers"]) >= 1 and "lighting" in saved["initialState"].get("environment", {}), "the scene's layers and lighting are in the file (%d layers)" % len(saved["operationalLayers"]))
        page.goto(f"{base}/index.html?config=mapmaker"); page.wait_for_function("document.querySelector('arcgis-map') && document.querySelector('arcgis-map').view && document.querySelector('arcgis-map').view.ready", timeout=120000)
        page.wait_for_timeout(1500)
        drop("rotterdam_scene.amap", json.dumps(saved))
        page.wait_for_function("document.querySelector('#toast').textContent.includes('rotterdam scene')", timeout=180000)
        page.wait_for_function(SCENE_READY, timeout=120000)
        st = page.evaluate(MODE)
        check(st["p3"] == "true" and st["d2"] == "true" and st["sceneShown"], "the file opens in 3D, 2D unavailable")
        page.wait_for_timeout(4000); back = page.evaluate(CAM)
        check(abs(back["tilt"] - cam["tilt"]) < 1 and abs(back["heading"] - cam["heading"]) < 1 and abs(back["x"] - cam["x"]) < 0.01 and abs(back["y"] - cam["y"]) < 0.01, "the camera is where it was left (tilt %.1f, heading %.1f)" % (back["tilt"], back["heading"]))
        titles = bm_titles()
        check(len(titles) == SLIDES + 1 and titles[-1] == "My view", "the bookmarks are back: " + "; ".join(titles))
        n_layers = page.evaluate("document.querySelector('arcgis-scene').view.map.layers.filter(l => l.id !== '__sketch').length")
        check(n_layers >= 1, "and the scene's layers (%d)" % n_layers)
        page.keyboard.press("Escape")
        page.screenshot(path=str(shots / "scene-reopened.png"))

        print("== a web map tagged atlas-2d-only")
        def add_tag(route):
            r = route.fetch(); j = r.json(); j["tags"] = (j.get("tags") or []) + ["Atlas-2D-Only"]
            route.fulfill(response=r, json=j)
        page.route(lambda u: f"/content/items/{QUAKES}?" in u, add_tag)
        page.goto(f"{base}/index.html?config=mapmaker&webmap={QUAKES}")
        page.wait_for_function("document.querySelector('#layersBadge') && document.querySelector('#layersBadge').textContent === '1'", timeout=120000)
        page.wait_for_timeout(1000); st = page.evaluate(MODE)
        check(st["p2"] == "true" and st["d3"] == "true" and "2D only" in (page.get_attribute("#tg3d", "title") or ""), "3D is marked unavailable (the tag is matched whatever its capitals): " + str(page.get_attribute("#tg3d", "title")))
        page.click("#tg3d", force=True); page.wait_for_timeout(800); st = page.evaluate(MODE)
        check(st["p2"] == "true" and st["mapShown"] and "2D only" in toast() and page.evaluate("document.querySelectorAll('arcgis-scene').length") == 0, "choosing 3D leaves it in 2D and says why: " + toast())
        saved2 = save_map("quakes_2d")
        check(saved2.get("atlas2dOnly") is True and "viewingMode" not in saved2, "the saved copy is a web map that stays 2D only")
        page.unroute(lambda u: f"/content/items/{QUAKES}?" in u)
        page.goto(f"{base}/index.html?config=mapmaker"); page.wait_for_function("document.querySelector('arcgis-map') && document.querySelector('arcgis-map').view && document.querySelector('arcgis-map').view.ready", timeout=120000)
        page.wait_for_timeout(1500)
        drop("quakes_2d.amap", json.dumps(saved2)); page.wait_for_function("document.querySelector('#toast').textContent.includes('quakes 2d')", timeout=120000)
        page.wait_for_timeout(800); check(page.evaluate(MODE)["d3"] == "true", "opened from the file, 3D is still unavailable")

        print("== scenes in Open map")
        seen = []
        def with_scene(route):
            q = route.request.url
            r = route.fetch(); j = r.json()
            if "Web%20Scene" in q or "Web+Scene" in q or "Web Scene" in q:
                seen.append(1)
                if j.get("results"): j["results"][0] = {**j["results"][0], "id": SCENE, "type": "Web Scene", "title": "AAA test scene"}
            route.fulfill(response=r, json=j)
        page.route(lambda u: "/sharing/rest/content/groups/" in u and "/search" in u, with_scene)
        page.goto(f"{base}/index.html?config=mapmaker"); page.wait_for_function("document.querySelector('arcgis-map') && document.querySelector('arcgis-map').view && document.querySelector('arcgis-map').view.ready", timeout=120000)
        page.click("#tool-open"); page.wait_for_selector("#omList .cat-card", timeout=120000)
        check(len(seen) > 0, "Open map asks the collection for web maps and web scenes")
        card = page.locator("#omList .cat-card", has=page.locator(".cat-3d")).first
        check(card.count() == 1 and card.locator(".cat-3d").inner_text() == "3D" and "3D scene" in card.locator(".cat-card-title").inner_text(), "a scene's card is marked 3D, in words for screen readers too: " + card.locator(".cat-card-title").inner_text().replace("\n", " "))
        check(page.locator("#omList .cat-card").count() - page.locator("#omList .cat-card .cat-3d").count() > 0, "web maps are listed beside it, unmarked")
        axe("#omList", "the list of maps and scenes")
        card.locator(".cat-share").click(); page.wait_for_timeout(500)
        link = page.evaluate("navigator.clipboard.readText()")
        check(link.endswith(f"?config=mapmaker&webscene={SCENE}"), "Share on a scene copies a webscene link: " + link)
        page.screenshot(path=str(shots / "scene-card.png"))
        page.evaluate("document.querySelector('#omList .cat-card:has(.cat-3d) .cat-act').click()")
        page.wait_for_function(SCENE_READY, timeout=180000)
        try: page.wait_for_function("document.querySelector('#tg2d').getAttribute('aria-disabled') === 'true'", timeout=30000)
        except Exception: pass
        st = page.evaluate(MODE); check(st["p3"] == "true" and st["d2"] == "true", "Open on the card opens the scene in 3D")
        # (clicks made in the page: while the test browser draws 3D in software it can be too busy for a pointer click)
        page.wait_for_timeout(4000); page.evaluate("document.querySelector('#tool-open').click()"); page.wait_for_selector("#omList .cat-card", timeout=60000)
        page.evaluate("document.querySelector('#omList .cat-card:not(:has(.cat-3d)) .cat-act').click()")
        page.wait_for_function("document.querySelector('#tg2d').getAttribute('aria-pressed') === 'true'", timeout=120000)
        st = page.evaluate(MODE); check(st["mapShown"] and st["d2"] is None and st["d3"] is None, "opening a web map afterwards goes back to 2D, with both views allowed")
        real = [e for e in errors if "ResizeObserver" not in e]
        check(not real, "no script errors: " + " | ".join(real[:3]))
        browser.close()
    print(f"{checks[0] - len(failures)}/{checks[0]} checks passed")
    sys.exit(1 if failures else 0)

if __name__ == "__main__":
    main()
