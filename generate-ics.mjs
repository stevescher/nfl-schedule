#!/usr/bin/env node
// Generates docs/<slug>.ics for every team file in data/teams/, plus a
// published copy of each team's JSON and the shared team index under
// docs/data/ so the landing page can fetch them client-side.
// Games with no confirmed date/time (bye week, unset late weeks) are skipped.

import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEAMS_DIR = join(__dirname, "data", "teams");
const TEAMS_INDEX_PATH = join(__dirname, "data", "teams.json");
const OUT_DIR = join(__dirname, "docs");
const PAGE_TEMPLATE_PATH = join(OUT_DIR, "bills", "index.html");
const GAME_DURATION_HOURS = 3.5;

// Builds a per-team page shell from the canonical template (docs/bills/index.html),
// swapping only the initTeamPage('...') slug argument. All markup/branding is
// data-driven at runtime by docs/assets/team.js, so every team's shell is identical
// apart from this one line.
function buildPageShell(templateHtml, slug) {
  return templateHtml.replace(/initTeamPage\('[a-z0-9]+'\)/, `initTeamPage('${slug}')`);
}

function pad(n) {
  return String(n).padStart(2, "0");
}

// Format a local wall-clock date/time (America/New_York) as a UTC ICS
// timestamp, accounting for whether that date falls in EDT or EST.
function toUtcIcsTimestamp(dateStr, timeStr, addHours = 0) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = timeStr.split(":").map(Number);

  // US Eastern DST: second Sunday in March 2am -> first Sunday in November 2am.
  const isDst = (() => {
    const date = new Date(Date.UTC(y, m - 1, d));
    const marchSecondSunday = nthSunday(y, 3, 2);
    const novFirstSunday = nthSunday(y, 11, 1);
    return date >= marchSecondSunday && date < novFirstSunday;
  })();
  const offsetHours = isDst ? -4 : -5;

  const localMinutes = hh * 60 + mm + addHours * 60;
  const utcDate = new Date(Date.UTC(y, m - 1, d, 0, localMinutes - offsetHours * 60));

  return (
    `${utcDate.getUTCFullYear()}${pad(utcDate.getUTCMonth() + 1)}${pad(utcDate.getUTCDate())}T` +
    `${pad(utcDate.getUTCHours())}${pad(utcDate.getUTCMinutes())}00Z`
  );
}

