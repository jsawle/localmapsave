// Atlas: a white-label build of the MapMaker classroom map app.
// ArcGIS Maps SDK for JavaScript 5.1. Everything a distributor changes lives in config/<name>.json.
// Created by Jason Sawle.
import { CSV_VERSION, PALETTE_HEX, PALETTE_RGB, COLOR_RAMPS, DATA_STYLES, SHAPES, readCsv, buildLayerData, styleAvailable,
  pickAutoStyle, pickAutoFields, aliasOf, buildLayerDef } from "./lib/csv.js";
import { DOC_TYPE, DOC_VERSION, WEBMAP_WRITER_VERSION, WEBMAP_SPEC_VERSION, AUTHORING_APP, ITEM_LAYER_PREFIX, DATA_LAYER_PREFIX, sanitizeDoc, docToWebMap,
  isOwnLayerJson, looksLikeWebMap, readWebMap, xyToLonLat } from "./lib/doc.js";
import { DEFAULT_STRINGS } from "./lib/strings.js";
import { CATALOG_VERSION, MAX_INDEX, OTHER, ALL, buildTopicTree, findTopic, topicTrail, indexItems, countTopics,
  filterEntries, pageList } from "./lib/catalog.js";

const APP_VERSION = "1.3.2";
const COMPASS_VERSION = "1.0";
const PROFILE_VERSION = "1.0";
const SKETCH_VERSION = "1.0";
const CONFIG_SCHEMA = 1;
const SDK_VERSION = "5.1";
const AUTH_STASH = "atlas.authReturn";

const $ = (id) => document.getElementById(id);
const fmt = (s, o) => String(s == null ? "" : s).replace(/\{(\w+)\}/g, (_, k) => (o && o[k] != null ? o[k] : ""));
const HEX32 = /^[0-9a-f]{32}$/i;
const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ============================================================ Config
const DEFAULT_CONFIG = {
  configVersion: 1,
  appName: "School Atlas",
  locale: "en", dir: "ltr",
  logo: { url: "", compactUrl: "", alt: "", link: "", showName: false },
  headerLinks: [],
  partnerLogos: [],
  theme: { brand: "#0b5c8e", brandInk: "", brandSoft: "", toolActive: "", toolActiveInk: "", header: "#ffffff", headerInk: "", headerLine: "#e1e1e1", pill: "#000000", pillInk: "", font: "" },
  portalUrl: "https://www.arcgis.com",
  contentGroup: "36443e9570294a1f883b5d2c5abfe6b5",
  basemapGroup: "406646c98d0f4c608a9438d40ce2df9e",
  defaultBasemap: "a82ff7ce1c3a493f9d82aa89f5a1ddcf",
  startView: { center: [0, 20], zoom: 2 },
  threeDTilt: 60,          // degrees the camera tilts when switching to 3D, so the change is obvious (0 = stay looking straight down)
  units: "metric",
  scalebar: "dual",
  disclaimer: "",
  signIn: { clientId: "", popup: true, headerButton: true, onboardingTitle: "", onboardingHtml: "" },
  agolTags: ["school map"],
  csvMaxRows: 1000,
  features: { openMap: true, addLayer: true, csv: true, layers: true, legend: true, basemaps: true, measure: true, sketch: true,
    bookmarks: true, threeD: true, save: true, localSave: true, screenshot: true, print: true, search: true, signIn: true, compass: true, elevationProfile: true },
  strings: {}
};
function mergeConfig(base, over) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const k of Object.keys(over || {})) {
    const b = base ? base[k] : undefined, o = over[k];
    out[k] = b && o && typeof b === "object" && typeof o === "object" && !Array.isArray(b) && !Array.isArray(o) ? mergeConfig(b, o) : o;
  }
  return out;
}
function readAuthStash() {
  try {
    const s = JSON.parse(sessionStorage.getItem(AUTH_STASH) || "null");
    sessionStorage.removeItem(AUTH_STASH);
    if (s && Date.now() - (s.t || 0) < 30 * 60 * 1000) return s;
  } catch (e) { /* storage unavailable */ }
  return null;
}
const params = new URLSearchParams(location.search);
const returningFromSignIn = params.has("code") && params.has("state");
const authStash = returningFromSignIn ? readAuthStash() : null;
let cfgName = (params.get("config") || (authStash && authStash.config) || "default").replace(/[^\w-]/g, "") || "default";
let configMissing = null;
async function fetchConfig(name) { const r = await fetch(`./config/${name}.json`, { cache: "no-cache" }); if (!r.ok) throw new Error(String(r.status)); return r.json(); }
let rawCfg = {};
try { rawCfg = await fetchConfig(cfgName); }
catch (e) {
  console.warn("Config not found:", cfgName, e);
  if (cfgName !== "default") { configMissing = cfgName; cfgName = "default"; try { rawCfg = await fetchConfig("default"); } catch (e2) { rawCfg = {}; } }
}
const cfg = mergeConfig(DEFAULT_CONFIG, rawCfg);
for (const k of ["contentGroup", "basemapGroup", "defaultBasemap"]) if (!HEX32.test(cfg[k] || "")) { console.warn("Config " + k + " isn't a 32-character item or group ID; using the default."); cfg[k] = DEFAULT_CONFIG[k]; }
const F = cfg.features;
const S = { ...DEFAULT_STRINGS, ...(cfg.strings || {}) };
const APPV = { app: cfg.appName };
const t = (key, o) => fmt(S[key] != null ? S[key] : key, { ...APPV, ...(o || {}) });
const PORTAL = String(cfg.portalUrl || "https://www.arcgis.com").replace(/\/+$/, "");

