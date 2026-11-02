// Builds what a teacher would give their AI for each sample class: the instructions and the numbered export.
// Run: node class-marking/ai-test/make-inputs.mjs <outDir>
import fs from "fs"; import path from "path"; import { fileURLToPath } from "url";
import { readHandIn, assess } from "../tools/checks.mjs";
import { keyFromAnswerMap, studentFromFile, classCsv } from "../tools/keys.mjs";
import { instructionsFor } from "../tools/ai.mjs";
const HERE = path.dirname(fileURLToPath(import.meta.url)), A = path.join(HERE, "..", "assignments"), OUT = process.argv[2];
fs.mkdirSync(OUT, { recursive: true });
const T = JSON.parse(fs.readFileSync(path.join(HERE, "..", "tools", "trails-west.json"), "utf8")).trails;
for (const [id, answerFile] of [["volcanoes", "Volcanoes - answer key_locked.amap"], ["oregon-trail", "Oregon Trail - answer key_locked.amap"]]) {
  const key = JSON.parse(fs.readFileSync(path.join(A, id, "key.json"), "utf8"));
  if (key.route) key.route.paths = T.Oregon;
  const answerRaw = JSON.parse(fs.readFileSync(path.join(A, id, answerFile), "utf8"));
  const own = keyFromAnswerMap(answerRaw, { skip: [5] });   // the 6th point is the model note
  const answers = key.places.map((p) => { const m = own.places.find((q) => Math.abs(q.lonlat[0] - p.lonlat[0]) < 0.01 && Math.abs(q.lonlat[1] - p.lonlat[1]) < 0.01); return { name: p.name, text: m ? m.answer : "" }; });
  const exp = JSON.parse(fs.readFileSync(path.join(A, id, "expected.json"), "utf8"));
  const rows = exp.results.filter((r) => /\.amap$/.test(r.file)).map((r) => {
    let result = null; try { result = assess(readHandIn(JSON.parse(fs.readFileSync(path.join(A, id, "class", r.file), "utf8"))), key); } catch (e) { /* damaged */ }
    return { file: r.file, ...studentFromFile(r.file), result };
  }).sort((a, b) => a.file.localeCompare(b.file));
  fs.writeFileSync(path.join(OUT, id + "-class.csv"), classCsv(rows, key, { anonymous: true }));
  fs.writeFileSync(path.join(OUT, id + "-instructions.txt"), instructionsFor({ title: key.title, key, rubric: fs.readFileSync(path.join(A, id, "rubric.txt"), "utf8"), answers, answerNotes: own.answerNotes }));
  // who is who: kept by the teacher, never given to the AI
  const ids = new Map(); for (const r of rows) { const k = r.student.toLowerCase(); if (!ids.has(k)) ids.set(k, ids.size + 1); }
  fs.writeFileSync(path.join(OUT, id + "-numbers.json"), JSON.stringify(Object.fromEntries(rows.map((r) => ["Student " + ids.get(r.student.toLowerCase()) + (r.copy > 1 ? ` (copy ${r.copy})` : ""), r.student + (r.copy > 1 ? ` (copy ${r.copy})` : "")])), null, 1));
}
