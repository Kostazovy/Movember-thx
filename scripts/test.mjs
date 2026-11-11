import { readFileSync } from "node:fs";
import { parsePosts, readData, merge, render, pragueToday } from "./update.mjs";
const text = `Vaše aktivita
2 před pár dny
od
Renča Kostov
1.000 Kč

2 před pár dny
od
Renča Kostov
1.000 Kč

2 před pár dny
od
Anonymní
400 Kč
2 před pár dny
od
Anonymní
400 Kč
1 před více jak týdnem
od
Anonymní
10.000 Kč
Batter safe than sorry!
1 před více jak týdnem
od
Anonymní
10.000 Kč
Batter safe than sorry!
1 před hodinou
od
Nový Dárce
250 Kč
Držím palce
Previous year's posts
3 před rokem
od
Starý
99 Kč`;
const p = parsePosts(text);
console.log(p);
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const ex = readData(html);
console.log(ex.length, "existujících");
const today = pragueToday(new Date("2026-11-11T10:00:00Z"));
console.log(today);
const r = merge(ex, p, today);
console.log(r === null ? "NULL (správně: chybí starší příspěvky)" : r.added);
const r2 = merge(ex, [{name:"Nový Dárce",amount:250,message:"Držím palce"}, ...ex], today);
console.log(r2.added);
const out = render(html, r2.donations, today, true);
console.log(out.match(/var DONATIONS[\s\S]*?\];/)[0].split("\n").slice(0,4).join("\n"));
console.log(out.match(/var UPDATED.*/)[0]);
console.log("roundtrip:", readData(out).length === ex.length + 1);
