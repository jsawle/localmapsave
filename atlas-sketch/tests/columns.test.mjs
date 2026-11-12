// Columns in 3D (lab): the column heights and width worked out from a spreadsheet layer.  node columns.test.mjs
import { columnScale, lonLatToWebMercator } from "../lib/csv.js";
let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log("  FAIL " + m); } else console.log("  ok   " + m); };
const pt = (lon, lat, v) => { const [x, y] = lonLatToWebMercator(lon, lat); return { geometry: { x, y }, attributes: { v, w: -v } }; };
const def = (feats, field = "v", type = "simple") => ({ renderer: { type, visualVariables: [{ type: "sizeInfo", field }] }, features: feats });
const near = (a, b, tol) => Math.abs(a - b) <= tol * b;

// about 1 km apart along the equator
let s = columnScale(def([pt(0, 0, 0), pt(0.008983, 0, 10), pt(0.004, 0, 5)]));
ok(s && s.field === "v" && s.fromZero && s.minValue === 0 && s.maxValue === 10, "values from 0 to 10: height starts at zero");
ok(near(s.maxHeight, 1000 / 6, 0.01) && near(s.width, 1000 / 60, 0.01), `1 km across: tallest ${s.maxHeight.toFixed(0)} m, ${s.width.toFixed(1)} m wide`);
ok(near(s.minHeight, s.maxHeight / 100, 0.001), "a zero is a thin disc, a hundredth of the tallest");
// the same spread in degrees at 60° north is half the ground distance
const s60 = columnScale(def([pt(0, 60, 1), pt(0.008983, 60, 2)]));
ok(near(s60.maxHeight, 500 / 6, 0.02), `at 60° north the same longitudes are half as far apart: tallest ${s60.maxHeight.toFixed(0)} m`);
s = columnScale(def([pt(0, 0, 3), pt(1, 1, 8)]));
ok(s.minValue === 0 && s.maxValue === 8, "values 3 to 8 still start from zero (a bar chart's rule)");
s = columnScale(def([pt(0, 0, 3), pt(1, 1, 8)], "w"));
ok(!s.fromZero && s.minValue === -8 && s.maxValue === -3 && near(s.minHeight, s.maxHeight / 20, 0.001), "values below zero: lowest value gets the shortest column");
s = columnScale(def([pt(5, 5, 4)]));
ok(near(s.maxHeight, 50, 0.001) && near(s.width, 5, 0.001), "one point: as if the points were 300 m apart");
s = columnScale(def([pt(-170, -60, 1), pt(170, 70, 2)]));
ok(near(s.maxHeight, 4000000 / 6, 0.001), "points across the world: the tallest column is capped (667 km)");
s = columnScale(def([pt(0, 0, 0), pt(1, 1, 0)]));
ok(s.maxValue > s.minValue, "every value zero: no divide by zero");
ok(columnScale({ renderer: { type: "simple" }, features: [pt(0, 0, 1)] }) === null, "a style with no size column: no columns");
ok(columnScale(def([pt(0, 0, 1)], "_pieTotal", "pieChart")) === null, "a pie-chart layer: no columns");
ok(columnScale(def([{ geometry: { x: 0, y: 0 }, attributes: { v: "a" } }])) === null, "no numbers in the column: no columns");
console.log(bad ? `${bad} of ${n} FAILED` : `All ${n} checks passed.`); process.exit(bad ? 1 : 0);
