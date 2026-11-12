"""Runs Sketch's text options, and the way back from a styled fill, of Atlas 5.0 (atlas-sketch) in Chromium against the real services.

Run:  python3 atlas-sketch/tests/live-sketch-text.py [--shots DIR] [--proxy URL] [--axe PATH]
Needs network access to js.arcgis.com, www.arcgis.com and static.arcgis.com, and Python Playwright with Chromium.

Checks: the text tool offers Font, Bold and Italic, Colour, Size, Halo and Rotation; each changes the text on the map;
a font is offered only the styles it has; every font the map asks Esri's font service for is there; a colour of your
own; the next text drawn carries the style on; the style is in the saved file (attributes and the label symbol) and
is there when the file is opened again; a file from before, without these, is bold with a white halo as it was. An
area with a styled fill offers a plain fill again, three ways. Accessibility scans.
"""
import argparse, functools, glob, http.server, json, os, pathlib, re, sys, threading
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
APP = HERE.parent
SK = "document.querySelector('arcgis-sketch')"
SHOWN = "(() => [...document.querySelectorAll('#sketchPanel .section, #sketchHint, #skKind')].filter(e => !e.hidden && e.getClientRects().length).map(e => e.id))()"
TEXTS = "(() => { const v = document.querySelector('arcgis-map').view; const l = v.map.layers.find(x => x.id === '__sketch'); return l.graphics.filter(g => g.attributes.kind === 'text').map(g => { const s = g.symbol, a = g.attributes; return { title: a.title, font: a.font, bold: a.bold, italic: a.italic, haloColor: a.haloColor, haloSize: a.haloSize, color: a.color, size: a.size, rotation: a.rotation, sym: s.type, text: s.text, family: s.font.family, weight: s.font.weight, style: s.font.style, fsize: s.font.size, angle: s.angle, symColor: s.color && s.color.toHex(), halo: s.haloColor ? s.haloColor.toHex() : null, haloPx: s.haloSize }; }).toArray(); })()"
AREAS = "(() => { const v = document.querySelector('arcgis-map').view; const l = v.map.layers.find(x => x.id === '__sketch'); return l.graphics.filter(g => g.geometry.type === 'polygon').map(g => ({ shape: g.attributes.shape, sym: g.symbol.type })).toArray(); })()"
SKETCHES = "(() => { const v = document.querySelector('arcgis-map').view; const l = v.map.layers.find(x => x.id === '__sketch'); return l.graphics.map(g => g.attributes.kind).toArray(); })()"
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
        ctx = browser.new_context(viewport={"width": 1366, "height": 768})
        ctx.add_init_script("delete window.showSaveFilePicker; delete window.showOpenFilePicker;")
        page = ctx.new_page(); errors = []
        page.on("pageerror", lambda e: errors.append(str(e)[:300]))
        page.on("dialog", lambda d: d.accept())
        def axe(what):
            if not a.axe: return
            if not page.evaluate("typeof axe !== 'undefined'"): page.add_script_tag(path=a.axe)
            v = page.evaluate(AXE); check(not v, what + ": no WCAG 2.1 A/AA violations (axe-core): " + "; ".join(v))
        def start(tool):
            r = page.evaluate("async (t) => { try { await " + SK + ".create(t); return 'ok'; } catch (e) { return String(e && e.message || e); } }", tool)
            page.wait_for_timeout(900); return r
        def finish():
            page.evaluate("(() => { const s = " + SK + "; try { if (s.state === 'active') { if (s.createGraphic) s.cancel(); else s.complete(); } } catch (e) {} })()"); page.wait_for_timeout(700)
        def shown(): return page.evaluate(SHOWN)
        def count(n):
            try: page.wait_for_function("n => " + SKETCHES + ".length === n", arg=n, timeout=20000); return True
            except Exception: return False
        def save_map(name):
            if not page.is_visible("#savePanel"): page.click("#tool-save")
            page.click("#saveTile"); page.wait_for_selector("#nameModal:not([hidden])"); page.fill("#fileNameInput", name)
            with page.expect_download() as dl: page.click("#nameConfirm")
            return json.loads(pathlib.Path(dl.value.path()).read_text())
        def drop(name, text):
            page.evaluate("""([name, text]) => { const dt = new DataTransfer(); dt.items.add(new File([text], name, { type: 'application/json' })); window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); }""", [name, text])

        fonts = []
        page.on("response", lambda r: fonts.append((r.status, r.url.split("/fonts/")[1].split("/")[0])) if "static.arcgis.com/fonts/" in r.url else None)
        def text0(): t = page.evaluate(TEXTS); return t[0] if t else {}
        def set_val(sel, v, ev="input"): page.evaluate("([s, v, ev]) => { const f = document.querySelector(s); f.value = v; f.dispatchEvent(new Event(ev, { bubbles: true })); }", [sel, v, ev]); page.wait_for_timeout(350)

        print("== the text tool")
        page.goto(f"{base}/index.html?config=mapmaker")
        page.wait_for_function("document.querySelector('arcgis-map') && document.querySelector('arcgis-map').view && document.querySelector('arcgis-map').view.ready", timeout=120000)
        page.click("#tool-sketch")
        page.wait_for_function(SK + ".state === 'ready' && !!" + SK + ".view", timeout=120000); page.wait_for_timeout(2500)
        start("text"); page.wait_for_function("!document.querySelector('#rotSection').hidden", timeout=10000)
        check(shown() == ["sketchHint", "skKind", "secFont", "secColour", "secSize", "secHalo", "rotSection"], "the text tool shows Font, Colour, Size, Halo and Rotation: " + ", ".join(shown()))
        opts = page.evaluate("[...document.querySelectorAll('#fFont option')].map(o => o.textContent)")
        check(len(opts) == 11 and opts[0].startswith("Standard") and "Noto Serif" in opts and "Atkinson Hyperlegible" in opts, "eleven fonts to choose from: " + ", ".join(opts))
        check(page.get_attribute("#fBold", "aria-pressed") == "true" and page.is_checked("#fHalo") and page.is_disabled("#fItalic"), "it starts as text has been: bold, with a halo; the standard font has no italic, so Italic is off")
        axe("Sketch panel, text tool")
        page.mouse.move(380, 300); page.mouse.move(420, 330, steps=5); page.wait_for_timeout(600); page.mouse.click(420, 330); page.wait_for_timeout(1200)
        page.keyboard.type("Lisbon", delay=40); page.wait_for_timeout(600); page.keyboard.press("Enter"); page.wait_for_timeout(1500)
        check(count(1), "a text is placed on the map")
        if not page.evaluate("document.querySelector('#fTitle') && !document.querySelector('#nameRow').hidden"): page.wait_for_timeout(1500)
        page.fill("#fTitle", "River Tagus"); page.wait_for_timeout(500)
        t = text0()
        check(t.get("text") == "River Tagus" and t.get("family") == "Arial Unicode MS" and t.get("weight") == "bold" and t.get("halo") == "#ffffff" and t.get("haloPx") == 1.5, "it is drawn as before by default: " + json.dumps({k: t.get(k) for k in ("text", "family", "weight", "halo", "haloPx")}))

        print("== font, bold and italic")
        page.select_option("#fFont", "noto-serif"); page.wait_for_timeout(600)
        t = text0(); check(t["family"] == "Noto Serif" and t["font"] == "noto-serif" and not page.is_disabled("#fItalic"), "choosing Noto Serif changes the text, and Italic is now offered")
        page.click("#fItalic"); page.wait_for_timeout(400)
        t = text0(); check(t["style"] == "italic" and t["weight"] == "bold" and t["italic"] == 1 and page.get_attribute("#fItalic", "aria-pressed") == "true", "Italic makes it italic (bold italic here)")
        page.click("#fBold"); page.wait_for_timeout(400)
        t = text0(); check(t["weight"] == "normal" and t["style"] == "italic" and t["bold"] == 0, "Bold off leaves it italic only")
        page.wait_for_timeout(2500); page.screenshot(path=str(shots / "sketch-text-serif-italic.png"))
        page.select_option("#fFont", "caveat"); page.wait_for_timeout(600)
        t = text0(); check(t["family"] == "Caveat" and t["style"] == "normal" and page.is_disabled("#fItalic") and not page.is_disabled("#fBold") and "doesn't have it" in (page.get_attribute("#fItalic", "title") or ""), "Caveat has no italic: the text is upright and Italic says why it is off: " + str(page.get_attribute("#fItalic", "title")))
        page.select_option("#fFont", "patrick-hand"); page.wait_for_timeout(600)
        t = text0(); check(t["family"] == "Patrick Hand" and t["weight"] == "normal" and page.is_disabled("#fBold") and page.is_disabled("#fItalic"), "Patrick Hand has neither bold nor italic")
        page.select_option("#fFont", "playfair-display"); page.click("#fBold") if page.get_attribute("#fBold", "aria-pressed") == "false" else None; page.wait_for_timeout(600)
        t = text0(); check(t["family"] == "Playfair Display" and t["weight"] == "bold" and t["style"] == "italic", "back on a font with both, the bold and italic chosen return: " + t["weight"] + " " + t["style"])

        print("== colour, size, halo, rotation")
        set_val("#colourCustom", "#5b2d00"); t = text0()
        check(t["symColor"] == "#5b2d00" and t["color"] == "#5b2d00", "a colour of your own: " + str(t["symColor"]))
        set_val("#fSize", "30"); t = text0(); check(t["fsize"] == 30, "size 30")
        page.click("#fHalo"); page.wait_for_timeout(400); t = text0()
        check(t["halo"] is None and t["haloSize"] == 0 and page.is_hidden("#haloOpts"), "Halo off takes the halo away and hides its settings")
        page.click("#fHalo"); page.wait_for_timeout(400); t = text0()
        check(t["halo"] == "#ffffff" and t["haloPx"] == 1.5 and page.is_visible("#haloOpts"), "Halo on brings it back as it was")
        set_val("#haloCustom", "#ffe9a8"); set_val("#fHaloW", "3"); t = text0()
        check(t["halo"] == "#ffe9a8" and t["haloPx"] == 3 and page.input_value("#fHaloWN") == "3", "the halo's colour and size can be set: " + str(t["halo"]) + ", " + str(t["haloPx"]))
        set_val("#fRot", "25"); t = text0(); check(t["angle"] == 25 and t["rotation"] == 25, "rotation 25 degrees")
        axe("Sketch panel, a text selected")
        page.wait_for_timeout(3000); page.screenshot(path=str(shots / "sketch-text-styled.png"))
        bad = sorted(set(f for s, f in fonts if s != 200)); used = sorted(set(f for s, f in fonts if s == 200))
        check(not bad and any("noto-serif" in f and "italic" in f for f in used) and any(f.startswith("playfair-display-bold-italic") for f in used), "every font asked of Esri's font service was there: " + ", ".join(used) + (" | missing: " + ", ".join(bad) if bad else ""))

        print("== the next text, and the saved file")
        finish(); page.evaluate(SK + ".complete && " + SK + ".complete()"); page.wait_for_timeout(600)
        start("text"); page.mouse.move(560, 380); page.mouse.move(600, 420, steps=5); page.wait_for_timeout(600); page.mouse.click(600, 420); page.wait_for_timeout(1200)
        page.keyboard.type("Second", delay=40); page.keyboard.press("Enter"); page.wait_for_timeout(1500)
        check(count(2), "a second text is placed")
        ts = page.evaluate(TEXTS); second = [x for x in ts if x["title"] != "River Tagus"]
        check(len(second) == 1 and second[0]["family"] == "Playfair Display" and second[0]["halo"] == "#ffe9a8" and second[0]["angle"] == 25 and second[0]["style"] == "italic", "it carries the style on, as Map Viewer does: " + json.dumps({k: second[0].get(k) for k in ("family", "weight", "style", "halo", "angle")} if second else {}))
        finish(); page.evaluate(SK + ".complete && " + SK + ".complete()"); page.wait_for_timeout(600)
        saved = save_map("sketch_text")
        lyr = [o for o in saved["operationalLayers"] if o.get("id") == "__sketch_text"][0]["featureCollection"]["layers"][0]
        fa = [f["attributes"] for f in lyr["featureSet"]["features"] if f["attributes"]["title"] == "River Tagus"][0]
        lab = [c for c in lyr["layerDefinition"]["drawingInfo"]["labelingInfo"] if c["where"] == "_style = '" + fa["_style"] + "'"][0]["symbol"]
        check(fa["font"] == "playfair-display" and fa["bold"] == 1 and fa["italic"] == 1 and fa["haloColor"] == "#ffe9a8" and fa["haloSize"] == 3 and fa["rotation"] == 25, "the file keeps each text's choices: " + json.dumps({k: fa[k] for k in ("font", "bold", "italic", "haloColor", "haloSize", "rotation")}))
        check(lab["font"] == {"family": "Playfair Display", "size": 30, "weight": "bold", "style": "italic"} and lab["haloColor"] == [255, 233, 168, 255] and lab["haloSize"] == 3, "and its label symbol, for other ArcGIS apps, has the font and halo: " + json.dumps(lab["font"]))
        check(saved.get("authoringAppVersion", "").startswith("5.0.0") and any(f["name"] == "haloSize" for f in lyr["layerDefinition"]["fields"]), "the layer has the new fields")
        page.goto(f"{base}/index.html?config=mapmaker"); page.wait_for_function("document.querySelector('arcgis-map') && document.querySelector('arcgis-map').view && document.querySelector('arcgis-map').view.ready", timeout=120000); page.wait_for_timeout(1200)
        drop("sketch_text.amap", json.dumps(saved)); count(2); page.wait_for_timeout(1500)
        back = [x for x in page.evaluate(TEXTS) if x["title"] == "River Tagus"]
        check(len(back) == 1 and back[0]["family"] == "Playfair Display" and back[0]["weight"] == "bold" and back[0]["style"] == "italic" and back[0]["halo"] == "#ffe9a8" and back[0]["haloPx"] == 3 and back[0]["angle"] == 25 and back[0]["symColor"] == "#5b2d00" and back[0]["fsize"] == 30, "opened from the file, the text looks as it did")
        old = json.loads(json.dumps(saved))
        for o in old["operationalLayers"]:
            if o.get("id") == "__sketch_text":
                for f in o["featureCollection"]["layers"][0]["featureSet"]["features"]:
                    for k in ("font", "bold", "italic", "haloColor", "haloSize"): f["attributes"].pop(k, None)
        page.goto(f"{base}/index.html?config=mapmaker"); page.wait_for_function("document.querySelector('arcgis-map') && document.querySelector('arcgis-map').view && document.querySelector('arcgis-map').view.ready", timeout=120000); page.wait_for_timeout(1200)
        drop("older.amap", json.dumps(old)); count(2); page.wait_for_timeout(1500)
        o1 = [x for x in page.evaluate(TEXTS) if x["title"] == "River Tagus"]
        check(len(o1) == 1 and o1[0]["family"] == "Arial Unicode MS" and o1[0]["weight"] == "bold" and o1[0]["halo"] == "#ffffff" and o1[0]["haloPx"] == 1.5, "a file from before these options opens as its text was: bold, white halo")

        print("== back from a styled fill")
        page.click("#tool-sketch"); page.wait_for_function(SK + ".state === 'ready' && !!" + SK + ".view", timeout=120000); page.wait_for_timeout(2000)
        start("rectangle"); page.wait_for_timeout(400)
        first = page.get_attribute("#recentRow .sym-btn", "aria-label")
        check(first == "Basic polygon" and page.is_visible("#recentRow") and page.is_hidden("#secPlain"), "the plain fill is always the first of the recent polygon symbols: " + str(first))
        page.click("#skSymbolOpen"); page.wait_for_selector("#skSymbols:not([hidden])")
        page.wait_for_function("document.querySelectorAll('#symbolGrid .sym-btn').length >= 20 && document.querySelector('#symbolStatus').textContent === ''", timeout=60000)
        page.click('#symbolGrid .sym-btn[aria-label="A Crosshatch"]'); page.click("#skSymbolsDone"); page.wait_for_selector("#skMain:not([hidden])"); page.wait_for_timeout(2500)
        page.mouse.move(300, 250); page.mouse.down(); page.mouse.move(380, 300, steps=5); page.mouse.move(430, 340, steps=5); page.mouse.up(); page.wait_for_timeout(1500)
        ar = page.evaluate(AREAS)
        check(len(ar) == 1 and ar[0]["shape"].endswith("/A Crosshatch"), "a rectangle is drawn with the crosshatch")
        sh = shown()
        check("secPlain" in sh and "secFillColour" not in sh and page.is_visible("#skPlainFill") and re.search(r"no colou?rs or outline", page.inner_text("#secPlain")) is not None, "with a styled fill the panel says why there are no colours, and offers a plain fill: " + ", ".join(sh))
        axe("Sketch panel, an area with a styled fill")
        page.screenshot(path=str(shots / "sketch-styled-fill-way-back.png"))
        page.click("#skPlainFill"); page.wait_for_timeout(800)
        ar = page.evaluate(AREAS); sh = shown()
        check(ar[0]["shape"] == "" and ar[0]["sym"] == "simple-fill" and all(x in sh for x in ("secFillColour", "secFillT", "secOutlineColour", "secOutlineW", "secPattern")) and "secPlain" not in sh, "Use a plain fill instead brings the colours and outline back: " + ", ".join(sh))
        page.click('#recentRow .sym-btn[aria-label="A Crosshatch"]'); page.wait_for_timeout(1500)
        check(page.evaluate(AREAS)[0]["shape"].endswith("/A Crosshatch") and page.get_attribute("#recentRow .sym-btn", "aria-label") == "Basic polygon", "the crosshatch again from the recent symbols; the plain fill is still first")
        page.click("#recentRow .sym-btn"); page.wait_for_timeout(800)
        check(page.evaluate(AREAS)[0]["shape"] == "" and "secFillColour" in shown(), "and back again from the first recent symbol")
        page.click("#skSymbolOpen"); page.wait_for_selector("#skSymbols:not([hidden])"); page.select_option("#symbolSet", index=1)
        page.wait_for_function("document.querySelectorAll('#symbolGrid .sym-btn').length >= 5 && document.querySelector('#symbolStatus').textContent === ''", timeout=60000)
        check(page.get_attribute("#symbolGrid .sym-btn", "aria-label") == "Basic polygon", "Basic polygon is the first choice in every category of Change symbol, not only the first")
        page.click("#skSymbolsDone"); page.wait_for_timeout(400)
        finish(); start("point"); page.wait_for_timeout(500)
        check(page.get_attribute("#recentRow .sym-btn", "aria-label") == "Circle", "for points the plain circle is first in the same way")
        check(not errors, "no script errors" + (": " + " | ".join(errors[:3]) if errors else ""))
        browser.close()
    srv.shutdown()
    print("\n%d/%d checks passed" % (checks[0] - len(failures), checks[0]))
    sys.exit(1 if failures else 0)

if __name__ == "__main__":
    main()