// ============================================================ Branding and text
function hexToRgb(hex) {
  let h = String(hex || "").replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [0, 0, 0];
}
function luminance(hex) { return hexToRgb(hex).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0); }
function contrast(a, b) { const la = luminance(a), lb = luminance(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); }
const bestInk = (bg) => (contrast(bg, "#ffffff") >= contrast(bg, "#000000") ? "#ffffff" : "#000000");
function mix(hex, withHex, w) { const a = hexToRgb(hex), b = hexToRgb(withHex); return "#" + a.map((v, i) => Math.round(v * (1 - w) + b[i] * w).toString(16).padStart(2, "0")).join(""); }
const cssString = (v) => '"' + String(v).replace(/[\\"]/g, "\\$&").replace(/[\n\r\f]/g, " ") + '"';
const safeUrl = (u) => (typeof u === "string" && /^(https:\/\/|\.\/|\/|[\w-]+\.(png|svg|jpe?g|webp))/i.test(u) ? u : "");

function applyTheme() {
  const th = cfg.theme, r = document.documentElement.style;
  const set = (k, v) => { if (v) r.setProperty(k, v); };
  const soft = th.brandSoft || mix(th.brand, "#ffffff", 0.88);
  let strong = th.brand;   // brand-coloured text on the soft tint must still reach 4.5:1
  for (let i = 0; i < 20 && contrast(strong, soft) < 4.5; i++) strong = mix(strong, "#000000", 0.08);
  set("--brand", th.brand); set("--brand-ink", th.brandInk || bestInk(th.brand)); set("--brand-soft", soft); set("--brand-strong", strong);
  set("--header-bg", th.header); set("--header-ink", th.headerInk || bestInk(th.header)); set("--header-line", th.headerLine);
  set("--pill-dark", th.pill); set("--pill-dark-ink", th.pillInk || bestInk(th.pill));
  const active = th.toolActive || soft;
  set("--tool-active", active); set("--tool-active-ink", th.toolActiveInk || bestInk(active));
  if (th.font) set("--font", th.font);
  if (contrast(th.brand, th.brandInk || bestInk(th.brand)) < 4.5) console.warn("Theme: brand colour and its text colour are below WCAG 4.5:1 contrast.");
}
function applyStrings(root) {
  root = root || document;
  root.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll("[data-i18n-aria]").forEach((el) => el.setAttribute("aria-label", t(el.dataset.i18nAria)));
  root.querySelectorAll("[data-i18n-title]").forEach((el) => el.setAttribute("title", t(el.dataset.i18nTitle)));
  root.querySelectorAll("[data-i18n-ph]").forEach((el) => el.setAttribute("placeholder", t(el.dataset.i18nPh)));
}
function applyHeader() {
  document.documentElement.lang = cfg.locale || "en";
  document.documentElement.dir = cfg.dir === "rtl" ? "rtl" : "ltr";
  document.title = cfg.appName;
  const logo = cfg.logo || {};
  const link = $("logoLink");
  link.href = safeUrl(logo.link) || ("./" + (cfgName !== "default" ? "?config=" + encodeURIComponent(cfgName) : ""));
  if (logo.link) { link.target = "_blank"; link.rel = "noopener"; }
  const wide = safeUrl(logo.url), compact = safeUrl(logo.compactUrl) || wide;
  if (wide) {
    $("logoImg").src = wide; $("logoImg").alt = logo.alt || cfg.appName; $("logoImg").hidden = false;
    $("logoCompact").src = compact; $("logoCompact").alt = logo.alt || cfg.appName; $("logoCompact").hidden = false;
  }
  $("logoText").textContent = !wide || logo.showName ? cfg.appName : "";
  $("logoText").hidden = !!wide && !logo.showName;
  const links = $("hdrLinks"); links.innerHTML = "";
  for (const l of cfg.headerLinks || []) {
    if (!l || !/^https:\/\//i.test(l.url || "") || !l.label) continue;
    const a = document.createElement("a");
    a.className = "pill " + (l.style === "outline" ? "outline" : "dark");
    a.href = l.url; a.target = "_blank"; a.rel = "noopener"; a.textContent = l.label;
    links.appendChild(a);
  }
  links.hidden = !links.children.length;
  const partners = $("hdrPartners"); partners.innerHTML = "";
  for (const p of cfg.partnerLogos || []) {
    const src = safeUrl(p && p.url);
    if (!src) continue;
    const img = document.createElement("img"); img.src = src; img.alt = p.alt || "";
    if (p.link && /^https:\/\//i.test(p.link)) { const a = document.createElement("a"); a.href = p.link; a.target = "_blank"; a.rel = "noopener"; a.appendChild(img); partners.appendChild(a); }
    else partners.appendChild(img);
  }
  // The disclaimer sits in the attribution bar, before "Powered by Esri", as in MapMaker.
  if (cfg.disclaimer) $("mapWrap").style.setProperty("--atlas-disclaimer", cssString(String(cfg.disclaimer).replace(/\s+/g, " ").trim() + " | "));
  $("docTitle").placeholder = S.untitled;
  $("docTitle").setAttribute("aria-label", S.mapTitle);
  $("verBtn").textContent = "v" + APP_VERSION;
  $("verBtn").setAttribute("aria-label", S.versions + " v" + APP_VERSION);
  $("tabGroup").textContent = t("tabGroup");
  $("tabLayers").textContent = t("layersFrom");
  document.querySelectorAll("[data-feature]").forEach((el) => { if (F[el.dataset.feature] === false) el.hidden = true; });
  $("signInBtn").hidden = F.signIn === false || (cfg.signIn || {}).headerButton === false;
  $("agolSection").hidden = F.signIn === false;
}
// Toolbar icons. The page starts with these built-in outline icons; once the ArcGIS SDK has loaded Esri's
// Calcite icons (the set MapMaker uses), each one is swapped in as soon as it has drawn.
const ICON_SVG = {
  "basemap": '<path d="M3 3h8v8H3zM13 3h8v8h-8zM3 13h8v8H3zM13 13h8v8h-8z"/><path d="M3 8.5 6.5 5 11 9M15 3v4h6M3 18l3-2 5 2.5M17 13v8M13 17h8"/>',
  "map": '<path d="M3 3h18v18H3z"/><path d="M8.5 21c.5-2.5 2.5-3.5 1.5-6s-3-2.5-1.5-5S13 8 13.5 3M14 21c.5-2 2-3 4-3s2.5-1.5 3-2"/>',
  "layer-map": '<path d="M2.5 6.5 9 4l6 2.5L21.5 4v13.5L15 20l-6-2.5-6.5 2.5z"/><path d="M9 4v13.5M15 6.5V20"/>',
  "plus-circle": '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v9M7.5 12h9"/>',
  "legend": '<path d="M4 4.5h3v3H4zM4 10.5h3v3H4zM5.5 16.5 7 19H4zM10 6h10M10 12h10M10 18h10"/>',
  "measure": '<path d="M3 15h18v5H3z"/><path d="M6 15v2M9 15v3M12 15v2M15 15v3M18 15v2M3 8h7M5 6 3 8l2 2M14 8h7M19 6l2 2-2 2"/>',
  "altitude": '<path d="M3 21h18M3 11l3-4 3 3 3-5M17 3v18M14.5 5.5 17 3l2.5 2.5M14.5 18.5 17 21l2.5-2.5M14 3h6"/>',
  "pencil-mark": '<path d="M15 4.5 19.5 9 10 18.5H5.5V14z"/><path d="m13 6.5 4.5 4.5"/><path d="M3.5 21c2-1 3-1 5-1M3 10c1.5-4 4-5 5.5-3.5"/>',
  "cube": '<path d="M12 2.5 20.5 7v10L12 21.5 3.5 17V7z"/><path d="M3.5 7 12 11.5 20.5 7M12 11.5v10"/>',
  "bookmark": '<path d="M6 3h12v18l-6-5.5L6 21z"/>',
  "save": '<path d="M4 3h13l3 3v15H4z"/><path d="M8 3v5h8V3M7 21v-7h10v7"/>'
};
function paintIcons() {
  document.querySelectorAll(".ti[data-icon]").forEach((el) => {
    if (el.querySelector("svg, calcite-icon")) return;
    el.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" focusable="false">' + (ICON_SVG[el.dataset.icon] || "") + "</svg>";
  });
}
async function upgradeIcons() {
  if (!window.customElements) return;
  const ready = await Promise.race([customElements.whenDefined("calcite-icon").then(() => true), new Promise((r) => setTimeout(() => r(false), 15000))]);
  if (!ready) return;
  const pending = [...document.querySelectorAll(".ti[data-icon]")].map((span) => {
    const ic = document.createElement("calcite-icon");
    ic.setAttribute("icon", span.dataset.icon); ic.setAttribute("scale", span.classList.contains("sm") ? "s" : span.classList.contains("md") ? "m" : "l");
    ic.setAttribute("aria-hidden", "true"); ic.className = "pending";
    span.appendChild(ic);
    return { span, ic };
  });
  const drawn = (ic) => { const root = ic.shadowRoot; const path = root && root.querySelector("path"); return !!(path && (path.getAttribute("d") || "").length > 4); };
  const started = Date.now();
  const timer = setInterval(() => {
    for (let i = pending.length - 1; i >= 0; i--) {
      const { span, ic } = pending[i];
      if (!drawn(ic)) continue;
      [...span.childNodes].forEach((n) => { if (n !== ic) n.remove(); });
      ic.classList.remove("pending"); pending.splice(i, 1);
    }
    if (!pending.length || Date.now() - started > 120000) { clearInterval(timer); pending.forEach(({ ic }) => ic.remove()); }
  }, 400);
}
applyTheme();
applyStrings();
applyHeader();
paintIcons();

// ============================================================ ArcGIS SDK
const [EsriMap, WebMap, MapView, SceneView, GraphicsLayer, FeatureLayer, Graphic, SketchViewModel, Basemap, BasemapGallery,
  PortalBasemapsSource, Measurement, ElevationProfile, CoordinateConversion, ScaleBar, Search, Expand, Home, Legend, Layer,
  Field, LabelClass, rendererJsonUtils, Extent, esriConfig, intl, IdentityManager, OAuthInfo, Portal, esriRequest, reactiveUtils] = await $arcgis.import([
  "@arcgis/core/Map.js", "@arcgis/core/WebMap.js", "@arcgis/core/views/MapView.js", "@arcgis/core/views/SceneView.js",
  "@arcgis/core/layers/GraphicsLayer.js", "@arcgis/core/layers/FeatureLayer.js", "@arcgis/core/Graphic.js",
  "@arcgis/core/widgets/Sketch/SketchViewModel.js", "@arcgis/core/Basemap.js", "@arcgis/core/widgets/BasemapGallery.js",
  "@arcgis/core/widgets/BasemapGallery/support/PortalBasemapsSource.js", "@arcgis/core/widgets/Measurement.js", "@arcgis/core/widgets/ElevationProfile.js",
  "@arcgis/core/widgets/CoordinateConversion.js", "@arcgis/core/widgets/ScaleBar.js", "@arcgis/core/widgets/Search.js",
  "@arcgis/core/widgets/Expand.js", "@arcgis/core/widgets/Home.js",
  "@arcgis/core/widgets/Legend.js", "@arcgis/core/layers/Layer.js",
  "@arcgis/core/layers/support/Field.js", "@arcgis/core/layers/support/LabelClass.js", "@arcgis/core/renderers/support/jsonUtils.js",
  "@arcgis/core/geometry/Extent.js", "@arcgis/core/config.js", "@arcgis/core/intl.js", "@arcgis/core/identity/IdentityManager.js",
  "@arcgis/core/identity/OAuthInfo.js", "@arcgis/core/portal/Portal.js", "@arcgis/core/request.js", "@arcgis/core/core/reactiveUtils.js"
]);
esriConfig.portalUrl = PORTAL;
try { if (cfg.locale && cfg.locale !== "en") intl.setLocale(cfg.locale); } catch (e) { console.warn("Locale not supported", e); }

async function restGet(path, query) {
  const r = await esriRequest(PORTAL + path, { query: { f: "json", ...(query || {}) }, responseType: "json" });
  if (r.data && r.data.error) throw new Error(r.data.error.message || "Request failed");
  return r.data;
}

// ============================================================ Map, views and widgets
const graphicsLayer = new GraphicsLayer({ id: "__sketch", title: S.sketchLayer, elevationInfo: { mode: "on-the-ground" }, listMode: "hide" });
const defaultBasemap = () => new Basemap({ portalItem: { id: cfg.defaultBasemap } });
const localMap = new EsriMap({ basemap: defaultBasemap(), ground: "world-elevation", layers: [graphicsLayer] });
const startCenter = Array.isArray(cfg.startView.center) ? cfg.startView.center : [0, 20];
const mapView = new MapView({ container: "viewDiv", map: localMap, center: startCenter, zoom: Number(cfg.startView.zoom) || 2 });
let view = mapView, sceneView = null, mode = "2d";
const viewHandlers = [];
function onViews(evt, fn) { viewHandlers.push([evt, fn]); mapView.on(evt, fn); if (sceneView) sceneView.on(evt, fn); }
function activeMap() { return view.map; }
function addViewUI(v, is3d) {
  if (F.search !== false) v.ui.add(new Expand({ view: v, content: new Search({ view: v }), expandIcon: "search", expandTooltip: S.search, group: "top-left" }), { position: "top-left", index: 0 });
  v.ui.add(new Home({ view: v }), { position: "top-left", index: 1 });
  // The SDK's 3D default also has a small compass; the rose replaces it. Only "compass", "navigation-toggle" and "zoom"
  // are allowed here: any other id makes the SDK throw while drawing, and the 3D view then shows no basemap (1.3.1).
  if (is3d) v.ui.components = ["zoom", "navigation-toggle"];
  const stack = document.createElement("div"); stack.className = "ll-stack";
  if (F.compass !== false) stack.appendChild(makeCompass(v, is3d));
  if (!is3d && cfg.scalebar !== "none") {
    const sb = document.createElement("div"); stack.appendChild(sb);
    new ScaleBar({ view: v, container: sb, unit: ["dual", "metric", "imperial"].includes(cfg.scalebar) ? cfg.scalebar : "dual" });
  }
  // While Elevation profile is docked under the map the toolbar is tucked away; this button brings it back.
  const tt = document.createElement("button"); tt.type = "button"; tt.className = "tools-toggle"; tt.setAttribute("aria-controls", "toolbar");
  tt.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><circle cx="5" cy="5" r="2"/><circle cx="12" cy="5" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="12" cy="19" r="2"/><circle cx="19" cy="19" r="2"/></svg>';
  tt.addEventListener("click", () => { $("app").classList.toggle("tools-shown"); syncToolsToggles(); layoutBottom(); });
  stack.appendChild(tt);
  v.ui.add(stack, "bottom-left");
  syncToolsToggles();
}
function syncToolsToggles() {
  const shown = $("app").classList.contains("tools-shown");
  document.querySelectorAll(".tools-toggle").forEach((b) => { b.setAttribute("aria-expanded", String(shown)); const l = shown ? S.hideTools : S.showTools; b.setAttribute("aria-label", l); b.title = l; });
}
// MapMaker's large compass rose: turns with the map; select it to face north again.
function makeCompass(v, is3d) {
  const NS = "http://www.w3.org/2000/svg";
  const el = (tag, attrs, parent) => { const n = document.createElementNS(NS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); if (parent) parent.appendChild(n); return n; };
  const b = document.createElement("button");
  b.type = "button"; b.className = "rose"; b.title = S.compassReset;
  const svg = el("svg", { viewBox: "0 0 100 100", "aria-hidden": "true", focusable: "false" });
  el("circle", { class: "rose-face", cx: 50, cy: 50, r: 49 }, svg);
  const dial = el("g", { class: "rose-dial" }, svg);
  for (const [k, x, y] of [["compassN", 50, 15], ["compassE", 85, 50], ["compassS", 50, 85], ["compassW", 15, 50]]) el("text", { x, y }, dial).textContent = S[k];
  el("path", { class: "needle-n", d: "M50 31 56.5 50h-13z" }, dial);
  el("path", { class: "needle-s", d: "M43.5 50h13L50 69z" }, dial);
  b.appendChild(svg);
  let last = null;
  const angle = () => (is3d ? -((v.camera && v.camera.heading) || 0) : (v.rotation || 0));
  const update = () => {
    const a = Math.round(angle() * 10) / 10;
    if (a === last) return;
    last = a;
    dial.setAttribute("transform", "rotate(" + a + " 50 50)");
    const deg = ((Math.round(-a) % 360) + 360) % 360;
    b.setAttribute("aria-label", deg === 0 ? S.compassNorth : t("compassTurned", { deg }));
  };
  reactiveUtils.watch(() => (is3d ? v.camera && v.camera.heading : v.rotation), update, { initial: true });
  b.addEventListener("click", () => { v.goTo(is3d ? { heading: 0 } : { rotation: 0 }, { animate: !reduceMotion }).catch(() => {}); });
  return b;
}
addViewUI(mapView, false);
upgradeIcons();
function goToSafe(target, opts) {
  const o = { animate: !reduceMotion, ...(opts || {}) };
  let tries = 0;
  const attempt = () => view.goTo(target, o).catch((e) => {
    if (e && e.name === "AbortError") return;
    if (++tries < 4) return new Promise((res) => setTimeout(res, 350)).then(attempt);
  });
  return view.when().then(attempt);
}

// ============================================================ State
let dirty = false;
let currentSource = null;          // the web map opened from the collection or ArcGIS Online: { itemId, title, item, data }
let currentAgolItem = null;        // the signed-in user's own ArcGIS Online item for this map: { id, owner, title }
const dataLayers = [];              // FeatureLayers from CSV files (each keeps its definition in _srcDef)
const portalLayers = new Map();    // itemId -> layer added from the collection
let bookmarks = [];
let currentFileHandle = null, openedHandleUnsaved = false;
let portalUser = null;
function markDirty() { dirty = true; }
function markClean() { dirty = false; }
function confirmDiscard() { return !dirty || window.confirm(S.discard); }
window.addEventListener("beforeunload", (e) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });
function sizeTitle() { const el = $("docTitle"); el.size = Math.max(8, Math.min(60, (el.value || el.placeholder || "").length + 2)); }
$("docTitle").addEventListener("input", () => { markDirty(); sizeTitle(); });
function currentTitle() { return ($("docTitle").value || "").trim() || S.untitled; }
function updateTitleShown() { $("hdrTitle").classList.toggle("empty", !($("docTitle").value || "").trim() && document.activeElement !== $("docTitle")); }
function setTitle(v) { $("docTitle").value = (v && String(v).trim()) || ""; sizeTitle(); updateTitleShown(); }
$("docTitle").addEventListener("blur", updateTitleShown);
const titleFromFileName = (name) => String(name || "").replace(/\.(mmap|json)$/i, "").replace(/[_-]+/g, " ").trim();
sizeTitle(); updateTitleShown();
// Keep the disclaimer and credit clear of the toolbar: lift them above it when they would overlap.
function layoutCorner() {
  const c = document.querySelector(".corner"), tb = $("toolbar");
  if (!c || !tb) return;
  c.classList.remove("raised");
  const a = c.getBoundingClientRect(), b = tb.getBoundingClientRect();
  if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) c.classList.add("raised");
}
// Keep the toolbar clear of the attribution bar (it grows when the disclaimer wraps on phones), and lift the
// compass and scale bar above the toolbar when the toolbar would cover them (phones, narrower laptops).
const uiBottom = new WeakMap(), uiBase = new WeakMap();
function layoutBottom() {
  const v = view, root = v && v.container;
  const attr = root && root.querySelector(".esri-attribution");
  if (attr) $("mapWrap").style.setProperty("--attr-h", Math.ceil(attr.getBoundingClientRect().height || 16) + "px");
  layoutCorner();
  const tb = $("toolbar").getBoundingClientRect(), stack = root && root.querySelector(".ll-stack");
  if (!v || !v.ui || !stack) return;
  if (!uiBase.has(v)) { const p = v.ui.padding || {}; uiBase.set(v, { top: p.top ?? 15, left: p.left ?? 15, right: p.right ?? 15, bottom: p.bottom ?? 30 }); }
  const base = uiBase.get(v), s = stack.getBoundingClientRect(), wrap = $("mapWrap").getBoundingClientRect();
  const covered = tb.width > 0 && s.width > 0 && s.left < tb.right && s.right > tb.left;
  const bottom = covered ? Math.round(wrap.bottom - tb.top) + 8 : base.bottom;   // the SDK's own padding already allows for the attribution
  if (uiBottom.get(v) === bottom) return;
  uiBottom.set(v, bottom);
  try { v.ui.padding = { ...base, bottom }; } catch (e) { /* keep the SDK default */ }
}
const bottomObserver = window.ResizeObserver ? new ResizeObserver(() => layoutBottom()) : null;
function watchBottom(tries) {
  const root = view && view.container, attr = root && root.querySelector(".esri-attribution"), stack = root && root.querySelector(".ll-stack");
  if (bottomObserver) { bottomObserver.disconnect(); bottomObserver.observe($("toolbar")); if (attr) bottomObserver.observe(attr); if (stack) bottomObserver.observe(stack); }
  layoutBottom();
  if ((!attr || !stack) && (tries || 0) < 20) setTimeout(() => watchBottom((tries || 0) + 1), 500);
}
window.addEventListener("resize", layoutBottom);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(layoutBottom);
layoutCorner();
function titleSlug() { return currentTitle().replace(/[^\w\-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "map"; }

// ============================================================ Toast, panels, modals (keyboard accessible)
let toastTimer = 0;
function toast(msg, ms) { const el = $("toast"); el.textContent = msg; clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.textContent = ""; }, ms || 3400); }

const PANELS = { data: "dataPanel", layers: "layersPanel", legend: "legendPanel", basemaps: "basemapsPanel",
  measure: "measurePanel", profile: "profilePanel", sketch: "sketchPanel", bookmarks: "bookmarksPanel", save: "savePanel", about: "aboutPanel" };
const TRIGGERS = { data: "tool-add", layers: "tool-layers", legend: "tool-legend", basemaps: "tool-basemaps",
  measure: "tool-measure", profile: "tool-measure", sketch: "tool-sketch", bookmarks: "tool-bookmarks", save: "tool-save", about: "verBtn" };
let openPanelName = null;
function setExpanded(name) {
  // A tool that opens a menu (Measure) shows its open panel by colour; aria-expanded is kept for the menu itself.
  new Set(Object.values(TRIGGERS)).forEach((id) => { const el = $(id); if (!el) return; if (el.getAttribute("aria-haspopup") === "menu") el.classList.remove("active"); else el.setAttribute("aria-expanded", "false"); });
  const el = name && $(TRIGGERS[name]);
  if (el) { if (el.getAttribute("aria-haspopup") === "menu") el.classList.add("active"); else el.setAttribute("aria-expanded", "true"); }
  $("menuMeasure").classList.toggle("active", name === "measure"); $("menuProfile").classList.toggle("active", name === "profile");
}
function openPanel(name, opts) {
  if (openPanelName && openPanelName !== name) panelClosing(openPanelName);
  for (const [k, id] of Object.entries(PANELS)) $(id).hidden = k !== name;
  openPanelName = name;
  setExpanded(name);
  panelOpening(name);
  updatePopupEnabled();
  if (!opts || opts.focus !== false) { const h = $(PANELS[name]).querySelector("h2"); if (h) h.focus(); }
}
function closePanels(restoreFocus) {
  const name = openPanelName;
  if (!name) return;
  panelClosing(name);
  const panel = $(PANELS[name]);
  const hadFocus = panel.contains(document.activeElement);
  for (const id of Object.values(PANELS)) $(id).hidden = true;
  openPanelName = null;
  setExpanded(null);
  updatePopupEnabled();
  if (restoreFocus !== false && hadFocus && $(TRIGGERS[name])) $(TRIGGERS[name]).focus();
}
function togglePanel(name) { if (openPanelName === name) closePanels(); else openPanel(name); }
function panelOpening(name) {
  if (name === "sketch") { sketchPanelOpen = true; setTool("select"); selectForEdit(null); }
  if (name === "layers") renderLayers();
  if (name === "bookmarks") showBmList();
  if (name === "save") renderAgol();
  if (name === "about") renderVersions();
  if (name === "legend") ensureLegend();
  if (name === "basemaps") ensureGallery();
  if (name === "measure") ensureMeasure();
  if (name === "profile") { $("app").classList.add("docked"); $("app").classList.remove("tools-shown"); syncToolsToggles(); ensureProfile(); }
}
function panelClosing(name) {
  if (name === "sketch") { endSketchOps(); sketchPanelOpen = false; placingText = false; currentTool = null; selectedFeature = null; updateToolButtons(); }
  if (name === "measure") stopMeasuring();
  if (name === "profile") { stopProfile(); $("app").classList.remove("docked", "tools-shown"); syncToolsToggles(); setTimeout(layoutBottom, 0); }
  if (name === "data") { addState = null; removePreview(true); }
}
document.querySelectorAll("[data-panel]").forEach((b) => b.addEventListener("click", () => togglePanel(b.dataset.panel)));
document.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => closePanels()));
$("verBtn").addEventListener("click", () => togglePanel("about"));

const modalStack = [];
function openModal(id, focusEl) {
  const m = $(id);
  if (!m.hidden) return;
  modalStack.push({ id, ret: document.activeElement });
  m.hidden = false;
  setTimeout(() => { const f = focusEl || m.querySelector("h2"); if (f) f.focus(); }, 0);
}
function closeModal(id) {
  const m = $(id);
  if (!m || m.hidden) return;
  m.hidden = true;
  const i = modalStack.findIndex((x) => x.id === id);
  const rec = i >= 0 ? modalStack.splice(i, 1)[0] : null;
  if (rec && rec.ret && document.contains(rec.ret) && rec.ret.focus) rec.ret.focus();
}
document.querySelectorAll(".modal").forEach((m) => m.addEventListener("click", (e) => { if (e.target === m) closeModal(m.id); }));
document.querySelectorAll("[data-modal-close]").forEach((b) => b.addEventListener("click", () => closeModal(b.closest(".modal").id)));
function focusables(root) { return [...root.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])')].filter((el) => el.offsetParent !== null); }
document.addEventListener("keydown", (e) => {
  if (e.key === "Tab" && modalStack.length) {
    const m = $(modalStack[modalStack.length - 1].id), f = focusables(m);
    if (!f.length) return;
    if (e.shiftKey && (document.activeElement === f[0] || !m.contains(document.activeElement))) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    return;
  }
  if (e.key !== "Escape") {
    const ae = document.activeElement || document.body;
    const inMap = $("viewDiv").contains(ae) || $("sceneDiv").contains(ae);
    if (sketchPanelOpen && selectedFeature && (e.key === "Delete" || (e.key === "Backspace" && inMap)) && !/^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) { e.preventDefault(); deleteSelected(); }
    return;
  }
  if (modalStack.length) { e.preventDefault(); closeModal(modalStack[modalStack.length - 1].id); return; }
  if (!$("measureMenu").hidden) { closeToolMenu(true); return; }
  if (!$("userMenu").hidden) { closeUserMenu(true); return; }
  if (sketchPanelOpen && (drawing || placingText)) { setTool("select"); return; }
  if (openPanelName) closePanels();
});

// ============================================================ Pop-ups
let sketchPanelOpen = false, measureActive = false;
function updatePopupEnabled() {
  const on = !sketchPanelOpen && !measureActive && !placingText && openPanelName !== "profile";
  for (const v of [mapView, sceneView]) {
    if (!v) continue;
    v.popupEnabled = on;
    if (!on) { try { v.closePopup(); } catch (e) { /* no popup */ } }
  }
}

