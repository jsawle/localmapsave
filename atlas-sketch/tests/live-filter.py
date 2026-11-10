"""Runs the Filter panel of the lab app (atlas-sketch) in Chromium against the real services: the ArcGIS Maps SDK from
Esri's CDN, ArcGIS Online, and MapMaker's "Major Earthquakes (1950-2023)" map.

Run:  python3 atlas-sketch/tests/live-filter.py [--shots DIR] [--proxy URL] [--axe FILE]
Needs network access to js.arcgis.com and www.arcgis.com (an HTTPS proxy is taken from --proxy or HTTPS_PROXY) and
Python Playwright with Chromium. --axe is axe-core's axe.min.js (the main app's smoke test fetches it); without it the
accessibility scan is skipped.

Checks: the Filter button on a layer; a number condition with the histogram and slider (the SDK's Histogram and Slider
components) in step with the number box; the count of features shown; Cancel puts the layer back; two conditions and
match all / at least one; Apply marks the button; the saved map file holds the filter as the layer's
definitionExpression and nothing outside the Web Map Specification; opening that file brings the conditions back;
clearing a filter; the value list of a text field; a spreadsheet layer's filter saved in its feature collection.
"""
import argparse, functools, glob, http.server, json, os, pathlib, sys, threading
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
APP = HERE.parent
QUAKES = "85997c9571e74256af71dc20566b47f1"
SPEC_ROOT = {"operationalLayers", "baseMap", "spatialReference", "version", "authoringApp", "authoringAppVersion", "initialState", "bookmarks", "presentation", "atlasLocked"}
CSV = "Site,Latitude,Longitude,Area,Plastic,Glass,Metal\nMarket St,32.7115,-117.1601,Street,12,3,4\nIsland Ave,32.7098,-117.1585,Park,5,8,2\nJ St,32.7076,-117.1612,Street,9,1,7\nK St,32.7066,-117.1590,Park,2,2,1\n"
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
        checks[0] += 1
        print(("  ok   " if cond else "  FAIL ") + msg)
        if not cond: failures.append(msg)

    with sync_playwright() as p:
        launch = {"args": ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]}
        if chrome: launch["executable_path"] = chrome
        if a.proxy: launch["proxy"] = {"server": a.proxy, "bypass": "localhost,127.0.0.1"}
        browser = p.chromium.launch(**launch)
        ctx = browser.new_context(viewport={"width": 1400, "height": 860}, accept_downloads=True)
        ctx.add_init_script("delete window.showSaveFilePicker; delete window.showOpenFilePicker;")   # saves become downloads the test can read
        page = ctx.new_page(); errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("dialog", lambda d: d.accept())

        # ---- helpers: Calcite and SDK components are set the way a person's input sets them (value, then the component's event)
        def select(part, value, card=0):
            page.evaluate("""([part, value, card]) => { const s = document.querySelectorAll('#filterConds .flt-cond')[card].querySelector('[data-part="' + part + '"]'); s.value = value; s.dispatchEvent(new CustomEvent('calciteSelectChange')); }""", [part, value, card])
            page.wait_for_timeout(600)
        def type_number(value, card=0, part="value"):
            page.evaluate("""([value, card, part]) => { const n = document.querySelectorAll('#filterConds .flt-cond')[card].querySelector('[data-part="' + part + '"]'); n.value = value; n.dispatchEvent(new CustomEvent('calciteInputNumberInput')); }""", [value, card, part])
        def type_text(value, card=0):
            page.evaluate("""([value, card]) => { const n = document.querySelectorAll('#filterConds .flt-cond')[card].querySelector('[data-part="value"]'); n.value = value; n.dispatchEvent(new CustomEvent('calciteInputTextInput')); }""", [value, card])
        def val(part, card=0):
            return page.evaluate("""([part, card]) => { const c = document.querySelectorAll('#filterConds .flt-cond')[card]; const e = c && c.querySelector('[data-part="' + part + '"]'); return e ? String(e.value ?? '') : null; }""", [part, card])
        def count_is(text, timeout=30000):
            try: page.wait_for_function("t => document.querySelector('#filterCount').textContent.includes(t)", arg=text, timeout=timeout); return True
            except Exception: return False
        def count(): return page.inner_text("#filterCount")
        def open_layers():
            if not page.is_visible("#layersPanel"): page.click("#tool-layers")
            page.wait_for_selector('#layersList [data-key$=":filter"]', timeout=30000)
        def open_filter(nth=0):
            open_layers(); page.locator('#layersList [data-key$=":filter"]').nth(nth).click()
            page.wait_for_selector("#filterPanel:not([hidden]) .flt-cond", timeout=30000)
        def filter_btn(nth=0): return page.locator('#layersList [data-key$=":filter"]').nth(nth)
        def save_map(name):
            if not page.is_visible("#savePanel"): page.click("#tool-save")
            page.click("#saveTile"); page.wait_for_selector("#nameModal:not([hidden])"); page.fill("#fileNameInput", name)
            with page.expect_download() as dl: page.click("#nameConfirm")
            return json.loads(pathlib.Path(dl.value.path()).read_text())
        def drop(name, text, mime):
            page.evaluate("""([name, text, mime]) => { const dt = new DataTransfer(); dt.items.add(new File([text], name, { type: mime })); window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); }""", [name, text, mime])

        print("== a map layer (Major Earthquakes)")
        page.goto(f"{base}/index.html?config=mapmaker&webmap={QUAKES}")
        page.wait_for_function("document.querySelector('#layersBadge') && document.querySelector('#layersBadge').textContent === '1'", timeout=120000)
        open_layers()
        check(filter_btn().get_attribute("aria-label").startswith("Filter:") and "on" not in (filter_btn().get_attribute("class") or "").split(), "the layer has a Filter button, not marked: " + str(filter_btn().get_attribute("aria-label")))
        open_filter()
        check(page.inner_text("#filterLayer") == "Earthquakes (Major)" and page.inner_text("#filterH") == "Filter" and page.is_visible("text=Show features where"), "panel: layer name, Filter, Show features where")
        check(count_is("Showing all 949 features"), "nothing filtered yet: " + count())
        check(val("value") == "", "the value box starts empty")
        select("field", "mag")
        page.wait_for_selector("#filterConds arcgis-slider arcgis-histogram", timeout=40000)
        check(page.evaluate("!!customElements.get('arcgis-slider') && !!customElements.get('arcgis-histogram')"), "the histogram and slider are the SDK's Histogram and Slider components")
        check(val("op") == "atLeast", "a number field starts on 'is at least'")
        type_number("7.4")
        check(count_is("Showing 368 of 949"), "Magnitude is at least 7.4: " + count())
        page.wait_for_timeout(500)
        check(page.evaluate("document.querySelector('#filterConds arcgis-slider').values[0]") == 7.4, "typing in the box moves the slider")
        check(page.evaluate("(document.querySelector('#filterConds arcgis-histogram').colorStops || []).length") == 1, "the bars the condition includes are coloured")
        page.screenshot(path=str(shots / "filter-magnitude.png"))
        page.evaluate("(() => { const s = document.querySelector('#filterConds arcgis-slider'); s.values = [8]; s.dispatchEvent(new CustomEvent('arcgisInput')); })()")
        page.wait_for_timeout(600)
        check(val("value") == "8", "moving the slider fills the box: " + str(val("value")))
        check(count_is(" of 949") and "368" not in count(), "and the count follows: " + count())
        at8 = count()
        if a.axe:
            page.add_script_tag(path=a.axe); v = page.evaluate(AXE)
            check(not v, "Filter panel: no WCAG 2.1 A/AA violations (axe-core): " + "; ".join(v))
        page.click("#filterCancel"); page.wait_for_selector("#layersPanel:not([hidden])")
        check(page.evaluate("document.activeElement && document.activeElement.dataset.key || ''").endswith(":filter"), "Cancel goes back to the layer's Filter button")
        check("on" not in (filter_btn().get_attribute("class") or "").split(), "Cancel leaves the layer without a filter")
        open_filter()
        check(count_is("Showing all 949 features") and val("value") == "", "and reopening shows no conditions: " + count())

        select("field", "mag"); page.wait_for_selector("#filterConds arcgis-slider", timeout=40000); type_number("8")
        check(count_is(at8), "Magnitude is at least 8 again: " + count())
        page.click("#filterAdd"); page.wait_for_function("document.querySelectorAll('#filterConds .flt-cond').length === 2")
        check(page.is_visible("#filterMatchRow calcite-select"), "with two conditions, Filter results (match all / at least one) appears")
        select("field", "place", 1)
        check(val("op", 1) == "is", "a text field starts on 'is'")
        page.wait_for_function("document.querySelectorAll('#filterConds .flt-cond')[1].querySelectorAll('calcite-combobox-item').length > 5", timeout=40000)
        check(True, "'is' offers the field's values to choose from")
        select("op", "contains", 1); type_text("Chile", 1)
        page.wait_for_timeout(1500); both = count()
        page.evaluate("(() => { const s = document.querySelector('#filterMatchRow calcite-select'); s.value = 'any'; s.dispatchEvent(new CustomEvent('calciteSelectChange')); })()")
        page.wait_for_function("t => document.querySelector('#filterCount').textContent !== t && document.querySelector('#filterCount').textContent.includes(' of 949')", arg=both, timeout=30000)
        n = lambda s: int(s.split("Showing ")[1].split(" of")[0].replace(",", ""))
        check(n(count()) > n(both) and n(count()) >= n(at8), f"match at least one shows more than match all: {both} -> {count()}")
        page.screenshot(path=str(shots / "filter-two-conditions.png"))
        page.click("#filterApply"); page.wait_for_selector("#layersPanel:not([hidden])")
        check("on" in (filter_btn().get_attribute("class") or "").split() and filter_btn().get_attribute("aria-label").startswith("Filter (on)"), "Apply marks the Filter button: " + str(filter_btn().get_attribute("aria-label")))
        saved = save_map("quakes_filtered")
        op = next(o for o in saved["operationalLayers"] if o.get("title") == "Earthquakes (Major)")
        expr = (op.get("layerDefinition") or {}).get("definitionExpression")
        check(expr == "(mag >= 8) OR (place LIKE '%Chile%')", f"the saved map holds the filter as the layer's definitionExpression: {expr}")
        check(set(saved) <= SPEC_ROOT and set(op) <= {"id", "title", "url", "itemId", "layerType", "visibility", "opacity", "showLabels", "layerDefinition", "popupInfo", "disablePopup", "showLegend", "mode"}, f"and only Web Map Specification properties {sorted(set(op))}")

        print("== the saved file, opened again")
        drop("quakes_filtered.amap", json.dumps(saved), "application/json")
        page.wait_for_function("document.querySelector('#toast').textContent.includes('quakes filtered')", timeout=90000)
        open_layers()
        check("on" in (filter_btn().get_attribute("class") or "").split(), "the layer comes back with its filter on")
        open_filter()
        page.wait_for_function("document.querySelectorAll('#filterConds .flt-cond').length === 2", timeout=30000)
        check([val("field"), val("op"), val("value")] == ["mag", "atLeast", "8"] and [val("field", 1), val("op", 1), val("value", 1)] == ["place", "contains", "Chile"], "its two conditions are shown again")
        check(page.evaluate("document.querySelector('#filterMatchRow calcite-select').value") == "any", "with match at least one")
        check(count_is(" of 949"), "and the count: " + count())
        page.click("#filterClear"); page.wait_for_function("document.querySelectorAll('#filterConds .flt-cond').length === 1")
        check(count_is("Showing all 949 features"), "Clear all shows everything: " + count())
        page.click("#filterApply"); page.wait_for_selector("#layersPanel:not([hidden])")
        check("on" not in (filter_btn().get_attribute("class") or "").split(), "applying no conditions takes the filter off")
        cleared = save_map("quakes_cleared")
        op = next(o for o in cleared["operationalLayers"] if o.get("title") == "Earthquakes (Major)")
        check((op.get("layerDefinition") or {}).get("definitionExpression") == "1=1", f"a filter that was cleared is saved as 1=1, so it stays cleared: {op.get('layerDefinition')}")

        print("== a spreadsheet layer")
        page.click("#tool-open"); page.click("#newMapBtn"); page.wait_for_timeout(1500)
        drop("litter.csv", CSV, "text/csv")
        page.wait_for_selector("#dataPanel:not([hidden]) #dataSubmit", timeout=30000); page.wait_for_timeout(1500); page.click("#dataSubmit")
        page.wait_for_function("document.querySelector('#layersBadge').textContent === '1'", timeout=30000)
        open_filter()
        select("field", "Plastic"); page.wait_for_selector("#filterConds arcgis-slider", timeout=40000)
        type_number("9")
        check(count_is("Showing 2 of 4 features"), "Plastic is at least 9: " + count())
        page.click("#filterApply"); page.wait_for_selector("#layersPanel:not([hidden])")
        csvmap = save_map("litter_filtered")
        own = next(o for o in csvmap["operationalLayers"] if str(o.get("id", "")).startswith("__data_"))
        ld = own["featureCollection"]["layers"][0]["layerDefinition"]
        check(ld.get("definitionExpression") == "Plastic >= 9" and len(own["featureCollection"]["layers"][0]["featureSet"]["features"]) == 4, f"the spreadsheet layer's filter is saved, with all 4 rows kept: {ld.get('definitionExpression')}")
        drop("litter_filtered.amap", json.dumps(csvmap), "application/json")
        page.wait_for_function("document.querySelector('#toast').textContent.includes('litter filtered')", timeout=60000)
        open_filter()
        check([val("field"), val("op"), val("value")] == ["Plastic", "atLeast", "9"] and count_is("Showing 2 of 4 features"), "and it comes back when the file is opened: " + count())
        page.click("#filterCancel")
        check(not errors, "no uncaught errors: " + " | ".join(errors[:3]))
        browser.close()
    print(f"{checks[0] - len(failures)}/{checks[0]} checks passed")
    sys.exit(1 if failures else 0)

if __name__ == "__main__":
    main()
