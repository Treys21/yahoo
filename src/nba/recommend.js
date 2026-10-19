// Live pick recommendations for a roto draft.
//
// Standings gain. Every team's strength in a category is the sum of its
// drafted players' z-scores plus, for each roster spot still open, the
// average z of the players likely to go in the rest of the draft (the next
// "open spots across all teams" players by value). Each total carries
// uncertainty: PLAYER_NOISE per player, plus the spread of that future pool
// for spots not yet filled. My expected roto points in a category are
//     1 + Σ over other teams P(I finish ahead of them)
// with each P from the normal distribution of the difference. A candidate's
// GAIN is how much drafting him (in place of an average future pick) raises
// Σ weight × expected points. Early on every team looks alike and GAIN ranks
// players like VALUE; as rosters fill, categories you've locked up (or can't
// reach) stop paying and close races start to.
//
// Survival. A player's place in the remaining ADP order says when the room
// will take him; BACK is the chance he's still there at your following pick.
// The pick SCORE docks each player URGENCY × the best GAIN × BACK, so a
// near-equal player who won't come back goes first.
//
// Nightly lineups. A player only helps on nights he's in your starting lineup.
// For each roster the season is played out day by day on the real 2026-27
// schedule: players whose team plays (and who are back from injury, playing
// a healthy night with chance GP ÷ games left) are slotted into PG SG G SF PF
// F C C Util Util — the most specific slot they fit, then G/F, then Util —
// and each slot stops counting at Yahoo's 82 games. Players are placed best
// per-game first for the whole season, so the capped games go to them. The
// games a player sits come off his contribution: z − (1 − starts ÷ GP) × his
// full per-category total. Open roster spots are filled with an average
// future pick — last in line, taking only the nights nobody drafted fills —
// so early picks aren't graded against an empty bench. A fourth
// center who'd sit half his nights gains less than his VALUE says; a guard
// who fills empty nights gains more.
//
// Roster. Yahoo's starting slots must still be fillable with the picks you
// have left; a player that would break that is marked infeasible and kept out
// of the recommendations and the queue.
//
// Pure logic — also loaded by test/nba-recommend.test.js.
globalThis.YDR = globalThis.YDR || {};