// ============================================================ Sketch
const COLOUR_NAMES = String(S.colourNames || "").split(",");
let drawing = false, placingText = false, selectedFeature = null, currentTool = null;
let pendingStyle = { color: PALETTE_HEX[0], size: 12, rotation: 0 };
const newUid = () => "f" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const sketchVM = new SketchViewModel({ view, layer: graphicsLayer, updateOnGraphicClick: false, defaultUpdateOptions: { toggleToolOnClick: false, enableRotation: false } });

function symbolFor(kind, o) {
  const rgb = hexToRgb(o.color);
  if (kind === "text") return { type: "text", text: o.text || S.textDefault, color: o.color, haloColor: "#ffffff", haloSize: 1.5, angle: o.rotation || 0, font: { size: Math.max(10, o.size || 16), weight: "bold" } };
  if (kind === "polyline") return { type: "simple-line", color: o.color, width: Math.max(2, Math.round((o.size || 12) / 4)) };
  if (kind === "polygon") return { type: "simple-fill", color: [rgb[0], rgb[1], rgb[2], 0.25], outline: { color: o.color, width: 2 } };
  return { type: "simple-marker", style: "circle", color: o.color, size: o.size || 12, angle: o.rotation || 0, outline: { color: "#ffffff", width: 1.5 } };
}
function applyStyle(g) {
  const a = g.attributes || (g.attributes = {});
  const kind = a.kind === "text" ? "text" : (g.geometry && g.geometry.type) || "point";
  g.symbol = symbolFor(kind, { color: a.color || PALETTE_HEX[0], size: a.size || 12, rotation: a.rotation || 0, text: a.title });
}
function popupContent(event) {
  const a = (event && event.graphic && event.graphic.attributes) || {};
  const wrap = document.createElement("div");
  if (a.description) { const p = document.createElement("p"); p.className = "mm-popup-text"; p.textContent = a.description; wrap.appendChild(p); }
  if (a.imageUrl && /^data:image\//.test(a.imageUrl)) { const img = document.createElement("img"); img.className = "mm-popup-img"; img.src = a.imageUrl; img.alt = a.title || ""; wrap.appendChild(img); }
  if (!a.description && !a.imageUrl) { const p = document.createElement("p"); p.className = "mm-popup-empty"; p.textContent = S.noPopupYet; wrap.appendChild(p); }
  return wrap;
}
const popupTemplate = () => ({ title: "{title}", content: popupContent });
function addSketchGraphic(gj) {
  const g = Graphic.fromJSON({ geometry: gj.geometry, attributes: gj.attributes });
  g.attributes = { ...gj.attributes };
  applyStyle(g);
  g.popupTemplate = popupTemplate();
  graphicsLayer.add(g);
  return g;
}

function popupFieldsEnabled(on) {
  for (const id of ["imgPick", "fTitle", "fDesc", "deleteFeature"]) $(id).disabled = !on;
  $("popupHint").hidden = on;
}
function setImagePreview(dataUrl) {
  if (dataUrl) { $("imgThumb").src = dataUrl; $("imgPreview").hidden = false; $("imgPick").textContent = S.replaceImage; }
  else { $("imgThumb").removeAttribute("src"); $("imgPreview").hidden = true; $("imgPick").textContent = S.addImage; }
}
function highlightSwatch(hex) { [...$("swatches").children].forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.color === hex))); }
function populateSketchPanel() {
  const sel = selectedFeature, a = sel ? sel.attributes : null;
  popupFieldsEnabled(!!sel);
  setImagePreview(a ? a.imageUrl || "" : "");
  $("fTitle").value = a ? a.title || "" : "";
  $("fDesc").value = a ? a.description || "" : "";
  const color = a ? a.color || PALETTE_HEX[0] : pendingStyle.color, size = a ? a.size || 12 : pendingStyle.size, rot = a ? a.rotation || 0 : pendingStyle.rotation;
  highlightSwatch(color);
  $("fSize").value = size; $("sizeVal").textContent = size;
  $("fRot").value = rot; $("rotVal").textContent = rot + "°";
}
function selectForEdit(g) { selectedFeature = g || null; populateSketchPanel(); }
PALETTE_HEX.forEach((hex, i) => {
  const b = document.createElement("button");
  b.type = "button"; b.className = "swatch"; b.style.background = hex; b.dataset.color = hex;
  b.setAttribute("aria-label", (COLOUR_NAMES[i] || hex).trim()); b.title = (COLOUR_NAMES[i] || hex).trim(); b.setAttribute("aria-pressed", "false");
  b.addEventListener("click", () => {
    if (selectedFeature) { selectedFeature.attributes.color = hex; applyStyle(selectedFeature); markDirty(); } else pendingStyle.color = hex;
    highlightSwatch(hex);
  });
  $("swatches").appendChild(b);
});
$("fTitle").addEventListener("input", () => { if (!selectedFeature) return; selectedFeature.attributes.title = $("fTitle").value; if (selectedFeature.attributes.kind === "text") applyStyle(selectedFeature); markDirty(); });
$("fDesc").addEventListener("input", () => { if (!selectedFeature) return; selectedFeature.attributes.description = $("fDesc").value; markDirty(); });
function fileToDataUrl(file, cb) {     // downscale to 1200px JPEG so images don't bloat the map file; no EXIF/GPS survives the canvas
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      try {
        let w = img.width, h = img.height; const max = 1200;
        if (w > max || h > max) { const s = Math.min(max / w, max / h); w = Math.round(w * s); h = Math.round(h * s); }
        const c = document.createElement("canvas"); c.width = w; c.height = h;
        c.getContext("2d").drawImage(img, 0, 0, w, h);
        cb(c.toDataURL("image/jpeg", 0.85));
      } catch (e) { toast(S.imageFailed); }
    };
    img.onerror = () => toast(S.imageFailed);
    img.src = reader.result;
  };
  reader.onerror = () => toast(S.imageFailed);
  reader.readAsDataURL(file);
}
$("imgPick").addEventListener("click", () => { if (!$("imgPick").disabled) $("fImageFile").click(); });
$("fImageFile").addEventListener("change", () => {
  const file = $("fImageFile").files && $("fImageFile").files[0];
  $("fImageFile").value = "";
  if (!file || !selectedFeature) return;
  if (!/^image\//.test(file.type)) { toast(S.imageOnly); return; }
  const target = selectedFeature;
  fileToDataUrl(file, (url) => { target.attributes.imageUrl = url; if (target === selectedFeature) setImagePreview(url); markDirty(); });
});
$("imgRemove").addEventListener("click", () => { if (!selectedFeature) return; selectedFeature.attributes.imageUrl = ""; setImagePreview(""); markDirty(); });
$("fSize").addEventListener("input", () => {
  const v = parseInt($("fSize").value, 10); $("sizeVal").textContent = v;
  if (selectedFeature) { selectedFeature.attributes.size = v; applyStyle(selectedFeature); markDirty(); } else pendingStyle.size = v;
});
$("fRot").addEventListener("input", () => {
  const v = parseInt($("fRot").value, 10); $("rotVal").textContent = v + "°";
  if (selectedFeature) { selectedFeature.attributes.rotation = v; applyStyle(selectedFeature); markDirty(); } else pendingStyle.rotation = v;
});
$("deleteFeature").addEventListener("click", deleteSelected);
function deleteSelected() {
  const g = selectedFeature;
  if (!g) return;
  endSketchOps();
  graphicsLayer.remove(g);
  selectForEdit(null);
  markDirty();
  if (!$("layersPanel").hidden) renderLayers();
}
function endSketchOps() {
  try { if (sketchVM.createGraphic) sketchVM.cancel(); } catch (e) { /* idle */ }
  try { if (sketchVM.updateGraphics && sketchVM.updateGraphics.length) sketchVM.complete(); } catch (e) { /* idle */ }
  drawing = false;
}
function updateToolButtons() { document.querySelectorAll("#sketchTools [data-tool]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tool === currentTool))); }
function setTool(tool) {
  endSketchOps();
  currentTool = tool; placingText = false;
  updateToolButtons();
  if (["point", "polyline", "polygon", "circle"].includes(tool)) sketchVM.create(tool);
  else if (tool === "text") { placingText = true; toast(S.placeText); }
  updatePopupEnabled();
}
document.querySelectorAll("#sketchTools [data-tool]").forEach((b) => b.addEventListener("click", () => setTool(b.dataset.tool)));
function startEdit(g) {
  if (g && selectedFeature === g && sketchVM.updateGraphics && sketchVM.updateGraphics.includes(g)) return;
  endSketchOps();
  selectForEdit(g);
  if (!g) return;
  sketchVM.update([g], { tool: g.geometry.type === "point" ? "move" : "reshape" }).catch(() => {});
}
sketchVM.on("create", (event) => {
  if (event.state === "start" || event.state === "active") drawing = true;
  if (event.state === "cancel") drawing = false;
  if (event.state === "complete" && event.graphic) {
    drawing = false;
    const g = event.graphic;
    g.attributes = { uid: newUid(), kind: (g.geometry && g.geometry.type) || "point", title: "", description: "", imageUrl: "",
      color: pendingStyle.color, size: pendingStyle.size, rotation: pendingStyle.rotation };
    applyStyle(g);
    g.popupTemplate = popupTemplate();
    currentTool = "select"; updateToolButtons();
    selectForEdit(g);
    markDirty();
  }
});
sketchVM.on("update", (event) => {
  const info = event.toolEventInfo;
  if (info && /-stop$/.test(info.type || "")) markDirty();
  if (event.state === "complete" && selectedFeature && event.graphics && event.graphics.includes(selectedFeature) && !sketchPanelOpen) selectedFeature = null;
});
onViews("click", (event) => {
  if (!sketchPanelOpen) return;   // outside sketching, the map's own pop-ups handle clicks
  if (placingText) {
    event.stopPropagation();
    placingText = false;
    const g = new Graphic({ geometry: event.mapPoint, attributes: { uid: newUid(), kind: "text", title: S.textDefault, description: "", imageUrl: "",
      color: pendingStyle.color, size: Math.max(14, pendingStyle.size), rotation: pendingStyle.rotation } });
    applyStyle(g); g.popupTemplate = popupTemplate();
    graphicsLayer.add(g);
    currentTool = "select"; updateToolButtons(); updatePopupEnabled();
    selectForEdit(g); markDirty();
    setTimeout(() => { $("fTitle").focus(); $("fTitle").select(); }, 0);
    return;
  }
  if (drawing || currentTool !== "select") return;
  view.hitTest(event, { include: [graphicsLayer] }).then((resp) => {
    const hit = (resp.results || []).find((r) => r.graphic && r.graphic.layer === graphicsLayer);
    startEdit(hit ? hit.graphic : null);
  }).catch(() => {});
});

// ============================================================ Legend, basemaps, measure
let legend = null, basemapGallery = null, measurement = null, coordWidget = null;
function ensureLegend() { if (!legend) legend = new Legend({ view, container: "legendBody" }); else legend.view = view; }
function ensureGallery() {
  if (!basemapGallery) {
    basemapGallery = new BasemapGallery({ view, container: "basemapsBody", source: new PortalBasemapsSource({ query: { id: cfg.basemapGroup } }) });
    reactiveUtils.watch(() => basemapGallery.activeBasemap, (b, old) => { if (old && b && b !== old) markDirty(); });
  } else basemapGallery.view = view;
}
const units = cfg.units === "imperial" ? "imperial" : "metric";
function ensureMeasure() { if (!measurement) measurement = new Measurement({ view, container: "measureBody", linearUnit: units, areaUnit: units }); else measurement.view = view; }
function measurePressed(id) { ["mDist", "mArea", "mCoord"].forEach((b) => $(b).setAttribute("aria-pressed", String(b === id))); }
function stopMeasuring() {
  try { if (measurement) measurement.clear(); } catch (e) { /* idle */ }
  measurePressed(null); measureActive = false; $("coordBody").hidden = true;
  updatePopupEnabled();
}
$("mDist").addEventListener("click", () => { ensureMeasure(); $("coordBody").hidden = true; measurement.activeTool = mode === "3d" ? "direct-line" : "distance"; measurePressed("mDist"); measureActive = true; updatePopupEnabled(); });
$("mArea").addEventListener("click", () => { ensureMeasure(); $("coordBody").hidden = true; measurement.activeTool = "area"; measurePressed("mArea"); measureActive = true; updatePopupEnabled(); });
$("mCoord").addEventListener("click", () => {
  try { if (measurement) measurement.clear(); } catch (e) { /* idle */ }
  if (!coordWidget) coordWidget = new CoordinateConversion({ view, container: "coordBody" }); else coordWidget.view = view;
  $("coordBody").hidden = false; measurePressed("mCoord"); measureActive = false; updatePopupEnabled();
});
$("mClear").addEventListener("click", stopMeasuring);

// Elevation profile: the land's height along a line drawn on the map (or a sketched line), from Esri's world elevation.
let elevationProfile = null;
function ensureProfile() {
  const m = activeMap();
  if (!m.ground || !m.ground.layers || !m.ground.layers.length) m.ground = "world-elevation";
  if (!elevationProfile) elevationProfile = new ElevationProfile({ view, container: "profileBody", unit: units, profiles: [{ type: "ground" }] });
  else elevationProfile.view = view;
}
function stopProfile() {
  if (!elevationProfile) return;
  try { elevationProfile.viewModel.cancel(); elevationProfile.viewModel.clear(); } catch (e) { /* idle */ }
}

// The Measure tool opens a small menu above it: Measure, Elevation profile (as in MapMaker).
const menuItems = () => [...$("measureMenu").querySelectorAll('[role="menuitem"]')].filter((b) => !b.hidden);
function placeToolMenu() {
  const menu = $("measureMenu"), wrap = $("mapWrap").getBoundingClientRect(), btn = $("tool-measure").getBoundingClientRect(), tb = $("toolbar").getBoundingClientRect();
  const mw = menu.offsetWidth;
  menu.style.left = Math.max(8, Math.min(btn.left + btn.width / 2 - mw / 2 - wrap.left, wrap.width - mw - 8)) + "px";
  menu.style.bottom = Math.round(wrap.bottom - tb.top + 6) + "px";
}
function openToolMenu() {
  $("measureMenu").hidden = false; placeToolMenu();
  $("tool-measure").setAttribute("aria-expanded", "true");
  const items = menuItems(), cur = items.find((b) => b.classList.contains("active")) || items[0];
  if (cur) cur.focus();
}
function closeToolMenu(focusButton) {
  if ($("measureMenu").hidden) return;
  $("measureMenu").hidden = true; $("tool-measure").setAttribute("aria-expanded", "false");
  if (focusButton) $("tool-measure").focus();
}
$("tool-measure").addEventListener("click", () => {
  const items = menuItems();
  if (items.length < 2) { togglePanel(items[0] === $("menuProfile") ? "profile" : "measure"); return; }
  if ($("measureMenu").hidden) openToolMenu(); else closeToolMenu(false);
});
$("menuMeasure").addEventListener("click", () => { closeToolMenu(false); openPanel("measure"); });
$("menuProfile").addEventListener("click", () => { closeToolMenu(false); openPanel("profile"); });
$("measureMenu").addEventListener("keydown", (e) => {
  const items = menuItems(), i = items.indexOf(document.activeElement);
  const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
  if (step) { e.preventDefault(); items[(i + step + items.length) % items.length].focus(); }
  else if (e.key === "Home" || e.key === "End") { e.preventDefault(); items[e.key === "Home" ? 0 : items.length - 1].focus(); }
  else if (e.key === "Tab") closeToolMenu(false);
});
document.addEventListener("pointerdown", (e) => { if (!$("measureMenu").hidden && !$("measureMenu").contains(e.target) && !$("tool-measure").contains(e.target)) closeToolMenu(false); });
window.addEventListener("resize", () => { if (!$("measureMenu").hidden) placeToolMenu(); });

// ============================================================ 2D / 3D
let switching = false;
const TILT_3D = Math.max(0, Math.min(80, Number(cfg.threeDTilt) || 0));
async function setMode(m, opts) {
  if (m === mode || switching) return;
  if (m === "3d" && F.threeD === false) return;
  switching = true;
  const from = view, vp = from.viewpoint ? from.viewpoint.clone() : null, curMap = from.map;
  stopMeasuring();
  endSketchOps();
  try {
    if (m === "3d") {
      if (!curMap.ground || !curMap.ground.layers || !curMap.ground.layers.length) curMap.ground = "world-elevation";
      $("sceneDiv").hidden = false;
      if (!sceneView) { sceneView = new SceneView({ container: "sceneDiv", map: curMap }); addViewUI(sceneView, true); viewHandlers.forEach((h) => sceneView.on(h[0], h[1])); }
      else if (sceneView.map !== curMap) sceneView.map = curMap;
      await sceneView.when();
      if (vp) sceneView.viewpoint = vp;
      $("viewDiv").hidden = true; view = sceneView;
      // Same place, then tilt the camera towards the horizon so it's obvious the view is now 3D.
      // (At a whole-world scale the SDK allows little tilt, but the globe itself shows the change.)
      if (TILT_3D && !(opts && opts.keepCamera)) sceneView.goTo({ tilt: TILT_3D }, { animate: !reduceMotion, duration: 1400 }).catch(() => {});
    } else {
      $("viewDiv").hidden = false;
      if (mapView.map !== curMap) mapView.map = curMap;
      await mapView.when();
      if (vp) mapView.viewpoint = vp;
      $("sceneDiv").hidden = true; view = mapView;
    }
  } catch (e) {
    console.error("Couldn't switch view", e);
    $("viewDiv").hidden = false; $("sceneDiv").hidden = true; view = mapView; m = "2d";
    toast(S.no3d);
  }
  mode = m; switching = false;
  $("tg2d").setAttribute("aria-pressed", String(m === "2d")); $("tg3d").setAttribute("aria-pressed", String(m === "3d"));
  sketchVM.view = view;
  if (basemapGallery) basemapGallery.view = view;
  if (measurement) measurement.view = view;
  if (elevationProfile) { stopProfile(); elevationProfile.view = view; }
  if (coordWidget) coordWidget.view = view;
  if (legend) legend.view = view;
  updatePopupEnabled();
  watchBottom(0);
  if (m === "3d" && dataLayers.some((l) => l.renderer && l.renderer.type === "pie-chart")) toast(S.pieIn3d);
}
$("tg2d").addEventListener("click", () => setMode("2d"));
$("tg3d").addEventListener("click", () => setMode("3d"));

// ============================================================ Maps and layers
function setActiveMap(m) {
  const old = view.map;
  if (old && old !== m) { try { old.remove(graphicsLayer); } catch (e) { /* not there */ } }
  if (!m.layers.includes(graphicsLayer)) m.add(graphicsLayer);
  mapView.map = m;
  if (sceneView) sceneView.map = m;
}
function keepSketchOnTop() { const m = activeMap(); try { m.reorder(graphicsLayer, m.layers.length - 1); } catch (e) { /* ok */ } }
function removeFromMaps(l) { for (const m of new Set([localMap, mapView.map, sceneView && sceneView.map])) { if (m) { try { m.remove(l); } catch (e) { /* not there */ } } } }
function resetWorkspace() {
  addState = null; removePreview(false);
  dataLayers.splice(0).forEach(removeFromMaps);
  [...portalLayers.values()].forEach(removeFromMaps); portalLayers.clear();
  endSketchOps(); graphicsLayer.removeAll(); graphicsLayer.visible = true; selectedFeature = null;
  bookmarks = [];
  currentSource = null; currentAgolItem = null;
  if (!$("bookmarksPanel").hidden) showBmList();
  if (!$("layersPanel").hidden) renderLayers();
  if (catalogLoaded) refreshCatalogButtons();
}
function sourceLayers() {
  const own = new Set([graphicsLayer, previewLayer, ...dataLayers, ...portalLayers.values()]);
  return activeMap().layers.toArray().filter((l) => !own.has(l));
}
function basemapFrom(ref) { return typeof ref === "string" && ref.startsWith("item:") ? new Basemap({ portalItem: { id: ref.slice(5) } }) : ref; }
function basemapRef() { const b = activeMap().basemap; return b && b.portalItem && b.portalItem.id ? "item:" + b.portalItem.id : null; }

// This app's own layers (sketches, spreadsheets) come back editable; layers it added from the collection are
// recognised by their "__item_<id>" layer id so they can be removed again.
function applyParsedWebMap(parsed) {
  for (const gj of parsed.graphics) addSketchGraphic(gj);
  graphicsLayer.visible = parsed.sketchVisible !== false;
  for (const def of parsed.layers) { try { addDataLayer(def, { silent: true }); } catch (e) { console.warn("Skipped a data layer", e); } }
  const ops = (currentSource && currentSource.data && currentSource.data.operationalLayers) || [];
  activeMap().layers.forEach((l) => {
    if (typeof l.id !== "string" || !l.id.startsWith(ITEM_LAYER_PREFIX)) return;
    const itemId = l.id.slice(ITEM_LAYER_PREFIX.length);
    if (!HEX32.test(itemId) || portalLayers.has(itemId)) return;
    l.__item = { itemId, type: "", title: l.title || "" };
    l.__opJson = ops.find((o) => o.id === l.id) || null;
    portalLayers.set(itemId, l);
  });
  if (currentSource && currentSource.data) currentSource.data = { ...currentSource.data, operationalLayers: ops.filter((o) => !String(o.id || "").startsWith(ITEM_LAYER_PREFIX)) };
  bookmarks = parsed.bookmarks;
  keepSketchOnTop();
}
async function openWebMapItem(itemId, opts) {
  opts = opts || {};
  if (!HEX32.test(itemId || "")) return false;
  if (!opts.keepWorkspace && !opts.skipConfirm && !confirmDiscard()) return false;
  closeModal("openModal");
  if (!opts.quiet) toast(t("openingMap", { title: opts.title || "" }));
  try {
    const [item, data] = await Promise.all([restGet(`/sharing/rest/content/items/${itemId}`), restGet(`/sharing/rest/content/items/${itemId}/data`)]);
    const parsed = readWebMap(data, { trusted: true });
    if (!parsed.ok) throw new Error("Not a web map");
    const wm = new WebMap({ portalItem: { id: itemId } });
    await wm.load();
    if (!opts.keepWorkspace) resetWorkspace();
    for (const op of (data.operationalLayers || []).filter(isOwnLayerJson)) { const l = wm.layers.find((x) => x.id === op.id); if (l) wm.remove(l); }
    setActiveMap(wm);
    currentSource = { itemId, title: item.title, item, data: parsed.webmap };
    if (portalUser && item.owner === portalUser.username) currentAgolItem = { id: itemId, owner: item.owner, title: item.title };
    if (!opts.keepWorkspace) {
      applyParsedWebMap(parsed);
      setTitle(item.title); markClean(); currentFileHandle = null; openedHandleUnsaved = false;
      const vp = wm.initialViewProperties && wm.initialViewProperties.viewpoint;
      if (vp) goToSafe(vp, { animate: false });
      if (!opts.quiet) toast(t("openedMap", { title: item.title }));
    }
    if (!$("bookmarksPanel").hidden) showBmList();
    if (!$("layersPanel").hidden) renderLayers();
    if (catalogLoaded) refreshCatalogButtons();
    if (legend) legend.view = view;
    return true;
  } catch (e) {
    console.error("Open map failed", e);
    if (!opts.quiet) toast(S.openFailed, 5000);
    return false;
  }
}
// A web map saved on this device (or any web map JSON). Every web address in it was checked by readWebMap.
async function openWebMapFile(raw, fileName) {
  const parsed = readWebMap(raw);
  if (!parsed.ok) { toast(S[parsed.code] || S.cantRead, 5000); return false; }
  closeModal("openModal");
  closePanels(false);
  try {
    const wm = WebMap.fromJSON(parsed.webmap);
    if (!parsed.webmap.baseMap) wm.basemap = defaultBasemap();
    await wm.load();
    resetWorkspace();
    setActiveMap(wm);
    const title = titleFromFileName(fileName);
    currentSource = { itemId: null, title, item: null, data: parsed.webmap };
    applyParsedWebMap(parsed);
    setTitle(title);
    await setMode("2d");   // a web map is a 2D document; switch to 3D again if you like
    const vp = wm.initialViewProperties && wm.initialViewProperties.viewpoint;
    if (vp) goToSafe(vp, { animate: false });
    if (!$("bookmarksPanel").hidden) showBmList();
    if (!$("layersPanel").hidden) renderLayers();
    if (catalogLoaded) refreshCatalogButtons();
    if (legend) legend.view = view;
    markClean();
    const n = graphicsLayer.graphics.length + parsed.layers.reduce((x, l) => x + l.features.length, 0);
    toast(t("openedFile", { title: title || S.untitled, n }));
    if (parsed.skipped) setTimeout(() => toast(t("skippedOnOpen", { n: parsed.skipped }), 5000), 3500);
    return true;
  } catch (e) {
    console.error("Open file failed", e);
    toast(S.cantRead, 5000);
    return false;
  }
}

function newBlankMap() {
  if (!confirmDiscard()) return;
  closeModal("openModal");
  resetWorkspace();
  setActiveMap(localMap);
  localMap.basemap = defaultBasemap();
  setTitle(""); currentFileHandle = null; openedHandleUnsaved = false; markClean();
  goToSafe({ center: startCenter, zoom: Number(cfg.startView.zoom) || 2 });
  toast(S.newMapStarted);
}

async function addPortalLayer(info, opts) {
  opts = opts || {};
  if (portalLayers.has(info.itemId)) return portalLayers.get(info.itemId);
  try {
    const layer = await Layer.fromPortalItem({ portalItem: { id: info.itemId } });
    try { layer.id = ITEM_LAYER_PREFIX + info.itemId; } catch (e) { /* keep the generated id */ }
    layer.__item = { itemId: info.itemId, type: info.type || "", title: info.title || layer.title };
    if (opts.visible === false) layer.visible = false;
    if (typeof opts.opacity === "number") layer.opacity = opts.opacity;
    activeMap().add(layer);
    keepSketchOnTop();
    portalLayers.set(info.itemId, layer);
    if (!opts.silent) { toast(t("addedLayer", { title: layer.__item.title })); markDirty(); }
    if (!$("layersPanel").hidden) renderLayers();
    return layer;
  } catch (e) {
    console.error("Add layer failed", e);
    toast(t("layerFailed", { title: info.title || "" }), 5000);
    return null;
  }
}
function removePortalLayer(itemId) {
  const l = portalLayers.get(itemId);
  if (!l) return;
  removeFromMaps(l); portalLayers.delete(itemId); markDirty();
  toast(t("removedLayer", { title: l.__item.title }));
  if (!$("layersPanel").hidden) renderLayers();
}

// ============================================================ Data layers (CSV) — client-side FeatureLayers
function buildDataLayer(ld) {
  const gtype = ld.geometryType || "point";
  const rawFields = (ld.fields || []).slice();
  let oidField = ld.objectIdField;
  if (!oidField) { const o = rawFields.find((f) => f.type === "esriFieldTypeOID" || f.type === "oid"); oidField = o ? o.name : "__oid"; }
  if (!rawFields.some((f) => f.name === oidField)) rawFields.unshift({ name: oidField, alias: oidField, type: "esriFieldTypeOID" });
  const fields = rawFields.map((f) => (typeof f.type === "string" && f.type.indexOf("esriFieldType") === 0 ? Field.fromJSON(f) : f));
  const feats = (ld.features || []).map((f, i) => {
    let gj = f.geometry || null;
    if (gj && !gj.type) gj = { ...gj, type: gtype };
    const attrs = { ...(f.attributes || {}) };
    if (attrs[oidField] == null) attrs[oidField] = i + 1;
    return new Graphic({ geometry: gj, attributes: attrs });
  });
  const props = { source: feats, objectIdField: oidField, fields, geometryType: gtype, spatialReference: ld.spatialReference || { wkid: 102100 },
    title: ld.title || "Data", popupEnabled: true };
  if (ld.id) props.id = DATA_LAYER_PREFIX + ld.id;   // same id as its saved operational layer, so bookmarks find it again
  if (ld.renderer) { const rj = ld.renderer; props.renderer = rj.type && rj.type.indexOf("-") >= 0 ? rj : rendererJsonUtils.fromJSON(rj); }
  if (ld.labelingInfo && ld.labelingInfo.length) props.labelingInfo = ld.labelingInfo.map((l) => (l && l.symbol && l.symbol.type === "esriTS" ? LabelClass.fromJSON(l) : l));
  if (ld.popupInfo) props.popupTemplate = { title: ld.popupInfo.title || "", content: ld.popupInfo.content || [{ type: "fields", fieldInfos: ld.popupInfo.fieldInfos || [] }], fieldInfos: ld.popupInfo.fieldInfos || [] };
  const fl = new FeatureLayer(props);
  fl.labelsVisible = true;
  const def = { ...ld }; delete def.visible; delete def.opacity;
  fl._srcDef = def;
  return fl;
}
function addDataLayer(def, opts) {
  const fl = buildDataLayer(def);
  if (def.visible === false) fl.visible = false;
  if (typeof def.opacity === "number") fl.opacity = def.opacity;
  dataLayers.push(fl);
  activeMap().add(fl);
  keepSketchOnTop();
  if (!(opts && opts.silent)) markDirty();
  return fl;
}

// ============================================================ Map layers panel
const ICON_ZOOM = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/><path d="M8 10.5h5M10.5 8v5"/></svg>';
const ICON_TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m3 0-1 13a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1L6 7"/><path d="M10 11v6M14 11v6"/></svg>';
const ICON_INFO = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>';
function eachToggleableLayer(fn) {
  fn(graphicsLayer, "__sketch", S.sketchLayer);
  activeMap().layers.toArray().slice().reverse().forEach((l) => { if (l !== graphicsLayer && l !== previewLayer) fn(l, l.id, l.title || l.id); });
}
function zoomToLayer(l) {
  if (l === graphicsLayer) { const g = graphicsLayer.graphics.toArray(); if (g.length) goToSafe(g); else toast(S.noSketches); return; }
  if (l.queryExtent) { l.when().then(() => l.queryExtent()).then((r) => { if (r && r.extent) goToSafe(r.extent.expand(1.2)); }).catch(() => {}); return; }
  if (l.fullExtent) goToSafe(l.fullExtent);
}
function renderLayers() {
  const list = $("layersList"); list.innerHTML = "";
  let n = 0;
  eachToggleableLayer((l, id, title) => {
    n++;
    const li = document.createElement("li"); li.className = "li";
    const cbId = "lyr-" + n;
    const cb = document.createElement("input"); cb.type = "checkbox"; cb.id = cbId; cb.checked = l.visible !== false;
    const main = document.createElement("label"); main.className = "li-main"; main.htmlFor = cbId;
    const tt = document.createElement("span"); tt.className = "li-title" + (l.visible === false ? " off" : ""); tt.textContent = title;
    main.appendChild(tt);
    cb.addEventListener("change", () => { l.visible = cb.checked; tt.className = "li-title" + (cb.checked ? "" : " off"); markDirty(); });
    const z = document.createElement("button"); z.type = "button"; z.className = "mini"; z.innerHTML = ICON_ZOOM; z.title = S.zoomTo; z.setAttribute("aria-label", S.zoomTo + ": " + title);
    z.addEventListener("click", () => zoomToLayer(l));
    li.append(main, z);
    const isData = dataLayers.includes(l), isPortal = !!l.__item && portalLayers.get(l.__item.itemId) === l;
    if (isData || isPortal) {
      const d = document.createElement("button"); d.type = "button"; d.className = "mini"; d.innerHTML = ICON_TRASH; d.title = S.removeLayer; d.setAttribute("aria-label", S.removeLayer + ": " + title);
      d.addEventListener("click", () => {
        if (isData) { dataLayers.splice(dataLayers.indexOf(l), 1); removeFromMaps(l); markDirty(); toast(S.layerRemoved); renderLayers(); }
        else removePortalLayer(l.__item.itemId);
        if (catalogLoaded) refreshCatalogButtons();
      });
      li.appendChild(d);
    }
    li.appendChild(cb);
    list.appendChild(li);
  });
  if (n <= 1 && !graphicsLayer.graphics.length) { const p = document.createElement("li"); p.className = "empty"; p.textContent = S.noLayers; list.appendChild(p); }
}

// ============================================================ Bookmarks
let bmEditIndex = -1;
function layerSnapshot() { const s = []; eachToggleableLayer((l, id, title) => s.push({ id, title, visible: l.visible !== false })); return s; }
function applyLayerSnapshot(snap) {
  if (!snap || !snap.length) return;
  eachToggleableLayer((l, id, title) => { const rec = snap.find((r) => r.id === id) || snap.find((r) => r.title && r.title === title); if (rec) l.visible = !!rec.visible; });
  if (!$("layersPanel").hidden) renderLayers();
}
function applyBookmark(bm) {
  const vp = bm.viewpoint;
  if (vp.center) goToSafe({ center: vp.center, zoom: vp.zoom }, { duration: 800 });
  else if (vp.extent) goToSafe(Extent.fromJSON(vp.extent), { duration: 800 });
  applyLayerSnapshot(bm.layers);
}
function captureThumb(bm) {
  view.takeScreenshot({ width: 148, height: 96, format: "jpg", quality: 70 }).then((s) => { if (s && s.dataUrl) { bm.thumb = s.dataUrl; renderBookmarks(); } }).catch(() => {});
}
function renderBookmarks() {
  const list = $("bmList"); list.innerHTML = "";
  $("bmEmpty").hidden = bookmarks.length > 0;
  bookmarks.forEach((bm, i) => {
    const li = document.createElement("li"); li.className = "bm";
    const go = document.createElement("button"); go.type = "button"; go.className = "bm-go";
    const th = document.createElement("span"); th.className = "bm-thumb"; th.setAttribute("aria-hidden", "true");
    if (bm.thumb) th.style.backgroundImage = "url(" + bm.thumb + ")";
    const tt = document.createElement("span"); tt.className = "bm-title"; tt.textContent = bm.title;
    go.append(th, tt); go.addEventListener("click", () => applyBookmark(bm));
    const ed = document.createElement("button"); ed.type = "button"; ed.className = "mini"; ed.innerHTML = "&#9998;"; ed.title = S.editBookmark; ed.setAttribute("aria-label", S.editBookmark + ": " + bm.title);
    ed.addEventListener("click", () => showBmEdit(i));
    li.append(go, ed); list.appendChild(li);
  });
}
function showBmList() { bmEditIndex = -1; $("bmEditView").hidden = true; $("bmListView").hidden = false; renderBookmarks(); }
function showBmEdit(i) {
  bmEditIndex = typeof i === "number" ? i : -1;
  const editing = bmEditIndex >= 0;
  $("bmListView").hidden = true; $("bmEditView").hidden = false;
  $("bmEditTitle").textContent = editing ? S.editBookmark : S.addBookmark.replace(/^\+\s*/, "");
  $("bmSave").textContent = editing ? S.save : S.add;
  $("bmDelete").hidden = !editing; $("bmHint").hidden = editing;
  $("bmTitleInput").value = editing ? bookmarks[bmEditIndex].title : "";
  $("bmTitleInput").focus();
}
$("bmAddBtn").addEventListener("click", () => showBmEdit(-1));
$("bmBack").addEventListener("click", showBmList);
$("bmCancel").addEventListener("click", showBmList);
$("bmSave").addEventListener("click", () => {
  const title = $("bmTitleInput").value.trim();
  if (bmEditIndex >= 0) bookmarks[bmEditIndex].title = title || bookmarks[bmEditIndex].title;
  else {
    const bm = { title: title || t("bookmarkDefault", { n: bookmarks.length + 1 }), viewpoint: { center: [view.center.longitude, view.center.latitude], zoom: view.zoom }, layers: layerSnapshot(), thumb: null };
    bookmarks.push(bm); captureThumb(bm);
  }
  markDirty(); showBmList();
  $("bmAddBtn").focus();
});
$("bmTitleInput").addEventListener("keydown", (e) => { if (e.key === "Enter") $("bmSave").click(); });
$("bmDelete").addEventListener("click", () => { if (bmEditIndex >= 0) { bookmarks.splice(bmEditIndex, 1); markDirty(); } showBmList(); $("bmAddBtn").focus(); });

// ============================================================ Topics (the content group's categories; shared by Open map and Add layer)
let topicTreePromise = null;
function getTopicTree() {
  if (!topicTreePromise) topicTreePromise = restGet(`/sharing/rest/community/groups/${cfg.contentGroup}/categorySchema`)
    .then(buildTopicTree).catch((e) => { console.warn("No category schema", e); return []; });
  return topicTreePromise;
}
const cleanQuery = (s) => String(s || "").replace(/["':()\\[\]{}^~*?]/g, " ").replace(/\s+/g, " ").trim();
function thumbUrl(item) {
  if (!item || !item.thumbnail) return "";
  let u = `${PORTAL}/sharing/rest/content/items/${item.id}/info/${item.thumbnail}`;
  if (item.access && item.access !== "public") { const c = IdentityManager.findCredential(PORTAL + "/sharing"); if (c && c.token) u += "?token=" + encodeURIComponent(c.token); }
  return u;
}

// ============================================================ Collection browser (Open map and Add layer)
// After MapMaker's Add layer dialog: search, a Categories tree (the content group's categories, with chevrons for
// sub-categories and a reset button), wide cards with an expandable description, and page numbers. Up to MAX_INDEX
// items are loaded once and filtered in the browser, with counts; a bigger group is searched in ArcGIS Online instead.
const PAGE_SIZE = 10;
const SVG = (d, w) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + (w || 1.8) + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + d + "</svg>";
const ICON_PLUS = SVG('<path d="M12 5v14M5 12h14"/>'), ICON_MINUS = SVG('<path d="M5 12h14"/>'), ICON_CHEV_R = SVG('<path d="m9 5 7 7-7 7"/>', 2), ICON_CHEV_D = SVG('<path d="m5 9 7 7 7-7"/>');
const SUPPORTED_TYPES = { "Feature Service": "typeLayer", "Feature Collection": "typeLayer", "Map Service": "typeMapLayer", "Image Service": "typeImagery",
  "Vector Tile Service": "typeTiles", "Group Layer": "typeGroup", "WMS": "typeMapLayer", "KML": "typeLayer", "GeoJson": "typeLayer", "CSV": "typeLayer" };
let searchTimer = 0, descSeq = 0;
function createBrowser(o) {
  // o: { p (id prefix), query, accept(item), kind ("maps" | "layers"), descLabel, thumbOpens, decorate(button, item), run(item, button) }
  const el = (x) => $(o.p + x);
  const st = { ready: null, loaded: false, tree: [], entries: null, counts: null, other: 0, mode: "index", topic: ALL, page: 1, expanded: new Set(), token: 0 };
  const unitText = (n) => (n === 1 ? S[o.kind + "CountOne"] : t(o.kind + "Count", { n }));
  const countFor = (key) => (!st.counts ? null : !key ? st.entries.length : key === OTHER ? st.other : st.counts.get(key) || 0);
  const topicName = (key) => (!key ? "" : key === OTHER ? S.otherCategory : (findTopic(st.tree, key) || {}).title || "");
  function load() {
    if (st.ready) return st.ready;
    st.ready = (async () => {
      const path = `/sharing/rest/content/groups/${cfg.contentGroup}/search`, q = { num: 100, start: 1, q: o.query, sortField: "title", sortOrder: "asc" };
      const [tree, first] = await Promise.all([getTopicTree(), restGet(path, q)]);
      st.tree = tree;
      if ((first.total || 0) > MAX_INDEX) { st.mode = "server"; st.entries = null; st.counts = null; st.other = 0; return; }
      const items = (first.results || []).slice();
      for (let next = first.nextStart; next > 0 && items.length < MAX_INDEX;) { const d = await restGet(path, { ...q, start: next }); items.push(...(d.results || [])); next = d.nextStart; }
      st.mode = "index";
      st.entries = indexItems(items.filter(o.accept));
      const c = countTopics(tree, st.entries); st.counts = c.counts; st.other = c.other;
    })();
    st.ready.catch(() => { st.ready = null; });
    return st.ready;
  }
  function countBadgeFor(n) {
    const c = document.createElement("span"); c.className = "count"; c.textContent = n.toLocaleString(cfg.locale || undefined);
    const u = document.createElement("span"); u.className = "sr-only"; u.textContent = " " + (n === 1 ? S[o.kind + "UnitOne"] : S[o.kind + "Unit"]);
    c.appendChild(u); return c;
  }
  function renderTree(focusKey, focusChevron) {
    const root = el("Tree"); root.innerHTML = "";
    const addRows = (nodes, ul) => nodes.forEach((n) => {
      const c = countFor(n.key);
      if (c === 0) return;
      const kids = n.children.filter((k) => countFor(k.key) !== 0);
      const li = document.createElement("li"), row = document.createElement("div"); row.className = "tree-row";
      if (kids.length) {
        const ch = document.createElement("button"); ch.type = "button"; ch.className = "tree-chev"; ch.dataset.key = n.key; ch.innerHTML = ICON_CHEV_R;
        const open = st.expanded.has(n.key);
        ch.setAttribute("aria-expanded", String(open)); ch.setAttribute("aria-label", t("subCategoriesOf", { topic: n.title }));
        ch.addEventListener("click", () => { if (st.expanded.has(n.key)) st.expanded.delete(n.key); else st.expanded.add(n.key); renderTree(n.key, true); });
        row.appendChild(ch);
      } else { const sp = document.createElement("span"); sp.className = "tree-spacer"; row.appendChild(sp); }
      const b = document.createElement("button"); b.type = "button"; b.className = "tree-name"; b.dataset.key = n.key;
      const nm = document.createElement("span"); nm.textContent = n.title; b.appendChild(nm);
      if (c != null) b.appendChild(countBadgeFor(c));
      if (st.topic === n.key) b.setAttribute("aria-current", "true");
      b.addEventListener("click", () => select(n.key, "tree"));
      row.appendChild(b); li.appendChild(row);
      if (kids.length && st.expanded.has(n.key)) { const sub = document.createElement("ul"); sub.className = "tree-sub"; addRows(kids, sub); li.appendChild(sub); }
      ul.appendChild(li);
    });
    addRows(st.tree, root);
    if (st.counts && st.other > 0 && st.tree.length) {
      const li = document.createElement("li"), row = document.createElement("div"); row.className = "tree-row";
      const sp = document.createElement("span"); sp.className = "tree-spacer";
      const b = document.createElement("button"); b.type = "button"; b.className = "tree-name"; b.dataset.key = OTHER;
      const nm = document.createElement("span"); nm.textContent = S.otherCategory; b.append(nm, countBadgeFor(st.other));
      if (st.topic === OTHER) b.setAttribute("aria-current", "true");
      b.addEventListener("click", () => select(OTHER, "tree"));
      row.append(sp, b); li.appendChild(row); root.appendChild(li);
    }
    const has = st.tree.length > 0;
    el("CatsBtn").hidden = !has;
    if (!has) el("Body").classList.add("side-hidden");
    if (focusKey != null) { const f = [...root.querySelectorAll(focusChevron ? ".tree-chev" : ".tree-name")].find((x) => x.dataset.key === focusKey); if (f) f.focus(); }
  }
  function card(item) {
    const li = document.createElement("li"); li.className = "cat-card";
    const top = document.createElement("div"); top.className = "cat-card-top";
    const txt = document.createElement("div"); txt.className = "cat-card-text";
    const h = document.createElement("h4"); h.className = "cat-card-title"; h.textContent = item.title || S.untitled;
    const sn = document.createElement("p"); sn.className = "cat-card-snippet"; sn.textContent = item.snippet || "";
    const act = document.createElement("button"); act.type = "button"; act.className = "cat-act"; act._item = item;
    o.decorate(act, item);
    act.addEventListener("click", () => o.run(item, act));
    txt.append(h, sn, act);
    const th = document.createElement("div"); th.className = "cat-thumb" + (o.thumbOpens ? " open" : ""); th.setAttribute("aria-hidden", "true");
    const tu = thumbUrl(item); if (tu) th.style.backgroundImage = "url('" + tu.replace(/'/g, "%27") + "')";
    if (o.thumbOpens) th.addEventListener("click", () => o.run(item, act));
    top.append(txt, th);
    const id = "desc" + (++descSeq);
    const db = document.createElement("button"); db.type = "button"; db.className = "cat-desc-btn"; db.setAttribute("aria-expanded", "false"); db.setAttribute("aria-controls", id);
    const dl = document.createElement("span"); dl.textContent = o.descLabel(); db.appendChild(dl); db.insertAdjacentHTML("beforeend", ICON_CHEV_D);
    db.setAttribute("aria-label", o.descLabel() + ": " + (item.title || ""));
    const dd = document.createElement("div"); dd.className = "cat-desc rich"; dd.id = id; dd.hidden = true;
    db.addEventListener("click", () => {
      const open = db.getAttribute("aria-expanded") !== "true";
      if (open && !dd.childNodes.length) {
        if (item.description) dd.appendChild(safeFragment(item.description));
        else { const p = document.createElement("p"); p.textContent = item.snippet || S.noDescription; dd.appendChild(p); }
        if (item.accessInformation) { const p = document.createElement("p"); const b = document.createElement("strong"); b.textContent = S.credits + ": "; p.append(b, document.createTextNode(item.accessInformation)); dd.appendChild(p); }
      }
      db.setAttribute("aria-expanded", String(open)); dd.hidden = !open;
    });
    li.append(top, db, dd);
    return li;
  }
  function paint(items, n, pages, text, focusList) {
    const ul = el("List"); ul.innerHTML = "";
    for (const it of items) ul.appendChild(card(it));
    el("Empty").textContent = n ? "" : text ? (st.topic ? t("noMatchIn", { topic: topicName(st.topic) }) : S.noMatch) : S[o.kind === "maps" ? "noMaps" : "noLayersHere"];
    el("SearchAllRow").hidden = !(n === 0 && text && st.topic);
    renderPager(pages);
    el("Main").scrollTop = 0;
    if (focusList) ul.focus();
  }
  function setStatus(n, total, text) {
    const topic = topicName(st.topic);
    el("Status").textContent = text ? (topic ? t("matchOfIn", { n, count: unitText(total), topic }) : t("matchOf", { n, count: unitText(total) }))
      : topic ? t("inTopic", { count: unitText(n), topic }) : unitText(n);
  }
  function renderList(focusList) {
    if (!st.loaded) return;
    if (st.mode === "server") { serverPage(focusList); return; }
    const text = el("Search").value.trim();
    const list = filterEntries(st.entries, st.tree, st.topic, text, cfg.locale);
    const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    if (st.page > pages) st.page = pages;
    paint(list.slice((st.page - 1) * PAGE_SIZE, st.page * PAGE_SIZE).map((e) => e.item), list.length, pages, text, focusList);
    setStatus(list.length, countFor(st.topic) ?? list.length, text);
  }
  async function serverPage(focusList) {
    const token = ++st.token, text = cleanQuery(el("Search").value);
    const q = { num: PAGE_SIZE, start: (st.page - 1) * PAGE_SIZE + 1, q: o.query + (text ? " AND (" + text + ")" : "") };
    if (!text) { q.sortField = "title"; q.sortOrder = "asc"; }
    const node = st.topic && st.topic !== OTHER ? findTopic(st.tree, st.topic) : null;
    if (node) q.categories = node.path;
    el("List").setAttribute("aria-busy", "true");
    try {
      const d = await restGet(`/sharing/rest/content/groups/${cfg.contentGroup}/search`, q);
      if (token !== st.token) return;
      const total = d.total || 0;
      paint((d.results || []).filter(o.accept), total, Math.max(1, Math.ceil(total / PAGE_SIZE)), text, focusList);
      setStatus(total, total, "");
    } catch (e) { if (token === st.token) { console.error(e); el("Empty").textContent = S.groupError; } }
    if (token === st.token) el("List").removeAttribute("aria-busy");
  }
  function renderPager(pages) {
    const nav = el("Pager"); nav.innerHTML = "";
    nav.hidden = pages <= 1;
    if (pages <= 1) return;
    const btn = (label, aria, page, disabled, current) => {
      const b = document.createElement("button"); b.type = "button"; b.textContent = label; b.setAttribute("aria-label", aria); b.disabled = !!disabled;
      if (current) b.setAttribute("aria-current", "page");
      b.addEventListener("click", () => { st.page = page; renderList(true); });
      nav.appendChild(b);
    };
    btn("‹", S.prevPage, st.page - 1, st.page <= 1);
    for (const n of pageList(st.page, pages)) {
      if (n === "…") { const sp = document.createElement("span"); sp.textContent = "…"; sp.setAttribute("aria-hidden", "true"); nav.appendChild(sp); }
      else btn(String(n), t("pageN", { n }), n, false, n === st.page);
    }
    btn("›", S.nextPage, st.page + 1, st.page >= pages);
  }
  function select(key, from) {
    st.topic = key || ALL; st.page = 1;
    const node = st.topic && st.topic !== OTHER ? findTopic(st.tree, st.topic) : null;
    if (node) for (const n of topicTrail(node)) if (n.children.length) st.expanded.add(n.key);   // show the chosen category's sub-categories
    renderTree(from === "tree" ? st.topic : null, false);
    renderList(false);
  }
  async function start() {
    if (st.loaded) { renderTree(); renderList(false); return; }
    el("List").innerHTML = ""; el("Status").textContent = ""; el("Pager").hidden = true; el("SearchAllRow").hidden = true;
    el("Empty").textContent = S.loadingMaps; el("List").setAttribute("aria-busy", "true");
    try { await load(); }
    catch (e) { console.error(e); el("Empty").textContent = S.groupError; el("List").removeAttribute("aria-busy"); return; }
    el("List").removeAttribute("aria-busy");
    st.loaded = true;
    if (st.topic && st.topic !== OTHER && !findTopic(st.tree, st.topic)) st.topic = ALL;
    renderTree(); renderList(false);
  }
  el("Search").addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { st.page = 1; renderList(false); }, st.mode === "server" ? 350 : 150); });
  el("SearchAll").addEventListener("click", () => { select(ALL); el("Search").focus(); });
  el("Reset").addEventListener("click", () => { st.expanded.clear(); el("Search").value = ""; select(ALL); });
  el("CatsBtn").addEventListener("click", () => {
    const show = el("Body").classList.contains("side-hidden");
    el("Body").classList.toggle("side-hidden", !show); el("CatsBtn").setAttribute("aria-expanded", String(show));
  });
  if (window.matchMedia && window.matchMedia("(max-width: 760px)").matches) { el("Body").classList.add("side-hidden"); el("CatsBtn").setAttribute("aria-expanded", "false"); }
  return {
    start,
    forget() { st.ready = null; st.loaded = false; },
    refreshActions() { el("List").querySelectorAll(".cat-act").forEach((b) => o.decorate(b, b._item)); }
  };
}

// ---------- Open map
const openCollectionMap = (it) => openWebMapItem(it.id, { title: it.title });
const mapBrowser = createBrowser({ p: "om", query: 'type:"Web Map"', accept: () => true, kind: "maps", thumbOpens: true, descLabel: () => S.mapDescription,
  decorate(b, item) { b.textContent = S.openThisMap; b.setAttribute("aria-label", S.openThisMap + ": " + (item.title || "")); },
  run(item) { openCollectionMap(item); } });
function forgetBrowse() { mapBrowser.forget(); addBrowser.forget(); groupLoaded = false; }
const agolState = { start: 1, loading: false };
function mapCard(item, onOpen) {     // My ArcGIS maps
  const li = document.createElement("li"); li.className = "map-card";
  const th = document.createElement("div"); th.className = "card-thumb"; th.setAttribute("aria-hidden", "true");
  const tu = thumbUrl(item); if (tu) th.style.backgroundImage = "url('" + tu.replace(/'/g, "%27") + "')";
  th.addEventListener("click", () => onOpen(item));
  const body = document.createElement("div"); body.className = "card-body";
  const h = document.createElement("h4"); h.className = "card-title"; h.textContent = item.title || S.untitled;
  const sn = document.createElement("p"); sn.className = "card-snippet"; sn.textContent = item.snippet || "";
  const acts = document.createElement("div"); acts.className = "card-actions";
  const open = document.createElement("button"); open.type = "button"; open.className = "btn primary"; open.textContent = S.openThisMap;
  open.setAttribute("aria-label", S.openThisMap + ": " + (item.title || ""));
  open.addEventListener("click", () => onOpen(item));
  acts.append(open);
  body.append(h, sn, acts); li.append(th, body);
  return li;
}
async function loadAgolMaps(reset) {
  if (!portalUser || agolState.loading) return;
  agolState.loading = true;
  if (reset) { agolState.start = 1; $("agolGrid").innerHTML = ""; }
  $("agolStatus2").textContent = S.loadingMaps;
  const text = cleanQuery($("agolSearch").value);
  try {
    const d = await restGet("/sharing/rest/search", { num: 24, start: agolState.start, sortField: "modified", sortOrder: "desc",
      q: 'owner:"' + portalUser.username + '" AND type:"Web Map"' + (text ? " AND (" + text + ")" : "") });
    for (const item of d.results || []) $("agolGrid").appendChild(mapCard(item, (it) => openWebMapItem(it.id, { title: it.title })));
    agolState.start = d.nextStart;
    $("agolMoreRow").hidden = !(d.nextStart > 0);
    $("agolStatus2").textContent = $("agolGrid").children.length ? "" : (text ? S.noMatch : S.noMaps);
  } catch (e) { console.error(e); $("agolStatus2").textContent = S.groupError; }
  agolState.loading = false;
}
let groupLoaded = false;
function setupTabs(tabs, onSwitch) {
  const sw = (tabId) => { for (const [tb, pane] of tabs) { const on = tb === tabId; $(tb).setAttribute("aria-selected", String(on)); $(tb).tabIndex = on ? 0 : -1; $(pane).hidden = !on; } onSwitch(tabId); };
  tabs.forEach(([tb]) => $(tb).addEventListener("click", () => sw(tb)));
  $(tabs[0][0]).parentElement.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const vis = tabs.map((x) => x[0]).filter((id) => !$(id).hidden);
    const i = vis.indexOf(document.activeElement && document.activeElement.id);
    if (i < 0) return;
    const next = vis[(i + (e.key === "ArrowRight" ? 1 : vis.length - 1)) % vis.length];
    $(next).focus(); sw(next);
  });
  return sw;
}
const switchTab = setupTabs([["tabGroup", "paneGroup"], ["tabDevice", "paneDevice"], ["tabArcgis", "paneArcgis"]], (tabId) => {
  if (tabId === "tabGroup") { mapBrowser.start(); groupLoaded = true; }
  if (tabId === "tabArcgis") loadAgolMaps(true);
});
function openOpenModal(tabId) { openModal("openModal"); switchTab(tabId || "tabGroup"); }
$("tool-open").addEventListener("click", () => openOpenModal("tabGroup"));
$("agolSearch").addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => loadAgolMaps(true), 350); });
$("agolMore").addEventListener("click", () => loadAgolMaps(false));
$("browseDevice").addEventListener("click", openFromDevice);
$("newMapBtn").addEventListener("click", newBlankMap);