function nthSunday(year, month, n) {
  const d = new Date(Date.UTC(year, month - 1, 1, 7)); // 7 = safely past midnight in any offset
  let sundays = 0;
  while (true) {
    if (d.getUTCDay() === 0) {
      sundays++;
      if (sundays === n) return d;
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
}

// RFC 5545 line folding: lines must not exceed 75 octets; continuations
// start with a single space. Folds on UTF-8 byte length, never splitting
// inside a multi-byte character.
function foldLine(line) {
  const LIMIT = 75;
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= LIMIT) return line;

  const chunks = [];
  let offset = 0;
  let first = true;
  while (offset < bytes.length) {
    const chunkLimit = first ? LIMIT : LIMIT - 1;
    let end = Math.min(offset + chunkLimit, bytes.length);
    // Back off if we landed mid-UTF-8-sequence (continuation bytes are 10xxxxxx).
    while (end > offset && (bytes[end] & 0xc0) === 0x80) end--;
    chunks.push((first ? "" : " ") + bytes.slice(offset, end).toString("utf8"));
    offset = end;
    first = false;
  }
  return chunks.join("\r\n");
}

function escapeText(str) {
  return String(str)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

function whereToWatch(game) {
  const parts = [];
  if (game.network) parts.push(game.network);
  if (game.streaming) parts.push(game.streaming);
  return parts.length ? parts.join(" / ") : "TBD";
}

function buildNotes(game) {
  const lines = [];
  lines.push(`Watch: ${whereToWatch(game)}`);
  if (game.isPrimetimeOrSpecial) lines.push(game.isPrimetimeOrSpecial);
  if (game.flexEligible) lines.push("Subject to NFL flex scheduling: time/network may change.");
  if (game.notes) lines.push(game.notes);
  // Escape each line individually, then join with a literal ICS line-break
  // escape (\n) so escapeText's backslash-doubling doesn't mangle it.
  return lines.map(escapeText).join("\\n");
}

function buildEvent(game, dtstamp, team) {
  if (!game.date || !game.kickoffLocal) return null; // bye week / TBD week

  const opponent = game.opponent;
  const teamShortName = team.name; // e.g. "Bills"
  const verb = game.homeAway === "home" ? "vs." : "@";
  const seasonTag = game.seasonType === "preseason" ? " (Preseason)" : game.seasonType === "postseason" ? " (Playoffs)" : "";
  const summary = `${teamShortName} ${verb} ${opponent}${seasonTag}`;

  const dtstart = toUtcIcsTimestamp(game.date, game.kickoffLocal, 0);
  const dtend = toUtcIcsTimestamp(game.date, game.kickoffLocal, GAME_DURATION_HOURS);
  const uid = `${team.slug}-${team.season}-${game.seasonType}-week${pad(game.week)}@nfl-schedule.stevescher.com`;

  const location = game.homeAway === "home" ? team.stadium || "" : "";

  return [
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${dtstart}`,
    `DTEND:${dtend}`,
    `SUMMARY:${escapeText(summary)}`,
    `DESCRIPTION:${buildNotes(game)}`,
    location ? `LOCATION:${escapeText(location)}` : null,
    "END:VEVENT",
  ]
    .filter(Boolean)
    .map(foldLine)
    .join("\r\n");
}

function buildTeamIcs(teamData, teamMeta, dtstamp) {
  const team = { ...teamData, slug: teamMeta.slug, name: teamMeta.name, stadium: teamMeta.stadium };
  const events = teamData.games.map((g) => buildEvent(g, dtstamp, team)).filter(Boolean);

  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//stevescher//nfl-schedule//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(`${teamData.team} ${teamData.season} Schedule`)}`,
    "X-WR-TIMEZONE:America/New_York",
    "REFRESH-INTERVAL;VALUE=DURATION:P1D",
    "X-PUBLISHED-TTL:P1D",
    ...events,
    "END:VCALENDAR",
  ].join("\r\n");

  return { ics, eventCount: events.length };
}

function main() {
  const teamsIndex = JSON.parse(readFileSync(TEAMS_INDEX_PATH, "utf8"));
  const dtstamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");

  mkdirSync(OUT_DIR, { recursive: true });
  const publishedTeamsDataDir = join(OUT_DIR, "data", "teams");
  mkdirSync(publishedTeamsDataDir, { recursive: true });

  // Publish the shared team index (colors, names, aliases for search).
  copyFileSync(TEAMS_INDEX_PATH, join(OUT_DIR, "data", "teams.json"));

  const pageTemplate = existsSync(PAGE_TEMPLATE_PATH) ? readFileSync(PAGE_TEMPLATE_PATH, "utf8") : null;
  if (!pageTemplate) {
    console.warn(`Warning: page template not found at ${PAGE_TEMPLATE_PATH}; skipping page-shell generation.`);
  }

  const teamFiles = readdirSync(TEAMS_DIR).filter((f) => f.endsWith(".json"));
  const foundSlugs = new Set();

  for (const file of teamFiles) {
    const teamData = JSON.parse(readFileSync(join(TEAMS_DIR, file), "utf8"));
    const slug = teamData.slug || file.replace(/\.json$/, "");
    const teamMeta = teamsIndex.teams.find((t) => t.slug === slug);

    if (!teamMeta) {
      console.warn(`Warning: no entry in data/teams.json for slug "${slug}" (from ${file}); skipping.`);
      continue;
    }
    foundSlugs.add(slug);

    const { ics, eventCount } = buildTeamIcs(teamData, teamMeta, dtstamp);
    const icsPath = join(OUT_DIR, `${slug}.ics`);
    writeFileSync(icsPath, ics + "\r\n", "utf8");
    console.log(`Wrote ${eventCount} events to ${icsPath}`);

    copyFileSync(join(TEAMS_DIR, file), join(publishedTeamsDataDir, `${slug}.json`));

    if (pageTemplate) {
      const pageDir = join(OUT_DIR, slug);
      mkdirSync(pageDir, { recursive: true });
      writeFileSync(join(pageDir, "index.html"), buildPageShell(pageTemplate, slug), "utf8");
    }
  }

  const missing = teamsIndex.teams.filter((t) => !foundSlugs.has(t.slug));
  if (missing.length) {
    console.warn(
      `Warning: data/teams.json lists team(s) with no matching data/teams/*.json file: ${missing
        .map((t) => t.slug)
        .join(", ")}`
    );
  }
}

main();
