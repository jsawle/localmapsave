// node atlas-sketch/tests/config.test.mjs
// Every config in config/ and every language file in locales/ is checked before a release:
// it parses, its IDs are IDs, what it extends exists, its language has a file, and each language file
// translates every piece of the app's wording with the same {placeholders}.
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { DEFAULT_STRINGS } from "../lib/strings.js";
import { loadConfig, buildStrings, mergeConfig } from "../lib/config.js";
const root = fileURLToPath(new URL("..", import.meta.url));
let n = 0, bad = 0;
const ok = (cond, msg) => { n++; if (!cond) { bad++; console.error("FAIL " + msg); } };
const HEX32 = /^[0-9a-f]{32}$/i, COLOUR = /^#[0-9a-f]{3,8}$/i;
const names = (dir) => fs.readdirSync(root + dir).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));
const read = (dir, name) => { try { return JSON.parse(fs.readFileSync(`${root}${dir}/${name}.json`, "utf8")); } catch (e) { ok(false, `${dir}/${name}.json doesn't parse: ${e.message}`); return null; } };
const holes = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join(",");

const locales = names("locales"), configs = names("config"), keys = Object.keys(DEFAULT_STRINGS);
for (const l of locales) {
  const f = read("locales", l); if (!f) continue;
  ok(/^[a-z]{2,3}(-[A-Za-z0-9]+)*$/.test(l), `locales/${l}.json: the file name is a language code`);
  ok(f.locale === l, `locales/${l}.json: "locale" matches the file name`);
  ok(f.dir === "ltr" || f.dir === "rtl", `locales/${l}.json: "dir" is ltr or rtl`);
  ok(typeof f.version === "string", `locales/${l}.json has a version`);
  const st = f.strings || {};
  const missing = keys.filter((k) => !(k in st)), extra = Object.keys(st).filter((k) => !(k in DEFAULT_STRINGS));
  ok(!missing.length, `locales/${l}.json is missing ${missing.length} piece(s) of wording: ${missing.slice(0, 12).join(", ")}`);
  ok(!extra.length, `locales/${l}.json has wording the app doesn't use: ${extra.slice(0, 12).join(", ")}`);
  for (const k of keys) if (k in st) ok(holes(st[k]) === holes(DEFAULT_STRINGS[k]), `locales/${l}.json "${k}": placeholders differ from the English (${holes(DEFAULT_STRINGS[k])})`);
}
for (const c of configs) {
  const f = read("config", c); if (!f) continue;
  ok(/^[\w-]+$/.test(c), `config/${c}.json: the name is letters, numbers, - or _ (it goes in a link)`);
  ok(Number.isInteger(f.configVersion), `config/${c}.json has a configVersion`);
  if ("extends" in f) { ok(configs.includes(f.extends) && f.extends !== c, `config/${c}.json extends "${f.extends}", which isn't in config/`); }
  for (const k of ["contentGroup", "basemapGroup", "defaultBasemap"]) if (k in f) ok(HEX32.test(f[k]), `config/${c}.json: ${k} is a 32-character ID`);
  for (const [k, v] of Object.entries(f.theme || {})) if (k !== "font" && v !== "") ok(COLOUR.test(v), `config/${c}.json: theme.${k} is a # colour`);
  for (const h of f.headerLinks || []) ok(/^https:\/\//.test(h.url || "") && !!h.label, `config/${c}.json: each header link has a label and an https address`);
  if ("dir" in f) ok(f.dir === "ltr" || f.dir === "rtl", `config/${c}.json: dir is ltr or rtl`);
  if ("units" in f) ok(["auto", "metric", "imperial"].includes(f.units), `config/${c}.json: units is auto, metric or imperial`);
  if (f.locale && f.locale.split("-")[0] !== "en") ok(locales.includes(f.locale) || locales.includes(f.locale.split("-")[0]), `config/${c}.json: no language file in locales/ for "${f.locale}"`);
  for (const k of Object.keys(f.strings || {})) ok(k in DEFAULT_STRINGS, `config/${c}.json: strings.${k} isn't wording the app uses`);
  for (const [k, v] of Object.entries(f.strings || {})) if (k in DEFAULT_STRINGS) ok(holes(v).split(",").every((h) => !h || holes(DEFAULT_STRINGS[k]).split(",").includes(h)), `config/${c}.json: strings.${k} uses a placeholder the English doesn't have`);
}
// Loading, as the app does it, from the files on disk
const fetchJson = async (path) => JSON.parse(fs.readFileSync(root + path.replace(/^\.\//, ""), "utf8"));
{
  const es = await loadConfig("example-es", fetchJson);
  ok(es.localeFile && es.localeFile.name === "es" && !es.localeMissing, "example-es loads locales/es.json");
  const S = buildStrings(DEFAULT_STRINGS, es.localeFile, es.raw);
  ok(S.signIn === "Iniciar sesión" && Object.keys(S).length === keys.length, "example-es: the wording is Spanish and complete");
  ok(es.raw.dir === "ltr", "example-es: direction comes from the language file");
  const test = await loadConfig("test", fetchJson), mm = await loadConfig("mapmaker", fetchJson);
  ok(test.chain.join(">") === "test>mapmaker" && !("extends" in test.raw), "test extends mapmaker");
  ok(test.raw.contentGroup === "c3ac404ac811494ea6fa116abc0cf39b" && mm.raw.contentGroup === undefined, "test changes the content group; mapmaker keeps the default");
  const { contentGroup: _a, configVersion: _b, ...restT } = test.raw, { configVersion: _c, ...restM } = mm.raw;
  ok(JSON.stringify(restT) === JSON.stringify(restM), "test is otherwise the MapMaker config");
  // 5.0.0-beta.20: while 5.0 is a pilot the built-in content group is the test group; the live MapMaker group is one named config
  const appSrc = fs.readFileSync(root + "app.js", "utf8"), live = await loadConfig("mapmaker-live", fetchJson), def = await loadConfig("default", fetchJson);
  ok(/contentGroup: "c3ac404ac811494ea6fa116abc0cf39b"/.test(appSrc) && !/contentGroup: "36443e9570294a1f883b5d2c5abfe6b5"/.test(appSrc), "the app's built-in content group is the 5.0 test group");
  ok(mm.raw.contentGroup === undefined && def.raw.contentGroup === undefined && es.raw.contentGroup === undefined, "default, mapmaker and example-es name no group, so they read the built-in one");
  ok(live.raw.contentGroup === "36443e9570294a1f883b5d2c5abfe6b5" && live.chain.join(">") === "mapmaker-live>mapmaker", "only mapmaker-live reads the live MapMaker group");
  const none = await loadConfig("no-such-config", fetchJson);
  ok(none.missing === "no-such-config" && none.name === "default", "an unknown config falls back to default and says so");
  const loop = await loadConfig("a", async (p) => { if (p.endsWith("/a.json")) return { extends: "b", appName: "A" }; if (p.endsWith("/b.json")) return { extends: "a", locale: "xx" }; throw new Error("404"); });
  ok(loop.chain.join(">") === "a>b" && loop.raw.appName === "A" && loop.localeMissing === "xx", "a loop of extends stops; a language with no file is reported");
  const rtl = await loadConfig("ar", async (p) => { if (p.endsWith("/config/ar.json")) return { locale: "ar-OM" }; if (p.endsWith("/locales/ar.json")) return { locale: "ar", dir: "rtl", strings: { signIn: "x" } }; throw new Error("404"); });
  ok(rtl.localeFile.name === "ar" && rtl.raw.dir === "rtl", "ar-OM falls back to ar.json and takes its right-to-left direction");
  ok(mergeConfig({ a: { b: 1, c: 2 }, l: [1, 2] }, { a: { c: 3 }, l: [9] }).a.b === 1, "merge keeps what a config doesn't mention");
}
console.log(`${n - bad}/${n} config and language checks passed (${configs.length} configs, ${locales.length} language file(s))`);
process.exit(bad ? 1 : 0);