// ---------- Add layer
let catalogLoaded = false;
const addBrowser = createBrowser({ p: "al", query: '-type:"Web Map"', accept: (it) => !!SUPPORTED_TYPES[it.type], kind: "layers", thumbOpens: false, descLabel: () => S.layerDescription,
  decorate(b, item) {
    const on = portalLayers.has(item.id), label = on ? S.removeThisLayer : S.addThisLayer;
    b.innerHTML = (on ? ICON_MINUS : ICON_PLUS) + "<span></span>"; b.lastChild.textContent = label;
    b.classList.toggle("on", on); b.setAttribute("aria-label", label + ": " + (item.title || ""));
  },
  async run(item, b) {
    if (portalLayers.has(item.id)) removePortalLayer(item.id);
    else { b.disabled = true; await addPortalLayer({ itemId: item.id, type: item.type, title: item.title }); b.disabled = false; }
    refreshCatalogButtons(); b.focus();
  } });
function refreshCatalogButtons() { addBrowser.refreshActions(); }
const switchAddTab = setupTabs([["tabLayers", "paneLayers"], ["tabOwnData", "paneOwnData"]], (tabId) => { if (tabId === "tabLayers") { addBrowser.start(); catalogLoaded = true; } });
function openAddModal(tabId) { closePanels(false); openModal("addModal"); switchAddTab(tabId || "tabLayers"); }
$("tool-add").addEventListener("click", () => openAddModal("tabLayers"));

