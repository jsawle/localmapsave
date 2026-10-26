"""Runs the Atlas app on the real ArcGIS Maps SDK 5.1 (from npm) in Chromium, offline.

Run:  python3 atlas/tests/real-sdk/real.py [--build DIR] [--shots DIR]
Needs Node/npm (to fetch @arcgis/core 5.1.0 and esbuild once into DIR) and Python Playwright with Chromium.

The smoke test uses a stand-in SDK, so it can't see what the real library does with the app's settings. This test
bundles the real SDK, serves it where the app expects the CDN, answers ArcGIS Online with the smoke test's fixtures
and plain tiles, and checks the things the stand-in can't:
  - the 2D view draws its basemap;
  - switching to 3D draws the basemap, zoom and one pan/rotate toggle (no second compass);
  - from a closer view, the camera tilts (at the whole-world start view the SDK allows almost none);
  - switching back to 2D works;
  - opening a map shaped like MapMaker's Revolutionary Battles shows 6 on Map layers and a dot on Bookmarks, and the count
    follows layers being removed and added;
  - Elevation profile is ready to draw on opening, samples TopoBathy 3D, and fits with every control on screen;
  - no uncaught errors.
Atlas 1.3.1 broke the first 3D check (an id the SDK doesn't know in view.ui.components) and the stand-in didn't notice.
"""
import argparse, functools, http.server, json, os, pathlib, re, struct, subprocess, sys, threading, zlib
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
ATLAS = HERE.parent.parent
sys.path.insert(0, str(HERE.parent / "smoke"))
import smoke  # noqa: E402  (fixtures: the group's categories, items, web map and basemap data)

CHROME = smoke.CHROME
SDK_VERSION = "5.1.0"
ESBUILD_VERSION = "0.25.10"
CDN = "https://js.arcgis.com/5.1/"


def build(d):
    """npm install the SDK once, then bundle every module app.js imports behind a $arcgis.import like the CDN's."""
    d.mkdir(parents=True, exist_ok=True)
    if not (d / "node_modules" / "@arcgis" / "core" / "package.json").exists():
        (d / "package.json").write_text('{"name":"atlas-real-sdk-test","private":true}')
        subprocess.run(["npm", "install", "--no-audit", "--no-fund", f"@arcgis/core@{SDK_VERSION}", f"esbuild@{ESBUILD_VERSION}"], cwd=d, check=True)
    paths = sorted(set(re.findall(r'"(@arcgis/core/[^"]+\.js)"', (ATLAS / "app.js").read_text())))
    lines = ['import esriConfig from "@arcgis/core/config.js";']
    lines += [f'import * as m{i} from "{p}";' for i, p in enumerate(paths)]
    lines += ['esriConfig.assetsPath = "/__sdk/assets";',
              "const M = {" + ", ".join(f'"{p}": m{i}' for i, p in enumerate(paths)) + "};",
              "window.__views = [];",
              # Record each view the app makes, so the test can ask the SDK about it (the app keeps its views private).
              "const track = (C) => new Proxy(C, { construct(t, a, nt) { const v = Reflect.construct(t, a, nt); window.__views.push(v); return v; } });",
              "const one = (p) => { const m = M[p]; if (!m) throw new Error('Not in the test bundle: ' + p);",
              "  const x = 'default' in m ? m.default : m; if (/\\/views\\/(Map|Scene)View\\.js$/.test(p)) return track(x);",
              "  if (/\\/widgets\\/ElevationProfile\\.js$/.test(p)) return new Proxy(x, { construct(t, a, nt) { return (window.__profile = Reflect.construct(t, a, nt)); } });",
              "  return x; };",
              # The SDK makes $arcgis itself (a read-only global); the CDN adds import() to it.
              "Object.assign(globalThis.$arcgis, { import: async (s) => (Array.isArray(s) ? s.map(one) : one(s)) });"]
    (d / "entry.js").write_text("\n".join(lines) + "\n")
    subprocess.run(["npx", "esbuild", "entry.js", "--bundle", "--format=esm", "--splitting", "--outdir=www", "--log-level=warning"], cwd=d, check=True)
    return len(paths)


def png(w, h, rgb):
    raw = b"".join(b"\x00" + bytes(rgb) * w for _ in range(h))
    chunk = lambda t, data: struct.pack(">I", len(data)) + t + data + struct.pack(">I", zlib.crc32(t + data) & 0xffffffff)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


