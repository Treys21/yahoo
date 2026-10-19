// Board state for the NBA panel: imported projections + your setting changes
// + the live draft → valuation, recommendations and the rows the panel shows.
// Shared by the draft-room content script and the pre-draft board page.
globalThis.YDR = globalThis.YDR || {};

(function (YDR) {
  'use strict';

  const ZERO_Z = Object.fromEntries(YDR.nbaModel.CATEGORIES.map((c) => [c, 0]));

  /** Workbook settings with your changes (category weights, GP mode, boosts) on top. */
  function options(board, overrides, teams) {
    const s = board.settings;
    const o = overrides || {};
    return {
      weights: Object.assign({}, s.weights, o.weights),
      slots: s.slots,
      boostTable: s.boostTable,
      flatGp: s.flatGp,
      gpProjection: o.gpProjection ?? s.gpProjection,
      boosts: o.boosts ?? s.boosts,
      scoring: o.scoring ?? s.scoring ?? 'roto',
      teams: teams || s.teams
    };
  }

  /** Keep only overrides that differ from the workbook, so "reset" means something. */
  function mergeOverrides(board, current, patch) {
    if (patch === null) return {};
    const next = Object.assign({}, current, patch);
    if (patch.weights) next.weights = Object.assign({}, current.weights, patch.weights);
    const s = board.settings;
    if (next.weights) {
      for (const [c, w] of Object.entries(next.weights)) if (w === s.weights[c]) delete next.weights[c];
      if (!Object.keys(next.weights).length) delete next.weights;
    }
    for (const key of ['gpProjection', 'boosts']) if (next[key] === s[key]) delete next[key];
    if (next.scoring === (s.scoring ?? 'roto')) delete next.scoring;
    return next;
  }

  /** Category toggle: on → off, off (or a partial weight) → on. */
  function toggleCategory(board, overrides, cat) {
    const current = options(board, overrides).weights[cat];
    return mergeOverrides(board, overrides, { weights: { [cat]: current === 1 ? 0 : 1 } });
  }

  function createBoard() {
    let memo = { key: null, valued: null };
    let seasonFor = { schedule: null, season: null };

    function season(board) {
      if (seasonFor.schedule !== board.schedule) {
        const byTeam = YDR.nbaModel.teamDates(board.schedule);
        const days = [...new Set((board.schedule || []).map(([d]) => d))].sort((a, b) => a - b);
        seasonFor = { schedule: board.schedule, season: { byTeam, days } };
      }
      return seasonFor.season;
    }

    function valuate(board, opts) {
      const key = JSON.stringify(opts);
      if (memo.key !== key) memo = { key, valued: YDR.nbaModel.valuate(board.players, opts, board.schedule) };
      return memo.valued;
    }

    /**
     * @param ctx { links?: Map<boardPlayer, yahooPlayer>, yahooById?: Map<id, yahooPlayer>, picks?: Iterable,
     *              manual?: Set<name>, mine?: Set<name>, myTeamId?, teamIds?, currentPick?, myPick?, followingPick?, teams? }
     *   manual — taken by someone else (marked by hand); mine — on your team (offline practice)
     */
    function build(board, overrides, ctx = {}) {
      const links = ctx.links || new Map();
      const manual = ctx.manual || new Set();
      const mine = ctx.mine || new Set();
      const opts = options(board, overrides, ctx.teams);
      const valued = valuate(board, opts);

      const pickByYahooId = new Map();
      for (const pick of ctx.picks || []) pickByYahooId.set(pick.playerId, pick);
      const linkedIds = new Set();

      const entries = board.players.map((p) => {
        const yahoo = links.get(p);
        if (yahoo) linkedIds.add(yahoo.id);
        const pick = yahoo ? pickByYahooId.get(yahoo.id) : null;
        const v = valued.byName.get(p.name);
        return {
          p, yahoo, pick, v,
          // Yahoo lists the flex slots too (G, F, UTIL); UTIL fits everyone, so drop it.
          positions: yahoo && yahoo.positions.length ? yahoo.positions.filter((x) => x !== 'UTIL') : p.positions,
          teamId: pick ? pick.teamId : manual.has(p.name) ? -1 : null
        };
      });

      // Drafted players with no projection still fill a roster spot: count them as average.
      const extras = [];
      for (const [id, pick] of pickByYahooId) {
        if (linkedIds.has(id)) continue;
        const yahoo = ctx.yahooById && ctx.yahooById.get(id);
        extras.push({ name: `#${id}`, positions: yahoo ? yahoo.positions : [pick.pos].filter(Boolean), z: ZERO_Z, value: 0, adp: null, teamId: pick.teamId });
      }

      const myTeamId = ctx.myTeamId ?? 0;
      for (const e of entries) if (!e.pick && mine.has(e.p.name)) e.teamId = myTeamId;
      const teamIds = ctx.teamIds && ctx.teamIds.length ? ctx.teamIds
        : [myTeamId, ...Array.from({ length: opts.teams - 1 }, (_, i) => -100 - i)];
      const currentPick = ctx.currentPick || 1;
      const rec = YDR.nbaRecommend.recommend({
        players: entries.map((e) => ({
          name: e.p.name, positions: e.positions, z: e.v.z, full: e.v.full, value: e.v.value, adp: e.p.adp, teamId: e.teamId,
          team: e.p.team, gp: e.v.stats.gp, gamesOut: e.v.stats.gamesOut
        })).concat(extras),
        season: season(board),
        teamIds,
        myTeamId,
        slots: opts.slots,
        weights: opts.weights,
        scoring: opts.scoring,
        currentPick,
        myPick: ctx.myPick ?? null,
        followingPick: ctx.followingPick ?? null
      });

      const order = new Map(rec.ranked.map((c, i) => [c.name, i + 1]));
      const queued = new Set(rec.queue);
      const rows = entries.map((e) => {
        const c = rec.byName.get(e.p.name);
        return {
          key: e.p.name,
          name: e.p.name,
          team: e.yahoo ? e.yahoo.team : e.p.team,
          positions: e.positions,
          rank: e.v.rank,
          vorp: e.v.vorp,
          adp: e.p.adp,
          diff: e.p.adp === null ? null : e.p.adp - e.v.rank,
          adj: e.p.adj || '',
          stats: e.v.stats,
          gp: e.v.stats.gp,
          mpg: e.v.stats.mpg,
          mpg25: e.p.mpg25 ?? null,
          gamesOut: e.v.stats.gamesOut,
          status: e.p.status || '',
          returnDate: e.p.returnDate ?? null,
          note: e.p.note || '',
          starts: e.teamId === myTeamId ? rec.myStarts.get(e.p.name) ?? null : c ? c.starts : null,
          gain: c ? c.gain : null,
          catGain: c ? c.catGain : null,
          back: c && ctx.followingPick ? c.back : null,
          score: c ? c.score : null,
          feasible: c ? c.feasible : false,
          order: order.get(e.p.name) ?? null,
          queued: queued.has(e.p.name),
          yahooId: e.yahoo ? e.yahoo.id : null,
          matched: ctx.links ? Boolean(e.yahoo) : true,
          pickNo: e.pick ? e.pick.pickNo : null,
          byMe: Boolean(e.pick && e.pick.teamId === myTeamId) || (!e.pick && mine.has(e.p.name)),
          manual: !e.pick && (manual.has(e.p.name) || mine.has(e.p.name))
        };
      });

      const byName = new Map(rows.map((r) => [r.name, r]));
      const queueYahooIds = rec.queue.map((n) => byName.get(n)?.yahooId).filter(Boolean);
      return { opts, valued, rec, rows, queueYahooIds };
    }

    return { build };
  }

  const api = { options, mergeOverrides, toggleCategory, createBoard };
  YDR.nbaBoard = api;

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis.YDR);
