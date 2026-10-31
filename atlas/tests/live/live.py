"""Runs the Atlas app in Chromium against the real services: the ArcGIS Maps SDK from Esri's CDN and ArcGIS Online itself.

Run:  python3 atlas/tests/live/live.py [--shots DIR] [--proxy URL]
Needs network access to js.arcgis.com, www.arcgis.com and Esri's tile services (an HTTPS proxy is taken from
--proxy or HTTPS_PROXY), Node/npm once (axe-core, via the smoke test's deps folder) and Python Playwright with Chromium.

The smoke and real-SDK tests answer ArcGIS Online with fixtures. This one doesn't, so it sees what a teacher sees:
  - Basemaps: MapMaker's cards (two to a row, picture above, name below), the live group's basemaps in its own order,
    the map's basemap selected; choosing by mouse and keyboard; 3D lists the 3D basemap first; WCAG 2.1 AA scan.
  - Open map > My map files, the Chrome/Edge way: every save is listed, newest first, with a picture of the map; saving the
    same file again updates its entry and Save as adds one; the list survives a reload; opening a map from it reads the file
    and Save goes on writing to that file; removing an entry leaves the file; a moved or deleted file is reported.
    (Chrome's save and open dialogs can't be driven by a test, so they hand back files in the page's private file system:
    real file handles that can be written, compared and kept in the list.)
  - The same list in browsers that can only download (Safari, Firefox): the list keeps a copy, which opens after a reload.
  - Phones: both fit the screen.
"""
import argparse, functools, http.server, json, os, pathlib, sys, tempfile, threading
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
ATLAS = HERE.parent.parent
sys.path.insert(0, str(HERE.parent / "smoke"))
import smoke  # noqa: E402  (finds Chromium, fetches axe-core)

APP_VERSION = "1.15.0-sketch.2"
# The live basemap group's web maps in its own order (date added, newest first), October 2026.
GROUP_ORDER = ["OpenStreetMap Style", "Ocean", "Black and White Outline", "Imagery (no labels)", "Dark Gray", "Human Geography"]
AXE = "axe.run({ exclude: [['.esri-view-root']] }, { runOnly: ['wcag2a','wcag2aa','wcag21a','wcag21aa'] }).then(r => r.violations.map(v => v.id + ': ' + v.nodes.map(n => n.target.join(' ')).slice(0,3).join(', ')))"
# Chrome's save and open dialogs, answered with files in the page's private file system (origin private file system).
PICKERS = """
window.__picker = { saves: 0, opens: 0, next: null, open: null, suggested: null };
window.showSaveFilePicker = async (o) => { __picker.saves++; __picker.suggested = o.suggestedName + ' ' + JSON.stringify(o.types); const d = await navigator.storage.getDirectory(); return d.getFileHandle(__picker.next || o.suggestedName, { create: true }); };
window.showOpenFilePicker = async () => { __picker.opens++; const d = await navigator.storage.getDirectory(); return [await d.getFileHandle(__picker.open)]; };
window.__readFile = async (n) => { const d = await navigator.storage.getDirectory(); return (await (await d.getFileHandle(n)).getFile()).text(); };
window.__deleteFile = async (n) => { const d = await navigator.storage.getDirectory(); await d.removeEntry(n); };
window.__files = async () => { const d = await navigator.storage.getDirectory(); const out = []; for await (const k of d.keys()) out.push(k); return out.sort(); };
"""