TILE = png(256, 256, (170, 205, 160))
R0, S0 = 156543.03392800014, 591657527.591555
MAPSERVER = {"currentVersion": 11.1, "serviceDescription": "", "mapName": "Layers", "capabilities": "Map,Query,Data", "singleFusedMapCache": True,
             "spatialReference": {"wkid": 102100, "latestWkid": 3857}, "units": "esriMeters", "supportedImageFormatTypes": "PNG32,PNG24,PNG,JPG",
             "tileInfo": {"rows": 256, "cols": 256, "dpi": 96, "format": "PNG", "compressionQuality": 0,
                          "origin": {"x": -20037508.342787, "y": 20037508.342787}, "spatialReference": {"wkid": 102100, "latestWkid": 3857},
                          "lods": [{"level": z, "resolution": R0 / 2 ** z, "scale": S0 / 2 ** z} for z in range(17)]},
             "initialExtent": {"xmin": -2e7, "ymin": -2e7, "xmax": 2e7, "ymax": 2e7, "spatialReference": {"wkid": 102100}},
             "fullExtent": {"xmin": -20037508.342787, "ymin": -20037508.342787, "xmax": 20037508.342787, "ymax": 20037508.342787, "spatialReference": {"wkid": 102100}},
             "layers": [{"id": 0, "name": "Base", "parentLayerId": -1, "defaultVisibility": True, "subLayerIds": None, "minScale": 0, "maxScale": 0}], "tables": []}
# Shaped like MapMaker's "1777-1778 Revolutionary Battles" (item 1f6a2a11c56d4042ac9fc3d2f8f5f7f9): four layers and two groups of
# two at the top level, and one bookmark. MapMaker shows 6 on Map layers for it, and a dot on Bookmarks.
FL = lambda i, t: {"id": f"fl{i}", "title": t, "layerType": "ArcGISFeatureLayer", "url": f"https://services.arcgis.com/x/arcgis/rest/services/L{i}/FeatureServer/0", "visibility": True}
BATTLES_MAP = {"operationalLayers": [FL(1, "1763 Proclamation Line"),
    {"id": "g1", "title": "Thirteen British Colonies", "layerType": "GroupLayer", "layers": [FL(2, "Colonies"), FL(3, "Colony labels")]},
    {"id": "g2", "title": "Revolutionary War Battlefields", "layerType": "GroupLayer", "layers": [FL(4, "Battlefields"), FL(5, "Battlefield points")]},
    FL(6, "Revolutionary War Battles"), FL(7, "Key Port Cities"), FL(8, "Turning Points")],
  "baseMap": smoke.BASEMAP_DATA["baseMap"], "spatialReference": {"wkid": 102100}, "version": "2.31", "authoringApp": "ArcGIS Online", "authoringAppVersion": "2026.3",
  "bookmarks": [{"name": "Pennsylvania/New Jersey", "extent": {"xmin": -8.5e6, "ymin": 4.7e6, "xmax": -8.1e6, "ymax": 5.1e6, "spatialReference": {"wkid": 102100}}}]}
# Enough of Esri's TopoBathy 3D service for the layer to load (the build machine can't reach it): its credits show in the dock.
TOPOBATHY = {"currentVersion": 10.81, "serviceDescription": "TopoBathy 3D provides global elevation and bathymetry", "name": "WorldElevation3D/TopoBathy3D",
             "copyrightText": "Sources: Esri, GEBCO", "capabilities": "Image,Tilemap,Mensuration", "singleFusedMapCache": True, "bandCount": 1, "pixelType": "F32",
             "minValues": [-11000], "maxValues": [8700], "spatialReference": {"wkid": 102100, "latestWkid": 3857},
             "extent": {"xmin": -20037508.342787, "ymin": -20037508.342787, "xmax": 20037508.342787, "ymax": 20037508.342787, "spatialReference": {"wkid": 102100}},
             "tileInfo": {"rows": 257, "cols": 257, "dpi": 96, "format": "LERC", "compressionQuality": 0, "origin": {"x": -20037508.342787, "y": 20037508.342787},
                          "spatialReference": {"wkid": 102100, "latestWkid": 3857}, "lods": [{"level": z, "resolution": R0 / 2 ** z, "scale": S0 / 2 ** z} for z in range(17)]}}
