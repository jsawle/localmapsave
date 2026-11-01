// Compares an AI's suggested points with the reference marking, checks its quotations are real,
// and compares two runs. Run: node class-marking/ai-test/compare.mjs <inDir> <outDir> <secretDir>
import fs from "fs"; import path from "path"; import { fileURLToPath } from "url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const [IN, OUT, SECRET] = process.argv.slice(2);
const REF = JSON.parse(fs.readFileSync(path.join(HERE, "reference.json"), "utf8"));

function parseCsv(text) {
  const rows = []; let row = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true; else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(f); rows.push(row); row = []; f = ""; }
    else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}
const norm = (s) => s.replace(/\s+/g, " ").trim();
function table(md) {
  const m = md.match(/```[a-z]*\n([\s\S]*?)```/i);
  if (!m) return null;
  const rows = parseCsv(m[1]);
  const head = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] || "").trim()])));
}
const num = (v) => { const m = String(v || "").match(/-?\d+(\.\d+)?/); return m ? Number(m[0]) : null; };
const report = [];
const summary = {};
for (const id of ["volcanoes", "oregon-trail"]) {
  const ref = REF[id], who = JSON.parse(fs.readFileSync(path.join(SECRET, id + "-numbers.json"), "utf8"));
  const csvText = norm(fs.readFileSync(path.join(IN, id + "-class.csv"), "utf8").replace(/""/g, '"'));
  const runs = [];
  for (const k of [1, 2, 3]) {
    const file = path.join(OUT, `${id}-${k}.md`);
    if (!fs.existsSync(file)) continue;
    const md = fs.readFileSync(file, "utf8"), t = table(md);
    if (!t) { report.push(`${id} run ${k}: no CSV table found`); continue; }
    let inRange = 0, parts = 0, misses = [], quotes = 0, badQuotes = [], deferred = [], byChoice = [];
    const got = {};
    for (const row of t) {
      const label = row["Student"] || row["Student number"] || Object.values(row)[0];
      const name = who[label];
      if (!name) { misses.push(`unknown row "${label}"`); continue; }
      got[name] = {};
      const r = ref.students[name];
      for (const p of ref.parts) {
        const v = num(row[p]);
        got[name][p] = row[p] === undefined ? "(no column)" : row[p];
        if (r === "unreadable") { parts++; if (v === null || v === 0) inRange++; else misses.push(`${name} ${p}: gave ${row[p]} to an unreadable file`); continue; }
        parts++;
        const [lo, hi] = r[p], cellText = String(row[p] || "");
        const choiceNums = [...String(row["Teacher's choice"] || "").matchAll(new RegExp(p.replace(/[?]/g, "\\?") + "\\s*(\\d+)", "gi"))].map((m) => Number(m[1]));
        if (cellText.startsWith("?")) {
          // left to the teacher, as the instructions ask when the AI can't tell: right if every option it gives is in range
          const opts = [...cellText.matchAll(/\d+/g)].map((m) => Number(m[0]));
          if (opts.length && opts.every((o) => o >= lo && o <= hi)) { inRange++; deferred.push(`${name} ${p}: ${cellText}`); }
          else if (!opts.length) { inRange++; deferred.push(`${name} ${p}: "?" (options given in Check this)`); }
          else misses.push(`${name} ${p}: AI ${cellText}, reference ${lo === hi ? lo : lo + "–" + hi}`);
        } else if (v !== null && v >= lo && v <= hi) inRange++;
        else if (r.choice && choiceNums.some((c) => c >= lo && c <= hi)) { inRange++; byChoice.push(`${name} ${p}: ${v} in the column, ${choiceNums.join("/")} under Teacher's choice`); }
        else misses.push(`${name} ${p}: AI ${row[p] || "blank"}, reference ${lo === hi ? lo : lo + "–" + hi}`);
      }
      // every quotation in the evidence and feedback must be in the file
      for (const col of ["Evidence", "Draft feedback"]) for (const qm of String(row[col] || "").matchAll(/"([^"]{4,})"/g)) {
        if (qm[1].includes(" | ")) continue;   // the gap between two quotations, not a quotation
        const qt = norm(qm[1]).replace(/[.,;:!?]+$/, "");
        if (qt.split(" ").length < 2) continue;
        quotes++;
        if (!csvText.includes(qt) && !csvText.toLowerCase().includes(qt.toLowerCase())) badQuotes.push(`${name}: "${qm[1]}"`);
      }
    }
    runs.push(got);
    const pct = parts ? Math.round((inRange / parts) * 100) : 0;
    summary[`${id} run ${k}`] = { partsInRange: `${inRange}/${parts} (${pct}%)`, leftToTeacher: deferred.length, viaTeachersChoice: byChoice.length, quotations: quotes, notInFile: badQuotes.length };
    report.push(`\n## ${id}, run ${k}\nParts within the reference range: ${inRange} of ${parts} (${pct}%)\nQuotations checked: ${quotes}; not found in the file: ${badQuotes.length}`);
    if (deferred.length) report.push("Left to the teacher with \"?\" (counted as in range when every option given is in range):\n" + deferred.map((m) => "- " + m).join("\n"));
    if (byChoice.length) report.push("In range under Teacher's choice (the written option):\n" + byChoice.map((m) => "- " + m).join("\n"));
    if (misses.length) report.push("Outside the range:\n" + misses.map((m) => "- " + m).join("\n"));
    if (badQuotes.length) report.push("Quotations not in the file:\n" + badQuotes.map((m) => "- " + m).join("\n"));
  }
  if (runs.length >= 2) {
    let same = 0, n = 0; const diff = [];
    for (const name of Object.keys(runs[0])) for (const p of ref.parts) { if (!runs[1][name]) continue; n++; if (num(runs[0][name][p]) === num(runs[1][name][p])) same++; else diff.push(`${name} ${p}: ${runs[0][name][p]} vs ${runs[1][name][p]}`); }
    summary[`${id} runs agree`] = `${same}/${n}`;
    report.push(`\n## ${id}: run 1 against run 2\nSame points: ${same} of ${n}` + (diff.length ? "\n" + diff.map((d) => "- " + d).join("\n") : ""));
  }
}
fs.writeFileSync(path.join(OUT, "comparison.md"), "# AI test: comparison\n" + report.join("\n") + "\n");
console.log(JSON.stringify(summary, null, 1));
