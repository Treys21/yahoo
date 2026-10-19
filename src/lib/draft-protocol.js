// Decodes the Yahoo draft client's websocket frames into draft state.
//
// Frames are pipe-delimited text; the first field is the message type. The
// type table below mirrors the one in Yahoo's react-draft-client bundle
// (PICK_MADE, PICK_LIST_CHANGED, ...). Only the types that matter for a board
// are handled — chat, grades, scout etc. are ignored.
//
//   0|pickId|playerId|teamId|pos|cost   PICK_MADE
//   P|1=playerId,teamId,cost|2=...      PICK_LIST_CHANGED  (full history, sent on connect)
//   u|pickId|teamId|playerId            PICK_UNDONE
//   K|pickId=playerId|...               KEEPER_LIST_CHANGED
//   D|pickId|teamId|countdown           CURRENT_PICK_CHANGED (who's on the clock)
//   R|teamId|teamId|...                 DRAFT_ORDER_CHANGED (team for every pick, in order)
//   Q|playerId|playerId|...             QUEUE_LIST_CHANGED (your queue, in order)
//   r                                   DRAFT_RESET
//   Y                                   DRAFT_OVER
//
// Pure logic — also loaded by test/draft-protocol.test.js.
globalThis.YDR = globalThis.YDR || {};

(function (YDR) {
  'use strict';

  const SEPARATOR = '|';
  const RELEVANT = new Set(['0', 'P', 'u', 'K', 'D', 'R', 'Q', 'r', 'Y']);

  function int(value) {
    const n = parseInt(value, 10);
    return Number.isFinite(n) ? n : null;
  }

  function createState() {
    return {
      // pickNo -> { pickNo, playerId, teamId, pos, keeper }
      picks: new Map(),
      onClock: null, // { pickNo, teamId, countdown }
      order: [], // team id for every pick in the draft (pick 1 first), from the R frame
      queue: null, // your Yahoo queue (player ids), once the server has sent it
      over: false
    };
  }

  function isRelevant(frame) {
    return typeof frame === 'string' && RELEVANT.has(frame.split(SEPARATOR, 1)[0]);
  }

  /** Applies one frame to state in place. Returns true if anything changed. */
  function apply(state, frame) {
    if (typeof frame !== 'string') return false;
    const f = frame.split(SEPARATOR);

    switch (f[0]) {
      case '0': {
        const pickNo = int(f[1]);
        const playerId = int(f[2]);
        if (pickNo === null || playerId === null) return false;
        state.picks.set(pickNo, { pickNo, playerId, teamId: int(f[3]), pos: f[4] || '', keeper: false });
        return true;
      }
      case 'P': {
        // Full replacement. Unfilled future slots may arrive with no player.
        const keepers = [...state.picks.values()].filter((p) => p.keeper);
        state.picks.clear();
        for (const entry of f.slice(1)) {
          const [id, rest = ''] = entry.split('=');
          const [playerId, teamId] = rest.split(',');
          const pickNo = int(id);
          const pid = int(playerId);
          if (pickNo === null || pid === null) continue;
          state.picks.set(pickNo, { pickNo, playerId: pid, teamId: int(teamId), pos: '', keeper: false });
        }
        for (const k of keepers) if (!state.picks.has(k.pickNo)) state.picks.set(k.pickNo, k);
        return true;
      }
      case 'u': {
        const pickNo = int(f[1]);
        return state.picks.delete(pickNo);
      }
      case 'K': {
        for (const entry of f.slice(1)) {
          const [id, playerId] = entry.split('=');
          const pickNo = int(id);
          const pid = int(playerId);
          if (pickNo === null || pid === null) continue;
          const existing = state.picks.get(pickNo);
          state.picks.set(pickNo, Object.assign({ pickNo, teamId: null, pos: '' }, existing, { playerId: pid, keeper: true }));
        }
        return true;
      }
      case 'D':
        state.onClock = { pickNo: int(f[1]), teamId: int(f[2]), countdown: int(f[3]) };
        return true;
      case 'R':
        state.order = f.slice(1).map(int).filter((n) => n !== null);
        return true;
      case 'Q':
        state.queue = f.slice(1).map(int).filter((n) => n !== null);
        return true;
      case 'r':
        Object.assign(state, createState());
        return true;
      case 'Y':
        state.over = true;
        state.onClock = null;
        return true;
      default:
        return false;
    }
  }

  // Round-one order: the first appearance of each team in the R frame, or
  // inferred from the first round of picks (exact for a snake draft once round
  // one is complete).
  function draftOrder(state) {
    if (state.order.length) return [...new Set(state.order)];
    const order = [];
    for (let pickNo = 1; state.picks.has(pickNo); pickNo++) {
      const teamId = state.picks.get(pickNo).teamId;
      if (order.includes(teamId)) break;
      order.push(teamId);
    }
    return order;
  }

  function teamForPick(order, pickNo) {
    const n = order.length;
    if (!n) return null;
    const round = Math.ceil(pickNo / n);
    const index = (pickNo - 1) % n;
    return order[round % 2 === 1 ? index : n - 1 - index];
  }

  /** Next pick number >= fromPick that belongs to teamId, or null. */
  function nextPickFor(state, teamId, fromPick, teams) {
    // The R frame lists the team for every pick, so read it straight off.
    if (state.order.length > teams) {
      for (let p = fromPick; p <= state.order.length; p++) if (state.order[p - 1] === teamId) return p;
      return null;
    }
    const order = draftOrder(state);
    if (!teams || order.length !== teams || !order.includes(teamId)) return null;
    for (let p = fromPick; p < fromPick + teams * 2; p++) {
      if (teamForPick(order, p) === teamId) return p;
    }
    return null;
  }

  const api = { createState, apply, isRelevant, draftOrder, teamForPick, nextPickFor };
  YDR.protocol = api;

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis.YDR);