PORTAL_SELF = {"id": "0123456789ABCDEF", "name": "ArcGIS Online", "isPortal": False, "portalHostname": "www.arcgis.com", "urlKey": None,
               "customBaseUrl": "maps.arcgis.com", "units": "metric", "helperServices": {}, "supportsHostedServices": True}


def serve(build_dir, port_holder):
    www, assets = build_dir / "www", build_dir / "node_modules" / "@arcgis" / "core" / "assets"

    class H(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
        def translate_path(self, path):
            p = urlparse(path).path
            if p == "/__sdk/": return str(www / "entry.js")
            if p.startswith("/__sdk/assets/"): return str(assets / p[len("/__sdk/assets/"):])
            if p.startswith("/__sdk/esri/"): return str(assets / p[len("/__sdk/"):])
            if p.startswith("/__sdk/"): return str(www / p[len("/__sdk/"):])
            return str(ATLAS / p.lstrip("/"))
        def do_GET(self):
            if urlparse(self.path).path in ("/", "/index.html"):   # the app's page, loading the bundle instead of the CDN
                body = (ATLAS / "index.html").read_text().replace(CDN, "/__sdk/").encode()
                self.send_response(200); self.send_header("Content-Type", "text/html"); self.send_header("Content-Length", str(len(body))); self.end_headers()
                self.wfile.write(body); return
            super().do_GET()
    H.extensions_map = {**H.extensions_map, ".js": "text/javascript", ".json": "application/json", ".wasm": "application/wasm"}
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
    port_holder.append(srv.server_address[1]); srv.serve_forever()


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--build", default=str(HERE / ".build")); ap.add_argument("--shots", default=str(HERE / ".shots"))
    a = ap.parse_args()
    build_dir, shots = pathlib.Path(a.build).resolve(), pathlib.Path(a.shots); shots.mkdir(parents=True, exist_ok=True)
    n = build(build_dir); print(f"bundled {n} SDK modules ({SDK_VERSION})")
    port = []; threading.Thread(target=serve, args=(build_dir, port), daemon=True).start()
    while not port: pass
    base = f"http://127.0.0.1:{port[0]}"
    failures, checks, unanswered = [], [0], set()

    def check(cond, msg):
        checks[0] += 1
        print(("  ok   " if cond else "  FAIL ") + msg)
        if not cond: failures.append(msg)

    def route(r):
        url = r.request.url; u = urlparse(url); params = {k: v[0] for k, v in parse_qs(u.query).items()}
        if url.startswith(base): return r.continue_()
        cors = {"Access-Control-Allow-Origin": base, "Access-Control-Allow-Credentials": "true"}   # the SDK sends credentials to arcgis.com
        if u.netloc == "www.arcgis.com" and u.path.startswith("/sharing/rest/"):
            p = u.path
            if p.endswith("/portals/self"): body = PORTAL_SELF
            elif p.endswith("/categorySchema"): body = smoke.SCHEMA
            elif p.endswith(f"/groups/{smoke.GROUP}/search"): body = smoke.search_response(params)
            elif p.endswith("/content/items/a82ff7ce1c3a493f9d82aa89f5a1ddcf/data"): body = smoke.BASEMAP_DATA
            elif p.endswith("/content/items/a82ff7ce1c3a493f9d82aa89f5a1ddcf"): body = {"id": "a82ff7ce1c3a493f9d82aa89f5a1ddcf", "type": "Web Map", "title": "National Geographic Style", "owner": "mm", "access": "public"}
            elif re.search(r"/content/items/\w+/data$", p): body = BATTLES_MAP
            elif re.search(r"/content/items/\w+$", p): body = {"id": p.rsplit("/", 1)[1], "type": "Web Map", "title": "Map", "owner": "mpmkr", "access": "public"}
            else: unanswered.add(p); body = {"error": {"code": 400, "message": "not in fixture"}}
            return r.fulfill(status=200, content_type="application/json", headers=cors, body=json.dumps(body))
        if u.path.endswith("/TopoBathy3D/ImageServer"): return r.fulfill(status=200, content_type="application/json", headers=cors, body=json.dumps(TOPOBATHY))
        if "/MapServer/tile/" in u.path: return r.fulfill(status=200, content_type="image/png", headers=cors, body=TILE)
        if u.path.endswith("/MapServer"): return r.fulfill(status=200, content_type="application/json", headers=cors, body=json.dumps(MAPSERVER))
        unanswered.add(u.netloc + u.path)
        return r.fulfill(status=404, headers=cors, body="")

    BASEMAP_VIEWS = "(i) => { const v = window.__views[i]; const base = v.map.basemap ? v.map.basemap.baseLayers.toArray() : []; return v.allLayerViews.filter(lv => base.includes(lv.layer)).length; }"
    CONTROLS = "(sel) => [...document.querySelectorAll(sel + ' .esri-ui-top-left > *')].map(e => [...e.classList].find(c => /^esri-(zoom|navigation-toggle|compass|home|expand)$/.test(c)) || e.tagName.toLowerCase())"
    BASEMAP_DONE = "(i) => { const v = window.__views[i]; const base = v.map.basemap.baseLayers.toArray(); const lvs = v.allLayerViews.filter(lv => base.includes(lv.layer)); return lvs.length > 0 && lvs.every(lv => !lv.updating); }"
    READY = "(i) => { const v = window.__views[i]; return !!(v && v.ready); }"

    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=CHROME, args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
        page = browser.new_page(viewport={"width": 1400, "height": 860}); page.route("**/*", route)
        errors, console = [], []
        page.on("pageerror", lambda e: errors.append(str(e)[:300]))
        page.on("console", lambda m: console.append(m.text[:200]) if m.type == "error" else None)
        page.on("dialog", lambda d: d.accept())
        def wait(fn, arg=None, label=""):
            # Poll on a timer: software WebGL is slow, and requestAnimationFrame polling can stall behind it.
            try: page.wait_for_function(fn, arg=arg, timeout=90000, polling=500); return True
            except Exception:
                print("  timed out:", label, "| errors:", errors[:3], "| console:", console[:4], "| unanswered:", sorted(unanswered)[:6])
                return False

        page.goto(f"{base}/index.html?config=mapmaker")
        if not (wait("window.__views && window.__views.length > 0", label="the app makes its map view") and wait(READY, 0, "2D view ready")):
            check(False, "the app starts on the real SDK"); browser.close(); sys.exit(1)
        page.wait_for_timeout(800)
        check(page.evaluate(BASEMAP_VIEWS, 0) > 0 and wait(BASEMAP_DONE, 0, "2D basemap tiles"), "2D: basemap drawn")
        ctl = page.evaluate(CONTROLS, "#viewDiv")
        check("esri-zoom" in ctl, f"2D: zoom shown {ctl}")
        page.screenshot(path=str(shots / "real-2d.png"))

        # 3D at the start view (the whole world)
        page.click("#tg3d")
        if not wait("window.__views.length > 1", label="the app makes its 3D view"):
            check(False, "3D: the app makes its 3D view"); browser.close(); sys.exit(1)
        check(wait(READY, 1, "3D view ready"), "3D: the view gets ready")
        page.wait_for_timeout(3000)   # layers, then the tilt animation
        check(page.get_attribute("#tg3d", "aria-pressed") == "true", "3D: switched (not back to 2D with an error)")
        check(page.evaluate(BASEMAP_VIEWS, 1) > 0 and wait(BASEMAP_DONE, 1, "3D basemap tiles"), "3D: basemap drawn")
        ctl = page.evaluate(CONTROLS, "#sceneDiv")
        check(ctl.count("esri-zoom") == 1 and ctl.count("esri-navigation-toggle") == 1 and "esri-compass" not in ctl, f"3D: zoom and one pan/rotate toggle, no second compass {ctl}")
        world_tilt = page.evaluate("window.__views[1].camera.tilt")
        print(f"  (tilt at the whole-world start view: {world_tilt:.1f}°; the SDK allows {page.evaluate('window.__views[1].constraints.tilt.max'):.1f}° at that height)")
        page.screenshot(path=str(shots / "real-3d-world.png"))
        page.click("#tg2d"); page.wait_for_timeout(1500)
        check(page.get_attribute("#tg2d", "aria-pressed") == "true" and page.is_visible("#viewDiv") and page.is_hidden("#sceneDiv"), "back to 2D")

        # 3D from a closer view: the camera tilts
        page.evaluate("window.__views[0].goTo({ center: [-100, 40], zoom: 6 }, { animate: false })"); page.wait_for_timeout(1000)
        page.click("#tg3d"); page.wait_for_timeout(4000)
        tilt = page.evaluate("window.__views[1].camera.tilt")
        check(tilt > 50, f"3D: camera tilts from a closer view ({tilt:.1f}°)")
        page.screenshot(path=str(shots / "real-3d-tilted.png"))
        page.click("#tg2d"); page.wait_for_timeout(1500)
        check(page.get_attribute("#tg2d", "aria-pressed") == "true", "back to 2D again")
        # Elevation profile: ready to draw at once, from TopoBathy 3D, every control on screen without scrolling (desktop and phone)
        page.click("#tool-measure"); page.click("#menuProfile")
        check(wait("window.__profile && window.__profile.viewModel.state === 'creating'", label="profile drawing starts"), "Elevation profile: ready to draw as soon as it opens")
        line = page.evaluate("(() => { const l = window.__profile.viewModel.profiles.getItemAt(0); return { type: l.type, url: l.source && l.source.url, title: l.title }; })()")
        check(line["type"] == "query" and "/TopoBathy3D/ImageServer" in (line["url"] or ""), f"profile samples TopoBathy 3D (land and sea floor) {line}")
        check(wait("document.querySelector('#profileSource').textContent.includes('GEBCO')", label="profile data credit"), "elevation data credited in the dock")
        DOCK_FIT = """() => { const d = document.querySelector('#profilePanel').getBoundingClientRect(), b = document.querySelector('#profileBody');
          const ctl = [...document.querySelectorAll('#profileBody .esri-elevation-profile__footer calcite-button, #profileBody .esri-elevation-profile-settings calcite-action')].filter(e => e.offsetParent);
          const inside = ctl.map(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.top >= d.top && r.bottom <= d.bottom + 0.5 && r.left >= d.left && r.right <= d.right + 0.5; });
          const chart = document.querySelector('#profileBody .esri-elevation-profile__main-container').getBoundingClientRect();
          return { dockH: Math.round(d.height), share: +(d.height / innerHeight).toFixed(2), scroll: b.scrollHeight - b.clientHeight, controls: ctl.length, inside, chartH: Math.round(chart.height), mapH: Math.round(document.querySelector('#mapWrap').getBoundingClientRect().height) }; }"""
        for w, h in ((1400, 860), (390, 844)):
            page.set_viewport_size({"width": w, "height": h}); page.wait_for_timeout(1500)
            fit = page.evaluate(DOCK_FIT)
            check(fit["controls"] >= 2 and all(fit["inside"]) and fit["scroll"] <= 1 and fit["share"] <= 0.36 and fit["chartH"] >= 90, f"{w}x{h}: dock fits, every control on screen, no scrolling {fit}")
            page.screenshot(path=str(shots / f"real-profile-{w}.png"))
        page.set_viewport_size({"width": 1400, "height": 860}); page.wait_for_timeout(500)
        page.click("#profilePanel [data-close]"); page.wait_for_timeout(500)

        # Open a map: Map layers shows its top-level layer count (groups count once), Bookmarks a dot
        check(page.is_hidden("#logoLink") and page.is_hidden("#layersBadge") and page.is_hidden("#bookmarksDot"), "header has no app name; no badge or dot on the new map")
        page.click("#tool-open"); page.wait_for_selector("#omList .cat-act", timeout=30000)
        page.click("#omList > li:first-child .cat-act")
        check(wait("document.querySelector('#layersBadge').textContent === '6' && !document.querySelector('#layersBadge').hidden", label="layer count after opening"),
              f"Map layers shows 6 for a map like Revolutionary Battles ({page.inner_text('#layersBadge')!r})")
        check(page.is_visible("#bookmarksDot"), "Bookmarks shows a dot")
        page.evaluate("window.__removed = window.__views[0].map.layers.getItemAt(0); window.__views[0].map.remove(window.__removed)")
        check(wait("document.querySelector('#layersBadge').textContent === '5'", label="count after removing a layer"), "the count follows the map: 5 after removing a layer")
        page.evaluate("window.__views[0].map.add(window.__removed, 0)")
        check(wait("document.querySelector('#layersBadge').textContent === '6'", label="count after adding it back"), "6 again after adding it back")
        page.wait_for_timeout(1500); page.screenshot(path=str(shots / "real-open-map.png"))
        check(not errors, f"no uncaught errors {errors[:3]}")
        browser.close()
    if console: print("  (console errors, for information:", len(console), ";", "; ".join(sorted(set(console))[:4]) + ")")
    if unanswered: print("  (requests the fixtures don't answer, for information:", "; ".join(sorted(unanswered)[:6]) + ")")
    print(f"{checks[0] - len(failures)}/{checks[0]} checks passed")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
