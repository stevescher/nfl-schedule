const SEASON_LABELS = {
  preseason: 'Preseason',
  regular: 'Regular Season',
  postseason: 'Postseason',
};

// WCAG relative luminance / contrast ratio, used to pick readable text color
// against a team's accent color (many teams' accent is a light gold/silver
// that fails contrast with white button text).
function relativeLuminance(hex) {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.substring(i, i + 2), 16) / 255);
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastRatio(hex1, hex2) {
  const l1 = relativeLuminance(hex1);
  const l2 = relativeLuminance(hex2);
  const [lighter, darker] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (lighter + 0.05) / (darker + 0.05);
}

function readableTextColor(backgroundHex) {
  return contrastRatio(backgroundHex, '#ffffff') >= 3.0 ? '#ffffff' : '#16181d';
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function dayFmt(dateStr) {
  if (!dateStr) return { weekday: 'TBD', rest: '' };
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return {
    weekday: dt.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }),
    rest: dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
  };
}

// nth Sunday of a given month/year, at UTC midnight (used to find the DST
// transition dates). n=1 -> first Sunday, n=2 -> second Sunday, etc.
function nthSunday(year, month, n) {
  const d = new Date(Date.UTC(year, month - 1, 1, 7));
  let sundays = 0;
  while (true) {
    if (d.getUTCDay() === 0) {
      sundays++;
      if (sundays === n) return d;
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
}

// Converts a stored ET wall-clock kickoff (date + "HH:MM") to a real UTC
// Date, accounting for whether that date falls in EDT or EST. Mirrors the
// same logic generate-ics.mjs uses to build the .ics feed, so the page and
// the calendar file always agree on the actual instant a game starts.
function etToUtcDate(dateStr, timeStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);

  const marchSecondSunday = nthSunday(y, 3, 2);
  const novFirstSunday = nthSunday(y, 11, 1);
  const dateAtNoon = new Date(Date.UTC(y, m - 1, d, 12));
  const isDst = dateAtNoon >= marchSecondSunday && dateAtNoon < novFirstSunday;
  const offsetHours = isDst ? -4 : -5;

  return new Date(Date.UTC(y, m - 1, d, hh - offsetHours, mm));
}

// The visitor's IANA timezone, detected client-side with no permission
// prompt. Falls back to labeling everything ET if detection ever throws.
const VIEWER_TIMEZONE = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
  } catch (e) {
    return 'America/New_York';
  }
})();

const VIEWER_IS_EASTERN = VIEWER_TIMEZONE === 'America/New_York';

function tzAbbrev(date, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' }).formatToParts(date);
    const tz = parts.find((p) => p.type === 'timeZoneName');
    return tz ? tz.value : '';
  } catch (e) {
    return '';
  }
}

// Formats a stored ET kickoff time in the viewer's local timezone, with the
// ET time kept alongside for anyone comparing notes with someone else (a
// group chat, a family in a different timezone, etc).
function timeFmt(dateStr, timeStr) {
  if (!timeStr) return '';
  const utcDate = etToUtcDate(dateStr, timeStr);

  const etLabel =
    utcDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) +
    ' ' +
    tzAbbrev(utcDate, 'America/New_York');

  if (VIEWER_IS_EASTERN) return etLabel;

  const localLabel =
    utcDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: VIEWER_TIMEZONE }) +
    ' ' +
    tzAbbrev(utcDate, VIEWER_TIMEZONE);

  return localLabel + ' (' + etLabel + ')';
}

// Flags the single soonest upcoming game (confirmed date/time, no result
// yet, kickoff still in the future) across the whole season so the UI can
// highlight "what's next" at a glance, which is the actual question this
// app exists to answer.
function markNextGame(games) {
  let next = null;
  const now = new Date();
  for (const g of games) {
    if (g.result || !g.date || !g.kickoffLocal) continue;
    const kickoff = etToUtcDate(g.date, g.kickoffLocal);
    if (kickoff < now) continue;
    if (!next || kickoff < etToUtcDate(next.date, next.kickoffLocal)) next = g;
  }
  if (next) next.isNext = true;
}

