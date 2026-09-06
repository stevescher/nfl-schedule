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
const STANDINGS_PATH = join(__dirname, "data", "standings.json");
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

// Returns the America/New_York UTC offset (in minutes, e.g. -240 for EDT)
// that applies at the given wall-clock instant, by asking the platform's
// IANA tzdata via Intl rather than hand-rolling DST transition rules.
function getEasternOffsetMinutes(y, m, d, hh, mm) {
  const utcGuess = Date.UTC(y, m - 1, d, hh, mm);
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(utcGuess).reduce((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {});
  // Intl's 2-digit hour can render midnight as "24"; normalize to 0.
  const hour = parts.hour === "24" ? 0 : Number(parts.hour);
  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    hour,
    Number(parts.minute),
    Number(parts.second)
  );
  return (asIfUtc - utcGuess) / 60000;
}

// Format a local wall-clock date/time (America/New_York) as a UTC ICS
// timestamp, accounting for whether that date falls in EDT or EST.
function toUtcIcsTimestamp(dateStr, timeStr, addHours = 0) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = timeStr.split(":").map(Number);

  const localMinutes = hh * 60 + mm + addHours * 60;
  const offsetMinutes = getEasternOffsetMinutes(y, m, d, hh, mm);
  const utcDate = new Date(Date.UTC(y, m - 1, d, 0, localMinutes - offsetMinutes));

  return (
    `${utcDate.getUTCFullYear()}${pad(utcDate.getUTCMonth() + 1)}${pad(utcDate.getUTCDate())}T` +
    `${pad(utcDate.getUTCHours())}${pad(utcDate.getUTCMinutes())}00Z`
  );
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
    .replace(/\r\n|\r|\n/g, "\\n");
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

// Base UID identity is team/season/seasonType/week: stable across
// reschedules (a flex move that changes date/time must update the existing
// calendar event, not create a duplicate). If two games in the same team's
// data ever land on the same week/seasonType (a data error, or a genuine
// rescheduled-into-another-week collision), disambiguate with an index so
// events don't silently overwrite each other in subscribers' calendars.
function uidBase(game, team) {
  return `${team.slug}-${team.season}-${game.seasonType}-week${pad(game.week)}`;
}

function buildEvent(game, dtstamp, team, uidSuffix) {
  if (!game.date || !game.kickoffLocal) return null; // bye week / TBD week

  const opponent = game.opponent;
  const teamShortName = team.name; // e.g. "Bills"
  const verb = game.homeAway === "home" ? "vs." : "@";
  const seasonTag = game.seasonType === "preseason" ? " (Preseason)" : game.seasonType === "postseason" ? " (Playoffs)" : "";
  const summary = `${teamShortName} ${verb} ${opponent}${seasonTag}`;

  const dtstart = toUtcIcsTimestamp(game.date, game.kickoffLocal, 0);
  const dtend = toUtcIcsTimestamp(game.date, game.kickoffLocal, GAME_DURATION_HOURS);
  const uid = `${uidBase(game, team)}${uidSuffix ? `-${uidSuffix}` : ""}@nfl-schedule.stevescher.com`;

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

  // Count games sharing a UID base (same week/seasonType) so a genuine
  // collision gets a stable disambiguating suffix (occurrence index). The
  // first occurrence keeps the plain, stable UID unsuffixed (matching what
  // may already be published/subscribed to); only the 2nd+ occurrence gets
  // "-2", "-3", etc., so an already-synced event is never renamed out from
  // under an existing subscriber.
  const baseSeen = new Map();
  const events = teamData.games
    .map((g) => {
      const base = uidBase(g, team);
      const occurrence = baseSeen.get(base) || 0;
      baseSeen.set(base, occurrence + 1);
      const suffix = occurrence > 0 ? String(occurrence + 1) : null;
      return buildEvent(g, dtstamp, team, suffix);
    })
    .filter(Boolean);

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

  // Publish standings (record + division rank), if a fetch has been run.
  // Optional: the site works fine without it (pages just skip the record line).
  if (existsSync(STANDINGS_PATH)) {
    copyFileSync(STANDINGS_PATH, join(OUT_DIR, "data", "standings.json"));
  }

  const pageTemplate = existsSync(PAGE_TEMPLATE_PATH) ? readFileSync(PAGE_TEMPLATE_PATH, "utf8") : null;
  if (!pageTemplate) {
    console.warn(`Warning: page template not found at ${PAGE_TEMPLATE_PATH}; skipping page-shell generation.`);
  }

  const teamFiles = readdirSync(TEAMS_DIR).filter((f) => f.endsWith(".json"));
  const foundSlugs = new Set();
  let hadErrors = false;

  for (const file of teamFiles) {
    try {
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
    } catch (err) {
      hadErrors = true;
      console.error(`Error processing ${file}: ${err.message}; skipping this team.`);
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

  if (hadErrors) {
    console.error("Build completed with errors (see above); some team files were skipped.");
    process.exitCode = 1;
  }
}

main();
