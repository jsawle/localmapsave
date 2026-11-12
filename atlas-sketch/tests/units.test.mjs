// node atlas-sketch/tests/units.test.mjs
import { guessUnits, resolveUnits, isUSTimeZone, UNITS_VERSION } from "../lib/units.js";
let n = 0, bad = 0;
const eq = (got, want, msg) => { n++; if (JSON.stringify(got) !== JSON.stringify(want)) { bad++; console.error("FAIL " + msg + ": got " + JSON.stringify(got) + ", wanted " + JSON.stringify(want)); } };
const g = (timeZone, ...languages) => guessUnits({ timeZone, languages }).units;
eq(UNITS_VERSION, "1.0", "version");
// the time zone decides
for (const tz of ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Phoenix", "America/Anchorage", "Pacific/Honolulu", "America/Indiana/Knox", "America/Kentucky/Louisville", "America/North_Dakota/Center", "America/Detroit", "America/Puerto_Rico", "Pacific/Guam", "US/Eastern"]) eq(g(tz, "en-GB"), "imperial", tz + " is miles, whatever the language");
for (const tz of ["Europe/London", "Europe/Budapest", "America/Toronto", "America/Vancouver", "America/Mexico_City", "America/Sao_Paulo", "Asia/Muscat", "Africa/Johannesburg", "Australia/Sydney", "America/Panama", "America/Jamaica"]) eq(g(tz, "en-US"), "metric", tz + " is kilometres, even with a US-English browser");
eq(guessUnits({ timeZone: "Europe/London", languages: ["en-US"] }).from, "time zone", "says what decided it");
eq(isUSTimeZone("America/Argentina/Buenos_Aires"), false, "not every America/ zone");
// no usable time zone: the language's region
eq(g(undefined, "en-US"), "imperial", "no time zone, en-US");
eq(g("UTC", "en-US", "en"), "imperial", "UTC says nothing about place: en-US");
eq(g("Etc/GMT+5", "es-US"), "imperial", "Etc zones say nothing about place: es-US");
eq(g("UTC", "en-GB"), "metric", "UTC, en-GB");
eq(g("", "en", "en-US"), "imperial", "the first language with a region");
eq(g(undefined, "zh-Hans-CN"), "metric", "a language with a script");
eq(g(undefined, "en"), "metric", "nothing to go on: kilometres");
eq(guessUnits().units, "metric", "nothing given at all");
// the order: link, the person's choice, the configuration, the guess
const base = { timeZone: "America/Chicago", languages: ["en-US"] };
eq(resolveUnits({ ...base, config: "auto" }), { units: "imperial", from: "time zone" }, "auto guesses");
eq(resolveUnits({ ...base }), { units: "imperial", from: "time zone" }, "no setting is auto");
eq(resolveUnits({ ...base, config: "metric" }), { units: "metric", from: "configuration" }, "the configuration can fix the units");
eq(resolveUnits({ ...base, config: "metric", stored: "imperial" }), { units: "imperial", from: "choice" }, "the person's choice comes before the configuration");
eq(resolveUnits({ ...base, config: "auto", stored: "metric", param: "imperial" }), { units: "imperial", from: "link" }, "a link parameter comes first");
eq(resolveUnits({ ...base, config: "auto", stored: "furlongs", param: "x" }), { units: "imperial", from: "time zone" }, "anything else is ignored");
console.log(bad ? `${bad} of ${n} units tests failed` : `All ${n} units tests passed.`); process.exit(bad ? 1 : 0);
