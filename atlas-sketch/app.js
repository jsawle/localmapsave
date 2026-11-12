// Atlas: a white-label build of the MapMaker classroom map app.
// ArcGIS Maps SDK for JavaScript 5.2. Everything a distributor changes lives in config/<name>.json.
// Created by Jason Sawle.
import { CSV_VERSION, PALETTE_HEX, PALETTE_RGB, COLOR_RAMPS, DATA_STYLES, SHAPES, readCsv, buildLayerData, styleAvailable,
  pickAutoStyle, pickAutoFields, aliasOf, buildLayerDef, stateFromLayerDef, columnScale, pieFields, PIE_MIN, PIE_MAX } from "./lib/csv.js?v=5.0.0-beta.27";
import { DOC_TYPE, DOC_VERSION, WEBMAP_WRITER_VERSION, WEBMAP_SPEC_VERSION, AUTHORING_APP, ITEM_LAYER_PREFIX, DATA_LAYER_PREFIX, sanitizeDoc, docToWebMap,
  isOwnLayerJson, looksLikeWebMap, readWebMap, xyToLonLat, LOCK_PROP, isLockedText, SHAPE_NAME, ARROWS, TEXT_FONTS, textFont,
  WEBSCENE_SPEC_VERSION, TWO_D_ONLY_PROP, looksLikeWebScene, docToWebScene, readWebScene } from "./lib/doc.js?v=5.0.0-beta.27";
// Each ?v= is the app version, so a new release never runs beside a cached older module (tests/run.mjs checks they match).
import { UNITS_VERSION, resolveUnits } from "./lib/units.js?v=5.0.0-beta.27";
import { DEFAULT_STRINGS } from "./lib/strings.js?v=5.0.0-beta.27";
import { CONFIG_VERSION, mergeConfig, loadConfig, buildStrings } from "./lib/config.js?v=5.0.0-beta.27";
import { CATALOG_VERSION, MAX_INDEX, OTHER, ALL, buildTopicTree, findTopic, topicTrail, indexItems, countTopics,
  filterEntries, pageList } from "./lib/catalog.js?v=5.0.0-beta.27";
import { BASEMAPS_VERSION, groupSort, basemapItems, thumbnailUrl, selectedId, needsDataTitles, gridMove } from "./lib/basemaps.js?v=5.0.0-beta.27";
import { RECENT_VERSION, makeEntry, openRecentStore } from "./lib/recent.js?v=5.0.0-beta.27";
import { FILTER_VERSION, MAX_CONDITIONS, OPERATORS, DEFAULT_OPERATOR, fieldKind, needsValue, rangeTypeFor, conditionComplete, buildWhere, parseWhere,
  filterFields, isListOp } from "./lib/filter.js?v=5.0.0-beta.27";

const APP_VERSION = "5.0.0-beta.27";
const COMPASS_VERSION = "1.1";
const CHARTS_VERSION = "1.0";
const PROFILE_VERSION = "3.1";
const SKETCH_VERSION = "2.2";   // 1.1: rotation only for text. 2.0: the SDK's Sketch component (Map Viewer's tools) replaces the app's own. 2.1: freehand segments. 2.2: keyboard route to the drawing tools
const CONFIG_SCHEMA = 2;
const SDK_VERSION = "5.2";
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
  showAppName: true,       // false: no name in the header (the browser tab still uses appName)
  headerLinks: [],
  partnerLogos: [],
  theme: { brand: "#0b5c8e", brandInk: "", brandSoft: "", toolActive: "", toolActiveInk: "", header: "#ffffff", headerInk: "", headerLine: "#e1e1e1", pill: "#000000", pillInk: "", font: "" },
  portalUrl: "https://www.arcgis.com",
  contentGroup: "c3ac404ac811494ea6fa116abc0cf39b",   // "Schools Living Atlas – 5.0 test" (GIS 4 Schools), while 5.0 is a pilot (5.0.0-beta.27). The live MapMaker group is 36443e9570294a1f883b5d2c5abfe6b5: config/mapmaker-live.json
  basemapGroup: "406646c98d0f4c608a9438d40ce2df9e",
  defaultBasemap: "a82ff7ce1c3a493f9d82aa89f5a1ddcf",
  startView: { center: [0, 20], zoom: 2 },
  threeDTilt: 60,          // degrees the camera tilts when switching to 3D, so the change is obvious (0 = stay looking straight down)
  threeDQuality: "auto",   // how much work the 3D view does: "auto" (low on a weak device, else medium), "low", "medium" or "high"
  units: "auto",            // "auto": miles and feet on a device set to a US time zone, kilometres and metres elsewhere (lib/units.js); or "metric" / "imperial"
  unitsSwitch: true,        // the km / mi switch in Measure and Elevation; the choice is remembered on the device
  scalebar: "dual",
  disclaimer: "",
  signIn: { clientId: "", popup: true, headerButton: true, onboardingTitle: "", onboardingHtml: "" },
  agolTags: ["school map"],
  csvMaxRows: 1000,
  features: { openMap: true, addLayer: true, csv: true, layers: true, legend: true, basemaps: true, measure: true, sketch: true,
    bookmarks: true, threeD: true, save: true, localSave: true, screenshot: true, print: true, search: true, signIn: true, compass: true, elevationProfile: true, filter: true },
  strings: {}
};
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
const fetchJson = async (path) => { const r = await fetch(path, { cache: "no-cache" }); if (!r.ok) throw new Error(String(r.status)); return r.json(); };
const loaded = await loadConfig(cfgName, fetchJson);
cfgName = loaded.name;
const rawCfg = loaded.raw, cfgChain = loaded.chain, configMissing = loaded.missing, localeFile = loaded.localeFile, localeMissing = loaded.localeMissing;
if (configMissing) console.warn("Config not found:", configMissing);
const cfg = mergeConfig(DEFAULT_CONFIG, rawCfg);
for (const k of ["contentGroup", "basemapGroup", "defaultBasemap"]) if (!HEX32.test(cfg[k] || "")) { console.warn("Config " + k + " isn't a 32-character item or group ID; using the default."); cfg[k] = DEFAULT_CONFIG[k]; }
const F = cfg.features;
const S = buildStrings(DEFAULT_STRINGS, localeFile, cfg);
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
  const showName = cfg.showAppName !== false && (!wide || logo.showName);
  $("logoText").textContent = showName ? cfg.appName : "";
  $("logoText").hidden = !showName;
  link.hidden = !wide && !showName;   // nothing to show: no empty link
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
  $("signInTile").hidden = F.signIn === false;
  refreshTileTips();
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
// The map library comes from js.arcgis.com. A school network can block it or be slow to deliver it; without it nothing
// on the page works, so the page says so (with a Reload button) and doesn't leave a toolbar that does nothing.
const SDK_SLOW_MS = 20000;
function loadNote(text, failed) {
  const box = $("loadNote");
  if (!box) return;
  $("loadNoteText").textContent = text || "";
  $("loadNoteBtn").hidden = !failed;
  box.classList.toggle("failed", !!failed);
  box.hidden = !text;
  if (failed) { $("toolbar").inert = true; $("loadNoteBtn").focus(); }
}
$("loadNoteBtn").addEventListener("click", () => location.reload());
async function loadSdk(paths) {
  const slow = setTimeout(() => loadNote(S.sdkSlow, false), SDK_SLOW_MS);
  try {
    if (typeof $arcgis === "undefined" || !$arcgis.import) throw new Error("The ArcGIS Maps SDK script didn't load");
    const mods = await $arcgis.import(paths);
    clearTimeout(slow); loadNote("", false);
    return mods;
  } catch (e) {
    clearTimeout(slow); loadNote(S.sdkFailed, true);
    throw e;
  }
}
const [EsriMap, WebMap, WebScene, Camera, GraphicsLayer, FeatureLayer, Graphic, Basemap, Layer,
  Field, LabelClass, rendererJsonUtils, Extent, esriConfig, intl, IdentityManager, OAuthInfo, Portal, esriRequest, reactiveUtils,
  SimpleMarkerSymbol, SimpleLineSymbol, SimpleFillSymbol, TextSymbol] = await loadSdk([
  "@arcgis/core/Map.js", "@arcgis/core/WebMap.js", "@arcgis/core/WebScene.js", "@arcgis/core/Camera.js",
  "@arcgis/core/layers/GraphicsLayer.js", "@arcgis/core/layers/FeatureLayer.js", "@arcgis/core/Graphic.js",
  "@arcgis/core/Basemap.js", "@arcgis/core/layers/Layer.js",
  "@arcgis/core/layers/support/Field.js", "@arcgis/core/layers/support/LabelClass.js", "@arcgis/core/renderers/support/jsonUtils.js",
  "@arcgis/core/geometry/Extent.js", "@arcgis/core/config.js", "@arcgis/core/intl.js", "@arcgis/core/identity/IdentityManager.js",
  "@arcgis/core/identity/OAuthInfo.js", "@arcgis/core/portal/Portal.js", "@arcgis/core/request.js", "@arcgis/core/core/reactiveUtils.js",
  "@arcgis/core/symbols/SimpleMarkerSymbol.js", "@arcgis/core/symbols/SimpleLineSymbol.js", "@arcgis/core/symbols/SimpleFillSymbol.js", "@arcgis/core/symbols/TextSymbol.js"
]);
// The SDK code for a tool is downloaded when the tool is first opened, not when the app starts (5.0.0-beta.4): on a slow
// connection the map is there sooner, and a class that never measures never downloads Measure.
let ElevationLayer, densifyOperator, WebStyleSymbol, cimSymbolUtils;
const TOOL_CODE = {
  profile: [["@arcgis/core/layers/ElevationLayer.js", (m) => { ElevationLayer = m; }]],
  curves: [["@arcgis/core/geometry/operators/densifyOperator.js", (m) => { densifyOperator = m; }]],
  symbols: [["@arcgis/core/symbols/WebStyleSymbol.js", (m) => { WebStyleSymbol = m; }], ["@arcgis/core/symbols/support/cimSymbolUtils.js", (m) => { cimSymbolUtils = m; }]]
};
const toolCode = {};
function need(tool) {
  if (!toolCode[tool]) {
    toolCode[tool] = $arcgis.import(TOOL_CODE[tool].map((x) => x[0])).then((mods) => { TOOL_CODE[tool].forEach((x, i) => x[1](mods[i])); })
      .catch((e) => { toolCode[tool] = null; console.error("Couldn't load the " + tool + " tool", e); toast(S.sdkFailed, 6000); throw e; });
  }
  return toolCode[tool];
}
// Legend, Measure, Coordinates, Swipe and the table are the SDK's components (5.0.0-beta.13; before, its widgets, which
// SDK 6 removes). A component's code is downloaded by the SDK when its element is first made, so these are still
// fetched only when the tool is first used. Settings go on once the component is ready (set earlier, some are lost).
async function toolEl(tag, host, props) {
  const el = document.createElement(tag);
  if (host) host.appendChild(el);
  let timer = 0;
  try {
    await Promise.race([customElements.whenDefined(tag), new Promise((_, no) => { timer = setTimeout(() => no(new Error(tag + " did not load")), 45000); })]);
    if (el.componentOnReady) await el.componentOnReady();
  } catch (e) { el.remove(); console.error("Couldn't load " + tag, e); toast(S.sdkFailed, 6000); throw e; }
  finally { clearTimeout(timer); }
  Object.assign(el, props || {});
  return el;
}
function dropEl(el) { if (!el) return; try { if (el.destroy) el.destroy(); } catch (e) { /* gone */ } try { el.remove(); } catch (e) { /* gone */ } }
esriConfig.portalUrl = PORTAL;
try { if (cfg.locale && cfg.locale !== "en") intl.setLocale(cfg.locale); } catch (e) { console.warn("Locale not supported", e); }

async function restGetUrl(url) { const r = await esriRequest(url, { query: { f: "json" }, responseType: "json" }); if (r.data && r.data.error) throw new Error(r.data.error.message || "Request failed"); return r.data; }
async function restGet(path, query) {
  const r = await esriRequest(PORTAL + path, { query: { f: "json", ...(query || {}) }, responseType: "json" });
  if (r.data && r.data.error) throw new Error(r.data.error.message || "Request failed");
  return r.data;
}

// ============================================================ Map, views and widgets
const graphicsLayer = new GraphicsLayer({ id: "__sketch", title: S.sketchLayer, elevationInfo: { mode: "on-the-ground" }, listMode: "hide" });
const defaultBasemap = () => new Basemap({ portalItem: { id: cfg.defaultBasemap } });
// A link that opens a map or scene starts without the default basemap: that map brings its own, and the default one
// (its item, style and first tiles) would be downloaded only to be replaced (5.0.0-beta.9). It is put in if the open fails.
const linkedScene = !authStash && F.threeD !== false && HEX32.test(params.get("webscene") || "") ? params.get("webscene") : null;
const linkedMap = !authStash && !linkedScene && HEX32.test(params.get("webmap") || "") ? params.get("webmap") : null;
const localMap = new EsriMap({ basemap: linkedScene || linkedMap ? null : defaultBasemap(), ground: "world-elevation", layers: [graphicsLayer] });
// The linked map starts downloading now, while the view and the rest of the app are still being set up.
let preloaded = null;
if (linkedScene || linkedMap) {
  const m = linkedScene ? new WebScene({ portalItem: { id: linkedScene } }) : new WebMap({ portalItem: { id: linkedMap } });
  preloaded = { id: linkedScene || linkedMap, map: m }; m.load().catch(() => {});
}
function takePreloaded(itemId, Type) { const p = preloaded; preloaded = null; return p && p.id === itemId && p.map instanceof Type && p.map.loadStatus !== "failed" ? p.map : new Type({ portalItem: { id: itemId } }); }
const startCenter = Array.isArray(cfg.startView.center) ? cfg.startView.center : [0, 20];
// The views are made by the SDK's map and scene components (arcgis-map, arcgis-scene), the supported way from SDK 5 on;
// the rest of the app works with the MapView / SceneView each one holds (5.0.0-beta.9).
async function componentView(tag, hostId, props) {
  const el = document.createElement(tag); el.className = "view-el";
  Object.assign(el, props);
  $(hostId).appendChild(el);
  await customElements.whenDefined(tag);
  await el.viewOnReady();
  viewEls.set(el.view, el);
  roundMeasurements(el);
  return el.view;
}
// Measurements with no decimal places (5.0.0-beta.8). The Sketch tools show lengths and areas to two decimal places
// ("1,199.31 km") in their tooltips and segment labels, and the SDK has no setting for that: its value options choose
// units only. Those texts are ordinary page text inside the view component, so they are rounded there, as they are
// written: "1,199 km". Coordinates and angles are left alone. sketchDecimals in a config gives another number of
// places, or null to leave the SDK's own.
const MEASURE_PLACES = cfg.sketchDecimals === null ? null : Number.isInteger(cfg.sketchDecimals) && cfg.sketchDecimals >= 0 && cfg.sketchDecimals <= 6 ? cfg.sketchDecimals : 0;
function roundMeasurements(el) {
  if (MEASURE_PLACES === null || !el.shadowRoot || typeof MutationObserver === "undefined") return;
  let locale; try { locale = intl.getLocale(); } catch (e) { locale = undefined; }
  let parts; try { parts = new Intl.NumberFormat(locale).formatToParts(12345.6); } catch (e) { locale = undefined; parts = new Intl.NumberFormat().formatToParts(12345.6); }
  const group = (parts.find((p) => p.type === "group") || {}).value || ",", decimal = (parts.find((p) => p.type === "decimal") || {}).value || ".";
  const esc = (c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const UNIT = "(?:km²|mi²|m²|ft²|yd²|km2|mi2|m2|ft2|ha|ac|km|nmi|mi|yd|ft|cm|mm|in|m)";
  const re = new RegExp("(\\d[\\d" + esc(group) + "\\u00a0\\u202f]*)" + esc(decimal) + "(\\d+)(\\s?" + UNIT + ")(?![\\w²])", "g");
  const out = new Intl.NumberFormat(locale, { maximumFractionDigits: MEASURE_PLACES, minimumFractionDigits: 0 });
  const fix = (node) => {
    const text = node.nodeValue; if (!text || text.length > 80 || !/\d/.test(text)) return;
    const next = text.replace(re, (m, whole, frac, unit) => { if (frac.length <= MEASURE_PLACES) return m; const n = Number(whole.replace(/\D/g, "") + "." + frac); return Number.isFinite(n) ? out.format(n) + unit : m; });
    if (next !== text) node.nodeValue = next;
  };
  const sweep = (root) => {
    if (root.nodeType === 3) { fix(root); return; }
    if (root.nodeType !== 1 && root.nodeType !== 11) return;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) fix(n);
  };
  new MutationObserver((list) => { for (const m of list) { if (m.type === "characterData") fix(m.target); else for (const n of m.addedNodes) sweep(n); } })
    .observe(el.shadowRoot, { subtree: true, childList: true, characterData: true });
}
// A view's map is set on its component, which owns the view: set on the view alone, the component can put its own back.
const viewEls = new Map();
function setViewMap(v, m) { const el = viewEls.get(v); if (el) el.map = m; if (v.map !== m) v.map = m; try { portalUnits(); } catch (e) { /* at start-up, before the units are worked out */ } }
const mapView = await componentView("arcgis-map", "viewDiv", { map: localMap, center: startCenter, zoom: Number(cfg.startView.zoom) || 2 });
let view = mapView, sceneView = null, mode = "2d";
const viewHandlers = [];
function onViews(evt, fn) { viewHandlers.push([evt, fn]); mapView.on(evt, fn); if (sceneView) sceneView.on(evt, fn); }
function activeMap() { return view.map; }
let startDone = null;
const started = new Promise((res) => { startDone = res; });   // the app has started, and a map opened from a link is in
function addViewUI(v, is3d) {
  // The controls on the view are SDK components placed in the map / scene component's slots (5.0.0-beta.2; they were
  // widgets added to view.ui, which SDK 6 removes). The 3D compass is left out: the rose replaces it.
  const el = viewEls.get(v);
  const slot = (tag, where, attrs) => { const c = document.createElement(tag); c.slot = where; for (const k in (attrs || {})) c.setAttribute(k, attrs[k]); el.appendChild(c); return c; };
  if (F.search !== false) { const ex = slot("arcgis-expand", "top-left", { "expand-icon": "search", "expand-tooltip": S.search, group: "top-left" }); ex.appendChild(document.createElement("arcgis-search")); }
  // Home remembers where the view was when it was made, so it is made once the view is somewhere: a map opened from
  // a link starts with no basemap, and nowhere yet (Home made then threw an error inside the SDK).
  const zoom = slot("arcgis-zoom", "top-left");
  const home = document.createElement("arcgis-home"); home.slot = "top-left";
  started.then(() => reactiveUtils.whenOnce(() => v.ready && !!v.viewpoint && !!v.viewpoint.targetGeometry)).then(() => el.insertBefore(home, zoom)).catch(() => {});
  if (is3d) slot("arcgis-navigation-toggle", "top-left");
  const stack = document.createElement("div"); stack.className = "ll-stack";
  if (F.compass !== false) stack.appendChild(makeCompass(v, is3d));
  if (!is3d && cfg.scalebar !== "none") {
    const sb = document.createElement("arcgis-scale-bar"); sb.unit = ["dual", "metric", "imperial"].includes(cfg.scalebar) ? cfg.scalebar : "dual";
    sb.referenceElement = el; stack.appendChild(sb);
  }
  // While Elevation profile is docked under the map the toolbar is tucked away; this button brings it back.
  const tt = document.createElement("button"); tt.type = "button"; tt.className = "tools-toggle"; tt.setAttribute("aria-controls", "toolbar");
  tt.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><circle cx="5" cy="5" r="2"/><circle cx="12" cy="5" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="12" cy="19" r="2"/><circle cx="19" cy="19" r="2"/></svg>';
  tt.addEventListener("click", () => { $("app").classList.toggle("tools-shown"); syncToolsToggles(); layoutBottom(); });
  stack.appendChild(tt);
  stack.slot = "bottom-left"; el.appendChild(stack);
  // Map layers greys a layer outside its scale range: check again whenever this view stops moving
  reactiveUtils.watch(() => v.stationary, (st) => { if (st && v === view && !$("layersPanel").hidden) updateScaleStates(); });
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
  // The rose is a picture with a button over it: its N, E, S, W letters are part of the picture, not the button's
  // name, which says which way the map is turned (WCAG 2.5.3 Label in Name; compass 1.1).
  const wrap = document.createElement("div"); wrap.className = "rose";
  const b = document.createElement("button");
  b.type = "button"; b.className = "rose-btn"; b.title = S.compassReset;
  const svg = el("svg", { viewBox: "0 0 100 100", "aria-hidden": "true", focusable: "false" });
  el("circle", { class: "rose-face", cx: 50, cy: 50, r: 49 }, svg);
  const dial = el("g", { class: "rose-dial" }, svg);
  for (const [k, x, y] of [["compassN", 50, 15], ["compassE", 85, 50], ["compassS", 50, 85], ["compassW", 15, 50]]) el("text", { x, y }, dial).textContent = S[k];
  el("path", { class: "needle-n", d: "M50 31 56.5 50h-13z" }, dial);
  el("path", { class: "needle-s", d: "M43.5 50h13L50 69z" }, dial);
  wrap.append(svg, b);
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
  return wrap;
}
addViewUI(mapView, false);
upgradeIcons();
// Where to look to see new data. In 2D, its extent. In 3D a view from straight above hides height (columns, terrain),
// so a view that isn't tilted yet is tilted to 55°; a tilt the user has already set is kept.
const FRAME_TILT = 55;
function frameTarget(extent) {
  if (mode !== "3d" || !view.camera) return extent;
  return view.camera.tilt < 20 ? { target: extent, tilt: FRAME_TILT, heading: view.camera.heading } : extent;
}
function goToSafe(target, opts) {
  const o = { animate: !reduceMotion, ...(opts || {}) };
  let tries = 0;
  const attempt = () => view.goTo(target, o).catch((e) => {
    if (e && e.name === "AbortError") return;
    if (++tries < 4) return new Promise((res) => setTimeout(res, 350)).then(attempt);
  });
  // viewSettled: a move asked for while 3D is still tilting into place waits for that to end, so the two can't mix
  return viewSettled.then(() => reactiveUtils.whenOnce(() => view.ready)).then(attempt);   // not view.when(): the SDK warns when a view is between maps
}
let viewSettled = Promise.resolve();

// ============================================================ State
let dirty = false;
let currentSource = null;          // the web map opened from the collection or ArcGIS Online: { itemId, title, item, data }
let currentAgolItem = null;        // the signed-in user's own ArcGIS Online item for this map: { id, owner, title }
const dataLayers = [];              // FeatureLayers from CSV files (each keeps its definition in _srcDef)
const portalLayers = new Map();    // itemId -> layer added from the collection
let bookmarks = [];
// Saving. A map file saves back to itself, whichever device it's opened on. A locked map (marked inside the file; see
// LOCK_PROP) is never saved over from this app: opening one is just looking, and Save makes the person's own copy.
let currentFileHandle = null, openedLocked = false;
// Chrome empties a file as soon as it's picked in the save dialog (File System Access spec), before the app sees which
// file it was. So the text of each locked file opened is kept: if it's picked, it's written straight back, unchanged.
// (A locked file that wasn't opened in this session can't be put back: see README, Known limits.)
const openedHandles = [];
function rememberOpened(h, text) { if (h && typeof text === "string" && !openedHandles.some((o) => o.h === h)) openedHandles.push({ h, text }); }
// After a map is opened from a file: unlocked, Save writes back to it; locked, Save makes a copy.
function bindOpened(h, text) {
  openedLocked = isLockedText(text);
  currentFileHandle = openedLocked ? null : h || null;
  if (openedLocked) rememberOpened(h, text);
  $("lockedNote").hidden = !openedLocked;
}
function unbindFile() { currentFileHandle = null; openedLocked = false; $("lockedNote").hidden = true; }
const lockedBase = () => t("lockedFileName", { name: titleSlug() });
const copyBase = () => {   // "Coast_survey_locked" -> "Coast_survey - my copy"
  const suffix = t("lockedFileName", { name: "" }), base = titleSlug();
  return t("copyFileName", { name: suffix && base.toLowerCase().endsWith(suffix.toLowerCase()) ? base.slice(0, -suffix.length) : base });
};
async function openedEntry(h) {
  for (const o of openedHandles) { try { if (o.h === h || await o.h.isSameEntry(h)) return o; } catch (e) { /* not comparable */ } }
  return null;
}
async function restoreOpened(o, picked) {
  try { const w = await picked.createWritable(); await w.write(o.text); await w.close(); return true; } catch (e) { console.error("Couldn't put the opened file back", e); return false; }
}
let portalUser = null;
function markDirty() { dirty = true; }
function markClean() { dirty = false; }
// Unsaved map changes, or data in Add data / Change style that isn't on the map yet.
function confirmDiscard() { return (!dirty && !unfinishedData()) || window.confirm(S.discard); }
window.addEventListener("beforeunload", (e) => { if (dirty || unfinishedData()) { e.preventDefault(); e.returnValue = ""; } });
function sizeTitle() { const el = $("docTitle"); el.size = Math.max(8, Math.min(60, (el.value || el.placeholder || "").length + 2)); }
$("docTitle").addEventListener("input", () => { markDirty(); sizeTitle(); });
function currentTitle() { return ($("docTitle").value || "").trim() || S.untitled; }
function updateTitleShown() { $("hdrTitle").classList.toggle("empty", !($("docTitle").value || "").trim() && document.activeElement !== $("docTitle")); }
function setTitle(v) { $("docTitle").value = (v && String(v).trim()) || ""; sizeTitle(); updateTitleShown(); }
$("docTitle").addEventListener("blur", updateTitleShown);
// Saved maps are .amap files (Atlas map). .mmap files from versions before 1.7 open too.
const FILE_EXT = ".amap", OPEN_EXTS = [".amap", ".mmap", ".json"];
const titleFromFileName = (name) => String(name || "").replace(/\.(amap|mmap|json)$/i, "").replace(/[_-]+/g, " ").trim();
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
// Several messages, one after another, each for its own time: [[text, ms], ...], starting after `delay`.
function toastSeries(list, delay) {
  let at = delay || 0;
  for (const [msg, ms] of list) { setTimeout(() => toast(msg, ms), at); at += ms + 300; }
}
// What a save left out, said after the "saved" message has been read.
function saveNotes(toFile) {
  const notes = [];
  if (unsavedLayers) notes.push([t("layersNotSaved", { n: unsavedLayers }), 5000]);
  if (toFile && privateLeftOut) notes.push([t("privateLayersLeftOut", { n: privateLeftOut }), 6000]);
  toastSeries(notes, 3000);
}

const PANELS = { data: "dataPanel", layers: "layersPanel", legend: "legendPanel", basemaps: "basemapsPanel",
  measure: "measurePanel", profile: "profilePanel", sketch: "sketchPanel", bookmarks: "bookmarksPanel", save: "savePanel", about: "aboutPanel", filter: "filterPanel" };
const TRIGGERS = { data: "tool-add", layers: "tool-layers", legend: "tool-legend", basemaps: "tool-basemaps",
  measure: "tool-measure", profile: "tool-measure", sketch: "tool-sketch", bookmarks: "tool-bookmarks", save: "tool-save", about: "verBtn", filter: "tool-layers" };
// Elevation profile is a toolbar tool of its own, beside Measure, as in MapMaker today. A version that would rather
// keep it inside Measure's menu sets "elevationTool": "menu" in its settings.
const ELEV_IN_TOOLBAR = cfg.elevationTool !== "menu" && F.elevationProfile !== false;
if (ELEV_IN_TOOLBAR) {
  TRIGGERS.profile = "tool-profile"; $("menuProfile").hidden = true;
  const mb = $("tool-measure"); mb.removeAttribute("aria-haspopup"); mb.setAttribute("aria-controls", "measurePanel");   // Measure opens its panel directly
} else $("tool-profile").hidden = true;
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
function togglePanel(name) { if (openPanelName === name) closePanels(); else leaveData(() => openPanel(name)); }
function panelOpening(name) {
  if (name === "sketch") { sketchPanelOpen = true; sketchToolsOn(true); selectForEdit(null); need("curves").catch(() => {}); }
  if (name === "layers") renderLayers();
  if (name === "bookmarks") showBmList();
  if (name === "save") renderAgol();
  if (name === "about") renderVersions();
  if (name === "legend") ensureLegend().catch(() => {});
  if (name === "basemaps") ensureGallery();
  if (name === "profile") { closeTable(false); setTimeout(() => { if (openPanelName === "profile") syncDockHeight($("profilePanel")); }, 0); $("app").classList.add("docked"); $("app").classList.remove("tools-shown"); syncToolsToggles(); need("profile").then(() => { if (openPanelName === "profile") ensureProfile(); }).catch(() => {}); }
}
function panelClosing(name) {
  if (name === "sketch") { sketchToolsOn(false); sketchPanelOpen = false; }
  if (name === "measure") stopMeasuring();
  if (name === "filter") endFilter();
  if (name === "profile") { stopProfile(); $("app").classList.remove("docked", "tools-shown"); syncToolsToggles(); setTimeout(layoutBottom, 0); }
  if (name === "data") {
    const ed = addState && addState.editing;
    addState = null; pendingParse = null; removePreview(true);
    if (ed) {   // editing a layer's style: put the layer back as it was, and go back to Map layers
      ed.layer.visible = ed.wasVisible;
      setTimeout(() => { if (!openPanelName && !modalStack.length) backToLayers(ed.layer.id); }, 0);
    }
  }
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
  if (e.key !== "Escape") return;   // Delete for sketches is the Sketch tools' own
  if (modalStack.length) { e.preventDefault(); closeModal(modalStack[modalStack.length - 1].id); return; }
  if (!$("measureMenu").hidden) { closeToolMenu(true); return; }
  if (!$("userMenu").hidden) { closeUserMenu(true); return; }
  if (openPanelName) closePanels();
});

// ============================================================ Pop-ups
let sketchPanelOpen = false, measureActive = false;
function updatePopupEnabled() {
  const on = !sketchPanelOpen && !measureActive && openPanelName !== "profile";
  for (const v of [mapView, sceneView]) {
    if (!v) continue;
    v.popupEnabled = on;
    if (!on) { try { v.closePopup(); } catch (e) { /* no popup */ } }
  }
}

// ============================================================ Sketch
// Drawing uses the SDK's Sketch component: the same toolbar Map Viewer uses (select, point, line with straight,
// freehand and curved segments, area, rectangle, circle, text, undo/redo, duplicate, delete, snapping). It shows on
// the map while the Sketch panel is open. The panel keeps what the SDK has no component for: each sketch's pop-up
// (title, description, picture), colour and size, and rotation for text.
const COLOUR_NAMES = String(S.colourNames || "").split(",");
let selectedGraphics = [], selectedFeature = null;   // selectedFeature: the one sketch whose pop-up is being edited
// areaShape: an area's styled fill (a point's symbol and an area's are chosen separately; on a sketch both are its "shape")
let pendingStyle = { color: PALETTE_HEX[0], size: 12, rotation: 0, shape: "", areaShape: "", pattern: "solid", arrow: "none", fill: 25, fillColor: "", outlineTransparency: 0, outlineWidth: 2,
  font: "", bold: 1, italic: 0, haloColor: "#ffffff", haloSize: 1.5 };   // text: its font, bold and italic, and its halo (size 0 = no halo)
