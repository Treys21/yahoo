// Re-implements the projections workbook's valuation so the board can be
// re-ranked live when you flip a setting, exactly as Excel would.
//
// The chain, as the workbook builds it:
//   1. Projected stats ('The List' S:AR) = Player Data per-game rate × games
//      × boost multiplier. Games are the GP projection, or a flat 84 for
//      skaters when "Games Played Projection" is No. Goalies always use their
//      projected GP.
//   2. Score ('The List' I):
//        Points     — Σ stat × Settings column B weight
//        Categories — Σ z-score × Settings column C flag ('Standard
//                     Deviations' sheet). z = (x − mean) / sample stdev over
//                     every skater (or goalie) in The List. L and GAA are
//                     negated; the rest count as-is.
//   3. Each position sheet (C, LW, RW, D, G, and F = all forwards) ranks its
//      eligible players by score. The replacement player is the one ranked
//      N, where N comes from Settings F2:F6:
//        Position — starters × teams
//        Draft    — ROUND(draft-based count × (starters / 2, or / 4 for D) × teams / 12)
//        Blend    — ROUND(AVERAGE(Position, Draft))
//      F's N is C + LW + RW.
//   4. VORP = score − replacement score, from the player's own value sheet
//      (or F, for forwards when Forward Separation is "Forwards").
//   5. RK = rank of VORP across everyone. Positional rank = rank in his sheet.
//
// Pure logic — also loaded by test/valuation.test.js.
globalThis.YDR = globalThis.YDR || {};

