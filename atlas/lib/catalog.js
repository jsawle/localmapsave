// Open map topics: the content group's categories used to browse its web maps.
// Pure functions (no ArcGIS SDK), so they can be unit tested. Created by Jason Sawle.
export const CATALOG_VERSION = "1.0";
export const MAX_INDEX = 1000;        // up to this many web maps are loaded once and filtered in the browser
export const OTHER = "__other__";     // maps that sit in no topic of the group's category list
export const ALL = "";

// "/Categories/Human Geography/" and "/categories/human geography" are the same topic.
export const topicKey = (path) => String(path || "").trim().replace(/\/+$/, "").replace(/\/{2,}/g, "/").toLowerCase();

// Category schema (…/community/groups/<id>/categorySchema) -> tree of topics.
// Each node: { title, path, key, depth, parent, children }.
export function buildTopicTree(schema) {
  const tree = [];
  const walk = (nodes, parentPath, depth, parent) => (Array.isArray(nodes) ? nodes : [])
    .filter((n) => n && typeof n.title === "string" && n.title.trim())
    .map((n) => {
      const path = parentPath + "/" + n.title;
      const node = { title: n.title.trim(), path, key: topicKey(path), depth, parent, children: [] };
      node.children = walk(n.categories, path, depth + 1, node);
      return node;
    });
  const roots = (schema && Array.isArray(schema.categorySchema)) ? schema.categorySchema : [];
  for (const root of roots) if (root && root.title) tree.push(...walk(root.categories, "/" + root.title, 0, null));
  return tree;
}
export function flattenTopics(tree) { const out = []; const go = (ns) => ns.forEach((n) => { out.push(n); go(n.children); }); go(tree || []); return out; }
export function findTopic(tree, key) { return flattenTopics(tree).find((n) => n.key === key) || null; }
export function topicTrail(node) { const t = []; for (let n = node; n; n = n.parent) t.unshift(n); return t; }

// A map is in a topic when one of its group categories is that topic or sits below it.
export function inTopic(keys, key) { return !key || keys.some((k) => k === key || k.startsWith(key + "/")); }

// Accent- and case-insensitive text, so "Geografia" finds "Geografía".
export const fold = (s) => String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
export const searchTokens = (text) => fold(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const stripTags = (html) => String(html || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");

// Group search results -> entries ready for filtering: { item, keys, title, hay }.
export function indexItems(items) {
  return (items || []).filter((it) => it && it.id).map((item) => ({
    item,
    keys: (Array.isArray(item.groupCategories) ? item.groupCategories : []).map(topicKey).filter(Boolean),
    title: fold(item.title),
    hay: fold([item.title, item.snippet, (item.tags || []).join(" "), stripTags(item.description)].join(" "))
  }));
}

// Number of maps per topic (a map counts once for each topic it sits in, and for that topic's parents).
export function countTopics(tree, entries) {
  const nodes = flattenTopics(tree), tops = (tree || []).map((n) => n.key);
  const counts = new Map(nodes.map((n) => [n.key, 0]));
  let other = 0;
  for (const e of entries || []) {
    for (const n of nodes) if (inTopic(e.keys, n.key)) counts.set(n.key, counts.get(n.key) + 1);
    if (!tops.some((k) => inTopic(e.keys, k))) other++;
  }
  return { counts, other, total: (entries || []).length };
}

// Maps in a topic (ALL, OTHER or a topic key) that match the search text.
// With search text, maps whose title matches come first; otherwise A–Z by title.
export function filterEntries(entries, tree, key, text, locale) {
  const tokens = searchTokens(text), tops = (tree || []).map((n) => n.key);
  const out = (entries || []).filter((e) => {
    if (key === OTHER) { if (tops.some((k) => inTopic(e.keys, k))) return false; }
    else if (key && !inTopic(e.keys, key)) return false;
    return tokens.every((tk) => e.hay.includes(tk));
  });
  const byTitle = (a, b) => String(a.item.title || "").localeCompare(String(b.item.title || ""), locale || undefined, { sensitivity: "base", numeric: true });
  const rank = (e) => (tokens.length && tokens.every((tk) => e.title.includes(tk)) ? 0 : 1);
  return out.sort((a, b) => rank(a) - rank(b) || byTitle(a, b));
}

// Which topic chips to show under the heading: the children of the chosen topic,
// or, for a topic with no children, its brothers and sisters. Topics with no maps are left out when counts are known.
export function chipSet(node, counts) {
  const has = (n) => !counts || (counts.get(n.key) || 0) > 0;
  if (!node) return null;
  if (node.children.some(has)) return { parent: node, chips: node.children.filter(has) };
  if (node.parent) return { parent: node.parent, chips: node.parent.children.filter(has) };
  return null;
}
