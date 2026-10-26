// Basemap gallery: the basemap group's items as MapMaker shows them (a two-column grid of cards).
// Pure functions (no ArcGIS SDK), so they can be unit tested.
export const BASEMAPS_VERSION = "2.0";   // 2.0 = MapMaker's card grid (1.x was Esri's stock Basemap Gallery widget)

const norm = (s) => String(s == null ? "" : s).trim().toLowerCase();

// The group's own sort, as ArcGIS Online stores it (MapMaker's basemap group: date added, newest first).
// Group content search accepts these fields; anything else falls back to the group's default order.
const SORT_FIELDS = new Set(["title", "added", "modified", "created", "owner", "type", "numviews", "avgrating"]);
export function groupSort(group) {
  const field = SORT_FIELDS.has(norm(group && group.sortField)) ? norm(group.sortField) : "";
  const order = norm(group && group.sortOrder) === "asc" ? "asc" : "desc";
  return field ? { sortField: field, sortOrder: order } : {};
}

// Which items to show, in order. 2D: web maps only. 3D: web scenes (3D basemaps) first, then the web maps,
// as Esri's gallery does. Items keep the group's order otherwise; duplicates are dropped.
export function basemapItems(items, mode) {
  const seen = new Set(), maps = [], scenes = [];
  for (const it of Array.isArray(items) ? items : []) {
    if (!it || typeof it.id !== "string" || !/^[0-9a-f]{32}$/i.test(it.id) || seen.has(it.id)) continue;
    if (it.type === "Web Map") maps.push(it);
    else if (it.type === "Web Scene" && mode === "3d") scenes.push(it);
    else continue;
    seen.add(it.id);
  }
  return [...scenes, ...maps];
}

// The thumbnail's address, at a width fit for a card on a high-density screen. Only the item's own
// thumbnail path is used ("thumbnail/<file>"), so a group item can't point the page anywhere else.
export function thumbnailUrl(portal, item, width) {
  const t = item && typeof item.thumbnail === "string" ? item.thumbnail.trim() : "";
  if (!t || !/^thumbnail\/[^/?#\\]+$/i.test(t) || !/^[0-9a-f]{32}$/i.test((item && item.id) || "")) return "";
  const base = String(portal || "").replace(/\/+$/, "");
  return `${base}/sharing/rest/content/items/${item.id}/info/${t.split("/").map(encodeURIComponent).join("/")}${width ? "?w=" + width : ""}`;
}

// Which card is the map's basemap: the same item; or, for a basemap that came inside a web map (no item), the same
// title as the card, or as the basemap inside the card's item (dataTitles: item id -> that title; the Dark Gray item's
// basemap is called "Human Geography Dark", so a saved map that used it says that). Returns the item id or null.
export function selectedId(items, basemap, dataTitles) {
  if (!basemap) return null;
  const list = Array.isArray(items) ? items : [];
  const id = basemap.itemId || null;
  if (id) return list.some((it) => it.id === id) ? id : null;
  const title = norm(basemap.title);
  if (!title) return null;
  const hit = list.find((it) => norm(it.title) === title) || (dataTitles ? list.find((it) => norm(dataTitles.get(it.id)) === title) : null);
  return hit ? hit.id : null;
}
// True when the only way left to find the card is the titles inside the items (worth fetching them once).
export function needsDataTitles(items, basemap) {
  return !!(basemap && !basemap.itemId && norm(basemap.title) && !selectedId(items, basemap));
}

// Arrow keys in a grid of `cols` columns: the index to move to, or null to stay.
export function gridMove(index, count, cols, key) {
  const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[key];
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (!step) return null;
  const n = index + step;
  return n >= 0 && n < count ? n : null;
}