function buildRow(g) {
  const tr = document.createElement('tr');

  if (g.opponent === 'BYE WEEK') {
    tr.className = 'game-row bye-row';
    tr.innerHTML =
      '<td class="col-week">' + g.week + '</td>' +
      '<td class="col-date"></td>' +
      '<td class="col-matchup"><span class="bye-label">Bye Week</span></td>' +
      '<td class="col-watch"></td>';
    return tr;
  }

  const isHome = g.homeAway === 'home';
  const isPast = !!g.result;
  tr.className =
    'game-row ' + (isHome ? 'home-row' : 'away-row') + (isPast ? ' past-row' : '') + (g.isNext ? ' next-row' : '');

  const d = dayFmt(g.date);
  const time = g.kickoffLocal ? timeFmt(g.date, g.kickoffLocal) : '';
  const verb = isHome ? 'vs' : '@';

  const watchParts = [];
  if (g.network) watchParts.push(g.network);
  const watchLabel = watchParts.length ? watchParts.join(' / ') : (g.streaming ? '' : 'TBD');

  // FOX/CBS/NBC Sunday-afternoon windows air a different regional game in
  // each market, so a plain network name (no primetime/special tag, no
  // exclusive streaming window) means "local broadcast only" rather than
  // "the whole country sees this game."
  const isLocalBroadcast = !!g.network && !g.isPrimetimeOrSpecial && !g.streaming;

  let resultHtml = '';
  if (g.result) {
    const won = /won/i.test(g.result);
    const lost = /lost/i.test(g.result);
    resultHtml = '<div class="result-line ' + (won ? 'win' : lost ? 'loss' : '') + '">' + g.result + '</div>';
  }

  const weekLabel = g.week === 0 ? 'HOF' : g.week;

  tr.innerHTML =
    '<td class="col-week">' + weekLabel + '</td>' +
    '<td class="col-date"><span class="weekday">' + d.weekday + '</span>' + d.rest + '</td>' +
    '<td class="col-matchup">' +
      '<div class="opp-line">' +
        verb + ' ' + g.opponent +
        '<span class="ha-flag ' + (isHome ? 'home' : 'away') + '">' + (isHome ? 'Home' : 'Away') + '</span>' +
        (g.isNext ? '<span class="next-flag">Next</span>' : '') +
      '</div>' +
      (g.isPrimetimeOrSpecial ? '<div class="special-line">' + g.isPrimetimeOrSpecial + '</div>' : '') +
      (isPast
        ? resultHtml
        : (time ? '<div class="time-line">' + time + '</div>' : '<div class="time-line">Time TBD</div>')) +
    '</td>' +
    '<td class="col-watch">' +
      watchLabel +
      (isLocalBroadcast ? '<span class="local-flag" title="Regional broadcast, not shown nationwide">local</span>' : '') +
      (g.streaming ? '<span class="streaming-pill">' + g.streaming + '</span>' : '') +
      (g.flexEligible ? '<span class="flex-flag">flex-eligible</span>' : '') +
    '</td>';

  return tr;
}

function buildSection(seasonType, games) {
  const section = document.createElement('div');
  section.className = 'section-block';

  const head = document.createElement('div');
  head.className = 'section-head';
  head.innerHTML =
    '<h2>' + SEASON_LABELS[seasonType] + '</h2>' +
    (seasonType === 'regular'
      ? '<span class="legend"><span class="sw home"></span>Home&nbsp;&nbsp;<span class="sw away"></span>Away</span>'
      : '');
  section.appendChild(head);

  const table = document.createElement('table');
  table.className = 'schedule-table';
  const tbody = document.createElement('tbody');
  games.forEach((g) => tbody.appendChild(buildRow(g)));
  table.appendChild(tbody);
  section.appendChild(table);

  return section;
}

