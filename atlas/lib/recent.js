// Saved maps on this device: the list behind Open map > On this device.
// The list lives in this browser's IndexedDB, on this device only. In Chrome and Edge each entry also keeps a handle to the
// saved file, so Open reads the file itself (and Save keeps writing to it). Browsers that can only download files
// (Safari, Firefox) can't open a file again by themselves, so there the entry keeps a copy of the saved map.
// Handles sit in their own store and are read back only for the one map being opened (or a save to a file of the same
// name): showing the list never reads them.
// The pure functions are unit tested; openRecentStore needs a browser (or any IndexedDB).
export const RECENT_VERSION = "1.0";
export const RECENT_MAX = 30;            // older entries drop off the list (their files are untouched)
export const RECENT_DB = "atlas-saved-maps";
const MAPS = "maps", HANDLES = "handles";

export function newId() {
  const c = globalThis.crypto;
  if (c && c.randomUUID) return c.randomUUID();
  return "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

// A list entry. `handle` (a FileSystemFileHandle) or `json` (the saved web map's text), never both.
export function makeEntry({ id, scope, title, fileName, savedAt, thumb, handle, json, appVersion }) {
  const okThumb = typeof thumb === "string" && /^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/.test(thumb) && thumb.length < 400000;
  return {
    id: id || newId(), scope: String(scope || "default"),
    title: String(title || "").trim().slice(0, 200), fileName: String(fileName || "map.amap").slice(0, 200),
    savedAt: savedAt || new Date().toISOString(), thumb: okThumb ? thumb : null,
    hasHandle: !!handle, handle: handle || null, json: handle ? null : (typeof json === "string" ? json : null), appVersion: appVersion || ""
  };
}

// Newest first.
export function sortEntries(list) {
  return (Array.isArray(list) ? list : []).slice().sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
}

// The entries to keep and the ones to drop once the list is over its size.
export function pruneEntries(list, max) {
  const sorted = sortEntries(list), n = Math.max(1, max || RECENT_MAX);
  return { keep: sorted.slice(0, n), drop: sorted.slice(n) };
}

// Entries a new save might replace: same app, same file name, same kind (file handle or downloaded copy).
// A downloaded copy replaces the first; a file handle replaces one only if it's the same file (checked by the caller).
export function candidates(list, entry) {
  return (Array.isArray(list) ? list : []).filter((e) => e.scope === entry.scope && e.fileName === entry.fileName && !!e.hasHandle === !!entry.hasHandle);
}

const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const done = (tx) => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error || new Error("aborted")); });

// The list for one app (scope = its config name). Callers treat any failure as "no list" rather than a broken app.
export async function openRecentStore(idb, scope) {
  if (!idb || !idb.open) throw new Error("IndexedDB isn't available");
  const open = idb.open(RECENT_DB, 1);
  open.onupgradeneeded = () => {
    const db = open.result;
    if (!db.objectStoreNames.contains(MAPS)) db.createObjectStore(MAPS, { keyPath: "id" });
    if (!db.objectStoreNames.contains(HANDLES)) db.createObjectStore(HANDLES, { keyPath: "id" });
  };
  const db = await req(open);
  const all = async () => {
    const tx = db.transaction(MAPS, "readonly");
    const rows = await req(tx.objectStore(MAPS).getAll());
    return sortEntries(rows.filter((e) => e && e.scope === scope));
  };
  const handleOf = async (id) => { const tx = db.transaction(HANDLES, "readonly"); const r = await req(tx.objectStore(HANDLES).get(id)); return (r && r.handle) || null; };
  const write = async (fn) => { const tx = db.transaction([MAPS, HANDLES], "readwrite"); fn(tx.objectStore(MAPS), tx.objectStore(HANDLES)); await done(tx); };
  return {
    list: all,
    // One entry, with its file handle (Chrome, Edge) read back.
    async get(id) {
      const tx = db.transaction(MAPS, "readonly");
      const e = await req(tx.objectStore(MAPS).get(id));
      if (!e || e.scope !== scope) return null;
      return e.hasHandle ? { ...e, handle: await handleOf(id) } : e;
    },
    // Adds a save to the list, replacing the entry for the same file, and trims the list. isSame(storedHandle) says
    // whether a stored handle is the file just saved. Returns the stored entry (without its handle).
    async record(entry, isSame) {
      const list = await all();
      let match = null;
      for (const e of candidates(list, entry)) {
        if (!entry.hasHandle) { match = e; break; }
        try { const h = await handleOf(e.id); if (h && isSame && await isSame(h)) { match = e; break; } } catch (err) { /* not the same */ }
      }
      const { handle, ...meta } = entry;
      const stored = match ? { ...meta, id: match.id, thumb: meta.thumb || match.thumb } : meta;
      const { drop } = pruneEntries([stored, ...list.filter((e) => !match || e.id !== match.id)], RECENT_MAX);
      const put = (thumb) => write((m, hs) => {
        m.put({ ...stored, thumb });
        if (handle) hs.put({ id: stored.id, handle });
        drop.forEach((d) => { m.delete(d.id); hs.delete(d.id); });
      });
      try { await put(stored.thumb); }
      catch (err) {   // most likely full storage: try again without the picture
        if (!stored.thumb) throw err;
        stored.thumb = null; await put(null);
      }
      return stored;
    },
    // The picture of the map, added once it's taken (the entry goes in the list first, so the list is never behind a save).
    async setThumb(id, thumb) {
      const t = makeEntry({ thumb }).thumb;
      if (!t) return;
      const tx = db.transaction(MAPS, "readwrite"), st = tx.objectStore(MAPS);
      const e = await req(st.get(id));
      if (e) st.put({ ...e, thumb: t });
      await done(tx);
    },
    async remove(id) { await write((m, hs) => { m.delete(id); hs.delete(id); }); },
    close() { try { db.close(); } catch (e) { /* closed */ } }
  };
}