def serve(root, port_holder):
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(root)))
    port_holder.append(srv.server_address[1]); srv.serve_forever()


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--shots", default=str(HERE / ".shots")); ap.add_argument("--proxy", default=os.environ.get("HTTPS_PROXY", ""))
    ap.add_argument("--deps", default=str(HERE.parent / "smoke" / ".deps"))
    a = ap.parse_args()
    shots = pathlib.Path(a.shots); shots.mkdir(parents=True, exist_ok=True)
    smoke.ensure_deps(pathlib.Path(a.deps)); axe_js = (pathlib.Path(a.deps) / "axe" / "package" / "axe.min.js").read_text()
    port = []; threading.Thread(target=serve, args=(ATLAS, port), daemon=True).start()
    while not port: pass
    base = f"http://localhost:{port[0]}"   # localhost: a secure context, as the app needs for file handles
    failures, checks = [], [0]

    def check(cond, msg):
        checks[0] += 1
        print(("  ok   " if cond else "  FAIL ") + msg)
        if not cond: failures.append(msg)

    with sync_playwright() as p:
        launch = {"executable_path": smoke.CHROME, "args": ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]}
        if a.proxy: launch["proxy"] = {"server": a.proxy, "bypass": "localhost,127.0.0.1"}
        browser = p.chromium.launch(**launch)

        def start(ctx, cfg="mapmaker"):
            page = ctx.new_page(); errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "favicon" not in m.text and "404" not in m.text else None)
            page.on("dialog", lambda d: d.accept())
            page.on("crash", lambda: errors.append("the page crashed"))
            page.on("console", lambda m: errors.append("SDK warning: " + m.text[:120]) if m.type == "warning" and "#when()" in m.text else None)
            page.goto(f"{base}/index.html?config={cfg}", wait_until="domcontentloaded", timeout=90000)
            page.wait_for_function("document.querySelector('.esri-attribution') && document.querySelector('#verBtn').textContent.length > 1", timeout=90000)
            page.wait_for_timeout(3000)
            return page, errors

        def toast(page, text, timeout=20000):
            page.wait_for_function("t => document.querySelector('#toast').textContent.includes(t)", arg=text, timeout=timeout)

        def saved_cards(page, n=None):
            if n is None: page.wait_for_function("document.querySelector('#savedStatus').textContent.length > 0")
            else: page.wait_for_function("n => document.querySelectorAll('#savedList .cat-card').length === n && document.querySelector('#savedStatus').textContent.length > 0", arg=n, timeout=15000)
            return page.eval_on_selector_all("#savedList .cat-card", """ls => ls.map(l => ({ title: l.querySelector('.cat-card-title').textContent, meta: l.querySelector('.dev-meta').textContent,
              thumb: l.querySelector('.cat-thumb').style.backgroundImage.slice(0, 30), open: l.querySelector('.cat-act:not(.quiet)').getAttribute('aria-label') }))""")

        def wait_list(page, n, thumbs=True):   # the saved list in IndexedDB has n maps (with their pictures)
            page.wait_for_function("""([n, thumbs]) => new Promise(r => { const o = indexedDB.open('atlas-saved-maps'); o.onsuccess = () => { try { const q = o.result.transaction('maps').objectStore('maps').getAll();
              q.onsuccess = () => { r(q.result.length === n && (!thumbs || q.result.every(e => e.thumb))); o.result.close(); }; } catch (e) { r(false); } }; o.onerror = () => r(false); })""", arg=[n, thumbs], timeout=30000)

        def save_panel(page):   # opens Save (the toolbar button toggles it)
            if page.is_hidden("#savePanel"): page.click("#tool-save")

        def open_device_tab(page, n=None):
            page.click("#tool-open"); page.click("#tabDevice"); return saved_cards(page, n)

        # ---------------------------------------------------------------- Basemaps
        print("== Basemaps (live group)")
        ctx = browser.new_context(viewport={"width": 1524, "height": 768}, device_scale_factor=1.25)
        page, errors = start(ctx)
        check(page.inner_text("#verBtn") == "v" + APP_VERSION, "version " + page.inner_text("#verBtn"))
        page.click("#tool-basemaps"); page.wait_for_selector("#basemapsGrid .bmg-card", timeout=30000)
        names = page.eval_on_selector_all("#basemapsGrid .bmg-card .bmg-title", "e => e.map(x => x.textContent)")
        check(names[:6] == GROUP_ORDER and "3D Buildings" not in names, f"the group's basemaps in its order, no 3D basemap in 2D {names[:7]}")
        check(page.inner_text("#basemapsIntro") == "Select a basemap to refine the color of your map.", "MapMaker's line of text")
        sel = page.eval_on_selector_all('.bmg-card[aria-pressed="true"]', "e => e.map(x => x.textContent)")
        check(sel == ["National Geographic Style"], f"the map's basemap is selected {sel}")
        page.wait_for_function("[...document.querySelectorAll('.bmg-thumb')].slice(0, 6).every(i => i.complete && i.naturalWidth > 0)", timeout=30000)
        widths = page.eval_on_selector_all(".bmg-thumb", "e => e.slice(0, 6).map(i => i.naturalWidth)")
        check(widths.count(400) >= 5 and min(widths) >= 200, f"pictures from the group's thumbnails, 400px wide where the item has one that big {widths}")
        geo = page.evaluate("""() => { const r = (e) => e.getBoundingClientRect(), p = r(document.querySelector('#basemapsPanel')), cs = [...document.querySelectorAll('.bmg-card')].slice(0, 3).map(r);
          const th = r(document.querySelector('.bmg-thumb')), ti = r(document.querySelector('.bmg-title')), m = r(document.querySelector('#mapWrap'));
          return { w: p.width, top: p.top - m.top, right: m.right - p.right, cardW: cs[0].width, sameRow: Math.abs(cs[0].top - cs[1].top) < 1, gap: cs[1].left - cs[0].right,
            rowGap: cs[2].top - cs[0].bottom, picAbove: th.bottom <= ti.top + 0.5, picH: th.height, head: r(document.querySelector('#basemapsPanel .panel-head')).height,
            titlePx: getComputedStyle(document.querySelector('.bmg-title')).fontSize, introPx: getComputedStyle(document.querySelector('#basemapsIntro')).fontSize }; }""")
        check(abs(geo["w"] - 374) < 1 and abs(geo["top"] - 15) < 1 and abs(geo["right"] - 6) < 1, f"panel where MapMaker's is, 374px wide {geo}")
        check(geo["sameRow"] and abs(geo["gap"] - 16) < 1 and abs(geo["rowGap"] - 12) < 1 and 150 <= geo["cardW"] <= 156 and geo["picAbove"] and 98 <= geo["picH"] <= 104,
              "two cards to a row, picture above the name, MapMaker's spacing")
        check(geo["titlePx"] == "12px" and geo["introPx"] == "14px" and abs(geo["head"] - 39) < 1, "MapMaker's type sizes and header height")
        page.screenshot(path=str(shots / "basemaps.png"))
        page.click('.bmg-card:has-text("Ocean")'); page.wait_for_timeout(1500)
        check(page.eval_on_selector_all('.bmg-card[aria-pressed="true"]', "e => e.map(x => x.textContent)") == ["Ocean"], "choosing a card selects it")
        page.focus('.bmg-card:has-text("Black and White Outline")'); page.keyboard.press("ArrowRight"); page.keyboard.press("ArrowDown")
        check(page.evaluate("document.activeElement.textContent") == "Human Geography", "arrow keys move across and down the grid")
        page.keyboard.press("Enter"); page.wait_for_timeout(1500)
        check(page.eval_on_selector_all('.bmg-card[aria-pressed="true"]', "e => e.map(x => x.textContent)") == ["Human Geography"], "Enter chooses it")
        page.add_script_tag(content=axe_js); res = page.evaluate(AXE)
        check(not res, f"axe (Basemaps) {res}")
        page.click("#tg3d"); page.wait_for_timeout(8000)
        names3 = page.eval_on_selector_all("#basemapsGrid .bmg-title", "e => e.map(x => x.textContent)")
        check(names3[:3] == ["3D Buildings", "OpenStreetMap Style", "Ocean"], f"3D: the 3D basemap first {names3[:3]}")
        check(page.eval_on_selector_all('.bmg-card[aria-pressed="true"]', "e => e.map(x => x.textContent)") == ["Human Geography"], "3D keeps the choice")
        page.click("#tg2d"); page.wait_for_timeout(3000)
        check(not errors, f"console errors (basemaps) {errors[:3]}")
        ctx.close()

        # ---------------------------------------------------------------- Saved maps, Chrome/Edge (file handles)
        print("== My map files (Chrome and Edge: file handles)")
        # A normal browser profile, as people use. (In Playwright's private-mode contexts Chromium crashes reading a file
        # handle back from IndexedDB, which is why the app keeps handles out of the list itself: see the phone check below.)
        ctx = p.chromium.launch_persistent_context(tempfile.mkdtemp(prefix="atlas-live-"), viewport={"width": 1524, "height": 768}, **launch)
        ctx.add_init_script(PICKERS)
        page, errors = start(ctx)
        cards = open_device_tab(page)
        check(cards == [] and page.inner_text("#savedStatus") == "Maps you save will be listed here.", "empty list says what it's for")
        lead = page.evaluate("() => document.querySelector('.dev-top .note').getBoundingClientRect().left - document.querySelector('.open-card').getBoundingClientRect().left")
        check(lead >= 20, f"text clear of the dialog's edge ({lead}px)")
        # a real MapMaker map, saved
        page.click("#tabGroup"); page.wait_for_selector("#omList .cat-act", timeout=30000)
        page.fill("#omSearch", "Revolutionary Battles"); page.wait_for_timeout(600)
        title = page.inner_text("#omList > li:first-child .cat-card-title")
        page.click("#omList > li:first-child .cat-act")
        page.wait_for_function("t => document.querySelector('#docTitle').value === t", arg=title, timeout=30000); page.wait_for_timeout(4000)
        layers = page.inner_text("#layersBadge")
        page.evaluate("window.__picker.next = 'battles.amap'")
        save_panel(page); page.click("#saveTile"); toast(page, "Saved battles.amap")
        wait_list(page, 1)
        sug = page.evaluate("window.__picker.suggested")
        check(sug.split(" ")[0].endswith(".amap") and '[".amap"]' in sug, f"the save dialog suggests an .amap file {sug}")
        cards = open_device_tab(page, 1)
        check(len(cards) == 1 and cards[0]["title"] == "battles" and "battles.amap" in cards[0]["meta"] and cards[0]["meta"].startswith("Saved "), f"saved map listed {cards}")
        check(cards[0]["thumb"].startswith('url("data:image/jpeg'), "with a picture of the map")
        check(page.inner_text("#savedStatus") == "1 map saved in this browser" and "doesn't delete its file" in page.inner_text("#savedNote"), "count and note")
        page.screenshot(path=str(shots / "device-one.png"))
        page.keyboard.press("Escape")
        # Save again: same file, same entry, no dialog
        page.click("#tool-basemaps"); page.wait_for_selector(".bmg-card"); page.click('.bmg-card:has-text("Dark Gray")'); page.wait_for_timeout(800)
        save_panel(page); page.click("#saveTile"); toast(page, "Saved battles.amap"); page.wait_for_timeout(1500)
        check(page.evaluate("window.__picker.saves") == 1, "Save writes to the same file without asking again")
        check(json.loads(page.evaluate("__readFile('battles.amap')"))["baseMap"]["title"] == "Human Geography Dark", "the file has the change (the Dark Gray item's basemap)")
        wait_list(page, 1); page.wait_for_timeout(500)
        cards = open_device_tab(page)
        check(len(cards) == 1, f"saving the same file again keeps one entry ({len(cards)})")
        page.keyboard.press("Escape")
        # Save as: a second file, listed first
        page.evaluate("window.__picker.next = 'battles_copy.amap'")
        save_panel(page); page.click("#saveAsTile"); toast(page, "Saved battles_copy.amap"); wait_list(page, 2)
        cards = open_device_tab(page, 2)
        check([c["meta"].split(" · ")[-1] for c in cards] == ["battles_copy.amap", "battles.amap"], f"Save as adds one, newest first {[c['meta'] for c in cards]}")
        page.add_script_tag(content=axe_js); res = page.evaluate(AXE)
        check(not res, f"axe (My map files) {res}")
        page.screenshot(path=str(shots / "device-two.png"))
        # A new visit: the list is still there; open the older one from it
        page.reload(); page.wait_for_function("document.querySelector('.esri-attribution')", timeout=90000); page.wait_for_timeout(2500)
        cards = open_device_tab(page, 2)
        check(len(cards) == 2, "the list is still there after a reload")
        page.click('#savedList .cat-card:nth-child(2) .cat-act:not(.quiet)')
        page.wait_for_function("t => document.querySelector('#docTitle').value === t", arg="battles", timeout=30000); page.wait_for_timeout(4000)
        check(page.is_hidden("#openModal") and page.inner_text("#layersBadge") == layers, f"opens from the list: title from the file, {layers} layers")
        page.click("#tool-basemaps"); page.wait_for_selector(".bmg-card")
        page.wait_for_function("document.querySelector('.bmg-card[aria-pressed=\"true\"]')", timeout=20000)
        check(page.eval_on_selector_all('.bmg-card[aria-pressed="true"]', "e => e.map(x => x.textContent)") == ["Dark Gray"], "with its basemap, found by the name inside the item")
        page.click('.bmg-card:has-text("Ocean")'); page.wait_for_timeout(800)
        save_panel(page); page.click("#saveTile"); toast(page, "Saved battles.amap"); page.wait_for_timeout(1500)
        check(page.evaluate("window.__picker.saves") == 0 and json.loads(page.evaluate("__readFile('battles.amap')"))["baseMap"]["title"] == "Oceans",
              "Save after opening from the list writes to that file")
        page.click("#tool-open"); page.click("#tabDevice")
        page.wait_for_function("() => { const m = document.querySelector('#savedList .cat-card .dev-meta'); return m && m.textContent.endsWith('battles.amap'); }", timeout=15000)
        check(True, "and moves it to the top")
        # Remove from the list: the file stays
        page.click('#savedList .cat-card:nth-child(2) .cat-act.quiet'); toast(page, "from the list")
        cards = saved_cards(page, 1)
        check(len(cards) == 1 and page.evaluate("__files()") == ["battles.amap", "battles_copy.amap"], "removing from the list leaves the file")
        check(page.evaluate("document.activeElement.classList.contains('cat-act')"), "focus moves to the next card")
        # A file that has gone
        page.evaluate("__deleteFile('battles.amap')")
        page.click('#savedList .cat-card:first-child .cat-act:not(.quiet)'); toast(page, "isn't where it was saved")
        check(page.is_visible("#openModal"), "a missing file is reported and the dialog stays open")
        check(not errors, f"console errors (My map files) {errors[:3]}")
        ctx.close()

        # ---------------------------------------------------------------- Saved maps, Safari/Firefox (downloads)
        print("== My map files (browsers that only download)")
        ctx = browser.new_context(viewport={"width": 1524, "height": 768}, accept_downloads=True)
        ctx.add_init_script("delete window.showSaveFilePicker; delete window.showOpenFilePicker;")
        page, errors = start(ctx, "default")
        page.click("#tool-basemaps"); page.wait_for_selector(".bmg-card", timeout=30000); page.click('.bmg-card:has-text("Ocean")'); page.wait_for_timeout(800)
        page.click("#tool-save")
        with page.expect_download() as dl:
            page.click("#saveTile"); page.wait_for_selector("#nameModal:not([hidden])"); page.fill("#fileNameInput", "field_trip"); page.click("#nameConfirm")
        downloaded = pathlib.Path(dl.value.path()).read_text()
        wait_list(page, 1)
        cards = open_device_tab(page, 1)
        check(len(cards) == 1 and "field_trip.amap" in cards[0]["meta"] and "keeps a copy" in page.inner_text("#savedNote"), f"download listed, with the note about the copy {cards}")
        page.reload(); page.wait_for_function("document.querySelector('.esri-attribution')", timeout=90000); page.wait_for_timeout(2500)
        open_device_tab(page, 1)
        page.click('#savedList .cat-card:first-child .cat-act:not(.quiet)')
        page.wait_for_function("document.querySelector('#docTitle').value === 'field trip'", timeout=30000); page.wait_for_timeout(2000)
        page.click("#tool-basemaps"); page.wait_for_selector(".bmg-card"); page.wait_for_function("document.querySelector('.bmg-card[aria-pressed=\"true\"]')", timeout=20000)
        check(page.eval_on_selector_all('.bmg-card[aria-pressed="true"]', "e => e.map(x => x.textContent)") == ["Ocean"] and json.loads(downloaded)["baseMap"]["title"] == "Oceans",
              "the copy opens after a reload, as downloaded")
        # Change a spreadsheet layer's style from Map layers (real SDK: the pie chart and the legend draw)
        page.click("#tool-add"); page.click("#tabOwnData")
        with page.expect_file_chooser() as fc: page.click("#csvPick")
        fc.value.set_files(str(HERE / "litter.csv")); page.wait_for_selector("#dataSubmit:not([disabled])"); page.click("#dataSubmit"); page.wait_for_timeout(3000)
        if page.is_hidden("#layersPanel"): page.click("#tool-layers")
        page.click("#layersList button[data-style-for]"); page.wait_for_timeout(1500)
        check(page.inner_text("#dataH") == "Style: litter" and "Type" in page.inner_text('#styleList [aria-pressed="true"]'), "Change style opens with the layer's current style")
        page.click('#styleList .style-card:has-text("Pie")'); page.wait_for_timeout(1500); page.click("#dataSubmit"); page.wait_for_timeout(3000)
        check(page.inner_text("#toast").startswith("Changed the style") and page.is_visible("#layersPanel"), "Apply changes it and goes back to Map layers")
        page.click("#tool-legend"); page.wait_for_timeout(3000)
        leg = page.inner_text("#legendBody")
        check(all(w in leg for w in ("Plastic", "Glass", "Metal")), "the legend shows the pie chart's columns: " + leg.replace("\n", " | ")[:120])
        # Coordinates written with N/S/E/W and degrees-minutes-seconds land in the right place
        def add_csv(name):
            if page.is_visible("#dataPanel"): page.click("#dataCancel")
            page.click("#tool-add"); page.click("#tabOwnData")
            with page.expect_file_chooser() as fc: page.click("#csvPick")
            fc.value.set_files(str(HERE / name)); page.wait_for_selector("#dataSubmit:not([disabled])"); page.wait_for_timeout(2500)
        add_csv("uk_letters.csv")
        check(page.inner_text("#dataSummary").startswith("Found 3 points") and "skipped" not in page.inner_text("#dataSummary"), "N/S/E/W and degrees-minutes-seconds read: " + page.inner_text("#dataSummary"))
        page.click("#dataSubmit"); page.wait_for_timeout(3000)
        # Swap latitude and longitude puts swapped columns right
        add_csv("uk_swapped.csv")
        check(page.is_visible("#dataSwap"), "Swap offered")
        page.click("#dataSwap"); page.wait_for_timeout(2500)
        check(page.inner_text("#toast").startswith("Swapped latitude and longitude: 3 points"), "swap: " + page.inner_text("#toast"))
        page.click("#dataSubmit"); page.wait_for_timeout(3000)
        page.click("#tool-save")
        with page.expect_download() as dl:
            page.click("#saveTile"); page.wait_for_selector("#nameModal:not([hidden])"); page.fill("#fileNameInput", "uk_points"); page.click("#nameConfirm")
        uk = json.loads(pathlib.Path(dl.value.path()).read_text())
        import math
        def lonlat(f):
            x, y = f["geometry"]["x"], f["geometry"]["y"]
            return round(x / 6378137 * 180 / math.pi, 3), round((2 * math.atan(math.exp(y / 6378137)) - math.pi / 2) * 180 / math.pi, 3)
        pts = {o["title"]: [lonlat(f) for f in o["featureCollection"]["layers"][0]["featureSet"]["features"]] for o in uk["operationalLayers"] if o["title"] in ("uk letters", "uk swapped")}
        check(pts.get("uk letters") == [(1.079, 51.28), (0.873, 51.146), (-0.128, 51.507)], f"letters: points in Kent and London {pts.get('uk letters')}")
        check(pts.get("uk swapped") == [(1.079, 51.28), (0.873, 51.146), (-0.128, 51.507)], f"swapped: the same places {pts.get('uk swapped')}")
        check(not errors, f"console errors and SDK view warnings (downloads, change style, coordinates) {errors[:3]}")
        ctx.close()

        # ---------------------------------------------------------------- Phone
        print("== Phone")
        ctx = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
        ctx.add_init_script(PICKERS)
        page, errors = start(ctx)
        page.click("#tool-basemaps"); page.wait_for_selector(".bmg-card", timeout=30000); page.wait_for_timeout(1500)
        fit = page.evaluate("() => { const p = document.querySelector('#basemapsPanel').getBoundingClientRect(); return p.left >= 0 && p.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth; }")
        cols = page.evaluate("getComputedStyle(document.querySelector('#basemapsGrid')).gridTemplateColumns.split(' ').length")
        check(fit and cols == 2, f"Basemaps fits the phone, two to a row ({cols})")
        page.screenshot(path=str(shots / "phone-basemaps.png"))
        page.click("#tool-basemaps")
        page.evaluate("window.__picker.next = 'phone.amap'"); save_panel(page); page.click("#saveTile"); toast(page, "Saved phone.amap"); wait_list(page, 1)
        cards = open_device_tab(page, 1)
        check(len(cards) == 1 and page.evaluate("document.documentElement.scrollWidth <= innerWidth"), "My map files lists it and fits the phone (private-mode context: the list never reads file handles)")
        page.screenshot(path=str(shots / "phone-device.png"))
        ctx.close()
        browser.close()
    print(f"{checks[0] - len(failures)}/{checks[0]} checks passed")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
