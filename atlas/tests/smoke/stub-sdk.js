// Stand-in for the ArcGIS Maps SDK, used only by tests/smoke/smoke.py (the build machine can't reach js.arcgis.com).
// It draws just enough of a map view (corners, zoom, attribution, scale bar) to test the app's own UI around it.
// Esri's real Calcite components are loaded from /__calcite/ so the toolbar icons are the genuine ones.
import "/__calcite/index.js";

window.__stub = { goTo: [], views: [] };
const later = (fn) => setTimeout(fn, 0);

class Collection {
  constructor(items) { this.items = items ? [...items] : []; }
  get length() { return this.items.length; }
  add(x) { if (!this.items.includes(x)) this.items.push(x); }
  remove(x) { this.items = this.items.filter((i) => i !== x); }
  removeAll() { this.items = []; }
  includes(x) { return this.items.includes(x); }
  find(fn) { return this.items.find(fn); }
  toArray() { return [...this.items]; }
  forEach(fn) { this.items.forEach(fn); }
  map(fn) { return this.items.map(fn); }
  reorder(x, i) { this.remove(x); this.items.splice(i, 0, x); }
}
class Evented { constructor() { this._h = {}; } on(e, fn) { (this._h[e] = this._h[e] || []).push(fn); return { remove() {} }; } emit(e, v) { (this._h[e] || []).forEach((f) => f(v)); } }
class Accessor extends Evented { constructor(p) { super(); Object.assign(this, p || {}); } when(cb) { const p = Promise.resolve(this); return cb ? p.then(cb) : p; } load() { return Promise.resolve(this); } toJSON() { return {}; } clone() { return Object.assign(Object.create(Object.getPrototypeOf(this)), this); } }

class EsriMap extends Accessor {
  constructor(p) { super(); this.basemap = p && p.basemap; this.ground = p && p.ground; this.layers = new Collection(p && p.layers); }
  add(l) { this.layers.add(l); } remove(l) { this.layers.remove(l); } reorder(l, i) { this.layers.reorder(l, i); }
}
// Operational layer JSON -> a layer object with the same id (as the SDK does).
const layerFromJson = (op) => new FeatureLayer({ id: op.id, title: op.title || op.id, visible: op.visibility !== false, opacity: op.opacity ?? 1, url: op.url,
  type: op.layerType === "GroupLayer" ? "group" : "feature", portalItem: op.itemId ? { id: op.itemId } : null });
class WebMap extends EsriMap {
  constructor(p) { super(); this.portalItem = p && p.portalItem; this.initialViewProperties = { viewpoint: null }; this.bookmarks = new Collection(); }
  static fromJSON(j) {
    window.__stub.fromJSON = JSON.parse(JSON.stringify(j));
    const wm = new WebMap();
    wm.layers = new Collection((j.operationalLayers || []).map(layerFromJson));
    if (j.baseMap) wm.basemap = new Basemap({ title: j.baseMap.title });
    wm.initialViewProperties = { viewpoint: j.initialState ? j.initialState.viewpoint : null };
    return wm;
  }
  async load() {
    if (!this.portalItem) return this;
    window.__stub.openedWebMap = this.portalItem.id;
    const r = await fetch("https://www.arcgis.com/sharing/rest/content/items/" + this.portalItem.id + "/data?f=json");
    const j = await r.json();
    this.layers = new Collection((j.operationalLayers || []).map(layerFromJson));
    this.basemap = new Basemap({ title: (j.baseMap || {}).title });
    return this;
  }
}
class Widget extends Accessor {
  constructor(p, cls, html) {
    super(p);
    this.el = typeof (p && p.container) === "object" && p.container ? p.container : document.createElement("div");
    this.el.classList.add("esri-widget", cls);
    if (html) this.el.innerHTML = html;
  }
}
const btn = (label, glyph) => `<div class="esri-widget--button" role="button" tabindex="0" aria-label="${label}" title="${label}">${glyph}</div>`;
class Home extends Widget { constructor(p) { super(p, "esri-home", btn("Default map view", "⌂")); } }
class Search extends Widget { constructor(p) { super(p, "esri-search", '<input aria-label="Search" />'); } }
class Expand extends Widget { constructor(p) { super(p, "esri-expand", btn(p.expandTooltip || "Expand", "⌕")); } }
class NavigationToggle extends Widget { constructor(p) { super(p, "esri-navigation-toggle", btn("Pan", "✥")); } }
class ScaleBar extends Widget {
  constructor(p) {
    super(p, "esri-scale-bar", '<div style="font:600 12px sans-serif;line-height:16px"><div style="width:260px;background:rgba(255,255,255,.7);border:2px solid #000;border-top:none;padding-left:4px">2,000 km</div><div style="width:210px;background:rgba(255,255,255,.7);border:2px solid #000;border-bottom:none;padding-left:4px">1,000 mi</div></div>');
    window.__stub.scaleUnit = p.unit;
  }
}
class Legend extends Widget { constructor(p) { super(p, "esri-legend", "<p>Legend</p>"); } }
class BasemapGallery extends Widget { constructor(p) { super(p, "esri-basemap-gallery", "<p>Basemaps</p>"); this.activeBasemap = null; } }
class Measurement extends Widget { constructor(p) { super(p, "esri-measurement", ""); } clear() {} }
class ElevationProfile extends Widget {
  constructor(p) { super(p, "esri-elevation-profile", "<p>Elevation profile chart</p>"); window.__stub.profile = { unit: p.unit, profiles: p.profiles }; this.viewModel = { cancel() {}, clear() { window.__stub.profileCleared = (window.__stub.profileCleared || 0) + 1; } }; }
}
class CoordinateConversion extends Widget { constructor(p) { super(p, "esri-coordinate-conversion", ""); } }
class PortalBasemapsSource extends Accessor {}

