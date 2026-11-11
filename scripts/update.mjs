// Aktualizuje blok DATA v index.html podle veřejného profilu na Movember.cz.
// Spouští se z GitHub Action (každý den) nebo ručně: node scripts/update.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PROFILE = "https://cz.movember.com/mospace/6659829";
const HTML = new URL("../index.html", import.meta.url);

/* ---------- čisté funkce (testovatelné bez prohlížeče) ---------- */

export function parsePosts(text) {
  // Jen letošní příspěvky: vše před „Previous year's …“
  const cut = text.search(/previous year'?s/i);
  const lines = (cut >= 0 ? text.slice(0, cut) : text)
    .split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const heads = [];
  for (let i = 0; i < lines.length - 2; i++) {
    if (/^od$/i.test(lines[i]) && /^[\d.\s ]+Kč$/i.test(lines[i + 2])) heads.push(i);
  }
  const out = [];
  heads.forEach((i, n) => {
    const next = n + 1 < heads.length ? heads[n + 1] - 1 : lines.length; // řádek před „od“ je relativní čas
    const msg = lines.slice(i + 3, next).filter(l => !/^(zobrazit více|show more)$/i.test(l)).join(" ");
    out.push({
      name: lines[i + 1],
      amount: parseInt(lines[i + 2].replace(/[^\d]/g, ""), 10),
      message: msg,
    });
  });
  // Každý příspěvek se na stránce opakuje: sloučit sousední shodné
  const dedup = [];
  for (const p of out) {
    const last = dedup[dedup.length - 1];
    if (last && last.name === p.name && last.amount === p.amount && last.message === p.message) continue;
    dedup.push(p);
  }
  // Případně se opakuje celý seznam: první polovina == druhá polovina
  const h = dedup.length / 2;
  if (Number.isInteger(h) && h > 0 &&
      dedup.slice(0, h).every((p, k) => p.name === dedup[h + k].name && p.amount === dedup[h + k].amount)) {
    return dedup.slice(0, h);
  }
  return dedup;
}

export function readData(html) {
  const get = (re) => { const m = html.match(re); if (!m) throw new Error("V index.html chybí " + re); return m[1]; };
  const donations = [];
  const block = get(/var DONATIONS = \[([\s\S]*?)\n  \];/);
  for (const m of block.matchAll(/\{ name: (".*?"), amount: (\d+), message: (".*?"), date: (".*?") \}/g)) {
    donations.push({ name: JSON.parse(m[1]), amount: +m[2], message: JSON.parse(m[3]), date: JSON.parse(m[4]) });
  }
  return donations;
}

export function merge(existing, parsed, today) {
  const pool = existing.map(d => ({ ...d, used: false }));
  const fresh = [];
  for (const p of parsed) {
    const hit = pool.find(d => !d.used && d.name === p.name && d.amount === p.amount);
    if (hit) hit.used = true; else fresh.push({ ...p, date: today.short });
  }
  if (pool.some(d => !d.used)) return null; // na stránce chybí něco, co už máme: nic neměnit
  return { donations: [...fresh, ...existing], added: fresh };
}

export function render(html, donations, today, open) {
  const lines = donations.map(d =>
    `    { name: ${JSON.stringify(d.name)}, amount: ${d.amount}, message: ${JSON.stringify(d.message)}, date: ${JSON.stringify(d.date)} }`);
  return html
    .replace(/var DONATIONS = \[[\s\S]*?\n  \];/, `var DONATIONS = [\n${lines.join(",\n")}\n  ];`)
    .replace(/var UPDATED = ".*?";/, `var UPDATED = "${today.long}";`)
    .replace(/var DONATION_OPEN = \w+;/, `var DONATION_OPEN = ${open};`);
}

export function pragueToday(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Prague", day: "numeric", month: "numeric", year: "numeric" })
    .formatToParts(now).filter(x => x.type !== "literal").map(x => [x.type, +x.value]));
  return { d: p.day, m: p.month, y: p.year, short: `${p.day}. ${p.month}.`, long: `${p.day}. ${p.month}. ${p.year}` };
}

/* ---------- hlavní běh ---------- */

async function fetchText() {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ locale: "cs-CZ" });
    await page.goto(PROFILE, { waitUntil: "networkidle", timeout: 60000 });
    for (let i = 0; i < 5; i++) { // „Zobrazit více“
      const more = page.getByText(/^(Zobrazit více|Show more)$/i).first();
      if (!(await more.isVisible().catch(() => false))) break;
      await more.click().catch(() => {});
      await page.waitForTimeout(1500);
    }
    return await page.evaluate(() => document.body.innerText);
  } finally { await browser.close(); }
}

async function main() {
  const today = pragueToday();
  if (today.y > 2026 || (today.y === 2026 && (today.m > 12 || (today.m === 12 && today.d > 7)))) {
    console.log("Sezóna skončila, nic neměním."); return;
  }
  const html = readFileSync(HTML, "utf8");
  const existing = readData(html);
  const parsed = parsePosts(await fetchText());
  console.log(`Na profilu ${parsed.length} příspěvků, ve stránce ${existing.length}.`);
  if (parsed.length === 0) throw new Error("Z profilu se nepodařilo načíst žádné příspěvky (změnila se struktura stránky?)");
  const res = merge(existing, parsed, today);
  if (!res) { console.log("Na profilu je méně příspěvků než ve stránce, nic neměním."); return; }
  const openNow = today.y === 2026 && today.m <= 11;
  if (res.added.length === 0 && /var DONATION_OPEN = (\w+);/.exec(html)[1] === String(openNow)) { console.log("Beze změny."); return; }
  writeFileSync(HTML, render(html, res.donations, today, openNow));
  const total = res.donations.reduce((s, d) => s + d.amount, 0);
  console.log("Přibylo: " + (res.added.map(d => `${d.name} ${d.amount} Kč${d.message ? ` („${d.message}“)` : ""}`).join("; ") || "nic") + `. Nový součet: ${total} Kč.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e); process.exit(1); });
