const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// Internal mode names match the user-facing semantics now.
// Legacy URLs with ?mode=work|home are still honored.
function initialMode() {
  const p = new URLSearchParams(location.search).get('mode');
  if (p === 'manhattan' || p === 'work') return 'manhattan';
  if (p === 'longbeach' || p === 'home') return 'longbeach';
  // Default by time-of-day: before 1pm NY = heading to Manhattan, otherwise heading back to Long Beach
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', hour12: false }).format(new Date())) % 24;
  return h < 13 ? 'manhattan' : 'longbeach';
}

const state = {
  mode: initialMode(),
  lastFetch: 0,
  inFlight: null,
  countdownEpoch: null,
  items: [],
};

const MODES = {
  manhattan: {
    label: 'To Manhattan',
    sub: 'Next bus at Grand & W. Beech',
    upcomingLabel: 'Upcoming buses',
    fetch: () => fetch('/api/bus/next?stop=H&n=6').then((r) => r.json()),
    toItems: (data) => (data.items || []).map((b) => ({
      epoch: b.epoch,
      title: 'Long Beach Bus · Stop H → LIRR',
      detail: 'Boards at Grand & W. Beech',
      badges: [],
    })),
  },
  longbeach: {
    label: 'To Long Beach',
    sub: 'Next LIRR from Penn',
    upcomingLabel: 'Upcoming trains',
    fetch: () => fetch('/api/lirr/next?dir=toLB&n=6').then((r) => r.json()),
    toItems: (data) => (data.items || []).map((t) => ({
      epoch: t.depEpoch,
      title: `${t.fromName || 'Penn Station'} → ${t.toName || 'Long Beach'}`,
      detail: trainDetail(t),
      badges: trainBadges(t),
    })),
  },
};

function trainDetail(t) {
  const dur = Math.round((t.arrEpoch - t.depEpoch) / 60);
  const arr = fmtClock(t.arrEpoch);
  return `${dur} min · arrives ${arr}`;
}

function trainBadges(t) {
  const b = [];
  if (t.cancelled) b.push({ cls: 'badge-cancelled', text: 'Cancelled' });
  else if (t.rtMatched) b.push({ cls: 'badge-live', text: 'Live' });
  if (Math.abs(t.depDelaySec || 0) >= 60) {
    const m = Math.round(t.depDelaySec / 60);
    b.push({ cls: 'badge-delay', text: `${m > 0 ? '+' : ''}${m}m` });
  }
  if (t.transferAt === 'JAM') b.push({ cls: 'badge-transfer', text: 'via Jamaica' });
  if (t.peak) b.push({ cls: 'badge-peak', text: 'Peak' });
  return b;
}

function fmtClock(epoch) {
  return new Date(epoch * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
}

function fmtAmPmSplit(epoch) {
  const s = fmtClock(epoch);
  // "7:31 AM" -> ["7:31", "AM"]
  const m = s.match(/^(.*?)\s*(AM|PM)$/i);
  return m ? { time: m[1], ampm: m[2] } : { time: s, ampm: '' };
}

function fmtRelative(epoch) {
  const diffMin = Math.round((epoch * 1000 - Date.now()) / 60000);
  if (diffMin <= 0) return 'now';
  if (diffMin < 60) return `in ${diffMin} min`;
  const h = Math.floor(diffMin / 60);
  const m = diffMin % 60;
  return m === 0 ? `in ${h}h` : `in ${h}h ${m}m`;
}

function setHero(mode) {
  const cfg = MODES[mode];
  $('#hero-mode-label').textContent = cfg.label;
  $('#hero-sub').textContent = cfg.sub;
  $('#upcoming-label').textContent = cfg.upcomingLabel;
}

function setSegmented(mode) {
  $$('.seg').forEach((b) => {
    const active = b.dataset.mode === mode;
    b.classList.toggle('seg-active', active);
    b.setAttribute('aria-selected', active);
  });
}

function renderUpcoming(items) {
  const container = $('#upcoming');
  if (!items.length) {
    container.innerHTML = '<div class="empty">Nothing scheduled in range.</div>';
    return;
  }
  // Hero already shows the very next one — list shows it again so the page reads top-to-bottom as a stack.
  container.innerHTML = items.slice(0, 6).map((it, i) => {
    const tm = fmtAmPmSplit(it.epoch);
    const badges = (it.badges || []).map((b) => `<span class="badge ${b.cls}">${b.text}</span>`).join('');
    return `
      <div class="row ${i === 0 ? 'first' : ''}">
        <div>
          <div class="row-time">${tm.time}<span class="ampm">${tm.ampm}</span></div>
          <div class="row-eta">${fmtRelative(it.epoch)}</div>
        </div>
        <div class="row-meta">
          <div class="row-title">${it.title}</div>
          <div class="row-detail">${it.detail}${badges ? ` <span class="row-badges">${badges}</span>` : ''}</div>
        </div>
      </div>
    `;
  }).join('');
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
    el.textContent = 'NOW';
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
  when.textContent = `Arrives ${fmtClock(state.countdownEpoch)}`;
}

async function render() {
  setHero(state.mode);
  setSegmented(state.mode);

  const container = $('#upcoming');
  if (!container.querySelector('.row')) {
    container.innerHTML = '<div class="skeleton-row"></div><div class="skeleton-row"></div><div class="skeleton-row"></div><div class="skeleton-row"></div>';
  }

  try {
    if (state.inFlight) state.inFlight.abort();
    const ctrl = new AbortController();
    state.inFlight = ctrl;
    const cfg = MODES[state.mode];
    const raw = await cfg.fetch();
    const items = cfg.toItems(raw)
      .filter((it) => it.epoch * 1000 > Date.now() - 30_000)
      .sort((a, b) => a.epoch - b.epoch);
    state.items = items;
    state.countdownEpoch = items[0]?.epoch || null;
    renderUpcoming(items);
    tickCountdown();
    state.lastFetch = Date.now();
    updateStatus(true);
  } catch (e) {
    if (e.name === 'AbortError') return;
    container.innerHTML = `<div class="empty">Couldn't load: ${e.message}<br><br>Tap Refresh.</div>`;
    updateStatus(false);
  } finally {
    state.inFlight = null;
  }
}

function updateStatus(ok) {
  const eyebrow = $('.hero-eyebrow');
  const label = $('#rt-status');
  eyebrow.classList.toggle('offline', !ok);
  label.textContent = ok ? 'Live' : 'Offline';
  const lu = $('#last-updated');
  lu.textContent = ok ? `Updated ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : 'Stale';
}

function bindEvents() {
  $$('.seg').forEach((b) => b.addEventListener('click', () => {
    state.mode = b.dataset.mode;
    const url = new URL(location.href);
    url.searchParams.set('mode', state.mode);
    history.replaceState(null, '', url);
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
