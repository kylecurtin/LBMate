const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function initialMode() {
  const p = new URLSearchParams(location.search).get('mode');
  if (p === 'work' || p === 'home') return p;
  // Default by time-of-day: before 1pm NY = to Manhattan, after = to Long Beach
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', hour12: false }).format(new Date())) % 24;
  return h < 13 ? 'work' : 'home';
}

const state = {
  mode: initialMode(),
  lastFetch: 0,
  autoRefreshTimer: null,
  inFlight: null,
  countdownEpoch: null,
};

const icons = {
  bus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M3 10h18"/><circle cx="7" cy="20" r="1.4"/><circle cx="17" cy="20" r="1.4"/></svg>`,
  train: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="14" rx="3"/><path d="M5 11h14"/><path d="M8 20l-2 2M16 20l2 2"/></svg>`,
  subway: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="15" rx="3"/><circle cx="9" cy="13" r="1"/><circle cx="15" cy="13" r="1"/><path d="M7 20l-2 2M17 20l2 2"/></svg>`,
};

async function fetchPlan(mode) {
  if (state.inFlight) state.inFlight.abort();
  const ctrl = new AbortController();
  state.inFlight = ctrl;
  try {
    const r = await fetch(`/api/plan/${mode}`, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    state.inFlight = null;
  }
}

function setHero(mode) {
  if (mode === 'home') {
    $('#hero-title').textContent = 'To Long Beach';
    $('#hero-sub').textContent = 'Next LIRR from Penn';
  } else {
    $('#hero-title').textContent = 'To Manhattan';
    $('#hero-sub').textContent = 'Next bus at Stop H';
  }
}

function setSegmented(mode) {
  $$('.seg').forEach((b) => {
    const active = b.dataset.mode === mode;
    b.classList.toggle('seg-active', active);
    b.setAttribute('aria-selected', active);
  });
}

function fmtClock(epoch) {
  return new Date(epoch * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
}
function fmtDuration(secs) {
  const m = Math.round(secs / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function renderHome(options) {
  if (!options.length) return emptyState('No trains heading to Long Beach in range.');
  return options.map((o, i) => renderHomeCard(o, i === 0)).join('');
}

function renderWork(options) {
  if (!options.length) return emptyState('No buses paired with a Manhattan train in range.');
  return options.map((o, i) => renderWorkCard(o, i === 0)).join('');
}

function emptyState(msg) {
  return `<div class="empty">${msg}</div>`;
}

function trainBadges(train) {
  const badges = [];
  if (train.cancelled) badges.push('<span class="badge badge-cancelled">Cancelled</span>');
  else if (train.rtMatched) badges.push('<span class="badge badge-live">Live</span>');
  if (Math.abs(train.depDelaySec) >= 60) {
    const min = Math.round(train.depDelaySec / 60);
    badges.push(`<span class="badge badge-delay">${min > 0 ? '+' : ''}${min}m</span>`);
  }
  if (train.transferAt === 'JAM') badges.push('<span class="badge badge-transfer">via Jamaica</span>');
  return badges.join(' ');
}

function busBadges(bus) {
  const badges = [];
  if (bus.waitsForTrain) badges.push('<span class="badge badge-waits">Waits for train</span>');
  return badges.join(' ');
}

function renderHomeCard(o, recommended) {
  const noBus = o.noBus;
  const trainDur = fmtDuration(o.train.arrEpoch - o.train.depEpoch);
  return `
    <article class="card ${recommended ? 'recommended' : ''}">
      <span class="card-time-label">Train leaves Penn</span>
      <div class="card-headline">
        <div class="card-time">${fmtClock(o.train.depEpoch)}</div>
        <div class="card-sub">→ Long Beach ${fmtClock(o.train.arrEpoch)} · ${trainDur}</div>
      </div>

      <div class="leg">
        <div class="leg-icon train">${icons.train}</div>
        <div class="leg-body">
          <div class="leg-title">LIRR · ${o.train.fromName} → ${o.train.toName}</div>
          <div class="leg-detail">${o.train.peak ? 'Peak · ' : ''}${trainDur} ride ${trainBadges(o.train)}</div>
        </div>
        <div class="leg-time">${fmtClock(o.train.depEpoch)}<span class="end">→ ${fmtClock(o.train.arrEpoch)}</span></div>
      </div>

      ${noBus ? `
        <div class="no-bus-notice">No connecting Long Beach bus for this train. Walk or cab from the station.</div>
      ` : `
        <div class="leg">
          <div class="leg-icon bus">${icons.bus}</div>
          <div class="leg-body">
            <div class="leg-title">Long Beach Bus · LIRR → Stop H</div>
            <div class="leg-detail">${o.transferMin}-min transfer at LIRR ${busBadges(o.bus)}</div>
          </div>
          <div class="leg-time">${o.bus.label}<span class="end">→ ${fmtClock(o.arriveStopHEpoch)}</span></div>
        </div>

        <div class="card-summary">
          <div class="summary-cell"><span>Transfer slack</span><strong>${o.transferMin} min</strong></div>
          <div class="summary-cell"><span>At Stop H</span><strong>${o.arriveStopHLabel}</strong></div>
        </div>
      `}
    </article>
  `;
}

function renderWorkCard(o, recommended) {
  const trainDur = fmtDuration(o.train.arrEpoch - o.train.depEpoch);
  return `
    <article class="card ${recommended ? 'recommended' : ''}">
      <span class="card-time-label">Bus at Stop H</span>
      <div class="card-headline">
        <div class="card-time">${o.bus.label}</div>
        <div class="card-sub">→ office ≈ ${o.arriveOfficeLabel}</div>
      </div>

      <div class="leg">
        <div class="leg-icon bus">${icons.bus}</div>
        <div class="leg-body">
          <div class="leg-title">Long Beach Bus · Stop H → LIRR</div>
          <div class="leg-detail">≈ 7 min to LIRR ${busBadges(o.bus)}</div>
        </div>
        <div class="leg-time">${o.bus.label}<span class="end">→ ${fmtClock(o.arriveLirrEpoch)}</span></div>
      </div>

      <div class="leg">
        <div class="leg-icon train">${icons.train}</div>
        <div class="leg-body">
          <div class="leg-title">LIRR · ${o.train.fromName} → ${o.train.toName}</div>
          <div class="leg-detail">${o.train.peak ? 'Peak · ' : ''}${trainDur} ride ${trainBadges(o.train)}</div>
        </div>
        <div class="leg-time">${fmtClock(o.train.depEpoch)}<span class="end">→ ${fmtClock(o.train.arrEpoch)}</span></div>
      </div>

      <div class="leg">
        <div class="leg-icon subway">${icons.subway}</div>
        <div class="leg-body">
          <div class="leg-title">Subway · Penn → 20 West St (FiDi)</div>
          <div class="leg-detail">≈ 25 min via 1/2/3 or A/C/E</div>
        </div>
        <div class="leg-time">${o.arriveOfficeLabel}</div>
      </div>

      <div class="card-summary">
        <div class="summary-cell"><span>Train slack</span><strong>${o.transferMin} min</strong></div>
        <div class="summary-cell"><span>At office</span><strong>${o.arriveOfficeLabel}</strong></div>
      </div>
    </article>
  `;
}

function setCountdownAnchor(mode, options) {
  if (!options || !options.length) { state.countdownEpoch = null; return; }
  const first = options[0];
  state.countdownEpoch = mode === 'work' ? first.bus?.epoch : first.train?.depEpoch;
}

function tickCountdown() {
  const el = $('#hero-countdown');
  const when = $('#hero-when');
  if (!el) return;
  if (!state.countdownEpoch) {
    el.textContent = '—';
    el.classList.remove('now');
    when.textContent = '';
    return;
  }
  const diffMs = state.countdownEpoch * 1000 - Date.now();
  if (diffMs <= 0) {
    el.textContent = 'Now';
    el.classList.add('now');
    when.textContent = '';
    return;
  }
  el.classList.remove('now');
  const totalSec = Math.floor(diffMs / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  if (mins < 60) {
    el.textContent = `${mins}:${String(secs).padStart(2, '0')}`;
  } else {
    const h = Math.floor(mins / 60);
    el.textContent = `${h}h ${String(mins % 60).padStart(2, '0')}m`;
  }
  const target = new Date(state.countdownEpoch * 1000);
  when.textContent = `at ${target.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })}`;
}

async function render() {
  setHero(state.mode);
  setSegmented(state.mode);
  const main = $('#options');
  if (!main.children.length || !main.querySelector('.card')) {
    main.innerHTML = '<div class="skeleton-card"></div><div class="skeleton-card"></div><div class="skeleton-card"></div>';
  }
  try {
    const data = await fetchPlan(state.mode);
    main.innerHTML = state.mode === 'home' ? renderHome(data.options) : renderWork(data.options);
    setCountdownAnchor(state.mode, data.options);
    tickCountdown();
    state.lastFetch = Date.now();
    updateStatus(true);
  } catch (e) {
    if (e.name === 'AbortError') return;
    main.innerHTML = `<div class="empty">Couldn't load plan: ${e.message}<br><br>Tap Refresh.</div>`;
    updateStatus(false);
  }
}

function updateStatus(ok) {
  const eyebrow = $('.hero-eyebrow');
  const label = $('#rt-status');
  eyebrow.classList.toggle('offline', !ok);
  label.textContent = ok ? 'Live · MTA real-time' : 'Offline';
  const lu = $('#last-updated');
  lu.textContent = ok ? `Updated ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : 'Stale';
}

function bindEvents() {
  $$('.seg').forEach((b) => b.addEventListener('click', () => {
    state.mode = b.dataset.mode;
    render();
  }));
  $('#refresh').addEventListener('click', async () => {
    const btn = $('#refresh');
    btn.classList.add('spinning');
    try { await render(); } finally {
      setTimeout(() => btn.classList.remove('spinning'), 400);
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - state.lastFetch > 20_000) {
      render();
    }
  });

  setInterval(() => {
    if (document.visibilityState === 'visible') render();
  }, 45_000);

  setInterval(tickCountdown, 1000);
}

if ('serviceWorker' in navigator) {
  const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (isLocal) {
    navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
  } else {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}

bindEvents();
render();
