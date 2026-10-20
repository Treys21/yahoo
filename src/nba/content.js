// NBA draft room orchestrator: pick frames in, projections linked to Yahoo
// player ids, recommendations re-run after every pick, and (if you turn it
// on) your Yahoo queue kept equal to the top recommendations.
//
// Runs at document_start so the frame listener exists before Yahoo's client
// opens its websocket; the UI waits for the DOM.
(function (YDR) {
  'use strict';

  const log = (...args) => console.info('[YDR nba]', ...args);
  const warn = (...args) => console.warn('[YDR nba]', ...args);
  const BUNDLED = 'nba/2026-27-NBA-Roto-Values.xlsx';
  // Bump when the bundled workbook changes, so a stored copy of an older one is replaced.
  const BUNDLE_VERSION = 2;

  const route = YDR.yahoo.parseDraftRoute(location.href);
  if (!route || route.game !== 'nba') return;
  log('draft room', route);

  const draft = YDR.protocol.createState();
  const boardState = YDR.nbaBoard.createBoard();
  let board = null;
  let overrides = {};
  let scoringByDraft = {}; // draftId -> 'roto' | 'h2h', so each league keeps its own format
  let manual = new Set();
  let links = new Map();
  let yahooById = new Map();
  let unmatched = 0;
  let loadError = null;
  let identity = null; // { leagueId, managerId } once the client has joined
  let syncEnabled = false;
  let lastSent = null; // queue ids we last asked Yahoo for
  let ready = false;
  let renderQueued = false;

  // ------------------------------------------------------------- frames

  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data) return;
    const msg = event.data;
    if (msg.__ydr === 'frame' && typeof msg.data === 'string') {
      if (YDR.protocol.apply(draft, msg.data)) queueRender();
    } else if (msg.__ydr === 'replay' && Array.isArray(msg.frames)) {
      Object.assign(draft, YDR.protocol.createState());
      for (const frame of msg.frames) if (typeof frame === 'string') YDR.protocol.apply(draft, frame);
      log('replayed', msg.frames.length, 'frames,', draft.picks.size, 'picks');
      queueRender();
    } else if (msg.__ydr === 'identity' && msg.identity) {
      identity = msg.identity;
      queueRender();
    } else if (msg.__ydr === 'set-queue-result' && !msg.ok) {
      warn('queue update was not sent');
      lastSent = null;
    }
  });
  window.postMessage({ __ydr: 'replay-request' }, location.origin);

  // --------------------------------------------------------------- data

  async function bundledBoard() {
    const response = await fetch(chrome.runtime.getURL(BUNDLED));
    const parsed = await YDR.nbaWorkbook.importWorkbook(await response.arrayBuffer());
    const saved = { ...parsed, fileName: BUNDLED.split('/').pop(), bundled: true, bundleVersion: BUNDLE_VERSION, importedAt: Date.now() };
    await YDR.storage.set({ nbaBoard: saved });
    return saved;
  }

  async function loadBoard() {
    board = await YDR.storage.get('nbaBoard', null);
    if (!board || (board.bundled && board.bundleVersion !== BUNDLE_VERSION)) {
      try {
        board = await bundledBoard();
      } catch (error) {
        loadError = 'could not load the bundled projections';
        warn(loadError, error);
        return;
      }
    }
    overrides = await YDR.storage.get('nbaOptions', {});
    scoringByDraft = await YDR.storage.get('nbaScoringByDraft', {});
    manual = new Set((await YDR.storage.get('nbaOverrides', {}))[route.draftId] || []);
    // Per draft: queue sync is opted into for one draft room at a time and starts off everywhere else.
    syncEnabled = Boolean((await YDR.storage.get('nbaQueueSyncByDraft', {}))[route.draftId]);

    let yahooPlayers = [];
    try {
      yahooPlayers = await YDR.yahoo.getPlayers(route);
    } catch (error) {
      loadError = 'could not load Yahoo players';
      warn(loadError, error);
    }
    yahooById = new Map(yahooPlayers.map((p) => [p.id, p]));
    const linked = YDR.yahoo.linkRankings(board.players, yahooPlayers);
    links = linked.links;
    unmatched = yahooPlayers.length ? linked.unmatched.length : 0;
    log('projections', board.players.length, '| linked', linked.byYahooId.size, '| unmatched', unmatched);
    if (unmatched) log('unmatched:', linked.unmatched.map((p) => `${p.name} ${p.team}`).join('; '));
  }

  // ------------------------------------------------------------- render

  function queueRender() {
    if (!ready || renderQueued) return;
    renderQueued = true;
    setTimeout(() => {
      renderQueued = false;
      render();
    }, 50);
  }

  function draftContext() {
    const order = YDR.protocol.draftOrder(draft);
    const teams = order.length || board.settings.teams;
    const currentPick = draft.onClock?.pickNo || draft.picks.size + 1;
    const myTurn = Boolean(draft.onClock && draft.onClock.teamId === route.teamId && !draft.over);
    // Before the draft starts there is no order yet: your slot is your round-one pick, so assume slot order.
    const assumed = order.length ? null : Array.from({ length: teams }, (_, i) => i + 1);
    const myPick = myTurn ? currentPick : YDR.protocol.nextPickFor(draft, route.teamId, currentPick, teams, assumed);
    const followingPick = myPick ? YDR.protocol.nextPickFor(draft, route.teamId, myPick + 1, teams, assumed) : null;
    return {
      links, yahooById, manual,
      picks: draft.picks.values(),
      myTeamId: route.teamId,
      teamIds: order.length ? order : null,
      teams, currentPick, myPick, followingPick, myTurn
    };
  }

  function sameIds(a, b) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]);
  }

  // Send only when the queue Yahoo has (or we last sent) differs from the recommendation.
  function syncQueue(ids, myOpen) {
    if (!syncEnabled || !identity || draft.over || myOpen === 0 || !ids.length) return;
    if (sameIds(draft.queue, ids) || sameIds(lastSent, ids)) return;
    lastSent = ids;
    window.postMessage({ __ydr: 'set-queue', ids }, location.origin);
  }

  function render() {
    // The extension was reloaded under this tab: this copy can't save or load
    // anything any more, so take the panel down (the reloaded page brings a fresh one).
    if (!YDR.storage.alive()) {
      YDR.nbaPanel.unmount();
      return;
    }
    YDR.nbaPanel.mount();
    if (!board) {
      YDR.nbaPanel.render({ status: 'no-board', message: loadError || '', statusKind: 'err', rows: [],
        emptyMessage: 'No projections loaded. Open the extension popup → NBA board to import your workbook.' });
      return;
    }
    const ctx = draftContext();
    const built = boardState.build(board, effectiveOverrides(), ctx);
    syncQueue(built.queueYahooIds, built.rec.myOpen);

    let picksAway = null;
    if (!ctx.myTurn && ctx.myPick && draft.onClock) picksAway = ctx.myPick - ctx.currentPick;
    const round = ctx.teams ? `rd ${Math.ceil(ctx.currentPick / ctx.teams)} · ` : '';
    const message = loadError || (draft.over ? `complete · ${draft.picks.size} picks`
      : draft.onClock ? `${round}pick ${ctx.currentPick}` : draft.picks.size ? `${draft.picks.size} picks` : 'waiting for draft');

    YDR.nbaPanel.render({
      status: 'ok',
      message,
      statusKind: loadError ? 'err' : '',
      rows: built.rows,
      rec: built.rec,
      options: built.opts,
      poolSize: built.valued.poolSize,
      changed: Object.keys(overrides).length > 0,
      myTurn: ctx.myTurn,
      picksAway,
      myPick: ctx.myPick,
      followingPick: ctx.followingPick,
      unmatched,
      sync: {
        enabled: syncEnabled,
        ready: Boolean(identity),
        inSync: sameIds(draft.queue ?? lastSent, built.queueYahooIds)
      }
    });
  }

  // ------------------------------------------------------------ actions

  // This room's own scoring format wins over the global setting.
  function effectiveOverrides() {
    const scoring = scoringByDraft[route.draftId];
    return scoring ? Object.assign({}, overrides, { scoring }) : overrides;
  }

  async function saveOverrides(next) {
    overrides = next;
    await YDR.storage.set({ nbaOptions: overrides });
    render();
  }

  async function toggleDrafted(name) {
    if (manual.has(name)) manual.delete(name);
    else manual.add(name);
    const all = await YDR.storage.get('nbaOverrides', {});
    all[route.draftId] = [...manual];
    await YDR.storage.set({ nbaOverrides: all });
    render();
  }

  // Put the player's last name into Yahoo's search box (React-controlled input).
  function searchInYahoo(name) {
    const input = document.querySelector('input[placeholder^="Search" i]');
    if (!input) return;
    const last = String(name).split(' ').slice(1).join(' ') || name;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, last);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
  }

  async function start() {
    await YDR.nbaPanel.mount({
      onToggleDrafted: toggleDrafted,
      onPlayerClick: searchInYahoo,
      onOptionChange: async (patch) => {
        if (patch && 'scoring' in patch) {
          scoringByDraft = Object.assign({}, scoringByDraft, { [route.draftId]: patch.scoring });
          await YDR.storage.set({ nbaScoringByDraft: scoringByDraft });
          const rest = Object.assign({}, patch);
          delete rest.scoring;
          if (!Object.keys(rest).length) return render();
          return saveOverrides(YDR.nbaBoard.mergeOverrides(board, overrides, rest));
        }
        return saveOverrides(YDR.nbaBoard.mergeOverrides(board, overrides, patch));
      },
      onToggleCategory: (cat) => saveOverrides(YDR.nbaBoard.toggleCategory(board, overrides, cat)),
      onSyncChange: async (enabled) => {
        syncEnabled = enabled;
        lastSent = null;
        const all = await YDR.storage.get('nbaQueueSyncByDraft', {});
        all[route.draftId] = enabled;
        await YDR.storage.set({ nbaQueueSyncByDraft: all });
        render();
      }
    });
    YDR.nbaPanel.render({ status: 'loading', message: '', rows: [] });
    try {
      await loadBoard();
    } catch (error) {
      warn('could not load board', error);
    }
    ready = true;
    render();
  }

  // A re-import or a settings change on the board page shows up without a reload.
  YDR.storage.onChanged(async (changes) => {
    if (changes.nbaBoard) {
      await loadBoard();
      render();
    } else if (changes.nbaOptions) {
      overrides = changes.nbaOptions.newValue || {};
      render();
    }
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})(globalThis.YDR);