// The SDK's own attribution styles (5.1 main.css, simplified).
const css = document.createElement("style");
css.textContent = ".esri-attribution{position:absolute;left:0;right:0;bottom:0;display:flex;font:12px sans-serif;line-height:16px;background:rgba(255,255,255,.8);color:#323232}" +
  ".esri-attribution__sources{flex:1 1 auto;padding:0 5px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;align-self:flex-end}" +
  ".esri-attribution__powered-by{text-align:right;white-space:nowrap;align-self:flex-end;padding:0 16px 0 4px}";
document.head.appendChild(css);
class UI {
  set padding(p) { this._padding = p; for (const c of ["bottom-left", "bottom-right"]) this.corners[c].style.bottom = (p.bottom - 15) + "px"; }
  get padding() { return this._padding || { top: 15, left: 15, right: 15, bottom: 30 }; }
  constructor(view) {
    this.view = view; this.corners = {};
    for (const c of ["top-left", "top-right", "bottom-left", "bottom-right"]) {
      const d = document.createElement("div"); d.className = "esri-ui-corner esri-ui-" + c; d.dataset.corner = c;
      const [v, h] = c.split("-");
      Object.assign(d.style, { position: "absolute", display: "flex", gap: "10px", padding: "15px", [v]: v === "bottom" ? "15px" : "0", [h]: "0",
        flexDirection: v === "top" ? "column" : "row", alignItems: v === "top" ? "flex-start" : "flex-end", pointerEvents: "none" });
      view.root.appendChild(d); this.corners[c] = d;
    }
  }
  add(comp, pos) {
    const position = typeof pos === "string" ? pos : (pos && pos.position) || "manual";
    const index = pos && typeof pos === "object" ? pos.index : undefined;
    const el = comp instanceof HTMLElement ? comp : comp.el;
    el.classList.add("esri-component"); el.style.pointerEvents = "auto";
    const corner = this.corners[position];
    const kids = [...corner.children];
    if (index != null && kids[index]) corner.insertBefore(el, kids[index]); else corner.appendChild(el);
  }
}
class MapView extends Accessor {
  constructor(p) {
    super();
    this.map = p.map; this.zoom = p.zoom; this.rotation = 0; this.popupEnabled = true; this.type = "2d";
    this.center = { longitude: (p.center || [0, 0])[0], latitude: (p.center || [0, 0])[1], clone() { return this; } };
    this.container = document.getElementById(p.container);
    this.root = document.createElement("div"); this.root.className = "esri-view-root";
    Object.assign(this.root.style, { position: "absolute", inset: "0", background: "linear-gradient(160deg,#9fc7e6,#6aa3cf 60%,#8fbf8a)" });
    this.container.appendChild(this.root);
    this.ui = new UI(this);
    const zoom = document.createElement("div"); zoom.className = "esri-zoom";
    zoom.innerHTML = btn("Zoom in", "+") + btn("Zoom out", "−");
    this.ui.add(zoom, "top-left");
    const att = document.createElement("div"); att.className = "esri-attribution esri-widget"; att.setAttribute("dir", "ltr");
    att.innerHTML = '<div class="esri-attribution__sources">Esri | TomTom | FAO | NOAA | USGS | Sources: Esri, USGS</div><div class="esri-attribution__powered-by">Powered by <a href="https://www.esri.com/">Esri</a></div>';
    this.root.appendChild(att);
    this.viewpoint = { clone() { return this; } };
    const ext = { xmin: -2e6, ymin: -1e6, xmax: 2e6, ymax: 1e6, spatialReference: { wkid: 102100 } };
    this.extent = { ...ext, clone() { return { ...ext, toJSON() { return { ...ext }; }, expand() { return this; } }; } };
    this.width = 1000; this.height = 600; this.scale = 18489297.737236;
    window.__stub.views.push(this);
  }
  goTo(target) { window.__stub.goTo.push(JSON.parse(JSON.stringify(target || {}))); if (target && target.rotation === 0) this.rotation = 0; if (target && target.heading === 0 && this.camera) this.camera = { ...this.camera, heading: 0 }; return Promise.resolve(); }
  hitTest() { return Promise.resolve({ results: [] }); }
  takeScreenshot() { return Promise.resolve({ dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" }); }
  closePopup() {}
}
class SceneView extends MapView { constructor(p) { super(p); this.type = "3d"; this.camera = { heading: 0, tilt: 0, toJSON() { return {}; } }; } }
class GraphicsLayer extends Accessor { constructor(p) { super(p); this.graphics = new Collection(); this.visible = true; } add(g) { this.graphics.add(g); } remove(g) { this.graphics.remove(g); } removeAll() { this.graphics.removeAll(); } }
class FeatureLayer extends Accessor { constructor(p) { super(p); if (this.visible === undefined) this.visible = true; if (!this.id) this.id = "fl" + Math.random().toString(36).slice(2, 7); if (!this.type) this.type = "feature"; if (this.opacity === undefined) this.opacity = 1; } queryExtent() { return Promise.resolve({ extent: null }); } }
class Graphic extends Accessor {
  constructor(p) { super(p); const g = p && p.geometry; if (g) { const plain = JSON.parse(JSON.stringify(g)); this.geometry = { ...plain, type: g.type || (g.paths ? "polyline" : g.rings ? "polygon" : "point"), toJSON() { return plain; } }; } }
  static fromJSON(j) { return new Graphic(j); }
}
class SketchViewModel extends Evented { constructor(p) { super(); Object.assign(this, p); } create() {} cancel() {} complete() {} update() { return Promise.resolve(); } }
class Basemap extends Accessor {}
class Layer extends Accessor { static async fromPortalItem(p) { return new FeatureLayer({ title: "Collection layer", portalItem: p.portalItem, url: "https://services.arcgis.com/x/arcgis/rest/services/L/FeatureServer", layerId: 0 }); } }
class Field extends Accessor { static fromJSON(j) { return j; } }
class LabelClass extends Accessor { static fromJSON(j) { return j; } }
class Extent extends Accessor { static fromJSON(j) { return j; } }
class OAuthInfo extends Accessor {}
class Portal extends Accessor {}
const IdentityManager = { registerOAuthInfos() {}, checkSignInStatus: () => Promise.reject(new Error("not signed in")), findCredential: () => null, getCredential: () => Promise.reject(null), destroyCredentials() {} };
const rendererJsonUtils = { fromJSON: (j) => j };
const esriConfig = {};
const intl = { setLocale(l) { window.__stub.locale = l; } };
async function esriRequest(url, opts) {
  const u = new URL(url);
  for (const [k, v] of Object.entries((opts && opts.query) || {})) u.searchParams.set(k, v);
  const r = await fetch(u.toString());
  return { data: await r.json() };
}
// reactiveUtils.watch: polls the getter, which is enough for tests.
const reactiveUtils = {
  watch(getter, cb, opts) {
    let last = getter();
    if (opts && opts.initial) later(() => cb(last));
    const id = setInterval(() => { const v = getter(); if (v !== last) { const old = last; last = v; cb(v, old); } }, 40);
    return { remove() { clearInterval(id); } };
  }
};

const MODULES = {
  "@arcgis/core/Map.js": EsriMap, "@arcgis/core/WebMap.js": WebMap, "@arcgis/core/views/MapView.js": MapView, "@arcgis/core/views/SceneView.js": SceneView,
  "@arcgis/core/layers/GraphicsLayer.js": GraphicsLayer, "@arcgis/core/layers/FeatureLayer.js": FeatureLayer, "@arcgis/core/Graphic.js": Graphic,
  "@arcgis/core/widgets/Sketch/SketchViewModel.js": SketchViewModel, "@arcgis/core/Basemap.js": Basemap, "@arcgis/core/widgets/BasemapGallery.js": BasemapGallery,
  "@arcgis/core/widgets/BasemapGallery/support/PortalBasemapsSource.js": PortalBasemapsSource, "@arcgis/core/widgets/Measurement.js": Measurement,
  "@arcgis/core/widgets/ElevationProfile.js": ElevationProfile,
  "@arcgis/core/widgets/CoordinateConversion.js": CoordinateConversion, "@arcgis/core/widgets/ScaleBar.js": ScaleBar, "@arcgis/core/widgets/Search.js": Search,
  "@arcgis/core/widgets/Expand.js": Expand, "@arcgis/core/widgets/Home.js": Home, "@arcgis/core/widgets/NavigationToggle.js": NavigationToggle,
  "@arcgis/core/widgets/Legend.js": Legend, "@arcgis/core/layers/Layer.js": Layer, "@arcgis/core/layers/support/Field.js": Field,
  "@arcgis/core/layers/support/LabelClass.js": LabelClass, "@arcgis/core/renderers/support/jsonUtils.js": rendererJsonUtils,
  "@arcgis/core/geometry/Extent.js": Extent, "@arcgis/core/config.js": esriConfig, "@arcgis/core/intl.js": intl,
  "@arcgis/core/identity/IdentityManager.js": IdentityManager, "@arcgis/core/identity/OAuthInfo.js": OAuthInfo, "@arcgis/core/portal/Portal.js": Portal,
  "@arcgis/core/request.js": esriRequest, "@arcgis/core/core/reactiveUtils.js": reactiveUtils
};
window.$arcgis = {
  async import(list) {
    return list.map((name) => { if (!(name in MODULES)) throw new Error("stub has no module " + name); return MODULES[name]; });
  }
};
