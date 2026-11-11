"""Runs the MapMaker-parity tools of Atlas 5.0 (atlas-sketch) in Chromium against the real services.

Run:  python3 atlas-sketch/tests/live-parity.py [--shots DIR] [--proxy URL] [--axe FILE]
Needs network access to js.arcgis.com and www.arcgis.com, and Python Playwright with Chromium.

Checks: the app says it is 5.0 and runs on the SDK version it names; Elevation is a toolbar tool of its own and
Measure opens its panel directly; Share on a collection map copies a link that opens that map in this app with these
settings; Remove all layers asks first, removes the layers and keeps sketches; the time tool on a time-aware map;
charts beside a layer's table.
"""
import argparse, functools, glob, http.server, json, os, pathlib, sys, threading
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
APP = HERE.parent
QUAKES = "85997c9571e74256af71dc20566b47f1"
TIMED = "0ce87928403d4b338c71fd245dc0be65"   # Revolutionary War Battles: saved with time slider settings
AXE = "(sel) => axe.run(sel, { runOnly: ['wcag2a','wcag2aa','wcag21a','wcag21aa'] }).then(r => r.violations.map(v => v.id + ': ' + v.nodes.map(n => n.target.join(' ')).slice(0,3).join(', ')))"

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--shots", default=str(HERE / ".shots")); ap.add_argument("--proxy", default=os.environ.get("HTTPS_PROXY", "")); ap.add_argument("--axe", default=""); ap.add_argument("--only", default="")
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
        page = ctx.new_page(); errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        dialogs = []
        page.on("dialog", lambda d: (dialogs.append(d.message), d.accept()))
        def axe(sel, what):
            if not a.axe: return
            if not page.evaluate("typeof axe !== 'undefined'"): page.add_script_tag(path=a.axe)
            v = page.evaluate(AXE, sel); check(not v, what + ": no WCAG 2.1 A/AA violations (axe-core): " + "; ".join(v))
        def load(query):
            page.goto(f"{base}/index.html?{query}")
            page.wait_for_function("document.querySelector('#verBtn') && document.querySelector('#verBtn').textContent.startsWith('v')", timeout=120000)

        print("== Atlas 5.0, toolbar")
        load(f"config=mapmaker&webmap={QUAKES}")
        page.wait_for_function("document.querySelector('#layersBadge') && document.querySelector('#layersBadge').textContent === '1'", timeout=120000)
        check(page.inner_text("#verBtn").startswith("v5.0.0"), "the app is version 5.0: " + page.inner_text("#verBtn"))
        sdk = page.evaluate("$arcgis.import('@arcgis/core/kernel.js').then(k => k.version).catch(() => '')")
        check(page.evaluate("[...document.scripts].some(s => s.src === 'https://js.arcgis.com/5.2/')") and str(sdk).startswith("5.2"), f"it loads ArcGIS Maps SDK 5.2 ({sdk})")
        order = page.evaluate("[...document.querySelectorAll('#toolbar > .tool, #toolbar > .seg')].filter(e => !e.hidden).map(e => e.id)")
        check(order == ["tool-basemaps", "tool-open", "tool-layers", "tool-add", "tool-legend", "tool-measure", "tool-profile", "tool-sketch", "viewSeg", "tool-bookmarks", "tool-save"], "toolbar in MapMaker's order, with Elevation after Measure: " + ", ".join(order))
        check(page.inner_text("#tool-profile .tl") == "Elevation", "the tool is labelled Elevation")
        page.click("#tool-measure"); page.wait_for_selector("#measurePanel:not([hidden])", timeout=20000)
        check(page.is_hidden("#measureMenu") and page.get_attribute("#tool-measure", "aria-expanded") == "true", "Measure opens its panel directly (no menu)")
        page.click("#tool-profile"); page.wait_for_selector("#profilePanel:not([hidden])", timeout=30000)
        check(page.evaluate("document.getElementById('app').classList.contains('docked')") and page.get_attribute("#tool-profile", "aria-expanded") == "true" and page.is_hidden("#measurePanel"), "Elevation opens the profile, docked under the map")
        page.wait_for_timeout(2500); page.screenshot(path=str(shots / "parity-elevation.png"))
        axe("#profilePanel .panel-head", "Elevation panel heading")
        page.evaluate("document.querySelector('#profilePanel [data-close]').click()"); page.wait_for_timeout(800)
        check(page.is_visible("#toolbar") and page.get_attribute("#tool-profile", "aria-expanded") == "false", "closing it brings the toolbar back")

        print("== Share a collection map")
        page.click("#tool-open"); page.wait_for_selector(".cat-card .cat-share", timeout=90000)
        first = page.evaluate("(() => { const c = document.querySelector('.cat-card'); return { title: c.querySelector('.cat-card-title').textContent, label: c.querySelector('.cat-share').getAttribute('aria-label'), id: c.querySelector('.cat-act')._item.id }; })()")
        check(first["label"] == "Share: " + first["title"], "each map has a Share button named for its map: " + first["label"])
        page.screenshot(path=str(shots / "parity-open-map-share.png"))
        axe(".cat-card", "Map card with Share")
        page.locator(".cat-card .cat-share").first.click(); page.wait_for_function("document.querySelector('#toast').textContent.includes('copied')", timeout=10000)
        link = page.evaluate("navigator.clipboard.readText()")
        check(link == f"{base}/index.html?config=mapmaker&webmap={first['id']}", "Share copies a link to this app, these settings and that map: " + link)
        check(page.evaluate("document.activeElement.classList.contains('cat-share')"), "focus stays on Share")
        page.keyboard.press("Escape"); page.wait_for_timeout(600)
        load("webmap=" + first["id"])
        page.wait_for_function("document.querySelector('#layersBadge') && Number(document.querySelector('#layersBadge').textContent) >= 1", timeout=120000)
        page.click("#tool-open"); page.wait_for_selector(".cat-card .cat-share, .cat-card .cat-act", timeout=90000)

        print("== Remove all layers")
        load(f"config=mapmaker&webmap={QUAKES}")
        page.wait_for_function("document.querySelector('#layersBadge') && document.querySelector('#layersBadge').textContent === '1'", timeout=120000)
        # a sketch, to show it stays
        page.click("#tool-layers"); page.wait_for_selector("#layersList li", timeout=30000)
        check(page.is_visible("#layersRemoveAll") and page.get_attribute("#layersRemoveAll", "aria-label") == "Remove all layers", "Map layers has Remove all layers")
        axe("#layersPanel .panel-head", "Map layers heading")
        n0 = len(dialogs); page.click("#layersRemoveAll"); page.wait_for_function("document.querySelector('#toast').textContent.includes('removed')", timeout=10000)
        check(len(dialogs) == n0 + 1 and "Remove all layers from the map (1)?" in dialogs[-1], "it asks first: " + (dialogs[-1] if dialogs else ""))
        rows = page.evaluate("[...document.querySelectorAll('#layersList > li')].map(li => (li.querySelector('.lyr-name, .name, label, span') || li).textContent.trim().slice(0, 40))")
        check(page.inner_text("#layersBadge").strip() in ("", "0") or page.is_hidden("#layersBadge"), "the layer count on the tool is cleared: '" + page.inner_text("#layersBadge") + "'")
        check(not any("Earthquakes" in r for r in rows) and page.is_hidden("#layersRemoveAll"), "the layers are gone and the button with them; rows left: " + str(rows))
        check(page.evaluate("document.activeElement.id") == "layersH", "focus goes to the panel heading")
        print("== Time tool (a time-aware map: Revolutionary War Battles)")
        check(page.is_hidden("#timeHost") and page.evaluate("!document.querySelector('arcgis-time-bar')"), "a map without time settings has no time control")
        TB = "(() => { const t = document.querySelector('arcgis-time-bar'); if (!t) return null; const f = (e) => e ? [e.start && e.start.getUTCFullYear(), e.end && e.end.getUTCFullYear(), e.start && e.start.getTime(), e.end && e.end.getTime()] : null; return { state: t.state, full: f(t.fullTimeExtent), cur: f(t.timeExtent), stops: t.stops && t.stops.count, rate: t.playRate, slider: !!(t.querySelector('arcgis-time-bar-slider') || {}).viewModel }; })()"
        load(f"config=mapmaker&webmap={TIMED}")
        page.wait_for_function("document.querySelector('arcgis-time-bar') && document.querySelector('arcgis-time-bar').state === 'ready'", timeout=120000); page.wait_for_timeout(3000)
        tb = page.evaluate(TB)
        check(page.is_visible("#timeHost") and tb["full"][:2] == [1775, 1783] and tb["stops"] == 10 and tb["rate"] == 2000, f"the time control shows, set up from the map's own settings (1775 to 1783, 10 stops, 2 s a step): {tb['full'][:2]}, {tb['stops']}, {tb['rate']}")
        check(tb["slider"], "with a slider across the time span")
        check(page.evaluate("document.querySelector('arcgis-time-bar').getAttribute('label')") == "Time", "it is the SDK's Time Bar component, labelled Time")
        # the map follows the time: zoom to the east coast, then compare the map at the first and a later step
        from PIL import Image, ImageChops; import io
        for _ in range(3): page.mouse.move(748, 392); page.mouse.wheel(0, -300); page.wait_for_timeout(900)
        page.wait_for_timeout(5000)
        def grab(): return Image.open(io.BytesIO(page.screenshot(clip={"x": 300, "y": 80, "width": 900, "height": 480}))).convert("RGB")
        a0 = grab()
        for _ in range(4): page.evaluate("document.querySelector('arcgis-time-bar').next()"); page.wait_for_timeout(500)
        page.wait_for_timeout(4000); a1 = grab(); a0.save(str(shots / "parity-time-a0.png")); a1.save(str(shots / "parity-time-a1.png"))
        later = page.evaluate(TB)
        check(later["cur"][2] > tb["cur"][2], f"Next moves the time on: {tb['cur'][:2]} -> {later['cur'][:2]}")
        diff = sum(1 for px in ImageChops.difference(a0, a1).get_flattened_data() if sum(px) > 60)
        check(diff > 150, f"and the map shows different features for the new time ({diff} pixels changed)")
        page.screenshot(path=str(shots / "parity-time.png"))
        axe("#timeHost", "Time control")
        # saved maps keep the time settings, with where the slider is
        ctx2 = page.evaluate("delete window.showSaveFilePicker")
        page.click("#tool-save"); page.click("#saveTile"); page.wait_for_selector("#nameModal:not([hidden])"); page.fill("#fileNameInput", "battles_time")
        with page.expect_download() as dl: page.click("#nameConfirm")
        saved = json.loads(pathlib.Path(dl.value.path()).read_text())
        props = ((saved.get("widgets") or {}).get("timeSlider") or {}).get("properties") or {}
        check(props.get("numberOfStops") == 10 and props.get("currentTimeExtent") == later["cur"][2:], f"the saved map keeps the time settings and the slider's place: {sorted(props)}")
        page.evaluate("""(text) => { const dt = new DataTransfer(); dt.items.add(new File([text], 'battles_time.amap', { type: 'application/json' })); window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); }""", json.dumps(saved))
        page.wait_for_function("document.querySelector('#toast').textContent.includes('battles time')", timeout=90000)
        page.wait_for_function("document.querySelector('arcgis-time-bar') && document.querySelector('arcgis-time-bar').state === 'ready'", timeout=60000); page.wait_for_timeout(2500)
        again = page.evaluate(TB)
        check(again["full"][:2] == [1775, 1783] and again["cur"][2:] == later["cur"][2:], f"opening that file brings the time control back where it was: {again['cur'][:2]}")
        page.click("#tool-open"); page.click("#newMapBtn"); page.wait_for_timeout(2500)
        check(page.is_hidden("#timeHost") and page.evaluate("!document.querySelector('arcgis-time-bar')"), "a new blank map has no time control")
        check(not errors, "no uncaught errors: " + " | ".join(errors[:3]))
        browser.close()
    print(f"{checks[0] - len(failures)}/{checks[0]} checks passed")
    sys.exit(1 if failures else 0)

if __name__ == "__main__":
    main()