const newUid = () => "f" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
// Freehand is a segment option inside the line and area tools (as in Map Viewer), not a button of its own.
const SKETCH_TOOLS = ["point", "polyline", "freehandPolyline", "polygon", "freehandPolygon", "rectangle", "circle", "text"];
const sketch = document.createElement("arcgis-sketch");
sketch.defaultGraphicsLayerDisabled = true;   // draw on the app's sketch layer only, never a layer of its own
// It goes on the page (and its code is downloaded) when Sketch is first opened: see sketchToolsOn (5.0.0-beta.9).
let sketchPlaced = null;
const sketchOnPage = new Promise((res) => { sketchPlaced = res; });
function placeSketch() { if (!sketch.isConnected) { $("sketchBar").appendChild(sketch); sketchPlaced(); } }
// Settings go on once the component is ready: set earlier, some are lost when it starts up.
const sketchScale = () => (window.innerHeight < 820 ? "s" : "m");
window.addEventListener("resize", () => { if (sketch.isConnected && sketch.scale && sketch.scale !== sketchScale()) sketch.scale = sketchScale(); });
const sketchReady = (async () => {
  await sketchOnPage;
  await customElements.whenDefined("arcgis-sketch");
  if (sketch.componentOnReady) await sketch.componentOnReady();
  Object.assign(sketch, {
    defaultGraphicsLayerDisabled: true, layer: graphicsLayer, view, autoDestroyDisabled: true,
    availableCreateTools: SKETCH_TOOLS, showCreateToolsText: true, showCreateToolsFreehandPolyline: true, showCreateToolsFreehandPolygon: true, hideCreateToolsMultipoint: true,
    layout: window.matchMedia && window.matchMedia("(max-width: 760px)").matches ? "horizontal" : "vertical",   // down the right of the map, beside the panel, as in Map Viewer (a phone keeps it across the top)
    scale: sketchScale(),                 // smaller buttons on a short screen, so every tool shows without the "more" menu
    hideDuplicateButton: true, hideDeleteButton: true, hideSelectionCountLabel: true,   // one bar on the map: Duplicate and Delete are in the panel
    creationMode: "update",               // as in Map Viewer: a finished sketch stays selected, ready to edit
    updateOnGraphicClickDisabled: $("sketchBar").hidden,   // outside sketching, clicking a sketch opens its pop-up
    label: S.sketch
  });
  // Tooltips on from the start (5.0.0-beta.7): beside the pointer, the place while drawing a point, and a line's length
  // or an area's size as it is drawn. The toolbar's Settings can turn them off. A config can start with them off.
  if (cfg.sketchTooltips !== false) { try { if (sketch.tooltipOptions) sketch.tooltipOptions.enabled = true; else sketch.tooltipOptions = { enabled: true }; } catch (e) { console.warn("Tooltips not turned on", e); } }
  // Also on from the start (5.0.0-beta.8), each with a config switch and each in the toolbar's Settings:
  //  - segment labels: the length of each side while a line or an area is drawn or reshaped (sketchLabels)
  //  - snapping: the pointer is pulled onto a nearby corner or edge of another sketch, and helps keep right angles
  //    and parallels within the shape being drawn (sketchSnapping)
  sketchUnits();
  if (cfg.sketchLabels !== false) { try { sketch.labelOptions.enabled = true; } catch (e) { console.warn("Labels not turned on", e); } }
  if (cfg.sketchSnapping !== false) { try { const so = sketch.snappingOptions; so.enabled = true; so.selfEnabled = true; so.featureEnabled = true; syncSnapSources(); } catch (e) { console.warn("Snapping not turned on", e); } }
})().catch((e) => console.error("Sketch couldn't start", e));

// ---- Sketch styles (2.0 in 5.0.0-beta.9; 2.1 in beta.6: Map Viewer's sketch styles)
// Point symbols: the plain circle, or a symbol from one of Esri's sketch styles: the web styles in the "Esri Sketch
// Styles" group, which is where Map Viewer's Sketch gets its categories (Animals, Buildings, Pins...). A sketch keeps
// the style's item id and the symbol's name ("web:<item id>/Fox"); the symbol is fetched once, then sized (and, for a
// one-colour set, coloured) here. tint: the set takes the chosen colour; the drawn sets keep their own colours.
const PLACES_ITEM = "220936cc6ed342c9937abd8f180e7d1e";   // Esri's 2D point symbols (beta.5 saved these as "web:school")
const SYMBOL_SETS = [
  { key: "pins", item: "70ccf6bcbd304773a164be896e76edd3", tint: true },
  { key: "numbers", item: "9a13182126fd4a52ae75f7112717dd8e", tint: true },
  { key: "shapes", item: "a63b3a4631ae41d4a1bc3ba6d9c85bfe", tint: true, circle: true },
  { key: "arrows", item: "eef578633a3e41b985d0c980275c6d74", tint: true },
  { key: "places", item: PLACES_ITEM, tint: true, category: "POI-Large" },
  { key: "animals", item: "1fbb242c54e4415d9b8e8a343ca7a9d0" },
  { key: "buildings", item: "fe12ab0e0c834ca2adff4e10f68e1327", tint: true },
  { key: "vehicles", item: "0d9f00ffc3af4d128ac5771e3dbce440" },
  { key: "trees", item: "e08037675f354ea1bab42359b9a0c04b" },
  { key: "landforms", item: "45ffe981ef1c4b82933f227c17c5ff80" },
  { key: "natural1", item: "bedfab602abc49e0800482182f0c3e19" },
  { key: "natural2", item: "f2aaebea3bf04c65ba97f7f5c020ce3b" },
  { key: "human1", item: "e9cb6bb3273342b69628e0da4be1b60c" },
  { key: "human2", item: "8560ce55ee7547a0b6b1d59df76d3f6b" },
  // Styled fills for areas (2.2), from the same group. In 3D the SDK draws these as outlines only.
  { key: "hatch", item: "807adef8568448318173798e15954ee5", geom: "polygon" },
  { key: "landuse", item: "e6ad877235bc41a395a17bed100cf2f4", geom: "polygon" },
  { key: "pencil", item: "c4d80992510449289edc5cc0db28d5c0", geom: "polygon" }
].filter((x) => !Array.isArray(cfg.sketchSymbolSets) || cfg.sketchSymbolSets.includes(x.key));
const styleBase = (item) => "https://cdn.arcgis.com/sharing/rest/content/items/" + item;
function parseShape(shape) {
  if (!SHAPE_NAME.test(shape || "")) return null;
  const rest = shape.slice(4), i = rest.indexOf("/");
  const item = i === 32 ? rest.slice(0, 32) : PLACES_ITEM, name = i === 32 ? rest.slice(33) : rest;
  const set = SYMBOL_SETS.find((x) => x.item === item) || (item === PLACES_ITEM ? { key: "places", item, tint: true } : null);
  return set ? { item, name, set, key: item + "/" + name } : null;   // only the styles this app offers are ever fetched
}
const shapeThumb = (p) => styleBase(p.item) + "/resources/styles/thumbnails/" + encodeURIComponent(p.name) + ".png";
const shapeTints = (shape) => { if (!shape) return true; const p = parseShape(shape); return !!(p && p.set.tint); };
const vectorCache = new Map(), vectorLoading = new Map();
function loadVector(shape) {
  const p = parseShape(shape);
  if (!p) return Promise.reject(new Error("Not a symbol this app offers"));
  if (!vectorLoading.has(p.key)) vectorLoading.set(p.key, need("symbols")
    .then(() => new WebStyleSymbol({ styleUrl: styleBase(p.item) + "/data", name: p.name }).fetchSymbol({ acceptedFormats: ["cim"] }))
    .then((sym) => { vectorCache.set(p.key, sym); return sym; })
    .catch((e) => { vectorLoading.delete(p.key); throw e; }));
  return vectorLoading.get(p.key);
}
function vectorSymbol(o) {
  const p = parseShape(o.shape), base = p ? vectorCache.get(p.key) : null;
  if (!base) return null;
  const sym = base.clone(), rgb = hexToRgb(o.color);
  if (p.set.geom === "polygon") return sym;   // a styled fill is used as it is
  try { if (p.set.tint) cimSymbolUtils.applyCIMSymbolColor(sym, { r: rgb[0], g: rgb[1], b: rgb[2], a: 1 }); cimSymbolUtils.scaleCIMSymbolTo(sym, Math.round((o.size || 12) * 2.5)); } catch (e) { console.warn("Couldn't style a symbol", e); }
  return sym;
}
// Lines and area outlines: solid, dashed or dotted; a line can carry an arrowhead at either end or both.
const LINE_STYLES = { solid: "solid", dash: "dash", dot: "dot", "dash-dot": "dash-dot", "long-dash": "long-dash" };
function symbolFor(kind, o) {
  const rgb = hexToRgb(o.color), style = LINE_STYLES[o.pattern] || "solid";
  if (kind === "text") {   // as Map Viewer sets text up: a font, bold and italic, a size, a colour, a halo, and its rotation
    const sym = { type: "text", text: o.text || S.textDefault, color: o.color, angle: o.rotation || 0, font: { ...textFont(o), size: Math.max(10, o.size || 16) } };
    if (o.haloSize > 0) { sym.haloColor = o.haloColor || "#ffffff"; sym.haloSize = o.haloSize; } else { sym.haloColor = null; sym.haloSize = 0; }
    return sym;
  }
  if (kind === "polyline") {
    const sym = { type: "simple-line", color: o.color, width: Math.max(2, Math.round((o.size || 12) / 4)), style };
    if (ARROWS[o.arrow]) sym.marker = { style: "arrow", placement: ARROWS[o.arrow], color: o.color };
    return sym;
  }
  if (kind === "polygon") {
    // as Map Viewer sets an area up: a fill colour and its transparency, an outline colour, its transparency and width
    const f = hexToRgb(o.fillColor || o.color), w = o.outlineWidth == null ? 2 : o.outlineWidth, ot = o.outlineTransparency || 0;
    return { type: "simple-fill", color: [f[0], f[1], f[2], (o.fill == null ? 25 : o.fill) / 100], outline: { color: [rgb[0], rgb[1], rgb[2], (100 - ot) / 100], width: w, style: w > 0 ? style : "none" } };
  }
  return { type: "simple-marker", style: "circle", color: o.color, size: o.size || 12, angle: o.rotation || 0, outline: { color: "#ffffff", width: 1.5 } };
}
const kindOf = (g) => (g.attributes && g.attributes.kind === "text" ? "text" : (g.geometry && g.geometry.type) || "point");
const styleOf = (a) => ({ color: a.color || PALETTE_HEX[0], size: a.size || 12, rotation: a.rotation || 0, text: a.title, shape: a.shape || "", pattern: a.pattern || "solid", arrow: a.arrow || "none", fill: a.fill == null ? 25 : a.fill,
  fillColor: a.fillColor || "", outlineTransparency: a.outlineTransparency || 0, outlineWidth: a.outlineWidth == null ? 2 : a.outlineWidth,
  font: a.font || "", bold: a.bold === 0 ? 0 : 1, italic: a.italic ? 1 : 0, haloColor: a.haloColor || "#ffffff", haloSize: a.haloSize == null ? 1.5 : a.haloSize });
// what the tools draw an area with next, in a sketch's own terms
const pendingArea = () => ({ ...pendingStyle, shape: pendingStyle.areaShape });
function applyStyle(g) {
  const a = g.attributes || (g.attributes = {}), kind = kindOf(g), o = styleOf(a);
  if ((kind === "point" || kind === "polygon") && o.shape) {
    const v = vectorSymbol(o);
    if (v) { g.symbol = v; return; }
    loadVector(o.shape).then(() => { if (g.attributes && g.attributes.shape === o.shape) applyStyle(g); }).catch(() => {});   // the circle meanwhile
  }
  g.symbol = symbolFor(kind, o);
}
// What the Sketch tools draw with: the colour and size chosen with nothing selected.
async function syncSketchSymbols() {
  await sketchReady;
  const o = pendingStyle, props = (kind, opts) => { const { type, ...rest } = symbolFor(kind, opts); return rest; };   // the class sets the type
  sketch.pointSymbol = (o.shape && vectorSymbol(o)) || new SimpleMarkerSymbol(props("point", o));
  if (o.shape && !vectorSymbol(o)) loadVector(o.shape).then(() => { if (pendingStyle.shape === o.shape) syncSketchSymbols(); }).catch(() => {});
  sketch.polylineSymbol = new SimpleLineSymbol(props("polyline", o));
  const ar = pendingArea();
  sketch.polygonSymbol = (ar.shape && vectorSymbol(ar)) || new SimpleFillSymbol(props("polygon", ar));
  if (ar.shape && !vectorSymbol(ar)) loadVector(ar.shape).then(() => { if (pendingStyle.areaShape === ar.shape) syncSketchSymbols(); }).catch(() => {});
  sketch.textSymbol = new TextSymbol(props("text", { ...o, size: Math.max(14, o.size) }));
}
syncSketchSymbols();
function popupContent(event) {
  const a = (event && event.graphic && event.graphic.attributes) || {};
  const wrap = document.createElement("div");
  if (a.description) { const p = document.createElement("p"); p.className = "mm-popup-text"; p.textContent = a.description; wrap.appendChild(p); }
  if (a.imageUrl && /^data:image\//.test(a.imageUrl)) { const img = document.createElement("img"); img.className = "mm-popup-img"; img.src = a.imageUrl; img.alt = a.title || ""; wrap.appendChild(img); }
  if (!a.description && !a.imageUrl) { const p = document.createElement("p"); p.className = "mm-popup-empty"; p.textContent = S.noPopupYet; wrap.appendChild(p); }
  return wrap;
}
const popupTemplate = () => ({ title: "{title}", content: popupContent });
// The line tools can draw true curves (arcs and Bezier curves). The 3D view can't draw those, and other apps may not
// read them, so a finished curve becomes a line through many close points (within 2° of the curve).
function straighten(g) {
  if (!g || !g.geometry || !/^(polyline|polygon)$/.test(g.geometry.type)) return;
  const j = g.geometry.toJSON();
  if (!j.curvePaths && !j.curveRings) return;
  if (!densifyOperator) { need("curves").then(() => straighten(g)).catch(() => {}); return; }   // (loaded when Sketch opens; this is for a curve finished before it arrived)
  try { g.geometry = densifyOperator.execute(g.geometry, 0, { maxAngleInDegrees: 2 }); } catch (e) { console.warn("Couldn't straighten a curve", e); }
}
function addSketchGraphic(gj) {
  const g = Graphic.fromJSON({ geometry: gj.geometry, attributes: gj.attributes });
  g.attributes = { ...gj.attributes };
  applyStyle(g);
  g.popupTemplate = popupTemplate();
  graphicsLayer.add(g);
  return g;
}
// Duplicate (and undo of a delete) bring graphics back with their attributes: give a copy its own id.
graphicsLayer.graphics.on("change", (e) => {
  for (const g of e.added || []) {
    const a = g.attributes;
    if (!a || !a.uid) continue;
    if (graphicsLayer.graphics.some((o) => o !== g && o.attributes && o.attributes.uid === a.uid)) g.attributes = { ...a, uid: newUid() };
    if (!g.popupTemplate) g.popupTemplate = popupTemplate();
  }
});

function popupFieldsEnabled(on) {
  for (const id of ["imgPick", "fTitle", "fDesc"]) $(id).disabled = !on;
}
function setImagePreview(dataUrl) {
  if (dataUrl) { $("imgThumb").src = dataUrl; $("imgPreview").hidden = false; $("imgPick").textContent = S.replaceImage; }
  else { $("imgThumb").removeAttribute("src"); $("imgPreview").hidden = true; $("imgPick").textContent = S.addImage; }
}
function highlightSwatch(hex) { [...$("swatches").children].forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.color === hex))); if (document.activeElement !== $("colourCustom")) $("colourCustom").value = hex; }
// The Sketch panel follows Map Viewer's Sketch pane (Sketch panel 3.0, 5.0.0-beta.6): a line saying what the tool
// in hand does; then the kind of sketch and what suits it. A point has its recent symbols and its current symbol,
// which opens a Change symbol view (category, search, the symbols, Done); colour and size. A line has colour, width,
// pattern and arrow; an area colour, fill and outline; text colour, size and rotation. A selected sketch also has
// its name, its Pop-up (a view of its own) and Duplicate and Delete, which were a second toolbar on the map.
const TOOL_KIND = { point: "point", multipoint: "point", polyline: "polyline", freehandPolyline: "polyline", polygon: "polygon", freehandPolygon: "polygon", rectangle: "polygon", circle: "polygon", text: "text" };
function sketchContext() {
  if (selectedGraphics.length) { const ks = [...new Set(selectedGraphics.map(kindOf))]; return ks.length === 1 ? ks[0] : "mixed"; }
  return TOOL_KIND[sketch.activeTool] || null;
}
function syncRotationRow() { populateSketchPanel(); }
function pressOne(hostId, attr, value) { [...$(hostId).querySelectorAll("button")].forEach((b) => b.setAttribute("aria-pressed", String(b.dataset[attr] === value))); }
let skView = "main";
function showSketchView(name, focusEl) {
  skView = name;
  for (const [id, n] of [["skMain", "main"], ["skSymbols", "symbols"], ["skPopup", "popup"]]) $(id).hidden = n !== name;
  $("sketchPanel").classList.toggle("tall", name === "symbols");   // Change symbol uses the panel's full height for the symbols
  if (name === "symbols") { ensureSymbolSet(); }
  if (focusEl) focusEl.focus();
}
const currentShape = () => (selectedGraphics.length ? (selectedGraphics[0].attributes || {}).shape || "" : (symbolGeom() === "polygon" ? pendingStyle.areaShape : pendingStyle.shape) || "");
function symbolTitle(shape) { if (!shape) return symbolGeom() === "polygon" ? S.basicPolygon : S.symbolCircle; const p = parseShape(shape); return (p && symbolTitles.get(p.key)) || (p ? p.name : shape); }
function symbolPicture(shape, size) {
  const p = parseShape(shape), box = document.createElement("span"); box.className = "sym-pic"; box.style.width = box.style.height = size + "px";
  if (p) { const im = document.createElement("img"); im.src = shapeThumb(p); im.alt = ""; im.loading = "lazy"; im.style.width = im.style.height = Math.round(size * 2.2) + "px"; box.appendChild(im); }
  else { const d = document.createElement("span"); d.className = symbolGeom() === "polygon" ? "sym-area" : "sym-dot"; box.appendChild(d); }
  return box;
}
function symbolButton(shape, title, size) {
  const b = document.createElement("button"); b.type = "button"; b.className = "sym-btn"; b.dataset.shape = shape; b.title = title; b.setAttribute("aria-label", title); b.setAttribute("aria-pressed", "false");
  b.appendChild(symbolPicture(shape, size));
  b.addEventListener("click", () => chooseSymbol(shape, title));
  return b;
}
// Recent symbols: the last few used, kept on this device for next time (a convenience; nothing is lost without it)
const recentSymbols = { point: [], polygon: [] };
for (const g of ["point", "polygon"]) {
  try { const r = JSON.parse(localStorage.getItem("atlas.recentSymbols" + (g === "point" ? "" : "." + g)) || "[]"); if (Array.isArray(r)) recentSymbols[g] = r.filter((x) => x && (x.shape === "" || parseShape(x.shape))).slice(0, 5).map((x) => ({ shape: x.shape, title: String(x.title || "").slice(0, 80) })); } catch (e) { /* no storage */ }
}
function noteRecent(geom, shape, title) {
  recentSymbols[geom] = [{ shape, title }, ...recentSymbols[geom].filter((x) => x.shape !== shape)].slice(0, 5);
  try { localStorage.setItem("atlas.recentSymbols" + (geom === "point" ? "" : "." + geom), JSON.stringify(recentSymbols[geom])); } catch (e) { /* no storage */ }
}
const symbolGeom = () => (sketchContext() === "polygon" ? "polygon" : "point");
function chooseSymbol(shape, title) {
  const geom = symbolGeom();
  noteRecent(geom, shape, title || symbolTitle(shape));
  restyleSelection(geom === "polygon" ? "areaShape" : "shape", shape);
  populateSketchPanel();
  if (skView === "symbols") pressOne("symbolGrid", "shape", shape);
}
function populateSketchPanel() {
  const many = selectedGraphics.length > 1, sel = selectedFeature, a = sel ? sel.attributes : null;
  const kind = sketchContext(), tool = sketch.activeTool || null;
  const first = selectedGraphics.length ? styleOf(selectedGraphics[0].attributes || {}) : kind === "polygon" ? pendingArea() : pendingStyle;
  if (!kind && skView !== "main") showSketchView("main");
  if (skView === "symbols" && kind !== "point" && kind !== "polygon") showSketchView("main");
  if (skView === "popup" && !sel) showSketchView("main");
  // what the tool in hand does (Map Viewer: "Click the map to add point.")
  const hint = selectedGraphics.length ? (many ? fmt(S.manySelected, { n: selectedGraphics.length }) : S.sketchHintSelected) : S["sketchHint_" + (TOOL_KIND[tool] ? (tool === "rectangle" || tool === "circle" ? "drag" : /^freehand/.test(tool) ? "freehand" : TOOL_KIND[tool]) : "none")];
  $("sketchHint").textContent = hint || "";
  $("skKind").hidden = !kind; $("skKind").textContent = kind ? S["sketchKind_" + kind] || "" : "";
  $("secFeature").hidden = !selectedGraphics.length;
  $("nameRow").hidden = !sel; $("skPopupOpen").hidden = !sel || kind === "text";
  $("nameLabel").textContent = kind === "text" ? S.sketchText : S.sketchName;
  const styledArea = kind === "polygon" && !!first.shape;   // a styled fill is used as it is: no colours or outline to set
  $("secSymbol").hidden = kind !== "point" && kind !== "polygon";
  $("recentLabel").textContent = kind === "polygon" ? S.recentPolygonSymbols : S.recentSymbols;
  $("secColour").hidden = !kind || kind === "polygon" || (kind === "point" && !shapeTints(first.shape));
  for (const id of ["secFillColour", "secFillT", "secOutlineColour", "secOutlineT", "secOutlineW"]) $(id).hidden = kind !== "polygon" || styledArea;
  $("secSize").hidden = !kind || kind === "polygon" || kind === "mixed";
  $("sizeLabel").textContent = kind === "polyline" ? S.lineWidth : S.size;
  $("secPattern").hidden = !(kind === "polyline" || (kind === "polygon" && !styledArea));
  $("patternLabel").textContent = kind === "polygon" ? S.outlinePattern : S.linePattern;
  $("secArrow").hidden = kind !== "polyline";
  if (kind === "polygon") {
    const fc = first.fillColor || first.color, ft = 100 - (first.fill == null ? 25 : first.fill);
    pressSwatch("fillSwatches", first.fill === 0 ? "none" : fc); $("fillCustom").value = fc;
    pressSwatch("outlineSwatches", first.outlineWidth === 0 ? "none" : first.color); $("outlineCustom").value = first.color;
    setPair("fFillT", ft); setPair("fOutlineT", first.outlineTransparency || 0); setPair("fOutlineW", first.outlineWidth == null ? 2 : first.outlineWidth);
  }
  $("rotSection").hidden = kind !== "text";
  for (const id of ["secFont", "secHalo"]) $(id).hidden = kind !== "text";
  $("secPlain").hidden = !styledArea;
  if (kind === "text") {
    const f = TEXT_FONTS[first.font] || TEXT_FONTS[""], drawn = textFont(first);
    $("fFont").value = TEXT_FONTS[first.font] ? first.font : "";
    // Bold and Italic are offered only where the font has them
    const setB = (id, on, can) => { const b = $(id); b.setAttribute("aria-pressed", String(on)); b.disabled = !can; b.title = can ? b.dataset.label : fmt(S.fontHasNo, { style: b.dataset.label }); };
    setB("fBold", drawn.weight === "bold", f.bold);
    setB("fItalic", drawn.style === "italic", f.italic && (f.both || !first.bold));
    const halo = first.haloSize > 0;
    $("fHalo").checked = halo; $("haloOpts").hidden = !halo;
    pressSwatch("haloSwatches", first.haloColor || "#ffffff"); $("haloCustom").value = first.haloColor || "#ffffff";
    if (halo) setPair("fHaloW", first.haloSize);
  }
  popupFieldsEnabled(!!sel);
  setImagePreview(a ? a.imageUrl || "" : "");
  if (document.activeElement !== $("fTitle")) $("fTitle").value = a ? a.title || "" : "";
  if (document.activeElement !== $("fDesc")) $("fDesc").value = a ? a.description || "" : "";
  $("skPopupState").textContent = a && (a.description || a.imageUrl) ? S.popupHasContent : "";
  highlightSwatch(first.color || PALETTE_HEX[0]);
  $("fSize").value = first.size || 12; $("sizeVal").textContent = first.size || 12;
  $("fRot").value = first.rotation || 0; $("rotVal").textContent = (first.rotation || 0) + "°";
  pressOne("patternRow", "pattern", first.pattern || "solid"); pressOne("arrowRow", "arrow", first.arrow || "none");
  if (kind === "point" || kind === "polygon") {
    const shape = first.shape || "";
    const cur = $("skSymbolOpen"); cur.replaceChildren(symbolPicture(shape, 30));
    const nm = document.createElement("span"); nm.className = "sym-cur-name"; nm.textContent = symbolTitle(shape); const ch = document.createElement("span"); ch.className = "chev"; ch.setAttribute("aria-hidden", "true"); ch.textContent = "›";
    cur.append(nm, ch); cur.setAttribute("aria-label", S.currentSymbol + ": " + symbolTitle(shape) + ". " + S.changeSymbol);
    const row = $("recentRow"); row.replaceChildren();
    // the plain one is always first, so there is a way back from a styled fill or a picture symbol
    const plain = { shape: "", title: kind === "polygon" ? S.basicPolygon : S.symbolCircle };
    const recents = [plain, ...recentSymbols[symbolGeom()].filter((x) => x.shape !== "")];
    for (const r of recents) row.appendChild(symbolButton(r.shape, r.title || symbolTitle(r.shape), 30));
    $("recentNone").hidden = recents.length > 0; $("recentNone").textContent = kind === "polygon" ? S.noRecentPolygonSymbols : S.noRecentSymbols; row.hidden = !recents.length;
    pressOne("recentRow", "shape", shape);
    if (skView === "symbols") pressOne("symbolGrid", "shape", shape);
  }
}
// What a style control may change on a sketch of each kind
const STYLE_KINDS = { shape: ["point"], areaShape: ["polygon"], arrow: ["polyline"], pattern: ["polyline", "polygon"], fill: ["polygon"], fillColor: ["polygon"], outlineTransparency: ["polygon"], outlineWidth: ["polygon"], rotation: ["text"],
  font: ["text"], bold: ["text"], italic: ["text"], haloColor: ["text"], haloSize: ["text"] };