// ============================================================ Map and item information (ⓘ)
function safeFragment(html) {
  const src = new DOMParser().parseFromString(String(html || ""), "text/html").body;
  const frag = document.createDocumentFragment();
  const ALLOWED = new Set(["P", "BR", "STRONG", "B", "EM", "I", "U", "UL", "OL", "LI", "A", "SPAN", "DIV", "BLOCKQUOTE", "IMG", "SUB", "SUP", "FIGURE", "FIGCAPTION", "TABLE", "THEAD", "TBODY", "TR", "TD", "TH"]);
  const DROP = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "FORM", "INPUT", "BUTTON", "TEXTAREA", "SELECT", "SVG", "MATH", "LINK", "META"]);
  const copy = (node, into) => {
    for (const n of node.childNodes) {
      if (n.nodeType === 3) { into.appendChild(document.createTextNode(n.nodeValue)); continue; }
      if (n.nodeType !== 1 || DROP.has(n.tagName)) continue;
      let tag = n.tagName;
      if (/^H[1-6]$/.test(tag)) tag = "STRONG";
      if (!ALLOWED.has(tag) && tag !== "STRONG") { copy(n, into); continue; }
      const el = document.createElement(tag);
      if (tag === "A") { const href = n.getAttribute("href") || ""; if (/^https?:\/\//i.test(href)) { el.href = href; el.target = "_blank"; el.rel = "noopener noreferrer"; } }
      if (tag === "IMG") { const s = n.getAttribute("src") || ""; if (!/^https:\/\//i.test(s)) continue; el.src = s; el.alt = n.getAttribute("alt") || ""; el.loading = "lazy"; }
      copy(n, el);
      into.appendChild(el);
      if (n.tagName !== tag) into.appendChild(document.createElement("br"));
    }
  };
  copy(src, frag);
  return frag;
}
function fillInfo(item) {
  $("infoH").textContent = item ? item.title : currentTitle();
  const body = $("infoBody"); body.innerHTML = "";
  if (!item) {
    const p = document.createElement("p"); p.textContent = S.aboutLocal; body.appendChild(p);
    $("infoItemLink").hidden = true;
    return;
  }
  if (item.snippet) { const p = document.createElement("p"); const s = document.createElement("strong"); s.textContent = item.snippet; p.appendChild(s); body.appendChild(p); }
  if (item.description) body.appendChild(safeFragment(item.description));
  else if (!item.snippet) { const p = document.createElement("p"); p.textContent = S.noDescription; body.appendChild(p); }
  if (item.accessInformation) { const h = document.createElement("p"); const s = document.createElement("strong"); s.textContent = S.credits + ": "; h.appendChild(s); h.appendChild(document.createTextNode(item.accessInformation)); body.appendChild(h); }
  $("infoItemLink").href = `${PORTAL}/home/item.html?id=${item.id}`; $("infoItemLink").hidden = false;
}
async function showItemInfo(itemId) {
  try { const item = await restGet(`/sharing/rest/content/items/${itemId}`); fillInfo(item); openModal("infoModal"); }
  catch (e) { toast(S.openFailed); }
}
$("infoBtn").addEventListener("click", () => { fillInfo(currentSource ? currentSource.item : null); openModal("infoModal"); });

// ============================================================ CSV import (configure panel with live preview)
let addState = null, previewLayer = null, previewTimer = 0, prePreviewCam = null, pendingParse = null, dataLayerSeq = 0;
const STYLE_TEXT = { simple: ["styleSimple", "styleSimpleHint"], categorical: ["styleCategorical", "styleCategoricalHint"], graduated: ["styleGraduated", "styleGraduatedHint"],
  numeric_color_size: ["styleNumericColorSize", "styleNumericColorSizeHint"], categorical_size: ["styleCategoricalSize", "styleCategoricalSizeHint"], pie_chart: ["stylePie", "stylePieHint"] };
const FIELD_LABEL = { color: "colorBy", size: "sizeBy", label: "labelBy" };
const NONE = "__none__";
function showDataError(msg) {
  addState = null; removePreview(true);
  openPanel("data");
  $("dataH").textContent = S.addData;
  $("dataError").textContent = msg; $("dataError").hidden = false;
  $("llPicker").hidden = true; $("dataControls").hidden = true; $("dataSubmit").disabled = true;
}
function handleCsvText(name, text) {
  const parsed = readCsv(text, Number(cfg.csvMaxRows) || 1000);
  if (!parsed.ok) { showDataError(t(parsed.code, parsed.params)); return; }
  if (parsed.latIdx < 0 || parsed.lonIdx < 0) { showLatLonPicker(name, parsed); return; }
  continueCsv(name, parsed, parsed.latIdx, parsed.lonIdx);
}
function showLatLonPicker(name, parsed) {
  addState = null; removePreview(true);
  pendingParse = { name, parsed };
  openPanel("data");
  $("dataH").textContent = S.addData;
  $("dataError").hidden = true; $("dataControls").hidden = true; $("dataSubmit").disabled = true; $("llPicker").hidden = false;
  for (const [id, guess] of [["latSel", parsed.latIdx], ["lonSel", parsed.lonIdx]]) {
    const sel = $(id); sel.innerHTML = "";
    parsed.header.forEach((h, i) => { const o = document.createElement("option"); o.value = String(i); o.textContent = h; sel.appendChild(o); });
    sel.value = String(guess >= 0 ? guess : (id === "lonSel" && parsed.header.length > 1 ? 1 : 0));
  }
}
$("llUse").addEventListener("click", () => {
  if (!pendingParse) return;
  const la = parseInt($("latSel").value, 10), lo = parseInt($("lonSel").value, 10);
  if (la === lo) { toast(S.pickLatLon); return; }
  const p = pendingParse; pendingParse = null;
  continueCsv(p.name, p.parsed, la, lo);
});
function continueCsv(name, parsed, latIdx, lonIdx) {
  const data = buildLayerData(name, parsed, latIdx, lonIdx);
  if (!data.ok) { showDataError(t(data.code, data.params)); return; }
  addState = data;
  addState.symbolChoices = { shape: "esriSMSCircle", color: hexToRgb(PALETTE_HEX[0]), size: 12, ramp: "blue" };
  addState.style = pickAutoStyle(addState);
  addState.fieldChoices = pickAutoFields(addState.style, addState);
  removePreview(false);
  if (!prePreviewCam) { try { prePreviewCam = { center: [view.center.longitude, view.center.latitude], zoom: view.zoom }; } catch (e) { prePreviewCam = null; } }
  openPanel("data");
  renderDataPanel();
  updatePreview(true);
}
function renderDataPanel() {
  $("dataH").textContent = S.dataLooksGood;
  $("dataError").hidden = true; $("llPicker").hidden = true; $("dataControls").hidden = false; $("dataSubmit").disabled = false;
  let s = t("dataSummary", { n: addState.features.length, num: addState.numeric.length, cat: addState.categorical.length });
  if (addState.dropped) s += " " + t("dataSkipped", { n: addState.dropped });
  $("dataSummary").textContent = s;
  $("dataSize").value = addState.symbolChoices.size; $("dataSizeVal").textContent = addState.symbolChoices.size + " px";
  renderStyleList(); renderFieldRows(); renderSymbolBlocks();
}
function renderStyleList() {
  const wrap = $("styleList"); wrap.innerHTML = "";
  for (const style of DATA_STYLES) {
    const ok = styleAvailable(style, addState);
    const b = document.createElement("button"); b.type = "button"; b.className = "style-card"; b.disabled = !ok;
    b.setAttribute("aria-pressed", String(addState.style.id === style.id));
    b.title = ok ? S[STYLE_TEXT[style.id][1]] : S.styleNeeds;
    b.innerHTML = '<span class="s-ico" aria-hidden="true">' + style.icon + '</span><span class="s-name"></span>';
    b.querySelector(".s-name").textContent = S[STYLE_TEXT[style.id][0]];
    if (ok) b.addEventListener("click", () => { addState.style = style; addState.fieldChoices = pickAutoFields(style, addState); renderStyleList(); renderFieldRows(); renderSymbolBlocks(); });
    wrap.appendChild(b);
  }
  $("styleDesc").textContent = S[STYLE_TEXT[addState.style.id][0]] + " — " + S[STYLE_TEXT[addState.style.id][1]];
}
function fieldOptions(key) {
  if (key === "size") return addState.numeric;
  if (key === "color") return addState.style.id === "numeric_color_size" ? addState.numeric : addState.categorical;
  return addState.fields.filter((f) => f.type !== "esriFieldTypeOID" && !addState.coordNames.includes(f.name)).map((f) => f.name);
}
function renderFieldRows() {
  const wrap = $("fieldRows"); wrap.innerHTML = "";
  addState.style.fields.forEach((key, i) => {
    const id = "fld-" + key + "-" + i;
    const lbl = document.createElement("label"); lbl.className = "lbl"; lbl.htmlFor = id; lbl.textContent = S[FIELD_LABEL[key]];
    const sel = document.createElement("select"); sel.className = "field"; sel.id = id;
    if (key === "label") { const o = document.createElement("option"); o.value = NONE; o.textContent = S.none; sel.appendChild(o); }
    for (const name of fieldOptions(key)) { const o = document.createElement("option"); o.value = name; o.textContent = aliasOf(addState, name); sel.appendChild(o); }
    const cur = addState.fieldChoices[key];
    sel.value = cur == null ? (key === "label" ? NONE : sel.value) : cur;
    if (key !== "label" && cur == null && sel.options.length) addState.fieldChoices[key] = sel.value;
    sel.addEventListener("change", () => { addState.fieldChoices[key] = sel.value === NONE ? null : sel.value; renderSymbolBlocks(); });
    wrap.append(lbl, sel);
  });
}
function renderSymbolBlocks() {
  const c = addState.symbolChoices, isPie = addState.style.id === "pie_chart";
  const single = addState.style.id === "simple" || addState.style.id === "graduated";
  const ramp = !isPie && addState.style.fields.includes("color") && !!addState.fieldChoices.color && addState.numeric.includes(addState.fieldChoices.color);
  $("shapeRow").hidden = isPie; $("colorRow").hidden = isPie || !single; $("rampRow").hidden = !ramp;
  const sw = $("shapeOptions"); sw.innerHTML = "";
  for (const s of SHAPES) {
    const b = document.createElement("button"); b.type = "button"; b.className = "shape-btn"; b.textContent = s.glyph;
    b.setAttribute("aria-label", s.id.replace("esriSMS", "")); b.setAttribute("aria-pressed", String(c.shape === s.id));
    b.addEventListener("click", () => { c.shape = s.id; renderSymbolBlocks(); }); sw.appendChild(b);
  }
  const cw = $("dataSwatches"); cw.innerHTML = "";
  PALETTE_HEX.forEach((hex, i) => {
    const rgb = hexToRgb(hex);
    const b = document.createElement("button"); b.type = "button"; b.className = "swatch"; b.style.background = hex;
    b.setAttribute("aria-label", (COLOUR_NAMES[i] || hex).trim()); b.setAttribute("aria-pressed", String(c.color.join(",") === rgb.join(",")));
    b.addEventListener("click", () => { c.color = rgb; renderSymbolBlocks(); }); cw.appendChild(b);
  });
  const rl = $("rampList"); rl.innerHTML = "";
  if (ramp) for (const r of COLOR_RAMPS) {
    const b = document.createElement("button"); b.type = "button"; b.className = "ramp-btn"; b.setAttribute("aria-label", r.name); b.title = r.name;
    b.setAttribute("aria-pressed", String(c.ramp === r.id));
    b.style.background = "linear-gradient(90deg," + r.colors.map((col) => "rgb(" + col.join(",") + ")").join(",") + ")";
    b.addEventListener("click", () => { c.ramp = r.id; renderSymbolBlocks(); }); rl.appendChild(b);
  }
  updateConfigSummary();
  updatePreview(false);
}
function updateConfigSummary() {
  const c = addState.fieldChoices, A = (n) => (n ? aliasOf(addState, n) : "—");
  const numColor = c.color && addState.numeric.includes(c.color);
  let s;
  switch (addState.style.id) {
    case "pie_chart": s = t("sumPie", { n: Math.min(8, addState.numeric.length) }); break;
    case "numeric_color_size": s = t("sumColorSize", { color: A(c.color), size: A(c.size) }); break;
    case "categorical_size": s = t(numColor ? "sumColorSize" : "sumTypeSize", { color: A(c.color), size: A(c.size) }); break;
    case "categorical": s = t(numColor ? "sumShade" : "sumType", { color: A(c.color) }); break;
    case "graduated": s = t("sumSize", { size: A(c.size) }); break;
    default: s = S.sumSimple;
  }
  if (c.label) s += t("sumLabels", { label: A(c.label) });
  $("cfgSummary").textContent = s;
}
function removePreview(restoreCam) {
  clearTimeout(previewTimer); previewTimer = 0;
  if (previewLayer) { removeFromMaps(previewLayer); previewLayer = null; }
  if (restoreCam && prePreviewCam) goToSafe({ center: prePreviewCam.center, zoom: prePreviewCam.zoom }, { animate: false });
  if (restoreCam) prePreviewCam = null;
}
function updatePreview(frame) {
  if (!addState) return;
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    previewTimer = 0;
    if (!addState) return;
    if (previewLayer) { removeFromMaps(previewLayer); previewLayer = null; }
    let fl;
    try { fl = buildDataLayer(buildLayerDef(addState, "csvPreview")); } catch (e) { console.error(e); return; }
    previewLayer = fl; activeMap().add(fl); keepSketchOnTop();
    if (frame) fl.when().then(() => fl.queryExtent()).then((r) => { if (r && r.extent) goToSafe(r.extent.expand(1.2), { animate: false }); }).catch(() => {});
  }, frame ? 0 : 200);
}
function submitData() {
  if (!addState) { closePanels(); return; }
  const def = buildLayerDef(addState, "csv" + Date.now().toString(36) + (++dataLayerSeq));
  const n = addState.features.length;
  removePreview(false); prePreviewCam = null;
  let fl;
  try { fl = addDataLayer(def); } catch (e) { console.error(e); toast(S.layerFailed.replace("{title}", def.title)); return; }
  addState = null;
  closePanels();
  fl.when().then(() => fl.queryExtent()).then((r) => { if (r && r.extent) goToSafe(r.extent.expand(1.2), { animate: false }); }).catch(() => {});
  toast(t("addedPoints", { n }));
}
$("dataSubmit").addEventListener("click", submitData);
$("dataCancel").addEventListener("click", () => closePanels());
$("dataClose").addEventListener("click", () => closePanels());
$("dataSize").addEventListener("input", () => {
  const v = parseInt($("dataSize").value, 10) || 12;
  $("dataSizeVal").textContent = v + " px";
  if (addState) { addState.symbolChoices.size = v; updateConfigSummary(); updatePreview(false); }
});
function pickCsv() {
  const input = document.createElement("input"); input.type = "file"; input.accept = ".csv,text/csv,.txt";
  input.addEventListener("change", () => { const f = input.files && input.files[0]; if (f) { closeModal("addModal"); handleDroppedFile(f); } });
  input.click();
}
$("csvPick").addEventListener("click", pickCsv);

// ============================================================ Drag and drop
const dtHasFiles = (e) => !!(e.dataTransfer && e.dataTransfer.types && [...e.dataTransfer.types].includes("Files"));
let dropDepth = 0;
window.addEventListener("dragover", (e) => { if (dtHasFiles(e)) e.preventDefault(); });
window.addEventListener("dragenter", (e) => { if (!dtHasFiles(e)) return; dropDepth++; $("dropOverlay").hidden = false; });
window.addEventListener("dragleave", (e) => { if (!dtHasFiles(e)) return; dropDepth = Math.max(0, dropDepth - 1); if (!dropDepth) $("dropOverlay").hidden = true; });
window.addEventListener("drop", (e) => {
  if (!dtHasFiles(e)) return;
  e.preventDefault(); dropDepth = 0; $("dropOverlay").hidden = true;
  const f = e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) handleDroppedFile(f);
});
function readText(file) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsText(file); }); }
async function handleDroppedFile(f) {
  const name = f.name || "";
  if (/\.(mmap|json)$/i.test(name)) {
    if (F.localSave === false) return;
    if (!confirmDiscard()) return;
    try { const txt = await readText(f); if (await openDocText(txt, name)) { currentFileHandle = null; openedHandleUnsaved = false; } } catch (e) { toast(S.cantRead); }
    return;
  }
  if ((/\.(csv|txt)$/i.test(name) || f.type === "text/csv") && F.csv !== false) {
    try { handleCsvText(name, await readText(f)); } catch (e) { toast(S.cantRead); }
    return;
  }
  toast(S.dropWhat, 5000);
}