(function (YDR) {
  'use strict';

  const PLAYER_NOISE = 0.7; // per-player season-to-projection noise, in z units
  const SLOT_CAP = 82; // Yahoo's max games per roster slot
  const GENERIC_GAMES = 72; // an average future pick's games
  const URGENCY = 0.15;
  // Head-to-head: a season is H2H_WEEKS matchups, each a fresh one-week contest
  // per category against one opponent. WEEK_NOISE is the per-category luck of a
  // single week (in z units) on top of the season projection error. Both are
  // assumptions; scale them if your league's schedule or variance differs.
  const H2H_WEEKS = 24;
  const WEEK_NOISE = 0.5;
  const QUEUE_SIZE = 10;
  const ELIGIBLE = { PG: ['PG'], SG: ['SG'], G: ['PG', 'SG'], SF: ['SF'], PF: ['PF'], F: ['SF', 'PF'], C: ['C'] };

  // Standard normal CDF (Abramowitz & Stegun 7.1.26, |error| < 1.5e-7).
  function phi(x) {
    const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t *
      Math.exp(-(x * x) / 2);
    return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
  }

  function starterSlots(slots) {
    const out = [];
    for (const [slot, count] of Object.entries(slots)) {
      if (slot === 'BN' || slot === 'IL') continue;
      for (let i = 0; i < count; i++) out.push(slot);
    }
    return out;
  }

  function fits(slot, positions) {
    return slot === 'Util' || (ELIGIBLE[slot] || [slot]).some((p) => positions.includes(p));
  }

  /** Max matching of players to starting slots. @returns slot index -> player index */
  function assign(slotList, rosters) {
    const owner = new Array(slotList.length).fill(-1);
    const tryPlace = (p, seen) => {
      for (let s = 0; s < slotList.length; s++) {
        if (seen[s] || !fits(slotList[s], rosters[p])) continue;
        seen[s] = true;
        if (owner[s] === -1 || tryPlace(owner[s], seen)) {
          owner[s] = p;
          return true;
        }
      }
      return false;
    };
    // Specific slots first so Util stays open for whoever needs it.
    for (let p = 0; p < rosters.length; p++) tryPlace(p, new Array(slotList.length).fill(false));
    return owner;
  }

  function openSlots(slotList, positionsList) {
    const owner = assign(slotList, positionsList);
    return slotList.filter((_, s) => owner[s] === -1);
  }

  // Slots each player can fill, most specific first (so flex slots stay open).
  function slotOrder(slotList, positions) {
    const generic = !positions;
    const rank = (slot) => (slot === 'Util' ? 2 : ELIGIBLE[slot] && ELIGIBLE[slot].length > 1 ? 1 : 0);
    return slotList.map((slot, i) => ({ slot, i }))
      .filter(({ slot }) => generic || fits(slot, positions))
      .sort((a, b) => rank(a.slot) - rank(b.slot))
      .map(({ i }) => i);
  }

  /**
   * Expected starts for each roster entry over the season.
   * entry: { team, positions, gp, gamesOut, priority }  (team null = average future pick)
   * season: { days: [date...], byTeam: Map(team -> sorted dates) }
   */
  function simulateStarts(entries, slotList, season) {
    // Whole-season allocation in priority order: the best player claims a slot
    // on every night he plays before the next player is considered. That is how
    // a manager handles the 82-game caps: they go to the players who matter
    // most, not to whoever happened to play in October.
    const nSlots = slotList.length;
    const dayIndex = new Map(season.days.map((d, i) => [d, i]));
    const open = new Float64Array(season.days.length * nSlots).fill(1);
    const caps = new Array(nSlots).fill(SLOT_CAP);
    const starts = new Array(entries.length).fill(0);
    const order = entries.map((e, i) => i).sort((a, b) => entries[b].priority - entries[a].priority);
    for (const i of order) {
      const e = entries[i];
      const slots = slotOrder(slotList, e.positions);
      let nights;
      let chance;
      if (e.team === null) {
        nights = season.days.map((_, d) => d);
        chance = GENERIC_GAMES / season.days.length;
      } else {
        const dates = season.byTeam.get(e.team) || [];
        nights = dates.slice(e.gamesOut).map((d) => dayIndex.get(d)).filter((d) => d !== undefined);
        chance = Math.min(1, e.gp / Math.max(1, dates.length - e.gamesOut));
      }
      for (const d of nights) {
        let left = chance;
        for (const s of slots) {
          if (left <= 1e-12) break;
          const k = d * nSlots + s;
          const take = Math.min(left, open[k], caps[s]);
          if (take <= 0) continue;
          open[k] -= take;
          caps[s] -= take;
          starts[i] += take;
          left -= take;
        }
      }
    }
    return starts;
  }

  /**
   * @param ctx {
   *   players: [{ name, positions, z: {cat}, value, adp, teamId|null }]  — every player, drafted ones carry teamId
   *   teamIds: [...]            every team in the draft (mine included)
   *   myTeamId
   *   slots, weights           from the board settings
   *   currentPick              pick number on the clock now
   *   myPick                   the pick these recommendations are for (mine, >= currentPick), or null
   *   followingPick            my pick after that, or null
   * }
   */
  function recommend(ctx) {
    const cats = YDR.nbaModel.CATEGORIES;
    const weights = ctx.weights || {};
    const slotList = starterSlots(ctx.slots);
    const rosterSize = slotList.length + (ctx.slots.BN || 0);

    const rosters = new Map(ctx.teamIds.map((id) => [id, []]));
    const available = [];
    for (const p of ctx.players) {
      if (p.teamId === null || p.teamId === undefined) available.push(p);
      else if (rosters.has(p.teamId)) rosters.get(p.teamId).push(p);
    }
    available.sort((a, b) => b.value - a.value);

    const open = new Map([...rosters].map(([id, list]) => [id, Math.max(0, rosterSize - list.length)]));
    const totalOpen = [...open.values()].reduce((a, b) => a + b, 0);
    const future = available.slice(0, Math.max(1, totalOpen));
    const f = {};
    const v = {};
    for (const c of cats) {
      const xs = future.map((p) => p.z[c]);
      f[c] = xs.reduce((a, b) => a + b, 0) / xs.length;
      v[c] = xs.length > 1 ? xs.reduce((acc, x) => acc + (x - f[c]) ** 2, 0) / (xs.length - 1) : 0;
    }

    // Average future pick: mean z, mean full contribution, mean per-game priority.
    const ff = {};
    for (const c of cats) ff[c] = future.reduce((acc, p) => acc + (p.full ? p.full[c] : p.z[c]), 0) / future.length;
    // Future picks start only on nights no drafted player fills: you'll pick them to fit around your roster.
    const genericPriority = -1e9; // finite: -Infinity - -Infinity is NaN and breaks the sort
    const season = ctx.season && ctx.season.days.length ? ctx.season : null;

    function priority(p) {
      if (!p.full || !p.gp) return 0;
      return cats.reduce((acc, c) => acc + (weights[c] ?? 1) * p.full[c], 0) / p.gp;
    }

    // Category strength of a roster plus `generics` average future picks,
    // after the nights each player sits. Returns { s, v, starts }.
    function strengthOf(list, generics) {
      const s = {};
      const varc = {};
      let starts = null;
      let use = list.map(() => 1);
      let useGeneric = 1;
      if (season) {
        const entries = list.map((p) => ({ team: p.team ?? null, positions: p.positions, gp: p.gp || GENERIC_GAMES, gamesOut: p.gamesOut || 0, priority: priority(p) }))
          .concat(Array.from({ length: generics }, () => ({ team: null, positions: null, gp: GENERIC_GAMES, gamesOut: 0, priority: genericPriority })));
        starts = simulateStarts(entries, slotList, season);
        use = list.map((p, i) => (p.full && p.gp ? Math.min(1, starts[i] / p.gp) : 1));
        if (generics) useGeneric = Math.min(1, starts.slice(list.length).reduce((a, b) => a + b, 0) / (generics * GENERIC_GAMES));
      }
      for (const c of cats) {
        s[c] = list.reduce((acc, p, i) => acc + p.z[c] - (p.full ? (1 - use[i]) * p.full[c] : 0), 0) +
          generics * (f[c] - (1 - useGeneric) * ff[c]);
        varc[c] = list.length * tau2 + generics * (tau2 + v[c]);
      }
      return { s, v: varc, starts };
    }

    const tau2 = PLAYER_NOISE ** 2;
    const strength = new Map();
    for (const [id, list] of rosters) strength.set(id, strengthOf(list, open.get(id)));

    const me = strength.get(ctx.myTeamId);
    const others = [...strength].filter(([id]) => id !== ctx.myTeamId).map(([, t]) => t);
    const h2h = ctx.scoring === 'h2h';
    // Roto: 1 + Σ P(finish ahead of each team) (max = teams).
    // H2H: expected matchups won in the category over the season against a
    // random opponent (max = H2H_WEEKS). Each week's result carries WEEK_NOISE.
    const expectedPoints = h2h
      ? (c, s, varc) => (H2H_WEEKS / others.length) *
          others.reduce((acc, t) => acc + phi((s - t.s[c]) / Math.sqrt(varc + t.v[c] + WEEK_NOISE ** 2 || 1)), 0)
      : (c, s, varc) => 1 + others.reduce((acc, t) => acc + phi((s - t.s[c]) / Math.sqrt(varc + t.v[c] || 1)), 0);
    const maxPoints = h2h ? H2H_WEEKS : ctx.teamIds.length;

    const outlook = {};
    for (const c of cats) outlook[c] = expectedPoints(c, me.s[c], me.v[c]);
    const myRoster = rosters.get(ctx.myTeamId).map((p) => p.positions);
    const needs = openSlots(slotList, myRoster);
    const myOpen = open.get(ctx.myTeamId);

    // ADP order of what's left: k-th earliest ADP = expected k-th pick from now.
    const byAdp = available.filter((p) => p.adp !== null && p.adp !== undefined).sort((a, b) => a.adp - b.adp);
    const adpRank = new Map(byAdp.map((p, i) => [p.name, i + 1]));
    const othersBeforeFollowing = ctx.followingPick ? ctx.followingPick - ctx.currentPick - 1 : null;
    const back = (p) => {
      if (othersBeforeFollowing === null) return 0;
      if (othersBeforeFollowing <= 0) return 1; // back-to-back picks at the turn
      const k = adpRank.get(p.name);
      if (!k) return 1;
      return 1 - phi((othersBeforeFollowing + 0.5 - k) / (1.5 + 0.12 * k));
    };

    const mine = rosters.get(ctx.myTeamId);
    const candidates = available.map((p) => {
      const catGain = {};
      let gain = 0;
      let starts = null;
      if (myOpen > 0) {
        const withHim = strengthOf(mine.concat([p]), myOpen - 1);
        starts = withHim.starts ? withHim.starts[mine.length] : null;
        for (const c of cats) {
          catGain[c] = (weights[c] ?? 1) * (expectedPoints(c, withHim.s[c], withHim.v[c]) - outlook[c]);
          gain += catGain[c];
        }
      }
      const feasible = myOpen > 0 && openSlots(slotList, myRoster.concat([p.positions])).length <= myOpen - 1;
      return { name: p.name, positions: p.positions, value: p.value, adp: p.adp ?? null, gain, catGain, back: back(p), feasible, starts, gp: p.gp ?? null };
    });

    const best = Math.max(0, ...candidates.filter((c) => c.feasible).map((c) => c.gain));
    for (const c of candidates) c.score = c.feasible ? c.gain - URGENCY * best * c.back : -Infinity;
    const ranked = candidates.filter((c) => c.feasible).sort((a, b) => b.score - a.score);

    const myStarts = me.starts ? new Map(mine.map((p, i) => [p.name, me.starts[i]])) : new Map();
    return {
      candidates,
      myStarts,
      byName: new Map(candidates.map((c) => [c.name, c])),
      ranked,
      queue: ranked.slice(0, QUEUE_SIZE).map((c) => c.name),
      outlook,
      total: cats.reduce((acc, c) => acc + (weights[c] ?? 1) * outlook[c], 0),
      needs,
      myOpen,
      teams: ctx.teamIds.length,
      scoring: h2h ? 'h2h' : 'roto',
      maxPoints
    };
  }

  const api = { recommend, starterSlots, openSlots, simulateStarts, phi, PLAYER_NOISE, URGENCY, QUEUE_SIZE, SLOT_CAP, H2H_WEEKS, WEEK_NOISE };
  YDR.nbaRecommend = api;

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis.YDR);
