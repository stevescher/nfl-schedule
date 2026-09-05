# NFL Schedule Calendars

A multi-team version of [bills-schedule](https://github.com/stevescher/bills-schedule):
subscribable calendars for all 32 NFL teams, one shared landing page with
search, published at [nfl.stevescher.com](https://nfl.stevescher.com).

Started as a 3-team prototype (Bills, Giants, Jets) to validate the
data/page pattern, then scaled to the full league once that pattern proved
out. See "Adding a team" below for how a new team (or a correction to an
existing one) gets added.

## How it works

- `data/teams.json` is the shared team index: slug, city, name,
  abbreviation, search aliases, brand colors, and stadium for every
  supported team. The homepage search and per-team page branding both read
  from this file.
- `data/teams/<slug>.json` holds one team's full schedule, same schema as
  the original bills-schedule project (`seasonType`, games array, `result`
  for completed games, `postseason` placeholder).
- `generate-ics.mjs` loops over every file in `data/teams/`, and for each
  team writes:
  - `docs/<slug>.ics`, that team's subscribable calendar feed
  - `docs/data/teams/<slug>.json`, a published copy for the page to fetch
  - It also publishes `docs/data/teams.json` (the shared index).
- `docs/assets/team.css` and `docs/assets/team.js` are the shared page
  logic, used by every team page. Colors come from `data/teams.json` and
  are applied as CSS custom properties at runtime, no per-team CSS files.
- `docs/<slug>/index.html` is a small per-team shell (same markup for every
  team) that loads the shared assets and calls `initTeamPage('<slug>')`.
  This gives clean URLs (`nfl.stevescher.com/bills`) on GitHub Pages, which
  has no server-side routing.
- `docs/index.html` is the homepage: team grid plus a typeahead search box
  that matches against `data/teams.json` aliases.

## Adding or correcting a team

1. Add or edit its entry in `data/teams.json` (slug, city, name,
   abbreviation, aliases, colors, stadium).
2. Add or edit `data/teams/<slug>.json` with that team's schedule.
3. Run `node generate-ics.mjs`: this regenerates that team's `.ics`,
   published data copy, and (for a new team) its `docs/<slug>/index.html`
   page shell automatically from the canonical template
   (`docs/bills/index.html`). No manual page-shell copying needed.
4. Commit everything, including the regenerated `docs/` output.

## Accent color contrast

Several teams' secondary/accent color (light gold, silver) fails contrast
as a solid button background with white text. `docs/assets/team.js`
computes each team's accent contrast at runtime (WCAG relative luminance)
and switches to dark button text automatically when needed, so no
per-team override is required in the data.

## Standings

`fetch-standings.mjs` pulls current record + division rank for all 32
teams from ESPN's public standings API in one request
(`site.api.espn.com/apis/v2/sports/football/nfl/standings?seasontype=2&level=3`)
and writes `data/standings.json`. No tiebreaker logic of our own; it's a
straight read of ESPN's already-computed standings, matched to our team
slugs by abbreviation (with a small alias map for the couple of cases
where ESPN's abbreviation differs from ours, e.g. Washington).

`generate-ics.mjs` publishes `data/standings.json` to `docs/data/` if it
exists; each team page fetches it and shows a record badge (e.g. "7-3,
2nd in AFC East") next to the team name. The file is optional: if it's
missing (never fetched, or the fetch failed), the badge simply doesn't
render, no broken page.

Run `node fetch-standings.mjs` periodically (weekly during the season is
plenty, since it's the same cadence the schedule-check routine would use)
and then `node generate-ics.mjs` to publish the update.

## Weekly update routine

Not yet wired up for the full 32-team site (it existed for the single-team
bills-schedule prototype). Worth deciding, once this site has run a few
weeks, whether one routine covers all 32 teams per run or several routines
split by division. A single 32-team run is cheaper to operate but needs a
larger prompt and more care to stay accurate; the research agents used to
build this data set show a 4-team-per-agent batch works well without
resorting to further sub-delegation.

## Why no GitHub Actions

Same reasoning as bills-schedule: NFL schedule changes need judgment
(reading team/league sources, reconciling notes), not a diff of an API
response. A weekly Claude Code scheduled task does the research and a
human applies confirmed changes; there is no separate build pipeline.

## Duration convention

Games with no confirmed end time use a 3.5-hour default duration.