// ============================================================ Local save and open (.mmap)
function currentViewpoint() { return { center: [view.center.longitude, view.center.latitude], zoom: view.zoom }; }
function buildDocument() {
  const doc = {
    type: DOC_TYPE, version: DOC_VERSION, app: cfg.appName, appVersion: APP_VERSION, title: currentTitle(), savedAt: new Date().toISOString(),
    basemap: basemapRef(), mode, viewpoint: currentViewpoint(),
    camera: mode === "3d" && sceneView ? sceneView.camera.toJSON() : null,
    webmap: currentSource ? { itemId: currentSource.itemId, title: currentSource.title } : null,
    layerStates: currentSource ? sourceLayers().map((l) => ({ id: l.id, title: l.title, visible: l.visible !== false, opacity: l.opacity })) : [],
    portalLayers: [...portalLayers.values()].map((l) => ({ ...l.__item, visible: l.visible !== false, opacity: l.opacity })),
    sketchVisible: graphicsLayer.visible !== false,
    graphics: graphicsLayer.graphics.toArray().map((g) => ({ geometry: g.geometry.toJSON(), attributes: { ...g.attributes } })),
    layers: dataLayers.map((fl) => ({ ...fl._srcDef, visible: fl.visible !== false, opacity: fl.opacity }))
  };
  if (bookmarks.length) doc.bookmarks = bookmarks.map((b) => ({ title: b.title, viewpoint: b.viewpoint, layers: b.layers || [], thumb: b.thumb || null }));
  return doc;
}
async function loadDocument(doc) {
  closePanels(false);
  resetWorkspace();
  let sourceOk = false;
  if (doc.webmap) {
    sourceOk = await openWebMapItem(doc.webmap.itemId, { keepWorkspace: true, quiet: true });
    if (!sourceOk) toast(S.sourceMissing, 5000);
  }
  if (!sourceOk) { setActiveMap(localMap); localMap.basemap = defaultBasemap(); }
  if (doc.basemap) { try { activeMap().basemap = basemapFrom(doc.basemap); } catch (e) { /* keep current */ } }
  if (sourceOk) for (const st of doc.layerStates || []) { const l = activeMap().layers.find((x) => x.id === st.id); if (l) { l.visible = st.visible; l.opacity = st.opacity; } }
  for (const p of doc.portalLayers || []) await addPortalLayer(p, { silent: true, visible: p.visible, opacity: p.opacity });
  for (const ld of doc.layers || []) { try { addDataLayer(ld, { silent: true }); } catch (e) { console.warn("Skipped a data layer", e); } }
  for (const gj of doc.graphics || []) { try { addSketchGraphic(gj); } catch (e) { console.warn("Skipped a sketch", e); } }
  graphicsLayer.visible = doc.sketchVisible !== false;
  keepSketchOnTop();
  bookmarks = doc.bookmarks || [];
  setTitle(doc.title);
  if (doc.mode === "3d" && F.threeD !== false) {
    await setMode("3d", { keepCamera: true });
    if (doc.camera) goToSafe(doc.camera, { animate: false }); else if (doc.viewpoint && doc.viewpoint.center) goToSafe(doc.viewpoint, { animate: false });
  } else {
    await setMode("2d");
    if (doc.viewpoint && doc.viewpoint.center) goToSafe({ center: doc.viewpoint.center, zoom: doc.viewpoint.zoom }, { animate: false });
    else if (doc.viewpoint && doc.viewpoint.extent) goToSafe(Extent.fromJSON(doc.viewpoint.extent), { animate: false });
  }
  if (!$("bookmarksPanel").hidden) showBmList();
  if (catalogLoaded) refreshCatalogButtons();
  markClean();
  const n = graphicsLayer.graphics.length + (doc.layers || []).reduce((a, l) => a + l.features.length, 0);
  toast(t("openedFile", { title: currentTitle(), n }));
}
async function openDocText(text, fileName) {
  let raw;
  try { raw = JSON.parse(text); } catch (e) { toast(S.cantRead); return false; }
  if (looksLikeWebMap(raw)) return openWebMapFile(raw, fileName);
  const res = sanitizeDoc(raw);          // a .mmap saved before version 1.2 of this app
  if (!res.ok) { toast(S[res.code] || S.cantRead, 5000); return false; }
  closeModal("openModal");
  await loadDocument(res.doc);
  if (res.skipped) setTimeout(() => toast(t("skippedOnOpen", { n: res.skipped }), 5000), 3500);
  return true;
}
function openFromDevice() {
  if (!confirmDiscard()) return;
  if (window.showOpenFilePicker) {
    window.showOpenFilePicker({ multiple: false, types: [{ description: S.mapFile, accept: { "application/json": [".mmap", ".json"] } }] })
      .then(async ([h]) => { const f = await h.getFile(); if (await openDocText(await f.text(), h.name || f.name)) { currentFileHandle = h; openedHandleUnsaved = true; } })
      .catch((err) => { if (err && err.name === "AbortError") return; pickViaInput(); });
  } else pickViaInput();
}
function pickViaInput() {
  const input = document.createElement("input"); input.type = "file"; input.accept = ".mmap,.json,application/json";
  input.addEventListener("change", async () => {
    const f = input.files && input.files[0];
    if (!f) return;
    try { if (await openDocText(await readText(f), f.name)) { currentFileHandle = null; openedHandleUnsaved = false; } } catch (e) { toast(S.cantRead); }
  });
  input.click();
}
function downloadBlob(blob, filename) { const u = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = u; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 1000); }
// The saved file is an ArcGIS web map (Web Map Specification): the same JSON that Save to ArcGIS Online stores.
let unsavedLayers = 0;
async function buildWebMapJson() {
  const doc = buildDocument();
  const ext = view.extent ? view.extent.clone() : null;
  const added = [...portalLayers.values()].map(layerToJson);
  unsavedLayers = added.filter((x) => !x).length;
  return docToWebMap(doc, { baseMap: await currentBaseMapJson(), sourceLayers: sourceLayersJson(), portalLayers: added.filter(Boolean),
    extent: ext ? ext.toJSON() : null, scale: mode === "2d" ? mapView.scale : null, rotation: mode === "2d" ? mapView.rotation || 0 : 0,
    appVersion: APP_VERSION, sketchTitle: S.sketchLayer, sketchVisible: graphicsLayer.visible !== false });
}
async function docBlob() { return new Blob([JSON.stringify(await buildWebMapJson())], { type: "application/json" }); }
function saveToDevice(forceNew) {
  if (!window.showSaveFilePicker) { openNameDialog(); return; }
  if (!forceNew && currentFileHandle && openedHandleUnsaved) {
    $("firstSaveText").textContent = t("firstSaveText", { name: currentFileHandle.name || "" });
    openModal("firstSaveModal", $("fsCopy"));
    return;
  }
  writeToHandle(forceNew);
}
async function writeToHandle(forceNew) {
  try {
    if (forceNew || !currentFileHandle) {
      currentFileHandle = await window.showSaveFilePicker({ suggestedName: titleSlug() + ".mmap", types: [{ description: S.mapFile, accept: { "application/json": [".mmap"] } }] });
    }
    if (!($("docTitle").value || "").trim()) setTitle(titleFromFileName(currentFileHandle.name));
    const blob = await docBlob();
    const w = await currentFileHandle.createWritable();
    await w.write(blob); await w.close();
    openedHandleUnsaved = false; markClean();
    toast(t("savedFile", { name: currentFileHandle.name || titleSlug() + ".mmap" }));
    if (unsavedLayers) setTimeout(() => toast(t("layersNotSaved", { n: unsavedLayers }), 5000), 3000);
  } catch (err) {
    if (err && err.name === "AbortError") return;
    if (err && (err.name === "NotAllowedError" || err.name === "NoModificationAllowedError") && !forceNew) { toast(S.readOnlyFile, 5000); currentFileHandle = null; return writeToHandle(true); }
    console.error(err);
    currentFileHandle = null;
    openNameDialog();
  }
}
$("fsCopy").addEventListener("click", () => { closeModal("firstSaveModal"); writeToHandle(true); });
$("fsUpdate").addEventListener("click", () => { closeModal("firstSaveModal"); openedHandleUnsaved = false; writeToHandle(false); });
function openNameDialog() { $("fileNameInput").value = titleSlug(); openModal("nameModal", $("fileNameInput")); setTimeout(() => $("fileNameInput").select(), 0); }
async function confirmNameDialog() {
  const name = ($("fileNameInput").value || "map").replace(/[^\w\-]+/g, "_").slice(0, 60) || "map";
  closeModal("nameModal");
  if (!($("docTitle").value || "").trim()) setTitle(titleFromFileName(name));
  try { downloadBlob(await docBlob(), name + ".mmap"); markClean(); toast(t("savedDownload", { name: name + ".mmap" })); } catch (e) { console.error(e); toast(S.saveFailed); return; }
  if (unsavedLayers) setTimeout(() => toast(t("layersNotSaved", { n: unsavedLayers }), 5000), 3000);
}
$("nameConfirm").addEventListener("click", confirmNameDialog);
$("fileNameInput").addEventListener("keydown", (e) => { if (e.key === "Enter") confirmNameDialog(); });
$("saveTile").addEventListener("click", () => saveToDevice(false));
$("saveAsTile").addEventListener("click", () => saveToDevice(true));
$("openSavedLink").addEventListener("click", () => { closePanels(false); openOpenModal("tabDevice"); });
$("shotTile").addEventListener("click", () => {
  view.takeScreenshot({ format: "png" }).then((s) => { fetch(s.dataUrl).then((r) => r.blob()).then((b) => { downloadBlob(b, titleSlug() + ".png"); toast(S.shotSaved); }); })
    .catch(() => toast(S.shotFailed));
});

