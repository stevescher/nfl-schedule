#!/usr/bin/env node
// Keeps data/teams/<slug>.json in sync with ESPN's scoreboard:
//  1. Adds `result` ("Bears won 23-12", own score first) for finished
//     regular-season games that don't have one yet. Existing results are never
//     overwritten; a mismatch is only logged.
//  2. For flex-eligible games in the next 14 days, corrects date, kickoffLocal
//     and network if ESPN shows something different and the network is one we
//     can map unambiguously.
// Edits are in-place on the single game line so the one-line-per-game format
// is preserved. Run generate-ics.mjs afterwards (the workflow does this).

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const dir = dirname(fileURLToPath(import.meta.url));
const teams = JSON.parse(readFileSync(join(dir, "data", "teams.json"), "utf8")).teams;
const slugByFullName = Object.fromEntries(teams.map((t) => [t.fullName, t.slug]));
const nameBySlug = Object.fromEntries(teams.map((t) => [t.slug, t]));

const NETWORKS = { fox: "FOX", cbs: "CBS", nbc: "NBC", "nfl net": "NFL Network", "prime video": "Prime Video", netflix: "Netflix", "espn,abc": "ESPN/ABC" };
const mapNetwork = (names) => {
  const key = names.map((n) => n.toLowerCase()).filter((n) => n !== "disney+" && n !== "espn deportes").join(",");
  return NETWORKS[key] ?? NETWORKS[key.split(",")[0]] ?? null;
};

const fmtET = (iso) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour === "24" ? "00" : p.hour}:${p.minute}` };
};

async function getJson(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
    } catch {}
    await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
  }
  throw new Error(`Failed to fetch ${url}`);
}

const files = {};
const load = (slug) => (files[slug] ??= readFileSync(join(dir, "data", "teams", `${slug}.json`), "utf8").split("\n"));
const changes = [];

const today = new Date();
const horizon = new Date(today.getTime() + 14 * 864e5).toISOString().slice(0, 10);
const todayET = fmtET(today.toISOString()).date;

for (let week = 1; week <= 18; week++) {
  const data = await getJson(`https://cdn.espn.com/core/nfl/scoreboard?xhr=1&week=${week}&seasontype=2&year=2026`);
  for (const ev of data.content.sbData.events) {
    const comp = ev.competitions[0];
    const status = ev.status.type.name;
    const sides = comp.competitors.map((c) => ({ slug: slugByFullName[c.team.displayName], score: Number(c.score) }));
    if (sides.some((s) => !s.slug)) { console.warn(`Unmapped team in ${ev.shortName}`); continue; }
    const et = fmtET(ev.date);
    const network = mapNetwork((comp.broadcasts ?? []).flatMap((b) => b.names));

    for (const [i, me] of sides.entries()) {
      const opp = sides[1 - i];
      const lines = load(me.slug);
      const idx = lines.findIndex((l) => l.includes(`"seasonType": "regular", "week": ${week},`) && l.includes(`"opponent": "${nameBySlug[opp.slug].fullName}"`));
      if (idx < 0) continue;
      let line = lines[idx];
      const nick = nameBySlug[me.slug].name;

      if (status === "STATUS_FINAL") {
        const res = `${nick} ${me.score > opp.score ? "won" : me.score < opp.score ? "lost" : "tied"} ${me.score}-${opp.score}`;
        const m = line.match(/"result": "([^"]*)"/);
        if (!m) {
          line = line.replace(/ \}(,?)\s*$/, `, "result": "${res}" }$1`);
          changes.push(`${me.slug} wk${week}: ${res}`);
        } else if (m[1] !== res) {
          console.warn(`MISMATCH ${me.slug} wk${week}: file "${m[1]}" vs ESPN "${res}" (left alone)`);
        }
      } else if (status === "STATUS_SCHEDULED" && line.includes('"flexEligible": true') && et.date >= todayET && et.date <= horizon) {
        const cur = Object.fromEntries(["date", "kickoffLocal", "network"].map((k) => [k, (line.match(new RegExp(`"${k}": (?:"([^"]*)"|null)`)) ?? [])[1] ?? null]));
        const want = { date: et.date, kickoffLocal: et.time, network };
        const diffs = Object.keys(want).filter((k) => want[k] && want[k] !== cur[k]);
        for (const k of diffs) line = line.replace(new RegExp(`"${k}": (?:"[^"]*"|null)`), `"${k}": "${want[k]}"`);
        if (diffs.length) changes.push(`${me.slug} wk${week} flex: ${diffs.map((k) => `${k} ${cur[k]} -> ${want[k]}`).join(", ")}`);
      }
      lines[idx] = line;
    }
  }
}

for (const [slug, lines] of Object.entries(files)) {
  const text = lines.join("\n");
  const orig = readFileSync(join(dir, "data", "teams", `${slug}.json`), "utf8");
  if (text === orig) continue;
  JSON.parse(text); // refuse to write invalid JSON
  const touched = changes.some((c) => c.startsWith(slug + " "));
  if (touched) writeFileSync(join(dir, "data", "teams", `${slug}.json`), text);
}
console.log(changes.length ? changes.join("\n") : "No schedule changes.");
