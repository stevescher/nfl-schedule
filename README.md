# NFL Schedule Calendars

A prototype multi-team version of [bills-schedule](https://github.com/stevescher/bills-schedule):
subscribable calendars for multiple NFL teams, one shared landing page with
search, published at [nfl.stevescher.com](https://nfl.stevescher.com).

Currently covers 3 teams (Bills, Giants, Jets) as a scoping exercise before
expanding to the full league. See "Scaling to 32 teams" below.

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

## Adding a team

1. Add an entry to `data/teams.json` (slug, city, name, abbreviation,
   aliases, colors, stadium).
2. Add `data/teams/<slug>.json` with that team's schedule.
3. Copy `docs/bills/index.html` to `docs/<slug>/index.html` and change the
   `initTeamPage('...')` call to the new slug.
4. Run `node generate-ics.mjs` and commit everything, including the
   regenerated `docs/` output.

## Scaling to 32 teams

The data and page-rendering pattern above already generalizes; the
remaining work to go from 3 to 32 teams is:

- Research and enter 29 more `data/teams/<slug>.json` files (the actual
  time cost here, done a team or a few at a time).
- Generate 29 more `docs/<slug>/index.html` shells (step 3 above is
  mechanical and scriptable once the pattern is proven).
- Decide how the weekly research routine scales: one routine per team is
  simplest to reason about but multiplies run count; a single routine that
  checks several teams per run is cheaper per-run but needs a larger
  prompt and more care to stay accurate. Worth deciding after watching how
  the single-team routine performs over a few weeks.

## Why no GitHub Actions

Same reasoning as bills-schedule: NFL schedule changes need judgment
(reading team/league sources, reconciling notes), not a diff of an API
response. A weekly Claude Code scheduled task does the research and a
human applies confirmed changes; there is no separate build pipeline.

## Duration convention

Games with no confirmed end time use a 3.5-hour default duration.