// Change symbol: each category is one of the sketch styles; its list (names, titles, small pictures) is fetched when first chosen.
const symbolLists = new Map(), symbolTitles = new Map();
const LEFT_OUT = new Set((Array.isArray(cfg.sketchSymbolsLeftOut) ? cfg.sketchSymbolsLeftOut : ["bar", "casino", "vineyard"]).map((x) => String(x).toLowerCase()));   // not for a school atlas; a config can choose
function loadSymbolSet(set) {
  if (!symbolLists.has(set.key)) symbolLists.set(set.key, restGetUrl(styleBase(set.item) + "/data").then((d) => {
    const items = (d.items || []).filter((it) => it && it.itemType === (set.geom === "polygon" ? "polygonSymbol" : "pointSymbol") && (!set.category || it.category === set.category) && SHAPE_NAME.test("web:" + set.item + "/" + it.name) && !LEFT_OUT.has(String(it.name).toLowerCase()))
      .map((it) => ({ shape: "web:" + set.item + "/" + it.name, title: String(it.title || it.name).slice(0, 80), tags: (Array.isArray(it.tags) ? it.tags.join(" ") : "").toLowerCase() }));
    for (const it of items) symbolTitles.set(set.item + "/" + it.shape.slice(37), it.title);
    return items;
  }).catch((e) => { symbolLists.delete(set.key); throw e; }));
  return symbolLists.get(set.key);
}
let symbolSeq = 0;
async function ensureSymbolSet() {
  const geom = symbolGeom(), sets = SYMBOL_SETS.filter((x) => (x.geom || "point") === geom);
  if ($("symbolSet").dataset.geom !== geom) {   // the categories for points, or for areas
    $("symbolSet").replaceChildren(...sets.map((x) => { const o = document.createElement("option"); o.value = x.key; o.textContent = S["symbolSet_" + x.key] || x.key; return o; }));
    $("symbolSet").dataset.geom = geom;
  }
  $("symbolNote").hidden = geom !== "polygon";
  const set = sets.find((x) => x.key === $("symbolSet").value) || sets[0], grid = $("symbolGrid"), seq = ++symbolSeq;
  if (!set) return;
  $("symbolStatus").textContent = S.symbolsLoading;
  let items;
  try { items = await loadSymbolSet(set); } catch (e) { console.error("Symbols not loaded", e); if (seq === symbolSeq) { grid.replaceChildren(); $("symbolStatus").textContent = S.symbolsFailed; } return; }
  if (seq !== symbolSeq) return;
  const q = $("symbolSearch").value.trim().toLowerCase();
  const shown = q ? items.filter((it) => it.title.toLowerCase().includes(q) || it.tags.includes(q)) : items;
  grid.replaceChildren();
  if (set.circle && (!q || S.symbolCircle.toLowerCase().includes(q))) grid.appendChild(symbolButton("", S.symbolCircle, 36));
  if (geom === "polygon" && (!q || S.basicPolygon.toLowerCase().includes(q))) grid.appendChild(symbolButton("", S.basicPolygon, 36));   // back to the plain fill
  const setName = S["symbolSet_" + set.key] || set.key;
  for (const it of shown) grid.appendChild(symbolButton(it.shape, /^Symbol \d/.test(it.title) ? setName + ", " + it.title : it.title, 36));   // the drawn sets only number their symbols
  $("symbolStatus").textContent = q ? t("symbolsFound", { n: grid.children.length }) : "";
  pressOne("symbolGrid", "shape", currentShape());
}
function setSelection(graphics) {
  selectedGraphics = (graphics || []).filter((g) => g && g.layer === graphicsLayer);
  selectedFeature = selectedGraphics.length === 1 ? selectedGraphics[0] : null;
  populateSketchPanel();
}
function selectForEdit(g) { setSelection(g ? [g] : []); }
// Colour, size and rotation change every selected sketch, or (with none selected) what the tools draw next.
function restyleSelection(key, value) {
  if (selectedGraphics.length) {
    for (const g of selectedGraphics) { if (STYLE_KINDS[key] && !STYLE_KINDS[key].includes(kindOf(g))) continue; g.attributes[key === "areaShape" ? "shape" : key] = value; applyStyle(g); }
    markDirty();
  }
  // the choice is also what the tools draw with next (as in Map Viewer, where a style carries on to the next sketch)
  pendingStyle[key] = value; syncSketchSymbols();
}
PALETTE_HEX.forEach((hex, i) => {
  const b = document.createElement("button");
  b.type = "button"; b.className = "swatch"; b.style.background = hex; b.dataset.color = hex;
  b.setAttribute("aria-label", (COLOUR_NAMES[i] || hex).trim()); b.title = (COLOUR_NAMES[i] || hex).trim(); b.setAttribute("aria-pressed", "false");
  b.addEventListener("click", () => { restyleSelection("color", hex); highlightSwatch(hex); });
  $("swatches").appendChild(b);
});
$("fTitle").addEventListener("input", () => { if (!selectedFeature) return; selectedFeature.attributes.title = $("fTitle").value; if (kindOf(selectedFeature) === "text") applyStyle(selectedFeature); markDirty(); });
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
$("fSize").addEventListener("input", () => { const v = parseInt($("fSize").value, 10); $("sizeVal").textContent = v; restyleSelection("size", v); });
$("fRot").addEventListener("input", () => { const v = parseInt($("fRot").value, 10); $("rotVal").textContent = v + "°"; restyleSelection("rotation", v); });
// Areas: fill and outline colours (the palette, a colour of your own, or none), transparencies and width, each a slider with its number box
function pressSwatch(hostId, value) { [...$(hostId).querySelectorAll("button")].forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.color === value))); }
function setPair(id, v) { $(id).value = v; $(id + "N").value = v; }
function swatchRow(hostId, customId, onColour, onNone, noneLabel) {
  PALETTE_HEX.forEach((hex, i) => {
    const b = document.createElement("button"); b.type = "button"; b.className = "swatch"; b.style.background = hex; b.dataset.color = hex;
    const name = (COLOUR_NAMES[i] || hex).trim(); b.setAttribute("aria-label", name); b.title = name; b.setAttribute("aria-pressed", "false");
    b.addEventListener("click", () => { onColour(hex); populateSketchPanel(); });
    $(hostId).appendChild(b);
  });
  const n = document.createElement("button"); n.type = "button"; n.className = "swatch none"; n.dataset.color = "none"; n.setAttribute("aria-label", noneLabel); n.title = noneLabel; n.setAttribute("aria-pressed", "false");
  n.addEventListener("click", () => { onNone(); populateSketchPanel(); });
  $(hostId).appendChild(n);
  $(customId).addEventListener("input", () => { onColour($(customId).value.toLowerCase()); pressSwatch(hostId, $(customId).value.toLowerCase()); });
}
swatchRow("fillSwatches", "fillCustom", (hex) => { restyleSelection("fillColor", hex); if ((selectedGraphics.length ? styleOf(selectedGraphics[0].attributes).fill : pendingStyle.fill) === 0) restyleSelection("fill", 25); }, () => restyleSelection("fill", 0), S.noFill);
swatchRow("outlineSwatches", "outlineCustom", (hex) => { restyleSelection("color", hex); if ((selectedGraphics.length ? styleOf(selectedGraphics[0].attributes).outlineWidth : pendingStyle.outlineWidth) === 0) restyleSelection("outlineWidth", 2); }, () => restyleSelection("outlineWidth", 0), S.noOutline);
function pair(id, key, toValue) {
  const set = (raw) => { const el = $(id), v = Math.min(Number(el.max), Math.max(Number(el.min), Number(raw))); if (!Number.isFinite(v)) return; setPair(id, v); restyleSelection(key, toValue ? toValue(v) : v); };
  $(id).addEventListener("input", () => set($(id).value));
  $(id + "N").addEventListener("change", () => set($(id + "N").value));
}
pair("fFillT", "fill", (t) => 100 - t);            // kept as how solid the fill is; shown, as in Map Viewer, as its transparency
pair("fOutlineT", "outlineTransparency");
pair("fOutlineW", "outlineWidth");
// Text: font, bold and italic, halo
{
  const sel = $("fFont");
  for (const key of Object.keys(TEXT_FONTS)) { const o = document.createElement("option"); o.value = key; o.textContent = key ? TEXT_FONTS[key].family : S.fontDefault; sel.appendChild(o); }
  sel.addEventListener("change", () => { restyleSelection("font", sel.value); populateSketchPanel(); });
  const cur = () => (selectedGraphics.length ? styleOf(selectedGraphics[0].attributes || {}) : pendingStyle);
  for (const [id, key, label] of [["fBold", "bold", S.bold], ["fItalic", "italic", S.italic]]) {
    const b = $(id); b.dataset.label = label; b.setAttribute("aria-label", label); b.title = label;
    b.addEventListener("click", () => { restyleSelection(key, b.getAttribute("aria-pressed") === "true" ? 0 : 1); populateSketchPanel(); });
  }
  let lastHalo = 1.5;
  $("fHalo").addEventListener("change", () => { if (!$("fHalo").checked) lastHalo = cur().haloSize || lastHalo; restyleSelection("haloSize", $("fHalo").checked ? lastHalo : 0); populateSketchPanel(); });
  PALETTE_HEX.concat(["#ffffff", "#000000"].filter((h) => !PALETTE_HEX.includes(h))).forEach((hex) => {
    const i = PALETTE_HEX.indexOf(hex), name = (i >= 0 ? COLOUR_NAMES[i] : hex === "#ffffff" ? S.colourWhite : S.colourBlack) || hex;
    const b = document.createElement("button"); b.type = "button"; b.className = "swatch"; b.style.background = hex; b.dataset.color = hex; b.setAttribute("aria-label", name.trim()); b.title = name.trim(); b.setAttribute("aria-pressed", "false");
    b.addEventListener("click", () => { restyleSelection("haloColor", hex); populateSketchPanel(); });
    $("haloSwatches").appendChild(b);
  });
  $("haloCustom").addEventListener("input", () => { const v = $("haloCustom").value.toLowerCase(); restyleSelection("haloColor", v); pressSwatch("haloSwatches", v); });
  pair("fHaloW", "haloSize");
  $("skPlainFill").addEventListener("click", () => chooseSymbol("", S.basicPolygon));
  // a colour of your own for a point, a line or text, as areas already had
  $("colourCustom").addEventListener("input", () => { const v = $("colourCustom").value.toLowerCase(); restyleSelection("color", v); highlightSwatch(v); });
}
// Pattern and arrow choices: small pictures of the line, each a button
{
  const NS = "http://www.w3.org/2000/svg", DASH = { solid: "", dash: "7 4", dot: "2 4", "dash-dot": "8 3 2 3", "long-dash": "12 4" };
  const pic = (draw) => { const svg = document.createElementNS(NS, "svg"); svg.setAttribute("viewBox", "0 0 44 16"); svg.setAttribute("aria-hidden", "true"); svg.setAttribute("focusable", "false"); draw(svg); return svg; };
  const line = (svg, x1, x2, dash) => { const l = document.createElementNS(NS, "line"); l.setAttribute("x1", x1); l.setAttribute("x2", x2); l.setAttribute("y1", 8); l.setAttribute("y2", 8); l.setAttribute("stroke", "currentColor"); l.setAttribute("stroke-width", 2.5); if (dash) l.setAttribute("stroke-dasharray", dash); svg.appendChild(l); };
  const head = (svg, x, dir) => { const p = document.createElementNS(NS, "path"); p.setAttribute("d", dir > 0 ? `M${x} 8 ${x - 9} 3v10z` : `M${x} 8 ${x + 9} 3v10z`); p.setAttribute("fill", "currentColor"); svg.appendChild(p); };
  const button = (hostId, attr, value, label, draw) => {
    const b = document.createElement("button"); b.type = "button"; b.className = "pat-btn"; b.dataset[attr] = value; b.title = label; b.setAttribute("aria-label", label); b.setAttribute("aria-pressed", "false");
    b.appendChild(pic(draw)); b.addEventListener("click", () => { restyleSelection(attr, value); pressOne(hostId, attr, value); });
    $(hostId).appendChild(b);
  };
  for (const p of Object.keys(DASH)) button("patternRow", "pattern", p, S["pattern_" + p] || p, (svg) => line(svg, 3, 41, DASH[p]));
  button("arrowRow", "arrow", "none", S.arrow_none, (svg) => line(svg, 3, 41));
  button("arrowRow", "arrow", "end", S.arrow_end, (svg) => { line(svg, 3, 34); head(svg, 42, 1); });
  button("arrowRow", "arrow", "start", S.arrow_start, (svg) => { line(svg, 10, 41); head(svg, 2, -1); });
  button("arrowRow", "arrow", "both", S.arrow_both, (svg) => { line(svg, 10, 34); head(svg, 42, 1); head(svg, 2, -1); });
  $("symbolSet").addEventListener("change", () => { $("symbolSearch").value = ""; ensureSymbolSet(); });
  let searchTimer = 0;
  $("symbolSearch").addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(ensureSymbolSet, 150); });
  $("skSymbolOpen").addEventListener("click", () => {
    $("symbolSearch").value = ""; showSketchView("symbols", $("skSymbolsH"));
    const p = parseShape(currentShape()); if (p && [...$("symbolSet").options].some((o) => o.value === p.set.key) && $("symbolSet").value !== p.set.key) { $("symbolSet").value = p.set.key; ensureSymbolSet(); }   // open on the current symbol's own category
  });
  for (const id of ["skSymbolsBack", "skSymbolsDone"]) $(id).addEventListener("click", () => showSketchView("main", $("skSymbolOpen")));
  $("skPopupOpen").addEventListener("click", () => showSketchView("popup", $("skPopupH")));
  for (const id of ["skPopupBack", "skPopupDone"]) $(id).addEventListener("click", () => { showSketchView("main", $("skPopupOpen")); populateSketchPanel(); });
  // Duplicate and Delete for the selected sketches (the toolbar's own buttons for these made a second bar on the map)
  $("skDuplicate").addEventListener("click", () => { try { sketch.duplicate(); } catch (e) { console.warn("Duplicate failed", e); } });
  $("skDelete").addEventListener("click", () => { try { sketch.delete(); } catch (e) { console.warn("Delete failed", e); } $("sketchH").focus(); });
}

const sketchBusy = () => sketch.state === "active";
function endSketchOps() {
  if (!sketchBusy()) return;
  try { if (sketch.createGraphic) sketch.cancel(); else sketch.complete(); } catch (e) { /* idle */ }
}
// The Sketch panel turns the toolbar on and off. Closed, clicking a sketch opens its pop-up instead of selecting it.
// What sketches snap to: other sketches only (5.0.0-beta.9; beta.8 also snapped to spreadsheet layers). That is what
// tidy map making needs: areas that share a border, lines that meet. A config can add the spreadsheet layers
// ("sketchSnapTo": "sketches-and-data"). The opened map's own layers are never snapping layers by default.
function syncSnapSources() {
  if (cfg.sketchSnapping === false || !sketch.snappingOptions) return;
  const fs = sketch.snappingOptions.featureSources, want = cfg.sketchSnapTo === "sketches-and-data" ? [graphicsLayer, ...dataLayers] : [graphicsLayer];
  try {
    fs.removeMany(fs.filter((src) => !want.includes(src.layer)).toArray());
    for (const layer of want) if (!fs.some((src) => src.layer === layer)) fs.add({ layer, enabled: true });
  } catch (e) { console.warn("Snapping layers not set", e); }
}
let toolWatch = 0, toolSeen = null;
function sketchToolsOn(on) {
  if (on) { placeSketch(); showSketchView("main"); sketchReady.then(syncSnapSources); }
  // the panel follows the tool chosen on the toolbar
  clearInterval(toolWatch); toolWatch = 0;
  if (on) toolWatch = setInterval(() => { const t = sketch.activeTool || null; if (t !== toolSeen) { toolSeen = t; populateSketchPanel(); } }, 250);
  if (!on) endSketchOps();
  $("sketchBar").hidden = !on;
  sketchReady.then(() => { sketch.updateOnGraphicClickDisabled = $("sketchBar").hidden; });
  if (!on) { setSelection([]); try { sketch.dismissFloatingElements(); } catch (e) { /* none open */ } }
}
sketch.addEventListener("arcgisCreate", (e) => {
  const { state, graphic, tool } = e.detail || {};
  if (state === "start") syncRotationRow();
  if (state !== "complete" || !graphic) return;
  straighten(graphic);
  const isText = tool === "text" || (graphic.symbol && graphic.symbol.type === "text");
  const typed = isText && graphic.symbol && graphic.symbol.text;
  graphic.attributes = { uid: newUid(), kind: isText ? "text" : (graphic.geometry && graphic.geometry.type) || "point",
    title: isText ? (typed && typed !== "hello world" ? typed : S.textDefault) : "", description: "", imageUrl: "",
    color: pendingStyle.color, size: isText ? Math.max(14, pendingStyle.size) : pendingStyle.size, rotation: isText ? pendingStyle.rotation : 0,
    shape: isText ? "" : graphic.geometry && graphic.geometry.type === "polygon" ? pendingStyle.areaShape : graphic.geometry && graphic.geometry.type === "point" ? pendingStyle.shape : "",
    pattern: pendingStyle.pattern, arrow: pendingStyle.arrow, fill: pendingStyle.fill, fillColor: pendingStyle.fillColor, outlineTransparency: pendingStyle.outlineTransparency, outlineWidth: pendingStyle.outlineWidth,
    font: pendingStyle.font, bold: pendingStyle.bold, italic: pendingStyle.italic, haloColor: pendingStyle.haloColor, haloSize: pendingStyle.haloSize };
  applyStyle(graphic);
  graphic.popupTemplate = popupTemplate();
  markDirty();
  if (!$("layersPanel").hidden) renderLayers();
  if (isText) setTimeout(() => { if (selectedFeature === graphic) { $("fTitle").focus(); $("fTitle").select(); } }, 0);
  // A finished sketch stays selected for editing, and the toolbar normally says so (an update event). With a vector
  // point symbol it doesn't, so the selection is read from the toolbar itself.
  setTimeout(() => { const ug = sketch.updateGraphics, arr = ug ? (ug.toArray ? ug.toArray() : [...ug]) : []; if (arr.length && !selectedGraphics.length) setSelection(arr); }, 60);
});
sketch.addEventListener("arcgisUpdate", (e) => {
  const { state, graphics, toolEventInfo } = e.detail || {};
  if (state === "complete") { (graphics ? (graphics.toArray ? graphics.toArray() : [...graphics]) : []).forEach(straighten); setSelection([]); return; }
  setSelection(graphics ? (graphics.toArray ? graphics.toArray() : [...graphics]) : []);
  if (toolEventInfo && /-stop$|^vertex-(add|remove)$/.test(toolEventInfo.type || "")) markDirty();
});
sketch.addEventListener("arcgisDelete", () => { setSelection([]); markDirty(); if (!$("layersPanel").hidden) renderLayers(); });
for (const ev of ["arcgisUndo", "arcgisRedo"]) sketch.addEventListener(ev, () => { markDirty(); if (!$("layersPanel").hidden) renderLayers(); });
// Keyboard: the button in the panel moves focus to the first drawing tool (the toolbar sits on the map, away from the panel).
function firstSketchAction(root) {
  for (const el of root.querySelectorAll("*")) {
    if (el.tagName === "CALCITE-ACTION" && el.offsetParent !== null && !el.disabled) return el;
    if (el.shadowRoot) { const f = firstSketchAction(el.shadowRoot); if (f) return f; }
  }
  return null;
}
$("sketchToolsJump").addEventListener("click", async () => {
  await sketchReady;
  const a = firstSketchAction(sketch.shadowRoot || sketch);
  if (a) { if (a.setFocus) await a.setFocus(); else a.focus(); }
});
// Escape while drawing or editing is the Sketch tools' (cancel or finish), not a reason to close the panel.
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || $("sketchBar").hidden || !sketchBusy()) return;
  e.stopPropagation(); e.preventDefault();
  endSketchOps();
}, true);

// ============================================================ Legend, basemaps, measure
let legend = null, legendMaking = null, coordWidget = null;
async function ensureLegend() {
  if (!legend) { legendMaking = legendMaking || toolEl("arcgis-legend", $("legendBody"), { view }); try { legend = await legendMaking; } catch (e) { legendMaking = null; throw e; } }
  legend.view = view;
}

