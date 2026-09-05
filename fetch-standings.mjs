#!/usr/bin/env node
// Fetches current NFL standings from ESPN's public standings API and writes
// data/standings.json: one small record per team (record, division rank,
// streak), keyed by our team slug. This is a separate file from the season
// schedule data because it changes on a different cadence (weekly during
// the season, vs. schedule data which is set for the whole year and rarely
// corrected).
//
// Run this periodically (e.g. from the same weekly update process that
// checks the schedule) and then run generate-ics.mjs to publish it.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEAMS_INDEX_PATH = join(__dirname, "data", "teams.json");
const OUT_PATH = join(__dirname, "data", "standings.json");

const ESPN_STANDINGS_URL = "https://site.api.espn.com/apis/v2/sports/football/nfl/standings?seasontype=2&level=3";

// ESPN's standings API uses a couple of abbreviations that differ from the
// ones in data/teams.json (e.g. "WSH" for Washington vs. our "WAS").
const ESPN_ABBREVIATION_ALIASES = {
  WSH: "WAS",
};

async function main() {
  const teamsIndex = JSON.parse(readFileSync(TEAMS_INDEX_PATH, "utf8"));
  const byAbbreviation = new Map(teamsIndex.teams.map((t) => [t.abbreviation, t.slug]));

  const res = await fetch(ESPN_STANDINGS_URL);
  if (!res.ok) {
    throw new Error(`ESPN standings request failed: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();

  const standings = {};
  const unmatched = [];

  for (const conference of data.children) {
    for (const division of conference.children) {
      const entries = division.standings.entries;
      entries.forEach((entry, index) => {
        const abbr = entry.team.abbreviation;
        const slug = byAbbreviation.get(abbr) ?? byAbbreviation.get(ESPN_ABBREVIATION_ALIASES[abbr]);
        if (!slug) {
          unmatched.push(abbr);
          return;
        }

        const stats = Object.fromEntries(entry.stats.map((s) => [s.name, s]));
        const wins = stats.wins?.value ?? 0;
        const losses = stats.losses?.value ?? 0;
        const ties = stats.ties?.value ?? 0;

        standings[slug] = {
          wins,
          losses,
          ties,
          divisionRank: index + 1,
          division: division.name,
          streak: stats.streak?.displayValue ?? null,
        };
      });
    }
  }

  if (unmatched.length) {
    console.warn(`Warning: could not match ESPN abbreviation(s) to a team slug: ${unmatched.join(", ")}`);
  }

  const missing = teamsIndex.teams.filter((t) => !standings[t.slug]);
  if (missing.length) {
    console.warn(`Warning: no standings entry found for: ${missing.map((t) => t.slug).join(", ")}`);
  }

  const out = {
    lastFetched: new Date().toISOString().slice(0, 10),
    source: "ESPN standings API",
    teams: standings,
  };

  writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`Wrote standings for ${Object.keys(standings).length} teams to ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
