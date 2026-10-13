"""Browser smoke test for the Atlas app with a stand-in ArcGIS SDK (the build machine can't reach arcgis.com).

Run:  python3 atlas/tests/smoke/smoke.py [--deps DIR] [--shots DIR]
Needs Python Playwright with Chromium. DIR holds (or receives, via npm pack) @esri/calcite-components and axe-core.
Checks the toolbar (MapMaker's order, icons), compass rose and scale bar, attribution disclaimer, header,
Open map topics (counts, sub-topics, search), opening a map, 2D/3D, phone layout and an axe-core WCAG 2.1 AA scan.
"""
import argparse, functools, http.server, json, os, pathlib, re, subprocess, sys, tarfile, threading
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
ATLAS = HERE.parent.parent
GROUP = "36443e9570294a1f883b5d2c5abfe6b5"
CHROME = os.environ.get("CHROME", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome")

# The live group's category list (Schools Living Atlas, October 2026).
SCHEMA = {"categorySchema": [{"title": "Categories", "categories": [
    {"title": "Lessons", "categories": [{"title": "America 250"}, {"title": "Earth Science"}, {"title": "World Cultures and Geography"}]},
    {"title": "Civics and Government"}, {"title": "Earth Science"},
    {"title": "Human Geography", "categories": [{"title": t} for t in ["Demographics", "Development", "Environmental Impacts and Stress", "Hazards",
        "History and Archeology", "Land Management", "Migration", "Populated Places", "Public Health", "Public Safety", "Transportation"]]},
    {"title": "Life and Environmental Science", "categories": [{"title": t} for t in ["Biomes and Ecoregions", "Ecosystems", "Migration", "Species"]]},
    {"title": "National Geographic Explorers"},
    {"title": "Physical Science", "categories": [{"title": t} for t in ["Climate", "Earth and Land", "Natural Hazards", "Oceans", "Water", "Weather"]]},
    {"title": "Real-Time Data"}, {"title": "Sustainable Development Goals"}, {"title": "United States Geography"},
    {"title": "United States History"}, {"title": "World Geography"}]}]}


def make_items():
    """115 web maps spread over the topics, like the live group, including retired and missing categories."""
    paths = []
    def walk(nodes, base):
        for n in nodes:
            p = base + "/" + n["title"]; paths.append(p); walk(n.get("categories", []), p)
    walk(SCHEMA["categorySchema"][0]["categories"], "/Categories")
    leafs = [p for p in paths if not any(q.startswith(p + "/") for q in paths)]
    leafs = [p for p in leafs if p not in ("/Categories/National Geographic Explorers", "/Categories/Lessons/Earth Science")]  # topics with no maps
    items = []
    for i in range(112):
        cats = [leafs[i % len(leafs)]]
        if i % 3 == 0: cats.append(leafs[(i * 7 + 3) % len(leafs)])
        items.append({"id": f"{i:032x}", "title": f"Map {i:03d} {cats[0].split('/')[-1]}", "snippet": f"Snippet {i}", "tags": ["tag" + str(i % 5)],
                      "type": "Web Map", "access": "public", "thumbnail": None, "description": "<p>About <b>volcanoes</b></p>" if i == 5 else "",
                      "groupCategories": cats})
    items.append({"id": "a" * 32, "title": "Trans-Atlantic Slave Trade", "type": "Web Map", "groupCategories": ["/Categories/World History", "/Categories/Human Geography/Migration and Refugees"]})
    items.append({"id": "b" * 32, "title": "Geografía de Panamá", "type": "Web Map", "groupCategories": []})
    items.append({"id": "c" * 32, "title": "Light Pollution", "type": "Web Map", "groupCategories": ["/categories/human geography/populated places/"]})
    return sorted(items, key=lambda x: x["title"].lower())


ITEMS = make_items()

OVERLAP_JS = """() => { const r = (q) => { const e = document.querySelector(q); return e ? e.getBoundingClientRect() : null; };
  const hit = (a, b) => a && b && a.width && b.width && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  const tb = r('#toolbar');
  return { stack: hit(r('#viewDiv .ll-stack'), tb), attribution: hit(r('#viewDiv .esri-attribution'), tb), corner: hit(r('.corner'), tb) }; }"""


def expected_counts():
    def key(p): return p.strip().rstrip("/").lower()
    out = {}
    tops = [key("/Categories/" + n["title"]) for n in SCHEMA["categorySchema"][0]["categories"]]
    for t in tops:
        out[t] = sum(1 for it in ITEMS if any(key(c) == t or key(c).startswith(t + "/") for c in it["groupCategories"]))
    other = sum(1 for it in ITEMS if not any(key(c) == t or key(c).startswith(t + "/") for t in tops for c in it["groupCategories"]))
    return out, other


def ensure_deps(d):
    d.mkdir(parents=True, exist_ok=True)
    for pkg, folder in (("@esri/calcite-components@5.1.1", "calcite"), ("axe-core@4", "axe")):
        if (d / folder / "package").exists(): continue
        tgz = subprocess.run(["npm", "pack", pkg, "-q"], cwd=d, capture_output=True, text=True, check=True).stdout.strip().splitlines()[-1]
        (d / folder).mkdir(exist_ok=True)
        with tarfile.open(d / tgz) as t: t.extractall(d / folder, filter="data")


def serve(root, port_holder):
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    handler = functools.partial(Quiet, directory=str(root))
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    port_holder.append(srv.server_address[1]); srv.serve_forever()


LAYER_ITEM = {"id": "d" * 32, "title": "Annual Average Temperature", "type": "Feature Service", "snippet": "Mean surface air temperature",
              "description": "<p>Explore Earth's <b>mean surface air temperature</b>.</p><script>alert(1)</script>", "accessInformation": "CHELSA",
              "groupCategories": ["/Categories/Physical Science/Climate"]}
LAYERS = [LAYER_ITEM] + [{"id": f"{0xe0 + i:02x}" * 16, "title": f"Layer {i:02d}", "type": "Map Service" if i % 2 else "Feature Service", "snippet": f"Layer snippet {i}",
          "groupCategories": ["/Categories/Physical Science/" + ("Oceans" if i % 3 else "Weather")] if i < 9 else ["/Categories/Human Geography/Migration"]} for i in range(13)] \
         + [{"id": "f" * 32, "title": "A story map", "type": "Web Mapping Application", "groupCategories": ["/Categories/Physical Science"]}]
# What a collection web map holds (its layers, basemap and a bookmark), and the default basemap.
MAP_DATA = {"operationalLayers": [{"id": "rivers", "title": "Rivers", "layerType": "ArcGISFeatureLayer", "url": "https://services.arcgis.com/r/arcgis/rest/services/Rivers/FeatureServer/0", "visibility": True}],
            "baseMap": {"baseMapLayers": [{"id": "topo", "layerType": "ArcGISTiledMapServiceLayer", "url": "https://services.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer"}], "title": "Topographic"},
            "spatialReference": {"wkid": 102100}, "version": "2.31", "authoringApp": "ArcGIS Online", "authoringAppVersion": "2026.3",
            "bookmarks": [{"name": "Amazon", "extent": {"xmin": -8e6, "ymin": -1e6, "xmax": -5e6, "ymax": 1e6, "spatialReference": {"wkid": 102100}}}]}
BASEMAP_DATA = {"baseMap": {"baseMapLayers": [{"id": "ng", "layerType": "ArcGISTiledMapServiceLayer", "url": "https://services.arcgisonline.com/ArcGIS/rest/services/NatGeo_World_Map/MapServer"}], "title": "National Geographic Style"}}
PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
# A web map file from somewhere else: two layers (one on a plain-http server, which must be left out), a sketch, a spreadsheet layer, a bookmark.
TRIP_FILE = {"operationalLayers": [
    {"id": "parks", "title": "Parks", "layerType": "ArcGISFeatureLayer", "url": "https://services.arcgis.com/p/arcgis/rest/services/Parks/FeatureServer/0", "visibility": False},
    {"id": "insecure", "title": "Old server", "layerType": "ArcGISMapServiceLayer", "url": "http://old.example.org/arcgis/rest/services/X/MapServer"},
    {"id": "__data_csv1", "title": "Trees", "layerType": "ArcGISFeatureLayer", "featureCollection": {"layers": [{"layerDefinition": {"name": "Trees", "type": "Feature Layer", "geometryType": "esriGeometryPoint", "objectIdField": "ObjectId",
        "fields": [{"name": "ObjectId", "type": "esriFieldTypeOID"}, {"name": "Height", "type": "esriFieldTypeDouble"}], "drawingInfo": {"renderer": {"type": "simple", "symbol": {"type": "esriSMS", "style": "esriSMSCircle", "color": [0, 120, 0, 255], "size": 9}}}},
        "featureSet": {"geometryType": "esriGeometryPoint", "features": [{"geometry": {"x": 10, "y": 20, "spatialReference": {"wkid": 102100}}, "attributes": {"ObjectId": 1, "Height": 12.5}}]}, "popupInfo": {"title": "Tree"}}]}},
    {"id": "__sketch_points", "title": "My sketches", "layerType": "ArcGISFeatureLayer", "featureCollection": {"layers": [{"layerDefinition": {"name": "My sketches", "type": "Feature Layer", "geometryType": "esriGeometryPoint", "objectIdField": "ObjectId", "fields": []},
        "featureSet": {"geometryType": "esriGeometryPoint", "features": [{"geometry": {"x": 5, "y": 5, "spatialReference": {"wkid": 102100}}, "attributes": {"uid": "s1", "kind": "point", "title": "Camp", "description": "Night 1", "imageUrl": PIXEL, "color": "#d4572a", "size": 14, "rotation": 0}}]}}]}}],
  "baseMap": {"baseMapLayers": [{"id": "img", "layerType": "ArcGISTiledMapServiceLayer", "url": "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer"}], "title": "Imagery"},
  "spatialReference": {"wkid": 102100}, "version": "2.31", "authoringApp": "Somewhere", "authoringAppVersion": "1",
  "initialState": {"viewpoint": {"targetGeometry": {"xmin": -1e6, "ymin": -1e6, "xmax": 1e6, "ymax": 1e6, "spatialReference": {"wkid": 102100}}}},
  "bookmarks": [{"name": "Camp", "extent": {"xmin": 0, "ymin": 0, "xmax": 100, "ymax": 100, "spatialReference": {"wkid": 102100}}, "thumbnail": {"url": PIXEL}}],
  "presentation": {"slides": [{"title": {"text": "Camp"}, "visibleLayers": [{"id": "parks"}, {"id": "__sketch_points"}]}]}}
SPEC_ROOT = {"applicationProperties", "authoringApp", "authoringAppVersion", "background", "baseMap", "bookmarks", "geotriggersInfo", "initialState", "mapFloorInfo", "mapIPSInfo",
             "mapRangeInfo", "operationalLayers", "parcelFabric", "presentation", "referenceScale", "spatialReference", "tables", "timeZone", "utilityNetworks", "version", "widgets"}


def search_response(params):
    q = params.get("q", "")
    if 'type:"Web Map"' not in q or q.startswith("-type"):
        num, start = int(params.get("num", 10)), int(params.get("start", 1))
        res = sorted(LAYERS, key=lambda x: x["title"].lower())[start - 1:start - 1 + num]
        return {"total": len(LAYERS), "start": start, "num": num, "nextStart": start + num if start - 1 + num < len(LAYERS) else -1, "results": res}
    num, start = int(params.get("num", 10)), int(params.get("start", 1))
    res = ITEMS[start - 1:start - 1 + num]
    nxt = start + num if start - 1 + num < len(ITEMS) else -1
    return {"total": len(ITEMS), "start": start, "num": num, "nextStart": nxt, "results": res}


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--deps", default=str(HERE / ".deps")); ap.add_argument("--shots", default=str(HERE / ".shots"))
    a = ap.parse_args()
    deps, shots = pathlib.Path(a.deps), pathlib.Path(a.shots); shots.mkdir(parents=True, exist_ok=True)
    ensure_deps(deps)
    calcite = deps / "calcite" / "package" / "dist" / "cdn"
    axe_js = (deps / "axe" / "package" / "axe.min.js").read_text()
    port = []; threading.Thread(target=serve, args=(ATLAS, port), daemon=True).start()
    while not port: pass
    base = f"http://127.0.0.1:{port[0]}"
    stub = (HERE / "stub-sdk.js").read_text()
    counts, other = expected_counts()
    failures, checks = [], [0]

    def check(cond, msg):
        checks[0] += 1
        if not cond: failures.append(msg); print("  FAIL", msg)

    def route(r):
        url = r.request.url
        if url.startswith("https://js.arcgis.com/5.1/esri/"): return r.fulfill(status=200, content_type="text/css", body="")
        if url.startswith("https://js.arcgis.com/5.1/"): return r.fulfill(status=200, content_type="text/javascript", body=stub)
        if "/__calcite/" in url:
            p = calcite / url.split("/__calcite/", 1)[1].split("?")[0]
            if p.exists(): return r.fulfill(status=200, body=p.read_bytes(), content_type="text/javascript" if p.suffix == ".js" else ("application/json" if p.suffix == ".json" else "text/css"))
            return r.fulfill(status=404, body="")
        if url.startswith("https://www.arcgis.com/sharing/rest/"):
            from urllib.parse import urlparse, parse_qs
            u = urlparse(url); params = {k: v[0] for k, v in parse_qs(u.query).items()}
            if u.path.endswith("/categorySchema"): body = SCHEMA
            elif u.path.endswith(f"/groups/{GROUP}/search"): body = search_response(params)
            elif re.search(r"/content/items/a82ff7ce1c3a493f9d82aa89f5a1ddcf/data$", u.path): body = BASEMAP_DATA
            elif re.search(r"/content/items/\w+/data$", u.path): body = MAP_DATA
            elif re.search(r"/content/items/(\w+)$", u.path):
                iid = u.path.rsplit("/", 1)[1]; it = next((i for i in ITEMS if i["id"] == iid), {"id": iid, "title": "Map"}); body = {**it, "owner": "mpmkr"}
            else: body = {"error": {"message": "not in fixture"}}
            return r.fulfill(status=200, content_type="application/json", body=json.dumps(body))
        if url.startswith(base): return r.continue_()
        if re.search(r"\.(png|jpg|svg)|/data$", url): return r.fulfill(status=200, content_type="image/svg+xml", body='<svg xmlns="http://www.w3.org/2000/svg" width="160" height="40"><rect width="160" height="40" fill="#ffd200"/></svg>')
        return r.fulfill(status=404, body="")

    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=CHROME)
        for cfg in ("mapmaker", "default", "example-es"):
            print(f"== {cfg}")
            ctx = browser.new_context(viewport={"width": 1910, "height": 937})
            page = ctx.new_page(); page.route("**/*", route)
            errors = []; page.on("pageerror", lambda e: errors.append(str(e)))
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "favicon" not in m.text else None)
            page.on("dialog", lambda d: d.accept())   # "You have unsaved changes" after adding a layer
            page.goto(f"{base}/index.html?config={cfg}"); page.wait_for_function("window.__stub && window.__stub.views.length > 0")
            page.wait_for_timeout(600)

            # Toolbar: MapMaker's order and size
            ids = page.eval_on_selector_all("#toolbar > *:not([hidden])", "els => els.map(e => e.id)")
            check(ids == ["tool-basemaps", "tool-open", "tool-layers", "tool-add", "tool-legend", "tool-measure", "tool-sketch", "viewSeg", "tool-bookmarks", "tool-save"], f"toolbar order {ids}")
            box = page.eval_on_selector("#toolbar", "e => { const r = e.getBoundingClientRect(); return [r.width, r.height, innerHeight - r.bottom]; }")
            check(840 <= box[0] <= 860 and 86 <= box[1] <= 90, f"toolbar size {box}")
            # Icons: every one becomes Esri's Calcite icon once drawn
            page.wait_for_function("[...document.querySelectorAll('#toolbar .ti[data-icon]')].every(s => s.querySelector('calcite-icon:not(.pending)') && !s.querySelector('svg'))", timeout=15000)
            check(True, "calcite icons")
            # Compass rose above the scale bar, bottom-left
            stack = page.eval_on_selector(".esri-ui-bottom-left .ll-stack", "e => [...e.children].map(c => c.className || c.tagName)")
            check(stack[0] == "rose" and "esri-scale-bar" in stack[1] and stack[2] == "tools-toggle", f"bottom-left stack {stack}")
            lab = page.get_attribute(".rose", "aria-label")
            check(lab and len(lab) > 5, f"compass label {lab}")
            letters = page.eval_on_selector_all(".rose text", "ts => ts.map(t => t.textContent)")
            check(letters == (["N", "E", "S", "O"] if cfg == "example-es" else ["N", "E", "S", "W"]), f"compass letters {letters}")
            rb = page.eval_on_selector(".rose", "e => { const r = e.getBoundingClientRect(); return [r.width, r.left]; }")
            check(abs(rb[0] - 100) < 1, f"compass size {rb}")
            page.evaluate("window.__stub.views[0].rotation = 30")
            page.wait_for_timeout(200)
            check(page.get_attribute(".rose-dial", "transform") == "rotate(30 50 50)", "compass turns with the map")
            check("330" in (page.get_attribute(".rose", "aria-label") or ""), "compass label after turning: " + str(page.get_attribute(".rose", "aria-label")))
            page.click(".rose"); page.wait_for_timeout(200)
            check(page.evaluate("window.__stub.goTo.some(g => g.rotation === 0)"), "compass resets north")
            # Attribution disclaimer
            before = page.evaluate("getComputedStyle(document.querySelector('.esri-attribution__powered-by'), '::before').content")
            if cfg == "mapmaker": check("National Geographic's current map policy | " in before, f"disclaimer {before[:80]}")
            # Header, corner
            check(page.is_hidden("#hdrTitle > input"), "no title until a map is open")
            signin_visible = page.is_visible("#signInBtn")
            check(signin_visible == (cfg != "mapmaker"), f"header sign-in visible={signin_visible}")
            check(page.inner_text("#verBtn") == "v1.5.0" and not page.query_selector(".credit") and "Jason Sawle" not in page.inner_text(".corner"), "version shown, no credit badge")
            check(page.evaluate(OVERLAP_JS) == {"stack": False, "attribution": False, "corner": False}, "nothing under the toolbar (desktop)")
            page.screenshot(path=str(shots / f"{cfg}-desktop.png"))
            page.set_viewport_size({"width": 1280, "height": 800}); page.wait_for_timeout(500)
            check(page.evaluate(OVERLAP_JS) == {"stack": False, "attribution": False, "corner": False}, "nothing under the toolbar (1280 wide): " + str(page.evaluate(OVERLAP_JS)))
            page.screenshot(path=str(shots / f"{cfg}-1280.png"))
            page.set_viewport_size({"width": 1910, "height": 937}); page.wait_for_timeout(300)

            # White label: no logo images in the header; the name shows as text
            check(page.is_hidden("#logoImg") and page.is_hidden("#logoCompact") and not page.query_selector_all("#hdrPartners img"), "no logos")
            if cfg == "mapmaker":   # no name in the header (and no empty link left behind)
                check(page.is_hidden("#logoText") and page.is_hidden("#logoLink"), "MapMaker: no name in the header")
            else:
                check(page.is_visible("#logoText") and page.inner_text("#logoText").strip() != "", "name shown instead of a logo")
            # Toolbar badges: nothing until there are layers or bookmarks
            check(page.is_hidden("#layersBadge") and page.is_hidden("#bookmarksDot") and page.inner_text("#tool-layers").strip() in ("Map layers", "Capas del mapa"), "no badge or dot on a new map")
            # Measure opens a menu above it: Measure, Elevation profile
            page.click("#tool-measure")
            check(page.is_visible("#measureMenu") and page.get_attribute("#tool-measure", "aria-expanded") == "true", "measure menu opens")
            mb = page.evaluate("""() => { const m = document.querySelector('#measureMenu').getBoundingClientRect(), b = document.querySelector('#tool-measure').getBoundingClientRect(), t = document.querySelector('#toolbar').getBoundingClientRect();
              return { above: m.bottom <= t.top, gap: t.top - m.bottom, centred: Math.abs((m.left + m.right) / 2 - (b.left + b.right) / 2) }; }""")
            check(mb["above"] and mb["gap"] < 12 and mb["centred"] < 2, f"menu sits above the Measure tool {mb}")
            page.wait_for_function("[...document.querySelectorAll('#measureMenu .ti')].every(s => s.querySelector('calcite-icon:not(.pending)'))", timeout=8000)
            check(True, "menu icons are Esri's (measure, altitude)")
            page.screenshot(path=str(shots / f"{cfg}-measure-menu.png"))
            labels = page.eval_on_selector_all("#measureMenu [role=menuitem]", "bs => bs.map(b => b.textContent.trim())")
            check(len(labels) == 2, f"menu items {labels}")
            check(page.evaluate("document.activeElement.id") == "menuMeasure", "focus on first menu item")
            page.keyboard.press("ArrowRight"); check(page.evaluate("document.activeElement.id") == "menuProfile", "arrow keys in the menu")
            page.keyboard.press("Escape")
            check(page.is_hidden("#measureMenu") and page.evaluate("document.activeElement.id") == "tool-measure", "Escape closes the menu")
            map_h = page.eval_on_selector("#mapWrap", "e => e.getBoundingClientRect().height")
            page.click("#tool-measure"); page.click("#menuProfile")
            check(page.is_visible("#profilePanel") and page.is_hidden("#measureMenu"), "Elevation profile opens")
            dock = page.evaluate("""() => { const d = document.querySelector('#profilePanel').getBoundingClientRect(), m = document.querySelector('#mapWrap').getBoundingClientRect();
              return { full: Math.abs(d.width - innerWidth) < 2, under: Math.abs(d.top - m.bottom) < 2, bottom: Math.abs(d.bottom - innerHeight) < 2, mapH: m.height, h: d.height, share: d.height / innerHeight }; }""")
            check(dock["full"] and dock["under"] and dock["bottom"] and 200 <= dock["h"] <= 272 and dock["share"] <= 0.31, f"profile docked under the map, a short strip {dock}")
            prof = page.evaluate("window.__stub.profile")
            line = (prof["profiles"] or [{}])[0]
            check(line.get("type") == "query" and line.get("title") in ("Land and sea floor", "Tierra y fondo marino") and line.get("color") == "#ff7f00", f"profile line: land and sea floor {line.get('type')} {line.get('title')}")
            check(page.evaluate("window.__stub.profile.starts") == ["sketch"], "ready to draw as soon as it opens")
            check(page.evaluate("""() => { const b = document.querySelector('#profileBody'); return b.scrollHeight <= b.clientHeight + 1; }"""), "nothing in the dock needs scrolling")
            check(page.inner_text("#profileSource").endswith("Sources: Esri, GEBCO"), "elevation data credited in the dock: " + page.inner_text("#profileSource"))
            check(page.is_hidden("#toolbar") and page.is_visible("#viewDiv .tools-toggle"), "toolbar tucked away, tools button shown")
            page.click("#viewDiv .tools-toggle")
            check(page.is_visible("#toolbar") and page.get_attribute("#viewDiv .tools-toggle", "aria-expanded") == "true", "tools button brings the toolbar back")
            check(page.evaluate(OVERLAP_JS)["stack"] is False, "toolbar clear of compass while docked")
            page.screenshot(path=str(shots / f"{cfg}-profile-dock.png"))
            check(page.evaluate("window.__stub.profile.unit") == ("imperial" if cfg == "mapmaker" else "metric"), "profile units from config")
            check("active" in (page.get_attribute("#tool-measure", "class") or ""), "Measure tool shows active while a measure panel is open")
            page.click("#profilePanel [data-close]")
            check(page.evaluate("window.__stub.profileCleared") >= 1 and "active" not in (page.get_attribute("#tool-measure", "class") or ""), "closing clears the profile")
            page.click("#tool-measure"); page.click("#menuProfile"); page.wait_for_timeout(150)
            check(page.evaluate("window.__stub.profile.starts.length") == 2, "reopening starts drawing again")
            page.click("#profilePanel [data-close]")
            check(page.is_visible("#toolbar") and page.is_hidden("#viewDiv .tools-toggle") and abs(page.eval_on_selector("#mapWrap", "e => e.getBoundingClientRect().height") - map_h) < 2, "closing gives the map its height back")
            page.click("#tool-measure"); page.click("#menuMeasure")
            check(page.is_visible("#measurePanel"), "Measure opens from the menu")
            page.click("#measurePanel [data-close]")
            page.click("#tool-measure"); page.mouse.click(900, 300)
            check(page.is_hidden("#measureMenu"), "clicking the map closes the menu")

            # Open map: categories tree, cards, pages
            page.click("#tool-open"); page.wait_for_selector("#omTree .tree-name")
            check(page.eval_on_selector("#tabGroup", "e => e.getBoundingClientRect().height") >= 30, "tabs row not squashed")
            tops = page.eval_on_selector_all("#omTree > li > .tree-row .tree-name", "bs => bs.map(b => [b.dataset.key, b.querySelector('.count').firstChild.textContent])")
            for k, c in tops:
                if k == "__other__": check(int(c) == other, f"other {c} vs {other}")
                else: check(int(c) == counts[k], f"count {k} {c} vs {counts[k]}")
            check("/categories/national geographic explorers" not in {k for k, _ in tops}, "empty category hidden")
            check(page.inner_text("#omStatus").startswith(str(len(ITEMS))), "status shows all maps")
            check(len(page.query_selector_all("#omList > li")) == 10, "ten cards a page")
            pages = page.eval_on_selector_all("#omPager button", "bs => bs.map(b => b.textContent)")
            check(pages[0] == "‹" and pages[-1] == "›" and "12" in pages, f"page numbers {pages}")
            page.click('#omPager button[aria-label="Page 2"], #omPager button[aria-label="Página 2"]')
            check(page.get_attribute('#omPager [aria-current="page"]', "aria-label") in ("Page 2", "Página 2") and page.evaluate("document.activeElement.id") == "omList", "page 2, focus on the list")
            hg = "/categories/human geography"
            page.click(f'#omTree .tree-name[data-key="{hg}"]')
            check(page.get_attribute(f'#omTree .tree-chev[data-key="{hg}"]', "aria-expanded") == "true", "choosing a category opens its sub-categories")
            check(page.evaluate("document.activeElement.dataset.key") == hg, "focus stays on the category")
            check(f"{counts[hg]}" in page.inner_text("#omStatus") and "Human Geography" in page.inner_text("#omStatus"), "status names the category")
            pp = hg + "/populated places"
            page.click(f'#omTree .tree-name[data-key="{pp}"]')
            check(page.get_attribute(f'#omTree .tree-name[data-key="{pp}"]', "aria-current") == "true", "sub-category chosen")
            check(any("Light Pollution" in t for t in page.eval_on_selector_all("#omList .cat-card-title", "e => e.map(x => x.textContent)")), "lower-case category path matched")
            page.click(f'#omTree .tree-chev[data-key="{hg}"]')
            check(page.get_attribute(f'#omTree .tree-chev[data-key="{hg}"]', "aria-expanded") == "false" and page.evaluate("document.activeElement.classList.contains('tree-chev')"), "chevron closes the branch")
            page.fill("#omSearch", "zzzz"); page.wait_for_timeout(400)
            check(page.is_visible("#omSearchAll") and len(page.query_selector_all("#omList > li")) == 0, "no match offers search all")
            page.click("#omSearchAll"); page.wait_for_timeout(300)
            check(not page.query_selector_all('#omTree [aria-current="true"]'), "search all clears the category")
            page.fill("#omSearch", "volcanoes"); page.wait_for_timeout(400)
            check(len(page.query_selector_all("#omList > li")) == 1, "search uses description text")
            page.click("#omList .cat-desc-btn")
            check(page.get_attribute("#omList .cat-desc-btn", "aria-expanded") == "true" and "volcanoes" in page.inner_text("#omList .cat-desc"), "card description opens")
            page.fill("#omSearch", "geografia panama"); page.wait_for_timeout(400)
            check(len(page.query_selector_all("#omList > li")) == 1, "accent-insensitive search")
            page.fill("#omSearch", ""); page.wait_for_timeout(300)
            page.click('#omTree .tree-name[data-key="__other__"]'); page.wait_for_timeout(200)
            check(len(page.query_selector_all("#omList > li")) == other, "other maps")
            page.click("#omReset"); page.wait_for_timeout(200)
            check(not page.query_selector_all('#omTree [aria-current="true"]') and not page.query_selector_all('#omTree .tree-chev[aria-expanded="true"]'), "reset shows all and closes branches")
            page.click("#omCatsBtn")
            check(page.is_hidden("#omSide") and page.get_attribute("#omCatsBtn", "aria-expanded") == "false", "Categories button hides the tree")
            page.click("#omCatsBtn")
            page.screenshot(path=str(shots / f"{cfg}-open-map.png"))
            # accessibility (WCAG 2.1 AA) with the dialog open, map canvas excluded (stand-in SDK)
            page.add_script_tag(content=axe_js)
            res = page.evaluate("axe.run({ exclude: [['.esri-view-root']] }, { runOnly: ['wcag2a','wcag2aa','wcag21a','wcag21aa'] }).then(r => r.violations.map(v => v.id + ': ' + v.nodes.map(n => n.target.join(' ')).slice(0,3).join(', ')))")
            check(not res, f"axe (Open map) {res}")
            page.keyboard.press("Escape")
            # Add layer: the same browser for the collection's layers, plus Your own data
            page.click("#tool-add"); page.wait_for_selector("#alList .cat-card")
            check(page.is_visible("#addModal") and page.inner_text("#tabLayers") != "", "Add layer dialog")
            check(page.inner_text("#alStatus").startswith("14"), "only layer types the app can add: " + page.inner_text("#alStatus"))
            ps = "/categories/physical science"
            page.click(f'#alTree .tree-name[data-key="{ps}"]')
            subs = page.eval_on_selector_all(f'#alTree .tree-name[data-key^="{ps}/"]', "bs => bs.map(b => b.dataset.key.split('/').pop())")
            check(sorted(subs) == ["climate", "oceans", "weather"], f"sub-categories with layers {subs}")
            first = page.query_selector("#alList .cat-card")
            check(first.query_selector(".cat-thumb") is not None and first.query_selector(".cat-act") is not None and first.query_selector(".cat-desc-btn") is not None, "card: title, description, Add Layer, picture, description row")
            page.click(f'#alTree .tree-name[data-key="{ps}/climate"]')
            page.click("#alList .cat-desc-btn")
            desc_html = page.inner_html("#alList .cat-desc")
            check("<script" not in desc_html and "mean surface air temperature" in page.inner_text("#alList .cat-desc") and "CHELSA" in page.inner_text("#alList .cat-desc"), "description cleaned, with credits")
            page.click("#alList .cat-act"); page.wait_for_timeout(300)
            check("on" in page.get_attribute("#alList .cat-act", "class") and page.evaluate("document.activeElement.classList.contains('cat-act')"), "Add Layer turns into Remove layer")
            check(page.is_visible("#layersBadge") and page.inner_text("#layersBadge") == "1", "Map layers shows 1 after adding a layer")
            res = page.evaluate("axe.run({ exclude: [['.esri-view-root']] }, { runOnly: ['wcag2a','wcag2aa','wcag21a','wcag21aa'] }).then(r => r.violations.map(v => v.id + ': ' + v.nodes.map(n => n.target.join(' ')).slice(0,3).join(', ')))")
            check(not res, f"axe (Add layer) {res}")
            page.screenshot(path=str(shots / f"{cfg}-add-layer.png"))
            page.click("#tabOwnData")
            check(page.is_visible("#csvPick"), "Your own data tab")
            page.keyboard.press("Escape")
            check(page.is_hidden("#addModal") and page.evaluate("document.activeElement.id") == "tool-add", "Escape closes Add layer")
            # open a map from a card: title shows in the header
            page.click("#tool-open"); page.wait_for_selector("#omList .cat-act")
            page.click("#omList > li:first-child .cat-act"); page.wait_for_timeout(500)
            check(page.is_visible("#docTitle") and page.input_value("#docTitle") != "", "title shows after opening a map")
            check(page.evaluate("!!window.__stub.openedWebMap"), "web map opened")
            # the opened map's layers (1) and its bookmark (a blue dot), also said to screen readers
            badge = page.evaluate("""() => { const b = document.querySelector('#layersBadge'), d = document.querySelector('#bookmarksDot'), r = b.getBoundingClientRect(), t = document.querySelector('#tool-layers').getBoundingClientRect();
              return { n: b.hidden ? null : b.textContent, dot: !d.hidden, dotColour: getComputedStyle(d).backgroundColor, bg: getComputedStyle(b).backgroundColor,
                inside: r.left >= t.left && r.right <= t.right && r.top >= t.top, sr: document.querySelector('#layersBadgeSr').textContent, srB: document.querySelector('#bookmarksDotSr').textContent }; }""")
            one_layer, one_bm = (", 1 capa", ", 1 marcador") if cfg == "example-es" else (", 1 layer", ", 1 bookmark")
            check(badge["n"] == "1" and badge["inside"] and badge["bg"] == "rgb(199, 235, 255)" and badge["sr"] == one_layer, f"Map layers count after opening a map {badge}")
            check(badge["dot"] and badge["dotColour"] == "rgb(0, 121, 193)" and badge["srB"] == one_bm, f"Bookmarks dot {badge}")
            # deleting the only bookmark takes the dot away; adding one brings it back
            page.click("#tool-bookmarks"); page.click("#bmList .mini"); page.click("#bmDelete"); page.wait_for_timeout(150)
            check(page.is_hidden("#bookmarksDot") and page.inner_text("#bookmarksDotSr") == "", "no dot without bookmarks")
            page.click("#bmAddBtn"); page.click("#bmSave"); page.wait_for_timeout(150)
            check(page.is_visible("#bookmarksDot"), "dot back after adding a bookmark")
            page.click("#tool-bookmarks")
            page.locator("#toolbar").screenshot(path=str(shots / f"{cfg}-toolbar-badges.png"))
            for w in (1000, 390):   # icons only, narrower buttons: the badge and dot stay on their button
                page.set_viewport_size({"width": w, "height": 800}); page.wait_for_timeout(300)
                fit = page.evaluate("""() => ['layersBadge', 'bookmarksDot'].map(id => { const e = document.getElementById(id).getBoundingClientRect(), b = document.getElementById(id).closest('.tool').getBoundingClientRect();
                  return e.left >= b.left && e.right <= b.right && e.top >= b.top; })""")
                check(fit == [True, True], f"badge and dot inside their buttons at {w}px {fit}")
                page.locator("#toolbar").screenshot(path=str(shots / f"{cfg}-toolbar-badges-{w}.png"))
            page.set_viewport_size({"width": 1910, "height": 937}); page.wait_for_timeout(300)
            # 2D / 3D
            page.click("#tg3d"); page.wait_for_timeout(400)
            check(page.get_attribute("#tg3d", "aria-pressed") == "true", "3D on")
            check(len(page.query_selector_all(".esri-ui-bottom-left .rose")) == 2, "3D view has its compass")
            check(page.evaluate("window.__stub.goTo.some(g => g.tilt === 60)"), "switching to 3D tilts the camera")
            ctl = page.evaluate("[...document.querySelectorAll('#sceneDiv .esri-ui-top-left > *')].map(e => e.className.split(' ').find(c => c.startsWith('esri-') && c !== 'esri-component' && c !== 'esri-widget') || e.tagName)")
            check(ctl.count("esri-zoom") == 1 and ctl.count("esri-navigation-toggle") == 1 and "esri-compass" not in ctl and not page.evaluate("!!window.__stub.views[1].__uiBroken"),
                  f"3D controls drawn: zoom, one pan/rotate toggle, no second compass {ctl}")
            page.click("#tg2d"); page.wait_for_timeout(300); n_goto = page.evaluate("window.__stub.goTo.filter(g => g.tilt).length")
            page.click("#tg3d"); page.wait_for_timeout(300)
            check(page.evaluate("window.__stub.goTo.filter(g => g.tilt).length") == n_goto + 1, "tilts again on each switch to 3D")
            res = page.evaluate("axe.run({ exclude: [['.esri-view-root']] }, { runOnly: ['wcag2a','wcag2aa','wcag21a','wcag21aa'] }).then(r => r.violations.map(v => v.id + ': ' + v.nodes.map(n => n.target.join(' ')).slice(0,3).join(', ')))")
            check(not res, f"axe (map) {res}")
            # tool panel opens with the active colour
            page.click("#tool-legend")
            bg = page.eval_on_selector("#tool-legend", "e => getComputedStyle(e).backgroundColor")
            if cfg == "mapmaker": check(bg == "rgb(160, 220, 255)", f"active tool colour {bg}")
            check(not errors, f"console errors {errors[:3]}")
            ctx.close()

            # Local save is a web map: open a web map file, save it, check the JSON, reopen it
            ctx = browser.new_context(viewport={"width": 1600, "height": 900}, accept_downloads=True)
            ctx.add_init_script("delete window.showSaveFilePicker; delete window.showOpenFilePicker;")
            page = ctx.new_page(); page.route("**/*", route); page.on("dialog", lambda d: d.accept())
            errors = []; page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(f"{base}/index.html?config={cfg}"); page.wait_for_function("window.__stub && window.__stub.views.length > 0"); page.wait_for_timeout(500)
            trip = shots / "Field_trip.mmap"; trip.write_text(json.dumps(TRIP_FILE))
            page.click("#tool-open"); page.click("#tabDevice")
            with page.expect_file_chooser() as fc: page.click("#browseDevice")
            fc.value.set_files(str(trip)); page.wait_for_timeout(800)
            loaded = page.evaluate("window.__stub.fromJSON")
            check(loaded and [o["id"] for o in loaded["operationalLayers"]] == ["parks"], f"file layers checked before loading {loaded and [o['id'] for o in loaded['operationalLayers']]}")
            check(page.input_value("#docTitle") == "Field trip", "title from the file name")
            page.click("#tool-bookmarks"); check(len(page.query_selector_all("#bmList li")) == 1, "bookmark from the file")
            page.click("#bookmarksPanel [data-close]")
            page.click("#tool-save")
            with page.expect_download() as dl:
                page.click("#saveTile"); page.wait_for_selector("#nameModal:not([hidden])"); page.fill("#fileNameInput", "Field_trip_2"); page.click("#nameConfirm")
            saved = json.loads(pathlib.Path(dl.value.path()).read_text())
            check(set(saved) <= SPEC_ROOT, f"only spec properties {sorted(set(saved) - SPEC_ROOT)}")
            check(all(k in saved for k in ("authoringApp", "authoringAppVersion", "baseMap", "spatialReference", "version")), "required web map properties")
            ids = [o["id"] for o in saved["operationalLayers"]]
            check(ids == ["parks", "__data_csv1", "__sketch_points"], f"saved layers {ids}")
            check(saved["operationalLayers"][0]["visibility"] is False, "layer visibility kept")
            check(saved["baseMap"]["title"] == "Imagery", "basemap kept")
            sk = saved["operationalLayers"][2]["featureCollection"]["layers"][0]
            check(sk["featureSet"]["features"][0]["attributes"]["imageUrl"].startswith("data:image/png") and sk["popupInfo"]["mediaInfos"][0]["value"]["sourceURL"] == "{imageUrl}", "sketch picture saved and shown in pop-ups elsewhere")
            check(saved["bookmarks"][0]["name"] == "Camp" and saved["bookmarks"][0]["thumbnail"]["url"].startswith("data:image"), "bookmark with thumbnail")
            vis = sorted(v["id"] for v in saved["presentation"]["slides"][0]["visibleLayers"])
            check(vis == ["__sketch_points", "parks"], f"bookmark's layers on/off {vis}")
            check(saved["initialState"]["viewpoint"]["targetGeometry"]["spatialReference"]["wkid"] == 102100 and saved["initialState"]["viewpoint"].get("scale"), "view saved")
            # a collection map plus a layer from Add layer, saved and reopened
            page.click("#tool-open"); page.click("#tabGroup"); page.wait_for_selector("#omList .cat-act"); page.click("#omList > li:first-child .cat-act"); page.wait_for_timeout(600)
            page.click("#tool-add"); page.wait_for_selector("#alList .cat-act"); page.fill("#alSearch", "annual average"); page.wait_for_timeout(300)
            page.click("#alList .cat-act"); page.wait_for_timeout(400); page.keyboard.press("Escape")
            page.click("#tool-save")
            with page.expect_download() as dl:
                page.click("#saveTile"); page.wait_for_selector("#nameModal:not([hidden])"); page.fill("#fileNameInput", "Collection_map"); page.click("#nameConfirm")
            saved2 = json.loads(pathlib.Path(dl.value.path()).read_text())
            ids2 = [o["id"] for o in saved2["operationalLayers"]]
            check(ids2 == ["rivers", "__item_" + "d" * 32], f"collection map layers {ids2}")
            check(saved2["operationalLayers"][1].get("itemId") == "d" * 32 and saved2["operationalLayers"][1]["url"].endswith("/FeatureServer/0"), "added layer keeps its item and address")
            check(saved2["baseMap"]["title"] == "Topographic" and saved2["bookmarks"][0]["name"] == "Amazon", "collection map's basemap and bookmark")
            back = shots / "Collection_map.mmap"; back.write_text(json.dumps(saved2))
            page.click("#tool-open"); page.click("#tabDevice")
            with page.expect_file_chooser() as fc: page.click("#browseDevice")
            fc.value.set_files(str(back)); page.wait_for_timeout(800)
            page.click("#tool-add"); page.wait_for_selector("#alList .cat-act"); page.fill("#alSearch", "annual average"); page.wait_for_timeout(300)
            check("on" in (page.get_attribute("#alList .cat-act", "class") or ""), "reopened file knows the added layer")
            check(not errors, f"console errors (save/open) {errors[:3]}")
            ctx.close()

            # Phone
            ctx = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
            page = ctx.new_page(); page.route("**/*", route)
            page.goto(f"{base}/index.html?config={cfg}"); page.wait_for_function("window.__stub && window.__stub.views.length > 0"); page.wait_for_timeout(800)
            check(page.evaluate("document.documentElement.scrollWidth <= innerWidth"), "no sideways page scroll on phone")
            check(page.evaluate(OVERLAP_JS) == {"stack": False, "attribution": False, "corner": False}, "nothing under the toolbar (phone): " + str(page.evaluate(OVERLAP_JS)))
            check(page.is_visible("#verBtn"), "version shown on phone")
            check(not page.evaluate("""() => { const a = document.querySelector('.corner').getBoundingClientRect(), b = document.querySelector('#viewDiv .ll-stack').getBoundingClientRect();
              return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top; }"""), "version button clear of compass and scale bar (phone)")
            page.screenshot(path=str(shots / f"{cfg}-phone.png"))
            page.click("#tool-open"); page.wait_for_selector("#omList .cat-card"); page.wait_for_timeout(300)
            check(page.is_hidden("#omSide") and page.get_attribute("#omCatsBtn", "aria-expanded") == "false", "categories folded away on phone")
            page.click("#omCatsBtn"); check(page.is_visible("#omSide"), "Categories button shows them")
            check(page.evaluate("document.documentElement.scrollWidth <= innerWidth"), "Open map fits the phone")
            page.screenshot(path=str(shots / f"{cfg}-phone-open.png"))
            ctx.close()
        # Developer kit example (kit/example): add a CSV, save to a file, open it again
        print("== kit example")
        ctx = browser.new_context(viewport={"width": 1280, "height": 800}, accept_downloads=True)
        ctx.add_init_script("delete window.showSaveFilePicker; delete window.showOpenFilePicker;")
        page = ctx.new_page(); page.route("**/*", route)
        errors = []; page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "favicon" not in m.text else None)
        page.goto(f"{base}/kit/example/index.html"); page.wait_for_function("document.querySelector('#status').textContent.startsWith('Ready')")
        check("Kit 1.0" in page.inner_text("#versions") and page.is_visible("text=Created by Jason Sawle"), "example shows versions and credit")
        csv = shots / "trees.csv"; csv.write_text("Site,Latitude,Longitude,Species,Height\nA,51.5,-0.12,Oak,12\nB,51.6,-0.11,Ash,9\nC,51.55,-0.1,Oak,15\n")
        page.set_input_files("#csvInput", str(csv)); page.wait_for_timeout(300)
        check(page.inner_text("#status").startswith("Added 3 points"), "example adds a CSV: " + page.inner_text("#status"))
        with page.expect_download() as dl: page.click("#save")
        saved = json.loads(pathlib.Path(dl.value.path()).read_text())
        check(set(saved) <= SPEC_ROOT and [o["id"] for o in saved["operationalLayers"]][0].startswith("__data_"), f"example saves a web map {list(saved)}")
        check(saved["operationalLayers"][0]["featureCollection"]["layers"][0]["featureSet"]["features"][0]["attributes"]["Species"] == "Oak", "spreadsheet rows in the file")
        back = shots / "kit_map.mmap"; back.write_text(json.dumps(saved))
        with page.expect_file_chooser() as fc: page.click("#openFile")
        fc.value.set_files(str(back)); page.wait_for_timeout(500)
        check("1 spreadsheet layer" in page.inner_text("#status"), "example reopens the file: " + page.inner_text("#status"))
        page.add_script_tag(content=axe_js)
        res = page.evaluate("axe.run({ exclude: [['.esri-view-root']] }, { runOnly: ['wcag2a','wcag2aa','wcag21a','wcag21aa'] }).then(r => r.violations.map(v => v.id + ': ' + v.nodes.map(n => n.target.join(' ')).slice(0,3).join(', ')))")
        check(not res, f"axe (kit example) {res}")
        check(not errors, f"console errors (kit example) {errors[:3]}")
        page.screenshot(path=str(shots / "kit-example.png"))
        ctx.close()
        browser.close()
    print(f"{checks[0] - len(failures)}/{checks[0]} checks passed")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