// Basemaps, as MapMaker shows them: the basemap group's web maps (and, in 3D, its web scenes) as a two-column grid of
// cards, in the group's own order (MapMaker's: date added, newest first). The card for the map's basemap is selected.
const gallery = { items: null, loading: null, dataTitles: null, fetchingTitles: false };
async function loadGalleryItems() {
  if (gallery.items) return gallery.items;
  if (!gallery.loading) gallery.loading = (async () => {
    const group = await restGet(`/sharing/rest/community/groups/${cfg.basemapGroup}`);
    const d = await restGet(`/sharing/rest/content/groups/${cfg.basemapGroup}/search`, { q: "*", num: 100, start: 1, ...groupSort(group) });
    return d.results || [];
  })();
  try { gallery.items = await gallery.loading; return gallery.items; }
  catch (e) { console.error("Basemaps couldn't load", e); return null; }
  finally { gallery.loading = null; }
}
const galleryList = () => basemapItems(gallery.items || [], mode);
function currentBasemapInfo() {
  const m = shownMap(), b = m && m.basemap;
  return b ? { itemId: (b.portalItem && b.portalItem.id) || null, title: b.title || "" } : null;
}
function syncGallerySelection() {
  if (!gallery.items) return;
  const list = galleryList(), info = currentBasemapInfo();
  const sel = selectedId(list, info, gallery.dataTitles);
  $("basemapsGrid").querySelectorAll(".bmg-card").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.id === sel)));
  // A basemap from inside a web map (a saved file, a collection map) is named as in its item's data, which can differ
  // from the card's name: fetch those names once, then look again.
  if (!sel && !gallery.dataTitles && !gallery.fetchingTitles && needsDataTitles(list, info)) {
    gallery.fetchingTitles = true;
    Promise.all(gallery.items.map((it) => restGet(`/sharing/rest/content/items/${it.id}/data`).then((d) => [it.id, (d && d.baseMap && d.baseMap.title) || ""], () => [it.id, ""])))
      .then((pairs) => { gallery.dataTitles = new Map(pairs); }).finally(() => { gallery.fetchingTitles = false; syncGallerySelection(); });
  }
}
function renderGallery() {
  if (!gallery.items) return;
  const grid = $("basemapsGrid"), list = galleryList();
  const hadFocus = grid.contains(document.activeElement) ? document.activeElement.dataset.id : null;
  grid.innerHTML = "";
  for (const it of list) {
    const li = document.createElement("li");
    const b = document.createElement("button"); b.type = "button"; b.className = "bmg-card"; b.dataset.id = it.id;
    const src = thumbnailUrl(PORTAL, it, 400);
    const pic = document.createElement(src ? "img" : "span"); pic.className = "bmg-thumb";
    if (src) { pic.alt = ""; pic.loading = "lazy"; pic.decoding = "async"; pic.src = src; } else pic.setAttribute("aria-hidden", "true");
    const name = document.createElement("span"); name.className = "bmg-title"; name.textContent = String(it.title || "").trim() || S.untitled;
    b.append(pic, name);
    b.addEventListener("click", () => chooseBasemap(it));
    li.appendChild(b); grid.appendChild(li);
  }
  $("basemapsStatus").textContent = list.length ? "" : S.basemapsNone;
  syncGallerySelection();
  if (hadFocus) { const f = grid.querySelector('.bmg-card[data-id="' + hadFocus + '"]'); if (f) f.focus(); }
}
async function ensureGallery() {
  if (gallery.items) { renderGallery(); return; }
  const st = $("basemapsStatus");
  st.textContent = S.basemapsLoading; $("basemapsGrid").innerHTML = "";
  if (await loadGalleryItems()) { renderGallery(); return; }
  st.textContent = S.basemapsError;
  const again = document.createElement("button"); again.type = "button"; again.className = "btn"; again.textContent = S.tryAgain;
  again.addEventListener("click", () => { ensureGallery().then(() => { const f = $("basemapsGrid").querySelector(".bmg-card"); if (f) f.focus(); }); });
  st.append(document.createElement("br"), again);
}
function chooseBasemap(it) {
  const m = activeMap(), cur = m.basemap;
  if (cur && cur.portalItem && cur.portalItem.id === it.id) return;
  const bm = new Basemap({ portalItem: { id: it.id } });
  m.basemap = bm;
  markDirty();
  syncGallerySelection();
  bm.load().catch((e) => { console.error("Basemap failed", e); toast(S.basemapFailed); });
}
$("basemapsGrid").addEventListener("keydown", (e) => {
  const cards = [...$("basemapsGrid").querySelectorAll(".bmg-card")], i = cards.indexOf(document.activeElement);
  if (i < 0) return;
  const cols = getComputedStyle($("basemapsGrid")).gridTemplateColumns.split(" ").filter(Boolean).length || 2;
  const n = gridMove(i, cards.length, cols, e.key);
  if (n == null) return;
  e.preventDefault(); cards[n].focus();
});
// The selected card follows the map's basemap, wherever it changes (another map opened, a file, a new map).
reactiveUtils.watch(() => { const m = shownMap(), b = m && m.basemap; return b ? ((b.portalItem && b.portalItem.id) || "") + "|" + (b.title || "") : ""; }, syncGallerySelection);
// Units (1.0 in 5.0.0-beta.12): kilometres and metres, or miles and feet, for Measure, Elevation and Sketch's
// tooltips and side labels. Where they start is worked out in lib/units.js; the km / mi switch changes them.
const UNITS_KEY = "atlas.units";
const unitsFound = (() => {
  let stored = null, timeZone, languages = [];
  if (cfg.unitsSwitch !== false) { try { stored = localStorage.getItem(UNITS_KEY); } catch (e) { /* no storage */ } }
  try { timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { /* not known */ }
  try { languages = navigator.languages && navigator.languages.length ? [...navigator.languages] : [navigator.language]; } catch (e) { /* not known */ }
  return resolveUnits({ param: (params.get("units") || "").toLowerCase(), stored, config: cfg.units, timeZone, languages });
})();
let units = unitsFound.units;
// Sketch's side labels have no units setting of their own: the SDK takes them from the portal's units (its
// documentation for SketchLabelOptions), of the map's item where there is one and of the default portal otherwise.
function portalUnits() {
  const pu = units === "imperial" ? "english" : "metric";
  try { Portal.getDefault().units = pu; } catch (e) { /* no default portal */ }
  for (const v of [mapView, sceneView]) { try { const it = v && v.map && v.map.portalItem; if (it && it.portal) it.portal.units = pu; } catch (e) { /* no item */ } }
}
function sketchUnits() {
  portalUnits();
  if (!sketch) return;
  try { const u = { length: units, verticalLength: units, area: units }; sketch.valueOptions = { displayUnits: u, inputUnits: u }; } catch (e) { console.warn("Sketch units not set", e); }
}
function syncUnitsSwitches() {
  document.querySelectorAll(".units-seg").forEach((g) => { g.hidden = cfg.unitsSwitch === false; g.querySelectorAll("button[data-units]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.units === units))); });
}
function setUnits(u, save) {
  if (u !== "imperial" && u !== "metric") return;
  units = u;
  if (save) { try { localStorage.setItem(UNITS_KEY, u); } catch (e) { /* no storage: for this visit only */ } }
  try { if (measureEl) measureEl.unit = u; } catch (e) { console.warn("Measure units not set", e); }
  sketchUnits(); syncUnitsSwitches();
  if (prof && profActive()) renderProfile();
}
document.querySelectorAll(".units-seg button[data-units]").forEach((b) => b.addEventListener("click", () => setUnits(b.dataset.units, true)));
syncUnitsSwitches();
// Measure: one SDK component for each kind of measurement and each kind of view. It is made when a tool is chosen and
// taken away when measuring stops. Its own units menu is hidden: the km / mi switch above it sets the units.
const MEASURE_TAGS = { "2d": { distance: "arcgis-distance-measurement-2d", area: "arcgis-area-measurement-2d" }, "3d": { distance: "arcgis-direct-line-measurement-3d", area: "arcgis-area-measurement-3d" } };
let measureEl = null, measureKind = null, measureSeq = 0;
function clearMeasure() {
  measureSeq++; measureKind = null;
  if (measureEl) { try { measureEl.clear(); } catch (e) { /* idle */ } dropEl(measureEl); measureEl = null; }
}
async function startMeasure(kind) {
  clearMeasure(); const seq = measureSeq; measureKind = kind;
  let el; try { el = await toolEl(MEASURE_TAGS[mode][kind], $("measureBody"), { view, unit: units, hideUnitSelect: true }); } catch (e) { if (seq === measureSeq) stopMeasuring(); return; }
  if (seq !== measureSeq) { dropEl(el); return; }   // another tool was chosen, or measuring stopped, meanwhile
  measureEl = el;
  try { await el.start(); } catch (e) { /* stopped before the first click */ }
}
function measurePressed(id) { ["mDist", "mArea", "mCoord"].forEach((b) => $(b).setAttribute("aria-pressed", String(b === id))); }
function stopMeasuring() {
  clearMeasure();
  measurePressed(null); measureActive = false; $("coordWrap").hidden = true;
  updatePopupEnabled();
}
$("mDist").addEventListener("click", () => { $("coordWrap").hidden = true; measurePressed("mDist"); measureActive = true; updatePopupEnabled(); startMeasure("distance"); });
$("mArea").addEventListener("click", () => { $("coordWrap").hidden = true; measurePressed("mArea"); measureActive = true; updatePopupEnabled(); startMeasure("area"); });
let coordMaking = null;
$("mCoord").addEventListener("click", async () => {
  clearMeasure();
  $("coordWrap").hidden = false; measurePressed("mCoord"); measureActive = false; updatePopupEnabled();
  // Capture mode: the coordinates stay where the map was clicked. (In Esri's default live mode they follow the pointer,
  // so moving to the panel to copy them would copy wherever the pointer last crossed the map.)
  if (!coordWidget) {
    coordMaking = coordMaking || toolEl("arcgis-coordinate-conversion", $("coordBody"), { view, mode: "capture" });
    try { coordWidget = await coordMaking; } catch (e) { coordMaking = null; return; }
    watchCoordCopy();
  }
  coordWidget.view = view; coordWidget.mode = "capture";
});
// Copy coordinates: the text Esri's own Copy puts on the clipboard (the tool's main row has no Copy button), ready to
// paste into one spreadsheet cell; Add layer reads that column back (see parseCoordPair in lib/csv.js).
const coordText = () => { const c = coordWidget && coordWidget.conversions && coordWidget.conversions.length ? coordWidget.conversions.getItemAt(0) : null; return (c && c.position && c.displayCoordinate) || ""; };
function watchCoordCopy() {
  reactiveUtils.watch(coordText, (txt) => { $("coordCopy").disabled = !txt; $("coordCopied").textContent = ""; }, { initial: true });
}
$("coordCopy").addEventListener("click", async () => {
  const txt = coordText();
  if (!txt) return;
  try { await navigator.clipboard.writeText(txt); $("coordCopied").textContent = S.coordsCopied; }
  catch (e) { $("coordCopied").textContent = S.coordsCopyFailed; }
});
$("mClear").addEventListener("click", stopMeasuring);

// Elevation profile: the land's height along a line drawn on the map (or a sketched line), from Esri's world elevation.
// Esri's World Elevation TopoBathy 3D: land and the sea floor (the service behind the SDK's "world-topobathymetry" ground).
// Sampled directly, so the profile dips below sea level in 2D and 3D alike, whatever the map's ground.
const TOPOBATHY_URL = "https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/TopoBathy3D/ImageServer";
// Elevation profile 3.0 (5.0.0-beta.10; 3.1 in beta.11: drawn lines are geodesic): the app's own tool and chart; before, Esri's Elevation Profile widget, which
// could not be given a sea-level line or a filled chart (and is one of the widgets SDK 6 removes).
//  - The line: click the map for each point and double-click to finish, or click a line already on the map (a
//    sketched line, or a line feature of a layer). Over a line that can be chosen the pointer becomes a hand.
//  - The heights: up to 512 points along the line, asked of the elevation service in one request.
//  - The chart: the whole width under the map. Land is filled in earth colours, lighter at the top and darker with
//    depth; where the line goes below sea level the water is shown and a dashed line marks sea level.
//  - Moving along the chart (pointer, or the arrow keys) shows a dot at that place on the line on the map.
let topoBathy = null, prof = null, profDraft = null, profHover = null, profBusy = 0, profAt = -1;
const profGraphics = { line: null, dot: null, draft: null };
const PROF_LINE = { type: "simple-line", color: [255, 127, 0, 1], width: 3 };
const PROF_DOT = { type: "simple-marker", style: "circle", color: [255, 255, 255, 1], size: 13, outline: { color: [200, 60, 0, 1], width: 3 } };
const profActive = () => openPanelName === "profile";
function setViewCursor(c) { const el = viewEls.get(view); try { if (el) el.style.cursor = c || ""; if (view.container) view.container.style.cursor = c || ""; } catch (e) { /* no container */ } }
function profShow(key, graphic) {
  for (const v of [mapView, sceneView]) if (v && profGraphics[key] && v.graphics.includes(profGraphics[key])) v.graphics.remove(profGraphics[key]);
  profGraphics[key] = graphic; if (graphic) view.graphics.add(graphic);
}
function ensureProfile() {
  if (!topoBathy) {
    topoBathy = new ElevationLayer({ url: TOPOBATHY_URL });
    topoBathy.load().then(() => {   // credit the data, as the map's attribution would if it were on the map
      const src = topoBathy.copyright || "";
      $("profileSource").textContent = src ? t("profileSource", { src }) : ""; $("profileSource").title = src;
    }).catch(() => {});
  }
  fillProfileLines();
  if (prof) { profShow("line", new Graphic({ geometry: prof.line, symbol: PROF_LINE })); renderProfile(); } else profMessage(S.profileHint);
  setViewCursor("crosshair");
}
function stopProfile() {
  profDraft = null; profHover = null; profBusy++;
  for (const k of ["line", "dot", "draft"]) profShow(k, null);
  setViewCursor("");
}
function clearProfile() { prof = null; profAt = -1; profDraft = null; for (const k of ["line", "dot", "draft"]) profShow(k, null); $("profLines").value = ""; profMessage(S.profileHint); $("profStats").replaceChildren(); $("profNew").hidden = true; }
function profMessage(text) { $("profChart").replaceChildren(); const p = document.createElement("p"); p.className = "prof-msg"; p.textContent = text; $("profChart").appendChild(p); $("profStatus").textContent = text; }
// the lines that can be chosen without the pointer: the sketched lines, by name
function sketchLines() { return graphicsLayer.graphics.filter((g) => g.geometry && g.geometry.type === "polyline").toArray(); }
function fillProfileLines() {
  const sel = $("profLines"), lines = sketchLines();
  sel.replaceChildren(new Option(S.profilePickLine, ""));
  lines.forEach((g, i) => sel.appendChild(new Option((g.attributes && g.attributes.title) || t("profileLineN", { n: i + 1 }), String(i))));
  $("profLinesWrap").hidden = !lines.length;
}
// --- the line's points and their heights
const R_EARTH = 6371008.8, D2R = Math.PI / 180;
const lonLatToXY = (lon, lat) => [lon * D2R * 6378137, Math.log(Math.tan(Math.PI / 4 + (lat * D2R) / 2)) * 6378137];
function haversine(a, b) { const dLat = (b[1] - a[1]) * D2R, dLon = (b[0] - a[0]) * D2R, h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * D2R) * Math.cos(b[1] * D2R) * Math.sin(dLon / 2) ** 2; return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(h))); }
// The shortest way round the Earth between two places (a great circle), as longitudes and latitudes; the longitudes run
// on past 180 rather than jumping, so the line stays in one piece on the map.
const llUnit = ([lon, lat]) => [Math.cos(lat * D2R) * Math.cos(lon * D2R), Math.cos(lat * D2R) * Math.sin(lon * D2R), Math.sin(lat * D2R)];
function geoBetween(p, q, f) {
  const u = llUnit(p), v = llUnit(q), w = Math.acos(Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1] + u[2] * v[2])));
  if (w < 1e-9) return [p[0], p[1]];
  const k1 = Math.sin((1 - f) * w) / Math.sin(w), k2 = Math.sin(f * w) / Math.sin(w), x = k1 * u[0] + k2 * v[0], y = k1 * u[1] + k2 * v[1], z = k1 * u[2] + k2 * v[2];
  let lon = Math.atan2(y, x) / D2R; const ref = p[0] + (q[0] - p[0]) * f; lon += Math.round((ref - lon) / 360) * 360;
  return [lon, Math.atan2(z, Math.hypot(x, y)) / D2R];
}
const isMerc = (sr) => !!sr && (sr.isWebMercator || sr.wkid === 102100 || sr.wkid === 3857);
const PROF_MAX_LAT = 85;   // Web Mercator has no poles
const llToXY = (ll) => lonLatToXY(ll[0], Math.max(-PROF_MAX_LAT, Math.min(PROF_MAX_LAT, ll[1])));
// the points clicked (Web Mercator), joined by great circles, as a line the map can draw
function geodesicLine(clicks, perPart) {
  const ll = clicks.map((c) => xyToLonLat(c.x, c.y)); for (let i = 1; i < ll.length; i++) ll[i][0] += Math.round((ll[i - 1][0] - ll[i][0]) / 360) * 360;   // each the short way from the last
  const path = [llToXY(ll[0])];
  for (let i = 1; i < ll.length; i++) for (let k = 1; k <= perPart; k++) path.push(llToXY(geoBetween(ll[i - 1], ll[i], k / perPart)));
  return { ll, geometry: { type: "polyline", paths: [path], spatialReference: { wkid: 102100 } } };
}
// A line drawn in the tool is geodesic: `via` is its clicked places (longitude, latitude). A line chosen on the map (a
// sketch, a feature) is followed as it is drawn there, straight between its points in Web Mercator.
async function profileOf(geometry, via) {
  const sr = geometry.spatialReference, merc = sr && (sr.isWebMercator || sr.wkid === 102100 || sr.wkid === 3857), geo = sr && (sr.isWGS84 || sr.wkid === 4326);
  if (!merc && !geo) { profMessage(S.profileNoSR); return; }
  const verts = []; if (via) verts.push(...via); else for (const path of geometry.paths) for (const c of path) verts.push(merc ? [c[0], c[1]] : lonLatToXY(c[0], c[1]));
  if (verts.length < 2) return;
  const segs = []; let total = 0; for (let i = 1; i < verts.length; i++) { const l = via ? haversine(verts[i - 1], verts[i]) : Math.hypot(verts[i][0] - verts[i - 1][0], verts[i][1] - verts[i - 1][1]); segs.push(l); total += l; }
  if (!(total > 0)) return;
  const N = Math.min(512, Math.max(120, Math.round(($("profChart").clientWidth || 900) / 2.5)));
  const pts = [];
  for (let k = 0; k < N; k++) {
    let d = (total * k) / (N - 1), i = 0; while (i < segs.length - 1 && d > segs[i]) { d -= segs[i]; i++; }
    const f = segs[i] ? Math.min(1, d / segs[i]) : 0;
    if (via) { const g = geoBetween(verts[i], verts[i + 1], f), xy = llToXY(g); pts.push({ x: xy[0], y: xy[1], ll: [((g[0] + 540) % 360 + 360) % 360 - 180, g[1]] }); }
    else { const x = verts[i][0] + (verts[i + 1][0] - verts[i][0]) * f, y = verts[i][1] + (verts[i + 1][1] - verts[i][1]) * f; pts.push({ x, y, ll: xyToLonLat(x, y) }); }
  }
  const seq = ++profBusy;
  profMessage(S.profileWorking);
  profShow("line", new Graphic({ geometry, symbol: PROF_LINE })); profShow("draft", null); profShow("dot", null);
  let z;
  try {
    const res = await topoBathy.queryElevation({ type: "polyline", paths: [pts.map((p) => p.ll)], spatialReference: { wkid: 4326 } }, { demResolution: "auto", noDataValue: NaN });
    z = res.geometry.paths[0].map((c) => c[2]);
  } catch (e) { console.error("Elevation not available", e); if (seq === profBusy) profMessage(S.profileFailed); return; }
  if (seq !== profBusy || !profActive()) return;
  let dist = 0, last = null, gain = 0, loss = 0, min = Infinity, max = -Infinity;
  pts.forEach((p, i) => {
    if (i) dist += haversine(pts[i - 1].ll, p.ll);
    p.d = dist; p.z = Number.isFinite(z[i]) ? z[i] : last;
    if (p.z != null) { if (last != null) { const dz = p.z - last; if (dz > 0) gain += dz; else loss -= dz; } last = p.z; min = Math.min(min, p.z); max = Math.max(max, p.z); }
  });
  const first = pts.find((p) => p.z != null); if (!first) { profMessage(S.profileFailed); return; }
  for (const p of pts) { if (p.z == null) p.z = first.z; }
  prof = { line: geometry, sr, pts, total: dist, min, max, gain, loss };
  profAt = -1; $("profNew").hidden = false;
  renderProfile();
}
// --- numbers, in the units the app is set to
const profNum = (v, places) => new Intl.NumberFormat(S.locale || undefined, { maximumFractionDigits: places, minimumFractionDigits: 0 }).format(v);
function profHeight(m) { const v = units === "imperial" ? m * 3.28084 : m; return profNum(Math.round(v) === 0 ? 0 : v, 0) + (units === "imperial" ? " ft" : " m"); }
function profDist(m, totalM) {
  if (units === "imperial") { const mi = m / 1609.344; return totalM < 1609.344 ? profNum(m * 3.28084, 0) + " ft" : profNum(mi, totalM < 16093 ? 1 : 0) + " mi"; }
  return totalM < 1000 ? profNum(m, 0) + " m" : profNum(m / 1000, totalM < 10000 ? 1 : 0) + " km";
}
function niceTicks(lo, hi, want) {
  const span = hi - lo || 1, raw = span / want, pow = 10 ** Math.floor(Math.log10(raw)), step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((st) => span / st <= want) || 10 * pow;
  const out = []; for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-6; v += step) out.push(Math.abs(v) < step * 1e-6 ? 0 : v);
  return out;
}
// --- the chart
const SVGNS = "http://www.w3.org/2000/svg";
function svgEl(tag, attrs, text) { const e = document.createElementNS(SVGNS, tag); for (const k in attrs || {}) e.setAttribute(k, attrs[k]); if (text != null) e.textContent = text; return e; }
let profScale = null;
function renderProfile() {
  if (!prof || !profActive()) return;
  const host = $("profChart"), W = Math.max(320, host.clientWidth), H = Math.max(120, host.clientHeight);
  const m = { l: 66, r: 18, t: 16, b: 30 }, w = W - m.l - m.r, h = H - m.t - m.b;
  const hz = units === "imperial" ? 3.28084 : 1, unitDist = units === "imperial" ? (prof.total < 1609.344 ? 0.3048 : 1609.344) : (prof.total < 1000 ? 1 : 1000);
  // the height axis: the line's own range with room above and below; sea level is always in view when the line goes below it
  let lo = prof.min, hi = prof.max; const pad = Math.max((hi - lo) * 0.12, 5); lo -= pad; hi += pad;
  const under = prof.min < 0; if (under && hi < 0) hi = pad;
  const X = (d) => m.l + (prof.total ? (d / prof.total) * w : 0), Y = (z) => m.t + (1 - (z - lo) / (hi - lo)) * h;
  profScale = { X, Y, m, w, h, W, H };
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, "aria-hidden": "true", focusable: "false", class: "prof-svg" });
  const defs = svgEl("defs");
  // earth: light at the surface, darker with depth (from the top of the chart to its bottom)
  const earth = svgEl("linearGradient", { id: "profEarth", gradientUnits: "userSpaceOnUse", x1: 0, x2: 0, y1: Y(prof.max), y2: m.t + h });
  for (const [o, c] of [[0, "#ead9b0"], [0.3, "#cfa76a"], [0.65, "#96622f"], [1, "#4b2e17"]]) earth.appendChild(svgEl("stop", { offset: o, "stop-color": c }));
  const water = svgEl("linearGradient", { id: "profWater", gradientUnits: "userSpaceOnUse", x1: 0, x2: 0, y1: Y(0), y2: m.t + h });
  for (const [o, c] of [[0, "#a9d6f0"], [1, "#3d86c0"]]) water.appendChild(svgEl("stop", { offset: o, "stop-color": c }));
  defs.append(earth, water); svg.appendChild(defs);
  svg.appendChild(svgEl("rect", { x: m.l, y: m.t, width: w, height: h, fill: "#fbfaf7" }));
  // grid and the height scale
  for (const v of niceTicks(lo * hz, hi * hz, Math.max(2, Math.min(5, Math.floor(h / 34))))) {
    const y = Y(v / hz); if (y < m.t - 0.5 || y > m.t + h + 0.5) continue;
    svg.appendChild(svgEl("line", { x1: m.l, x2: m.l + w, y1: y, y2: y, stroke: "#dcd8cf", "stroke-width": 1 }));
    svg.appendChild(svgEl("text", { x: m.l - 8, y: y + 4.5, "text-anchor": "end", class: "prof-tick" }, profNum(v, 0) + (units === "imperial" ? " ft" : " m")));
  }
  if (under) svg.appendChild(svgEl("rect", { x: m.l, y: Y(0), width: w, height: m.t + h - Y(0), fill: "url(#profWater)", class: "prof-water" }));
  const top = prof.pts.map((p, i) => (i ? "L" : "M") + X(p.d).toFixed(1) + " " + Y(p.z).toFixed(1)).join("");
  svg.appendChild(svgEl("path", { d: top + `L${(m.l + w).toFixed(1)} ${m.t + h}L${m.l} ${m.t + h}Z`, fill: "url(#profEarth)", class: "prof-land" }));
  svg.appendChild(svgEl("path", { d: top, fill: "none", stroke: "#3a2412", "stroke-width": 1, "stroke-linejoin": "round", class: "prof-top" }));
  if (under) {   // sea level, where the line goes below it
    svg.appendChild(svgEl("line", { x1: m.l, x2: m.l + w, y1: Y(0), y2: Y(0), stroke: "#0b4f8a", "stroke-width": 2, "stroke-dasharray": "7 5", class: "prof-sea" }));
    const atStart = prof.pts[0].z < prof.pts[prof.pts.length - 1].z;   // named at the end that is under water, clear of the land
    svg.appendChild(svgEl("text", { x: atStart ? m.l + 6 : m.l + w - 6, y: Y(0) - 6, "text-anchor": atStart ? "start" : "end", class: "prof-sea-label" }, S.profileSeaLevel));
  }
  // the distance scale
  for (const v of niceTicks(0, prof.total / unitDist, Math.max(3, Math.min(10, Math.floor(w / 110))))) {
    const x = X(v * unitDist);
    svg.appendChild(svgEl("line", { x1: x, x2: x, y1: m.t + h, y2: m.t + h + 5, stroke: "#4a4a4a", "stroke-width": 1 }));
    svg.appendChild(svgEl("text", { x, y: m.t + h + 20, "text-anchor": v === 0 ? "start" : (x > m.l + w - 34 ? "end" : "middle"), class: "prof-tick" }, profNum(v, 1) + (units === "imperial" ? (unitDist === 0.3048 ? " ft" : " mi") : (unitDist === 1 ? " m" : " km"))));
  }
  svg.appendChild(svgEl("rect", { x: m.l, y: m.t, width: w, height: h, fill: "none", stroke: "#8a8a8a", "stroke-width": 1 }));
  // the place the pointer (or the arrow keys) is at
  const g = svgEl("g", { id: "profMark", visibility: "hidden" });
  g.append(svgEl("line", { id: "profGuide", y1: m.t, y2: m.t + h, stroke: "#1f1f1f", "stroke-width": 1.5 }), svgEl("circle", { id: "profPoint", r: 6, fill: "#fff", stroke: "#c83c00", "stroke-width": 3 }));
  svg.appendChild(g);
  host.replaceChildren(svg);
  const tip = document.createElement("div"); tip.className = "prof-tip"; tip.id = "profTip"; tip.hidden = true; host.appendChild(tip);
  // what the chart says, in words, and the figures along the bottom
  const stats = [[S.profileLength, profDist(prof.total, prof.total)], [S.profileHighest, profHeight(prof.max)], [S.profileLowest, profHeight(prof.min)], [S.profileClimb, profHeight(prof.gain)], [S.profileDescent, profHeight(prof.loss)]];
  $("profStats").replaceChildren(...stats.map(([k, v]) => { const d = document.createElement("div"); d.className = "prof-stat"; const dt = document.createElement("dt"); dt.textContent = k; const dd = document.createElement("dd"); dd.textContent = v; d.append(dt, dd); return d; }));
  $("profStatus").textContent = t("profileSummary", { length: stats[0][1], high: stats[1][1], low: stats[2][1] }) + (under ? " " + S.profileBelowSea : "");
  host.setAttribute("aria-valuemin", "0"); host.setAttribute("aria-valuemax", String(prof.pts.length - 1));
  profMark(profAt, false);
}
function profMark(i, announce) {
  const host = $("profChart"), mark = document.getElementById("profMark"), tip = $("profTip");
  if (!prof || !mark || !profScale) return;
  if (i < 0 || i >= prof.pts.length) { profAt = -1; mark.setAttribute("visibility", "hidden"); if (tip) tip.hidden = true; profShow("dot", null); host.setAttribute("aria-valuenow", "0"); host.setAttribute("aria-valuetext", S.profileNoPlace); return; }
  profAt = i; const p = prof.pts[i], x = profScale.X(p.d), y = profScale.Y(p.z);
  mark.setAttribute("visibility", "visible");
  const gl = document.getElementById("profGuide"); gl.setAttribute("x1", x); gl.setAttribute("x2", x);
  const pt = document.getElementById("profPoint"); pt.setAttribute("cx", x); pt.setAttribute("cy", y);
  const text = t("profileAt", { dist: profDist(p.d, prof.total), height: profHeight(p.z) });
  tip.textContent = text; tip.hidden = false;
  const tw = tip.offsetWidth || 150; tip.style.left = Math.max(profScale.m.l, Math.min(profScale.W - tw - 6, x + (x + tw + 18 > profScale.W ? -tw - 12 : 12))) + "px"; tip.style.top = Math.max(2, Math.min(profScale.m.t + profScale.h - 34, y - 38)) + "px";
  host.setAttribute("aria-valuenow", String(i)); host.setAttribute("aria-valuetext", text);
  // the same place on the line on the map
  const geom = { type: "point", x: p.x, y: p.y, spatialReference: { wkid: 102100 } };
  if (profGraphics.dot && view.graphics.includes(profGraphics.dot)) profGraphics.dot.geometry = geom; else profShow("dot", new Graphic({ geometry: geom, symbol: PROF_DOT }));
}
{
  const host = $("profChart");
  const at = (e) => { if (!prof || !profScale) return -1; const r = host.getBoundingClientRect(), x = e.clientX - r.left; if (x < profScale.m.l - 4 || x > profScale.m.l + profScale.w + 4) return -1; return Math.max(0, Math.min(prof.pts.length - 1, Math.round(((x - profScale.m.l) / profScale.w) * (prof.pts.length - 1)))); };
  host.addEventListener("pointermove", (e) => profMark(at(e)));
  host.addEventListener("pointerdown", (e) => profMark(at(e)));
  host.addEventListener("pointerleave", () => { if (document.activeElement !== host) profMark(-1); });
  host.addEventListener("blur", () => profMark(-1));
  host.addEventListener("keydown", (e) => {
    if (!prof) return; const n = prof.pts.length, step = e.shiftKey ? Math.round(n / 10) : Math.max(1, Math.round(n / 100));
    const to = { ArrowRight: profAt + step, ArrowUp: profAt + step, ArrowLeft: profAt - step, ArrowDown: profAt - step, Home: 0, End: n - 1, PageUp: profAt + Math.round(n / 10), PageDown: profAt - Math.round(n / 10) }[e.key];
    if (to === undefined) return; e.preventDefault(); profMark(Math.max(0, Math.min(n - 1, profAt < 0 && !["Home", "End"].includes(e.key) ? 0 : to)));
  });
  if (typeof ResizeObserver !== "undefined") { let rt = 0; new ResizeObserver(() => { clearTimeout(rt); rt = setTimeout(() => { if (prof && profActive()) renderProfile(); }, 80); }).observe(host); }
  $("profNew").addEventListener("click", () => { clearProfile(); setViewCursor("crosshair"); });
  $("profLines").addEventListener("change", () => { const g = sketchLines()[Number($("profLines").value)]; if ($("profLines").value !== "" && g) profileOf(g.geometry.clone()); });
}
// --- on the map: choose a line, or draw one
const lineUnder = async (e) => {
  try { const hit = await view.hitTest(e); const r = (hit.results || []).find((x) => x.type === "graphic" && x.graphic && x.graphic.geometry && x.graphic.geometry.type === "polyline" && x.graphic !== profGraphics.line && x.graphic !== profGraphics.draft); return r ? r.graphic : null; } catch (err) { return null; }
};
let hoverTimer = 0, hoverSeq = 0;
onViews("pointer-move", (e) => {
  if (!profActive()) return;
  if (profDraft) {   // the line so far, and on to the pointer
    const p = view.toMap({ x: e.x, y: e.y }); if (!p) return;
    const g = isMerc(p.spatialReference) ? geodesicLine([...profDraft, p], 48).geometry   // as it will be: the shortest way round
      : { type: "polyline", paths: [[...profDraft.map((c) => [c.x, c.y]), [p.x, p.y]]], spatialReference: p.spatialReference };
    if (profGraphics.draft && view.graphics.includes(profGraphics.draft)) profGraphics.draft.geometry = g; else profShow("draft", new Graphic({ geometry: g, symbol: { ...PROF_LINE, style: "short-dash" } }));
    return;
  }
  clearTimeout(hoverTimer); const seq = ++hoverSeq;
  hoverTimer = setTimeout(async () => { const g = await lineUnder(e); if (seq !== hoverSeq || !profActive() || profDraft) return; profHover = g; setViewCursor(g ? "pointer" : "crosshair"); }, 40);   // a hand over a line that can be chosen
});
// Points are taken on "immediate-click": the view's "click" waits to see whether a double-click follows, and is not
// sent at all when one does, so the place double-clicked would never be added to the line.
onViews("click", (e) => { if (profActive()) e.stopPropagation(); });   // no pop-ups while the tool is open
onViews("immediate-click", async (e) => {
  if (!profActive() || e.button === 2) return;
  if (!profDraft) {
    const g = profHover || await lineUnder(e);
    if (g) { profHover = null; setViewCursor("crosshair"); $("profLines").value = ""; profileOf(g.geometry.clone()); return; }   // a line on the map was chosen
    if (prof) clearProfile();
    profDraft = [];
  }
  if (!e.mapPoint) return;
  const last = profDraft[profDraft.length - 1];   // the second click of a double-click is the same place: once only
  if (!last || Math.hypot(last.sx - e.x, last.sy - e.y) > 4) { const q = e.mapPoint; profDraft.push({ x: q.x, y: q.y, spatialReference: q.spatialReference, sx: e.x, sy: e.y }); }
  if (profDraft.length === 1) profMessage(S.profileDrawing);
});
function finishProfileDraft() {
  if (!profDraft) return;
  const pts = profDraft; profDraft = null; profShow("draft", null);
  if (pts.length < 2) { profMessage(S.profileHint); return; }
  if (!isMerc(pts[0].spatialReference)) { profileOf({ type: "polyline", paths: [pts.map((c) => [c.x, c.y])], spatialReference: pts[0].spatialReference }); return; }   // a map in another coordinate system: as drawn
  const g = geodesicLine(pts, 96); profileOf(g.geometry, g.ll);
}
onViews("double-click", (e) => { if (!profActive()) return; e.stopPropagation(); if (profDraft) finishProfileDraft(); });
onViews("key-down", (e) => { if (!profActive() || !profDraft) return; if (e.key === "Enter") { e.stopPropagation(); finishProfileDraft(); } else if (e.key === "Escape") { e.stopPropagation(); profDraft = null; profShow("draft", null); profMessage(S.profileHint); } });

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
$("menuMeasure").addEventListener("click", () => { closeToolMenu(false); leaveData(() => openPanel("measure")); });
$("menuProfile").addEventListener("click", () => { closeToolMenu(false); leaveData(() => openPanel("profile")); });
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
// How much work the 3D view does (5.0.0-beta.3). "low" asks the SDK for its low quality profile (smaller textures, less
// memory, simpler sky) and leaves out shadows and stars. With threeDQuality "auto" (the default) a device gets "low" when
// it has little memory or few processor cores, or draws 3D without a graphics chip; otherwise "medium". A config or a
// link (?quality=low|medium|high) can fix it.
function pick3dQuality() {
  const asked = String(params.get("quality") || cfg.threeDQuality || "auto").toLowerCase();
  if (["low", "medium", "high"].includes(asked)) return { quality: asked, why: "set" };
  let software = false;
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    const ext = gl && gl.getExtension("WEBGL_debug_renderer_info");
    const r = gl ? String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) : "";
    software = !gl || /swiftshader|llvmpipe|software|basic render/i.test(r);
    const lose = gl && gl.getExtension("WEBGL_lose_context"); if (lose) lose.loseContext();
  } catch (e) { software = true; }
  const mem = navigator.deviceMemory, cores = navigator.hardwareConcurrency;
  if (software) return { quality: "low", why: "software" };
  if ((typeof mem === "number" && mem <= 4) || (typeof cores === "number" && cores <= 4)) return { quality: "low", why: "device" };
  return { quality: "medium", why: "device" };
}
let quality3d = null;
function tune3d(v) {
  if (quality3d.quality !== "low") return;
  const calm = () => { try { const env = v.environment; if (env) { env.starsEnabled = false; env.atmosphereEnabled = true; if (env.lighting) { env.lighting.directShadowsEnabled = false; env.lighting.ambientOcclusionEnabled = false; } if (env.atmosphere) env.atmosphere.quality = "low"; } } catch (e) { /* keep the SDK's own */ } };
  calm(); reactiveUtils.watch(() => v.map, () => v.when().then(calm).catch(() => {}));   // a scene brings its own lighting
}
const TILT_3D = Math.max(0, Math.min(80, Number(cfg.threeDTilt) || 0));
// Which views a map allows (5.0.0-beta.9):
//  - a web scene is 3D only (sceneOnly): it can hold layers and a camera that have no 2D form
//  - a web map tagged "atlas-2d-only" on its ArcGIS Online item is 2D only (twoDOnly): its author switched 3D off
const TAG_2D_ONLY = "atlas-2d-only";
let sceneOnly = false, twoDOnly = false;
const isScene = (m) => !!m && m.declaredClass === "esri.WebScene";
const has2dOnlyTag = (item) => !!item && Array.isArray(item.tags) && item.tags.some((tg) => String(tg).trim().toLowerCase() === TAG_2D_ONLY);
function syncViewLocks() {
  const lock = (id, on, why) => { const b = $(id); if (on) { b.setAttribute("aria-disabled", "true"); b.title = why; } else { b.removeAttribute("aria-disabled"); b.removeAttribute("title"); } };
  lock("tg2d", sceneOnly, S.only3d); lock("tg3d", twoDOnly, S.only2d);
}
async function setMode(m, opts) {
  opts = opts || {};
  if ((m === mode && !opts.force) || switching) return;
  if (m === "3d" && F.threeD === false) return;
  if (m === "2d" && sceneOnly) { toast(S.only3d, 5000); return; }
  if (m === "3d" && twoDOnly) { toast(S.only2d, 5000); return; }
  if (openPanelName === "filter") closePanels(false);   // the filter preview belongs to this view's copy of the layer
  switching = true;
  const from = view, vp = !opts.map && from.viewpoint ? from.viewpoint.clone() : null, curMap = opts.map || from.map;
  stopMeasuring();
  endSketchOps();
  try {
    if (m === "3d") {
      if (!isScene(curMap) && (!curMap.ground || !curMap.ground.layers || !curMap.ground.layers.length)) curMap.ground = "world-elevation";
      $("sceneDiv").hidden = false;
      // A scene is either a globe or a flat "local" scene, fixed when its view is made: a scene of the other kind gets a new view.
      const wantMode = isScene(curMap) && curMap.initialViewProperties && curMap.initialViewProperties.viewingMode;
      if (sceneView && wantMode && sceneView.viewingMode !== wantMode) { const oldEl = viewEls.get(sceneView); viewEls.delete(sceneView); try { oldEl.destroy(); } catch (e) { /* gone */ } oldEl.remove(); sceneView = null; }
      if (!quality3d) { quality3d = pick3dQuality(); console.info("3D quality", quality3d.quality, "(" + quality3d.why + ")"); document.documentElement.dataset.quality3d = quality3d.quality; }
      if (!sceneView) { sceneView = await componentView("arcgis-scene", "sceneDiv", { map: curMap, qualityProfile: quality3d.quality }); tune3d(sceneView); addViewUI(sceneView, true);
        // the layer count and the basemap gallery now follow the 3D view's map too (see shownMap)
        reactiveUtils.watch(listedLayerCount, updateToolBadges, { initial: true });
        reactiveUtils.watch(() => { const m = shownMap(), b = m && m.basemap; return b ? ((b.portalItem && b.portalItem.id) || "") + "|" + (b.title || "") : ""; }, syncGallerySelection); viewHandlers.forEach((h) => sceneView.on(h[0], h[1])); }
      else if (sceneView.map !== curMap) setViewMap(sceneView, curMap);
      await sceneView.when();
      if (vp) sceneView.viewpoint = vp;
      $("viewDiv").hidden = true; view = sceneView;
      // Same place, then tilt the camera towards the horizon so it's obvious the view is now 3D.
      // (At a whole-world scale the SDK allows little tilt, but the globe itself shows the change.)
      if (TILT_3D && !opts.keepCamera) viewSettled = sceneView.goTo({ tilt: TILT_3D }, { animate: !reduceMotion, duration: 1400 }).catch(() => {});
    } else {
      $("viewDiv").hidden = false;
      if (mapView.map !== curMap) setViewMap(mapView, curMap);
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
  sketchReady.then(() => { sketch.view = view; });
  if (timeBar) { const te = timeBar.timeExtent; timeBar.view = view; if (te) view.timeExtent = te; }   // the time control follows into 2D / 3D
  if (gallery.items) renderGallery();   // 3D lists the group's 3D basemaps too
  if (profActive()) { for (const k of ["line", "dot", "draft"]) profShow(k, null); profDraft = null; ensureProfile(); }   // the profile's line follows to the other view
  if (coordWidget) coordWidget.view = view;
  if (legend) legend.view = view;
  if (m === "3d") endSwipe();   // Swipe is for 2D maps
  if (table && table.widget) { if (table.kind === "chart") { try { const src = view.selectionManager && view.selectionManager.sources; if (src && !src.includes(table.layer)) src.add(table.layer); } catch (e) { /* no selection on this view */ } } table.widget.view = view; }
  if (!$("layersPanel").hidden) renderLayers({ keepFocus: true });
  updatePopupEnabled();
  watchBottom(0);
  if (m === "3d" && dataLayers.some((l) => l.renderer && l.renderer.type === "pie-chart")) toast(S.pieIn3d);
  dataLayers.concat(previewLayer ? [previewLayer] : []).forEach(syncColumns);
  if (addState && !$("dataPanel").hidden) { renderStyleList(); renderFieldRows(); }   // what the styles offer depends on the view
}
$("tg2d").addEventListener("click", () => setMode("2d"));
$("tg3d").addEventListener("click", () => setMode("3d"));

// ============================================================ Maps and layers
function setActiveMap(m) {
  const old = view.map;
  endLayerTools(null);
  if (old && old !== m) { try { old.remove(graphicsLayer); } catch (e) { /* not there */ } }
  if (!m.layers.includes(graphicsLayer)) m.add(graphicsLayer);
  // a web scene is shown by the 3D view only; the 2D view goes back to the plain starting map meanwhile
  sceneOnly = isScene(m); twoDOnly = false;
  setViewMap(mapView, sceneOnly ? localMap : m);
  if (sceneView) setViewMap(sceneView, m);
  syncViewLocks();
  updateToolBadges();
  syncTimeBar();
}
// ---- Time (time-aware maps)
// A map saved with time settings (web map: widgets.timeSlider) gets a time control above the toolbar, as in MapMaker:
// play, step, and a slider across the map's time span. It is the SDK's Time Bar component (5.2; it replaces the Time
// Slider), which reads the map's own settings and sets the view's time. Other maps don't show it.
let timeBar = null;
const timeSettings = (m) => (m && m.widgets && m.widgets.timeSlider) || null;
function syncTimeBar() {
  const host = $("timeHost"); if (!host) return;
  const on = F.time !== false && !!timeSettings(view && view.map);
  if (timeBar) { try { timeBar.stop(); } catch (e) { /* not playing */ } timeBar.remove(); timeBar = null; }
  for (const v of [mapView, sceneView]) { if (v && !on) v.timeExtent = null; }   // the last map's time filter doesn't carry over
  host.hidden = !on; $("app").classList.toggle("has-time", on);
  if (!on) return;
  timeBar = document.createElement("arcgis-time-bar");
  for (const a of ["show-play", "show-previous", "show-next", "show-time-extent", "show-settings"]) timeBar.setAttribute(a, "");
  timeBar.setAttribute("label", S.timeTool);
  // the slider takes the place of the bar's date label (its "time-extent" slot) and shows the dates itself
  const slider = document.createElement("arcgis-time-bar-slider"); slider.slot = "time-extent";
  for (const a of ["show-ticks", "show-min", "show-max"]) slider.setAttribute(a, "");
  timeBar.appendChild(slider);
  host.appendChild(timeBar);
  timeBar.view = view;
}
// The time settings to save: the map's own, with where the slider is now.
function timeWidgetsJson() {
  const ts = timeSettings(view && view.map);
  if (!ts) return null;
  let props = {};
  try { props = { ...((typeof ts.toJSON === "function" ? ts.toJSON() : ts).properties || {}) }; } catch (e) { props = {}; }
  if (currentSource && currentSource.data && currentSource.data.widgets) props = { ...currentSource.data.widgets.timeSlider.properties, ...props };
  const te = timeBar && timeBar.timeExtent;
  if (te && (te.start || te.end)) props.currentTimeExtent = [te.start ? te.start.getTime() : null, te.end ? te.end.getTime() : null];
  return { timeSlider: { properties: props } };
}
// Toolbar badges, as MapMaker shows them: the number of layers on Map layers, and a dot on Bookmarks when the map has
// bookmarks. The count is the map's top-level layers as Map layers lists them (a group counts once, as in MapMaker:
// 6 for "1777-1778 Revolutionary Battles", which has 4 layers and 2 groups); the sketch layer and a CSV preview don't count.
// The map on show, read from the views themselves so that watchers follow it: the 3D view's when it holds a web scene
// (which the 2D view never shows), otherwise the 2D view's. (Before beta.3 the layer count and the basemap gallery
// looked at the 2D view only, so in a scene the count stayed at 0.)
function shownMap() { return sceneView && isScene(sceneView.map) ? sceneView.map : mapView && mapView.map; }
function listedLayerCount() {
  const m = shownMap();
  let n = 0;
  if (m) m.layers.forEach((l) => { if (l.listMode !== "hide" && l !== previewLayer) n++; });
  return n;
}
function updateToolBadges() {
  const n = listedLayerCount(), b = $("layersBadge");
  b.textContent = n > 99 ? "99+" : String(n); b.hidden = !n;
  $("layersBadgeSr").textContent = n ? ", " + (n === 1 ? S.layersCountOne : t("layersCount", { n })) : "";
  const k = bookmarks.length;
  $("bookmarksDot").hidden = !k;
  $("bookmarksDotSr").textContent = k ? ", " + (k === 1 ? S.bookmarksCountOne : t("bookmarksCount", { n: k })) : "";
}
function keepSketchOnTop() { const m = activeMap(); try { m.reorder(graphicsLayer, m.layers.length - 1); } catch (e) { /* ok */ } }
function removeFromMaps(l) { for (const m of new Set([localMap, mapView.map, sceneView && sceneView.map])) { if (m) { try { m.remove(l); } catch (e) { /* not there */ } } } }
function resetWorkspace() {
  if (openPanelName === "filter") closePanels(false);
  addState = null; removePreview(false);
  endLayerTools(null);
  dataLayers.splice(0).forEach(removeFromMaps);
  [...portalLayers.values()].forEach(removeFromMaps); portalLayers.clear();
  endSketchOps(); graphicsLayer.removeAll(); graphicsLayer.visible = true; setSelection([]);
  bookmarks = []; updateToolBadges();
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
  bookmarks = parsed.bookmarks; updateToolBadges();
  keepSketchOnTop();
}
// The item's details and its map JSON, as the SDK fetched them when it loaded the map. (Before 5.0.0-beta.9 the app
// asked ArcGIS Online for both itself as well, so each was downloaded twice.) If the SDK doesn't hand them over, they are fetched.
async function loadedItemJson(m, itemId) {
  const copy = (o) => (o && typeof o === "object" ? JSON.parse(JSON.stringify(o)) : null);
  const item = copy(m.portalItem && m.portalItem.sourceJSON), data = copy(m.resourceInfo);
  if (item && item.id === itemId && data && Array.isArray(data.operationalLayers)) return { item, data };
  const [i, d] = await Promise.all([restGet(`/sharing/rest/content/items/${itemId}`), restGet(`/sharing/rest/content/items/${itemId}/data`)]);
  return { item: i, data: d };
}
async function openWebMapItem(itemId, opts) {
  opts = opts || {};
  if (!HEX32.test(itemId || "")) return false;
  if (!opts.keepWorkspace && !opts.skipConfirm && !confirmDiscard()) return false;
  closeModal("openModal");
  if (!opts.quiet) toast(t("openingMap", { title: opts.title || "" }));
  try {
    const wm = takePreloaded(itemId, WebMap);
    await wm.load();
    const { item, data } = await loadedItemJson(wm, itemId);
    const parsed = readWebMap(data, { trusted: true });
    if (!parsed.ok) throw new Error("Not a web map");
    if (!opts.keepWorkspace) resetWorkspace();
    for (const op of (data.operationalLayers || []).filter(isOwnLayerJson)) { const l = wm.layers.find((x) => x.id === op.id); if (l) wm.remove(l); }
    const wasScene = sceneOnly;
    setActiveMap(wm);
    twoDOnly = has2dOnlyTag(item); syncViewLocks();
    if (mode === "3d" && (twoDOnly || wasScene)) await setMode("2d");   // a web map opens in 2D after a scene, and always when its author switched 3D off
    // A map that isn't public, opened while signed in, can hold layers only that account can see. Its layers are never written to a file.
    currentSource = { itemId, title: item.title, item, data: parsed.webmap, restricted: !!portalUser && !!item.access && item.access !== "public" };
    if (portalUser && item.owner === portalUser.username) currentAgolItem = { id: itemId, owner: item.owner, title: item.title };
    if (!opts.keepWorkspace) {
      applyParsedWebMap(parsed);
      setTitle(item.title); markClean(); unbindFile();
      const vp = wm.initialViewProperties && wm.initialViewProperties.viewpoint;
      if (vp) goToSafe(vp, { animate: false });
      if (!opts.quiet) toast(t("openedMap", { title: item.title }) + chartNote(), chartNote() ? 8000 : undefined);
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
// A web scene from the collection or a link (webscene=<id>). It opens in 3D and stays there: see sceneOnly.
// Its slides become the bookmarks, each with its camera and the layers it shows.
// A slide lists the layers it shows (visibleLayers); every other layer of the scene is off in that slide. The record
// covers the scene's own layers, those inside group layers too, so the sketch layer and anything added later are left as
// they are. A slide with no list (null) changes no layers.
function slideLayers(ws, sl) {
  if (!sl.visibleLayers) return [];
  const on = new Set(sl.visibleLayers.toArray().map((v) => v && v.id));
  return layersDeep(ws).filter((l) => l !== graphicsLayer && l !== previewLayer).map((l) => ({ id: l.id, title: l.title || "", visible: on.has(l.id) }));
}
// The map's data layers, with those inside group layers. Not map.allLayers: that has the basemap and the ground as well.
function layersDeep(m) {
  const out = [];
  const walk = (ls) => ls.forEach((l) => { out.push(l); if (l.type === "group" && l.layers) walk(l.layers); });
  walk(m.layers);
  return out;
}
function slidesToBookmarks(ws) {
  const out = [];
  const slides = ws.presentation && ws.presentation.slides ? ws.presentation.slides.toArray() : [];
  for (const sl of slides) {
    const cam = sl.viewpoint && sl.viewpoint.camera; if (!cam || !cam.position) continue;
    const bm = { title: (sl.title && sl.title.text) || t("bookmarkDefault", { n: out.length + 1 }), viewpoint: { center: [cam.position.longitude, cam.position.latitude], zoom: 10 }, camera: cam.clone(), layers: slideLayers(ws, sl), thumb: null };
    const th = sl.thumbnail && sl.thumbnail.url; if (typeof th === "string" && /^(https:|data:image\/)/i.test(th)) bm.thumb = th;
    out.push(bm);
  }
  return out;
}
async function showScene(ws) {
  const prev = activeMap();
  if (prev && prev !== ws) { try { prev.remove(graphicsLayer); } catch (e) { /* not there */ } }
  twoDOnly = false;
  await setMode("3d", { map: ws, force: true, keepCamera: true });
  if (mode !== "3d") throw new Error("3D view not available");
  setActiveMap(ws);
  const vp = ws.initialViewProperties && ws.initialViewProperties.viewpoint;
  if (vp) goToSafe(vp, { animate: false });
}
async function openWebSceneItem(itemId, opts) {
  opts = opts || {};
  if (!HEX32.test(itemId || "")) return false;
  if (F.threeD === false) { toast(S.no3d, 5000); return false; }
  if (!opts.skipConfirm && !confirmDiscard()) return false;
  closeModal("openModal");
  if (!opts.quiet) toast(t("openingMap", { title: opts.title || "" }));
  try {
    const ws = takePreloaded(itemId, WebScene);
    await ws.load();
    const { item, data } = await loadedItemJson(ws, itemId);
    if (item.type !== "Web Scene") throw new Error("Not a web scene");
    closePanels(false);
    resetWorkspace();
    await showScene(ws);
    currentSource = { itemId, title: item.title, item, data, scene: true, restricted: !!portalUser && !!item.access && item.access !== "public" };
    bookmarks = slidesToBookmarks(ws); updateToolBadges();
    setTitle(item.title); markClean(); unbindFile();
    if (!opts.quiet) toast(t("openedMap", { title: item.title }) + chartNote(), chartNote() ? 8000 : undefined);
    if (!$("bookmarksPanel").hidden) showBmList();
    if (!$("layersPanel").hidden) renderLayers();
    if (catalogLoaded) refreshCatalogButtons();
    if (legend) legend.view = view;
    return true;
  } catch (e) {
    console.error("Open scene failed", e);
    if (!opts.quiet) toast(S.openFailed, 5000);
    return false;
  }
}
// A web scene saved on this device (3.0). Every web address in it was checked by readWebScene.
async function openWebSceneFile(raw, fileName) {
  if (F.threeD === false) { toast(S.no3d, 5000); return false; }
  const parsed = readWebScene(raw);
  if (!parsed.ok) { toast(S[parsed.code] || S.cantRead, 5000); return false; }
  closeModal("openModal");
  closePanels(false);
  try {
    const ws = WebScene.fromJSON(parsed.webscene);
    if (!parsed.webscene.baseMap) ws.basemap = defaultBasemap();
    await ws.load();
    resetWorkspace();
    await showScene(ws);
    const title = titleFromFileName(fileName);
    currentSource = { itemId: null, title, item: null, data: parsed.webscene, scene: true };
    applyParsedWebMap(parsed);
    bookmarks = parsed.bookmarks.map((b) => ({ ...b, camera: Camera.fromJSON(b.camera) })); updateToolBadges();
    setTitle(title);
    if (parsed.camera) goToSafe(Camera.fromJSON(parsed.camera), { animate: false });
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
    console.error("Open scene file failed", e);
    toast(S.cantRead, 5000);
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
    twoDOnly = raw[TWO_D_ONLY_PROP] === true; syncViewLocks();
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
    const by = parsed.webmap.authoringApp, ver = parsed.webmap.authoringAppVersion;
    if (by === AUTHORING_APP && newerVersion(ver, APP_VERSION)) setTimeout(() => toast(t("newerFile", { v: ver }), 7000), parsed.skipped ? 9000 : 3500);
    return true;
  } catch (e) {
    console.error("Open file failed", e);
    toast(S.cantRead, 5000);
    return false;
  }
}

// "1.10.0" is newer than "1.9.0".
function newerVersion(a, b) {
  const pa = String(a || "").split(".").map((x) => parseInt(x, 10) || 0), pb = String(b || "").split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d > 0; }
  return false;
}
function newBlankMap() {
  if (!confirmDiscard()) return;
  closeModal("openModal");
  resetWorkspace();
  setActiveMap(localMap);
  localMap.basemap = defaultBasemap();
  setTitle(""); unbindFile(); markClean();
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
  endLayerTools(l);
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
    title: ld.title || "Data", popupEnabled: true,
    // In 3D the features lie on the ground, drawn on the terrain with the basemap: the view has no height to work out
    // for each one, which keeps a spreadsheet layer cheap on a slow device (CSV 3.5).
    elevationInfo: { mode: "on-the-ground" } };
  if (ld.id) props.id = DATA_LAYER_PREFIX + ld.id;   // same id as its saved operational layer, so bookmarks find it again
  if (ld.renderer) { const rj = ld.renderer; props.renderer = rj.type && rj.type.indexOf("-") >= 0 ? rj : rendererJsonUtils.fromJSON(rj); }
  if (ld.labelingInfo && ld.labelingInfo.length) props.labelingInfo = ld.labelingInfo.map((l) => (l && l.symbol && l.symbol.type === "esriTS" ? LabelClass.fromJSON(l) : l));
  if (ld.definitionExpression) props.definitionExpression = ld.definitionExpression;   // the layer's filter
  if (ld.popupInfo) props.popupTemplate = { title: ld.popupInfo.title || "", content: ld.popupInfo.content || [{ type: "fields", fieldInfos: ld.popupInfo.fieldInfos || [] }], fieldInfos: ld.popupInfo.fieldInfos || [] };
  const fl = new FeatureLayer(props);
  fl._renderer2d = props.renderer || null;
  fl.labelsVisible = ld.showLabels !== false;
  const def = { ...ld }; delete def.visible; delete def.opacity; delete def.showLabels; delete def.definitionExpression;
  fl._srcDef = def;
  syncColumns(fl);
  return fl;
}
// Columns in 3D (lab, features.columns3d): a spreadsheet layer sized by a number column can stand a column on each point
// in the 3D view, its height showing the number. The layer's saved style stays the 2D one (By size and so on); the
// columns are a way of drawing it in 3D, so 2D, the saved file and other apps are unchanged.
const COLUMNS_VERSION = "0.3";   // 0.2: the Size slider sets how thick the columns are. 0.3: the choice is offered in the 3D view only
function columnSymbol(color, width) {
  const c = color && Number.isFinite(color.r) ? [color.r, color.g, color.b] : [0, 121, 193];
  return { type: "point-3d", symbolLayers: [{ type: "object", resource: { primitive: "cylinder" }, anchor: "bottom", width, depth: width, height: width, material: { color: c } }] };
}
function columnRenderer(fl) {
  const sc = columnScale(fl._srcDef), r2 = fl._renderer2d;
  if (!sc || !r2 || !r2.clone) return null;
  const r = r2.clone();
  const sym = (x) => columnSymbol(x && x.color, sc.width);
  if (r.type === "unique-value") { r.uniqueValueInfos = r.uniqueValueInfos.map((u) => ({ value: u.value, label: u.label, symbol: sym(u.symbol) })); r.defaultSymbol = sym(r.defaultSymbol); }
  else if (r.type === "simple") r.symbol = sym(r.symbol);
  else return null;
  const others = (r.visualVariables || []).filter((v) => v.type !== "size");
  r.visualVariables = others.concat([
    { type: "size", field: sc.field, axis: "height", valueUnit: "meters", stops: [{ value: sc.minValue, size: sc.minHeight, label: intl.formatNumber(sc.minValue) }, { value: sc.maxValue, size: sc.maxHeight, label: intl.formatNumber(sc.maxValue) }] },   // labelled, or the legend says "< 0" and "> 20"
    { type: "size", axis: "width-and-depth", useSymbolValue: true }
  ]);
  return r;
}
function syncColumns(fl) {
  if (!fl || !fl._renderer2d) return;
  let r = null;
  if (F.columns3d === true && mode === "3d" && fl._srcDef && fl._srcDef.columns3d) { try { r = columnRenderer(fl); } catch (e) { console.error(e); } }
  const want = r || fl._renderer2d;
  if (r || fl._columnsOn) fl.renderer = want;
  fl._columnsOn = !!r;
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
function eachToggleableLayer(fn) {
  fn(graphicsLayer, "__sketch", S.sketchLayer);
  activeMap().layers.toArray().slice().reverse().forEach((l) => { if (l !== graphicsLayer && l !== previewLayer) fn(l, l.id, l.title || l.id); });
}
function zoomToLayer(l) {
  if (l === graphicsLayer) { const g = graphicsLayer.graphics.toArray(); if (g.length) goToSafe(g); else toast(S.noSketches); return; }
  if (l.queryExtent) { l.when().then(() => l.queryExtent()).then((r) => { if (r && r.extent) goToSafe(r.extent.expand(1.2)); }).catch(() => {}); return; }
  if (l.fullExtent) goToSafe(l.fullExtent);
}
// Map layers, after MapMaker's: each layer has a drag handle, its name, a chevron that shows or hides its tools, and
// its check box; under it a row of tools (Zoom to, Show legend, Adjust transparency, Swipe, Table, Layer's description,
// Labels when the layer has labels, Change style for spreadsheet layers, Remove). A group opens to show its layers, each
// with the same tools. A layer outside its visible scale range is greyed with an ⓘ that says so.
// The icons are the SDK's own Calcite icons, as in MapMaker; each tool is a plain button with its own accessible name.
const ICON_STYLE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18c1.2 0 1.7-.8 1.7-1.6 0-.5-.2-.9-.5-1.2-.3-.3-.4-.7-.4-1.1 0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5C21 6.4 17 3 12 3z"/><circle cx="7.5" cy="11.5" r="1.1" fill="currentColor"/><circle cx="9.8" cy="7.4" r="1.1" fill="currentColor"/><circle cx="14.6" cy="7.4" r="1.1" fill="currentColor"/><circle cx="17" cy="11.3" r="1.1" fill="currentColor"/></svg>';
const calIcon = (name) => '<calcite-icon icon="' + name + '" scale="s" aria-hidden="true"></calcite-icon>';
const TABLE_TYPES = new Set(["feature", "csv", "geojson", "wfs", "ogc-feature"]);
const LEGEND_TYPES = new Set(["feature", "csv", "geojson", "wfs", "ogc-feature", "map-image", "imagery", "imagery-tile", "tile", "vector-tile", "wms", "kml", "scene", "stream"]);
const layerUi = new WeakMap();            // per layer: { collapsed, open (sublayers shown), legend, transp, info }
const uiOf = (l) => { let u = layerUi.get(l); if (!u) { u = { collapsed: false, open: false, legend: false, transp: false, info: false, scale: false }; layerUi.set(l, u); } return u; };
let layerKeySeq = 0;
const layerKeys = new WeakMap();
const keyOf = (l) => { let k = layerKeys.get(l); if (!k) { k = "k" + (++layerKeySeq); layerKeys.set(l, k); } return k; };
let rowWidgets = [], rowRefs = [], swipe = null, table = null;
const isGroup = (l) => l && l.type === "group" && l.layers;
function outOfScale(l) {
  const s = view && view.scale;
  if (!(s > 0)) return false;
  const min = l.minScale || 0, max = l.maxScale || 0;
  return (min > 0 && s > min) || (max > 0 && s < max);
}
function hasLabels(l) { const li = l.labelingInfo; return l !== graphicsLayer && !!li && li.length > 0; }
// The layers listed at one level, top first (as drawn), and the collection that holds them.
function siblingsOf(owner) {
  const coll = owner === "map" ? activeMap().layers : owner.layers;
  return coll.toArray().filter((x) => x !== graphicsLayer && x !== previewLayer && x.listMode !== "hide").reverse();
}
function ownerColl(owner) { return owner === "map" ? activeMap() : owner; }
function moveLayer(l, owner, to) {
  const sibs = siblingsOf(owner), from = sibs.indexOf(l);
  if (from < 0 || to < 0 || to >= sibs.length || to === from) return;
  const coll = ownerColl(owner), target = coll.layers.indexOf(sibs[to]);
  try { coll.reorder(l, target); } catch (e) { console.error(e); return; }
  if (owner === "map") keepSketchOnTop();
  markDirty();
  renderLayers({ focusKey: keyOf(l) + ":move" });
  $("layersLive").textContent = t("layerMoved", { title: l.title || "", n: to + 1, total: sibs.length });
}
function endSwipe() {
  if (!swipe) return;
  dropEl(swipe.widget);
  swipe = null;
}
let swipeSeq = 0;
async function toggleSwipe(l) {
  if (swipe && swipe.layer === l) { endSwipe(); renderLayers({ keepFocus: true }); return; }
  endSwipe(); const seq = ++swipeSeq;
  try {
    // the swipe component sits inside the map component, over the map
    const el = await toolEl("arcgis-swipe", viewEls.get(mapView), { view: mapView, leadingLayers: [l], trailingLayers: [], direction: "horizontal", swipePosition: 50 });
    if (mode !== "2d" || seq !== swipeSeq) { dropEl(el); return; }
    swipe = { widget: el, layer: l };
    toast(t("swipeOn", { title: l.title || "" }));
  } catch (e) { console.error(e); toast(S.swipeFailed); }
  renderLayers({ keepFocus: true });
}
function closeTable(restoreFocus) {
  if (!table) return;
  const l = table.layer, kind = table.kind || "table";
  if (kind === "chart") {   // the chart's selection goes from the map with it
    try { if (table.widget && table.widget.clearSelection) table.widget.clearSelection(); } catch (e) { /* none */ }
    for (const v of [mapView, sceneView]) { try { const src = v && v.selectionManager && v.selectionManager.sources; if (src && src.includes(l)) src.remove(l); } catch (e) { /* none */ } }
  }
  dropEl(table.widget);
  table = null;
  $("tableDock").hidden = true; $("tableBody").innerHTML = ""; $("tableDock").classList.remove("chart-dock"); $("chartPickWrap").hidden = true;
  if (openPanelName !== "profile") { $("app").classList.remove("docked", "tools-shown"); syncToolsToggles(); }
  setTimeout(layoutBottom, 0);
  if (!$("layersPanel").hidden) renderLayers({ focusKey: restoreFocus ? keyOf(l) + ":" + kind : null, keepFocus: !restoreFocus });
}
// The SDK's table has a progress bar with no name for a screen reader (WCAG 4.1.2, found by axe-core): it is given one.
function nameTableProgress(el, tries = 0) {
  const find = (n) => { if (!n) return null; if (n.nodeType === 1 && n.tagName === "CALCITE-PROGRESS") return n; if (n.shadowRoot) { const f = find(n.shadowRoot); if (f) return f; } for (const c of n.children || []) { const f = find(c); if (f) return f; } return null; };
  const bar = el.isConnected ? find(el) : null;
  if (bar) { if (!bar.label) bar.label = S.filterLoading || "Loading"; return; }
  if (el.isConnected && tries < 20) setTimeout(() => nameTableProgress(el, tries + 1), 300);
}
async function openTable(l) {
  if (table && table.layer === l && table.kind !== "chart") { closeTable(true); return; }
  if (openPanelName === "profile") { closePanels(false); openPanel("layers", { focus: false }); }
  if (table) closeTable(false);
  try {
    const c = document.createElement("div"); c.className = "table-host";
    $("tableBody").replaceChildren(c);
    $("tableH").textContent = t("tableOf", { title: l.title || "" });
    $("tableDock").hidden = false; syncDockHeight($("tableDock"));
    $("app").classList.add("docked"); $("app").classList.remove("tools-shown"); syncToolsToggles();
    const w = await toolEl("arcgis-feature-table", c, { view, layer: l });
    nameTableProgress(w);
    table = { widget: w, layer: l, kind: "table" };
    setTimeout(layoutBottom, 0);
  } catch (e) { console.error(e); toast(S.tableFailed); closeTable(false); return; }
  renderLayers({ keepFocus: true });
}
$("tableClose").addEventListener("click", () => closeTable(true));
// A dock (the chart, the table, Elevation) can be made taller or shorter: drag the bar along its top, or with the bar
// in focus use the up and down arrow keys (Page Up / Page Down for bigger steps, Home and End for the tallest and
// shortest). The height chosen is kept for each kind of dock while the app is open; the map keeps at least 120px.
const dockHeights = {};
const dockKind = (dock) => (dock.id === "profilePanel" ? "profile" : dock.classList.contains("chart-dock") ? "chart" : "table");
function dockLimits(dock) { const app = $("app").getBoundingClientRect(), top = $("mapWrap").getBoundingClientRect().top; return { min: 150, max: Math.max(150, Math.round(app.bottom - top - 120)) }; }
function setDockHeight(dock, px, remember) {
  const { min, max } = dockLimits(dock), hgt = Math.round(Math.min(max, Math.max(min, px)));
  dock.style.height = hgt + "px";
  if (remember) dockHeights[dockKind(dock)] = hgt;
  const grip = dock.querySelector(".dock-grip");
  if (grip) { grip.setAttribute("aria-valuemin", String(min)); grip.setAttribute("aria-valuemax", String(max)); grip.setAttribute("aria-valuenow", String(hgt)); grip.setAttribute("aria-valuetext", fmt(S.dockHeight, { n: hgt })); }
  layoutBottom();
}
// when a dock opens (or changes from table to chart): the height last chosen for its kind, else the stylesheet's
function syncDockHeight(dock) { const k = dockHeights[dockKind(dock)]; if (k) setDockHeight(dock, k, false); else { dock.style.height = ""; setDockHeight(dock, dock.getBoundingClientRect().height, false); dock.style.height = ""; } }
for (const grip of document.querySelectorAll(".dock-grip")) {
  const dock = grip.parentElement; let start = null;
  grip.addEventListener("pointerdown", (e) => { if (e.button) return; start = { y: e.clientY, h: dock.getBoundingClientRect().height }; grip.setPointerCapture(e.pointerId); grip.classList.add("dragging"); document.body.classList.add("dock-dragging"); e.preventDefault(); });
  grip.addEventListener("pointermove", (e) => { if (start) setDockHeight(dock, start.h + (start.y - e.clientY), true); });
  const end = (e) => { if (!start) return; start = null; grip.classList.remove("dragging"); document.body.classList.remove("dock-dragging"); try { grip.releasePointerCapture(e.pointerId); } catch (err) { /* released */ } setTimeout(layoutBottom, 0); };
  grip.addEventListener("pointerup", end); grip.addEventListener("pointercancel", end);
  grip.addEventListener("keydown", (e) => {
    const cur = dock.getBoundingClientRect().height, { min, max } = dockLimits(dock);
    const to = { ArrowUp: cur + 20, ArrowDown: cur - 20, PageUp: cur + 100, PageDown: cur - 100, Home: max, End: min }[e.key];
    if (to === undefined) return; e.preventDefault(); setDockHeight(dock, to, true);
  });
  grip.addEventListener("dblclick", () => { delete dockHeights[dockKind(dock)]; syncDockHeight(dock); });   // back to the usual height
}
window.addEventListener("resize", () => { for (const d of document.querySelectorAll(".dock:not([hidden])")) if (d.style.height) setDockHeight(d, parseFloat(d.style.height), false); });
// Charts (1.0 in 5.0.0-beta.16): a chart the map's author set up on a layer in Map Viewer is drawn by the SDK's chart
// component from that set-up, in the dock under the map (where the table goes; one or the other). The component's own
// action bar has its tools: the legend, selecting, only what is in view, zoom, and saving the picture or the numbers.
// The chart and the map share a selection: what is selected on the chart is highlighted on the map.
const chartsOf = (l) => { try { const c = l && l.charts; return Array.isArray(c) ? c.filter((x) => x && x.series) : []; } catch (e) { return []; } };
const chartTitle = (c, i) => { const x = c && c.title && c.title.content; return String((x && x.text) || (typeof c.title === "string" ? c.title : "") || t("chartN", { n: i + 1 })).trim(); };
async function openChart(l, index) {
  const charts = chartsOf(l);
  if (!charts.length) return;
  if (table && table.layer === l && table.kind === "chart" && index === undefined) { closeTable(true); return; }
  if (openPanelName === "profile") { closePanels(false); openPanel("layers", { focus: false }); }
  if (table) closeTable(false);
  const i = Math.min(charts.length - 1, Math.max(0, index || 0));
  try {
    const c = document.createElement("div"); c.className = "table-host chart-host";
    $("tableBody").replaceChildren(c);
    $("tableH").textContent = t("chartOf", { title: l.title || "" });
    const pick = $("chartPick"); pick.replaceChildren(...charts.map((ch, k) => new Option(chartTitle(ch, k), String(k)))); pick.value = String(i);
    $("chartPickWrap").hidden = charts.length < 2;
    $("tableDock").classList.add("chart-dock"); $("tableDock").hidden = false; syncDockHeight($("tableDock"));
    $("app").classList.add("docked"); $("app").classList.remove("tools-shown"); syncToolsToggles();
    const el = document.createElement("arcgis-chart"); el.setAttribute("aria-label", chartTitle(charts[i], i));
    const bar = document.createElement("arcgis-charts-action-bar"); bar.slot = "action-bar"; el.appendChild(bar);
    c.appendChild(el);
    await Promise.race([customElements.whenDefined("arcgis-chart"), new Promise((_, no) => setTimeout(() => no(new Error("arcgis-chart did not load")), 45000))]);
    if (el.componentOnReady) await el.componentOnReady();
    // the map's selection manager only takes selections for layers it has been told of
    try { const src = view.selectionManager && view.selectionManager.sources; if (src && !src.includes(l)) src.add(l); } catch (e) { console.warn("Chart selection won't show on the map", e); }
    Object.assign(el, { layer: l, view, model: charts[i], syncSelectionsBetweenChartAndLayerViewPolicy: "enabled" });   // what is selected on the chart is highlighted on the map
    table = { widget: el, layer: l, kind: "chart", index: i };
    setTimeout(layoutBottom, 0);
  } catch (e) { console.error(e); toast(S.chartFailed); table = table || { widget: null, layer: l, kind: "chart" }; closeTable(false); return; }
  renderLayers({ keepFocus: true });
}
$("chartPick").addEventListener("change", () => { if (table && table.kind === "chart") openChart(table.layer, Number($("chartPick").value)); });
// a map that has charts says so when it opens, since they are found in Map layers
function chartNote() {
  try { const n = shownMap().allLayers.filter((l) => chartsOf(l).length > 0).length; return n ? " " + (n === 1 ? S.mapHasChart : t("mapHasCharts", { n })) : ""; } catch (e) { return ""; }
}
// Anything that ends with a layer gone (removed, a new map) also ends its swipe and table.
function endLayerTools(l) {
  const within = (x) => x && (x === l || (isGroup(l) && l.allLayers && l.allLayers.includes(x)));
  if (!l || within(swipe && swipe.layer)) endSwipe();
  if (!l || within(table && table.layer)) closeTable(false);
}
async function fillLayerInfo(l, box) {
  const h = document.createElement("h3"); h.className = "lyr-info-h"; h.textContent = S.layerDescription;
  const body = document.createElement("div"); body.className = "lyr-info-body";
  box.replaceChildren(h, body);
  const item = l.portalItem;
  let frag = null;
  if (item && item.id) {
    try {
      if (item.load) await item.load();
      if (item.description) frag = safeFragment(item.description);
      else if (item.snippet) { frag = document.createElement("p"); frag.textContent = item.snippet; }
    } catch (e) { /* no description */ }
  }
  if (!frag) { frag = document.createElement("p"); frag.textContent = dataLayers.includes(l) ? t("dataLayerInfo", { n: ((l._srcDef && l._srcDef.features) || []).length }) : S.noLayerDescription; }
  body.appendChild(frag);
}
function toolButton(key, icon, label, title, onClick, pressed) {
  const b = document.createElement("button"); b.type = "button"; b.className = "lt"; b.dataset.key = key;
  b.innerHTML = icon; b.title = label; b.setAttribute("aria-label", label + ": " + title);
  if (pressed !== undefined) b.setAttribute("aria-pressed", String(!!pressed));
  b.addEventListener("click", onClick);
  return b;
}
function layerRow(l, owner, depth, pos, count) {
  const title = l === graphicsLayer ? S.sketchLayer : (l.title || l.id), k = keyOf(l), u = uiOf(l), group = isGroup(l);
  const li = document.createElement("li"); li.className = "li lyr" + (depth ? " sub" : "") + (l === graphicsLayer ? " fixed" : ""); li.dataset.key = k;
  const head = document.createElement("div"); head.className = "lyr-head";
  // drag handle: drag it, or use the arrow keys on it, to change the drawing order (the sketch layer always stays on top)
  if (l !== graphicsLayer && count > 1) {
    const h = document.createElement("button"); h.type = "button"; h.className = "lyr-drag"; h.dataset.key = k + ":move";
    h.innerHTML = calIcon("drag"); h.setAttribute("aria-label", t("moveLayer", { title })); h.setAttribute("aria-describedby", "layersMoveHint");
    h.title = S.moveLayerTip;
    h.addEventListener("keydown", (e) => {
      if (e.key === "ArrowUp" && pos > 0) { e.preventDefault(); moveLayer(l, owner, pos - 1); }
      else if (e.key === "ArrowDown" && pos < count - 1) { e.preventDefault(); moveLayer(l, owner, pos + 1); }
    });
    h.addEventListener("pointerdown", (e) => startDrag(e, l, owner, li));
    head.appendChild(h);
  } else if (depth === 0) { const sp = document.createElement("span"); sp.className = "lyr-drag-sp"; head.appendChild(sp); }
  if (group) {
    const g = document.createElement("button"); g.type = "button"; g.className = "lyr-open"; g.dataset.key = k + ":open";
    g.innerHTML = calIcon(u.open ? "chevron-down" : "chevron-right"); g.setAttribute("aria-expanded", String(u.open));
    g.setAttribute("aria-label", t("groupLayers", { title }));
    g.addEventListener("click", () => { u.open = !u.open; renderLayers({ focusKey: k + ":open" }); });
    head.appendChild(g);
  }
  const cbId = "lyr-" + k;
  const cb = document.createElement("input"); cb.type = "checkbox"; cb.id = cbId; cb.checked = l.visible !== false; cb.dataset.key = k + ":cb";
  const main = document.createElement("label"); main.className = "li-main"; main.htmlFor = cbId;
  const tt = document.createElement("span"); tt.className = "li-title"; tt.textContent = title; tt.title = title;
  main.appendChild(tt);
  head.appendChild(main);
  const sc = document.createElement("button"); sc.type = "button"; sc.className = "lyr-scale"; sc.dataset.key = k + ":scale";
  sc.innerHTML = calIcon("information"); sc.setAttribute("aria-label", S.outOfScaleShort + ": " + title); sc.setAttribute("aria-expanded", String(u.scale));
  const note = document.createElement("p"); note.className = "lyr-note"; note.id = "lyrnote-" + k; note.textContent = S.outOfScale; note.hidden = !u.scale;
  sc.setAttribute("aria-controls", note.id);
  sc.addEventListener("click", () => { u.scale = !u.scale; note.hidden = !u.scale; sc.setAttribute("aria-expanded", String(u.scale)); });
  head.appendChild(sc);
  const toolsId = "lyrtools-" + k;
  const tg = document.createElement("button"); tg.type = "button"; tg.className = "lyr-toggle"; tg.dataset.key = k + ":tools";
  tg.innerHTML = calIcon(u.collapsed ? "chevron-down" : "chevron-up"); tg.setAttribute("aria-expanded", String(!u.collapsed)); tg.setAttribute("aria-controls", toolsId);
  tg.setAttribute("aria-label", t("layerTools", { title })); tg.title = S.layerToolsTip;
  tg.addEventListener("click", () => { u.collapsed = !u.collapsed; renderLayers({ focusKey: k + ":tools" }); });
  head.appendChild(tg);
  head.appendChild(cb);
  const setState = () => {
    const oos = l !== graphicsLayer && outOfScale(l);
    tt.classList.toggle("off", l.visible === false || oos);
    sc.hidden = !oos; if (!oos) note.hidden = true;
  };
  cb.addEventListener("change", () => { l.visible = cb.checked; setState(); markDirty(); });
  setState(); rowRefs.push(setState);
  li.append(head, note);

  const tools = document.createElement("div"); tools.className = "lyr-tools"; tools.id = toolsId; tools.hidden = u.collapsed;
  tools.setAttribute("role", "group"); tools.setAttribute("aria-label", t("layerTools", { title }));
  const extra = document.createElement("div"); extra.className = "lyr-extra";
  tools.appendChild(toolButton(k + ":zoom", calIcon("layer-zoom-to"), S.zoomTo, title, () => zoomToLayer(l)));
  if (l !== graphicsLayer) {
    if (!group && LEGEND_TYPES.has(l.type)) tools.appendChild(toolButton(k + ":legend", calIcon("legend"), S.showLegend, title, () => { u.legend = !u.legend; renderLayers({ focusKey: k + ":legend" }); }, u.legend));
    tools.appendChild(toolButton(k + ":transp", calIcon("transparency"), S.adjustTransparency, title, () => { u.transp = !u.transp; renderLayers({ focusKey: k + ":transp" }); }, u.transp));
    if (!group && mode === "2d") tools.appendChild(toolButton(k + ":swipe", calIcon("compare"), S.swipe, title, () => toggleSwipe(l), !!(swipe && swipe.layer === l)));
    if (!group && TABLE_TYPES.has(l.type)) tools.appendChild(toolButton(k + ":table", calIcon("table"), S.table, title, () => openTable(l), !!(table && table.layer === l && table.kind !== "chart")));
    if (!group && chartsOf(l).length) tools.appendChild(toolButton(k + ":chart", calIcon("graph-bar"), S.chart, title, () => openChart(l), !!(table && table.layer === l && table.kind === "chart")));
    if (filterable(l)) {   // Filter: show only the features that meet some conditions (the button is marked when the layer has a filter)
      const on = hasFilter(l), fb = toolButton(k + ":filter", calIcon("filter"), on ? S.filterOn : S.filter, title, () => openFilter(l));
      if (on) fb.classList.add("on");
      tools.appendChild(fb);
    }
    tools.appendChild(toolButton(k + ":info", calIcon("information"), S.layerDescription, title, () => { u.info = !u.info; renderLayers({ focusKey: k + ":info" }); }, u.info));
    if (!group && hasLabels(l)) {
      const on = l.labelsVisible !== false;
      tools.appendChild(toolButton(k + ":labels", calIcon(on ? "label" : "label-off"), S.labels, title, () => { l.labelsVisible = !(l.labelsVisible !== false); markDirty(); renderLayers({ focusKey: k + ":labels" }); }, on));
    }
    if (dataLayers.includes(l)) {   // change the map style (type, colours, size, labels) of a spreadsheet layer
      const sb = toolButton(k + ":style", ICON_STYLE, S.changeStyle, title, () => editDataLayer(l));
      sb.dataset.styleFor = l.id; sb.classList.add("lt-svg");
      tools.appendChild(sb);
    }
    tools.appendChild(toolButton(k + ":remove", calIcon("trash"), S.removeLayer, title, () => removeLayer(l, owner, pos)));
  }
  li.appendChild(tools);
  if (!u.collapsed && l !== graphicsLayer) {
    if (u.legend && !group) {
      const box = document.createElement("div"); box.className = "lyr-legend";
      extra.appendChild(box);
      const row = { el: null, gone: false, destroy() { this.gone = true; dropEl(this.el); } }; rowWidgets.push(row);
      toolEl("arcgis-legend", box, { view, layerInfos: [{ layer: l, title: "" }], ignoreLayerVisibility: true, hideLayersNotInCurrentView: false })
        .then((el) => { row.el = el; if (row.gone) dropEl(el); }).catch(() => { box.textContent = S.noLegend; });
    }
    if (u.transp) {
      const row = document.createElement("div"); row.className = "lyr-transp";
      const v = Math.round((1 - (typeof l.opacity === "number" ? l.opacity : 1)) * 100);
      const lo = document.createElement("span"); lo.textContent = "0%"; lo.setAttribute("aria-hidden", "true");
      const hi = document.createElement("span"); hi.textContent = "100%"; hi.setAttribute("aria-hidden", "true");
      const r = document.createElement("input"); r.type = "range"; r.min = "0"; r.max = "100"; r.step = "1"; r.value = String(v); r.dataset.key = k + ":range";
      r.setAttribute("aria-label", t("transparencyOf", { title })); r.setAttribute("aria-valuetext", v + "%");
      r.addEventListener("input", () => { const n = Number(r.value) || 0; l.opacity = Math.round((1 - n / 100) * 100) / 100; r.setAttribute("aria-valuetext", n + "%"); r.title = n + "%"; markDirty(); });
      r.title = v + "%";
      row.append(lo, r, hi);
      extra.appendChild(row);
    }
    if (u.info) { const box = document.createElement("div"); box.className = "lyr-info"; extra.appendChild(box); fillLayerInfo(l, box); }
    if (extra.childNodes.length) li.appendChild(extra);
  }
  if (group && u.open) {
    const ul = document.createElement("ul"); ul.className = "list lyr-subs";
    const subs = siblingsOf(l);
    subs.forEach((s, i) => ul.appendChild(layerRow(s, l, depth + 1, i, subs.length)));
    li.appendChild(ul);
  }
  return li;
}
// Remove all layers (Map layers, as in MapMaker): every layer in the list goes; sketches stay. It asks first, because
// the list can include a spreadsheet the person added, which isn't anywhere else until the map is saved.
function removeAllLayers() {
  const list = siblingsOf("map");
  if (!list.length || !window.confirm(t("removeAllConfirm", { n: list.length }))) return;
  for (const l of list) {
    endLayerTools(l);
    if (dataLayers.includes(l)) dataLayers.splice(dataLayers.indexOf(l), 1);
    else if (l.__item && portalLayers.get(l.__item.itemId) === l) portalLayers.delete(l.__item.itemId);
    removeFromMaps(l);
  }
  markDirty();
  toast(t("removedAllLayers", { n: list.length }));
  if (catalogLoaded) refreshCatalogButtons();
  renderLayers();
  const h = $("layersH"); if (h) h.focus();
}
$("layersRemoveAll").innerHTML = calIcon("trash");
$("layersRemoveAll").addEventListener("click", removeAllLayers);
function removeLayer(l, owner, pos) {
  const title = l.title || "";
  endLayerTools(l);
  if (dataLayers.includes(l)) { dataLayers.splice(dataLayers.indexOf(l), 1); removeFromMaps(l); }
  else if (l.__item && portalLayers.get(l.__item.itemId) === l) { removeFromMaps(l); portalLayers.delete(l.__item.itemId); }
  else if (owner !== "map") { try { owner.remove(l); } catch (e) { /* gone */ } }
  else removeFromMaps(l);
  markDirty();
  toast(t("removedLayer", { title }));
  if (catalogLoaded) refreshCatalogButtons();
  // focus the layer that took its place (or the one above it), else the panel heading
  const sibs = siblingsOf(owner), next = sibs[Math.min(pos, sibs.length - 1)];
  renderLayers({ focusKey: next ? keyOf(next) + ":remove" : (owner !== "map" ? keyOf(owner) + ":open" : null) });
  if (!next && owner === "map") { const h = $("layersH"); if (h) h.focus(); }
}
// Dragging a row by its handle: the rows of the same level make room, and the layer is dropped where the line shows.
function startDrag(e, l, owner, li) {
  if (e.button !== 0) return;
  const h = e.currentTarget, list = li.parentElement, y0 = e.clientY;
  let dragging = false, target = -1;
  const rows = () => [...list.children].filter((x) => x.classList.contains("lyr") && !x.classList.contains("fixed"));   // the sketch row stays on top
  const from = rows().indexOf(li);
  const clear = () => rows().forEach((r) => r.classList.remove("drop-before", "drop-after"));
  const move = (ev) => {
    if (!dragging && Math.abs(ev.clientY - y0) < 5) return;
    dragging = true; li.classList.add("dragging");
    const rs = rows();
    target = rs.length - 1;
    for (let i = 0; i < rs.length; i++) { const b = rs[i].getBoundingClientRect(); if (ev.clientY < b.top + b.height / 2) { target = i; break; } }
    clear();
    if (target !== from) { const r = rs[target]; r.classList.add(target < from ? "drop-before" : "drop-after"); }
  };
  const up = () => {
    h.removeEventListener("pointermove", move); h.removeEventListener("pointerup", up); h.removeEventListener("pointercancel", cancel);
    li.classList.remove("dragging"); clear();
    if (dragging && target >= 0 && target !== from) moveLayer(l, owner, target);
  };
  const cancel = () => { dragging = false; up(); };
  try { h.setPointerCapture(e.pointerId); } catch (err) { /* capture not available */ }
  h.addEventListener("pointermove", move); h.addEventListener("pointerup", up); h.addEventListener("pointercancel", cancel);
}
function updateScaleStates() { rowRefs.forEach((f) => f()); }
function renderLayers(opts) {
  { const ra = $("layersRemoveAll"); if (ra) ra.hidden = F.removeAllLayers === false || !siblingsOf("map").length; }
  opts = opts || {};
  const list = $("layersList");
  const ae = document.activeElement;
  const focusKey = opts.focusKey || ((opts.keepFocus || list.contains(ae)) && ae && ae.dataset ? ae.dataset.key : null);
  rowWidgets.forEach((w) => { try { w.destroy(); } catch (e) { /* gone */ } });
  rowWidgets = []; rowRefs = [];
  list.innerHTML = "";
  const top = siblingsOf("map");
  list.appendChild(layerRow(graphicsLayer, "map", 0, -1, 0));
  top.forEach((l, i) => list.appendChild(layerRow(l, "map", 0, i, top.length)));
  if (!top.length && !graphicsLayer.graphics.length) { const p = document.createElement("li"); p.className = "empty"; p.textContent = S.noLayers; list.appendChild(p); }
  if (focusKey) { const el = list.querySelector('[data-key="' + focusKey + '"]'); if (el) el.focus(); }
  // labels show only once a layer has loaded its label classes: list again when the ones still loading are ready
  const pending = top.filter((l) => !l.loaded && l.when && !l.__lyrWaited);
  if (pending.length) {
    pending.forEach((l) => { l.__lyrWaited = true; });
    Promise.allSettled(pending.map((l) => l.when())).then(() => { if (!$("layersPanel").hidden) renderLayers({ keepFocus: true }); });
  }
}


// ============================================================ Filter (lab)
// A Filter panel for one layer, laid out like Map Viewer's: "Show features where", then conditions (field, condition,
// value), a histogram with a slider for number fields, Add new, and Apply / Cancel. It is built from Esri's Calcite
// components and the SDK's Histogram and Slider components; Map Viewer's filter panel itself isn't published as a component.
// The filter is saved as the layer's definitionExpression (lib/filter.js), which is how Map Viewer saves one.
// While the panel is open the map previews the conditions through the layer view (no data is fetched again as a
// slider moves), and the layer itself shows everything, so the histogram, value lists and counts cover all the data.
const FILTER_ON = F.filter !== false;
let filterState = null;
const filterOrigin = new WeakMap();   // the filter each layer had when its panel was first opened ("" for none)
const filterable = (l) => FILTER_ON && !!l && !isGroup(l) && l !== previewLayer && l !== graphicsLayer && TABLE_TYPES.has(l.type) && "definitionExpression" in l;
const filterText = (l) => (typeof l.definitionExpression === "string" ? l.definitionExpression.trim() : "");
const hasFilter = (l) => { const s = filterText(l); return !!s && !/^1\s*=\s*1$/.test(s); };
const fmtNum = (n) => { try { return Number(n).toLocaleString(cfg.locale || "en"); } catch (e) { return String(n); } };
function popupFieldNames(l) {
  const names = [], pt = l.popupTemplate;
  const take = (list) => (list || []).forEach((fi) => { if (fi && fi.fieldName && fi.visible !== false) names.push(fi.fieldName); });
  if (pt) { take(pt.fieldInfos); (Array.isArray(pt.content) ? pt.content : []).forEach((el) => { if (el && el.type === "fields") take(el.fieldInfos); }); }
  return names;
}
const filterField = (name) => filterState.all.find((f) => f.name === name);
function newCondition() {
  const f = filterState.fields[0], kind = fieldKind(f);
  return { field: f.name, op: DEFAULT_OPERATOR[kind], value: "", value2: "", values: [] };
}
async function openFilter(l) {
  if (openPanelName === "filter") closePanels(false);
  try { await l.load(); } catch (e) { console.error(e); toast(S.filterCantOpen); return; }
  const all = (l.fields || []).filter((f) => fieldKind(f));
  const original = filterText(l);
  if (!filterOrigin.has(l)) filterOrigin.set(l, hasFilter(l) ? original : "");
  const parsed = parseWhere(original, all);
  const offered = filterFields(l.fields || [], popupFieldNames(l), l.objectIdField);
  for (const c of parsed.conditions) { const f = all.find((x) => x.name === c.field); if (f && !offered.includes(f)) offered.push(f); }   // a field the map's own filter uses
  if (!offered.length) { toast(S.filterNoFields, 5000); return; }
  // The map previews a condition in the browser, against the fields the layer has loaded, and a layer loads only the
  // fields it draws with. So the fields the panel offers are asked for here; without this a condition on any other
  // field (Depth, on a layer drawn by Magnitude) changed the count but not the map. (Filter 1.1)
  if ("outFields" in l) {
    const have = Array.isArray(l.outFields) ? l.outFields : [];
    const add = offered.map((f) => f.name).filter((n) => !have.includes(n));
    if (!have.includes("*") && add.length) l.outFields = [...have, ...add];
  }
  const st = filterState = { layer: l, all, fields: offered, original, base: parsed.base, conditions: parsed.conditions, match: parsed.match,
    layerView: null, lvFilter: null, sliders: [], stats: new Map(), values: new Map(), total: null, countSeq: 0, saved: false, previewTimer: 0 };
  if (!st.conditions.length) st.conditions = [newCondition()];
  openPanel("filter");
  renderFilter();
  try {
    const [FeatureFilter] = await $arcgis.import(["@arcgis/core/layers/support/FeatureFilter.js"]);
    st.FeatureFilter = FeatureFilter;
    st.layerView = await view.whenLayerView(l);
  } catch (e) { st.layerView = null; }   // no layer view (the layer isn't drawn): the preview sets the layer's own filter instead
  if (filterState !== st) return;
  applyFilterPreview();
  if (st.layerView) l.definitionExpression = st.base || null;
}
// The conditions as SQL, without the part that can't be shown as conditions.
const filterOwn = () => buildWhere(filterState.conditions, filterState.match, filterState.all);
const filterFull = () => buildWhere(filterState.conditions, filterState.match, filterState.all, filterState.base);
function applyFilterPreview() {
  const st = filterState; if (!st) return;
  if (st.layerView && st.FeatureFilter) { const own = filterOwn(); st.lvFilter = own ? new st.FeatureFilter({ where: own }) : null; st.layerView.filter = st.lvFilter; }
  else st.layer.definitionExpression = filterFull() || null;
  updateFilterCount();
}
function scheduleFilterPreview() { const st = filterState; if (!st) return; clearTimeout(st.previewTimer); st.previewTimer = setTimeout(applyFilterPreview, 120); }
async function updateFilterCount() {
  const st = filterState, l = st.layer, token = ++st.countSeq, full = filterFull();
  try {
    if (st.total == null) st.total = await l.queryFeatureCount({ where: st.base || "1=1" });
    const filtered = !!full && full !== st.base;
    const n = filtered ? await l.queryFeatureCount({ where: full }) : st.total;
    if (filterState !== st || token !== st.countSeq) return;
    $("filterCount").textContent = filtered ? t("filterCount", { n: fmtNum(n), total: fmtNum(st.total) }) : t("filterCountAll", { total: fmtNum(st.total) });
  } catch (e) { if (filterState === st) $("filterCount").textContent = ""; }
}
function calSelect(label, options, value, onChange) {
  const s = document.createElement("calcite-select"); s.setAttribute("label", label); s.setAttribute("scale", "m");
  for (const [v, text] of options) { const o = document.createElement("calcite-option"); o.value = v; o.label = text; o.textContent = text; if (v === value) o.selected = true; s.appendChild(o); }
  s.addEventListener("calciteSelectChange", () => onChange(s.value));
  return s;
}
function calNumber(label, value, onInput) {
  const n = document.createElement("calcite-input-number"); n.setAttribute("label", label); n.setAttribute("step", "any"); n.setAttribute("placeholder", S.filterValuePh);
  n.value = value == null ? "" : String(value);
  n.addEventListener("calciteInputNumberInput", () => onInput(n.value));
  return n;
}
function destroyFilterSliders() { const st = filterState; if (!st) return; st.sliders.forEach((s) => { try { s.destroy(); } catch (e) { /* gone */ } }); st.sliders = []; }
// The values a text field holds, for the list under "is" and "is not" (up to 250; anything else can still be typed).
async function fillTextValues(c, box) {
  const st = filterState, l = st.layer;
  try {
    let list = st.values.get(c.field);
    if (!list) {
      const r = await l.queryFeatures({ where: st.base || "1=1", outFields: [c.field], returnDistinctValues: true, returnGeometry: false, orderByFields: [c.field], num: 250 });
      list = [...new Set(r.features.map((g) => g.attributes[c.field]).filter((v) => (typeof v === "string" && v !== "") || (typeof v === "number" && Number.isFinite(v))).map(String))].slice(0, 250);
      st.values.set(c.field, list);
    }
    if (filterState !== st || !box.isConnected) return;
    const have = new Set(isListOp(c.op) ? c.values || [] : [c.value]);
    for (const v of list) { if (have.has(v)) continue; const it = document.createElement("calcite-combobox-item"); it.value = v; it.setAttribute("heading", v); it.setAttribute("text-label", v); box.appendChild(it); }
  } catch (e) { console.warn("Couldn't list the field's values", e); }
}
// The histogram of a number field with a slider on it, kept in step with the number box(es). These are the SDK's
// Histogram and Slider components (the replacements for its older HistogramRangeSlider widget), put together as in
// Esri's own "Histogram Range Slider" sample: the histogram sits in the slider's content-start slot, and the bars the
// condition includes are coloured through the histogram's colour stops.
function histogramStops(op, vals, h) {
  const color = hexToRgb(cfg.theme.brand || "#0b5c8e"), stop = (a, b) => (b > a ? [{ color, minValue: a, maxValue: b }] : []);
  if (op === "atLeast" || op === "greater") return stop(vals[0], h.max);
  if (op === "atMost" || op === "less") return stop(h.min, vals[0]);
  if (op === "between") return stop(Math.min(vals[0], vals[1]), Math.max(vals[0], vals[1]));
  if (op === "isNot") return stop(h.min, h.max);
  return [];   // "is": one value, so no range of bars to colour
}
const whenDefinedSoon = (tag, ms) => Promise.race([customElements.whenDefined(tag).then(() => true), new Promise((r) => setTimeout(() => r(false), ms))]);
async function fillHistogram(c, body, inputs) {
  const st = filterState, l = st.layer, f = filterField(c.field);
  try {
    const [histogram, summaryStatistics] = await $arcgis.import(["@arcgis/core/smartMapping/statistics/histogram.js", "@arcgis/core/smartMapping/statistics/summaryStatistics.js"]);
    let h = st.stats.get(c.field);
    if (!h) {
      const s = await summaryStatistics({ layer: l, field: c.field });
      if (!(s && Number.isFinite(s.min) && Number.isFinite(s.max) && s.max > s.min)) h = { none: true };
      else { const r = await histogram({ layer: l, field: c.field, numBins: 30, minValue: s.min, maxValue: s.max }); h = { min: s.min, max: s.max, bins: r.bins }; }
      st.stats.set(c.field, h);
    }
    if (filterState !== st || !body.isConnected) return;
    if (h.none) { body.textContent = S.filterNoHistogram; body.classList.add("none"); return; }
    const sl = document.createElement("arcgis-slider"), hg = document.createElement("arcgis-histogram");
    if (!(await whenDefinedSoon("arcgis-slider", 15000)) || !(await whenDefinedSoon("arcgis-histogram", 15000))) throw new Error("The Slider and Histogram components didn't load");
    if (filterState !== st || !body.isConnected) return;
    const whole = /integer|long/i.test(f.type), span = h.max - h.min, precision = whole ? 0 : span < 10 ? 2 : span < 1000 ? 1 : 0;
    const round = (v) => Number(Number(v).toFixed(precision)), clampV = (v) => Math.min(h.max, Math.max(h.min, v));
    const cur = (v, d) => { const n = Number(v); return v !== "" && v != null && Number.isFinite(n) ? clampV(n) : d; };
    const between = c.op === "between";
    // A condition with no value yet starts with its slider where everything is shown; the box stays empty until it's moved.
    const low = c.op === "atMost" || c.op === "less" ? h.max : h.min;
    const values = between ? [cur(c.value, h.min), cur(c.value2, h.max)].sort((a, b) => a - b) : [cur(c.value, low)];
    hg.slot = "content-start"; hg.style.flex = "1"; hg.style.setProperty("--arcgis-histogram-bar-color", "#c2c2c2");
    hg.bins = h.bins; hg.min = h.min; hg.max = h.max; hg.colorStops = histogramStops(c.op, values, h);
    sl.min = h.min; sl.max = h.max; sl.values = values; sl.precision = precision;
    sl.setAttribute("show-range-labels", ""); sl.setAttribute("range-labels-placement", "end");
    sl.setAttribute("label", t("filterSliderLabel", { field: f.alias || f.name })); sl.setAttribute("aria-label", t("filterSliderLabel", { field: f.alias || f.name }));
    sl.appendChild(hg);
    const host = document.createElement("div"); host.className = "flt-hist-host"; host.appendChild(sl); body.replaceChildren(host);
    st.sliders.push({ destroy: () => host.remove() });
    const fromSlider = () => {
      const vals = (sl.values || []).map(Number);
      if (!vals.length || vals.some((v) => !Number.isFinite(v)) || filterState !== st) return;
      c.value = String(round(vals[0])); inputs[0].value = c.value;
      if (between && vals.length > 1) { c.value2 = String(round(vals[1])); inputs[1].value = c.value2; }
      hg.colorStops = histogramStops(c.op, vals, h);
      scheduleFilterPreview();
    };
    sl.addEventListener("arcgisInput", fromSlider); sl.addEventListener("arcgisChange", fromSlider);
    // typing in a box moves the slider
    body.__setSlider = () => {
      if (c.value === "" || (between && c.value2 === "")) return;
      const next = (between ? [Number(c.value), Number(c.value2)] : [Number(c.value)]);
      if (next.some((v) => !Number.isFinite(v))) return;
      const vals = next.map(clampV).sort((x, y) => x - y);
      try { sl.values = vals; hg.colorStops = histogramStops(c.op, vals, h); } catch (e) { /* out of range */ }
    };
  } catch (e) { console.warn("Histogram not available", e); if (body.isConnected) { body.textContent = S.filterNoHistogram; body.classList.add("none"); } }
}
function conditionCard(c, i) {
  const st = filterState, f = filterField(c.field), kind = fieldKind(f), n = i + 1, many = st.conditions.length > 1;
  const card = document.createElement("div"); card.className = "flt-cond"; card.setAttribute("role", "group"); card.dataset.i = String(i);
  const name = many ? t("filterConditionN", { n }) : S.filterCondition; card.setAttribute("aria-label", name);
  // no heading: the field, the comparison and the value, with the bin beside the field (the group is still named for a screen reader)
  const head = document.createElement("div"); head.className = "flt-cond-head";
  const rm = document.createElement("button"); rm.type = "button"; rm.className = "lt flt-rm"; rm.innerHTML = calIcon("trash"); rm.title = S.filterRemove; rm.setAttribute("aria-label", t("filterRemoveN", { n }));
  rm.addEventListener("click", () => { st.conditions.splice(i, 1); if (!st.conditions.length) st.conditions.push(newCondition()); renderFilter({ focus: Math.min(i, st.conditions.length - 1) }); applyFilterPreview(); });
  card.appendChild(head);
  const redraw = (part) => { const fresh = conditionCard(c, i); card.replaceWith(fresh); const el = fresh.querySelector('[data-part="' + part + '"]'); if (el && el.setFocus) el.setFocus(); applyFilterPreview(); };
  const fs = calSelect(t("filterFieldLabel", { n }), st.fields.map((x) => [x.name, x.alias || x.name]), c.field, (v) => {
    const k2 = fieldKind(filterField(v));
    c.field = v; c.value = ""; c.value2 = ""; c.values = []; if (!OPERATORS[k2].includes(c.op) || k2 !== kind) c.op = DEFAULT_OPERATOR[k2];
    redraw("field");
  });
  fs.dataset.part = "field"; head.append(fs, rm);
  const os = calSelect(t("filterOpLabel", { n }), OPERATORS[kind].map((op) => [op, S["filterOp_" + op]]), c.op, (v) => {
    const was = c.op; c.op = v;
    // between "is" and "is one of" what was chosen is kept: one value becomes a list of one, a list gives its first value
    if (isListOp(v) && !isListOp(was)) { c.values = (was === "is" || was === "isNot") && c.value !== "" && c.value != null ? [String(c.value)] : []; c.value = ""; c.value2 = ""; }
    else if (!isListOp(v) && isListOp(was)) { c.value = (v === "is" || v === "isNot") && c.values && c.values.length ? c.values[0] : ""; c.values = []; }
    else if (kind === "text" && !isListOp(v) && (was === "is" || was === "isNot") !== (v === "is" || v === "isNot")) c.value = "";
    if (v !== "between") c.value2 = "";
    redraw("op");
  });
  os.dataset.part = "op"; card.appendChild(os);
  if (!needsValue(c.op)) return card;
  if (isListOp(c.op)) {
    // a list: every value chosen is a chip; more can be chosen from the field's values, or typed
    const cb = document.createElement("calcite-combobox"); cb.setAttribute("label", t("filterValueLabel", { n })); cb.setAttribute("selection-mode", "multiple"); cb.setAttribute("allow-custom-values", "");
    cb.setAttribute("selection-display", "fit"); cb.setAttribute("placeholder", S.filterChooseManyPh); cb.setAttribute("overlay-positioning", "fixed"); cb.dataset.part = "value";
    for (const v of c.values || []) { const it = document.createElement("calcite-combobox-item"); it.value = v; it.setAttribute("heading", v); it.setAttribute("text-label", v); it.selected = true; cb.appendChild(it); }
    cb.addEventListener("calciteComboboxChange", () => { const v = cb.value; c.values = (Array.isArray(v) ? v : v ? [v] : []).map(String).filter(Boolean); note.textContent = fmt(S.filterListCount, { n: c.values.length }); scheduleFilterPreview(); });
    card.appendChild(cb);
    const note = document.createElement("p"); note.className = "flt-list-note"; note.textContent = fmt(S.filterListCount, { n: (c.values || []).length }); card.appendChild(note);
    fillTextValues(c, cb);
  } else if (kind === "number") {
    const inputs = [];
    let body = null;
    const box = (key, label) => { const el = calNumber(label, c[key], (v) => { c[key] = v; if (body && body.__setSlider) body.__setSlider(); scheduleFilterPreview(); }); el.dataset.part = key; inputs.push(el); return el; };
    if (c.op === "between") {
      const row = document.createElement("div"); row.className = "flt-between";
      const and = document.createElement("span"); and.textContent = S.filterAnd;
      row.append(box("value", t("filterValueFromLabel", { n })), and, box("value2", t("filterValueToLabel", { n })));
      card.appendChild(row);
    } else card.appendChild(box("value", t("filterValueLabel", { n })));
    const det = document.createElement("details"); det.className = "flt-hist"; det.open = st.histOpen !== false;
    const sum = document.createElement("summary"); sum.textContent = S.filterHistogram; det.appendChild(sum);
    det.addEventListener("toggle", () => { st.histOpen = det.open; });
    body = document.createElement("div"); body.className = "flt-hist-body"; body.textContent = S.filterLoading; det.appendChild(body);
    card.appendChild(det);
    fillHistogram(c, body, inputs);
  } else if (c.op === "is" || c.op === "isNot") {
    const cb = document.createElement("calcite-combobox"); cb.setAttribute("label", t("filterValueLabel", { n })); cb.setAttribute("selection-mode", "single"); cb.setAttribute("allow-custom-values", "");
    cb.setAttribute("placeholder", S.filterChoosePh); cb.setAttribute("overlay-positioning", "fixed"); cb.setAttribute("clear-disabled", ""); cb.dataset.part = "value";
    if (c.value) { const it = document.createElement("calcite-combobox-item"); it.value = c.value; it.setAttribute("heading", c.value); it.setAttribute("text-label", c.value); it.selected = true; cb.appendChild(it); }
    cb.addEventListener("calciteComboboxChange", () => { const v = cb.value; c.value = Array.isArray(v) ? (v[0] || "") : (v || ""); scheduleFilterPreview(); });
    card.appendChild(cb);
    fillTextValues(c, cb);
  } else {
    const tx = document.createElement("calcite-input-text"); tx.setAttribute("label", t("filterValueLabel", { n })); tx.setAttribute("placeholder", S.filterTextPh); tx.value = c.value || ""; tx.dataset.part = "value";
    tx.addEventListener("calciteInputTextInput", () => { c.value = tx.value; scheduleFilterPreview(); });
    card.appendChild(tx);
  }
  return card;
}
function renderFilter(opts) {
  const st = filterState; if (!st) return;
  destroyFilterSliders();
  $("filterLayer").textContent = st.layer.title || "";
  $("filterBase").hidden = !st.base;   // a filter the panel can't read stays on, and is said in a line (no SQL is shown)
  const many = st.conditions.length > 1;
  $("filterMatchRow").hidden = !many;
  if (many) $("filterMatchRow").replaceChildren(calSelect(S.filterMatch, [["all", S.filterMatchAll], ["any", S.filterMatchAny]], st.match, (v) => { st.match = v; applyFilterPreview(); }));
  $("filterConds").replaceChildren(...st.conditions.map(conditionCard));
  $("filterAdd").disabled = st.conditions.length >= MAX_CONDITIONS;
  if (opts && opts.focus != null) { const card = $("filterConds").children[opts.focus], el = card && card.querySelector('[data-part="field"]'); if (el && el.setFocus) setTimeout(() => el.setFocus(), 0); }
}
// Leaving the panel without Apply puts the layer back as it was.
function endFilter() {
  const st = filterState; if (!st) return;
  clearTimeout(st.previewTimer);
  destroyFilterSliders();
  const l = st.layer, lv = st.layerView, mine = st.lvFilter;
  if (!st.saved) l.definitionExpression = st.original || null;
  // take the preview off once the layer has drawn its own filter, so nothing flashes in between
  if (lv) { const off = () => { if (lv.filter === mine) lv.filter = null; }; reactiveUtils.whenOnce(() => !lv.updating).then(off, off); setTimeout(off, 4000); }
  filterState = null;
  $("filterCount").textContent = "";
}
function backToLayerTool(l, key) {
  openPanel("layers", { focus: false });
  const b = $("layersList").querySelector('[data-key="' + keyOf(l) + ":" + key + '"]');
  if (b) b.focus(); else { const h = $("layersH"); if (h) h.focus(); }
}
function applyFilter() {
  const st = filterState; if (!st) return;
  const l = st.layer, full = filterFull();
  const unfinished = st.conditions.some((c) => !conditionComplete(c, st.all) && (c.value || c.value2));
  l.definitionExpression = full || null;
  st.saved = true;
  if (full !== st.original) markDirty();
  closePanels(false);
  backToLayerTool(l, "filter");
  toast(unfinished ? S.filterUnfinished : full && full !== st.base ? t("filterApplied", { title: l.title || "" }) : t("filterRemoved", { title: l.title || "" }), unfinished ? 6000 : 3400);
}
$("filterApply").addEventListener("click", applyFilter);
$("filterCancel").addEventListener("click", () => { const l = filterState && filterState.layer; closePanels(false); if (l) backToLayerTool(l, "filter"); });
$("filterAdd").addEventListener("click", () => { const st = filterState; if (!st || st.conditions.length >= MAX_CONDITIONS) return; st.conditions.push(newCondition()); renderFilter({ focus: st.conditions.length - 1 }); applyFilterPreview(); });
$("filterClear").addEventListener("click", () => { const st = filterState; if (!st) return; st.conditions = [newCondition()]; st.match = "all"; renderFilter({ focus: 0 }); applyFilterPreview(); $("layersLive").textContent = S.filterClearedSr; });
// The layer's filter as the web map stores it: layerDefinition.definitionExpression (Web Map Specification).
// A layer that came with a filter and has had it cleared is written "1=1", so the filter in its item doesn't come back.
function filterJson(out, l) {
  if (isGroup(l) || !("definitionExpression" in l)) return out;
  const ld = { ...(out.layerDefinition || {}) };
  const de = hasFilter(l) ? filterText(l) : (filterOrigin.get(l) ? "1=1" : "");
  if (de) ld.definitionExpression = de; else if (filterOrigin.has(l)) delete ld.definitionExpression;
  if (Object.keys(ld).length) out.layerDefinition = ld; else delete out.layerDefinition;
  return out;
}

// ============================================================ Bookmarks
let bmEditIndex = -1;
function layerSnapshot() { const s = []; eachToggleableLayer((l, id, title) => s.push({ id, title, visible: l.visible !== false })); return s; }
function applyLayerSnapshot(snap) {
  if (!snap || !snap.length) return;
  const top = new Set();
  eachToggleableLayer((l, id, title) => { top.add(l); const rec = snap.find((r) => r.id === id) || snap.find((r) => r.title && r.title === title); if (rec) l.visible = !!rec.visible; });
  // layers inside a group layer: only a scene's slides record these, by id
  layersDeep(activeMap()).forEach((l) => { if (top.has(l) || l === graphicsLayer || l === previewLayer) return; const rec = snap.find((r) => r.id === l.id); if (rec) l.visible = !!rec.visible; });
  if (!$("layersPanel").hidden) renderLayers();
}
function applyBookmark(bm) {
  const vp = bm.viewpoint;
  if (mode === "3d" && bm.camera) goToSafe(bm.camera.clone(), { duration: 800 });   // made in 3D: same tilt and heading
  else if (vp.center) goToSafe({ center: vp.center, zoom: vp.zoom }, { duration: 800 });
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
    // In 3D, the camera too (tilt and heading), for this session: saved maps keep the place, as a web map bookmark does.
    if (mode === "3d" && sceneView && sceneView.camera) bm.camera = sceneView.camera.clone();
    bookmarks.push(bm); captureThumb(bm);
  }
  markDirty(); showBmList(); updateToolBadges();
  $("bmAddBtn").focus();
});
$("bmTitleInput").addEventListener("keydown", (e) => { if (e.key === "Enter") $("bmSave").click(); });
$("bmDelete").addEventListener("click", () => { if (bmEditIndex >= 0) { bookmarks.splice(bmEditIndex, 1); markDirty(); } showBmList(); updateToolBadges(); $("bmAddBtn").focus(); });

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
  const st = { ready: null, loaded: false, tree: [], entries: null, counts: null, other: 0, mode: "index", topic: ALL, page: 1, expanded: new Set(), token: 0, dim: "all", dims: null };
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
    const scene = item.type === "Web Scene";
    if (scene) { li.classList.add("is-scene"); const sr = document.createElement("span"); sr.className = "sr-only"; sr.textContent = " (" + S.sceneCard + ")"; h.append(sr); }
    const sn = document.createElement("p"); sn.className = "cat-card-snippet"; sn.textContent = item.snippet || "";
    const act = document.createElement("button"); act.type = "button"; act.className = "cat-act"; act._item = item;
    o.decorate(act, item);
    act.addEventListener("click", () => o.run(item, act));
    if (o.share) {   // Share (maps): copies a link that opens this map in this app
      const row = document.createElement("div"); row.className = "cat-acts";
      const sh = document.createElement("button"); sh.type = "button"; sh.className = "cat-share"; sh.innerHTML = calIcon("share");
      const sl = document.createElement("span"); sl.textContent = S.share; sh.appendChild(sl); sh.setAttribute("aria-label", S.share + ": " + (item.title || ""));
      sh.addEventListener("click", () => o.share(item, sh));
      row.append(sh, act); txt.append(h, sn, row);
    } else txt.append(h, sn, act);
    const th = document.createElement("div"); th.className = "cat-thumb" + (o.thumbOpens ? " open" : ""); th.setAttribute("aria-hidden", "true");
    const tu = thumbUrl(item); if (tu) th.style.backgroundImage = "url('" + tu.replace(/'/g, "%27") + "')";
    if (o.thumbOpens) th.addEventListener("click", () => o.run(item, act));
    if (scene) { const bd = document.createElement("span"); bd.className = "cat-3d"; bd.innerHTML = calIcon("cube"); bd.append(S.view3d); th.appendChild(bd); }   // marked on its picture, where the eye goes first
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
  // 2D maps and 3D scenes (Collection browser 2.1): where the collection has scenes, a row above the list chooses all of
  // them, the 2D maps or the 3D scenes. It works with the category chosen and with the search, and says how many of each.
  const DIMS = [["all", "dimAll"], ["2d", "dim2d"], ["3d", "dim3d"]];
  const isSceneEntry = (e) => e.item.type === "Web Scene";
  function renderDims(list) {
    const any = o.kind === "maps" && st.mode !== "server" && (st.entries || []).some(isSceneEntry);
    if (!any) { if (st.dims) st.dims.hidden = true; st.dim = "all"; return; }
    if (!st.dims) {
      const g = st.dims = document.createElement("div"); g.className = "cat-dims"; g.setAttribute("role", "group"); g.setAttribute("aria-label", S.dimLabel);
      for (const [key] of DIMS) { const b = document.createElement("button"); b.type = "button"; b.dataset.dim = key; b.addEventListener("click", () => { st.dim = key; st.page = 1; renderList(false); }); g.appendChild(b); }
      el("Status").before(g);
    }
    const n3 = list.filter(isSceneEntry).length, n = { all: list.length, "2d": list.length - n3, "3d": n3 };
    st.dims.hidden = false;
    for (const b of st.dims.children) {
      const key = b.dataset.dim, label = S[DIMS.find((d) => d[0] === key)[1]];
      b.replaceChildren(); if (key === "3d") b.insertAdjacentHTML("beforeend", calIcon("cube"));
      const nm = document.createElement("span"); nm.textContent = label; const ct = document.createElement("span"); ct.className = "cat-dim-n"; ct.textContent = String(n[key]);
      b.append(nm, " ", ct); b.setAttribute("aria-pressed", String(st.dim === key));   // its name is what it shows: the words and the number
    }
  }
  function renderList(focusList) {
    if (!st.loaded) return;
    if (st.mode === "server") { renderDims([]); serverPage(focusList); return; }
    const text = el("Search").value.trim();
    let list = filterEntries(st.entries, st.tree, st.topic, text, cfg.locale);
    renderDims(list);
    if (st.dim !== "all") {
      list = list.filter((e) => isSceneEntry(e) === (st.dim === "3d"));
      const pg = Math.max(1, Math.ceil(list.length / PAGE_SIZE)); if (st.page > pg) st.page = pg;
      paint(list.slice((st.page - 1) * PAGE_SIZE, st.page * PAGE_SIZE).map((e) => e.item), list.length, pg, text, focusList);
      const count = st.dim === "3d" ? (list.length === 1 ? S.scenesCountOne : t("scenesCount", { n: list.length })) : unitText(list.length), topic = topicName(st.topic);
      el("Status").textContent = topic ? t("inTopic", { count, topic }) : count;
      return;
    }
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
const openCollectionMap = (it) => (it.type === "Web Scene" ? openWebSceneItem(it.id, { title: it.title }) : openWebMapItem(it.id, { title: it.title }));
// The collection's web maps and, where 3D is on, its web scenes (5.0.0-beta.9); a scene's card says 3D.
const mapBrowser = createBrowser({ p: "om", query: F.threeD === false ? 'type:"Web Map"' : '(type:"Web Map" OR type:"Web Scene")', accept: () => true, kind: "maps", thumbOpens: true, descLabel: () => S.mapDescription,
  decorate(b, item) { const w = item.type === "Web Scene" ? S.openThisScene : S.openThisMap; b.textContent = w; b.setAttribute("aria-label", w + ": " + (item.title || "")); },
  share: F.share === false ? null : shareMapLink,
  run(item) { openCollectionMap(item); } });
// The link Share copies: this app (and these settings) opening that map. Nothing about the person is in it.
function mapLink(itemId, scene) {
  const u = new URL(location.origin + location.pathname);
  if (cfgName !== "default") u.searchParams.set("config", cfgName);
  u.searchParams.set(scene ? "webscene" : "webmap", itemId);
  return u.href;
}
async function shareMapLink(item) {
  const link = mapLink(item.id, item.type === "Web Scene");
  try { await navigator.clipboard.writeText(link); toast(t("linkCopied", { title: item.title || "" }), 5000); }
  catch (e) { window.prompt(S.linkCopyManually, link); }   // no clipboard access (an old browser, or permission refused): show the link to copy
}
function forgetBrowse() { mapBrowser.forget(); addBrowser.forget(); groupLoaded = false; }
const agolState = { start: 1, loading: false };
function mapCard(item, onOpen) {     // My ArcGIS Online maps
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
  if (tabId === "tabDevice") renderSavedMaps();
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
$("tool-add").addEventListener("click", () => leaveData(() => openAddModal("tabLayers")));

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
  restoreEditedLayer(); addState = null; removePreview(true);
  openPanel("data");
  $("dataH").textContent = S.addData;
  $("dataError").textContent = msg; $("dataError").hidden = false;
  $("llPicker").hidden = true; $("dataControls").hidden = true; $("dataSubmit").disabled = true;
}
// The hemisphere letters the map's Coordinates tool writes in this app's language (from the SDK's own translations),
// so a column copied from that tool reads correctly: N/S/E/W in English, O for west in Spanish, O for east in German...
let hemisphereLetters = null;
async function loadHemisphereLetters() {
  if (hemisphereLetters) return hemisphereLetters;
  // Read from the Coordinates component's own translation file. (Not through the SDK's message bundles: asking those for
  // the old widget's bundle left it cached, and the component was then handed it and failed its first drawing.)
  hemisphereLetters = {};
  const loc = String(cfg.locale || "en"), tries = [...new Set([loc, loc.split("-")[0], "en"])];
  for (const l of tries) {
    try {
      const r = await fetch(`https://js.arcgis.com/${SDK_VERSION}/map-components/assets/coordinate-conversion/t9n/messages.${l}.json`);
      if (!r.ok) continue;
      const m = await r.json(); if (m && m.abbreviatedDirections) { hemisphereLetters = m.abbreviatedDirections; break; }
    } catch (e) { console.warn("Hemisphere letters not loaded; English letters only", e); }
  }
  return hemisphereLetters;
}
async function handleCsvText(name, text) {
  const parsed = readCsv(text, Number(cfg.csvMaxRows) || 1000, await loadHemisphereLetters());
  if (!parsed.ok) { showDataError(t(parsed.code, parsed.params)); return; }
  if (parsed.latIdx < 0 || parsed.lonIdx < 0) { showLatLonPicker(name, parsed); return; }
  continueCsv(name, parsed, parsed.latIdx, parsed.lonIdx);
}
function showLatLonPicker(name, parsed) {
  restoreEditedLayer(); addState = null; removePreview(true);
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
  // the same column in both boxes: it holds both coordinates (copied from the Coordinates tool, say)
  if (la === lo && !buildLayerData(pendingParse.name, pendingParse.parsed, la, lo).ok) { toast(S.pickOneColumn, 7000); return; }
  const p = pendingParse; pendingParse = null;
  continueCsv(p.name, p.parsed, la, lo);
});
function continueCsv(name, parsed, latIdx, lonIdx) {
  const data = buildLayerData(name, parsed, latIdx, lonIdx);
  if (!data.ok) { showDataError(t(data.code, data.params)); return; }
  restoreEditedLayer();
  addState = data;
  addState.src = { name, parsed, latIdx, lonIdx };   // for Swap latitude and longitude
  addState.symbolChoices = { shape: "esriSMSCircle", color: hexToRgb(PALETTE_HEX[0]), size: 12, ramp: "blue" };
  addState.style = pickAutoStyle(addState);
  addState.fieldChoices = pickAutoFields(addState.style, addState);
  removePreview(false);
  if (!prePreviewCam) { try { prePreviewCam = { center: [view.center.longitude, view.center.latitude], zoom: view.zoom, camera: mode === "3d" && view.camera ? view.camera.clone() : null }; } catch (e) { prePreviewCam = null; } }
  openPanel("data");
  renderDataPanel();
  updatePreview(true);
}
// Change the style of a spreadsheet layer already on the map: the same panel, filled in from the layer's definition.
// The layer is hidden while the preview shows; Cancel puts it back, Apply replaces it in the same place with the same id.
function editDataLayer(layer) {
  if (openPanelName === "data") closePanels(false);
  const st = stateFromLayerDef(layer._srcDef);
  if (!st.ok) { toast(S.styleCantChange); return; }
  st.editing = { layer, wasVisible: layer.visible !== false };
  addState = st;
  removePreview(false); prePreviewCam = null;
  layer.visible = false;
  openPanel("data");
  renderDataPanel();
  styleAtStart = styleDef();   // so leaving without changing anything doesn't ask
}
function restoreEditedLayer() { if (addState && addState.editing) addState.editing.layer.visible = addState.editing.wasVisible; }
function backToLayers(layerId) {
  openPanel("layers", { focus: false });
  const b = [...$("layersList").querySelectorAll("[data-style-for]")].find((x) => x.dataset.styleFor === layerId);
  if (b) b.focus(); else { const h = $("layersH"); if (h) h.focus(); }
}
function renderDataPanel() {
  const editing = !!addState.editing;
  $("dataH").textContent = editing ? t("changeStyleTitle", { title: addState.editing.layer.title || "" }) : S.dataLooksGood;
  $("dataSubmit").textContent = editing ? S.applyStyle : S.addToMap;
  $("swapRow").hidden = editing || !addState.src || addState.swappable === false;   // in Change style the points are already placed
  $("dataError").hidden = true; $("llPicker").hidden = true; $("dataControls").hidden = false; $("dataSubmit").disabled = false;
  // categories counted as text columns only: number codes are offered under "By type" but are counted as numbers
  let s = t("dataSummary", { n: addState.features.length, num: addState.numeric.length, cat: (addState.categoricalText || addState.categorical).length });
  if (addState.dropped) s += " " + t("dataSkipped", { n: addState.dropped });
  $("dataSummary").textContent = s;
  $("dataSize").value = addState.symbolChoices.size; $("dataSizeVal").textContent = addState.symbolChoices.size + " px";
  renderStyleList(); renderFieldRows(); renderSymbolBlocks();
}
function renderStyleList() {
  const wrap = $("styleList"); wrap.innerHTML = "";
  for (const style of DATA_STYLES) {
    // Pie charts only draw in 2D, so in the 3D view they aren't offered (a layer that is already pie charts keeps its choice).
    const not3d = style.id === "pie_chart" && mode === "3d" && addState.style.id !== "pie_chart";
    const ok = styleAvailable(style, addState) && !not3d;
    const b = document.createElement("button"); b.type = "button"; b.className = "style-card"; b.disabled = !ok;
    b.setAttribute("aria-pressed", String(addState.style.id === style.id));
    b.title = ok ? S[STYLE_TEXT[style.id][1]] : (not3d && styleAvailable(style, addState) ? S.pieOnly2d : S.styleNeeds);
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
  if (addState.style.id === "pie_chart") wrap.appendChild(pieColumnsBox());
  // Offered in the 3D view only: in 2D it would change nothing on screen. A layer that has it keeps it while styled in 2D.
  if (F.columns3d === true && mode === "3d" && addState.style.fields.includes("size") && addState.style.id !== "pie_chart") {
    const row = document.createElement("div"); row.className = "pie-col col3d";
    const cb = document.createElement("input"); cb.type = "checkbox"; cb.id = "columns3dBox"; cb.checked = !!addState.columns3d;
    cb.setAttribute("aria-describedby", "columns3dHint");
    const lb = document.createElement("label"); lb.htmlFor = cb.id; lb.textContent = S.columns3d;
    const hint = document.createElement("p"); hint.className = "hint"; hint.id = "columns3dHint"; hint.textContent = S.columns3dHint;
    cb.addEventListener("change", () => { addState.columns3d = cb.checked; renderSymbolBlocks(); });
    row.append(cb, lb); wrap.append(row, hint);
  }
}
// Which number columns make up each pie (2 to 8); each pie is sized by the total of those columns only.
function pieColumnsBox() {
  const c = addState.fieldChoices;
  c.pie = pieFields(addState);
  const fs = document.createElement("fieldset"); fs.className = "pie-cols";
  const lg = document.createElement("legend"); lg.textContent = S.pieColumns;
  const hint = document.createElement("p"); hint.className = "hint"; hint.id = "pieColsHint"; hint.textContent = t("pieColumnsHint", { min: PIE_MIN, max: PIE_MAX });
  fs.setAttribute("aria-describedby", "pieColsHint");
  fs.append(lg, hint);
  const boxes = [];
  const sync = () => { const n = c.pie.length; boxes.forEach((b) => { b.disabled = (b.checked && n <= PIE_MIN) || (!b.checked && n >= PIE_MAX); }); };
  addState.numeric.forEach((name, i) => {
    const row = document.createElement("div"); row.className = "pie-col";
    const cb = document.createElement("input"); cb.type = "checkbox"; cb.id = "pieCol" + i; cb.value = name; cb.checked = c.pie.includes(name);
    const lb = document.createElement("label"); lb.htmlFor = cb.id; lb.textContent = aliasOf(addState, name);
    cb.addEventListener("change", () => {
      c.pie = addState.numeric.filter((n) => (n === name ? cb.checked : c.pie.includes(n)));
      sync(); renderSymbolBlocks();
    });
    boxes.push(cb); row.append(cb, lb); fs.appendChild(row);
  });
  sync();
  return fs;
}
$("dataSwap").addEventListener("click", () => {
  if (!addState || !addState.src || addState.editing) return;
  const { name, parsed, latIdx, lonIdx, swapped } = addState.src;
  const pair = latIdx === lonIdx;   // one column with both: turn its order round instead of swapping columns
  const data = pair ? buildLayerData(name, parsed, latIdx, lonIdx, { swapped: !swapped }) : buildLayerData(name, parsed, lonIdx, latIdx);
  if (!data.ok) { toast(S.swapNoPoints, 6000); return; }
  const before = addState;
  data.src = pair ? { name, parsed, latIdx, lonIdx, swapped: !swapped } : { name, parsed, latIdx: lonIdx, lonIdx: latIdx };
  data.symbolChoices = before.symbolChoices;
  const keepStyle = styleAvailable(before.style, data);
  data.style = keepStyle ? before.style : pickAutoStyle(data);
  data.fieldChoices = keepStyle ? before.fieldChoices : pickAutoFields(data.style, data);
  addState = data;
  renderDataPanel();
  updatePreview(true);
  toast(t("swappedLatLon", { n: data.features.length }));
  $("dataSwap").focus();
});
function renderSymbolBlocks() {
  const c = addState.symbolChoices, isPie = addState.style.id === "pie_chart";
  const single = addState.style.id === "simple" || addState.style.id === "graduated";
  const ramp = addState.style.id === "numeric_color_size" && !!addState.fieldChoices.color;
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
    b.style.background = "linear-gradient(" + (c.rampReverse ? 270 : 90) + "deg," + r.colors.map((col) => "rgb(" + col.join(",") + ")").join(",") + ")";   // drawn low to high, as it will be used
    b.addEventListener("click", () => { c.ramp = r.id; renderSymbolBlocks(); }); rl.appendChild(b);
  }
  $("rampRevRow").hidden = !ramp; $("rampReverse").checked = !!c.rampReverse;
  updateConfigSummary();
  updatePreview(false);
}
$("rampReverse").addEventListener("change", () => { if (addState) { addState.symbolChoices.rampReverse = $("rampReverse").checked; renderSymbolBlocks(); } });
function updateConfigSummary() {
  const c = addState.fieldChoices, A = (n) => (n ? aliasOf(addState, n) : "—");
  const numColor = addState.style.id === "numeric_color_size";
  let s;
  switch (addState.style.id) {
    case "pie_chart": s = t("sumPie", { n: pieFields(addState).length }); break;
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
  if (restoreCam && prePreviewCam) goToSafe(mode === "3d" && prePreviewCam.camera ? prePreviewCam.camera : { center: prePreviewCam.center, zoom: prePreviewCam.zoom }, { animate: false });   // in 3D: the tilt and heading too
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
    if (frame) fl.when().then(() => fl.queryExtent()).then((r) => { if (r && r.extent) goToSafe(frameTarget(r.extent.expand(1.2)), { animate: false }); }).catch(() => {});
  }, frame ? 0 : 200);
}
function submitData() {
  if (!addState) { closePanels(); return; }
  if (addState.editing) { applyStyleEdit(); return; }
  const def = buildLayerDef(addState, "csv" + Date.now().toString(36) + (++dataLayerSeq));
  const n = addState.features.length;
  removePreview(false); prePreviewCam = null;
  let fl;
  try { fl = addDataLayer(def); } catch (e) { console.error(e); toast(S.layerFailed.replace("{title}", def.title)); return; }
  addState = null;
  closePanels();
  fl.when().then(() => fl.queryExtent()).then((r) => { if (r && r.extent) goToSafe(frameTarget(r.extent.expand(1.2)), { animate: false }); }).catch(() => {});
  toast(t("addedPoints", { n }));
}
function applyStyleEdit() {
  const { layer: old, wasVisible } = addState.editing, src = old._srcDef;
  endLayerTools(old);
  const def = buildLayerDef(addState, src.id, src.title || old.title);
  removePreview(false);
  let fl;
  try { fl = buildDataLayer(def); } catch (e) { console.error(e); toast(S.styleCantChange); return; }
  fl.visible = wasVisible; fl.opacity = old.opacity; fl.definitionExpression = old.definitionExpression;
  const m = activeMap(), at = m.layers.indexOf(old);
  dataLayers[dataLayers.indexOf(old)] = fl;
  removeFromMaps(old);
  if (at >= 0) m.add(fl, at); else m.add(fl);
  keepSketchOnTop();
  addState = null;   // so closing the panel doesn't put the old layer back
  markDirty();
  closePanels(false);
  backToLayers(fl.id);
  toast(t("styleChanged", { title: fl.title }));
}
$("dataSubmit").addEventListener("click", submitData);
$("dataCancel").addEventListener("click", () => closePanels());
$("dataClose").addEventListener("click", () => closePanels());

// Opening another tool while Add data holds a file that isn't on the map yet (or Change style holds changes that
// aren't applied) would lose that work, so ask first. Cancel, × and Escape in the panel itself discard straight away.
let leaveNext = null, styleAtStart = null;
function styleDef() {
  try { const ed = addState.editing, src = ed.layer._srcDef; return JSON.stringify(buildLayerDef(addState, src.id, src.title || ed.layer.title)); }
  catch (e) { return null; }
}
function unfinishedData() {
  if (openPanelName !== "data") return null;
  if (addState && addState.editing) return styleDef() === styleAtStart ? null : { style: true, title: addState.editing.layer.title || "" };
  if (addState) return { style: false, title: addState.fileName || "" };
  if (pendingParse && !$("llPicker").hidden) return { style: false, title: pendingParse.name || "" };
  return null;
}
function leaveData(next) {
  const u = unfinishedData();
  if (!u) { next(); return; }
  leaveNext = next;
  $("leaveH").textContent = u.style ? S.leaveStyleTitle : S.leaveDataTitle;
  $("leaveText").textContent = t(u.style ? "leaveStyleText" : "leaveDataText", { title: u.title });
  $("leaveDiscard").textContent = u.style ? S.discardChanges : S.discardData;
  openModal("leaveModal", $("leaveKeep"));
}
$("leaveDiscard").addEventListener("click", () => {
  const next = leaveNext; leaveNext = null;
  closeModal("leaveModal");
  closePanels(false);
  if (next) next();
});
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
  // the dropped file's own handle (Chrome, Edge), asked for now while the drop event lasts, so Save can refuse to overwrite it
  const item = e.dataTransfer.items && e.dataTransfer.items[0];
  const handle = item && item.kind === "file" && item.getAsFileSystemHandle ? item.getAsFileSystemHandle().catch(() => null) : null;
  if (f) handleDroppedFile(f, handle);
});
function readText(file) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsText(file); }); }
async function handleDroppedFile(f, handlePromise) {
  const name = f.name || "";
  if (/\.(amap|mmap|json)$/i.test(name)) {
    if (F.localSave === false) return;
    if (!confirmDiscard()) return;
    try { const txt = await readText(f); if (await openDocText(txt, name)) bindOpened(handlePromise ? await handlePromise : null, txt); } catch (e) { toast(S.cantRead); }
    return;
  }
  if ((/\.(csv|txt)$/i.test(name) || f.type === "text/csv") && F.csv !== false) {
    try { await handleCsvText(name, await readText(f)); } catch (e) { toast(S.cantRead); }
    return;
  }
  if (/\.(xlsx|xlsm|xlsb|xls|ods|numbers)$/i.test(name)) { toast(S.excelFile, 9000); return; }
  toast(S.dropWhat, 5000);
}

