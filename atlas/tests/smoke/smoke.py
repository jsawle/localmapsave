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


def search_response(params):
    q = params.get("q", "")
    if 'type:"Web Map"' not in q:
        return {"total": 0, "start": 1, "num": 0, "nextStart": -1, "results": []}
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
            elif re.search(r"/content/items/\w+/data$", u.path): body = {"operationalLayers": [], "baseMap": {}}
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
            page.goto(f"{base}/index.html?config={cfg}"); page.wait_for_function("window.__stub && window.__stub.views.length > 0")
            page.wait_for_timeout(600)

            # Toolbar: MapMaker's order and size
            ids = page.eval_on_selector_all("#toolbar > *:not([hidden])", "els => els.map(e => e.id)")
            check(ids == ["tool-basemaps", "tool-open", "tool-layers", "tool-add", "tool-legend", "tool-measure", "tool-sketch", "viewSeg", "tool-bookmarks", "tool-save"], f"toolbar order {ids}")
            box = page.eval_on_selector("#toolbar", "e => { const r = e.getBoundingClientRect(); return [r.width, r.height, innerHeight - r.bottom]; }")
            check(840 <= box[0] <= 860 and 86 <= box[1] <= 90, f"toolbar size {box}")
            # Icons: every one becomes Esri's Calcite icon once drawn
            page.wait_for_function("[...document.querySelectorAll('.ti[data-icon]')].every(s => s.querySelector('calcite-icon:not(.pending)') && !s.querySelector('svg'))", timeout=15000)
            check(True, "calcite icons")
            # Compass rose above the scale bar, bottom-left
            stack = page.eval_on_selector(".esri-ui-bottom-left .ll-stack", "e => [...e.children].map(c => c.className || c.tagName)")
            check(stack[0] == "rose" and len(stack) == 2, f"bottom-left stack {stack}")
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
            check(page.inner_text("#verBtn") == "v1.1.0" and page.inner_text(".credit") == "Created by Jason Sawle", "version and credit corner")
            check(page.evaluate(OVERLAP_JS) == {"stack": False, "attribution": False, "corner": False}, "nothing under the toolbar (desktop)")
            page.screenshot(path=str(shots / f"{cfg}-desktop.png"))
            page.set_viewport_size({"width": 1280, "height": 800}); page.wait_for_timeout(500)
            check(page.evaluate(OVERLAP_JS) == {"stack": False, "attribution": False, "corner": False}, "nothing under the toolbar (1280 wide): " + str(page.evaluate(OVERLAP_JS)))
            page.screenshot(path=str(shots / f"{cfg}-1280.png"))
            page.set_viewport_size({"width": 1910, "height": 937}); page.wait_for_timeout(300)

            # Open map: topics
            page.click("#tool-open"); page.wait_for_selector("#topicList .topic")
            check(page.eval_on_selector("#tabGroup", "e => e.getBoundingClientRect().height") >= 30, "tabs row not squashed")
            topics = page.eval_on_selector_all("#topicList .topic", "bs => bs.map(b => [b.dataset.key, b.querySelector('.count') && b.querySelector('.count').firstChild.textContent])")
            check(topics[0][0] == "" and topics[0][1] == str(len(ITEMS)), f"All maps count {topics[0]}")
            for k, c in topics[1:]:
                if k == "__other__": check(int(c) == other, f"other {c} vs {other}")
                else: check(int(c) == counts[k], f"count {k} {c} vs {counts[k]}")
            shown = {k for k, _ in topics}
            check("/categories/national geographic explorers" not in shown, "empty topic hidden")
            check(len(page.query_selector_all("#groupGrid > li")) == 24 and page.is_visible("#groupMore"), "first page of cards")
            page.click("#groupMore"); check(len(page.query_selector_all("#groupGrid > li")) == 48, "show more")
            hg = "/categories/human geography"
            page.click(f'#topicList .topic[data-key="{hg}"]')
            check(page.inner_text("#topicTitle") == "Human Geography", "topic title")
            check(len(page.query_selector_all("#groupGrid > li")) == min(24, counts[hg]), "topic cards")
            chips = page.eval_on_selector_all("#subTopics .chip", "cs => cs.map(c => c.dataset.key)")
            check(chips[0] == hg and len(chips) > 3, f"sub-topic chips {chips[:3]}")
            check(page.evaluate("document.activeElement.dataset.key") == hg, "focus stays on topic")
            pp = hg + "/populated places"
            page.click(f'#subTopics .chip[data-key="{pp}"]')
            check(page.get_attribute(f'#subTopics .chip[data-key="{pp}"]', "aria-pressed") == "true", "chip pressed")
            check(page.is_visible("#topicCrumbs") and "Human Geography" in page.inner_text("#topicCrumbs"), "breadcrumb")
            check(any("Light Pollution" in t for t in page.eval_on_selector_all("#groupGrid .card-title", "e => e.map(x => x.textContent)")), "lower-case category path matched")
            check(page.get_attribute(f'#topicList .topic[data-key="{hg}"]', "aria-current") == "true", "sidebar marks parent topic")
            page.fill("#groupSearch", "zzzz"); page.wait_for_timeout(400)
            check(page.is_visible("#searchAllBtn") and len(page.query_selector_all("#groupGrid > li")) == 0, "no match offers search all")
            page.click("#searchAllBtn"); page.wait_for_timeout(300)
            check(page.inner_text("#topicTitle") in ("All maps", "Todos los mapas"), "search all goes to All maps")
            page.fill("#groupSearch", "volcanoes"); page.wait_for_timeout(400)
            check(len(page.query_selector_all("#groupGrid > li")) == 1, "search uses description text")
            page.fill("#groupSearch", "geografia panama"); page.wait_for_timeout(400)
            check(len(page.query_selector_all("#groupGrid > li")) == 1, "accent-insensitive search")
            page.fill("#groupSearch", "")
            page.click('#topicList .topic[data-key="__other__"]'); page.wait_for_timeout(200)
            check(len(page.query_selector_all("#groupGrid > li")) == other, "other maps")
            # keyboard: arrows move along topics
            page.focus('#topicList .topic[aria-current="true"]'); page.keyboard.press("Home")
            check(page.evaluate("document.activeElement.dataset.key") == "", "Home key")
            page.keyboard.press("ArrowDown")
            check(page.evaluate("document.activeElement.dataset.key") == topics[1][0], "ArrowDown")
            page.keyboard.press("Enter"); page.wait_for_timeout(200)
            check(page.inner_text("#topicTitle") != "", "Enter selects")
            page.screenshot(path=str(shots / f"{cfg}-open-map.png"))
            # accessibility (WCAG 2.1 AA) with the dialog open, map canvas excluded (stand-in SDK)
            page.add_script_tag(content=axe_js)
            res = page.evaluate("axe.run({ exclude: [['.esri-view-root']] }, { runOnly: ['wcag2a','wcag2aa','wcag21a','wcag21aa'] }).then(r => r.violations.map(v => v.id + ': ' + v.nodes.map(n => n.target.join(' ')).slice(0,3).join(', ')))")
            check(not res, f"axe (Open map) {res}")
            # open a map from a card: title shows in the header
            page.click("#groupGrid > li:first-child .btn.primary"); page.wait_for_timeout(500)
            check(page.is_visible("#docTitle") and page.input_value("#docTitle") != "", "title shows after opening a map")
            check(page.evaluate("!!window.__stub.openedWebMap"), "web map opened")
            # 2D / 3D
            page.click("#tg3d"); page.wait_for_timeout(400)
            check(page.get_attribute("#tg3d", "aria-pressed") == "true", "3D on")
            check(len(page.query_selector_all(".esri-ui-bottom-left .rose")) == 2, "3D view has its compass")
            res = page.evaluate("axe.run({ exclude: [['.esri-view-root']] }, { runOnly: ['wcag2a','wcag2aa','wcag21a','wcag21aa'] }).then(r => r.violations.map(v => v.id + ': ' + v.nodes.map(n => n.target.join(' ')).slice(0,3).join(', ')))")
            check(not res, f"axe (map) {res}")
            # tool panel opens with the active colour
            page.click("#tool-legend")
            bg = page.eval_on_selector("#tool-legend", "e => getComputedStyle(e).backgroundColor")
            if cfg == "mapmaker": check(bg == "rgb(160, 220, 255)", f"active tool colour {bg}")
            check(not errors, f"console errors {errors[:3]}")
            ctx.close()

            # Phone
            ctx = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
            page = ctx.new_page(); page.route("**/*", route)
            page.goto(f"{base}/index.html?config={cfg}"); page.wait_for_function("window.__stub && window.__stub.views.length > 0"); page.wait_for_timeout(800)
            check(page.evaluate("document.documentElement.scrollWidth <= innerWidth"), "no sideways page scroll on phone")
            check(page.evaluate(OVERLAP_JS) == {"stack": False, "attribution": False, "corner": False}, "nothing under the toolbar (phone): " + str(page.evaluate(OVERLAP_JS)))
            check(page.is_visible("#verBtn"), "version shown on phone")
            check(not page.evaluate("""() => { const a = document.querySelector('.corner').getBoundingClientRect(), b = document.querySelector('#viewDiv .ll-stack').getBoundingClientRect();
              return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top; }"""), "credit clear of compass and scale bar (phone)")
            page.screenshot(path=str(shots / f"{cfg}-phone.png"))
            page.click("#tool-open"); page.wait_for_selector("#topicList .topic"); page.wait_for_timeout(300)
            check(page.eval_on_selector("#topicList", "e => getComputedStyle(e).display") == "flex", "topics strip on phone")
            page.screenshot(path=str(shots / f"{cfg}-phone-open.png"))
            ctx.close()
        browser.close()
    print(f"{checks[0] - len(failures)}/{checks[0]} checks passed")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
