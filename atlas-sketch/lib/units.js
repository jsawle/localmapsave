// Units 1.0: which units the app starts in (kilometres and metres, or miles and feet).
// With "units": "auto" the app guesses from two things the browser already knows, and nothing is sent anywhere:
//   1. the device's time zone. A time zone of the United States or its territories means miles and feet; any other
//      known time zone means kilometres and metres.
//   2. if the time zone is not known (missing, or plain UTC), the browser's language: a US region (en-US, es-US) means
//      miles and feet.
// The person's own choice, made with the units switch, comes before the guess; a units= link parameter before that.
export const UNITS_VERSION = "1.0";

// IANA time zones of the United States and its territories (and the old "US/..." names some systems still report).
const US_ZONES = new Set(["America/New_York", "America/Detroit", "America/Chicago", "America/Menominee", "America/Denver", "America/Boise", "America/Phoenix",
  "America/Los_Angeles", "America/Anchorage", "America/Juneau", "America/Sitka", "America/Metlakatla", "America/Yakutat", "America/Nome", "America/Adak",
  "Pacific/Honolulu", "America/Puerto_Rico", "America/St_Thomas", "America/Virgin", "Pacific/Guam", "Pacific/Saipan", "Pacific/Pago_Pago", "Pacific/Samoa",
  "America/Indianapolis", "America/Fort_Wayne", "America/Louisville", "America/Knox_IN", "America/Shiprock", "America/Atka", "Navajo"]);
const US_PREFIXES = ["America/Indiana/", "America/Kentucky/", "America/North_Dakota/", "US/"];

export function isUSTimeZone(tz) { return typeof tz === "string" && (US_ZONES.has(tz) || US_PREFIXES.some((p) => tz.startsWith(p))); }
// a time zone that says where the device is: not missing, and not a bare UTC / GMT / Etc zone
export function isPlaceTimeZone(tz) { return typeof tz === "string" && tz.includes("/") && !tz.startsWith("Etc/"); }
function regionOf(lang) { const m = /^[a-z]{2,3}(?:[-_][A-Za-z]{4})?[-_]([A-Za-z]{2})\b/.exec(String(lang || "")); return m ? m[1].toUpperCase() : ""; }

// "imperial" or "metric", and what decided it ("time zone", "language" or "default")
export function guessUnits({ timeZone, languages } = {}) {
  if (isPlaceTimeZone(timeZone)) return { units: isUSTimeZone(timeZone) ? "imperial" : "metric", from: "time zone" };
  const region = (languages || []).map(regionOf).find(Boolean);
  if (region) return { units: region === "US" ? "imperial" : "metric", from: "language" };
  return { units: "metric", from: "default" };
}
const one = (v) => (v === "imperial" || v === "metric" ? v : null);
// param: the units= link parameter; stored: the person's saved choice; config: the configuration's "units"
export function resolveUnits({ param, stored, config, timeZone, languages } = {}) {
  if (one(param)) return { units: param, from: "link" };
  if (one(stored)) return { units: stored, from: "choice" };
  if (one(config)) return { units: config, from: "configuration" };
  return guessUnits({ timeZone, languages });
}
