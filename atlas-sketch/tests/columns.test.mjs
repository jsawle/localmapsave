// Columns in 3D (lab): the column heights and width worked out from a spreadsheet layer.  node columns.test.mjs
import { columnScale, lonLatToWebMercator, stateFromLayerDef, buildLayerDef, DATA_STYLES, COLOR_RAMPS } from "../lib/csv.js";
import { dataDefToOperationalLayer, operationalLayerToDataDef, saved3dCamera, VIEW_3D_PROP, COLUMNS_3D_PROP } from "../lib/doc.js";
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
const sized = (size) => { const d = def([pt(0, 0, 0), pt(0.008983, 0, 10)]); d.renderer.symbol = { type: "esriSMS", size }; return columnScale(d); };
ok(near(sized(24).width, 2 * sized(12).width, 0.001) && near(sized(6).width, sized(12).width / 2, 0.001) && sized(24).maxHeight === sized(12).maxHeight, "the Size slider sets the thickness (24 is twice 12, 6 half) and leaves the height");
const uv = def([pt(0, 0, 0), pt(0.008983, 0, 10)], "v", "uniqueValue"); uv.renderer.defaultSymbol = { type: "esriSMS", size: 24 };
ok(near(columnScale(uv).width, 2 * sized(12).width, 0.001), "and for a style coloured by type");
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
// Reverse colours on a colour ramp (Color & size): written into the saved style and read back from it
{
  const fields = [{ name: "ObjectId", type: "esriFieldTypeOID" }, { name: "a", alias: "A", type: "esriFieldTypeDouble" }, { name: "b", alias: "B", type: "esriFieldTypeDouble" }];
  const feats = [1, 2, 3, 4, 5].map((i) => { const f = pt(i / 100, 0, i); f.attributes = { ObjectId: i, a: i, b: i * 2 }; return f; });
  const st = stateFromLayerDef({ title: "t", fields, features: feats, renderer: { type: "simple", symbol: { type: "esriSMS", size: 12 } } });
  st.style = DATA_STYLES.find((x) => x.id === "numeric_color_size"); st.fieldChoices = { color: "a", size: "b", label: null, pie: null };
  const green = COLOR_RAMPS.find((r) => r.id === "green").colors, stopsOf = (d) => d.renderer.visualVariables.find((v) => v.type === "colorInfo").stops;
  st.symbolChoices.ramp = "green";
  const plain = buildLayerDef(st, "x", "t"), back0 = stateFromLayerDef(plain);
  ok(stopsOf(plain)[0].color.slice(0, 3).join() === green[0].join() && back0.symbolChoices.ramp === "green" && !back0.symbolChoices.rampReverse, "a ramp as it comes: low values pale, and read back as not reversed");
  st.symbolChoices.rampReverse = true;
  const rev = buildLayerDef(st, "x", "t"), sv = stopsOf(rev), back = stateFromLayerDef(rev);
  ok(sv[0].color.slice(0, 3).join() === green[4].join() && sv[4].color.slice(0, 3).join() === green[0].join(), "Reverse colours: low values get the dark end, high the pale");
  ok(sv.every((x, i) => i === 0 || x.value > sv[i - 1].value) && sv[0].label.startsWith("<") && sv[4].label.startsWith(">"), "the values and their labels still run low to high");
  ok(back.symbolChoices.ramp === "green" && back.symbolChoices.rampReverse === true && back.style.id === "numeric_color_size", "read back from the saved style: Greens, reversed");
}
// Kept in a saved file: columns on a spreadsheet layer, and the 3D view of a map
{
  const fields = [{ name: "ObjectId", alias: "ObjectId", type: "esriFieldTypeOID" }, { name: "v", alias: "V", type: "esriFieldTypeDouble" }];
  const d = { id: "csv1", title: "T", geometryType: "point", objectIdField: "ObjectId", fields, renderer: { type: "simple", symbol: { type: "esriSMS", style: "esriSMSCircle", color: [0, 121, 193, 204], size: 12 }, visualVariables: [{ type: "sizeInfo", field: "v", minSize: 8, maxSize: 40, minDataValue: 0, maxDataValue: 5 }] },
    features: [{ geometry: { x: 0, y: 0, spatialReference: { wkid: 102100 } }, attributes: { ObjectId: 1, v: 5 } }] };
  const on = dataDefToOperationalLayer({ ...d, columns3d: true }, true, 1), off = dataDefToOperationalLayer(d, true, 1);
  ok(on[COLUMNS_3D_PROP] === true && !(COLUMNS_3D_PROP in off), "a layer with columns is marked in the saved map; one without has no mark");
  ok(on.featureCollection.layers[0].layerDefinition.drawingInfo.renderer.symbol.type === "esriSMS", "its saved style is still the 2D one");
  ok(operationalLayerToDataDef(on).columns3d === true && !operationalLayerToDataDef(off).columns3d, "and read back from the saved map");
  ok(!operationalLayerToDataDef({ ...on, [COLUMNS_3D_PROP]: "yes" }).columns3d, "only a true mark counts");
  const cam = { position: { x: -117.16, y: 32.7, z: 800, spatialReference: { wkid: 4326 } }, heading: 10, tilt: 60 };
  const c = saved3dCamera({ [VIEW_3D_PROP]: { camera: cam } });
  ok(c && c.tilt === 60 && c.heading === 10 && c.position.z === 800, "a map saved in 3D gives its camera back");
  ok(saved3dCamera({}) === null && saved3dCamera({ [VIEW_3D_PROP]: true }) === null && saved3dCamera({ [VIEW_3D_PROP]: { camera: { position: { x: "a" } } } }) === null, "no mark, or a broken one: opens in 2D as before");
}
console.log(bad ? `${bad} of ${n} FAILED` : `All ${n} checks passed.`); process.exit(bad ? 1 : 0);
