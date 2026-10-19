// Turns the imported board + current valuation settings (+ live draft state,
// when there is one) into the rows the panel renders. Shared by the draft-room
// content script and the popup, so both always show the same board.
globalThis.YDR = globalThis.YDR || {};

(function (YDR) {
  'use strict';

  // The workbook's own Settings.
  function sheetOptions(board) {
    const s = (board && board.settings) || {};
    return {
      leagueType: s.leagueType || 'Categories',
      gpProjection: s.gpProjection !== false,
      replacement: s.replacement || 'Blend',
      boosts: s.boosts !== false,
      forwards: s.forwards || 'C/LW/RW',
      teams: s.teams || 12
    };
  }

  // Settings with anything changed on the board on top.
  function valuationOptions(board, overrides) {
    return Object.assign(sheetOptions(board), overrides || {});
  }

  // Keep only the overrides that differ from the sheet, so "reset" is meaningful.
  function mergeOverrides(board, current, patch) {
    if (patch === null) return {};
    const next = Object.assign({}, current, patch);
    const sheet = sheetOptions(board);
    for (const key of Object.keys(next)) if (next[key] === sheet[key]) delete next[key];
    return next;
  }

  /** { byName, levels } from valuation.js, or null to fall back to the sheet's saved ranks. */
  function revalue(board, overrides) {
    if (!board || !board.model) return null;
    try {
      return YDR.valuation.valuate(board.model, valuationOptions(board, overrides));
    } catch (error) {
      console.warn('[YDR] valuation failed; showing the sheet\'s saved ranks', error);
      return null;
    }
  }

  function round(value, places) {
    if (value === null || value === undefined || !Number.isFinite(value)) return null;
    const f = 10 ** places;
    return Math.round(value * f) / f;
  }

  function roundStats(stats) {
    const out = {};
    for (const [key, value] of Object.entries(stats)) {
      out[key] = key === 'svPct' ? round(value, 3) : key === 'gaa' ? round(value, 2) : key === 'so' ? round(value, 1) : round(value, 0);
    }
    return out;
  }

  /**
   * @param ctx { links?: Map<ranking, yahooPlayer>, picks?: Iterable<pick>, myTeamId?, manual?: Set<name> }
   */
  function buildRows(board, valued, ctx = {}) {
    const links = ctx.links || new Map();
    const manual = ctx.manual || new Set();
    const pickByYahooId = new Map();
    for (const pick of ctx.picks || []) pickByYahooId.set(pick.playerId, pick);

    return board.players.map((ranking) => {
      const yahoo = links.get(ranking);
      const pick = yahoo ? pickByYahooId.get(yahoo.id) : null;
      const v = valued && valued.byName.get(ranking.name);
      const rank = v && v.rank !== null ? v.rank : ranking.rank;
      return {
        key: ranking.name,
        rank,
        name: ranking.name,
        team: yahoo ? yahoo.team : ranking.team,
        // Yahoo's eligibility is what counts in the draft room; the sheet's is a fallback.
        positions: yahoo && yahoo.positions.length ? yahoo.positions : ranking.positions,
        posRank: v ? v.posRank : ranking.posRank,
        vorp: v ? round(v.vorp, 2) : ranking.vorp,
        adp: ranking.adp,
        // DIFF. in the sheet is ADP − RK, so it moves with the rank.
        diff: ranking.adp !== null ? round(ranking.adp - rank, 1) : null,
        boost: ranking.boost,
        markers: ranking.markers || {},
        age: ranking.age,
        stats: v ? roundStats(v.stats) : ranking.stats,
        yahooId: yahoo ? yahoo.id : null,
        matched: ctx.links ? Boolean(yahoo) : true,
        pickNo: pick ? pick.pickNo : null,
        byMe: Boolean(pick && ctx.myTeamId !== undefined && pick.teamId === ctx.myTeamId),
        manual: !pick && manual.has(ranking.name)
      };
    });
  }

  /** The `valuation` block the panel's ⚙ drawer renders. */
  function valuationState(board, overrides, valued) {
    if (!board || !board.model) return { unavailable: true };
    return {
      options: valuationOptions(board, overrides),
      sheet: sheetOptions(board),
      levels: valued ? valued.levels : null
    };
  }

  const api = { sheetOptions, valuationOptions, mergeOverrides, revalue, buildRows, valuationState };
  YDR.boardRows = api;

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis.YDR);
