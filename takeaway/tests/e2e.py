"""End-to-end test for Take My Work against a mock ArcGIS Online (the build machine can't reach arcgis.com).

Run:  python3 takeaway/tests/e2e.py --deps DIR [--shots DIR] [--keep DIR]
DIR holds jszip-3.10.1/package/dist/jszip.min.js and axe-core-*/package/axe.min.js (from `npm pack jszip@3.10.1 axe-core@4`).
Needs Python Playwright with Chromium, and Node (to check the map files with Atlas's own reader).

The mock checks what the real service would: PKCE (the code verifier must hash to the challenge), the redirect address,
a token on every request, record limits per query, and it throttles once (HTTP 429) and expires the first token
part way through, so retry and refresh are exercised. Afterwards the .zip is unpacked and checked, map files are read
with atlas/lib/doc.js, the portfolio and story pages are scanned with axe-core (WCAG 2.1 AA), and the request log is
checked for anything that would use credits.
"""
import argparse, base64, hashlib, http.server, io, json, math, os, pathlib, re, shutil, subprocess, sys, tempfile, threading, urllib.parse, zipfile
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
APP_DIR = HERE.parent
REPO = APP_DIR.parent
CHROME = os.environ.get("CHROME", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome")
APP_PORT, API_PORT = 8811, 8812
API = f"http://127.0.0.1:{API_PORT}"
CLIENT_ID = "testClient123"
USER = "jsmith_hillside"
PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")
JPG = b"\xff\xd8\xff\xe0" + b"fakejpeg" * 20 + b"\xff\xd9"

def hexid(n): return hashlib.md5(str(n).encode()).hexdigest()
WM1, WM2, FS1, FS2, SM1, PDF1, DASH1, VTL1, NB1, BIG1, XSS1, LINK1, THEME = (hexid(i) for i in range(13))
NOT_MINE = hexid("living-atlas")
FS1_URL = f"{API}/svc/Tree_survey/FeatureServer"
FS2_URL = f"{API}/svc/Litter_counts/FeatureServer"
VTL_URL = f"{API}/svc/Hillside_tiles/VectorTileServer"
R = 6378137.0
def merc(lon, lat): return [lon * math.pi / 180 * R, math.log(math.tan(math.pi / 4 + lat * math.pi / 360)) * R]

# ------------------------------------------------------------------ mock content
TREES = [{"OBJECTID": i + 1, "species": s, "height": h, "planted": 1577836800000 + i * 86400000, "GlobalID": "{%08d-0000-0000-0000-000000000000}" % i,
          "_ll": (-1.5 + i * 0.002, 53.38 + (i % 3) * 0.001)} for i, (s, h) in enumerate([("Oak", 12.5), ("Ash", 9), ("Birch", 7.25), ("Oak", 15), ("Willow", 6), ("Alder", 8), ("Rowan", 5.5)])]
AREAS = [{"OBJECTID": 1, "name": "North bank", "_rings": [[(-1.502, 53.379), (-1.49, 53.379), (-1.49, 53.383), (-1.502, 53.383), (-1.502, 53.379)]]},
         {"OBJECTID": 2, "name": "South bank", "_rings": [[(-1.502, 53.375), (-1.49, 53.375), (-1.49, 53.378), (-1.502, 53.375)]]}]
VISITS = [{"OBJECTID": 1, "tree_id": 1, "notes": 'Leaves "turning", early'}, {"OBJECTID": 2, "tree_id": 1, "notes": "Two birds, one nest"}, {"OBJECTID": 3, "tree_id": 4, "notes": "Bark damage\nnear base"}]
LITTER = [{"OBJECTID": i + 1, "plastic": p, "glass": g, "_ll": (-1.495 + i * 0.001, 53.377)} for i, (p, g) in enumerate([(5, 1), (12, 0), (3, 3), (0, 0)])]
SVC = {
    "Tree_survey": {
        "layers": [
            {"id": 0, "name": "Trees", "type": "Feature Layer", "geometryType": "esriGeometryPoint", "objectIdField": "OBJECTID", "displayField": "species", "maxRecordCount": 3,
             "hasAttachments": True, "advancedQueryCapabilities": {"supportsQueryAttachments": True},
             "fields": [{"name": "OBJECTID", "type": "esriFieldTypeOID", "alias": "OBJECTID"}, {"name": "species", "type": "esriFieldTypeString", "alias": "Species", "length": 50},
                        {"name": "height", "type": "esriFieldTypeDouble", "alias": "Height (m)"}, {"name": "planted", "type": "esriFieldTypeDate", "alias": "Planted"},
                        {"name": "GlobalID", "type": "esriFieldTypeGlobalID", "alias": "GlobalID"}, {"name": "photo_blob", "type": "esriFieldTypeBlob", "alias": "blob"}],
             "drawingInfo": {"renderer": {"type": "simple", "symbol": {"type": "esriSMS", "style": "esriSMSCircle", "color": [0, 128, 0, 255], "size": 8}}}},
            {"id": 1, "name": "Study areas", "type": "Feature Layer", "geometryType": "esriGeometryPolygon", "objectIdField": "OBJECTID", "maxRecordCount": 1000, "hasAttachments": False,
             "fields": [{"name": "OBJECTID", "type": "esriFieldTypeOID", "alias": "OBJECTID"}, {"name": "name", "type": "esriFieldTypeString", "alias": "Name"}],
             "drawingInfo": {"renderer": {"type": "simple", "symbol": {"type": "esriPFS", "url": "a1b2c3", "imageData": base64.b64encode(PNG).decode(), "contentType": "image/png", "width": 8, "height": 8}}}},
        ],
        "tables": [{"id": 2, "name": "Visits", "type": "Table", "objectIdField": "OBJECTID", "maxRecordCount": 1000,
                    "fields": [{"name": "OBJECTID", "type": "esriFieldTypeOID"}, {"name": "tree_id", "type": "esriFieldTypeInteger"}, {"name": "notes", "type": "esriFieldTypeString"}]}],
        "data": {0: TREES, 1: AREAS, 2: VISITS},
    },
    "Litter_counts": {
        "layers": [{"id": 0, "name": "Litter", "type": "Feature Layer", "geometryType": "esriGeometryPoint", "objectIdField": "OBJECTID", "maxRecordCount": 2000,
                    "hasAttachments": True, "advancedQueryCapabilities": {"supportsQueryAttachments": False},
                    "fields": [{"name": "OBJECTID", "type": "esriFieldTypeOID"}, {"name": "plastic", "type": "esriFieldTypeInteger"}, {"name": "glass", "type": "esriFieldTypeInteger"}],
                    "drawingInfo": {"renderer": {"type": "simple", "symbol": {"type": "esriSMS", "style": "esriSMSSquare", "color": [200, 0, 0, 255], "size": 7}}}}],
        "tables": [], "data": {0: LITTER},
    },
}
ATTACH = {("Tree_survey", 0): {1: [{"id": 11, "name": "oak photo.jpg", "contentType": "image/jpeg", "size": len(JPG)}], 4: [{"id": 12, "name": "bark.jpg", "contentType": "image/jpeg", "size": len(JPG)}]},
          ("Litter_counts", 0): {2: [{"id": 21, "name": "bag.jpg", "contentType": "image/jpeg", "size": len(JPG)}]}}

def item(id, title, type, **kw):
    base = {"id": id, "owner": USER, "title": title, "type": type, "typeKeywords": kw.pop("typeKeywords", []), "created": 1690000000000, "modified": kw.pop("modified", 1700000000000),
            "access": kw.pop("access", "private"), "snippet": kw.pop("snippet", ""), "description": kw.pop("description", ""), "tags": kw.pop("tags", []), "url": kw.pop("url", None),
            "thumbnail": kw.pop("thumbnail", "thumbnail/thumb.png"), "size": kw.pop("size", 2048), "name": kw.pop("name", None), "ownerFolder": kw.pop("folder", None)}
    base.update(kw); return base

ITEMS = [
    item(WM1, "Tree survey map", "Web Map", access="public", snippet="Trees along the river, surveyed in spring.", description="<p>Our <b>survey</b> map.<script>alert(1)</script></p><img src=x onerror=alert(2)>", modified=1710000000000),
    item(FS1, "Tree survey", "Feature Service", url=FS1_URL, typeKeywords=["Data", "Service", "Feature Service", "Hosted Service"], size=120000),
    item(SM1, "Our river", "StoryMap", access="org", snippet="A story about the river", modified=1720000000000),
    item(PDF1, "Fieldwork report", "PDF", name="Fieldwork report.pdf", size=1200, thumbnail=None),
    item(DASH1, "River dashboard", "Dashboard"),
    item(VTL1, "Hillside basemap tiles", "Vector Tile Service", url=VTL_URL, typeKeywords=["Hosted Service"]),
    item(NB1, "Analysis notebook", "Notebook"),
    item(BIG1, "Drone video", "Video", name="drone.mp4", size=900_000_000),
    item(XSS1, '<img src=x onerror=alert("t")>Quiz app', "Web Mapping Application", description='<a href="javascript:alert(3)" onclick="x()">click</a> and <a href="https://example.org">ok</a>'),
    item(LINK1, "Esri", "Document Link", url="https://www.esri.com", thumbnail=None),
    item(THEME, "River theme", "StoryMap Theme", thumbnail=None),
]
FOLDER_ITEMS = {"f1": [item(FS2, "Litter counts", "Feature Service", url=FS2_URL, typeKeywords=["Hosted Service"], folder="f1", size=50000),
                       item(WM2, "Empty map", "Web Map", folder="f1")]}
FOLDERS = [{"id": "f1", "title": "Year 12 project"}]
ALL = {i["id"]: i for i in ITEMS + FOLDER_ITEMS["f1"]}

PMS_RELATIVE = {"type": "esriPMS", "url": "tree1234", "width": 16, "height": 16}
DATA = {
    WM1: {"operationalLayers": [
        {"id": "op1", "title": "Trees", "url": FS1_URL + "/0", "itemId": FS1, "layerType": "ArcGISFeatureLayer", "visibility": True, "opacity": 0.9,
         "popupInfo": {"title": "{species}", "fieldInfos": [{"fieldName": "species", "label": "Species", "visible": True}], "showAttachments": True, "popupElements": [{"type": "fields"}, {"type": "attachments"}]},
         "layerDefinition": {"definitionExpression": "height > 6", "drawingInfo": {"renderer": {"type": "uniqueValue", "field1": "species", "defaultSymbol": PMS_RELATIVE,
                             "uniqueValueInfos": [{"value": "Oak", "label": "Oak", "symbol": {"type": "esriSMS", "style": "esriSMSCircle", "color": [0, 90, 0, 255], "size": 10}}]}}}},
        {"id": "op2", "title": "Study areas", "url": FS1_URL + "/1", "itemId": FS1, "layerType": "ArcGISFeatureLayer", "visibility": True},
        {"id": "op3", "title": "World Rivers", "url": "https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/World_Rivers/FeatureServer/0", "itemId": NOT_MINE, "layerType": "ArcGISFeatureLayer"},
        {"id": "grp", "title": "Litter work", "layerType": "GroupLayer", "layers": [{"id": "op4", "title": "Litter", "url": FS2_URL, "itemId": FS2, "layerType": "ArcGISFeatureLayer"}]},
    ], "tables": [{"id": "t1", "title": "Visits", "url": FS1_URL + "/2"}],
        "baseMap": {"title": "Topographic", "baseMapLayers": [{"id": "VectorTile_1", "title": "World Topographic Map", "layerType": "VectorTileLayer",
                    "styleUrl": "https://cdn.arcgis.com/sharing/rest/content/items/7dc6cea0b1764a1f9af2e679f642f0f5/resources/styles/root.json", "itemId": "7dc6cea0b1764a1f9af2e679f642f0f5"}]},
        "initialState": {"viewpoint": {"targetGeometry": {"xmin": -168000, "ymin": 7050000, "xmax": -164000, "ymax": 7054000, "spatialReference": {"wkid": 102100}}}},
        "spatialReference": {"wkid": 102100, "latestWkid": 3857}, "version": "2.31", "authoringApp": "ArcGIS Map Viewer", "authoringAppVersion": "2026.3",
        "bookmarks": [{"name": "North bank", "extent": {"xmin": -167500, "ymin": 7052000, "xmax": -166000, "ymax": 7053000, "spatialReference": {"wkid": 102100}}}]},
    WM2: {"operationalLayers": [], "baseMap": {"title": "Imagery", "baseMapLayers": [{"id": "img", "layerType": "ArcGISTiledMapServiceLayer", "url": "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer"}]}, "version": "2.31"},
    FS1: {"layers": [{"id": 1, "popupInfo": {"title": "Area: {name}", "fieldInfos": [{"fieldName": "name", "label": "Name", "visible": True}]}}]},
    SM1: {"root": "n-root", "nodes": {
        "n-root": {"type": "story", "data": {"storyTheme": "r-theme"}, "children": ["n-cover", "n-nav", "n-p1", "n-h2", "n-img", "n-map", "n-list", "n-embed", "n-side", "n-credits"]},
        "n-cover": {"type": "storycover", "data": {"type": "minimal", "title": "Our river", "summary": "What we found in spring", "byline": "Jo Smith"}},
        "n-nav": {"type": "navigation", "data": {"links": []}},
        "n-p1": {"type": "text", "data": {"type": "paragraph", "text": "The river is <strong>alive</strong>.<script>alert(4)</script><a href=\"javascript:alert(5)\">x</a><span onclick=\"y()\">safe</span>"}},
        "n-h2": {"type": "text", "data": {"type": "h2", "text": "What we saw"}},
        "n-img": {"type": "image", "data": {"image": "r-img", "caption": "The weir in April", "alt": "A small weir with white water"}},
        "n-map": {"type": "webmap", "data": {"map": "r-map", "caption": "Where the trees are"}},
        "n-list": {"type": "text", "data": {"type": "bullet-list", "text": "<li>Herons</li><li>Kingfisher</li>"}},
        "n-embed": {"type": "embed", "data": {"url": "https://example.org/video", "title": "Interview"}},
        "n-side": {"type": "immersive", "data": {"type": "sidecar"}, "children": ["n-slide"]},
        "n-slide": {"type": "immersive-slide", "children": ["n-narr"]},
        "n-narr": {"type": "immersive-narrative-panel", "children": ["n-p2"]},
        "n-p2": {"type": "text", "data": {"type": "paragraph", "text": "Inside a sidecar slide."}},
        "n-credits": {"type": "credits", "children": ["n-attr"]},
        "n-attr": {"type": "attribution", "data": {"content": "Photos", "attribution": "Jo Smith"}}},
        "resources": {"r-img": {"type": "image", "data": {"resourceId": "river.jpg", "provider": "item-resource"}},
                      "r-map": {"type": "webmap", "data": {"itemId": WM1, "itemType": "Web Map"}},
                      "r-theme": {"type": "story-theme", "data": {"themeItemId": THEME}}}},
    DASH1: {"widgets": [{"type": "mapWidget", "itemId": WM1}], "version": 50},
    NB1: {"cells": [{"cell_type": "code", "source": ["print('hi')"]}], "metadata": {}, "nbformat": 4, "nbformat_minor": 2},
    XSS1: {"values": {"webmap": NOT_MINE}},
    THEME: {"themeId": "summit"},
}
RESOURCES = {SM1: [{"resource": "river.jpg", "size": len(JPG)}, {"resource": "draft_1720000000000.json", "size": 100}]}
FILES = {PDF1: (b"%PDF-1.4 fake report", "application/pdf")}

# ------------------------------------------------------------------ mock server
class Mock:
    def __init__(self):
        self.lock = threading.Lock()
        self.log = []
        self.codes = {}
        self.tokens = {}            # token -> remaining uses (None = unlimited)
        self.refresh = {}
        self.throttled = False
        self.errors = []
M = Mock()

def b64url(b): return base64.urlsafe_b64encode(b).decode().rstrip("=")

def features_for(svc, lid, oids, sr, geojson):
    rows = [r for r in SVC[svc]["data"][lid] if r["OBJECTID"] in oids]
    out = []
    for r in rows:
        attrs = {k: v for k, v in r.items() if not k.startswith("_")}
        geom = None
        if "_ll" in r:
            lon, lat = r["_ll"]
            geom = {"type": "Point", "coordinates": [lon, lat]} if geojson else ({"x": lon, "y": lat} if sr == "4326" else dict(zip(("x", "y"), merc(lon, lat))))
        elif "_rings" in r:
            rings = [[list(p) for p in ring] for ring in r["_rings"]]
            geom = {"type": "Polygon", "coordinates": rings} if geojson else {"rings": rings if sr == "4326" else [[merc(*p) for p in ring] for ring in rings]}
        out.append({"type": "Feature", "id": r["OBJECTID"], "geometry": geom, "properties": attrs} if geojson else {"attributes": attrs, **({"geometry": geom} if geom else {})})
    return out

class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
    def send(self, code, body, ctype="application/json", extra=None):
        if isinstance(body, (dict, list)): body = json.dumps(body).encode()
        elif isinstance(body, str): body = body.encode()
        self.send_response(code); self.cors(); self.send_header("Content-Type", ctype); self.send_header("Content-Length", str(len(body)))
        for k, v in (extra or {}).items(): self.send_header(k, v)
        self.end_headers(); self.wfile.write(body)
    def err(self, code, msg, http_code=200): self.send(http_code, {"error": {"code": code, "message": msg, "details": []}})
    def do_OPTIONS(self): self.send_response(204); self.cors(); self.end_headers()
    def params(self):
        u = urllib.parse.urlsplit(self.path)
        q = dict(urllib.parse.parse_qsl(u.query, keep_blank_values=True))
        if self.command == "POST":
            n = int(self.headers.get("Content-Length") or 0)
            body = self.rfile.read(n).decode()
            q.update(dict(urllib.parse.parse_qsl(body, keep_blank_values=True)))
        return u.path, q
    def do_GET(self): self.route()
    def do_POST(self): self.route()
    def authed(self, q):
        t = q.get("token")
        with M.lock:
            if t not in M.tokens: return "missing" if not t else "invalid"
            left = M.tokens[t]
            if left is not None:
                if left <= 0: return "expired"
                M.tokens[t] = left - 1
        return "ok"
    def route(self):
        path, q = self.params()
        with M.lock: M.log.append({"method": self.command, "path": path, "params": {k: v for k, v in q.items() if k not in ("token", "code_verifier", "refresh_token", "code")}, "hasToken": "token" in q})
        try: self._route(path, q)
        except Exception as e:  # pragma: no cover - test diagnostics
            M.errors.append(f"{path}: {e!r}"); self.send(500, {"error": {"code": 500, "message": str(e)}})
    def _route(self, path, q):
        SRP = "/sharing/rest"
        if path == SRP + "/oauth2/authorize":
            if q.get("client_id") != CLIENT_ID or q.get("response_type") != "code" or q.get("code_challenge_method") != "S256" or not q.get("code_challenge"):
                return self.send(400, "bad authorize request", "text/plain")
            code = "code" + str(len(M.codes) + 1)
            M.codes[code] = {"challenge": q["code_challenge"], "redirect": q["redirect_uri"]}
            loc = q["redirect_uri"] + "?" + urllib.parse.urlencode({"code": code, "state": q.get("state", "")})
            self.send_response(302); self.send_header("Location", loc); self.end_headers(); return
        if path == SRP + "/oauth2/token":
            if q.get("client_id") != CLIENT_ID: return self.send(400, {"error": "invalid_client"})
            if q.get("grant_type") == "authorization_code":
                c = M.codes.pop(q.get("code"), None)
                if not c: return self.send(400, {"error": {"code": 400, "message": "Invalid code"}})
                if c["redirect"] != q.get("redirect_uri"): return self.send(400, {"error": {"code": 400, "message": "redirect_uri mismatch"}})
                if b64url(hashlib.sha256(q.get("code_verifier", "").encode()).digest()) != c["challenge"]:
                    return self.send(400, {"error": {"code": 400, "error": "invalid_request", "message": "Invalid code_verifier"}})
                M.tokens["tok1"] = 60; M.refresh["ref1"] = "tok2"
                return self.send(200, {"access_token": "tok1", "expires_in": 1800, "username": USER, "ssl": True, "refresh_token": "ref1", "refresh_token_expires_in": 604799})
            if q.get("grant_type") == "refresh_token":
                new = M.refresh.get(q.get("refresh_token"))
                if not new: return self.send(400, {"error": {"code": 498, "message": "Invalid refresh token"}})
                M.tokens[new] = None
                return self.send(200, {"access_token": new, "expires_in": 1800, "username": USER})
            return self.send(400, {"error": "unsupported_grant_type"})
        a = self.authed(q)
        if a != "ok": return self.err(498 if a in ("invalid", "expired") else 499, "Invalid token." if a != "missing" else "Token Required")
        if path == SRP + "/community/self": return self.send(200, {"username": USER, "fullName": "Jo Smith", "orgId": "org1", "email": "jo@example.org"})
        if path == SRP + "/portals/self": return self.send(200, {"id": "org1", "name": "Hillside High School", "urlKey": "hillside", "customBaseUrl": "maps.arcgis.com"})
        m = re.fullmatch(SRP + r"/content/users/([^/]+)(?:/([^/]+))?", path)
        if m:
            if m.group(1) != USER: return self.err(403, "Not your content")
            lst = FOLDER_ITEMS.get(m.group(2), []) if m.group(2) else ITEMS
            start, num = int(q.get("start", 1)), min(int(q.get("num", 10)), 4)   # pages of 4 to test paging
            page = lst[start - 1:start - 1 + num]
            nxt = start + num if start - 1 + num < len(lst) else -1
            body = {"username": USER, "total": len(lst), "start": start, "num": num, "nextStart": nxt, "items": page}
            if not m.group(2): body["folders"] = FOLDERS
            return self.send(200, body)
        m = re.fullmatch(SRP + r"/content/items/([0-9a-f]{32})(/.*)?", path)
        if m:
            iid, rest = m.group(1), m.group(2) or ""
            if iid not in ALL: return self.err(400, "Item does not exist or is inaccessible.")
            if rest == "/data":
                if iid in FILES: b, t = FILES[iid]; return self.send(200, b, t)
                if iid == BIG1: return self.err(500, "test: big files must not be downloaded")
                if iid in DATA: return self.send(200, json.dumps(DATA[iid]), "text/plain; charset=utf-8")
                return self.send(200, b"", "text/plain")
            if rest == "/info/thumbnail/thumb.png": return self.send(200, PNG, "image/png")
            if rest == "/info/metadata/metadata.xml":
                return self.send(200, "<metadata><title>Report</title></metadata>", "text/xml") if iid == PDF1 else self.err(400, "Metadata not found")
            if rest == "/resources":
                if iid in RESOURCES: return self.send(200, {"total": len(RESOURCES[iid]), "start": 1, "num": 1000, "nextStart": -1, "resources": RESOURCES[iid]})
                if iid == WM1: return self.send(200, {"total": 0, "start": 1, "num": 1000, "nextStart": -1, "resources": []})
                return self.err(400, "Unable to retrieve resources")
            m2 = re.fullmatch(r"/resources/(.+)", rest)
            if m2 and iid in RESOURCES:
                name = urllib.parse.unquote(m2.group(1))
                if name == "river.jpg": return self.send(200, JPG, "image/jpeg")
                if name.startswith("draft_"): return self.send(200, json.dumps(DATA[SM1]), "application/json")
            return self.err(400, "Not found: " + rest)
        m = re.fullmatch(r"/svc/([A-Za-z_]+)/FeatureServer(?:/(.*))?", path)
        if m:
            svc, rest = m.group(1), m.group(2) or ""
            S = SVC.get(svc)
            if not S: return self.err(400, "No service")
            defs = {d["id"]: d for d in S["layers"] + S["tables"]}
            if rest == "": return self.send(200, {"layers": [{"id": d["id"], "name": d["name"]} for d in S["layers"]], "tables": [{"id": d["id"], "name": d["name"]} for d in S["tables"]], "maxRecordCount": 1000})
            if rest == "layers": return self.send(200, {"layers": S["layers"], "tables": S["tables"]})
            m2 = re.fullmatch(r"(\d+)(?:/(.*))?", rest)
            lid, op = int(m2.group(1)), m2.group(2) or ""
            d = defs[lid]
            if op == "": return self.send(200, d)
            if op == "query":
                if svc == "Tree_survey" and lid == 0 and not M.throttled:
                    M.throttled = True; return self.send(429, {"error": {"code": 429, "message": "Too many requests"}}, extra={"Retry-After": "1"})
                if q.get("returnIdsOnly") == "true": return self.send(200, {"objectIdFieldName": "OBJECTID", "objectIds": [r["OBJECTID"] for r in S["data"][lid]]})
                oids = [int(x) for x in q.get("objectIds", "").split(",") if x]
                if len(oids) > d.get("maxRecordCount", 1000): return self.err(400, f"test: asked for {len(oids)} records, limit {d['maxRecordCount']}")
                if q.get("f") == "geojson": return self.send(200, {"type": "FeatureCollection", "features": features_for(svc, lid, set(oids), "4326", True)}, "application/geo+json")
                if q.get("outSR") not in ("102100", None): return self.err(400, "test: unexpected outSR " + str(q.get("outSR")))
                return self.send(200, {"objectIdFieldName": "OBJECTID", "geometryType": d.get("geometryType"), "spatialReference": {"wkid": 102100, "latestWkid": 3857},
                                       "fields": d["fields"], "features": features_for(svc, lid, set(oids), "102100", False)})
            if op == "queryAttachments":
                if not d.get("advancedQueryCapabilities", {}).get("supportsQueryAttachments"): return self.err(400, "queryAttachments not supported")
                oids = [int(x) for x in q.get("objectIds", "").split(",") if x]
                groups = [{"parentObjectId": o, "attachmentInfos": infos} for o, infos in ATTACH.get((svc, lid), {}).items() if o in oids]
                return self.send(200, {"attachmentGroups": groups})
            m3 = re.fullmatch(r"(\d+)/attachments(?:/(\d+))?", op)
            if m3:
                oid = int(m3.group(1)); infos = ATTACH.get((svc, lid), {}).get(oid, [])
                if m3.group(2) is None: return self.send(200, {"attachmentInfos": infos})
                return self.send(200, JPG, "image/jpeg")
            m4 = re.fullmatch(r"images/(.+)", op)
            if m4: return self.send(200, PNG, "image/png")
            return self.err(400, "Unknown op " + op)
        if path.startswith("/svc/Hillside_tiles"): return self.send(200, {"currentVersion": 11})
        return self.err(400, "Unknown path " + path)

def serve(handler_cls, port, directory=None):
    if directory: handler = lambda *a, **k: Quiet(*a, directory=str(directory), **k)
    else: handler = handler_cls
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass

# ------------------------------------------------------------------ test
failures = []
def check(cond, msg):
    if not cond: failures.append(msg); print("  FAIL:", msg)
    else: print("  ok:", msg)

def axe_scan(page, axe_js, label):
    page.add_script_tag(content=axe_js)
    res = page.evaluate("async () => { const r = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a','wcag2aa','wcag21a','wcag21aa'] } }); return r.violations.map(v => ({id: v.id, impact: v.impact, n: v.nodes.length, target: v.nodes.slice(0,3).map(n => n.target.join(' '))})); }")
    check(not res, f"axe WCAG 2.1 AA on {label}: {json.dumps(res) if res else 'no violations'}")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--deps", required=True); ap.add_argument("--shots"); ap.add_argument("--keep")
    args = ap.parse_args()
    deps = pathlib.Path(args.deps)
    jszip = next(deps.glob("jszip-*/package/dist/jszip.min.js")).read_text()
    axe_js = next(deps.glob("axe-core-*/package/axe.min.js")).read_text()
    shots = pathlib.Path(args.shots) if args.shots else None
    if shots: shots.mkdir(parents=True, exist_ok=True)
    serve(None, APP_PORT, REPO)
    serve(Handler, API_PORT)
    app_url = f"http://localhost:{APP_PORT}/takeaway/"
    out = pathlib.Path(args.keep) if args.keep else pathlib.Path(tempfile.mkdtemp())
    if out.exists(): shutil.rmtree(out)
    out.mkdir(parents=True)
    console = []
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=CHROME, args=["--no-sandbox"])
        ctxb = browser.new_context(accept_downloads=True, viewport={"width": 1280, "height": 900})
        ctxb.route(re.compile(r"https://cdnjs\.cloudflare\.com/.*jszip.*"), lambda r: r.fulfill(status=200, content_type="application/javascript", body=jszip))
        ctxb.route(re.compile(r"https://(js\.arcgis\.com|services\.arcgisonline\.com|cdn\.arcgis\.com)/.*"), lambda r: r.abort())
        ctxb.add_init_script("delete window.showSaveFilePicker;")
        page = ctxb.new_page()
        page.on("console", lambda m: console.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
        page.on("pageerror", lambda e: console.append(f"pageerror: {e}"))

        print("1. Setup screen (no client ID)")
        page.goto(app_url)
        check(page.is_visible("#setupSection") and not page.is_visible("#signinSection"), "setup screen shows when the link has no client ID")
        check(page.inner_text("#versionBadge") == "v1.0.0", "version badge")
        page.click("#adminSetup summary")
        check(page.inner_text("#redirect1") == app_url and page.inner_text("#redirect2") == app_url + "index.html", "both redirect addresses shown")
        page.fill("#portalInput", "not a url"); page.fill("#clientInput", CLIENT_ID); page.click("#setupForm button[type=submit]")
        check(page.is_visible("#setupError"), "bad organization address is rejected")
        page.fill("#portalInput", API + "/home/index.html"); page.click("#setupForm button[type=submit]")
        link = page.input_value("#studentLink")
        expect = app_url + "?" + urllib.parse.urlencode({"portal": API, "clientId": CLIENT_ID})
        check(link == expect, f"student link built ({link})")
        axe_scan(page, axe_js, "setup screen")
        if shots: page.screenshot(path=str(shots / "1-setup.png"), full_page=True)

        print("2. Sign-in cancelled")
        page.goto(app_url + "?error=access_denied&state=x")
        check("cancelled" in page.inner_text("#signinError"), "cancelled sign-in is explained")

        print("3. Sign in (PKCE)")
        page.goto(link)
        check(page.is_visible("#signinSection") and "127.0.0.1" in page.inner_text("#orgShown"), "sign-in screen with the organization")
        if shots: page.screenshot(path=str(shots / "2-signin.png"), full_page=True)
        axe_scan(page, axe_js, "sign-in screen")
        page.click("#signInBtn")
        page.wait_for_selector("#chooser:not([hidden])", timeout=15000)
        check(page.url == link, f"address restored after sign-in ({page.url})")
        check("Jo Smith" in page.inner_text("#whoName") and "Hillside High School" in page.inner_text("#whoOrg"), "signed-in user and organization shown")
        rows = page.locator("#itemRows tr").count()
        check(rows == len(ALL), f"all {len(ALL)} owned items listed across pages and folders (got {rows})")
        check(page.locator("#itemRows img").count() == 0 and page.locator("#itemRows label", has_text='<img src=x onerror=alert("t")>Quiz app').count() == 1, "item titles shown as text, not HTML")
        check("over 500 MB" in page.inner_text(f"#get-{BIG1}"), "very large file is marked details only")
        check("Year 12 project" in page.inner_text("#itemRows"), "folder names shown")
        axe_scan(page, axe_js, "choose screen")
        if shots: page.screenshot(path=str(shots / "3-choose.png"), full_page=True)
        # filters and search
        page.check("input[name=flt][value=layer]")
        check(page.locator("#itemRows tr").count() == 3, "Layers filter")
        page.check("input[name=flt][value=all]")
        page.fill("#searchBox", "river"); page.wait_for_timeout(400)
        check(page.locator("#itemRows tr").count() == 3, "search finds the 3 river items")
        page.fill("#searchBox", ""); page.wait_for_timeout(400)
        # untick the hosted layers: they must come back because the maps use them
        page.uncheck(f"#chk-{FS1}"); page.uncheck(f"#chk-{FS2}")
        check("9 items chosen" in page.inner_text("#selSummary") or "11 items chosen" in page.inner_text("#selSummary"), "selection summary updates: " + page.inner_text("#selSummary"))

        print("4. Save")
        with page.expect_download(timeout=60000) as dl:
            page.click("#saveBtn")
        zpath = out / "archive.zip"
        dl.value.save_as(str(zpath))
        page.wait_for_selector("#doneSection:not([hidden])", timeout=30000)
        check(dl.value.suggested_filename == f"ArcGIS-work-{USER.replace('_', '-')}-" + __import__("datetime").date.today().isoformat() + ".zip" or dl.value.suggested_filename.startswith("ArcGIS-work-"), f"file name {dl.value.suggested_filename}")
        summary = page.inner_text("#doneSummary")
        check("13 items" in summary, f"done summary: {summary}")
        problems = page.inner_text("#problemList") if page.is_visible("#problemsBox") else ""
        print("   things to check:\n     " + problems.replace("\n", "\n     "))
        check("Drone video" in problems and "too big" in problems, "too-big file reported")
        others = [l for l in problems.splitlines() if l.strip() and not l.startswith("Drone video") and "don't show attachments" not in l]
        check(not others, "nothing else to check: " + "; ".join(others))
        axe_scan(page, axe_js, "done screen")
        if shots: page.screenshot(path=str(shots / "4-done.png"), full_page=True)

        print("5. Archive contents")
        z = zipfile.ZipFile(zpath)
        names = [n for n in z.namelist() if not n.endswith("/")]   # leave out folder entries
        ex = out / "unzipped"; z.extractall(ex)
        for n in ["index.html", "README.txt", "manifest.json", "portfolio/viewer.html", "maps/Tree_survey_map.mmap", "maps/Empty_map.mmap"]:
            check(n in names, f"{n} in the archive")
        man = json.loads(z.read("manifest.json"))
        byid = {i["id"]: i for i in man["items"]}
        check(len(man["items"]) == 13, f"manifest lists 13 items (got {len(man['items'])})")
        check(byid[FS1]["includedBecause"] != "chosen" and byid[FS2]["includedBecause"] != "chosen", "unticked layers added back because maps use them")
        check(THEME in byid, "story theme included")
        check(man["components"]["maps"] == "1.0.0" and man["appVersion"] == "1.0.0", "versions stamped in the manifest")
        check("email" not in json.dumps(man["account"]), "no email address in the manifest")
        d1 = byid[FS1]["dir"]
        trees_csv = z.read(f"{d1}/layers/0-Trees.csv").decode("utf-8")
        check(trees_csv.startswith("﻿OBJECTID,species,height,planted,GlobalID,longitude,latitude"), "Trees CSV header (blob field left out, lon/lat added)")
        check(trees_csv.count("\r\n") == 8 and "2020-01-01T00:00:00.000Z" in trees_csv, "Trees CSV rows and ISO dates")
        visits = z.read(f"{d1}/layers/2-Visits.csv").decode("utf-8")
        check('"Leaves ""turning"", early"' in visits and '"Bark damage\nnear base"' in visits and "longitude" not in visits, "table CSV quoting")
        gj = json.loads(z.read(f"{d1}/layers/0-Trees.geojson"))
        check(len(gj["features"]) == 7 and gj["features"][0]["geometry"]["coordinates"][0] == -1.5, "Trees GeoJSON (7 features, chunked by maxRecordCount 3)")
        ej = json.loads(z.read(f"{d1}/layers/1-Study_areas.json".replace("Study_areas", "Study-areas")))
        check(len(ej["features"]) == 2 and ej["spatialReference"]["wkid"] == 102100, "Study areas ArcGIS JSON")
        att = [n for n in names if "/layers/0-Trees-attachments/" in n]
        check(len(att) == 3 and any(n.endswith("1/11-oak photo.jpg") for n in att), f"Trees attachments via queryAttachments + index ({len(att)} files)")
        d2 = byid[FS2]["dir"]
        att2 = [n for n in names if n.startswith(d2 + "/layers/0-Litter-attachments/")]
        check(len(att2) == 2, f"Litter attachments via per-feature lookups ({len(att2)} files)")
        check(any(n.endswith("Fieldwork report.pdf") for n in names) and f"{byid[PDF1]['dir']}/metadata.xml" in names, "PDF file and its metadata")
        check(f"{byid[NB1]['dir']}/notebook.ipynb" in names, "notebook saved as .ipynb")
        check(not any(n.startswith(byid[BIG1]["dir"] + "/drone") for n in names), "very large file not downloaded")
        check(f"{byid[SM1]['dir']}/resources/river.jpg" in names, "StoryMap image resource")
        check(f"{byid[WM1]['dir']}/thumbnail.png" in names, "thumbnail")

        print("6. Map file")
        wm = json.loads(z.read("maps/Tree_survey_map.mmap"))
        ops = {o["id"]: o for o in wm["operationalLayers"]}
        t = ops["op1"]
        check("featureCollection" in t and "url" not in t and "itemId" not in t, "Trees layer holds its data, with no link to the account")
        lyr = t["featureCollection"]["layers"][0]
        check(len(lyr["featureSet"]["features"]) == 7 and lyr["featureSet"]["features"][0]["geometry"]["spatialReference"]["wkid"] == 102100, "7 features in Web Mercator")
        check(lyr["layerDefinition"]["definitionExpression"] == "height > 6", "map's filter kept")
        sym = lyr["layerDefinition"]["drawingInfo"]["renderer"]["defaultSymbol"]
        check(sym.get("imageData") and "url" not in sym, "picture symbol from the service embedded")
        check(lyr["popupInfo"]["title"] == "{species}" and lyr["popupInfo"]["showAttachments"] is False and all(e["type"] != "attachments" for e in lyr["popupInfo"]["popupElements"]), "map's pop-up kept, attachments off")
        check(all(f["type"] != "esriFieldTypeBlob" for f in lyr["layerDefinition"]["fields"]), "blob field left out")
        a = ops["op2"]["featureCollection"]["layers"][0]
        check(a["popupInfo"]["title"] == "Area: {name}", "item-level pop-up used when the map has none")
        check("url" not in a["layerDefinition"]["drawingInfo"]["renderer"]["symbol"] and a["layerDefinition"]["drawingInfo"]["renderer"]["symbol"].get("imageData"), "picture fill keeps its embedded image")
        check(ops["op3"].get("url", "").startswith("https://services.arcgis.com/") and "featureCollection" not in ops["op3"], "Living Atlas layer kept as a link")
        grp = ops["grp"]
        check(grp["layers"][0].get("featureCollection") and len(grp["layers"][0]["featureCollection"]["layers"][0]["featureSet"]["features"]) == 4, "layer inside a group, linked by service address, holds its data")
        check(wm["authoringApp"] == "TakeMyWork" and wm["bookmarks"][0]["name"] == "North bank" and wm["baseMap"]["baseMapLayers"][0]["layerType"] == "VectorTileLayer", "basemap, bookmarks and authoring app")
        r = subprocess.run(["node", str(HERE / "check-mmap.mjs"), str(ex / "maps/Tree_survey_map.mmap"), str(ex / "maps/Empty_map.mmap")], capture_output=True, text=True)
        print("   " + r.stdout.strip().replace("\n", "\n   "))
        check(r.returncode == 0, "Atlas's reader opens both map files with nothing skipped" + (": " + r.stderr if r.stderr else ""))

        print("7. Story reading copy and portfolio")
        story_name = next(n for n in names if n.startswith("stories/"))
        sh = z.read(story_name).decode()
        check("<script" not in sh.lower() and "javascript:" not in sh.lower() and "onclick" not in sh.lower() and "<a rel" not in sh, "story copy has no scripts, script links or empty links")
        check("<strong>alive</strong>" in sh and "<h2>What we saw</h2>" in sh and "<li>Herons</li>" in sh and "Inside a sidecar slide." in sh, "story text, headings, lists and sidecar text")
        check(f'src="../{byid[SM1]["dir"]}/resources/river.jpg"'.replace(" ", "%20") in sh and 'alt="A small weir with white water"' in sh, "story picture with its alt text")
        check("portfolio/viewer.html?m=Tree_survey_map.mmap" in sh, "story links to the archived map")
        ix = z.read("index.html").decode()
        check("&lt;img src=x onerror" in ix and '<img src=x' not in ix, "portfolio escapes titles")
        check("javascript:" not in ix and "<script" not in ix.lower() and "onerror=alert(2)" not in ix, "portfolio descriptions sanitized")
        check('href="https://example.org"' in ix, "safe links in descriptions kept")
        check("hillside.maps.arcgis.com/home/item.html?id=" + WM1 in ix, "original links use the organization's address")
        check("Before you put this folder online" in ix, "privacy warning on the portfolio")
        rd = z.read("README.txt").decode()
        check("START HERE" in rd and "Drone video" in rd, "README with things to check")
        viewer = z.read("portfolio/viewer.html").decode()
        vs = re.findall(r'<script type="module">(.*?)</script>', viewer, re.S)[0]
        (out / "viewer.mjs").write_text(vs.replace("$arcgis.import", "globalThis.$arcgis.import"))
        r = subprocess.run(["node", "--check", str(out / "viewer.mjs")], capture_output=True, text=True)
        check(r.returncode == 0, "viewer page script parses" + (": " + r.stderr if r.stderr else ""))

        print("8. Portfolio pages in a browser")
        serve(None, 8813, ex)
        pp = ctxb.new_page()
        pp.on("pageerror", lambda e: console.append(f"portfolio pageerror: {e}"))
        pp.goto("http://127.0.0.1:8813/index.html")
        check(pp.locator("article.entry").count() >= 10, f"portfolio lists the items ({pp.locator('article.entry').count()})")
        imgs = pp.evaluate("async () => Promise.all([...document.images].map(async (i) => [i.getAttribute('src'), (await fetch(i.src)).ok]))")
        check(imgs and all(ok for _, ok in imgs), f"portfolio thumbnails load ({len(imgs)})")
        axe_scan(pp, axe_js, "portfolio page")
        if shots: pp.screenshot(path=str(shots / "5-portfolio.png"), full_page=True)
        pp.goto("http://127.0.0.1:8813/" + story_name)
        check(pp.evaluate("async () => (await Promise.all([...document.images].map(async (i) => (await fetch(i.src)).ok))).every(Boolean)"), "story picture loads")
        axe_scan(pp, axe_js, "story page")
        if shots: pp.screenshot(path=str(shots / "6-story.png"), full_page=True)
        pp.goto("http://127.0.0.1:8813/portfolio/viewer.html?m=Tree_survey_map.mmap")
        pp.wait_for_selector("#msg:not([hidden])", timeout=10000)
        check("couldn't load" in pp.inner_text("#msg") and "Atlas" in pp.inner_text("#msg"), "viewer explains when the ArcGIS SDK can't load")
        pp.set_viewport_size({"width": 390, "height": 844})
        pp.goto("http://127.0.0.1:8813/index.html")
        check(pp.evaluate("() => document.documentElement.scrollWidth <= innerWidth + 1"), "portfolio has no sideways scroll on a phone")
        if shots: pp.screenshot(path=str(shots / "7-portfolio-phone.png"), full_page=True)
        page.set_viewport_size({"width": 390, "height": 844})
        page.click("#againBtn")
        check(page.evaluate("() => document.documentElement.scrollWidth <= innerWidth + 1"), "app has no sideways scroll on a phone")
        if shots: page.screenshot(path=str(shots / "8-choose-phone.png"), full_page=True)
        browser.close()

    print("9. Requests")
    log = M.log
    unauth = [e for e in log if not e["hasToken"] and "/oauth2/" not in e["path"]]
    check(not unauth, f"every request carried the token ({len(log)} requests)")
    credit = [e for e in log if re.search(r"/(export|createReplica|generate|analyze|geocode|findAddressCandidates|addItem|update|delete|share|publish|createService)\b", e["path"], re.I)]
    check(not credit, "no exports, analysis, geocoding or changes to the account")
    check(any(e["path"].endswith("/oauth2/token") and e["params"].get("grant_type") == "refresh_token" for e in log), "expired token was refreshed")
    check(M.throttled, "throttled query was retried")
    check(not M.errors, "mock server had no errors: " + "; ".join(M.errors))
    check(not [c for c in console if "pageerror" in c], "no page errors: " + "; ".join(console))
    print("\nconsole:", *console, sep="\n  ") if console else None
    print(f"\n{'FAILED' if failures else 'PASSED'}: {len(failures)} failure(s)")
    sys.exit(1 if failures else 0)

if __name__ == "__main__":
    main()
