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

Standings are refreshed automatically (see "Automation" below); you don't
need to run `fetch-standings.mjs` by hand.

## Automation

Everything below runs unattended in one GitHub Actions workflow,
`.github/workflows/update-standings.yml`, every 15 minutes all year
(`*/15 * * * *`). It can also be started manually from the Actions tab
(`workflow_dispatch`).

Each run:

1. `node fetch-standings.mjs` updates `data/standings.json` (records,
   division rank, streak) from ESPN.
2. `node update-schedule.mjs` reads ESPN's scoreboard for weeks 1-18
   (`cdn.espn.com/core/nfl/scoreboard?xhr=1&week=N&seasontype=2&year=2026`)
   and edits `data/teams/<slug>.json` in place (one line per game is
   preserved):
   - **Scores:** adds `result` (e.g. `"Bears lost 7-31"`, own score first)
     to finished games that don't have one. An existing `result` is never
     overwritten; a disagreement is only logged as a `MISMATCH` warning.
   - **Flex changes:** for `flexEligible` games in the next 14 days,
     corrects `date`, `kickoffLocal` and `network` when ESPN differs. Only
     networks it can map unambiguously (FOX, CBS, NBC, ESPN/ABC, Prime
     Video, Netflix, NFL Network) are applied. It does not touch
     `isPrimetimeOrSpecial`.
3. If any team file changed, `node generate-ics.mjs` regenerates the `.ics`
   feeds and the published data under `docs/`. It is skipped otherwise,
   since it bumps DTSTAMP on every feed.
4. If anything changed, the workflow commits and pushes to `main`, and
   GitHub Pages redeploys nfl.stevescher.com (usually 1-2 minutes). If
   nothing changed there is no commit.

So a score is typically live within about 15 minutes of ESPN marking the
game final, plus the Pages deploy. Calendar apps re-fetch subscribed `.ics`
feeds on their own schedule (often hours), which we don't control.

A failed run emails the repo owner via GitHub's normal Actions notifications.

### Not automated

- **Postseason.** `postseason` in each team file is a placeholder and
  `update-schedule.mjs` only reads `seasontype=2` (regular season). Playoff
  games must be added by hand (or the script extended) once the bracket is set.
- **Week 17/18 `null` placeholders** (date/time/network not yet announced)
  are only filled by hand; the script updates games that already have a
  date, within the 14-day flex window.
- **Source:** ESPN only. If ESPN is wrong, the calendars will be wrong too.
- **Schedule structure** (new opponents, home/away, bye weeks) is never
  changed automatically; edit the data file and run `node generate-ics.mjs`.

### History

This used to be a weekly Claude Code scheduled task that researched and
reported changes for a human to apply, then a daily Claude task that
pushed directly. Both were replaced by the workflow above and the scheduled
task has been disabled.

## Duration convention

Games with no confirmed end time use a 3.5-hour default duration.