// ============================================================ Local save and open (.amap; older .mmap files open too)
// A sketch drawn in 3D carries a height of 0 on every point (the sketch layer lies on the ground). Saved sketches are
// flat shapes, as the ones drawn in 2D are: x and y only (Sketch 3D 1.0).
function flatGeometryJson(geom) {
  const j = geom.toJSON(), xy = (c) => [c[0], c[1]];
  delete j.hasZ; delete j.hasM; delete j.z; delete j.m;
  if (j.paths) j.paths = j.paths.map((p) => p.map(xy));
  if (j.rings) j.rings = j.rings.map((r) => r.map(xy));
  if (j.points) j.points = j.points.map(xy);
  return j;
}
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
    graphics: graphicsLayer.graphics.toArray().map((g) => { straighten(g); return { geometry: flatGeometryJson(g.geometry), attributes: { ...g.attributes } }; }),
    layers: dataLayers.map((fl) => ({ ...fl._srcDef, visible: fl.visible !== false, opacity: fl.opacity, showLabels: fl.labelsVisible !== false, definitionExpression: hasFilter(fl) ? filterText(fl) : undefined }))
  };
  if (bookmarks.length) doc.bookmarks = bookmarks.map((b) => ({ title: b.title, viewpoint: b.viewpoint, layers: b.layers || [], thumb: b.thumb || null, camera: b.camera ? b.camera.toJSON() : null }));
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
  bookmarks = doc.bookmarks || []; updateToolBadges();
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
  if (looksLikeWebScene(raw)) return openWebSceneFile(raw, fileName);
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
    window.showOpenFilePicker({ multiple: false, types: [{ description: S.mapFile, accept: { "application/json": OPEN_EXTS } }] })
      .then(async ([h]) => { const f = await h.getFile(), txt = await f.text(); if (await openDocText(txt, h.name || f.name)) bindOpened(h, txt); })
      .catch((err) => { if (err && err.name === "AbortError") return; pickViaInput(); });
  } else pickViaInput();
}
function pickViaInput() {
  const input = document.createElement("input"); input.type = "file"; input.accept = OPEN_EXTS.join(",") + ",application/json";
  input.addEventListener("change", async () => {
    const f = input.files && input.files[0];
    if (!f) return;
    try { const txt = await readText(f); if (await openDocText(txt, f.name)) bindOpened(null, txt); } catch (e) { toast(S.cantRead); }
  });
  input.click();
}
function downloadBlob(blob, filename) { const u = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = u; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 1000); }
// The saved file is an ArcGIS web map (Web Map Specification): the same JSON that Save to ArcGIS Online stores.
let unsavedLayers = 0, privateLeftOut = 0;
async function buildWebMapJson(toFile) {
  privateLeftOut = 0;
  const doc = buildDocument();
  const ext = view.extent ? view.extent.clone() : null;
  const added = [...portalLayers.values()].map(layerToJson);
  unsavedLayers = added.filter((x) => !x).length;
  const ctx = { baseMap: await currentBaseMapJson(toFile), sourceLayers: sourceLayersJson(toFile), portalLayers: added.filter(Boolean),
    extent: ext ? ext.toJSON() : null, scale: mode === "2d" ? mapView.scale : null, rotation: mode === "2d" ? mapView.rotation || 0 : 0,
    appVersion: APP_VERSION, sketchTitle: S.sketchLayer, sketchVisible: graphicsLayer.visible !== false, widgets: timeWidgetsJson(),
    sketchIcon: (a) => { const v = vectorSymbol(styleOf(a)); try { return v ? v.toJSON() : null; } catch (e) { return null; } },   // the vector symbol itself, as Map Viewer saves it
    order: activeMap().layers.toArray().filter((l) => l !== graphicsLayer && l !== previewLayer).map((l) => l.id) };
  // A web scene is saved as a web scene (3.0): its ground, lighting and kind of scene, the camera, and the bookmarks as slides.
  if (sceneOnly) return docToWebScene(doc, { ...ctx, camera: sceneView && sceneView.camera ? sceneView.camera.toJSON() : null, scene: (currentSource && currentSource.data) || null });
  const wm = docToWebMap(doc, ctx);
  if (twoDOnly) wm[TWO_D_ONLY_PROP] = true;   // its author switched 3D off: the saved copy stays 2D only
  return wm;
}
async function docText(locked) { const wm = await buildWebMapJson(true); if (locked) wm[LOCK_PROP] = true; return JSON.stringify(wm); }
function saveToDevice(forceNew, locked) {
  if (portalUser) return;   // signed in: maps save to ArcGIS Online (see applySaveMode)
  if (openedLocked && !locked && (forceNew || !currentFileHandle)) toast(S.lockedSaveCopy, 7000);   // said when it matters: at Save
  if (!window.showSaveFilePicker) { openNameDialog(locked); return; }
  writeToHandle(forceNew, locked);
}
// locked: Save a locked copy. It writes a new locked file and leaves the map where it was (Save keeps going there).
async function writeToHandle(forceNew, locked) {
  let target = locked ? null : currentFileHandle;
  try {
    if (forceNew || locked || !target) {
      const suggested = locked ? lockedBase() : openedLocked ? copyBase() : titleSlug();
      const picked = await window.showSaveFilePicker({ suggestedName: suggested + FILE_EXT, types: [{ description: S.mapFile, accept: { "application/json": [FILE_EXT] } }] });
      const opened = await openedEntry(picked);
      if (opened) { toast((await restoreOpened(opened, picked)) ? S.lockedKept : S.restoreFailed, 9000); return; }   // a locked map: put back as it was
      target = picked;
    } else {
      if (target.queryPermission && (await target.queryPermission({ mode: "readwrite" })) !== "granted") {
        // A map opened from the saved list or from a file: ask to write to its file now, while the click still counts.
        if ((await target.requestPermission({ mode: "readwrite" })) !== "granted") { const d = new Error("Not allowed"); d.name = "NotAllowedError"; throw d; }
      }
      // locked since it was opened (a copy of the file locked in its place, say)? Save makes a copy instead
      if (isLockedText(await (await target.getFile()).text())) { openedLocked = true; currentFileHandle = null; $("lockedNote").hidden = false; toast(S.lockedSaveCopy, 7000); return writeToHandle(true); }
    }
    const name = target.name || (locked ? lockedBase() : titleSlug()) + FILE_EXT;
    const w = await target.createWritable();
    await w.write(new Blob([await docText(locked)], { type: "application/json" })); await w.close();
    if (locked) {
      toast(t("lockedSaved", { name }), 7000);
      recordSave({ handle: target, fileName: name });
      return;
    }
    currentFileHandle = target; openedLocked = false; $("lockedNote").hidden = true;
    setTitle(titleFromFileName(name));   // a saved map is named by its file: the header shows what reopening shows
    markClean();
    toast(t("savedFile", { name }));
    recordSave({ handle: target, fileName: name });
    saveNotes(true);
  } catch (err) {
    // Chrome reports two things as AbortError: Cancel in the save box ("The user aborted a request."), and a file
    // it couldn't open for writing ("Failed to create or truncate file": someone else's file, a read-only one).
    if (err && err.name === "AbortError") { if (!/user aborted/i.test(err.message || "user aborted")) toast(S.cantSaveThere, 8000); return; }
    if (err && (err.name === "NotAllowedError" || err.name === "NoModificationAllowedError") && !forceNew && !locked) { toast(S.readOnlyFile, 5000); currentFileHandle = null; return writeToHandle(true); }
    console.error(err);
    if (!locked) currentFileHandle = null;
    openNameDialog(locked);
  }
}
let nameDialogLocked = false;
function openNameDialog(locked) { nameDialogLocked = !!locked; $("fileNameInput").value = locked ? lockedBase() : openedLocked ? copyBase() : titleSlug(); openModal("nameModal", $("fileNameInput")); setTimeout(() => $("fileNameInput").select(), 0); }
async function confirmNameDialog() {
  const name = ($("fileNameInput").value || "map").replace(/[^\w\-]+/g, "_").slice(0, 60) || "map";
  const locked = nameDialogLocked;
  closeModal("nameModal");
  if (!locked) setTitle(titleFromFileName(name));   // as above
  try {
    const text = await docText(locked);
    downloadBlob(new Blob([text], { type: "application/json" }), name + FILE_EXT);
    if (locked) { toast(t("lockedSaved", { name: name + FILE_EXT }), 7000); recordSave({ json: text, fileName: name + FILE_EXT }); return; }
    markClean(); toast(t("savedDownload", { name: name + FILE_EXT }));
    recordSave({ json: text, fileName: name + FILE_EXT });
  } catch (e) { console.error(e); toast(S.saveFailed); return; }
  saveNotes(true);
}
$("nameConfirm").addEventListener("click", confirmNameDialog);
$("fileNameInput").addEventListener("keydown", (e) => { if (e.key === "Enter") confirmNameDialog(); });
$("saveTile").addEventListener("click", () => (portalUser ? saveToAgol(false) : saveToDevice(false)));
$("saveAsTile").addEventListener("click", () => (portalUser ? saveToAgol(true) : saveToDevice(true)));
$("lockTile").addEventListener("click", () => { if (!portalUser) saveToDevice(true, true); });
$("shotTile").addEventListener("click", () => {
  view.takeScreenshot({ format: "png" }).then((s) => { fetch(s.dataUrl).then((r) => r.blob()).then((b) => { downloadBlob(b, titleSlug() + ".png"); toast(S.shotSaved); }); })
    .catch(() => toast(S.shotFailed));
});

