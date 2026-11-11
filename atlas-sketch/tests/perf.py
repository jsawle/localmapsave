"""Measures what Atlas 5.0 (atlas-sketch) downloads to open a map, and how long it takes on a slow school connection.

Run:  python3 atlas-sketch/tests/perf.py [--app DIR] [--query "config=mapmaker&webmap=<id>"] [--json FILE]
Needs network access to js.arcgis.com and www.arcgis.com, and Python Playwright with Chromium.

The connection is held to 1.6 Mbit/s down, 750 kbit/s up and 150 ms delay (Chrome's "Slow 4G"-like profile: a busy
classroom sharing one line), with an empty cache. "Usable" is when the 2D map has drawn and the map's layers are
listed. It reports requests and bytes by where they come from, and repeat requests for the same address.
"""
import argparse, collections, functools, glob, http.server, json, os, pathlib, sys, threading, time, urllib.parse
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
QUAKES = "85997c9571e74256af71dc20566b47f1"

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass

def kind(url):
    h = urllib.parse.urlparse(url).netloc
    if h.startswith("localhost"): return "the app's own files"
    if h == "js.arcgis.com": return "ArcGIS Maps SDK (js.arcgis.com)"
    if "/sharing/rest/" in url: return "ArcGIS Online items and searches"
    return "map data, tiles and fonts"

def measure(app, query, proxy, throttle=True, settle=6000):
    srv = http.server.ThreadingHTTPServer(("localhost", 0), functools.partial(Quiet, directory=str(app)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    found = sorted(glob.glob("/opt/pw-browsers/chromium-*/chrome-linux*/chrome"))
    chrome = os.environ.get("CHROME") or (found[-1] if found else None)
    with sync_playwright() as p:
        launch = {"args": ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]}
        if chrome: launch["executable_path"] = chrome
        if proxy: launch["proxy"] = {"server": proxy, "bypass": "localhost,127.0.0.1"}
        browser = p.chromium.launch(**launch)
        page = browser.new_context(viewport={"width": 1366, "height": 768}).new_page()
        cdp = page.context.new_cdp_session(page)
        cdp.send("Network.enable")
        if throttle: cdp.send("Network.emulateNetworkConditions", {"offline": False, "latency": 150, "downloadThroughput": 1.6e6 / 8, "uploadThroughput": 750e3 / 8})
        urls, sizes = {}, {}
        cdp.on("Network.requestWillBeSent", lambda e: urls.setdefault(e["requestId"], e["request"]["url"]))
        cdp.on("Network.loadingFinished", lambda e: sizes.__setitem__(e["requestId"], e.get("encodedDataLength", 0)))
        t0 = time.time()
        page.goto(f"http://localhost:{srv.server_port}/index.html?{query}", wait_until="commit")
        page.wait_for_function("(() => { const m = document.querySelector('arcgis-map'); return !!(m && m.view && m.view.ready); })()", timeout=600000, polling=250)
        t_view = time.time() - t0
        if "webmap=" in query:
            page.wait_for_function("(() => { const b = document.querySelector('#layersBadge'), v = document.querySelector('arcgis-map').view; return !!b && Number(b.textContent) >= 1 && !v.updating; })()", timeout=600000, polling=250)
        else:
            page.wait_for_function("!document.querySelector('arcgis-map').view.updating", timeout=600000, polling=250)
        t_use = time.time() - t0
        page.wait_for_timeout(settle)
        by = collections.defaultdict(lambda: [0, 0]); seen = collections.Counter()
        for rid, u in urls.items():
            if u.startswith("data:") or u.startswith("blob:"): continue
            k = kind(u); by[k][0] += 1; by[k][1] += sizes.get(rid, 0); seen[u.split("&token=")[0]] += 1
        repeats = sorted(((n, u) for u, n in seen.items() if n > 1 and "/tile/" not in u), reverse=True)
        sdk = sorted(((sizes.get(rid, 0), u) for rid, u in urls.items() if "js.arcgis.com" in u), reverse=True)
        browser.close()
    srv.shutdown()
    return {"view_s": round(t_view, 1), "usable_s": round(t_use, 1), "requests": sum(v[0] for v in by.values()), "kB": round(sum(v[1] for v in by.values()) / 1024),
            "by": {k: {"requests": v[0], "kB": round(v[1] / 1024)} for k, v in by.items()}, "repeats": [[n, u[:160]] for n, u in repeats[:12]],
            "largest_sdk": [[round(s / 1024), u.replace("https://js.arcgis.com/", "")[:90]] for s, u in sdk[:14]]}

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--app", default=str(HERE.parent)); ap.add_argument("--query", default=f"config=mapmaker&webmap={QUAKES}")
    ap.add_argument("--proxy", default=os.environ.get("HTTPS_PROXY", "")); ap.add_argument("--json", default=""); ap.add_argument("--fast", action="store_true")
    a = ap.parse_args()
    r = measure(pathlib.Path(a.app), a.query, a.proxy, throttle=not a.fast)
    print(f"map drawn after {r['view_s']} s, usable after {r['usable_s']} s; {r['requests']} requests, {r['kB']} kB" + ("" if a.fast else " (1.6 Mbit/s, 150 ms)"))
    for k, v in sorted(r["by"].items(), key=lambda x: -x[1]["kB"]): print(f"  {v['kB']:>6} kB  {v['requests']:>4} requests  {k}")
    if r["repeats"]:
        print("  asked for more than once:")
        for n, u in r["repeats"]: print(f"    {n}x {u}")
    print("  largest SDK files:")
    for s, u in r["largest_sdk"]: print(f"    {s:>5} kB  {u}")
    if a.json: pathlib.Path(a.json).write_text(json.dumps(r, indent=1))

if __name__ == "__main__":
    main()