(function (YDR) {
  'use strict';

  const SKATER_GAMES_WHEN_OFF = 84;
  const FORWARD_SHEETS = ['C', 'LW', 'RW'];

  // Skater stat keys in 'The List' column order.
  const SKATER_STATS = ['toi', 'g', 'a', 'pts', 'sog', 'ppg', 'ppp', 'shg', 'shp', 'blk', 'hit', 'pm', 'pim', 'gwg', 'fow', 'fol', 'foPct'];
  const GOALIE_STATS = ['gp', 'w', 'l', 'otl', 'so', 'sv', 'ga', 'svPct', 'gaa'];
  // Stats whose z-score counts against you in categories mode.
  const NEGATED = new Set(['goalie.l', 'goalie.gaa']);

  function boostAdj(model, boost, options) {
    if (!options.boosts || !boost) return 0;
    const adj = model.boostTable[String(boost).replace(/\s+/g, ' ').trim()];
    return typeof adj === 'number' ? adj : 0;
  }

  function projectSkater(player, adj, options) {
    const r = player.rates;
    const q = options.gpProjection ? player.gp : SKATER_GAMES_WHEN_OFF;
    const g = r.g * q * (1 + adj);
    const a = r.a * q * (1 + adj);
    return {
      gp: q,
      toi: r.toi,
      g,
      a,
      pts: g + a,
      sog: r.sog * q * (1 + adj / 2),
      ppg: r.ppg * q * (1 + adj),
      ppp: r.ppp * q * (1 + adj),
      shg: r.shg * q,
      shp: r.shp * q,
      blk: r.blk * q,
      hit: r.hit * q,
      pm: r.pm * q * (1 + adj),
      pim: r.pim * q,
      gwg: r.gwg * q * (1 + adj),
      fow: r.fow * q,
      fol: r.fol * q,
      foPct: r.foPct
    };
  }

  function projectGoalie(player, adj) {
    const r = player.goalie;
    const gp = r.gp;
    const w = r.w * gp * (1 + adj);
    const otl = r.otl * gp;
    const sv = r.sv * gp * (1 + adj / 4);
    const ga = r.ga * gp * (1 - adj / 4);
    return {
      gp,
      w,
      l: gp - w - otl,
      otl,
      so: r.so * gp,
      sv,
      ga,
      svPct: 1 - ga / (sv + ga),
      gaa: ga / gp
    };
  }

  function pointsScore(p, weights) {
    const s = p.stats;
    const w = (key) => weights[key] || 0;
    if (p.isGoalie) {
      return s.gp * w('gp') + s.w * w('w') + s.l * w('l') + s.so * w('so') +
        s.sv * w('sv') + s.ga * w('ga') + s.otl * w('otl');
    }
    return s.toi * s.gp * w('toi') + s.g * w('g') + s.a * w('a') + s.pts * w('pts') +
      s.sog * w('sog') + s.ppp * w('ppp') + s.blk * w('blk') + s.ppg * w('ppg') +
      s.hit * w('hit') + s.pm * w('pm') + s.pim * w('pim') + s.gwg * w('gwg') +
      s.fow * w('fow') + s.fol * w('fol') + s.shg * w('shg') + s.shp * w('shp');
  }

  // Mean and sample standard deviation (Excel AVERAGE / STDEV), skipping
  // non-finite values the way Excel skips blanks.
  function moments(values) {
    const xs = values.filter(Number.isFinite);
    const n = xs.length;
    if (n < 2) return { mean: 0, sd: 0 };
    const mean = xs.reduce((a, b) => a + b, 0) / n;
    const variance = xs.reduce((acc, x) => acc + (x - mean) ** 2, 0) / (n - 1);
    return { mean, sd: Math.sqrt(variance) };
  }

  function categoryScores(projected, flags) {
    const groups = [
      { goalie: false, keys: SKATER_STATS, prefix: 'skater.' },
      { goalie: true, keys: GOALIE_STATS, prefix: 'goalie.' }
    ];
    for (const group of groups) {
      const members = projected.filter((p) => p.isGoalie === group.goalie);
      const active = group.keys.filter((key) => flags[group.prefix + key]);
      const stats = active.map((key) => ({
        key,
        weight: flags[group.prefix + key],
        sign: NEGATED.has(group.prefix + key) ? -1 : 1,
        ...moments(members.map((p) => p.stats[key]))
      }));
      for (const p of members) {
        let score = 0;
        for (const st of stats) {
          if (!st.sd) continue;
          score += ((p.stats[st.key] - st.mean) / st.sd) * st.sign * st.weight;
        }
        p.score = score;
      }
    }
  }

  // Excel RANK (descending): 1 + number of strictly greater values.
  function ranks(values) {
    const sorted = values.filter(Number.isFinite).sort((a, b) => b - a);
    return (v) => {
      if (!Number.isFinite(v)) return null;
      let lo = 0;
      let hi = sorted.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (sorted[mid] > v) lo = mid + 1;
        else hi = mid;
      }
      return lo + 1;
    };
  }

  function excelRound(x) {
    return Math.sign(x) * Math.round(Math.abs(x));
  }

  /** Settings F2:F6 (and F's sum) for the given options. */
  function replacementLevels(model, options) {
    const levels = {};
    for (const pos of ['C', 'LW', 'RW', 'D', 'G']) {
      const starters = model.starters[pos] || 0;
      const byPosition = starters * options.teams;
      const divisor = pos === 'D' ? 4 : 2;
      const byDraft = excelRound((model.draftCounts[pos] || 0) * (starters / divisor) * (options.teams / 12));
      const n = options.replacement === 'Position'
        ? byPosition
        : options.replacement === 'Draft'
          ? byDraft
          : excelRound((byPosition + byDraft) / 2);
      levels[pos] = excelRound(n);
    }
    levels.F = levels.C + levels.LW + levels.RW;
    return levels;
  }

  /**
   * @param model   { players, sheets: {C:[names],...,F:[names]}, starters, draftCounts,
   *                  boostTable, pointsWeights, categoryFlags }
   * @param options { leagueType, gpProjection, forwards, replacement, teams, boosts }
   * @returns { byName: Map<name, { score, vorp, rank, posRank, stats }>, levels }
   */
  function valuate(model, options) {
    const projected = model.players.map((player) => {
      const adj = boostAdj(model, player.boost, options);
      return {
        name: player.name,
        isGoalie: player.isGoalie,
        valueSheet: player.valueSheet,
        rankSheet: player.rankSheet,
        stats: player.isGoalie ? projectGoalie(player, adj) : projectSkater(player, adj, options),
        score: 0
      };
    });

    if (String(options.leagueType).toLowerCase() === 'points') {
      for (const p of projected) p.score = pointsScore(p, model.pointsWeights);
    } else {
      categoryScores(projected, model.categoryFlags);
    }

    const byName = new Map(projected.map((p) => [p.name, p]));
    const levels = replacementLevels(model, options);

    // Per sheet: rank function over its members' scores, and the replacement score.
    const sheetInfo = {};
    for (const [sheet, names] of Object.entries(model.sheets)) {
      const scores = names.map((n) => byName.get(n)?.score).filter(Number.isFinite);
      const rankOf = ranks(scores);
      const n = levels[sheet];
      // VLOOKUP(N, rank column): the first member (in sheet order) ranked exactly N;
      // if a tie skips N, fall back to the Nth-best score.
      let replacement = null;
      for (const name of names) {
        const p = byName.get(name);
        if (p && rankOf(p.score) === n) {
          replacement = p.score;
          break;
        }
      }
      if (replacement === null) {
        const sorted = scores.slice().sort((a, b) => b - a);
        replacement = sorted[Math.min(n, sorted.length) - 1] ?? 0;
      }
      sheetInfo[sheet] = { rankOf, replacement };
    }

    for (const p of projected) {
      const useF = options.forwards === 'Forwards' && FORWARD_SHEETS.includes(p.valueSheet) && sheetInfo.F;
      const valueInfo = useF ? sheetInfo.F : sheetInfo[p.valueSheet];
      p.vorp = valueInfo ? p.score - valueInfo.replacement : null;
      const rankInfo = sheetInfo[p.rankSheet || p.valueSheet];
      p.posRank = rankInfo ? rankInfo.rankOf(p.score) : null;
    }

    const overall = ranks(projected.map((p) => p.vorp));
    for (const p of projected) p.rank = overall(p.vorp);

    return { byName, levels };
  }

  const api = { valuate, replacementLevels, SKATER_STATS, GOALIE_STATS };
  YDR.valuation = api;

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis.YDR);