// ============================================================ Saved maps on this device (Open map > My map files)
// Every save adds the map to a list kept in this browser (lib/recent.js), newest first. In Chrome and Edge the list keeps
// a handle to the file, so Open reads the file itself and Save goes on writing to it; browsers that can only download
// (Safari, Firefox) keep a copy of the saved map instead, as they can't open a file again by themselves.
let recentStore = null, recentFailed = false, savedSeq = 0;
async function recentDb() {
  if (recentStore || recentFailed) return recentStore;
  try { recentStore = await openRecentStore(window.indexedDB, cfgName); }
  catch (e) { console.warn("This browser isn't keeping a list of saved maps", e); recentFailed = true; }
  return recentStore;
}
async function mapPicture() {
  try { return (await view.takeScreenshot({ width: 300, height: 200, format: "jpg", quality: 72 })).dataUrl; } catch (e) { return null; }
}
async function recordSave(o) {
  try {
    const db = await recentDb();
    if (!db) return;
    const picture = mapPicture();   // taken now, while the map shows what was saved
    const entry = makeEntry({ scope: cfgName, title: currentTitle(), fileName: o.fileName, handle: o.handle || null, json: o.json || null, appVersion: APP_VERSION });
    const stored = await db.record(entry, o.handle ? (h) => h.isSameEntry(o.handle) : null);
    const showing = () => !$("openModal").hidden && !$("paneDevice").hidden;
    if (showing()) renderSavedMaps();
    const thumb = await picture;
    if (thumb) { await db.setThumb(stored.id, thumb); if (showing()) renderSavedMaps(); }
  } catch (e) { console.warn("Couldn't add the map to the saved list", e); }
}
function savedWhen(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  try { return d.toLocaleString(cfg.locale || undefined, { dateStyle: "medium", timeStyle: "short" }); } catch (e) { return d.toLocaleString(); }
}
function savedCard(r) {
  const title = titleFromFileName(r.fileName) || r.title || S.untitled;   // the name the map opens with (from its file)
  const li = document.createElement("li"); li.className = "cat-card"; li.dataset.id = r.id;
  const top = document.createElement("div"); top.className = "cat-card-top";
  const txt = document.createElement("div"); txt.className = "cat-card-text";
  const h = document.createElement("h4"); h.className = "cat-card-title"; h.textContent = title;
  const meta = document.createElement("p"); meta.className = "dev-meta"; meta.textContent = [t("savedOn", { date: savedWhen(r.savedAt) }), r.fileName].filter(Boolean).join(" · ");
  const acts = document.createElement("div"); acts.className = "dev-acts";
  const rm = document.createElement("button"); rm.type = "button"; rm.className = "cat-act quiet"; rm.textContent = S.removeFromList;
  rm.setAttribute("aria-label", S.removeFromList + ": " + title);   // the visible words first, then the map
  rm.addEventListener("click", () => removeSavedMap(r.id, title));
  const open = document.createElement("button"); open.type = "button"; open.className = "cat-act"; open.textContent = S.openThisMap;
  open.setAttribute("aria-label", S.openThisMap + ": " + title);
  open.addEventListener("click", () => openSavedMap(r.id));
  acts.append(rm, open);
  txt.append(h, meta, acts);
  const th = document.createElement("div"); th.className = "cat-thumb open" + (r.thumb ? "" : " blank"); th.setAttribute("aria-hidden", "true");
  if (r.thumb) th.style.backgroundImage = "url('" + r.thumb + "')";   // a checked data: URL (lib/recent.js)
  else th.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" focusable="false"><path d="M2.5 6.5 9 4l6 2.5L21.5 4v13.5L15 20l-6-2.5-6.5 2.5z"/><path d="M9 4v13.5M15 6.5V20"/></svg>';
  th.addEventListener("click", () => openSavedMap(r.id));
  top.append(txt, th);
  li.appendChild(top);
  return li;
}
async function renderSavedMaps(focusAfter) {
  const seq = ++savedSeq, list = $("savedList"), status = $("savedStatus"), note = $("savedNote");
  const db = await recentDb();
  let rows = null;
  if (db) { try { rows = await db.list(); } catch (e) { console.warn(e); } }
  if (seq !== savedSeq) return;
  list.innerHTML = "";
  if (!rows) { status.textContent = S.savedMapsUnavailable; note.textContent = ""; return; }
  status.textContent = !rows.length ? S.savedMapsNone : rows.length === 1 ? S.savedMapsCountOne : t("savedMapsCount", { n: rows.length });
  note.textContent = !rows.length ? "" : rows.some((r) => !r.hasHandle) ? S.savedMapsNoteCopy : S.savedMapsNote;
  for (const r of rows) list.appendChild(savedCard(r));
  if (focusAfter != null) {
    const cards = [...list.querySelectorAll(".cat-card")];
    const f = cards[Math.min(focusAfter, cards.length - 1)];
    (f ? f.querySelector(".cat-act:not(.quiet)") : $("browseDevice")).focus();
  }
}
async function removeSavedMap(id, title) {
  const db = await recentDb();
  if (!db) return;
  const index = [...$("savedList").querySelectorAll(".cat-card")].findIndex((li) => li.dataset.id === id);
  try { await db.remove(id); toast(t("removedFromList", { title })); } catch (e) { console.warn(e); }
  renderSavedMaps(Math.max(0, index));
}
async function openSavedMap(id) {
  const db = await recentDb();
  const r = db && await db.get(id).catch(() => null);
  if (!r) { renderSavedMaps(); return; }
  const name = (r.handle && r.handle.name) || r.fileName;
  if (r.handle) {
    let text;
    try {
      // The browser asks once whether this site may open the file again (it may remember the answer).
      let perm = r.handle.queryPermission ? await r.handle.queryPermission({ mode: "read" }) : "granted";
      if (perm !== "granted") perm = await r.handle.requestPermission({ mode: "read" });
      if (perm !== "granted") { toast(t("savedMapDenied", { name }), 6000); return; }
      text = await (await r.handle.getFile()).text();
    } catch (e) {
      if (e && e.name === "NotFoundError") toast(t("savedMapMissing", { name }), 7000);
      else if (e && (e.name === "NotAllowedError" || e.name === "SecurityError")) toast(t("savedMapDenied", { name }), 6000);
      else { console.error(e); toast(S.cantRead, 5000); }
      return;
    }
    if (!confirmDiscard()) return;
    if (await openDocText(text, name)) bindOpened(r.handle, text);
    return;
  }
  if (typeof r.json !== "string") { toast(S.cantRead, 5000); return; }
  if (!confirmDiscard()) return;
  if (await openDocText(r.json, name)) bindOpened(null, r.json);
}

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
      cfg.disclaimer || "", cfg.appName + " · " + new Date().toLocaleDateString(cfg.locale || undefined)];
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
// Signed out, Save and Save as write a file on this device. Signed in, the same two tiles go to the user's ArcGIS Online account instead
// (Save overwrites the map's own item, Save as asks for a new name), so a file can't carry a map that includes content only that account can see.
// Opening a file works either way.
function applySaveMode() {
  const local = F.localSave !== false, signed = !!portalUser;
  for (const id of ["saveTile", "saveAsTile"]) $(id).hidden = !(local || signed);
  $("lockTile").hidden = !local || signed;   // a locked copy is a file; signed in, maps save to ArcGIS Online
  refreshTileTips();
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
  applySaveMode();
}
function renderAgol() {
  const on = !!portalUser;
  $("signInTile").hidden = on || F.signIn === false; $("agolSignedIn").hidden = !on;
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
$("signInTile").addEventListener("click", startSignIn);
// Save panel tiles: a short explanation on mouse-over and keyboard focus (and to screen readers, as each
// tile's description). It can be dismissed with Escape and hovered over (WCAG 1.4.13).
var TILE_TIPS = {   // var: the config step can ask for the tips before this line has run
  saveTile: () => (portalUser ? S.tipSaveSignedIn : window.showSaveFilePicker ? S.tipSave : S.tipSaveDownloads),
  saveAsTile: () => (portalUser ? S.tipSaveAsSignedIn : S.tipSaveAs),
  lockTile: () => S.tipLock, shotTile: () => S.tipShot, printTile: () => S.tipPrint, signInTile: () => S.tipSignIn
};
function refreshTileTips() { if (!TILE_TIPS) return; for (const [id, f] of Object.entries(TILE_TIPS)) { const d = $("tip-" + id); if (d) d.textContent = f(); } }
let tipFor = null, tipHide = 0;
function showTileTip(tile) {
  clearTimeout(tipHide);
  const tip = $("tileTip"), f = TILE_TIPS[tile.id];
  if (!f || tile.hidden) return;
  tip.textContent = f(); tip.hidden = false; tipFor = tile;
  const r = tile.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight, gap = 8;
  const below = r.bottom + gap + h <= window.innerHeight - 4 || r.top - gap - h < 4;
  const left = Math.max(6, Math.min(window.innerWidth - w - 6, r.left + r.width / 2 - w / 2));
  tip.style.left = left + "px"; tip.style.top = (below ? r.bottom + gap : r.top - gap - h) + "px";
  tip.dataset.side = below ? "below" : "above";
  tip.style.setProperty("--arrow-x", Math.max(12, Math.min(w - 12, r.left + r.width / 2 - left)) + "px");
}
function hideTileTip(now) { clearTimeout(tipHide); const go = () => { $("tileTip").hidden = true; tipFor = null; }; if (now) go(); else tipHide = setTimeout(go, 150); }
for (const id of Object.keys(TILE_TIPS)) {
  const tile = $(id);
  tile.addEventListener("mouseenter", () => showTileTip(tile));
  tile.addEventListener("mouseleave", () => hideTileTip(false));
  tile.addEventListener("focus", () => { if (tile.matches(":focus-visible")) showTileTip(tile); });
  tile.addEventListener("blur", () => hideTileTip(true));
  tile.addEventListener("click", () => hideTileTip(true));
}
$("tileTip").addEventListener("mouseenter", () => clearTimeout(tipHide));
$("tileTip").addEventListener("mouseleave", () => hideTileTip(false));
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && tipFor) { e.stopPropagation(); e.preventDefault(); hideTileTip(true); } }, true);
window.addEventListener("scroll", () => hideTileTip(true), true);
refreshTileTips();

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
  if (currentSource && currentSource.restricted) toast(S.signedOutPrivateLayers, 8000);   // replaces "Signed out." so it isn't missed
  else toast(S.signedOut);
});

