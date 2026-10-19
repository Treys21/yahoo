// The NBA roto workbook's valuation (nba/build.py writes it as formulas), so
// the board can re-value live when a setting changes — exactly as Excel would.
//
//   0. Minutes & Health: games = your GP, else projected GP capped at the
//      games left after his injury (82 − team games before the return date);
//      minutes per game = your MPG, else the projected MPG.
//   1. Projected totals = per-minute rate × MPG × games × boost (games = Flat
//      GP when "Games Played Projection" is No). FG% / FT% carry over;
//      attempts scale with minutes.
//   2. FG% / FT% become impact: attempts × (pct − pool pct).
//   3. Pass 1 z-scores everyone against all players; the top teams × roster
//      (IL excluded) by that score form the value pool.
//   4. Pass 2 z-scores everyone against the pool. TO counts against you.
//      VALUE = Σ weight × z.
//   5. VORP = VALUE − the (pool + 1)th best VALUE. RK = rank of VORP;
//      PRK = rank among players with the same first position.
//
// Pure logic — also loaded by test/nba-model.test.js.
globalThis.YDR = globalThis.YDR || {};

(function (YDR) {
  'use strict';

  const CATEGORIES = ['PTS', 'REB', 'AST', 'STL', 'BLK', '3PM', 'FG%', 'FT%', 'TO'];
  const COUNTING = ['PTS', 'REB', 'AST', 'STL', 'BLK', '3PM', 'TO'];
  const NEGATIVE = new Set(['TO']);
  const DEFAULT_SLOTS = { PG: 1, SG: 1, G: 1, SF: 1, PF: 1, F: 1, C: 2, Util: 2, BN: 3, IL: 3 };
  const SEASON_GAMES = 82;

  /** schedule [[dateSerial, team], ...] -> Map(team -> sorted game dates) */
  function teamDates(schedule) {
    const byTeam = new Map();
    for (const [date, team] of schedule || []) {
      if (!byTeam.has(team)) byTeam.set(team, []);
      byTeam.get(team).push(date);
    }
    for (const dates of byTeam.values()) dates.sort((a, b) => a - b);
    return byTeam;
  }

  function gamesOut(player, byTeam) {
    if (!player.returnDate) return 0;
    return (byTeam.get(player.team) || []).filter((d) => d < player.returnDate).length;
  }

  /** { gpUsed, mpgUsed, gamesOut } from the Minutes & Health inputs. */
  function minutes(player, byTeam) {
    const out = gamesOut(player, byTeam);
    return {
      gamesOut: out,
      gpUsed: player.yourGp ?? Math.min(player.gp, SEASON_GAMES - out),
      mpgUsed: player.yourMpg ?? player.mpg
    };
  }

  function rosterSize(slots) {
    return Object.entries(slots).reduce((n, [slot, count]) => n + (slot === 'IL' ? 0 : count), 0);
  }

  // Mean and sample stdev (Excel AVERAGE / STDEV).
  function moments(xs) {
    const n = xs.length;
    const mean = xs.reduce((a, b) => a + b, 0) / n;
    const variance = xs.reduce((acc, x) => acc + (x - mean) ** 2, 0) / (n - 1);
    return { mean, sd: Math.sqrt(variance) };
  }

  function project(player, options, byTeam) {
    const m = minutes(player, byTeam);
    const games = options.gpProjection ? m.gpUsed : options.flatGp;
    const mark = options.boosts ? options.boostTable[String(player.adj || '').trim()] : 0;
    const f = ((m.mpgUsed * games) / player.min) * (1 + (mark || 0));
    const s = { gp: games, mpg: m.mpgUsed, gamesOut: m.gamesOut };
    for (const cat of COUNTING) s[cat] = player.stats[cat] * f;
    s.fga = player.fga * f;
    s.fta = player.fta * f;
    s.fgPct = player.fgPct;
    s.ftPct = player.ftPct;
    s.fgm = s.fga * s.fgPct;
    s.ftm = s.fta * s.ftPct;
    return s;
  }

  /** Means/stdevs over `members`, with FG / FT impact measured against their shooting. */
  function poolStats(members) {
    const sum = (key) => members.reduce((acc, p) => acc + p.stats[key], 0);
    const fg = sum('fgm') / sum('fga');
    const ft = sum('ftm') / sum('fta');
    const impact = (p) => ({ 'FG%': p.stats.fga * (p.stats.fgPct - fg), 'FT%': p.stats.fta * (p.stats.ftPct - ft) });
    const stats = {};
    for (const cat of CATEGORIES) {
      const xs = members.map((p) => (cat === 'FG%' || cat === 'FT%' ? impact(p)[cat] : p.stats[cat]));
      stats[cat] = moments(xs);
    }
    return { fg, ft, stats };
  }

  function zScores(p, pool) {
    const z = {};
    for (const cat of CATEGORIES) {
      const x = cat === 'FG%' ? p.stats.fga * (p.stats.fgPct - pool.fg)
        : cat === 'FT%' ? p.stats.fta * (p.stats.ftPct - pool.ft)
          : p.stats[cat];
      const { mean, sd } = pool.stats[cat];
      z[cat] = ((x - mean) / sd) * (NEGATIVE.has(cat) ? -1 : 1);
    }
    return z;
  }

  function weighted(z, weights) {
    return CATEGORIES.reduce((acc, cat) => acc + (weights[cat] ?? 1) * z[cat], 0);
  }

  // Excel RANK (descending): 1 + number of strictly greater values.
  function rankOf(values, v) {
    let n = 0;
    for (const x of values) if (x > v) n++;
    return n + 1;
  }

  /**
   * @param players [{ name, team, positions, gp, min, mpg, stats: {PTS..TO}, fga, fta, fgPct, ftPct, adj,
   *                   yourGp?, yourMpg?, returnDate? }]
   * @param options { weights, teams, slots, gpProjection, flatGp, boosts, boostTable }
   * @param schedule [[dateSerial, team], ...] for injury games-out (optional)
   * @returns { players: [{ name, stats, z, value, vorp, rank, posRank, ... }], byName, pool, poolSize }
   */
  function valuate(players, options, schedule) {
    const slots = options.slots || DEFAULT_SLOTS;
    const poolSize = options.teams * rosterSize(slots);
    const weights = options.weights || {};
    const byTeam = teamDates(schedule);

    const rows = players.map((player) => ({ player, name: player.name, stats: project(player, options, byTeam) }));

    const all = poolStats(rows);
    for (const r of rows) r.base = weighted(zScores(r, all), weights);
    const cut = rows.map((r) => r.base).sort((a, b) => b - a)[poolSize - 1];
    const members = rows.filter((r) => r.base >= cut);

    const pool = poolStats(members);
    for (const r of rows) {
      r.z = zScores(r, pool);
      r.value = weighted(r.z, weights);
      // Each category's full contribution in z units (z without the pool mean):
      // what he'd take with him if he sat. Used by the nightly lineup simulation.
      r.full = {};
      for (const cat of CATEGORIES) {
        r.full[cat] = r.z[cat] + (NEGATIVE.has(cat) ? -1 : 1) * pool.stats[cat].mean / pool.stats[cat].sd;
      }
    }
    const values = rows.map((r) => r.value).sort((a, b) => b - a);
    const replacement = values[Math.min(poolSize, values.length - 1)];
    for (const r of rows) r.vorp = r.value - replacement;

    const vorps = rows.map((r) => r.vorp);
    const byPos = new Map();
    for (const r of rows) {
      const pos = r.player.positions[0] || '';
      if (!byPos.has(pos)) byPos.set(pos, []);
      byPos.get(pos).push(r.vorp);
    }
    for (const r of rows) {
      r.rank = rankOf(vorps, r.vorp);
      r.posRank = rankOf(byPos.get(r.player.positions[0] || ''), r.vorp);
    }
    return { players: rows, byName: new Map(rows.map((r) => [r.name, r])), pool, poolSize };
  }

  const api = { CATEGORIES, DEFAULT_SLOTS, SEASON_GAMES, rosterSize, teamDates, minutes, valuate };
  YDR.nbaModel = api;

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis.YDR);
