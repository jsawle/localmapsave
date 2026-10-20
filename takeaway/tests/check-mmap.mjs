// Opens map files the way Atlas does (untrusted files, via atlas/lib/doc.js) and fails if any layer would be skipped.
// Run: node takeaway/tests/check-mmap.mjs file.mmap [...]
import { readFileSync } from "node:fs";
import { readWebMap } from "../../atlas/lib/doc.js";

let bad = 0;
for (const f of process.argv.slice(2)) {
  const raw = JSON.parse(readFileSync(f, "utf8"));
  const r = readWebMap(raw);
  const count = (ops) => ops.reduce((n, o) => n + (o.layers ? count(o.layers) : 1), 0);
  if (!r.ok) { console.error(`${f}: not opened (${r.code})`); bad++; continue; }
  const inN = count(raw.operationalLayers || []), outN = count(r.webmap.operationalLayers);
  console.log(`${f.split("/").pop()}: opened, ${outN}/${inN} layers kept, ${r.skipped} skipped, basemap ${r.webmap.baseMap ? "kept" : "none"}`);
  if (r.skipped || outN !== inN || (raw.baseMap && !r.webmap.baseMap)) bad++;
}
process.exit(bad ? 1 : 0);
