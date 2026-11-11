"""Runs the Sketch measuring aids of Atlas 5.0 (atlas-sketch) in Chromium against the real services.

Run:  python3 atlas-sketch/tests/live-sketch-measure.py [--shots DIR] [--proxy URL]
Needs network access to js.arcgis.com and www.arcgis.com, and Python Playwright with Chromium.

Checks: tooltips, segment labels and snapping are on from the start; while a shape is drawn its sides are labelled
and every length and area is shown with no decimal places; a line started a few pixels from a sketched point starts
exactly on the point with snapping on (the SDK snaps within 5 pixels), and where the pointer was with snapping off; the same for a spreadsheet layer.
"""
import argparse, functools, glob, http.server, json, os, pathlib, re, sys, threading
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
APP = HERE.parent
SK = "document.querySelector('arcgis-sketch')"
CSV = "Site,Latitude,Longitude,Count\nA,20,-40,3\n"
# every piece of text with a length or area unit inside the map component, where the tooltips and labels are written
TEXTS = """(() => { const out = []; const root = document.querySelector('arcgis-map').shadowRoot; const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n;
  while ((n = w.nextNode())) { const t = (n.nodeValue || '').trim(); if (/\\d\\s?(km²|mi²|m²|km|mi|m|ft)(?![\\w²])/.test(t)) out.push({ text: t, label: !!(n.parentElement && n.parentElement.closest('.esri-text-overlay-item')) }); } return out; })()"""
