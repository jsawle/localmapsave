// Reading a config and its language file. No SDK and no DOM, so it runs under Node for the tests.
// A config (config/<name>.json) lists only what differs from the app's defaults. It may start from another config
// with "extends": "<name>", and it names a language with "locale": the wording then comes from locales/<locale>.json,
// one shared file per language, with the config's own "strings" laid over it.
export const CONFIG_VERSION = "2.0";   // 2.0: "extends" and shared language files (1.0: one file per config, wording inside it)

export function mergeConfig(base, over) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const k of Object.keys(over || {})) {
    const b = base ? base[k] : undefined, o = over[k];
    out[k] = b && o && typeof b === "object" && typeof o === "object" && !Array.isArray(b) && !Array.isArray(o) ? mergeConfig(b, o) : o;
  }
  return out;
}
const clean = (s) => String(s || "").replace(/[^\w-]/g, "");

// fetchJson(path) resolves to the parsed file, or throws when it isn't there.
// Returns { raw, name, chain, missing, localeFile, localeMissing }.
export async function loadConfig(requested, fetchJson) {
  let name = clean(requested) || "default", raw = {}, missing = null;
  try { raw = await fetchJson(`./config/${name}.json`); }
  catch (e) {
    if (name !== "default") { missing = name; name = "default"; try { raw = await fetchJson("./config/default.json"); } catch (e2) { raw = {}; } }
  }
  const chain = [name];
  for (let i = 0; i < 3 && typeof raw.extends === "string"; i++) {
    const parent = clean(raw.extends);
    const { extends: _x, ...own } = raw;
    if (!parent || chain.includes(parent)) { raw = own; break; }
    try { raw = mergeConfig(await fetchJson(`./config/${parent}.json`), own); chain.push(parent); }
    catch (e) { raw = own; break; }
  }
  if ("extends" in raw) { const { extends: _x, ...rest } = raw; raw = rest; }
  let localeFile = null, localeMissing = null;
  const loc = clean(raw.locale) || "en", base = loc.split("-")[0];
  if (base.toLowerCase() !== "en") {
    for (const l of [...new Set([loc, base])]) {
      try { const f = await fetchJson(`./locales/${l}.json`); if (f && typeof f === "object") { localeFile = { ...f, name: l }; break; } } catch (e) { /* try the next */ }
    }
    if (!localeFile) localeMissing = loc;
  }
  if (raw.dir == null && localeFile && localeFile.dir) raw = { ...raw, dir: localeFile.dir };
  return { raw, name, chain, missing, localeFile, localeMissing };
}

// The wording the app shows: English, then the language file, then the config's own.
export const buildStrings = (defaults, localeFile, cfg) => ({ ...defaults, ...((localeFile && localeFile.strings) || {}), ...((cfg && cfg.strings) || {}) });