const LAYER_TYPE_JSON = { feature: "ArcGISFeatureLayer", "map-image": "ArcGISMapServiceLayer", tile: "ArcGISTiledMapServiceLayer", "vector-tile": "VectorTileLayer",
  imagery: "ArcGISImageServiceLayer", "imagery-tile": "ArcGISTiledImageServiceLayer", csv: "CSV", geojson: "GeoJSON", kml: "KML", wms: "WMS", wfs: "WFS",
  "web-tile": "WebTiledLayer", "geo-rss": "GeoRSS", stream: "ArcGISStreamLayer", "ogc-feature": "OGCFeatureLayer" };
// Operational layer JSON for a layer added from the collection. A layer that came from a saved map keeps its saved JSON.
// A layer's web map JSON as it is now: shown or not, transparency, labels on or off, and for a group its layers in
// their current order (any removed in Map layers left out).
function patchOpJson(op, l) {
  const out = { ...op, visibility: l.visible !== false, opacity: typeof l.opacity === "number" ? l.opacity : 1 };
  if (hasLabels(l)) out.showLabels = l.labelsVisible !== false;
  if (isGroup(l) && Array.isArray(op.layers)) {
    out.layers = l.layers.toArray().map((s) => { const o = op.layers.find((x) => x && x.id === s.id); return o ? patchOpJson(o, s) : layerToJson(s); }).filter(Boolean);
  }
  return filterJson(out, l);
}
function layerToJson(l) {
  const visibility = l.visible !== false, opacity = typeof l.opacity === "number" ? l.opacity : 1;
  if (l.__opJson) return { ...patchOpJson(l.__opJson, l), id: l.id, title: l.title || l.__opJson.title };
  const base = { id: l.id, title: l.title, visibility, opacity };
  if (hasLabels(l)) base.showLabels = l.labelsVisible !== false;
  if (l.type === "group") { const layers = l.layers.toArray().map(layerToJson).filter(Boolean); return layers.length ? { ...base, layerType: "GroupLayer", layers } : null; }
  const layerType = LAYER_TYPE_JSON[l.type];
  if (!layerType) { console.warn("Can't save a layer of type", l.type, l.title); return null; }
  const out = { ...base, layerType };
  if (l.portalItem && l.portalItem.id) out.itemId = l.portalItem.id;
  if (l.type === "feature") { if (l.url) out.url = l.layerId != null ? l.url + "/" + l.layerId : l.url; }
  else if (l.type === "vector-tile") { if (l.url) out.styleUrl = /\.json(\?|$)/i.test(l.url) ? l.url : l.url.replace(/\/?$/, "/resources/styles/root.json"); }
  else if (l.type === "web-tile") { if (l.urlTemplate) out.templateUrl = l.urlTemplate; }
  else if (l.url) out.url = l.url;
  return out.url || out.styleUrl || out.templateUrl || out.itemId ? filterJson(out, l) : null;
}
async function currentBaseMapJson(toFile) {
  const b = activeMap().basemap;
  const id = b && b.portalItem && b.portalItem.id;
  if (toFile && !id && currentSource && currentSource.restricted) return null;   // a private map's own basemap: the file uses the default one
  if (id) { try { const d = await restGet(`/sharing/rest/content/items/${id}/data`); if (d && d.baseMap) return d.baseMap; } catch (e) { /* fall through */ } }
  if (currentSource && currentSource.data && currentSource.data.baseMap && !id) return currentSource.data.baseMap;
  try { const j = b.toJSON(); if (j && j.baseMapLayers && j.baseMapLayers.length) return j; } catch (e) { /* fall through */ }
  try { const d = await restGet(`/sharing/rest/content/items/${cfg.defaultBasemap}/data`); if (d && d.baseMap) return d.baseMap; } catch (e) { /* offline */ }
  return null;   // the file still opens: the app's default basemap is used
}
// The opened map's own layers as they are now, in map order; layers removed in Map layers are left out.
function sourceLayersJson(toFile) {
  if (!currentSource || !currentSource.data) return [];
  const ops = (currentSource.data.operationalLayers || []).filter((op) => !isOwnLayerJson(op));
  if (toFile && currentSource.restricted) { privateLeftOut = ops.length; return []; }
  return sourceLayers().map((l) => { const op = ops.find((o) => o.id === l.id); return op ? patchOpJson(op, l) : null; }).filter(Boolean);
}
async function screenshotBlob(w, h) {
  try { const s = await view.takeScreenshot({ width: w, height: h, format: "png" }); return await (await fetch(s.dataUrl)).blob(); } catch (e) { return null; }
}
function agolStatus(html) { $("agolStatus").innerHTML = ""; if (html) $("agolStatus").appendChild(html); }
async function saveToArcGIS(update) {
  if (!portalUser) { startSignIn(); return; }
  const user = portalUser.username;
  // A role without the create-content privilege can't add items. The portal lists a user's privileges; if it doesn't, the server's own error is shown instead.
  if (!update && Array.isArray(portalUser.privileges) && portalUser.privileges.length && !portalUser.privileges.includes("portal:user:createItem")) {
    const s = document.createElement("span"); s.textContent = S.arcgisNoPrivilege; agolStatus(s); return;
  }
  if (sceneOnly) { const s = document.createElement("span"); s.textContent = S.sceneNoArcgisSave; agolStatus(s); return; }   // scenes save to this device for now
  const p = document.createElement("span"); p.textContent = S.arcgisSaving; agolStatus(p);
  try {
    const ext = view.extent.clone();
    const wmJson = await buildWebMapJson();
    const sw = xyToLonLat(ext.xmin, ext.ymin), ne = xyToLonLat(ext.xmax, ext.ymax);
    const form = new FormData();
    form.append("f", "json");
    // Save overwrites the map's own item and keeps the title in the header; Save as takes the name typed in the dialog.
    const title = update ? currentTitle() : ($("agolTitle").value.trim() || currentTitle());
    form.append("title", title);
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
    currentAgolItem = { id, owner: user, title };
    setTitle(title);   // the name given in the Save dialog becomes the map's name in the header
    markClean();
    renderAgol();
    const box = document.createElement("span");
    box.appendChild(document.createTextNode(S.arcgisSaved + " "));
    const a2 = document.createElement("a"); a2.href = `${PORTAL}/home/item.html?id=${id}`; a2.target = "_blank"; a2.rel = "noopener"; a2.textContent = S.openItemPage;
    box.append(a2);
    agolStatus(box);
    toast(S.arcgisSaved);
    saveNotes(false);
  } catch (e) {
    console.error("Save to ArcGIS Online failed", e);
    const s = document.createElement("span"); s.textContent = t("arcgisFailed", { msg: e.message || e.name || "" }); agolStatus(s);
  }
}
// Signed in: Save overwrites the map's own ArcGIS Online item (a map with none yet, or one that isn't the user's, asks for a name like Save as).
// Save as always opens the dialog and makes a new item.
function saveToAgol(asNew) {
  if (!asNew && currentAgolItem && currentAgolItem.owner === portalUser.username) { saveToArcGIS(true); return; }
  $("agolTitle").value = currentTitle(); $("agolSummary").value = ""; openModal("agolModal", $("agolTitle"));
}
$("agolConfirm").addEventListener("click", () => { closeModal("agolModal"); saveToArcGIS(false); });

