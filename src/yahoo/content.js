// Orchestrator for the Yahoo draft room: receive pick frames from the page,
// link your rankings to Yahoo player ids, and keep the board current.
//
// Runs at document_start so the frame listener exists before Yahoo's client
// opens its websocket; the UI waits for the DOM.
(function (YDR) {
  'use strict';

  const log = (...args) => console.info('[YDR]', ...args);
  const warn = (...args) => console.warn('[YDR]', ...args);

  const route = YDR.yahoo.parseDraftRoute(location.href);
  if (!route) return;
  log('draft room', route);

  const draft = YDR.protocol.createState();
  let board = null; // { players, settings }
  let byYahooId = new Map();
  let links = new Map();
  let unmatchedCount = 0;
  let overrides = new Set();
  let valuationOverrides = {};
  let valued = null; // { byName, levels } from valuation.js, or null to use the sheet's saved ranks
  let ready = false;
  let renderQueued = false;
  let loadError = null;

  // ------------------------------------------------------------- frames

  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data) return;
    const msg = event.data;
    if (msg.__ydr === 'frame' && typeof msg.data === 'string') {
      if (YDR.protocol.apply(draft, msg.data)) queueRender();
    } else if (msg.__ydr === 'replay' && Array.isArray(msg.frames)) {
      // Rebuild from the hook's full buffer — covers frames sent before we listened.
      Object.assign(draft, YDR.protocol.createState());
      for (const frame of msg.frames) if (typeof frame === 'string') YDR.protocol.apply(draft, frame);
      log('replayed', msg.frames.length, 'frames,', draft.picks.size, 'picks');
      queueRender();
    }
  });
  window.postMessage({ __ydr: 'replay-request' }, location.origin);

  // --------------------------------------------------------------- data

  async function loadBoard() {
    board = await YDR.storage.getBoard();
    overrides = await YDR.storage.getOverrides(route.draftId);
    valuationOverrides = await YDR.storage.getValuation();
    if (!board) return;
    valued = YDR.boardRows.revalue(board, valuationOverrides);

    let yahooPlayers = [];
    try {
      yahooPlayers = await YDR.yahoo.getPlayers(route);
    } catch (error) {
      loadError = 'could not load Yahoo players';
      warn(loadError, error);
    }
    const linked = YDR.yahoo.linkRankings(board.players, yahooPlayers);
    links = linked.links;
    byYahooId = linked.byYahooId;
    unmatchedCount = yahooPlayers.length ? linked.unmatched.length : 0;
    log('rankings', board.players.length, '| linked', byYahooId.size, '| unmatched', unmatchedCount);
    if (linked.unmatched.length && yahooPlayers.length) {
      log('unmatched:', linked.unmatched.map((r) => `${r.rank} ${r.name} ${r.team}`).join('; '));
    }
  }

  function buildRows() {
    return YDR.boardRows.buildRows(board, valued, {
      links,
      picks: draft.picks.values(),
      myTeamId: route.teamId,
      manual: overrides
    });
  }

  // Roster fill by the slot Yahoo reports for each of my picks (falls back to
  // the player's first eligible position for picks restored from history).
  function rosterNeeds() {
    const counts = {};
    for (const pick of draft.picks.values()) {
      if (pick.teamId !== route.teamId) continue;
      const ranking = byYahooId.get(pick.playerId);
      const pos = pick.pos || (ranking && links.get(ranking)?.positions[0]) || '';
      const slot = pos.split(',')[0];
      if (slot) counts[slot] = (counts[slot] || 0) + 1;
    }
    return counts;
  }

  function statusMessage() {
    if (draft.over) return `complete · ${draft.picks.size} picks`;
    const clock = draft.onClock;
    const teams = board?.settings?.teams;
    if (clock && clock.pickNo) {
      const round = teams ? `rd ${Math.ceil(clock.pickNo / teams)} · ` : '';
      return `${round}pick ${clock.pickNo}`;
    }
    return draft.picks.size ? `${draft.picks.size} picks` : 'waiting for draft';
  }

  // --------------------------------------------------------------- render

  function queueRender() {
    if (!ready || renderQueued) return;
    renderQueued = true;
    setTimeout(() => {
      renderQueued = false;
      render();
    }, 50);
  }

  function render() {
    YDR.panel.mount(); // Yahoo may re-render the page; put the host back if needed.

    if (!board) {
      YDR.panel.render({ status: 'no-rankings', message: '', rows: [] });
      return;
    }

    const rows = buildRows();
    const clock = draft.onClock;
    const myTurn = Boolean(clock && clock.teamId === route.teamId && !draft.over);
    const teams = board.settings?.teams || YDR.protocol.draftOrder(draft).length;
    let picksAway = null;
    if (clock && !myTurn && !draft.over) {
      const next = YDR.protocol.nextPickFor(draft, route.teamId, clock.pickNo, teams);
      if (next) picksAway = next - clock.pickNo;
    }

    YDR.panel.render({
      status: 'ok',
      message: loadError || statusMessage(),
      statusKind: loadError ? 'err' : '',
      rows,
      myTurn,
      picksAway,
      teams: board.settings?.teams || 12,
      starters: board.settings?.starters,
      needs: rosterNeeds(),
      unmatched: unmatchedCount,
      valuation: YDR.boardRows.valuationState(board, valuationOverrides, valued)
    });
    YDR.badges.update(rows);
  }

  // ------------------------------------------------------------- actions

  async function toggleDrafted(name) {
    if (overrides.has(name)) overrides.delete(name);
    else overrides.add(name);
    await YDR.storage.saveOverrides(route.draftId, overrides);
    render();
  }

  async function changeValuation(patch) {
    valuationOverrides = YDR.boardRows.mergeOverrides(board, valuationOverrides, patch);
    await YDR.storage.saveValuation(valuationOverrides);
    valued = YDR.boardRows.revalue(board, valuationOverrides);
    render();
  }

  // Put the player's last name into Yahoo's own search box so drafting him is
  // one more click. Yahoo's input is React-controlled, so set the value through
  // the native setter and fire an input event.
  function searchInYahoo(name) {
    const input = document.querySelector('input[placeholder^="Search" i]');
    if (!input) return;
    const clean = String(name).replace(/\s*\(.*\)\s*/, '');
    const last = clean.split(' ').slice(1).join(' ') || clean;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, last);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
  }

  // ---------------------------------------------------------------- boot

  async function start() {
    await YDR.panel.mount({
      onToggleDrafted: toggleDrafted,
      onPlayerClick: searchInYahoo,
      onValuationChange: changeValuation
    });
    YDR.panel.render({ status: 'loading', message: '', rows: [] });
    try {
      await loadBoard();
    } catch (error) {
      warn('could not load board', error);
    }
    ready = true;
    render();
  }

  // Re-imports and settings changed in the popup show up without a reload.
  YDR.storage.onChanged(async (changes) => {
    if (changes.board) {
      await loadBoard();
      render();
    } else if (changes.valuation && board) {
      valuationOverrides = changes.valuation.newValue || {};
      valued = YDR.boardRows.revalue(board, valuationOverrides);
      render();
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})(globalThis.YDR);
