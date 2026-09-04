const SEASON_LABELS = {
  preseason: 'Preseason',
  regular: 'Regular Season',
  postseason: 'Postseason',
};

function dayFmt(dateStr) {
  if (!dateStr) return { weekday: 'TBD', rest: '' };
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return {
    weekday: dt.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }),
    rest: dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
  };
}

function timeFmt(timeStr) {
  if (!timeStr) return '';
  const [hh, mm] = timeStr.split(':').map(Number);
  const dt = new Date(Date.UTC(2000, 0, 1, hh, mm));
  return dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }) + ' ET';
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
  tr.className = 'game-row ' + (isHome ? 'home-row' : 'away-row') + (isPast ? ' past-row' : '');

  const d = dayFmt(g.date);
  const time = g.kickoffLocal ? timeFmt(g.kickoffLocal) : '';
  const verb = isHome ? 'vs' : '@';

  const watchParts = [];
  if (g.network) watchParts.push(g.network);
  const watchLabel = watchParts.length ? watchParts.join(' / ') : (g.streaming ? '' : 'TBD');

  let resultHtml = '';
  if (g.result) {
    const won = /won/i.test(g.result);
    const lost = /lost/i.test(g.result);
    resultHtml = '<div class="result-line ' + (won ? 'win' : lost ? 'loss' : '') + '">' + g.result + '</div>';
  }

  tr.innerHTML =
    '<td class="col-week">' + g.week + '</td>' +
    '<td class="col-date"><span class="weekday">' + d.weekday + '</span>' + d.rest + '</td>' +
    '<td class="col-matchup">' +
      '<div class="opp-line">' +
        verb + ' ' + g.opponent +
        '<span class="ha-flag ' + (isHome ? 'home' : 'away') + '">' + (isHome ? 'Home' : 'Away') + '</span>' +
      '</div>' +
      (g.isPrimetimeOrSpecial ? '<div class="special-line">' + g.isPrimetimeOrSpecial + '</div>' : '') +
      (isPast
        ? resultHtml
        : (time ? '<div class="time-line">' + time + '</div>' : '<div class="time-line">Time TBD</div>')) +
    '</td>' +
    '<td class="col-watch">' +
      watchLabel +
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

async function initTeamPage(slug) {
  const status = document.getElementById('status');
  const sections = document.getElementById('sections');

  let teamMeta;
  try {
    const idxRes = await fetch('/data/teams.json', { cache: 'no-store' });
    const idx = await idxRes.json();
    teamMeta = idx.teams.find((t) => t.slug === slug);
  } catch (e) {
    status.textContent = 'Could not load team index. Try refreshing.';
    return;
  }

  if (!teamMeta) {
    status.textContent = 'Unknown team.';
    return;
  }

  document.documentElement.style.setProperty('--team-primary', teamMeta.colors.primary);
  document.documentElement.style.setProperty('--team-primary-deep', teamMeta.colors.primaryDeep);
  document.documentElement.style.setProperty('--team-accent', teamMeta.colors.accent);
  document.title = teamMeta.fullName + ' Schedule';

  const cityEl = document.getElementById('team-city');
  const nameEl = document.getElementById('team-name');
  const stadiumEl = document.getElementById('team-stadium');
  if (cityEl) cityEl.textContent = teamMeta.city.toUpperCase();
  if (nameEl) nameEl.textContent = teamMeta.name;
  if (stadiumEl) stadiumEl.textContent = teamMeta.stadium;

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
    selection.removeAllRanges();
    return ok;
  }

  const copyBtn = document.getElementById('copy-btn');
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

      copyBtn.textContent = ok ? 'Copied' : 'Select and copy';
      setTimeout(() => { copyBtn.textContent = original; }, 1600);
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