function matchTeams(teams, query) {
  const q = query.toLowerCase().trim();
  if (!q) return [];

  function score(team) {
    if (team.aliases.some((a) => a === q)) return 100;
    if (team.aliases.some((a) => a.startsWith(q))) return 80;
    if (team.aliases.some((a) => a.includes(q))) return 50;
    return 0;
  }

  return teams
    .map((t) => ({ t, score: score(t) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((r) => r.t);
}

function initSwitchSearch(teams, currentSlug) {
  const input = document.getElementById('team-search');
  const resultsEl = document.getElementById('search-results');
  if (!input || !resultsEl) return;

  const otherTeams = teams.filter((t) => t.slug !== currentSlug);

  function close() {
    resultsEl.hidden = true;
    resultsEl.innerHTML = '';
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }

  function setActive(index) {
    const options = resultsEl.querySelectorAll('[role="option"]');
    options.forEach((el, i) => {
      const active = i === index;
      el.classList.toggle('active', active);
      el.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    if (index >= 0 && options[index]) {
      input.setAttribute('aria-activedescendant', options[index].id);
      options[index].scrollIntoView({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }

  function render(query) {
    if (!query.trim()) {
      close();
      return;
    }
    const matches = matchTeams(otherTeams, query).slice(0, 6);
    if (!matches.length) {
      resultsEl.innerHTML = '<div class="search-empty">No teams found.</div>';
      resultsEl.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      input.removeAttribute('aria-activedescendant');
      return;
    }
    resultsEl.innerHTML = matches
      .map(
        (t, i) =>
          '<a class="search-result" id="switch-option-' + i + '" role="option" aria-selected="false" href="/' + t.slug + '/">' +
            '<span class="swatch" style="background:' + t.colors.primary + '"></span>' +
            '<span class="full-name">' + t.fullName + '</span>' +
          '</a>'
      )
      .join('');
    resultsEl.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    input.removeAttribute('aria-activedescendant');
  }

  input.addEventListener('input', (e) => render(e.target.value));
  input.addEventListener('focus', (e) => {
    if (e.target.value.trim()) render(e.target.value);
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.topnav-search')) close();
  });
  input.addEventListener('keydown', (e) => {
    const options = resultsEl.querySelectorAll('[role="option"]');
    const activeIndex = [...options].findIndex((el) => el.classList.contains('active'));

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (options.length) setActive((activeIndex + 1) % options.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (options.length) setActive(activeIndex === -1 ? options.length - 1 : (activeIndex - 1 + options.length) % options.length);
    } else if (e.key === 'Enter') {
      const target = options[activeIndex] || options[0];
      if (target) window.location.href = target.getAttribute('href');
    } else if (e.key === 'Escape') {
      close();
      input.blur();
    }
  });
}

async function initTeamPage(slug) {
  const status = document.getElementById('status');
  const sections = document.getElementById('sections');

  const footerYearEl = document.getElementById('footer-year');
  if (footerYearEl) footerYearEl.textContent = new Date().getFullYear();

  let teamMeta;
  let allTeams = [];
  try {
    const idxRes = await fetch('/data/teams.json', { cache: 'no-store' });
    const idx = await idxRes.json();
    allTeams = idx.teams;
    teamMeta = idx.teams.find((t) => t.slug === slug);
  } catch (e) {
    status.textContent = 'Could not load team index. Try refreshing.';
    return;
  }

  if (!teamMeta) {
    status.textContent = 'Unknown team.';
    return;
  }

  initSwitchSearch(allTeams, slug);

  document.documentElement.style.setProperty('--team-primary', teamMeta.colors.primary);
  document.documentElement.style.setProperty('--team-primary-deep', teamMeta.colors.primaryDeep);
  document.documentElement.style.setProperty('--team-accent', teamMeta.colors.accent);
  document.documentElement.style.setProperty('--team-accent-text', readableTextColor(teamMeta.colors.accent));
  document.title = teamMeta.fullName + ' Schedule';

  const cityEl = document.getElementById('team-city');
  const nameEl = document.getElementById('team-name');
  const stadiumEl = document.getElementById('team-stadium');
  if (cityEl) cityEl.textContent = teamMeta.city.toUpperCase();
  if (nameEl) nameEl.textContent = teamMeta.name;
  if (stadiumEl) stadiumEl.textContent = teamMeta.stadium;

  const recordBadge = document.getElementById('record-badge');
  if (recordBadge) {
    try {
      const standingsRes = await fetch('/data/standings.json', { cache: 'no-store' });
      if (standingsRes.ok) {
        const standingsData = await standingsRes.json();
        const record = standingsData.teams?.[slug];
        if (record) {
          const recordStr = record.ties
            ? record.wins + '-' + record.losses + '-' + record.ties
            : record.wins + '-' + record.losses;
          const rankStr = ordinal(record.divisionRank) + ' in ' + record.division;
          recordBadge.innerHTML = '<b>' + recordStr + '</b><span>' + rankStr + '</span>';
          recordBadge.hidden = false;
        }
      }
    } catch (e) {
      // Standings are optional polish; a missing/unreachable file just
      // means the badge stays hidden, not a broken page.
    }
  }

  const icsUrl = window.location.origin + '/' + slug + '.ics';
  const icsUrlEl = document.getElementById('ics-url');
  if (icsUrlEl) icsUrlEl.textContent = icsUrl;

  const webcalLink = document.getElementById('webcal-link');
  if (webcalLink) webcalLink.href = 'webcal://' + window.location.host + '/' + slug + '.ics';

  const googleLink = document.getElementById('google-link');
  if (googleLink) {
    googleLink.href = 'https://calendar.google.com/calendar/render?cid=' + encodeURIComponent(icsUrl);
  }

  const downloadLink = document.getElementById('ics-link');
  if (downloadLink) downloadLink.href = '/' + slug + '.ics';

  function fallbackCopy(text) {
    const urlBox = document.getElementById('ics-url');
    const range = document.createRange();
    range.selectNodeContents(urlBox);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (e) {
      ok = false;
    }
    if (ok) selection.removeAllRanges();
    return ok;
  }

  const copyBtn = document.getElementById('copy-btn');
  const copyStatus = document.getElementById('copy-status');
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      const original = copyBtn.textContent;
      let ok = false;

      if (navigator.clipboard && window.isSecureContext) {
        try {
          await navigator.clipboard.writeText(icsUrl);
          ok = true;
        } catch (e) {
          ok = false;
        }
      }

      if (!ok) ok = fallbackCopy(icsUrl);

      const message = ok ? 'Copied' : 'Select and copy';
      copyBtn.textContent = message;
      if (copyStatus) copyStatus.textContent = ok ? 'Calendar link copied to clipboard' : 'Could not copy automatically, link is selected for manual copy';
      setTimeout(() => {
        copyBtn.textContent = original;
        if (copyStatus) copyStatus.textContent = '';
      }, 1600);
    });
  }

  let data;
  try {
    const res = await fetch('/data/teams/' + slug + '.json', { cache: 'no-store' });
    data = await res.json();
  } catch (e) {
    status.textContent = 'Could not load schedule data. Try refreshing.';
    return;
  }

  const lastUpdatedEl = document.getElementById('last-updated');
  if (lastUpdatedEl) lastUpdatedEl.textContent = 'Last checked ' + data.lastUpdated + '.';

  const byType = { preseason: [], regular: [], postseason: [] };
  for (const g of data.games) {
    const type = g.seasonType || 'regular';
    if (byType[type]) byType[type].push(g);
  }

  markNextGame(data.games);

  const frag = document.createDocumentFragment();

  if (byType.preseason.length) {
    frag.appendChild(buildSection('preseason', byType.preseason));
  }

  frag.appendChild(buildSection('regular', byType.regular));

  if (byType.postseason.length) {
    frag.appendChild(buildSection('postseason', byType.postseason));
  } else if (data.postseason && data.postseason.status === 'not_yet_determined') {
    const section = document.createElement('div');
    section.className = 'section-block';
    section.innerHTML =
      '<div class="section-head"><h2>Postseason</h2></div>' +
      '<div class="section-note">' + (data.postseason.note || 'To be determined.') + '</div>';
    frag.appendChild(section);
  }

  sections.appendChild(frag);
  status.hidden = true;
  sections.hidden = false;

  const regularGames = byType.regular.filter((g) => g.opponent !== 'BYE WEEK');
  const byeWeek = byType.regular.find((g) => g.opponent === 'BYE WEEK');
  const primetimeCount = byType.regular.filter((g) => g.isPrimetimeOrSpecial).length;

  const statGames = document.getElementById('stat-games');
  const statBye = document.getElementById('stat-bye');
  const statPrimetime = document.getElementById('stat-primetime');
  if (statGames) statGames.textContent = regularGames.length;
  if (statBye) statBye.textContent = byeWeek ? 'Week ' + byeWeek.week : 'TBD';
  if (statPrimetime) statPrimetime.textContent = primetimeCount;
}