// ============================================================ Print (in the browser; nothing is sent to a print service)
$("printTile").addEventListener("click", async () => {
  try {
    const w = 1600, h = Math.round(1600 * Math.max(0.4, Math.min(1.2, view.height / Math.max(1, view.width))));
    const shot = await view.takeScreenshot({ width: w, height: h, format: "png" });
    const sheet = $("printSheet"); sheet.innerHTML = "";
    const h1 = document.createElement("h1"); h1.textContent = currentTitle();
    const img = document.createElement("img"); img.src = shot.dataUrl; img.alt = currentTitle();
    const meta = document.createElement("div"); meta.className = "meta";
    const shown = []; eachToggleableLayer((l, id, title) => { if (l.visible !== false && (l !== graphicsLayer || graphicsLayer.graphics.length)) shown.push(title); });
    const credits = [...document.querySelectorAll(".esri-attribution__sources")].map((e) => e.textContent.trim()).filter(Boolean)[0] || "";
    const lines = [S.printLayers + ": " + (shown.join(", ") || "—"), credits ? S.printCredits + ": " + credits : "",
      cfg.disclaimer || "", cfg.appName + " · " + new Date().toLocaleDateString(cfg.locale || undefined) + " · Created by Jason Sawle"];
    for (const line of lines.filter(Boolean)) { const p = document.createElement("p"); p.style.margin = "0 0 3pt"; p.textContent = line; meta.appendChild(p); }
    sheet.append(h1, img, meta);
    await new Promise((res) => { if (img.complete) res(); else { img.onload = res; img.onerror = res; } });
    window.print();
  } catch (e) { console.error(e); toast(S.shotFailed); }
});