SKETCHES = "(() => { const v = document.querySelector('arcgis-map').view; return v.map.layers.find(x => x.id === '__sketch').graphics.map(g => { const j = g.geometry.toJSON(); return { type: g.geometry.type, first: j.paths ? j.paths[0][0] : j.rings ? j.rings[0][0] : [j.x, j.y] }; }).toArray(); })()"

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
        page = browser.new_context(viewport={"width": 1366, "height": 768}).new_page(); errors = []
        page.on("pageerror", lambda e: errors.append(str(e)[:300]))
        page.on("dialog", lambda d: d.accept())
        def start(tool):
            page.evaluate("async (t) => { await " + SK + ".create(t); }", tool); page.wait_for_timeout(900)
        def finish():
            page.evaluate("(() => { const s = " + SK + "; try { if (s.state === 'active') { if (s.createGraphic) s.cancel(); else s.complete(); } } catch (e) {} })()"); page.wait_for_timeout(700)
        def count(n):
            try: page.wait_for_function("n => " + SKETCHES + ".length === n", arg=n, timeout=20000); return True
            except Exception: return False
        def hover_click(x, y, double=False):   # the pointer arrives, rests (snapping needs a moment), then clicks
            page.mouse.move(x - 30, y - 20); page.mouse.move(x, y, steps=6); page.wait_for_timeout(900)
            (page.mouse.dblclick if double else page.mouse.click)(x, y); page.wait_for_timeout(500)
        def to_screen(xy): return page.evaluate("([x, y]) => { const v = document.querySelector('arcgis-map').view; const p = v.toScreen({ type: 'point', x, y, spatialReference: v.spatialReference }); const r = v.container.getBoundingClientRect(); return [p.x + r.left, p.y + r.top]; }", xy)
        metres = lambda p, q: ((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2) ** 0.5

        print("== on from the start")
        page.goto(f"{base}/index.html?config=mapmaker")
        page.wait_for_function("document.querySelector('arcgis-map') && document.querySelector('arcgis-map').view && document.querySelector('arcgis-map').view.ready", timeout=120000)
        page.click("#tool-sketch")
        page.wait_for_function(SK + ".state === 'ready' && !!" + SK + ".view", timeout=120000); page.wait_for_timeout(2500)
        st = page.evaluate("(() => { const s = " + SK + ", so = s.snappingOptions; return { tips: s.tooltipOptions.enabled, labels: s.labelOptions.enabled, snap: so.enabled, self: so.selfEnabled, feature: so.featureEnabled, sources: so.featureSources.map(x => x.layer.id).toArray() }; })()")
        check(st["tips"] is True and st["labels"] is True, "tooltips and segment labels are on")
        check(st["snap"] is True and st["self"] is True and st["feature"] is True and st["sources"] == ["__sketch"], "snapping is on, to the sketch layer: " + json.dumps(st["sources"]))

        print("== segment labels, and no decimal places")
        start("rectangle")
        page.mouse.move(300, 250); page.mouse.down(); page.mouse.move(380, 300, steps=5); page.mouse.move(470, 361, steps=6); page.wait_for_timeout(1200)
        texts = page.evaluate(TEXTS); labels = [t["text"] for t in texts if t["label"]]; others = [t["text"] for t in texts if not t["label"]]
        page.screenshot(path=str(shots / "sketch-measure-rectangle.png"))
        check(len(labels) == 4, "each of the rectangle's four sides has its length beside it: " + ", ".join(labels))
        check(any("km²" in t or "mi²" in t for t in others), "the tooltip gives the size and the area: " + " | ".join(others))
        dec = [t["text"] for t in texts if re.search(r"\d\.\d+\s?(km²|mi²|m²|km|mi|m|ft)(?![\w²])", t["text"])]
        check(len(texts) >= 6 and not dec, "every length and area is a whole number" + (" (with decimals: " + ", ".join(dec) + ")" if dec else ""))
        check(all(re.search(r"\d", t) and int(re.sub(r"\D", "", t.split()[0])) > 100 for t in labels), "and they are still real values (hundreds of km at this scale), not zeros")
        page.mouse.up(); page.wait_for_timeout(800); finish()
        start("polyline"); hover_click(520, 420); page.mouse.move(600, 440, steps=6); page.mouse.move(640, 470, steps=4); page.wait_for_timeout(1000)
        texts = page.evaluate(TEXTS); dec = [t["text"] for t in texts if re.search(r"\d\.\d+\s?(km|mi|m|ft)(?![\w²])", t["text"])]
        check(len(texts) >= 2 and not dec, "the same for a line being drawn: " + " | ".join(t["text"] for t in texts[:4]) + (" (with decimals: " + ", ".join(dec) + ")" if dec else ""))
        page.screenshot(path=str(shots / "sketch-measure-line.png"))
        finish()
        page.evaluate("(() => { const v = document.querySelector('arcgis-map').view; v.map.layers.find(x => x.id === '__sketch').removeAll(); })()"); page.wait_for_timeout(500)

        print("== snapping to a sketch")
        start("point"); hover_click(500, 300); ok = count(1); finish()
        pt = page.evaluate(SKETCHES)[0]["first"]; px = to_screen(pt)
        start("polyline"); hover_click(px[0] + 3, px[1] + 2); hover_click(px[0] + 150, px[1] + 60, double=True); ok = ok and count(2); finish()
        line = [s for s in page.evaluate(SKETCHES) if s["type"] == "polyline"][-1]["first"]
        res = page.evaluate("document.querySelector('arcgis-map').view.resolution")
        check(ok and metres(line, pt) < 1, "a line started 4 pixels from the point starts exactly on it (%.2f m apart; a pixel here is %.0f m)" % (metres(line, pt), res))
        page.evaluate(SK + ".snappingOptions.enabled = false"); page.wait_for_timeout(400)
        start("polyline"); hover_click(px[0] + 3, px[1] + 2); hover_click(px[0] + 150, px[1] - 80, double=True); ok = count(3); finish()
        line2 = [s for s in page.evaluate(SKETCHES) if s["type"] == "polyline"][-1]["first"]
        check(ok and metres(line2, pt) > res * 2, "with snapping turned off, the same start stays where the pointer was (%.0f m from the point)" % metres(line2, pt))
        page.evaluate(SK + ".snappingOptions.enabled = true"); page.wait_for_timeout(400)

        print("== snapping to a spreadsheet layer")
        page.evaluate("""([name, text]) => { const dt = new DataTransfer(); dt.items.add(new File([text], name, { type: 'text/csv' })); window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); }""", ["one.csv", CSV])
        page.wait_for_selector("#dataPanel:not([hidden]) #dataSubmit", timeout=30000); page.wait_for_timeout(1500); page.click("#dataSubmit")
        page.wait_for_function("document.querySelector('#layersBadge').textContent === '1'", timeout=30000); page.wait_for_timeout(1500)
        page.evaluate("document.querySelector('arcgis-map').view.goTo({ center: [-40, 20], zoom: 3 }, { animate: false })"); page.wait_for_timeout(2500)
        page.click("#tool-sketch"); page.wait_for_function(SK + ".state === 'ready'", timeout=30000); page.wait_for_timeout(1500)
        src = page.evaluate(SK + ".snappingOptions.featureSources.map(x => String(x.layer.id).slice(0, 7)).toArray()")
        check(src == ["__sketc", "__data_"], "the spreadsheet layer is a snapping layer too: " + json.dumps(src))
        feat = page.evaluate("(async () => { const v = document.querySelector('arcgis-map').view; const l = v.map.layers.find(x => String(x.id).startsWith('__data_')); const r = await l.queryFeatures({ where: '1=1', returnGeometry: true, outSpatialReference: v.spatialReference }); const g = r.features[0].geometry; return [g.x, g.y]; })()")
        fx = to_screen(feat); before = len(page.evaluate(SKETCHES))
        start("polyline"); hover_click(fx[0] - 3, fx[1] + 2); hover_click(fx[0] + 120, fx[1] + 90, double=True); ok = count(before + 1); finish()
        line3 = [s for s in page.evaluate(SKETCHES) if s["type"] == "polyline"][-1]["first"]
        res = page.evaluate("document.querySelector('arcgis-map').view.resolution")
        check(ok and metres(line3, feat) < 1, "a line started 4 pixels from a spreadsheet point starts exactly on it (%.2f m apart; a pixel here is %.0f m)" % (metres(line3, feat), res))
        check(not errors, "no script errors: " + " | ".join(errors[:3]))
        browser.close()
    print(f"{checks[0] - len(failures)}/{checks[0]} checks passed")
    sys.exit(1 if failures else 0)

if __name__ == "__main__":
    main()