// ============================================================ Versions
function renderVersions() {
  const rows = [
    [cfg.appName + " (app)", APP_VERSION, "White-label build of the MapMaker app: every MapMaker tool, local save, CSV data, ArcGIS Online sign-in. Created by Jason Sawle."],
    ["Basemaps", BASEMAPS_VERSION, "MapMaker's basemap cards: the basemap group's maps in the group's own order, two to a row; in 3D, its 3D basemaps first."],
    ["Saved maps list (Open map, My map files)", RECENT_VERSION, "Maps saved on this device, newest first, kept in this browser. Chrome and Edge reopen the file itself; Safari and Firefox keep a copy of each saved map."],
    ["Collection browser (Open map, Add layer)", CATALOG_VERSION, "MapMaker's category tree from the group's categories, with counts, search within a category, cards with descriptions, and pages. Where the collection has 3D maps (web scenes), a row above the maps shows all, the 2D maps or the 3D maps, with how many of each; a 3D map's card is marked 3D on its picture."],
    ["Units", UNITS_VERSION, "Kilometres and metres, or miles and feet, in Measure, Elevation and Sketch. With units set to auto the app starts in miles on a device whose time zone is in the United States and in kilometres elsewhere; if the time zone isn't known, the browser's language decides. Nothing is sent anywhere to work this out. The km / mi switch changes the units, and the choice is kept on this device."],
    ["Docks", "1.0", "The chart, the table and Elevation open in a dock under the map. Drag the bar along the dock's top, or use the arrow keys on it, to make it taller or shorter; double-click the bar for the usual height. The height is kept for each kind of dock while the app is open."],
    ["Charts", CHARTS_VERSION, "A chart set up on a layer in Map Viewer, drawn by the SDK's chart component under the map: Map layers, then the layer's Chart button. Selecting on the chart highlights those features on the map. The chart's own toolbar has its legend, selection, only what is in view, zoom and saving."],
    ["Elevation profile", PROFILE_VERSION, "The height of the land and the sea floor along a line, from Esri's World Elevation TopoBathy 3D service (up to 512 points along the line). A line you draw takes the shortest way round the Earth between the places you click (a great circle), so on the flat map a long line is a curve; a line you choose on the map is followed as it is drawn. The app's own chart, the full width under the map: earth colours that darken with depth, the sea and a sea-level line where the line goes below it, and a dot on the map at the place the pointer is at on the chart."],
    ["Compass", COMPASS_VERSION, "MapMaker's compass rose: turns with the map in 2D and 3D; select it to face north."],
    ["Saved map (.amap file and ArcGIS Online)", WEBMAP_WRITER_VERSION, "An ArcGIS web map (Web Map Specification " + WEBMAP_SPEC_VERSION + "): sketches, spreadsheet data, layers and their filters, basemap, view, bookmarks and a time-aware map's time settings. The same JSON is stored in ArcGIS Online. 3.0: a 3D scene is saved as a web scene (Web Scene Specification " + WEBSCENE_SPEC_VERSION + ") in the same kind of file, with its camera and its bookmarks as slides."],
    ["3D maps", "1.1", "3D maps (ArcGIS web scenes) from the collection or a link (webscene=<id>) open in 3D and stay there; their slides are the bookmarks, and a bookmark turns layers on and off as its slide does (not the slide's basemap or lighting). A web map whose item has the tag atlas-2d-only stays in 2D."],
    ["Loading", "1.1", "What is downloaded to start: a map opened from a link is fetched once, starts downloading straight away and replaces no default basemap; the code for Legend, Measure, Coordinates, Swipe, the table, Elevation and Sketch is downloaded when the tool is first opened. All of these are the SDK's components (or the app's own code), not its widgets, which SDK 6 removes."],
    ["Sketch measuring", "1.1", "While drawing: tooltips, the length of each side (segment labels) and snapping to other sketches are on from the start; each can be turned off in the toolbar's Settings. Lengths and areas are shown with no decimal places."],
    ["Sketch panel", "3.2", "Laid out like Map Viewer's Sketch pane: what the tool in hand does, then what suits it. The plain circle or plain fill is always first among the recent symbols, and a styled fill says how to get back to colours and an outline. A point has recent symbols and a Change symbol view (category, search, symbols). A selected sketch has its name, Pop-up, Duplicate and Delete. One toolbar on the map."],
    ["Sketch styles", "2.3", "Points: symbols from 14 of Esri's sketch styles, the ones Map Viewer's Sketch offers. Lines: patterns and arrows. Text, set up as in Map Viewer: a font (11, from Esri's font service), bold and italic where the font has them, size, colour, a halo with its colour and size, and rotation. Areas, set up as in Map Viewer: fill colour and transparency, outline colour, transparency, width and pattern, or a styled fill (hatches, land use, pencil landscape; 2D only). Tooltips are on while drawing."],
    ["Sketch in 3D", "1.0", "The Sketch toolbar works in the 3D view and in 3D maps with the same tools. Sketches lie on the ground and are saved as flat shapes, so they are the same in 2D."],
    ["Columns in 3D (lab)", COLUMNS_VERSION, "Only where a config turns it on (features.columns3d). A spreadsheet layer sized by a number column can be drawn in 3D as a column on each point. Height shows the number, from zero when no value is below zero; the tallest column is about a sixth of the distance across the points, and Size sets how thick the columns are. 2D and the saved style are unchanged, and the choice is not kept in a saved file yet."],
    ["3D quality", "1.0", "How much work the 3D view does. Low (smaller textures, less memory, no shadows or stars) is chosen for a device with 4 GB of memory or less, 4 processor cores or fewer, or no graphics chip; otherwise medium. A config (threeDQuality) or a link (?quality=low, medium or high) can fix it."],
    ["Views", "2.0", "The 2D and 3D views are the SDK's map and scene components, with Search, Home, Zoom, the navigation toggle and the scale bar as components in their slots."],
    ["Time", "1.0", "The SDK's Time Bar on maps saved with time settings: play, step and a slider, set up from the map's own settings."],
    ["Older .mmap files (open only)", String(DOC_VERSION), "MapMakerLocalDocument versions 2 to 4, from earlier versions of this app, the local-save concept and Map Studio. (.mmap files saved as web maps by versions 1.2 to 1.6 open like .amap files.)"],
    ["CSV import", CSV_VERSION, "Comma, semicolon or tab files, decimal commas, column choice; styles incl. pie charts (2D only); live preview. 3.5: in 3D and in 3D maps the features lie on the ground."],
    ["Filter (lab)", FILTER_VERSION, "A layer's Filter panel, laid out like Map Viewer's: conditions on number and text fields (including 'is one of' a list), a histogram with a slider, a count of what's shown. A filter the map's author set, a list included, opens as ordinary conditions that can be changed. Built from Calcite components and the SDK's Histogram and Slider components; saved as the layer's definitionExpression."],
    ["Sketch", SKETCH_VERSION, "Points, lines, areas, circles and text, with pop-ups, images, colour, size and rotation; move, reshape and delete."],
    [S.configLabel, String(cfg.configVersion || 1), cfgChain.join(".json, on ") + ".json (schema " + CONFIG_SCHEMA + ")" + (localeFile ? "; language file locales/" + localeFile.name + ".json " + (localeFile.version || "1.0") : "")],
    ["Configs and language files", CONFIG_VERSION, "A config lists only what differs from the app's defaults and can start from another config (extends). The app's wording in a language comes from one shared file per language."],
    ["ArcGIS Maps SDK for JavaScript", SDK_VERSION, "Esri mapping library"]
  ];
  const tbl = $("versTable"); tbl.innerHTML = "";
  const head = document.createElement("tr");
  for (const h of [S.part, S.version, S.whatItIs]) { const th = document.createElement("th"); th.scope = "col"; th.textContent = h; head.appendChild(th); }
  tbl.appendChild(head);
  for (const r of rows) { const tr = document.createElement("tr"); for (const c of r) { const td = document.createElement("td"); td.textContent = c; tr.appendChild(td); } tbl.appendChild(tr); }
}

// ============================================================ Start-up
// The Map layers count follows the map on screen: layers added or removed, another map opened.
reactiveUtils.watch(listedLayerCount, updateToolBadges, { initial: true });
view.when(() => {
  updatePopupEnabled();
  watchBottom(0);
  if (configMissing) toast("Config “" + configMissing + "” wasn't found, so the default is shown.", 6000);
  if (localeMissing) console.warn("No language file for \"" + localeMissing + "\" in locales/, so the app's own wording is in English unless the config supplies it.");
});
if (authStash) {
  if (cfgName !== "default") { const u = new URL(location.href); u.searchParams.set("config", cfgName); history.replaceState(history.state, "", u.pathname + u.search); }
  if (authStash.doc) { const res = sanitizeDoc(authStash.doc); if (res.ok) { await loadDocument(res.doc); markDirty(); } }
}
// A link can open a web map (webmap=<id>, in 2D) or a web scene (webscene=<id>, in 3D). With both, the scene is opened.
const linkedOpen = linkedScene ? openWebSceneItem(linkedScene, { skipConfirm: true }) : linkedMap ? openWebMapItem(linkedMap, { skipConfirm: true }) : null;
if (linkedOpen) linkedOpen.then((ok) => { if (!ok && !localMap.basemap) localMap.basemap = defaultBasemap(); }).finally(startDone);
else startDone();
console.info(cfg.appName, "v" + APP_VERSION, "config", cfgName);
