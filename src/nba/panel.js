// The NBA draft panel: the pick to make, your category outlook, open roster
// slots, and the full board ranked by live pick score. Rendered into a shadow
// root so Yahoo's CSS can't bleed in. Also used inline on the pre-draft board page.
globalThis.YDR = globalThis.YDR || {};

(function (YDR) {
  'use strict';

  const HOST_ID = 'ydr-nba-panel-host';
  const POSITIONS = ['ALL', 'PG', 'SG', 'SF', 'PF', 'C'];
  const UI_DEFAULTS = {
    x: null, y: null, w: null, h: null, collapsed: false, showSettings: false,
    sortBy: 'score', sortDir: 'desc', position: 'ALL', hideDrafted: true, search: ''
  };

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .panel {
      position: fixed; width: 780px; max-width: calc(100vw - 16px); max-height: 86vh;
      min-width: 360px; min-height: 160px; display: flex; flex-direction: column; resize: both;
      font: 12px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #16181d; color: #e8eaed; border: 1px solid #2c3038; border-radius: 12px;
      box-shadow: 0 12px 40px rgba(0,0,0,.5); z-index: 2147483647; overflow: hidden;
    }
    .panel.inline { position: static; width: 100%; max-width: none; max-height: none; box-shadow: none; resize: none; min-width: 0; }
    .panel.inline header { cursor: default; }
    .panel.inline .body { max-height: var(--ydr-body-height, 420px); }
    .panel.sized { max-height: calc(100vh - 8px); }
    .panel.collapsed > :not(header) { display: none; }
    header { display: flex; align-items: center; gap: 8px; padding: 9px 12px; background: #1d2027; border-bottom: 1px solid #2c3038; cursor: move; user-select: none; }
    .title { font-weight: 600; font-size: 13px; flex: 1; }
    .status { font-size: 11px; color: #9aa0a6; }
    .status.err { color: #f28b82; }
    .iconbtn { background: none; border: none; color: #9aa0a6; cursor: pointer; font-size: 12px; padding: 2px 6px; border-radius: 5px; }
    .iconbtn:hover { background: #2c3038; color: #e8eaed; }
    .iconbtn.on { color: #b388ff; }
    .turn { padding: 6px 12px; background: #146c43; color: #fff; font-weight: 700; text-align: center; }
    .soon { padding: 5px 12px; background: rgba(240,180,41,.12); color: #f0b429; font-weight: 600; text-align: center; }
    .rec { padding: 8px 12px; border-bottom: 1px solid #2c3038; background: #1a1c22; }
    .rec .pick { font-size: 14px; font-weight: 700; }
    .rec .pick .name { cursor: pointer; }
    .rec .pick .name:hover { text-decoration: underline; }
    .rec .why { color: #9aa0a6; font-size: 11px; margin-top: 2px; }
    .rec .then { color: #9aa0a6; font-size: 11px; margin-top: 4px; }
    .rec .then b { color: #c9cdd4; font-weight: 600; }
    .gain { color: #4ade80; font-weight: 600; }
    .row { display: flex; flex-wrap: wrap; gap: 4px 6px; padding: 6px 12px; border-bottom: 1px solid #2c3038; font-size: 11px; color: #9aa0a6; align-items: center; }
    .cat { padding: 1px 6px; border-radius: 5px; background: #24272f; color: #c9cdd4; white-space: nowrap; }
    .cat b { font-weight: 700; }
    .cat.hi { background: rgba(74,222,128,.15); color: #4ade80; }
    .cat.lo { background: rgba(242,139,130,.15); color: #f28b82; }
    .cat.off { opacity: .4; text-decoration: line-through; }
    .slot { padding: 1px 6px; border-radius: 5px; border: 1px solid #333842; color: #e8eaed; }
    .slot.done { color: #4ade80; border-color: transparent; }
    .sync { display: flex; align-items: center; gap: 6px; }
    .sync .ok { color: #4ade80; }
    .sync .warn { color: #f0b429; }
    .controls { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; padding: 7px 12px; border-bottom: 1px solid #2c3038; }
    .chip { background: #24272f; border: 1px solid #333842; color: #c9cdd4; padding: 2px 9px; border-radius: 999px; font-size: 11px; cursor: pointer; }
    .chip.active { background: #7e1fff; border-color: #7e1fff; color: #fff; }
    input.search { flex: 1; min-width: 90px; background: #1d2027; border: 1px solid #2c3038; color: #e8eaed; border-radius: 6px; padding: 3px 7px; font-size: 11px; }
    label.toggle { display: flex; align-items: center; gap: 4px; font-size: 11px; color: #9aa0a6; cursor: pointer; }
    .body { overflow: auto; flex: 1; min-height: 0; }
    table { width: 100%; border-collapse: collapse; }
    th { position: sticky; top: 0; background: #1d2027; text-align: right; font-size: 10.5px; color: #9aa0a6; font-weight: 600; padding: 6px; cursor: pointer; border-bottom: 1px solid #2c3038; white-space: nowrap; z-index: 1; }
    th.l, td.l { text-align: left; }
    th:hover { color: #e8eaed; }
    td { padding: 5px 6px; border-bottom: 1px solid #22252c; white-space: nowrap; text-align: right; }
    tr.drafted { opacity: .4; }
    tr.drafted .name { text-decoration: line-through; }
    tr.mine { background: rgba(126,31,255,.18); opacity: .8; }
    tr.blocked td:not(:first-child) { opacity: .45; }
    tr.queued td:first-child { color: #b388ff; font-weight: 700; }
    tr.unmatched .name { color: #f0b429; }
    .name { font-weight: 500; cursor: pointer; }
    .name:hover { text-decoration: underline; }
    .meta { color: #9aa0a6; font-size: 10.5px; }
    .steal { color: #6cc4f0; font-weight: 700; } .psteal { color: #6cc4f0; }
    .preach { color: #f28b82; } .reach { color: #f28b82; font-weight: 700; } .even { color: #6b7079; }
    .back-lo { color: #f28b82; } .back-hi { color: #6b7079; }
    .adj-up { color: #4ade80; } .adj-down { color: #f28b82; }
    .inj { font-size: 9px; font-weight: 700; color: #fff; background: #c5221f; border-radius: 3px; padding: 0 3px; cursor: help; }
    .dtd { font-size: 9px; font-weight: 700; color: #f0b429; cursor: help; }
    .up { color: #4ade80; font-size: 9px; } .down { color: #f28b82; font-size: 9px; }
    .x { background: none; border: none; color: #5f6368; cursor: pointer; font-size: 12px; padding: 0 2px; }
    .x:hover { color: #f28b82; }
    .settings { padding: 8px 12px; border-bottom: 1px solid #2c3038; background: #1a1c22; display: grid; grid-template-columns: auto 1fr; gap: 6px 10px; align-items: center; font-size: 11px; }
    .settings .lbl { color: #9aa0a6; }
    .seg { display: inline-flex; flex-wrap: wrap; justify-self: start; border: 1px solid #333842; border-radius: 6px; overflow: hidden; }
    .seg button { background: #24272f; border: none; color: #c9cdd4; font-size: 11px; padding: 2px 8px; cursor: pointer; }
    .seg button + button { border-left: 1px solid #333842; }
    .seg button.on { background: #7e1fff; color: #fff; }
    .seg button.part { background: #4a2a80; color: #fff; }
    .note { grid-column: 1 / -1; color: #9aa0a6; line-height: 1.5; }
    .linkbtn { background: none; border: none; color: #b388ff; cursor: pointer; font-size: 11px; padding: 0; }
    .empty { padding: 26px 16px; text-align: center; color: #9aa0a6; line-height: 1.6; }
    .warnbar { padding: 5px 12px; font-size: 11px; color: #f0b429; background: rgba(240,180,41,.09); }
  `;

  const COLUMNS = [
    { key: 'score', label: '#', title: 'Live pick order: standings gain, minus a little for players likely to come back' },
    { key: 'name', label: 'Player', left: true },
    { key: 'pos', label: 'Pos', left: true },
    { key: 'gain', label: 'Gain', title: 'Expected standings points (roto) or matchups won (H2H) this player adds to your team now' },
    { key: 'back', label: 'Back', title: 'Chance he is still there at your following pick (from ADP)' },
    { key: 'gp', label: 'GP', title: 'Projected games (injury-adjusted). INJ = out at the start of the season; hover for the report' },
    { key: 'mpg', label: 'MPG', title: 'Projected minutes per game. ▲/▼ = 3+ minutes more/less than last season' },
    { key: 'starts', label: 'Starts', title: 'Games he would actually start for your roster: nightly lineups on the real schedule, 82-game slot caps' },
    { key: 'vorp', label: 'VORP', title: 'Static value over replacement (the workbook)' },
    { key: 'rank', label: 'Rk' },
    { key: 'adp', label: 'ADP', title: 'Yahoo ADP' },
    { key: 'diff', label: 'Diff', title: 'ADP − Rk: positive = the room takes him later than his value' },
    { key: 'adj', label: 'Adj', left: true },
    { key: 'status', label: '' }
  ];

  let shadow = null;
  let ui = null;
  let inline = false;
  let handlers = {};
  let lastState = { status: 'loading', rows: [] };

  async function loadUi() {
    return Object.assign({}, UI_DEFAULTS, await YDR.storage.get('nbaUi', {}));
  }

  function saveUi(patch) {
    Object.assign(ui, patch);
    return YDR.storage.set({ nbaUi: ui });
  }

  async function mount(callbacks, options = {}) {
    if (callbacks) handlers = callbacks;
    if (options.container) {
      if (shadow) return;
      inline = true;
      ui = ui || (await loadUi());
      shadow = options.container.attachShadow({ mode: 'open' });
    } else {
      if (inline || document.getElementById(HOST_ID) || !document.body) return;
      ui = ui || (await loadUi());
      const host = document.createElement('div');
      host.id = HOST_ID;
      document.documentElement.appendChild(host);
      shadow = host.attachShadow({ mode: 'open' });
    }
    YDR.dom.applyStyles(shadow, CSS);
    const panel = document.createElement('div');
    panel.className = inline ? 'panel inline' : 'panel';
    shadow.append(panel);
    if (!inline) watchSize(panel);
    render(lastState);
  }

  function watchSize(panel) {
    if (ui.w && ui.h) {
      panel.style.width = `${ui.w}px`;
      panel.style.height = `${ui.h}px`;
      panel.classList.add('sized');
    }
    let timer = null;
    let first = true;
    new ResizeObserver(() => {
      if (first) {
        first = false;
        return;
      }
      clearTimeout(timer);
      timer = setTimeout(() => {
        const w = Math.round(panel.offsetWidth);
        const h = Math.round(panel.offsetHeight);
        if (ui.collapsed || !panel.style.height || (w === ui.w && h === ui.h)) return;
        panel.classList.add('sized');
        saveUi({ w, h });
      }, 250);
    }).observe(panel);
  }

  function place(panel) {
    if (inline) return;
    if (ui.collapsed) panel.style.height = '';
    else if (ui.w && ui.h && !panel.style.height) {
      panel.style.width = `${ui.w}px`;
      panel.style.height = `${ui.h}px`;
    }
    const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));
    panel.style.left = `${clamp(ui.x ?? 16, 0, window.innerWidth - 120)}px`;
    panel.style.top = `${clamp(ui.y ?? 120, 0, window.innerHeight - 60)}px`;
  }

  /**
   * state: { status, message, statusKind, rows, rec, myTurn, picksAway, options, sheet, sync, unmatched }
   * row:   { key, name, team, positions, rank, vorp, adp, diff, adj, gain, back, score, order,
   *          feasible, queued, pickNo, byMe, manual, matched, stats, catGain }
   */
  function render(state) {
    lastState = state;
    if (!shadow) return;
    const panel = shadow.querySelector('.panel');
    panel.classList.toggle('collapsed', !inline && ui.collapsed);

    const active = shadow.activeElement;
    const typing = active && active.classList && active.classList.contains('search');
    const visible = sortRows(filterRows(state.rows || []));
    if (typing) {
      panel.querySelector('.body').innerHTML = renderTable(visible, state);
      wireTable(panel);
      return;
    }

    const scrollTop = panel.querySelector('.body')?.scrollTop || 0;
    panel.innerHTML = `
      <header>
        <span class="title">NBA Roto Board</span>
        <span class="status ${state.statusKind || ''}">${esc(state.message || '')}</span>
        <button class="iconbtn ${ui.showSettings ? 'on' : ''}" data-act="settings" title="Categories, games played, boosts">⚙ Settings</button>
        ${inline ? '' : `<button class="iconbtn" data-act="collapse" title="Collapse">${ui.collapsed ? '▢' : '—'}</button>`}
      </header>
      ${renderSettings(state)}
      ${state.myTurn ? '<div class="turn">YOU ARE ON THE CLOCK</div>' : ''}
      ${!state.myTurn && state.picksAway > 0 && state.picksAway <= 3
        ? `<div class="soon">You're up in ${state.picksAway} pick${state.picksAway === 1 ? '' : 's'}</div>` : ''}
      ${renderRec(state)}
      ${renderOutlook(state)}
      ${renderRoster(state)}
      ${renderSync(state)}
      <div class="controls">
        ${POSITIONS.map((p) => `<button class="chip ${ui.position === p ? 'active' : ''}" data-pos="${p}">${p}</button>`).join('')}
        <input class="search" type="text" placeholder="search" value="${esc(ui.search)}" spellcheck="false" />
        <label class="toggle"><input type="checkbox" data-act="hide-drafted" ${ui.hideDrafted ? 'checked' : ''}/> hide drafted</label>
      </div>
      ${state.unmatched > 0 ? `<div class="warnbar">${state.unmatched} projected player${state.unmatched === 1 ? '' : 's'} not found in Yahoo's player pool (yellow) — use ✕ if one gets drafted.</div>` : ''}
      <div class="body">${renderTable(visible, state)}</div>
    `;
    const body = panel.querySelector('.body');
    if (body) body.scrollTop = scrollTop;
    place(panel);
    wire(panel);
  }

  function renderRec(state) {
    const rec = state.rec;
    if (!rec || state.status !== 'ok') return '';
    if (rec.myOpen === 0) return '<div class="rec"><div class="why">Your roster is full.</div></div>';
    const top = rec.ranked[0];
    if (!top) return '<div class="rec"><div class="why">No available player fits your open starting slots.</div></div>';
    const helps = topCats(top.catGain, 3);
    const backNote = state.followingPick
      ? ` · ${Math.round(top.back * 100)}% he's back at pick ${state.followingPick}` : '';
    const forPick = state.myPick ? ` for pick ${state.myPick}` : '';
    const then = rec.ranked.slice(1, 5).map((c) =>
      `<b>${esc(shortName(c.name))}</b> <span class="gain">+${c.gain.toFixed(2)}</span>`).join(' · ');
    return `
      <div class="rec">
        <div class="pick">Take <span class="name" data-name="${esc(top.name)}">${esc(top.name)}</span>
          <span class="meta">${esc(top.positions.join(','))}</span> <span class="gain">+${top.gain.toFixed(2)} pts</span></div>
        <div class="why">Best standings gain${forPick}${helps ? ` · helps ${helps}` : ''}${backNote}</div>
        ${then ? `<div class="then">Next: ${then}</div>` : ''}
      </div>`;
  }

  function topCats(catGain, n) {
    return Object.entries(catGain || {})
      .filter(([, g]) => g > 0.01)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([c, g]) => `${c} +${g.toFixed(2)}`)
      .join(', ');
  }

  function renderOutlook(state) {
    const rec = state.rec;
    if (!rec || state.status !== 'ok') return '';
    const max = rec.maxPoints;
    const h2h = rec.scoring === 'h2h';
    const weights = state.options.weights;
    const cats = YDR.nbaModel.CATEGORIES.map((c) => {
      const pts = rec.outlook[c];
      const off = !weights[c];
      const cls = off ? 'off' : pts >= max * 0.66 ? 'hi' : pts <= max * 0.4 ? 'lo' : '';
      const unit = h2h ? `matchups won (of ${max})` : `roto points (1–${max})`;
      return `<span class="cat ${cls}" title="Expected ${unit} in ${c}">${c} <b>${pts.toFixed(1)}</b></span>`;
    }).join('');
    const label = h2h
      ? 'Expected H2H matchups won in each category over the season, against an average opponent'
      : 'Your projected roto standings: drafted players plus average picks for open spots';
    return `<div class="row"><span title="${label}">Outlook <b>${rec.total.toFixed(1)}</b></span>${cats}</div>`;
  }

  function renderRoster(state) {
    const rec = state.rec;
    if (!rec || state.status !== 'ok') return '';
    const slots = YDR.nbaRecommend.starterSlots(state.options.slots);
    const open = rec.needs.slice();
    const chips = slots.map((s) => {
      const i = open.indexOf(s);
      if (i >= 0) {
        open.splice(i, 1);
        return `<span class="slot">${s}</span>`;
      }
      return `<span class="slot done">${s}</span>`;
    }).join('');
    return `<div class="row"><span>Starters</span>${chips}<span>· ${rec.myOpen} pick${rec.myOpen === 1 ? '' : 's'} left</span></div>`;
  }

  function renderSync(state) {
    const sync = state.sync;
    if (!sync) return '';
    let note = '';
    if (sync.enabled) {
      if (!sync.ready) note = '<span class="warn">waiting for the draft connection…</span>';
      else if (sync.inSync) note = '<span class="ok">Yahoo queue matches the top 10 ✓</span>';
      else note = '<span class="warn">updating…</span>';
    } else {
      note = '<span>off — your Yahoo queue is left alone</span>';
    }
    return `
      <div class="row sync">
        <label class="toggle" title="Replace your Yahoo draft queue with the top 10 recommendations after every pick. Yahoo's autopick drafts from this queue.">
          <input type="checkbox" data-act="sync" ${sync.enabled ? 'checked' : ''}/> Sync Yahoo queue
        </label>
        ${note}
      </div>`;
  }

  function renderSettings(state) {
    if (!ui.showSettings || !state.options) return '';
    const o = state.options;
    const cats = YDR.nbaModel.CATEGORIES.map((c) => {
      const w = o.weights[c];
      const cls = w === 1 ? 'on' : w > 0 ? 'part' : '';
      return `<button class="${cls}" data-cat="${c}" title="${w === 1 ? 'Counts' : w > 0 ? `Weight ${w}` : 'Punted'} — click to toggle">${c}</button>`;
    }).join('');
    const seg = (key, label, choices) => `
      <span class="lbl">${label}</span>
      <span class="seg">${choices.map(([value, text]) =>
        `<button class="${o[key] === value ? 'on' : ''}" data-opt="${key}" data-val="${esc(JSON.stringify(value))}">${text}</button>`).join('')}</span>`;
    return `
      <div class="settings">
        <span class="lbl">Categories</span><span class="seg">${cats}</span>
        ${seg('scoring', 'Scoring', [['roto', 'Roto'], ['h2h', 'H2H categories']])}
        ${seg('gpProjection', 'Games', [[true, 'Projected GP'], [false, `Flat ${o.flatGp}`]])}
        ${seg('boosts', 'Boost / bust', [[true, 'On'], [false, 'Off']])}
        <div class="note">
          ${o.teams} teams · pool ${state.poolSize ?? ''} · ${esc(YDR.nbaRecommend.starterSlots(o.slots).join(' '))} + BN ${o.slots.BN || 0}.
          Turning a category off punts it: values and the outlook ignore it.
          ${state.changed ? '<button class="linkbtn" data-act="reset">Reset to workbook</button>' : ''}
        </div>
      </div>`;
  }

  function renderTable(rows, state) {
    if (state.status === 'no-board') return `<div class="empty">${state.emptyMessage || 'No projections loaded.'}</div>`;
    if (state.status === 'loading') return '<div class="empty">Loading…</div>';
    if (!rows.length) return '<div class="empty">Nothing matches the current filter.</div>';
    const head = COLUMNS.map((col) => {
      const arrow = ui.sortBy === col.key ? (ui.sortDir === 'asc' ? ' ▲' : ' ▼') : '';
      return `<th class="${col.left ? 'l' : ''}" data-sort="${col.key}" title="${esc(col.title || '')}">${col.label}${arrow}</th>`;
    }).join('');
    const body = rows.map((r) => {
      const taken = r.pickNo || r.manual;
      const cls = [taken ? 'drafted' : '', r.byMe ? 'mine' : '', !taken && !r.feasible ? 'blocked' : '',
        r.queued ? 'queued' : '', r.matched ? '' : 'unmatched'].filter(Boolean).join(' ');
      const status = r.pickNo
        ? `<span class="meta" title="Taken at pick ${r.pickNo}">#${r.pickNo}</span>`
        : handlers.onToggleDrafted
          ? `<button class="x" data-toggle="${esc(r.key)}" title="${r.manual ? 'Mark available' : 'Mark drafted'}">${r.manual ? '↺' : '✕'}</button>`
          : '';
      const order = taken ? '' : r.feasible ? r.order : '<span title="Would leave a starting slot unfillable">⊘</span>';
      return `
        <tr class="${cls}">
          <td>${order ?? ''}</td>
          <td class="l"><span class="name" data-name="${esc(r.name)}" title="${esc(statLine(r))}">${esc(r.name)}</span> <span class="meta">${esc(r.team || '')}</span></td>
          <td class="l meta">${esc(r.positions.join(','))}</td>
          <td>${taken ? '' : `<span class="${r.gain > 0 ? 'gain' : 'meta'}">${fmt(r.gain, 2)}</span>`}</td>
          <td>${taken || r.back === null ? '' : `<span class="${r.back < 0.35 ? 'back-lo' : r.back > 0.8 ? 'back-hi' : ''}">${Math.round(r.back * 100)}%</span>`}</td>
          <td>${renderGp(r)}</td>
          <td>${renderMpg(r)}</td>
          <td>${r.starts === null || r.starts === undefined || (taken && !r.byMe) ? '' : `<span class="${r.gp && r.starts < r.gp * 0.8 ? 'back-lo' : 'meta'}">${Math.round(r.starts)}</span>`}</td>
          <td>${fmt(r.vorp, 2)}</td>
          <td class="meta">${r.rank}</td>
          <td class="meta">${fmt(r.adp, 1)}</td>
          <td>${r.diff === null ? '' : `<span class="${diffClass(r.diff)}">${r.diff > 0 ? '+' : ''}${r.diff.toFixed(0)}</span>`}</td>
          <td class="l">${r.adj ? `<span class="${r.adj.startsWith('+') ? 'adj-up' : 'adj-down'}">${esc(r.adj)}</span>` : ''}</td>
          <td>${status}</td>
        </tr>`;
    }).join('');
    return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
  }

  function renderGp(r) {
    if (r.gp === undefined || r.gp === null) return '';
    const out = r.status === 'Out' && r.returnDate;
    const tag = out ? ` <span class="inj" title="${esc(`Out until ~${dateText(r.returnDate)} (${r.gamesOut} games) — ${r.note}`)}">INJ</span>`
      : r.status ? ` <span class="dtd" title="${esc(`${r.status} — ${r.note}`)}">${r.status === 'Day-To-Day' ? 'DTD' : esc(r.status)}</span>` : '';
    return `${Math.round(r.gp)}${tag}`;
  }

  function renderMpg(r) {
    if (r.mpg === undefined || r.mpg === null) return '';
    const d = r.mpg25 === null || r.mpg25 === undefined ? null : r.mpg - r.mpg25;
    const arrow = d === null ? '' : d >= 3 ? ' <span class="up">▲</span>' : d <= -3 ? ' <span class="down">▼</span>' : '';
    const title = d === null ? 'No 2025-26 minutes' : `2025-26: ${r.mpg25.toFixed(1)} MPG (${d >= 0 ? '+' : ''}${d.toFixed(1)})`;
    return `<span title="${esc(title)}">${r.mpg.toFixed(1)}</span>${arrow}`;
  }

  // Excel date serial -> "Nov 4"
  function dateText(serial) {
    const d = new Date(Date.UTC(1899, 11, 30) + serial * 864e5);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  }

  function diffClass(d) {
    if (d >= 24) return 'steal';
    if (d >= 12) return 'psteal';
    if (d <= -24) return 'reach';
    if (d <= -12) return 'preach';
    return 'even';
  }

  function statLine(r) {
    const s = r.stats || {};
    const n = (x) => (x === undefined ? '-' : Math.round(x));
    const pct = (m, a) => (a ? (m / a).toFixed(3).replace(/^0/, '') : '-');
    const helps = topCats(r.catGain, 4);
    return `GP ${n(s.gp)}  PTS ${n(s.PTS)}  REB ${n(s.REB)}  AST ${n(s.AST)}  STL ${n(s.STL)}  BLK ${n(s.BLK)}  3PM ${n(s['3PM'])}  ` +
      `FG ${pct(s.fgm, s.fga)}  FT ${pct(s.ftm, s.fta)}  TO ${n(s.TO)}  MPG ${s.mpg === undefined ? '-' : s.mpg.toFixed(1)}` +
      `${r.status ? `\n${r.status}: ${r.note}` : ''}` +
      `${helps ? `\nGain by category: ${helps}` : ''}${handlers.onPlayerClick ? '\nClick to search in Yahoo' : ''}`;
  }

  function fmt(v, places) {
    return v === null || v === undefined || !Number.isFinite(v) ? '' : Number(v).toFixed(places);
  }

  function shortName(name) {
    const parts = String(name).split(' ');
    return parts.length > 1 ? `${parts[0][0]}. ${parts.slice(1).join(' ')}` : name;
  }

  function filterRows(rows) {
    const search = YDR.match.normalizeName(ui.search || '');
    return rows.filter((r) => {
      if (ui.hideDrafted && (r.pickNo || r.manual)) return false;
      if (ui.position !== 'ALL' && !r.positions.includes(ui.position)) return false;
      return !search || YDR.match.normalizeName(r.name).includes(search);
    });
  }

  function sortRows(rows) {
    const dir = ui.sortDir === 'asc' ? 1 : -1;
    const value = (r) => {
      switch (ui.sortBy) {
        case 'pos': return r.positions.join(',');
        case 'status': return r.pickNo || (r.manual ? 9999 : 0);
        case 'adj': return (r.adj.match(/\+/g) || []).length - (r.adj.match(/-/g) || []).length;
        case 'score': return r.pickNo || r.manual ? null : r.feasible ? r.score : -1e9 + r.gain;
        default: return r[ui.sortBy];
      }
    };
    return rows.slice().sort((a, b) => {
      const av = value(a);
      const bv = value(b);
      const aBlank = av === null || av === undefined || av === '' || Number.isNaN(av);
      const bBlank = bv === null || bv === undefined || bv === '' || Number.isNaN(bv);
      if (aBlank || bBlank) return aBlank === bBlank ? a.rank - b.rank : aBlank ? 1 : -1;
      if (typeof av === 'string') return av.localeCompare(bv) * dir || a.rank - b.rank;
      return (av - bv) * dir || a.rank - b.rank;
    });
  }

  function wire(panel) {
    const on = (sel, event, fn) => panel.querySelectorAll(sel).forEach((el) => el.addEventListener(event, fn));
    on('[data-act="collapse"]', 'click', async () => {
      await saveUi({ collapsed: !ui.collapsed });
      render(lastState);
    });
    on('[data-act="settings"]', 'click', async () => {
      await saveUi({ showSettings: !ui.showSettings });
      render(lastState);
    });
    on('[data-pos]', 'click', async (e) => {
      await saveUi({ position: e.currentTarget.dataset.pos });
      render(lastState);
    });
    on('[data-act="hide-drafted"]', 'change', async (e) => {
      await saveUi({ hideDrafted: e.currentTarget.checked });
      render(lastState);
    });
    on('[data-act="sync"]', 'change', (e) => handlers.onSyncChange?.(e.currentTarget.checked));
    on('[data-cat]', 'click', (e) => handlers.onToggleCategory?.(e.currentTarget.dataset.cat));
    on('[data-opt]', 'click', (e) => handlers.onOptionChange?.({ [e.currentTarget.dataset.opt]: JSON.parse(e.currentTarget.dataset.val) }));
    on('[data-act="reset"]', 'click', () => handlers.onOptionChange?.(null));
    on('.rec .name[data-name]', 'click', (e) => handlers.onPlayerClick?.(e.currentTarget.dataset.name));
    const search = panel.querySelector('input.search');
    if (search) {
      search.addEventListener('input', () => {
        ui.search = search.value;
        saveUi({ search: ui.search });
        render(lastState);
      });
      search.addEventListener('keydown', (e) => e.stopPropagation()); // keep Yahoo's shortcuts out
    }
    wireTable(panel);
    if (!inline) enableDrag(panel, panel.querySelector('header'));
  }

  function wireTable(panel) {
    panel.querySelectorAll('[data-sort]').forEach((th) => th.addEventListener('click', async () => {
      const key = th.dataset.sort;
      const sortDir = ui.sortBy === key
        ? (ui.sortDir === 'asc' ? 'desc' : 'asc')
        : (['score', 'gain', 'vorp', 'diff', 'adj', 'gp', 'mpg', 'starts'].includes(key) ? 'desc' : 'asc');
      await saveUi({ sortBy: key, sortDir });
      render(lastState);
    }));
    panel.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', () => handlers.onToggleDrafted?.(b.dataset.toggle)));
    panel.querySelectorAll('.body .name[data-name]').forEach((n) => n.addEventListener('click', () => handlers.onPlayerClick?.(n.dataset.name)));
  }

  function enableDrag(panel, handle) {
    handle.addEventListener('mousedown', (event) => {
      if (event.target.closest('.iconbtn')) return;
      const sx = event.clientX;
      const sy = event.clientY;
      const ox = parseInt(panel.style.left, 10) || 0;
      const oy = parseInt(panel.style.top, 10) || 0;
      event.preventDefault();
      const move = (e) => {
        panel.style.left = `${ox + e.clientX - sx}px`;
        panel.style.top = `${oy + e.clientY - sy}px`;
      };
      const up = () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        saveUi({ x: parseInt(panel.style.left, 10), y: parseInt(panel.style.top, 10) });
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
  }

  function esc(text) {
    return String(text == null ? '' : text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function unmount() {
    document.getElementById(HOST_ID)?.remove();
    shadow = null;
  }

  YDR.nbaPanel = { mount, render, unmount };
})(globalThis.YDR);
