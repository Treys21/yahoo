// The floating big board. Rendered into a shadow root so Yahoo's CSS can't
// bleed in and ours can't leak out. This panel is the source of truth for the
// overlay — the inline badges are decoration on top of it.
globalThis.YDR = globalThis.YDR || {};

(function (YDR) {
  'use strict';

  const HOST_ID = 'ydr-panel-host';
  const POSITIONS = ['ALL', 'C', 'LW', 'RW', 'F', 'D', 'G'];
  const FORWARDS = ['C', 'LW', 'RW'];
  const ROSTER_POSITIONS = ['C', 'LW', 'RW', 'D', 'G'];

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .panel {
      position: fixed; width: 600px; height: auto; max-width: calc(100vw - 16px); max-height: 82vh;
      min-width: 340px; min-height: 160px; display: flex; flex-direction: column;
      /* drag the bottom-right corner to resize; the size is remembered */
      resize: both;
      font: 12px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #16181d; color: #e8eaed; border: 1px solid #2c3038; border-radius: 12px;
      box-shadow: 0 12px 40px rgba(0,0,0,.5); z-index: 2147483647; overflow: hidden;
    }
    .panel.inline {
      position: static; width: 100%; max-width: none; max-height: none; box-shadow: none; border-radius: 10px;
      resize: none; min-width: 0;
    }
    .panel.inline header { cursor: default; }
    .panel.inline .body { max-height: var(--ydr-body-height, 360px); }
    .panel.collapsed .body, .panel.collapsed .controls, .panel.collapsed .strip,
    .panel.collapsed .needs, .panel.collapsed .warnbar,
    .panel.collapsed .valuation, .panel.collapsed .vsum { display: none; }
    header {
      display: flex; align-items: center; gap: 8px; padding: 9px 12px;
      background: #1d2027; border-bottom: 1px solid #2c3038; cursor: move; user-select: none;
    }
    .title { font-weight: 600; font-size: 13px; flex: 1; }
    .status { font-size: 11px; color: #9aa0a6; }
    .status.warn { color: #f0b429; }
    .status.err { color: #f28b82; }
    .iconbtn {
      background: none; border: none; color: #9aa0a6; cursor: pointer;
      font-size: 15px; padding: 2px 6px; border-radius: 5px;
    }
    .iconbtn:hover { background: #2c3038; color: #e8eaed; }
    .turn { padding: 6px 12px; background: #146c43; color: #fff; font-weight: 700; text-align: center; }
    .soon { padding: 5px 12px; background: rgba(240,180,41,.12); color: #f0b429; font-weight: 600; text-align: center; }
    .needs, .strip {
      display: flex; flex-wrap: wrap; gap: 4px 10px; padding: 6px 12px;
      border-bottom: 1px solid #2c3038; font-size: 11px; color: #9aa0a6;
    }
    .needs b { color: #e8eaed; font-weight: 600; }
    .needs .full b { color: #4ade80; }
    .strip span { white-space: nowrap; }
    .strip b { color: #c9cdd4; font-weight: 600; }
    .controls {
      display: flex; align-items: center; gap: 5px; flex-wrap: wrap;
      padding: 7px 12px; border-bottom: 1px solid #2c3038;
    }
    .chip {
      background: #24272f; border: 1px solid #333842; color: #c9cdd4;
      padding: 2px 9px; border-radius: 999px; font-size: 11px; cursor: pointer;
    }
    .chip.active { background: #7e1fff; border-color: #7e1fff; color: #fff; }
    input.search {
      flex: 1; min-width: 90px; background: #1d2027; border: 1px solid #2c3038; color: #e8eaed;
      border-radius: 6px; padding: 3px 7px; font-size: 11px;
    }
    label.toggle { display: flex; align-items: center; gap: 4px; font-size: 11px; color: #9aa0a6; cursor: pointer; }
    .body { overflow: auto; flex: 1; min-height: 0; }
    /* once resized by hand, the saved size wins over the default caps */
    .panel.sized { max-height: calc(100vh - 8px); }
    table { width: 100%; border-collapse: collapse; }
    th {
      position: sticky; top: 0; background: #1d2027; text-align: right; font-size: 10.5px;
      color: #9aa0a6; font-weight: 600; padding: 6px 6px; cursor: pointer;
      border-bottom: 1px solid #2c3038; white-space: nowrap; z-index: 1;
    }
    th.l, td.l { text-align: left; }
    th:hover { color: #e8eaed; }
    td { padding: 5px 6px; border-bottom: 1px solid #22252c; white-space: nowrap; text-align: right; }
    tr.drafted { opacity: .4; }
    tr.drafted .name { text-decoration: line-through; }
    tr.mine { background: rgba(126,31,255,.18); opacity: .75; }
    tr.unmatched .name { color: #f0b429; }
    .name { font-weight: 500; cursor: pointer; }
    .name:hover { text-decoration: underline; }
    .meta { color: #9aa0a6; font-size: 10.5px; }
    /* ADP diff tiers, same thresholds as the sheet's conditional formatting */
    .steal { color: #6cc4f0; font-weight: 700; }
    .psteal { color: #6cc4f0; }
    .preach { color: #f28b82; }
    .reach { color: #f28b82; font-weight: 700; }
    .even { color: #6b7079; }
    /* Colour legend markers: blue = good news, red = bad, as in the sheet */
    .mk { font-size: 9px; font-weight: 700; letter-spacing: .02em; margin-left: 3px; }
    .mk.good { color: #6cc4f0; }
    .mk.soft { color: #6cc4f0; opacity: .6; }
    .mk.bad { color: #f28b82; }
    .team-good { color: #6cc4f0; }
    .team-bad { color: #f28b82; }
    .valuation {
      padding: 7px 12px 8px; border-bottom: 1px solid #2c3038; background: #1a1c22;
      display: grid; grid-template-columns: auto 1fr; gap: 5px 10px; align-items: center; font-size: 11px;
    }
    .valuation .lbl { color: #9aa0a6; }
    .seg { display: inline-flex; justify-self: start; border: 1px solid #333842; border-radius: 6px; overflow: hidden; }
    .seg button {
      background: #24272f; border: none; color: #c9cdd4; font-size: 11px; padding: 2px 8px; cursor: pointer;
    }
    .seg button + button { border-left: 1px solid #333842; }
    .seg button.on { background: #7e1fff; color: #fff; }
    .seg button.sheet:not(.on) { color: #e8eaed; text-decoration: underline dotted; }
    .vfoot { grid-column: 1 / -1; display: flex; gap: 8px; align-items: center; color: #9aa0a6; flex-wrap: wrap; }
    .vfoot b { color: #c9cdd4; font-weight: 600; }
    .linkbtn { background: none; border: none; color: #b388ff; cursor: pointer; font-size: 11px; padding: 0; }
    .legend { grid-column: 1 / -1; color: #9aa0a6; line-height: 1.7; }
    .legend > span { white-space: nowrap; margin-right: 10px; }
    .legend .mk { margin: 0 2px 0 0; }
    .vsum { font-size: 10.5px; color: #9aa0a6; padding: 0 12px 6px; }
    .vsum.changed { color: #f0b429; }
    .iconbtn.on { color: #b388ff; }
    .adj-up { color: #4ade80; }
    .adj-down { color: #f28b82; }
    .x {
      background: none; border: none; color: #5f6368; cursor: pointer; font-size: 12px; padding: 0 2px;
    }
    .x:hover { color: #f28b82; }
    tr.drafted .x:hover { color: #4ade80; }
    .empty { padding: 26px 16px; text-align: center; color: #9aa0a6; font-size: 12px; line-height: 1.6; }
    .warnbar { padding: 5px 12px; font-size: 11px; color: #f0b429; background: rgba(240,180,41,.09); }
  `;

  const COLUMNS = [
    { key: 'rank', label: 'Rk' },
    { key: 'name', label: 'Player', left: true },
    { key: 'pos', label: 'Pos', left: true },
    { key: 'posRank', label: 'PRk' },
    { key: 'vorp', label: 'VORP' },
    { key: 'adp', label: 'ADP' },
    { key: 'diff', label: 'Diff' },
    { key: 'boost', label: 'Adj', left: true },
    { key: 'status', label: '' }
  ];

  let shadow = null;
  let ui = null;
  let lastState = { status: 'loading', rows: [] };
  let handlers = {};
  // Inline = rendered inside a given element (the popup) instead of floating
  // over the page: no dragging, no collapsing, fills its container.
  let inline = false;

  async function mount(callbacks, options = {}) {
    if (callbacks) handlers = callbacks;
    if (options.container) {
      if (shadow) return;
      inline = true;
      ui = ui || (await YDR.storage.getUi());
      shadow = options.container.attachShadow({ mode: 'open' });
    } else {
      if (inline || document.getElementById(HOST_ID)) return;
      if (!document.body) return;
      ui = ui || (await YDR.storage.getUi());
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

  // Apply the saved size, and save it whenever the user drags the resize corner.
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
        first = false; // the initial observation isn't a user resize
        return;
      }
      clearTimeout(timer);
      timer = setTimeout(() => {
        const w = Math.round(panel.offsetWidth);
        const h = Math.round(panel.offsetHeight);
        // Collapsing shrinks the panel too; only remember real resizes.
        if (ui.collapsed || (w === ui.w && h === ui.h)) return;
        // Content re-renders change height on their own while unsized; only an
        // explicit height (set by the resize handle) counts.
        if (!panel.style.height) return;
        ui.w = w;
        ui.h = h;
        panel.classList.add('sized');
        YDR.storage.saveUi({ w, h });
      }, 250);
    }).observe(panel);
  }

  function positionPanel(panel) {
    if (inline) return;
    // Collapsed: drop the fixed height so the header doesn't float in a big empty box.
    if (ui.collapsed) {
      panel.style.height = '';
    } else if (ui.w && ui.h && !panel.style.height) {
      panel.style.width = `${ui.w}px`;
      panel.style.height = `${ui.h}px`;
    }
    const x = ui.x === null ? 16 : ui.x;
    const y = ui.y === null ? 140 : ui.y;
    panel.style.left = `${clamp(x, 0, window.innerWidth - 120)}px`;
    panel.style.top = `${clamp(y, 0, window.innerHeight - 60)}px`;
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), Math.max(min, max));
  }

  /**
   * state: { status, message, statusKind, rows, myTurn, picksAway, needs, starters, unmatched }
   * row:   { key, rank, name, team, positions, posRank, vorp, adp, diff, boost, stats,
   *          pickNo, byMe, manual, matched }
   */
  function render(state) {
    lastState = state;
    if (!shadow) return;

    const panel = shadow.querySelector('.panel');
    panel.classList.toggle('collapsed', !inline && ui.collapsed);

    // Don't rebuild while the user is typing in the search box — it would drop focus.
    const active = shadow.activeElement;
    const typing = active && active.classList && active.classList.contains('search');

    const rows = state.rows || [];
    const visible = sortRows(filterRows(rows));

    const body = `
      ${state.myTurn ? '<div class="turn">YOU ARE ON THE CLOCK</div>' : ''}
      ${!state.myTurn && state.picksAway > 0 && state.picksAway <= 3
        ? `<div class="soon">You're up in ${state.picksAway} pick${state.picksAway === 1 ? '' : 's'}</div>`
        : ''}
      ${renderNeeds(state)}
      ${renderStrip(rows)}
      <div class="controls">
        ${POSITIONS.map(
          (p) => `<button class="chip ${ui.position === p ? 'active' : ''}" data-pos="${p}">${p}</button>`
        ).join('')}
        <input class="search" type="text" placeholder="search" value="${escapeHtml(ui.search)}" spellcheck="false" />
        <label class="toggle">
          <input type="checkbox" data-act="hide-drafted" ${ui.hideDrafted ? 'checked' : ''}/>
          hide drafted
        </label>
      </div>
      ${state.unmatched > 0
        ? `<div class="warnbar">${state.unmatched} ranked player${state.unmatched === 1 ? '' : 's'} not found in Yahoo's player pool (shown in yellow) — use ✕ to mark them drafted by hand.</div>`
        : ''}
      <div class="body">${renderTable(visible, state)}</div>
    `;

    if (typing) {
      // Only refresh the table and header text; leave the controls (and focus) alone.
      panel.querySelector('.status').textContent = state.message || '';
      panel.querySelector('.body').innerHTML = renderTable(visible, state);
      wireTable(panel);
      return;
    }

    const scrollTop = panel.querySelector('.body')?.scrollTop || 0;
    panel.innerHTML = `
      <header>
        <span class="title">My Board</span>
        <span class="status ${state.statusKind || ''}">${escapeHtml(state.message || '')}</span>
        <button class="iconbtn ${ui.showValuation ? 'on' : ''}" data-act="valuation" title="Projected GP, replacement level, boosts…" style="font-size:11px">⚙ Settings</button>
        ${inline ? '' : `<button class="iconbtn" data-act="collapse" title="Collapse">${ui.collapsed ? '▢' : '—'}</button>`}
      </header>
      ${renderValuation(state)}
      ${body}
    `;
    const scroller = panel.querySelector('.body');
    if (scroller) scroller.scrollTop = scrollTop;

    positionPanel(panel);
    wire(panel);
  }

  const VALUATION_CONTROLS = [
    { key: 'gpProjection', label: 'Projected GP', choices: [[true, 'On'], [false, 'Off']] },
    { key: 'replacement', label: 'Replacement', choices: [['Blend', 'Blend'], ['Position', 'Position'], ['Draft', 'Draft']] },
    { key: 'boosts', label: 'Boost / bust', choices: [[true, 'On'], [false, 'Off']] },
    { key: 'forwards', label: 'Forwards', choices: [['C/LW/RW', 'C / LW / RW'], ['Forwards', 'All F']] },
    { key: 'leagueType', label: 'Scoring', choices: [['Categories', 'Categories'], ['Points', 'Points']] },
    { key: 'teams', label: 'Teams', choices: [[8, '8'], [10, '10'], [12, '12'], [14, '14'], [16, '16']] }
  ];

  function changedKeys(v) {
    return VALUATION_CONTROLS.map((c) => c.key).filter((k) => v.options[k] !== v.sheet[k]);
  }

  function renderValuation(state) {
    const v = state.valuation;
    if (!v) return '';
    if (v.unavailable) {
      return ui.showValuation
        ? '<div class="vsum changed">Re-import the workbook from the popup to enable live settings.</div>'
        : '';
    }
    const o = v.options;
    const changed = changedKeys(v);
    const summary = `${o.leagueType} · ${o.teams} teams · ${o.replacement} · GP ${o.gpProjection ? 'on' : 'off'}` +
      `${o.boosts ? '' : ' · no boosts'}${o.forwards === 'Forwards' ? ' · all F' : ''}`;

    if (!ui.showValuation) {
      return `<div class="vsum ${changed.length ? 'changed' : ''}">${escapeHtml(summary)}${changed.length ? ' (changed from sheet)' : ''}</div>`;
    }

    const rows = VALUATION_CONTROLS.map((c) => `
      <span class="lbl">${c.label}</span>
      <span class="seg">${c.choices.map(([value, text]) => `
        <button class="${o[c.key] === value ? 'on' : ''} ${v.sheet[c.key] === value ? 'sheet' : ''}"
          data-val-key="${c.key}" data-val="${escapeHtml(JSON.stringify(value))}"
          title="${v.sheet[c.key] === value ? 'Your sheet\'s setting' : ''}">${text}</button>`).join('')}
      </span>`).join('');

    const levels = v.levels
      ? ['C', 'LW', 'RW', 'D', 'G'].map((p) => `${p} <b>${v.levels[p]}</b>`).join(' · ') +
        (o.forwards === 'Forwards' ? ` · F <b>${v.levels.F}</b>` : '')
      : '';

    return `
      <div class="valuation">
        ${rows}
        <div class="vfoot">
          <span>Replacement player: ${levels}</span>
          ${changed.length ? '<button class="linkbtn" data-act="reset-valuation">Reset to sheet</button>' : ''}
        </div>
        <div class="legend">
          <span><span class="mk good">BRK</span>pre-prime breakout</span>
          <span><span class="mk bad">AGE</span>post-prime decline</span>
          <span><span class="mk good">CY</span>contract year</span>
          <span><span class="mk good">TOI▲</span><span class="mk bad">▼</span>role change</span>
          <span><span class="mk good">PP1</span>&gt;60% / <span class="mk soft">PP1</span>50–60%</span>
          <span><span class="team-good">TEAM</span>/<span class="team-bad">TEAM</span> easy / hard SOS</span>
          <span><span class="steal">+24</span> / <span class="psteal">+10</span> steal · <span class="preach">−10</span> / <span class="reach">−24</span> reach (ADP − Rk)</span>
        </div>
      </div>`;
  }

  // Colour legend markers from the sheet, as compact coloured tags.
  function renderMarkers(m) {
    if (!m) return '';
    const tags = [];
    if (m.age > 0) tags.push('<span class="mk good" title="Pre-prime, chance to breakout">BRK</span>');
    if (m.age < 0) tags.push('<span class="mk bad" title="Post-prime, chance to decline">AGE</span>');
    if (m.contract > 0) tags.push('<span class="mk good" title="Contract year">CY</span>');
    if (m.toi > 0) tags.push('<span class="mk good" title="Role increase (>1 min TOI)">TOI▲</span>');
    if (m.toi < 0) tags.push('<span class="mk bad" title="Role decrease (>1 min TOI)">TOI▼</span>');
    if (m.pp1 > 0) tags.push('<span class="mk good" title="PP1 (>60% of PP TOI)">PP1</span>');
    else if (m.pp1Partial > 0) tags.push('<span class="mk soft" title="PP1 (50–60% of PP TOI)">PP1</span>');
    return tags.join('');
  }

  function teamClass(m) {
    if (!m || !m.sos) return 'meta';
    return m.sos > 0 ? 'meta team-good' : 'meta team-bad';
  }

  function renderNeeds(state) {
    if (!state.starters || !Object.keys(state.starters).length) return '';
    const counts = state.needs || {};
    const parts = ROSTER_POSITIONS.filter((p) => state.starters[p]).map((p) => {
      const have = counts[p] || 0;
      const need = state.starters[p];
      return `<span class="${have >= need ? 'full' : ''}">${p} <b>${have}/${need}</b></span>`;
    });
    return `<div class="needs"><span>My roster:</span>${parts.join('')}</div>`;
  }

  // Best available at each position — the at-a-glance "who's next" view.
  function renderStrip(rows) {
    const available = rows.filter((r) => !r.pickNo && !r.manual).sort((a, b) => a.rank - b.rank);
    if (!available.length) return '';
    const parts = ROSTER_POSITIONS.map((pos) => {
      const best = available.find((r) => r.positions.includes(pos));
      return best ? `<span>${pos}: <b>${escapeHtml(shortName(best.name))}</b> ${best.rank}</span>` : '';
    }).filter(Boolean);
    return `<div class="strip">${parts.join('')}</div>`;
  }

  function shortName(name) {
    const clean = String(name).replace(/\s*\(.*\)\s*/, '');
    const parts = clean.split(' ');
    return parts.length > 1 ? `${parts[0][0]}. ${parts.slice(1).join(' ')}` : clean;
  }

  function renderTable(rows, state) {
    if (state.status === 'no-rankings') {
      return '<div class="empty">No rankings yet.<br/>Open the extension popup and import your projections .xlsx.</div>';
    }
    if (state.status === 'loading') {
      return '<div class="empty">Loading…</div>';
    }
    if (rows.length === 0) {
      return '<div class="empty">Nothing matches the current filter.</div>';
    }

    const head = COLUMNS.map((col) => {
      const arrow = ui.sortBy === col.key ? (ui.sortDir === 'asc' ? ' ▲' : ' ▼') : '';
      return `<th class="${col.left ? 'l' : ''}" data-sort="${col.key}">${col.label}${arrow}</th>`;
    }).join('');

    const body = rows.map((row) => {
      const taken = row.pickNo || row.manual;
      const classes = [
        taken ? 'drafted' : '',
        row.byMe ? 'mine' : '',
        row.matched ? '' : 'unmatched'
      ].filter(Boolean).join(' ');

      const diff = row.diff === null || row.diff === undefined
        ? ''
        : `<span class="${diffClass(row.diff)}" title="ADP ${row.adp} vs your rank ${row.rank}">${row.diff > 0 ? '+' : ''}${row.diff.toFixed(1)}</span>`;
      const boost = row.boost
        ? `<span class="${row.boost.startsWith('+') ? 'adj-up' : 'adj-down'}">${escapeHtml(row.boost)}</span>`
        : '';
      const status = row.pickNo
        ? `<span class="meta" title="Taken at pick ${row.pickNo}">#${row.pickNo}</span>`
        : !handlers.onToggleDrafted
          ? ''
          : `<button class="x" data-toggle="${escapeHtml(row.key)}" title="${row.manual ? 'Mark available' : 'Mark drafted'}">${row.manual ? '↺' : '✕'}</button>`;

      return `
        <tr class="${classes}">
          <td>${row.rank}</td>
          <td class="l"><span class="name" data-name="${escapeHtml(row.name)}" title="${escapeHtml(statLine(row))}">${escapeHtml(row.name)}</span> <span class="${teamClass(row.markers)}" title="${row.markers && row.markers.sos ? (row.markers.sos > 0 ? 'Weak defensive SOS (good for skaters)' : 'Strong defensive SOS (tough for skaters)') : ''}">${escapeHtml(row.team || '')}</span>${renderMarkers(row.markers)}</td>
          <td class="l meta">${escapeHtml(row.positions.join(','))}</td>
          <td class="meta">${row.posRank ?? ''}</td>
          <td>${fmt(row.vorp, 2)}</td>
          <td class="meta">${fmt(row.adp, 1)}</td>
          <td>${diff}</td>
          <td class="l">${boost}</td>
          <td>${status}</td>
        </tr>`;
    }).join('');

    return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
  }

  // Positive diff = the market (ADP) takes him later than your rank. Same
  // tiers as the sheet's DIFF. formatting: 24+ steal, 10–23 potential steal,
  // and the mirror image for reaches.
  function diffClass(diff) {
    if (diff >= 24) return 'steal';
    if (diff >= 10) return 'psteal';
    if (diff <= -24) return 'reach';
    if (diff <= -10) return 'preach';
    return 'even';
  }

  function statLine(row) {
    const s = row.stats || {};
    const parts = row.positions.includes('G')
      ? [`GP ${s.gp ?? '-'}`, `W ${s.w ?? '-'}`, `SO ${s.so ?? '-'}`, `SV% ${s.svPct ?? '-'}`, `GAA ${s.gaa ?? '-'}`]
      : [`GP ${s.gp ?? '-'}`, `G ${s.g ?? '-'}`, `A ${s.a ?? '-'}`, `+/- ${s.pm ?? '-'}`, `PPP ${s.ppp ?? '-'}`, `SOG ${s.sog ?? '-'}`, `HIT ${s.hit ?? '-'}`];
    const age = row.age ? ` · age ${row.age}` : '';
    return `${parts.join('  ')}${age}${handlers.onPlayerClick ? '  — click to search in Yahoo' : ''}`;
  }

  function fmt(value, places) {
    return value === null || value === undefined ? '' : Number(value).toFixed(places);
  }

  function filterRows(rows) {
    const search = YDR.match.normalizeName(ui.search || '');
    return rows.filter((row) => {
      if (ui.hideDrafted && (row.pickNo || row.manual)) return false;
      if (ui.position === 'F') {
        if (!row.positions.some((p) => FORWARDS.includes(p))) return false;
      } else if (ui.position !== 'ALL' && !row.positions.includes(ui.position)) {
        return false;
      }
      if (search && !YDR.match.normalizeName(row.name).includes(search)) return false;
      return true;
    });
  }

  function sortRows(rows) {
    const dir = ui.sortDir === 'asc' ? 1 : -1;
    const key = ui.sortBy;
    const value = (row) => {
      switch (key) {
        case 'pos': return row.positions.join(',');
        case 'status': return row.pickNo || (row.manual ? 9999 : 0);
        case 'boost': return boostValue(row.boost);
        default: return row[key];
      }
    };
    return rows.slice().sort((a, b) => {
      const av = value(a);
      const bv = value(b);
      // Blanks always sink, whichever direction.
      const aBlank = av === null || av === undefined || av === '';
      const bBlank = bv === null || bv === undefined || bv === '';
      if (aBlank || bBlank) return aBlank === bBlank ? a.rank - b.rank : aBlank ? 1 : -1;
      if (typeof av === 'string') return av.localeCompare(bv) * dir || a.rank - b.rank;
      return (av - bv) * dir || a.rank - b.rank;
    });
  }

  function boostValue(boost) {
    if (!boost) return 0;
    return (boost.match(/\+/g) || []).length - (boost.match(/-/g) || []).length;
  }

  function wire(panel) {
    panel.querySelector('[data-act="collapse"]')?.addEventListener('click', async () => {
      ui.collapsed = !ui.collapsed;
      await YDR.storage.saveUi({ collapsed: ui.collapsed });
      render(lastState);
    });

    panel.querySelectorAll('[data-pos]').forEach((chip) => {
      chip.addEventListener('click', async () => {
        ui.position = chip.dataset.pos;
        await YDR.storage.saveUi({ position: ui.position });
        render(lastState);
      });
    });

    panel.querySelector('[data-act="valuation"]').addEventListener('click', async () => {
      ui.showValuation = !ui.showValuation;
      await YDR.storage.saveUi({ showValuation: ui.showValuation });
      render(lastState);
    });

    panel.querySelectorAll('[data-val-key]').forEach((button) => {
      button.addEventListener('click', () => {
        handlers.onValuationChange?.({ [button.dataset.valKey]: JSON.parse(button.dataset.val) });
      });
    });

    panel.querySelector('[data-act="reset-valuation"]')?.addEventListener('click', () => {
      handlers.onValuationChange?.(null);
    });

    const hideDrafted = panel.querySelector('[data-act="hide-drafted"]');
    if (hideDrafted) {
      hideDrafted.addEventListener('change', async () => {
        ui.hideDrafted = hideDrafted.checked;
        await YDR.storage.saveUi({ hideDrafted: ui.hideDrafted });
        render(lastState);
      });
    }

    const search = panel.querySelector('input.search');
    if (search) {
      search.addEventListener('input', () => {
        ui.search = search.value;
        YDR.storage.saveUi({ search: ui.search });
        render(lastState);
      });
      // Keep Yahoo's keyboard shortcuts from firing while typing here.
      search.addEventListener('keydown', (event) => event.stopPropagation());
    }

    wireTable(panel);
    if (!inline) enableDrag(panel, panel.querySelector('header'));
  }

  function wireTable(panel) {
    panel.querySelectorAll('[data-sort]').forEach((th) => {
      th.addEventListener('click', async () => {
        const key = th.dataset.sort;
        if (ui.sortBy === key) {
          ui.sortDir = ui.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          ui.sortBy = key;
          // Bigger-is-better columns start descending.
          ui.sortDir = ['vorp', 'diff', 'boost'].includes(key) ? 'desc' : 'asc';
        }
        await YDR.storage.saveUi({ sortBy: ui.sortBy, sortDir: ui.sortDir });
        render(lastState);
      });
    });

    panel.querySelectorAll('[data-toggle]').forEach((button) => {
      button.addEventListener('click', () => handlers.onToggleDrafted?.(button.dataset.toggle));
    });

    panel.querySelectorAll('.name[data-name]').forEach((name) => {
      name.addEventListener('click', () => handlers.onPlayerClick?.(name.dataset.name));
    });
  }

  function enableDrag(panel, handle) {
    handle.addEventListener('mousedown', (event) => {
      if (event.target.closest('.iconbtn')) return;
      const startX = event.clientX;
      const startY = event.clientY;
      const originX = parseInt(panel.style.left, 10) || 0;
      const originY = parseInt(panel.style.top, 10) || 0;
      event.preventDefault();

      const onMove = (moveEvent) => {
        panel.style.left = `${originX + moveEvent.clientX - startX}px`;
        panel.style.top = `${originY + moveEvent.clientY - startY}px`;
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        ui.x = parseInt(panel.style.left, 10);
        ui.y = parseInt(panel.style.top, 10);
        YDR.storage.saveUi({ x: ui.x, y: ui.y });
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  function escapeHtml(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  YDR.panel = { mount, render, unmount: () => document.getElementById(HOST_ID)?.remove() };
})(globalThis.YDR);