// ============================================================ ArcGIS Online: sign in, save, update
const SIGN = cfg.signIn || {};
const signInConfigured = F.signIn !== false && /^[A-Za-z0-9_-]{8,}$/.test(SIGN.clientId || "");
let oauthInfo = null;
if (signInConfigured) {
  oauthInfo = new OAuthInfo({ appId: SIGN.clientId, portalUrl: PORTAL, popup: SIGN.popup !== false });
  IdentityManager.registerOAuthInfos([oauthInfo]);
  IdentityManager.checkSignInStatus(PORTAL + "/sharing").then(onSignedIn).catch(() => { /* not signed in */ });
}
async function onSignedIn() {
  try {
    const portal = new Portal({ url: PORTAL, authMode: "immediate" });
    await portal.load();
    portalUser = portal.user;
  } catch (e) { console.error("Portal load failed", e); portalUser = null; }
  if (portalUser && currentSource && currentSource.item && currentSource.item.owner === portalUser.username) currentAgolItem = { id: currentSource.itemId, owner: portalUser.username, title: currentSource.title };
  renderUser();
  return portalUser;
}
function renderUser() {
  const on = !!portalUser;
  $("signInBtn").hidden = on || F.signIn === false || SIGN.headerButton === false;
  $("userWrap").hidden = !on;
  forgetBrowse();
  $("tabArcgis").hidden = !on;
  if (on) {
    const name = portalUser.fullName || portalUser.username;
    $("userName").textContent = name;
    $("userBtn").setAttribute("aria-label", S.account + ": " + name);
    const av = $("avatar");
    const initials = name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
    av.textContent = initials;
    try { if (portalUser.thumbnailUrl) { av.style.backgroundImage = "url('" + portalUser.thumbnailUrl + "')"; av.textContent = ""; } } catch (e) { /* initials */ }
  }
  renderAgol();
}
function renderAgol() {
  const on = !!portalUser;
  $("agolSignedOut").hidden = on; $("agolSignedIn").hidden = !on;
  const canUpdate = on && currentAgolItem && currentAgolItem.owner === portalUser.username;
  $("agolUpdate").hidden = !canUpdate;
  if (canUpdate) $("agolUpdate").textContent = t("updateArcgis", { title: currentAgolItem.title });
}
function startSignIn() {
  if (!signInConfigured) {
    $("signInH").textContent = S.signIn;
    const b = $("signInBody"); b.innerHTML = "";
    for (const k of ["signInNotSet", "signInNotSetAdmin"]) { const p = document.createElement("p"); p.textContent = S[k]; b.appendChild(p); }
    $("signInGo").hidden = true;
    openModal("signInModal");
    return;
  }
  $("signInGo").hidden = false;
  if (SIGN.onboardingTitle || SIGN.onboardingHtml) {
    $("signInH").textContent = SIGN.onboardingTitle || S.signIn;
    const b = $("signInBody"); b.innerHTML = ""; b.appendChild(safeFragment(SIGN.onboardingHtml || ""));
    openModal("signInModal", $("signInGo"));
  } else doSignIn();
}
function stashBeforeRedirect() {
  const rec = { config: cfgName, t: Date.now() };
  if (dirty) { try { rec.doc = buildDocument(); } catch (e) { /* skip */ } }
  try { sessionStorage.setItem(AUTH_STASH, JSON.stringify(rec)); }
  catch (e) { try { delete rec.doc; sessionStorage.setItem(AUTH_STASH, JSON.stringify(rec)); } catch (e2) { /* no storage */ } }
  history.replaceState(history.state, "", location.pathname);   // a fixed redirect address (the config is restored after sign-in)
  dirty = false;                                                  // the work is stashed; don't block the redirect
}
function doSignIn() {
  closeModal("signInModal");
  if (oauthInfo.popup === false) stashBeforeRedirect();
  IdentityManager.getCredential(PORTAL + "/sharing", { oAuthPopupConfirmation: false })
    .then(onSignedIn)
    .then((u) => { if (u) toast(t("signedInAs", { name: u.fullName || u.username })); })
    .catch((err) => {
      if (!err) return;
      if (err.name === "identity-manager:popup-blocked") toast(S.popupBlocked, 7000);
      else if (err.name !== "identity-manager:user-aborted") toast(t("signInFailed", { msg: err.message || err.name }), 7000);
    });
}
$("signInBtn").addEventListener("click", startSignIn);
$("agolSignIn").addEventListener("click", startSignIn);
$("signInGo").addEventListener("click", doSignIn);
function closeUserMenu(focusBtn) { $("userMenu").hidden = true; $("userBtn").setAttribute("aria-expanded", "false"); if (focusBtn) $("userBtn").focus(); }
$("userBtn").addEventListener("click", () => {
  const open = $("userMenu").hidden;
  $("userMenu").hidden = !open; $("userBtn").setAttribute("aria-expanded", String(open));
  if (open) $("myMapsBtn").focus();
});
$("userMenu").addEventListener("keydown", (e) => {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  e.preventDefault();
  const items = [...$("userMenu").querySelectorAll("button")], i = items.indexOf(document.activeElement);
  items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length].focus();
});
document.addEventListener("click", (e) => { if (!$("userMenu").hidden && !$("userWrap").contains(e.target)) closeUserMenu(false); });
$("myMapsBtn").addEventListener("click", () => { closeUserMenu(false); openOpenModal("tabArcgis"); });
$("signOutBtn").addEventListener("click", () => {
  closeUserMenu(false);
  IdentityManager.destroyCredentials();
  portalUser = null; currentAgolItem = null;
  renderUser();
  if (!$("tabArcgis").hidden) switchTab("tabGroup");
  ($("signInBtn").hidden ? $("tool-save") : $("signInBtn")).focus();
  toast(S.signedOut);
});

const LAYER_TYPE_JSON = { feature: "ArcGISFeatureLayer", "map-image": "ArcGISMapServiceLayer", tile: "ArcGISTiledMapServiceLayer", "vector-tile": "VectorTileLayer",
  imagery: "ArcGISImageServiceLayer", "imagery-tile": "ArcGISTiledImageServiceLayer", csv: "CSV", geojson: "GeoJSON", kml: "KML", wms: "WMS", wfs: "WFS",
  "web-tile": "WebTiledLayer", "geo-rss": "GeoRSS", stream: "ArcGISStreamLayer", "ogc-feature": "OGCFeatureLayer" };
// Operational layer JSON for a layer added from the collection. A layer that came from a saved map keeps its saved JSON.
function layerToJson(l) {
  const visibility = l.visible !== false, opacity = typeof l.opacity === "number" ? l.opacity : 1;
  if (l.__opJson) return { ...l.__opJson, id: l.id, title: l.title || l.__opJson.title, visibility, opacity };
  const base = { id: l.id, title: l.title, visibility, opacity };
  if (l.type === "group") { const layers = l.layers.toArray().map(layerToJson).filter(Boolean); return layers.length ? { ...base, layerType: "GroupLayer", layers } : null; }
  const layerType = LAYER_TYPE_JSON[l.type];
  if (!layerType) { console.warn("Can't save a layer of type", l.type, l.title); return null; }
  const out = { ...base, layerType };
  if (l.portalItem && l.portalItem.id) out.itemId = l.portalItem.id;
  if (l.type === "feature") { if (l.url) out.url = l.layerId != null ? l.url + "/" + l.layerId : l.url; }
  else if (l.type === "vector-tile") { if (l.url) out.styleUrl = /\.json(\?|$)/i.test(l.url) ? l.url : l.url.replace(/\/?$/, "/resources/styles/root.json"); }
  else if (l.type === "web-tile") { if (l.urlTemplate) out.templateUrl = l.urlTemplate; }
  else if (l.url) out.url = l.url;
  return out.url || out.styleUrl || out.templateUrl || out.itemId ? out : null;
}
async function currentBaseMapJson() {
  const b = activeMap().basemap;
  const id = b && b.portalItem && b.portalItem.id;
  if (id) { try { const d = await restGet(`/sharing/rest/content/items/${id}/data`); if (d && d.baseMap) return d.baseMap; } catch (e) { /* fall through */ } }
  if (currentSource && currentSource.data && currentSource.data.baseMap && !id) return currentSource.data.baseMap;
  try { const j = b.toJSON(); if (j && j.baseMapLayers && j.baseMapLayers.length) return j; } catch (e) { /* fall through */ }
  try { const d = await restGet(`/sharing/rest/content/items/${cfg.defaultBasemap}/data`); if (d && d.baseMap) return d.baseMap; } catch (e) { /* offline */ }
  return null;   // the file still opens: the app's default basemap is used
}
function sourceLayersJson() {
  if (!currentSource || !currentSource.data) return [];
  const live = activeMap().layers;
  return (currentSource.data.operationalLayers || []).filter((op) => !isOwnLayerJson(op)).map((op) => {
    const l = live.find((x) => x.id === op.id);
    return l ? { ...op, visibility: l.visible !== false, opacity: l.opacity } : op;
  });
}
async function screenshotBlob(w, h) {
  try { const s = await view.takeScreenshot({ width: w, height: h, format: "png" }); return await (await fetch(s.dataUrl)).blob(); } catch (e) { return null; }
}
function agolStatus(html) { $("agolStatus").innerHTML = ""; if (html) $("agolStatus").appendChild(html); }
async function saveToArcGIS(update) {
  if (!portalUser) { startSignIn(); return; }
  const user = portalUser.username;
  const p = document.createElement("span"); p.textContent = S.arcgisSaving; agolStatus(p);
  try {
    const ext = view.extent.clone();
    const wmJson = await buildWebMapJson();
    const sw = xyToLonLat(ext.xmin, ext.ymin), ne = xyToLonLat(ext.xmax, ext.ymax);
    const form = new FormData();
    form.append("f", "json");
    form.append("title", update ? currentAgolItem.title : ($("agolTitle").value.trim() || currentTitle()));
    if (!update) {
      form.append("type", "Web Map");
      form.append("typeKeywords", "ArcGIS Online,Explorer Web Map,Map,Online Map,Web Map," + AUTHORING_APP);
      form.append("tags", [...(cfg.agolTags || []), cfg.appName].filter(Boolean).join(","));
      if ($("agolSummary").value.trim()) form.append("snippet", $("agolSummary").value.trim().slice(0, 2048));
    }
    form.append("text", JSON.stringify(wmJson));
    form.append("extent", [sw[0], sw[1], ne[0], ne[1]].map((n) => n.toFixed(6)).join(","));
    const thumb = await screenshotBlob(600, 400);
    if (thumb) form.append("thumbnail", thumb, "thumbnail.png");
    const url = update ? `${PORTAL}/sharing/rest/content/users/${encodeURIComponent(currentAgolItem.owner)}/items/${currentAgolItem.id}/update`
      : `${PORTAL}/sharing/rest/content/users/${encodeURIComponent(user)}/addItem`;
    const r = await esriRequest(url, { method: "post", body: form, responseType: "json" });
    const d = r.data || {};
    if (d.error || d.success === false) throw new Error((d.error && d.error.message) || "error");
    const id = d.id || (currentAgolItem && currentAgolItem.id);
    currentAgolItem = { id, owner: user, title: update ? currentAgolItem.title : form.get("title") };
    renderAgol();
    const box = document.createElement("span");
    box.appendChild(document.createTextNode(S.arcgisSaved + " "));
    const a1 = document.createElement("a"); a1.href = `${PORTAL}/apps/mapviewer/index.html?webmap=${id}`; a1.target = "_blank"; a1.rel = "noopener"; a1.textContent = S.openMapViewer;
    const a2 = document.createElement("a"); a2.href = `${PORTAL}/home/item.html?id=${id}`; a2.target = "_blank"; a2.rel = "noopener"; a2.textContent = S.openItemPage;
    box.append(a1, document.createTextNode(" · "), a2);
    agolStatus(box);
    toast(S.arcgisSaved);
    if (unsavedLayers) setTimeout(() => toast(t("layersNotSaved", { n: unsavedLayers }), 5000), 3000);
  } catch (e) {
    console.error("Save to ArcGIS Online failed", e);
    const s = document.createElement("span"); s.textContent = t("arcgisFailed", { msg: e.message || e.name || "" }); agolStatus(s);
  }
}
$("agolSaveNew").addEventListener("click", () => { $("agolTitle").value = currentTitle(); $("agolSummary").value = ""; openModal("agolModal", $("agolTitle")); });
$("agolConfirm").addEventListener("click", () => { closeModal("agolModal"); saveToArcGIS(false); });
$("agolUpdate").addEventListener("click", () => saveToArcGIS(true));

// ============================================================ Versions
function renderVersions() {
  const rows = [
    [cfg.appName + " (app)", APP_VERSION, "White-label build of the MapMaker app: every MapMaker tool, local save, CSV data, ArcGIS Online sign-in. Created by Jason Sawle."],
    ["Collection browser (Open map, Add layer)", CATALOG_VERSION, "MapMaker's category tree from the group's categories, with counts, search within a category, cards with descriptions, and pages."],
    ["Elevation profile", PROFILE_VERSION, "Esri's Elevation Profile widget, opened from Measure: the ground's height along a drawn or sketched line, from Esri's world elevation."],
    ["Compass", COMPASS_VERSION, "MapMaker's compass rose: turns with the map in 2D and 3D; select it to face north."],
    ["Saved map (.mmap file and ArcGIS Online)", WEBMAP_WRITER_VERSION, "An ArcGIS web map (Web Map Specification " + WEBMAP_SPEC_VERSION + "): sketches, spreadsheet data, layers, basemap, view and bookmarks. The same JSON is stored in ArcGIS Online."],
    ["Older .mmap files (open only)", String(DOC_VERSION), "MapMakerLocalDocument versions 2 to 4, from earlier versions of this app, the local-save concept and Map Studio."],
    ["CSV import", CSV_VERSION, "Comma, semicolon or tab files, decimal commas, column choice; styles incl. pie charts (2D only); live preview."],
    ["Sketch", SKETCH_VERSION, "Points, lines, areas, circles and text, with pop-ups, images, colour, size and rotation; move, reshape and delete."],
    [S.configLabel, String(cfg.configVersion || 1), cfgName + ".json (schema " + CONFIG_SCHEMA + ")"],
    ["ArcGIS Maps SDK for JavaScript", SDK_VERSION, "Esri mapping library"]
  ];
  const tbl = $("versTable"); tbl.innerHTML = "";
  const head = document.createElement("tr");
  for (const h of [S.part, S.version, S.whatItIs]) { const th = document.createElement("th"); th.scope = "col"; th.textContent = h; head.appendChild(th); }
  tbl.appendChild(head);
  for (const r of rows) { const tr = document.createElement("tr"); for (const c of r) { const td = document.createElement("td"); td.textContent = c; tr.appendChild(td); } tbl.appendChild(tr); }
}

// ============================================================ Start-up
view.when(() => {
  updatePopupEnabled();
  watchBottom(0);
  if (configMissing) toast("Config “" + configMissing + "” wasn't found, so the default is shown.", 6000);
});
if (authStash) {
  if (cfgName !== "default") { const u = new URL(location.href); u.searchParams.set("config", cfgName); history.replaceState(history.state, "", u.pathname + u.search); }
  if (authStash.doc) { const res = sanitizeDoc(authStash.doc); if (res.ok) { await loadDocument(res.doc); markDirty(); } }
}
const deepLink = params.get("webmap");
if (deepLink && HEX32.test(deepLink) && !authStash) openWebMapItem(deepLink, { skipConfirm: true });
console.info(cfg.appName, "v" + APP_VERSION, "config", cfgName);
