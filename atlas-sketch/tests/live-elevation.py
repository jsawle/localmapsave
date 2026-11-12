"""Runs the Elevation tool of Atlas 5.0 (atlas-sketch) in Chromium against the real services.

Run:  python3 atlas-sketch/tests/live-elevation.py [--shots DIR] [--proxy URL] [--axe PATH]
Needs network access to js.arcgis.com, www.arcgis.com and elevation3d.arcgis.com, and Python Playwright with Chromium.

Checks: the chart runs the whole width under the map with the line's figures in one row beneath it; a line from land
out to sea gets the water and a dashed sea-level line, a line over land only does not; the land is filled with a
gradient that is lightest at the surface; moving over the chart (pointer or arrow keys) puts a dot on the line on the
map, for a drawn line and for a sketched line; over a sketched line the pointer becomes a hand and a click charts it;
a sketched line can also be chosen from the list; the text sizes; an accessibility scan.
"""
import argparse, functools, glob, math, http.server, json, os, pathlib, re, sys, threading
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
APP = HERE.parent
V = "document.querySelector('arcgis-map').view"
# the graphics the tool has put on the map: the line, the dot
GFX = "(() => " + V + ".graphics.map(g => ({ type: g.geometry.type, json: g.geometry.toJSON(), style: g.symbol && g.symbol.style })).toArray())()"
# the cursor the pointer has at a place on the page (through the map component's shadow roots)
CURSOR = """([x, y]) => { let el = document.elementFromPoint(x, y); while (el && el.shadowRoot && el.shadowRoot.elementFromPoint(x, y) && el.shadowRoot.elementFromPoint(x, y) !== el) el = el.shadowRoot.elementFromPoint(x, y); return getComputedStyle(el).cursor; }"""

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
        def to_screen(lonlat):
            x = lonlat[0] * math.pi / 180 * 6378137; y = math.log(math.tan(math.pi / 4 + lonlat[1] * math.pi / 360)) * 6378137
            return page.evaluate("([x, y]) => { const v = " + V + "; const p = v.toScreen({ type: 'point', x, y, spatialReference: { wkid: 102100 } }); const r = v.container.getBoundingClientRect(); return [p.x + r.left, p.y + r.top]; }", [x, y])
        def go(lon, lat, zoom):
            page.evaluate("async ([lon, lat, zoom]) => { await " + V + ".goTo({ center: [lon, lat], zoom }, { animate: false }); }", [lon, lat, zoom]); page.wait_for_timeout(1500)
        def draw(a_, b_):
            p, q = to_screen(a_), to_screen(b_)
            page.mouse.move(p[0], p[1]); page.mouse.click(p[0], p[1]); page.wait_for_timeout(700)
            page.mouse.move(q[0], q[1], steps=5); page.wait_for_timeout(300); page.mouse.dblclick(q[0], q[1])
            return p, q
        def charted():
            try: page.wait_for_selector("#profChart .prof-land", timeout=60000); page.wait_for_timeout(400); return True
            except Exception: return False
        def dot(): 
            d = [g for g in page.evaluate(GFX) if g["type"] == "point"]; return d[0]["json"] if d else None
        def on_segment(pt, a_, b_, tol):   # is the point on the straight line between two map points (Web Mercator)?
            (x, y), (x1, y1), (x2, y2) = pt, a_, b_; L = ((x2 - x1) ** 2 + (y2 - y1) ** 2) ** 0.5
            off = abs((x2 - x1) * (y1 - y) - (x1 - x) * (y2 - y1)) / L; along = ((x - x1) * (x2 - x1) + (y - y1) * (y2 - y1)) / L / L
            return off < tol and -0.01 <= along <= 1.01, along
        def on_line(pt, path, tol):   # is the point on a line of many points? and how far along (by its points)
            best = (1e18, 0)
            for i in range(len(path) - 1):
                ok, along = on_segment(pt, path[i], path[i + 1], 1e18); f = min(1, max(0, along)); px = path[i][0] + (path[i + 1][0] - path[i][0]) * f; py = path[i][1] + (path[i + 1][1] - path[i][1]) * f
                dd = ((pt[0] - px) ** 2 + (pt[1] - py) ** 2) ** 0.5
                if dd < best[0]: best = (dd, (i + f) / (len(path) - 1))
            return best[0] < tol, best[1]
        def axe(sel, what):
            if not a.axe: return
            page.add_script_tag(path=a.axe)
            res = page.evaluate("async (sel) => { const r = await axe.run(sel, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }); return r.violations.map(v => v.id + ': ' + v.nodes.length + ' ' + (v.nodes[0] && v.nodes[0].target.join(' '))); }", sel)
            check(not res, what + " passes the accessibility scan" + (": " + "; ".join(res) if res else ""))

        print("== the dock")
        page.goto(f"{base}/index.html?config=mapmaker")
        page.wait_for_function(V + " && " + V + ".ready", timeout=120000); page.wait_for_timeout(1500)
        go(-9.6, 39.0, 8)   # the coast of Portugal: land to the east, the Atlantic to the west
        page.click("#tool-profile"); page.wait_for_selector("#profilePanel:not([hidden])", timeout=30000)
        page.wait_for_selector("#profChart .prof-msg", timeout=60000)
        box = page.evaluate("(() => { const r = id => { const b = document.getElementById(id).getBoundingClientRect(); return [b.left, b.top, b.width, b.height]; }; return { dock: r('profilePanel'), chart: r('profChart'), map: r('mapWrap'), win: innerWidth }; })()")
        check(box["dock"][2] >= box["win"] - 2, "the dock is the full width of the page: %d of %d" % (box["dock"][2], box["win"]))
        check(box["chart"][2] >= box["dock"][2] - 24, "the chart is the full width of the dock: %d of %d" % (box["chart"][2], box["dock"][2]))
        check("Click the map" in page.inner_text("#profChart"), "it says how to start: " + page.inner_text("#profChart"))
        mid = [box["map"][0] + box["map"][2] / 2, box["map"][1] + box["map"][3] / 2]
        page.mouse.move(mid[0], mid[1]); page.wait_for_timeout(400)
        check(page.evaluate(CURSOR, mid) == "crosshair", "over the map the pointer is a crosshair: " + page.evaluate(CURSOR, mid))

        print("== a line from land out to sea")
        draw([-8.6, 39.3], [-10.6, 39.3])
        check(charted(), "drawing a line (click, double-click) charts it")
        line = [g for g in page.evaluate(GFX) if g["type"] == "polyline"]
        PATH = line[0]["json"]["paths"][0] if line else []
        A, B = PATH[0], PATH[-1]; M = PATH[len(PATH) // 2]
        check(len(line) == 1 and len(PATH) > 50 and abs(A[1] - B[1]) < 3000, "the line on the map runs between the two places clicked, in many short pieces: %d points" % len(PATH))
        # Both ends are at 39.3 N, 2 degrees of longitude apart. The middle of the great circle between them is at
        # atan(tan(39.3) / cos(1)) = 39.3043 N, which is 0.0043 degrees, or 615 Web Mercator metres, north of the straight line.
        bow = M[1] - (A[1] + B[1]) / 2
        check(585 < bow < 645, "it is the shortest way round: its middle is north of the straight line by %d map metres" % bow)
        c = page.evaluate("""(() => { const q = s => document.querySelector('#profChart ' + s); const sea = q('.prof-sea'), lab = q('.prof-sea-label'), land = q('.prof-land'), water = q('.prof-water');
          const stops = [...document.querySelectorAll('#profEarth stop')].map(s => s.getAttribute('stop-color')); const g = document.getElementById('profEarth');
          const svg = q('svg').getBoundingClientRect(), host = document.getElementById('profChart').getBoundingClientRect();
          return { sea: !!sea, dash: sea && sea.getAttribute('stroke-dasharray'), seaY: sea && +sea.getAttribute('y1'), label: lab && lab.textContent, water: !!water, waterY: water && +water.getAttribute('y'),
            fill: land.getAttribute('fill'), stops, gy1: +g.getAttribute('y1'), gy2: +g.getAttribute('y2'), svgW: svg.width, hostW: host.width,
            ticks: [...document.querySelectorAll('#profChart .prof-tick')].map(t => t.textContent), tickPx: parseFloat(getComputedStyle(q('.prof-tick')).fontSize), labPx: lab && parseFloat(getComputedStyle(lab).fontSize) }; })()""")
        check(c["sea"] and c["dash"] and c["label"] == "Sea level" and c["water"] and abs(c["seaY"] - c["waterY"]) < 0.01, "sea level is a dashed line, named, with the water below it: " + json.dumps([c["label"], c["dash"]]))
        lum = lambda h: 0.2126 * int(h[1:3], 16) + 0.7152 * int(h[3:5], 16) + 0.0722 * int(h[5:7], 16)
        ls = [lum(s) for s in c["stops"]]
        check(c["fill"] == "url(#profEarth)" and len(ls) >= 3 and all(ls[i] > ls[i + 1] for i in range(len(ls) - 1)) and c["gy1"] < c["gy2"], "the land is filled with a gradient, lightest at the top and darker downwards: " + " ".join(c["stops"]))
        check(abs(c["svgW"] - c["hostW"]) < 2, "the chart fills its space: %d of %d" % (c["svgW"], c["hostW"]))
        check(c["tickPx"] >= 13 and c["labPx"] >= 13, "the chart's text is 13px or more: %s, %s" % (c["tickPx"], c["labPx"]))
        check(any(t.startswith("-") or t.startswith("−") for t in c["ticks"]) and any(re.search(r"\d (km|mi)$", t) for t in c["ticks"]), "heights below sea level and distances are on the scales: " + ", ".join(c["ticks"]))
        st = page.evaluate("""(() => { const s = [...document.querySelectorAll('#profStats .prof-stat')]; const cb = document.getElementById('profChart').getBoundingClientRect();
          return { text: s.map(x => x.querySelector('dt').textContent + ' ' + x.querySelector('dd').textContent), tops: s.map(x => Math.round(x.getBoundingClientRect().top)), chartBottom: cb.bottom,
            dt: parseFloat(getComputedStyle(s[0].querySelector('dt')).fontSize), dd: parseFloat(getComputedStyle(s[0].querySelector('dd')).fontSize), status: document.getElementById('profStatus').textContent }; })()""")
        check(len(st["text"]) == 5 and len(set(st["tops"])) == 1 and st["tops"][0] >= st["chartBottom"] - 1, "the five figures are in one row under the chart: " + " | ".join(st["text"]))
        check(st["dt"] >= 14 and st["dd"] >= 16, "the figures' text is 14px and 16px: %s, %s" % (st["dt"], st["dd"]))
        check(all(not re.search(r"\d\.\d", x) or "km" in x or "mi" in x for x in st["text"]) and "below sea level" in st["status"], "what a screen reader is told: " + st["status"])
        low = [x for x in st["text"] if x.startswith("Lowest")][0]
        check("-" in low or "−" in low, "the lowest place is below sea level: " + low)
        page.screenshot(path=str(shots / "elevation-sea.png"))

        print("== a dot on the line on the map")
        check(dot() is None, "no dot before the chart is pointed at")
        cb = page.evaluate("(() => { const b = document.getElementById('profChart').getBoundingClientRect(); return [b.left, b.top, b.width, b.height]; })()")
        alongs = []
        for f in (0.3, 0.7):
            page.mouse.move(cb[0] + cb[2] * f, cb[1] + cb[3] / 2, steps=3); page.wait_for_timeout(500)
            d = dot(); ok, along = on_line([d["x"], d["y"]], PATH, 30) if d else (False, -1); alongs.append(along)
            check(ok, "pointing %d%% of the way across the chart puts the dot on the line, %d%% of the way along it" % (f * 100, along * 100))
        check(abs(alongs[0] - 0.28) < 0.06 and abs(alongs[1] - 0.72) < 0.06 and alongs[0] > alongs[1] - 1 and alongs[0] != alongs[1], "the dot follows the pointer")
        tip = page.evaluate("(() => { const t = document.getElementById('profTip'); return t && !t.hidden ? t.textContent : ''; })()")
        check(re.search(r"(km|mi) along: -?[\d,]+ (m|ft)$", tip.replace("\u2212", "-")) is not None, "the place's distance and height are shown: " + tip)
        page.screenshot(path=str(shots / "elevation-dot.png"))
        page.mouse.move(mid[0], mid[1]); page.wait_for_timeout(400)
        check(dot() is None, "the dot goes when the pointer leaves the chart")
        page.focus("#profChart"); page.keyboard.press("Home"); page.wait_for_timeout(300)
        d0 = dot(); page.keyboard.press("ArrowRight"); page.keyboard.press("ArrowRight"); page.wait_for_timeout(300); d1 = dot()
        ar = page.evaluate("(() => { const h = document.getElementById('profChart'); return [h.getAttribute('role'), h.getAttribute('aria-valuenow'), h.getAttribute('aria-valuetext'), h.getAttribute('aria-valuemax')]; })()")
        check(d0 and d1 and abs(d0["x"] - A[0]) < 50 and d1["x"] != d0["x"] and on_line([d1["x"], d1["y"]], PATH, 30)[0], "Home and the arrow keys move the dot along the line")
        check(ar[0] == "slider" and int(ar[1]) > 0 and "along" in (ar[2] or "") and int(ar[3]) > 100, "the chart says where it is to a screen reader: " + json.dumps(ar))
        axe("#profilePanel", "the Elevation dock with a chart")

        print("== a line over land only")
        page.click("#profNew"); page.wait_for_selector("#profChart .prof-msg", timeout=10000)
        check(not [g for g in page.evaluate(GFX)], "New line clears the map")
        go(-3.9, 40.6, 9)   # the hills north of Madrid
        draw([-4.3, 40.5], [-3.6, 40.8])
        check(charted(), "a second line is charted")
        c2 = page.evaluate("(() => ({ sea: !!document.querySelector('#profChart .prof-sea'), water: !!document.querySelector('#profChart .prof-water'), label: !!document.querySelector('#profChart .prof-sea-label'), low: [...document.querySelectorAll('#profStats .prof-stat')].map(x => x.textContent).find(x => x.startsWith('Lowest')), status: document.getElementById('profStatus').textContent }))()")
        check(not c2["sea"] and not c2["water"] and not c2["label"] and "below sea level" not in c2["status"], "no sea-level line or water over land: " + str(c2["low"]))
        page.screenshot(path=str(shots / "elevation-land.png"))
        page.evaluate("document.querySelector('#profilePanel [data-close]').click()"); page.wait_for_timeout(800)
        check(not page.evaluate(GFX) and page.evaluate(CURSOR, mid) != "crosshair", "closing the tool clears the map and gives the pointer back: " + page.evaluate(CURSOR, mid))

        print("== a sketched line")
        go(-9.6, 39.0, 8)
        page.click("#tool-sketch"); page.wait_for_function("document.querySelector('arcgis-sketch') && document.querySelector('arcgis-sketch').state === 'ready'", timeout=120000); page.wait_for_timeout(1500)
        page.evaluate("async () => { await document.querySelector('arcgis-sketch').create('polyline'); }"); page.wait_for_timeout(900)
        s1, s2, s3 = to_screen([-8.9, 38.6]), to_screen([-9.6, 38.9]), to_screen([-10.4, 38.6])
        page.mouse.move(s1[0], s1[1]); page.mouse.click(s1[0], s1[1]); page.wait_for_timeout(500)
        page.mouse.move(s2[0], s2[1], steps=4); page.mouse.click(s2[0], s2[1]); page.wait_for_timeout(500)
        page.mouse.move(s3[0], s3[1], steps=4); page.mouse.dblclick(s3[0], s3[1]); page.wait_for_timeout(1500)
        sk = page.evaluate("(() => " + V + ".map.layers.find(x => x.id === '__sketch').graphics.filter(g => g.geometry.type === 'polyline').map(g => g.geometry.toJSON().paths[0]).toArray())()")
        check(len(sk) == 1 and len(sk[0]) == 3, "a three-point line is sketched")
        go(-40, 40, 3); page.click("#tool-profile"); page.wait_for_selector("#profChart .prof-land", timeout=60000); page.click("#profNew"); page.wait_for_selector("#profChart .prof-msg", timeout=10000)
        draw([-74, 40.7], [-9.1, 38.7])   # New York to Lisbon
        check(charted(), "a line across the Atlantic is charted")
        ln = [g for g in page.evaluate(GFX) if g["type"] == "polyline"][0]["json"]["paths"][0]; top = max(q[1] for q in ln)
        lat = math.degrees(2 * math.atan(math.exp(top / 6378137)) - math.pi / 2)
        length = [x.textContent if hasattr(x, "textContent") else x for x in page.evaluate("[...document.querySelectorAll('#profStats .prof-stat')].map(x => x.textContent)")][0]
        num = float(re.sub(r"[^\d.]", "", length)); km = num * 1.609344 if "mi" in length else num
        # the great circle from New York to Lisbon is about 5,420 km and reaches about 45 N; the straight line on the map is about 5,560 km and stays below 41 N
        check(44.5 < lat < 47.5 and 5330 < km < 5500, "it goes the great-circle way: up to %.1f N, %s" % (lat, length))
        last = page.evaluate("(() => { const t = [...document.querySelectorAll('#profChart .prof-tick')].pop().getBoundingClientRect(), c = document.getElementById('profChart').getBoundingClientRect(); return [t.right, c.right]; })()")
        check(last[0] <= last[1] + 0.5, "the last distance label is inside the chart: %d of %d" % (last[0], last[1]))
        check(page.evaluate("document.querySelector('#profChart .prof-top').getAttribute('stroke-width')") == "1", "the surface line is 1px")
        page.screenshot(path=str(shots / "elevation-atlantic.png"))
        page.evaluate("document.querySelector('#profilePanel [data-close]').click()"); page.wait_for_timeout(800); go(-9.6, 39.0, 8)
        page.click("#tool-profile"); page.wait_for_selector("#profChart .prof-land", timeout=60000)
        check(len([g for g in page.evaluate(GFX) if g["type"] == "polyline"]) == 1, "opened again, the tool still has the last line and its chart")
        page.click("#profNew"); page.wait_for_selector("#profChart .prof-msg", timeout=10000); page.wait_for_timeout(800)
        opts = page.evaluate("[...document.getElementById('profLines').options].map(o => o.textContent)")
        check(page.is_visible("#profLines") and len(opts) == 2, "the sketched line is in the list of lines: " + json.dumps(opts))
        s1, s2 = to_screen([-8.9, 38.6]), to_screen([-9.6, 38.9])   # the map is shorter now the dock is open: where the line is on the page
        on = [(s1[0] + s2[0]) / 2, (s1[1] + s2[1]) / 2]; off = [on[0], on[1] - 90]
        page.mouse.move(off[0], off[1]); page.wait_for_timeout(600); c_off = page.evaluate(CURSOR, off)
        page.mouse.move(on[0], on[1], steps=4); page.wait_for_timeout(900); c_on = page.evaluate(CURSOR, on)
        check(c_off == "crosshair" and c_on == "pointer", "over the sketched line the pointer becomes the selecting hand: %s, then %s" % (c_off, c_on))
        page.screenshot(path=str(shots / "elevation-over-line.png"))
        page.mouse.click(on[0], on[1])
        check(charted(), "clicking the sketched line charts it")
        pl = [g for g in page.evaluate(GFX) if g["type"] == "polyline"]
        check(len(pl) == 1 and len(pl[0]["json"]["paths"][0]) == 3, "the line charted is the sketched line (three points)")
        cb = page.evaluate("(() => { const b = document.getElementById('profChart').getBoundingClientRect(); return [b.left, b.top, b.width, b.height]; })()")
        hits = []
        for f in (0.25, 0.8):
            page.mouse.move(cb[0] + cb[2] * f, cb[1] + cb[3] / 2, steps=3); page.wait_for_timeout(500); d = dot()
            hits.append(bool(d) and (on_segment([d["x"], d["y"]], sk[0][0], sk[0][1], 60)[0] or on_segment([d["x"], d["y"]], sk[0][1], sk[0][2], 60)[0]))
        check(hits == [True, True], "pointing at the chart puts the dot on the sketched line, on both of its parts")
        check(page.evaluate("!!document.querySelector('#profChart .prof-sea')"), "the sketched line runs out to sea, so sea level is marked")
        page.screenshot(path=str(shots / "elevation-sketch-line.png"))
        page.mouse.move(mid[0], mid[1])
        page.click("#profNew"); page.wait_for_selector("#profChart .prof-msg", timeout=10000)
        page.select_option("#profLines", "0")
        check(charted() and len([g for g in page.evaluate(GFX) if g["type"] == "polyline" and len(g["json"]["paths"][0]) == 3]) == 1, "choosing the line from the list charts it too")

        print("== a narrow screen")
        page.set_viewport_size({"width": 390, "height": 760}); page.wait_for_timeout(1500)
        n = page.evaluate("(() => { const c = document.getElementById('profChart').getBoundingClientRect(), s = document.querySelector('#profChart svg').getBoundingClientRect(), d = document.getElementById('profilePanel').getBoundingClientRect(); return { chart: c.width, svg: s.width, h: c.height, over: document.documentElement.scrollWidth > innerWidth, dockBottom: d.bottom, win: innerHeight }; })()")
        check(abs(n["svg"] - n["chart"]) < 2 and n["chart"] > 350 and n["h"] >= 100 and not n["over"] and n["dockBottom"] <= n["win"] + 1, "on a phone the chart is redrawn to fit: " + json.dumps(n))
        page.screenshot(path=str(shots / "elevation-phone.png"))
        check(not errors, "no script errors" + (": " + " | ".join(errors[:3]) if errors else ""))
        browser.close()
    srv.shutdown()
    print(f"\n{checks[0] - len(failures)} of {checks[0]} checks passed")
    sys.exit(1 if failures else 0)

if __name__ == "__main__":
    main()
