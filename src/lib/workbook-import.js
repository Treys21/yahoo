// Maps the projections workbook onto ranking records.
//
// Columns are found by header text, not letter, so inserting a column in the
// sheet doesn't silently shift every field. The sheet repeats "GP" for skaters
// and goalies; the first is skater games, the one after "FO%" is goalie games.
globalThis.YDR = globalThis.YDR || {};

(function (YDR) {
  'use strict';

  const LIST_SHEET = 'The List';
  const SETTINGS_SHEET = 'Settings';
  const PLAYER_DATA_SHEET = 'Player Data';
  const POSITION_SHEETS = ['C', 'LW', 'RW', 'D', 'G', 'F'];

  function num(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function headerIndex(header) {
    const index = new Map();
    header.forEach((label, col) => {
      if (!label) return;
      const key = String(label).trim().toUpperCase();
      if (!index.has(key)) index.set(key, []);
      index.get(key).push(col);
    });
    const first = (key) => (index.get(key) || [])[0];
    const nth = (key, n) => (index.get(key) || [])[n];
    return { first, nth };
  }

  // The Settings colour legend marks players by font colour in The List:
  // blue is good news, red is bad. Shades vary a little between the legend
  // and the cells, so cells are classified by hue rather than exact colour.
  function hue(rgb) {
    if (!rgb || rgb.length !== 6) return null;
    const r = parseInt(rgb.slice(0, 2), 16);
    const g = parseInt(rgb.slice(2, 4), 16);
    const b = parseInt(rgb.slice(4, 6), 16);
    if (b > r + 40 && b > g) return 'blue';
    if (r > b + 60 && r > g + 40) return 'red';
    return null;
  }

  // header -> marker key. Each marker is +1 (blue) or -1 (red).
  const MARKER_COLUMNS = { TEAM: 'sos', AGE: 'age', SALARY: 'contract', TOI: 'toi', PPG: 'pp1', PPP: 'pp1Partial' };

  function markersFor(colorRow, header) {
    const markers = {};
    if (!colorRow) return markers;
    for (const [label, key] of Object.entries(MARKER_COLUMNS)) {
      const col = header.first(label);
      if (col === undefined) continue;
      const h = hue(colorRow[col]);
      if (h) markers[key] = h === 'blue' ? 1 : -1;
    }
    return markers;
  }

  function parseList(rows, colors = []) {
    const header = rows[0] || [];
    const h = headerIndex(header);
    const required = ['RK', 'NAME', 'POS'];
    for (const key of required) {
      if (h.first(key) === undefined) throw new Error(`"${LIST_SHEET}" is missing a ${key} column`);
    }

    // Positional rank sits in the unlabeled column right after POS.
    const posCol = h.first('POS');
    const posRankCol = header[posCol + 1] ? null : posCol + 1;

    const col = {
      rank: h.first('RK'),
      name: h.first('NAME'),
      pos: posCol,
      team: h.first('TEAM'),
      age: h.first('AGE'),
      fp: h.first('FP'),
      vorp: h.first('VORP'),
      adp: h.first('ADP'),
      diff: h.first('DIFF.') ?? h.first('DIFF'),
      boost: h.first('ADJ'),
      g: h.first('G'),
      a: h.first('A'),
      pts: h.first('PTS'),
      sog: h.first('SOG'),
      ppp: h.first('PPP'),
      hit: h.first('HIT'),
      pm: h.first('+/-'),
      gp: h.first('GP'),
      goalieGp: h.nth('GP', 1),
      w: h.first('W'),
      so: h.first('SO'),
      svPct: h.first('SV%'),
      gaa: h.first('GAA')
    };
    const get = (row, key) => (col[key] === undefined || col[key] === null ? null : row[col[key]]);

    const players = [];
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row) continue;
      const name = get(row, 'name');
      const rank = num(get(row, 'rank'));
      if (!name || rank === null) continue;

      const positions = String(get(row, 'pos') || '')
        .split(/[,/]/)
        .map((p) => p.trim().toUpperCase())
        .filter(Boolean);
      const isGoalie = positions.includes('G');
      const boost = String(get(row, 'boost') || '0').trim();

      players.push({
        rank,
        name: String(name).trim(),
        positions,
        posRank: posRankCol === null ? null : num(row[posRankCol]),
        team: YDR.match.normalizeTeam(get(row, 'team')),
        age: num(get(row, 'age')),
        fp: round(num(get(row, 'fp')), 2),
        vorp: round(num(get(row, 'vorp')), 2),
        adp: num(get(row, 'adp')),
        diff: round(num(get(row, 'diff')), 1),
        markers: markersFor(colors[r], h),
        boost: boost === '0' ? '' : boost.replace(/\s+/g, ''),
        boostRaw: boost === '0' ? '' : boost,
        stats: isGoalie
          ? {
              gp: num(get(row, 'goalieGp')),
              w: round(num(get(row, 'w')), 0),
              so: round(num(get(row, 'so')), 1),
              svPct: round(num(get(row, 'svPct')), 3),
              gaa: round(num(get(row, 'gaa')), 2)
            }
          : {
              gp: num(get(row, 'gp')),
              g: round(num(get(row, 'g')), 0),
              a: round(num(get(row, 'a')), 0),
              pts: round(num(get(row, 'pts')), 0),
              sog: round(num(get(row, 'sog')), 0),
              ppp: round(num(get(row, 'ppp')), 0),
              hit: round(num(get(row, 'hit')), 0),
              pm: round(num(get(row, 'pm')), 0)
            }
      });
    }

    players.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
    return players;
  }

  function round(value, places) {
    if (value === null) return null;
    const f = 10 ** places;
    return Math.round(value * f) / f;
  }

  // Settings rows → stat keys. Column B holds points weights, column C the
  // categories flags. (Row 13, "Defensemen Points", isn't used by any formula.)
  const SETTINGS_STATS = {
    2: 'skater.g', 3: 'skater.a', 4: 'skater.pts', 5: 'skater.sog', 6: 'skater.blk',
    7: 'skater.hit', 8: 'skater.ppg', 9: 'skater.ppp', 10: 'skater.shg', 11: 'skater.shp',
    12: 'skater.toi', 14: 'skater.pm', 15: 'skater.pim', 16: 'skater.gwg', 17: 'skater.fow',
    18: 'skater.fol', 19: 'skater.foPct',
    21: 'goalie.w', 22: 'goalie.l', 23: 'goalie.otl', 24: 'goalie.so', 25: 'goalie.sv',
    26: 'goalie.svPct', 27: 'goalie.ga', 28: 'goalie.gaa', 29: 'goalie.gp'
  };
  // Points mode never reads FO%, SV% or GAA; categories mode never reads GA.
  const POINTS_ONLY = new Set(['goalie.ga']);
  const CATEGORIES_ONLY = new Set(['skater.foPct', 'goalie.svPct', 'goalie.gaa']);

  const OPTION_VALUES = {
    leagueType: ['Categories', 'Points'],
    replacement: ['Blend', 'Position', 'Draft'],
    forwards: ['C/LW/RW', 'Forwards']
  };

  function pick(value, allowed, fallback) {
    const match = allowed.find((a) => a.toLowerCase() === String(value || '').trim().toLowerCase());
    return match || fallback;
  }

  // Settings layout: option labels in column E with the value in the row
  // beneath; the position table E2:J6 (starters in H, draft-based counts in
  // J); the boost table E28:F33.
  function parseSettings(rows) {
    const settings = {
      leagueType: null, teams: null, starters: {}, draftCounts: {}, replacement: null,
      adpSource: null, gpProjection: true, forwards: 'C/LW/RW', boosts: true,
      boostTable: {}, pointsWeights: {}, categoryFlags: {}
    };
    if (!rows) return settings;

    const cell = (r, c) => (rows[r] ? rows[r][c] : undefined);
    const B = 1, C = 2, E = 4, F = 5, H = 7, J = 9;

    for (let r = 0; r < rows.length; r++) {
      const label = String(cell(r, E) || '').trim().toLowerCase();
      const below = cell(r + 1, E);
      if (label === 'number of teams') settings.teams = num(below);
      if (label === 'league type') settings.leagueType = pick(below, OPTION_VALUES.leagueType, 'Categories');
      if (label === 'replacement level') settings.replacement = pick(below, OPTION_VALUES.replacement, 'Blend');
      if (label === 'average draft position') settings.adpSource = below || null;
      if (label === 'games played projection') settings.gpProjection = String(below || '').trim().toLowerCase() !== 'no';
      if (label === 'forward separation') settings.forwards = pick(below, OPTION_VALUES.forwards, 'C/LW/RW');
      if (label === 'boost or bust') {
        settings.boosts = String(below || '').trim().toUpperCase() !== 'OFF';
        // The boost table follows on the next rows: "+ + +" | 0.2, ...
        for (let k = r + 2; k < r + 8; k++) {
          const key = String(cell(k, E) || '').replace(/\s+/g, ' ').trim();
          if (key && num(cell(k, F)) !== null) settings.boostTable[key] = num(cell(k, F));
        }
      }
    }

    for (let r = 1; r < 10; r++) {
      const pos = String(cell(r, E) || '').trim().toUpperCase();
      if (['C', 'LW', 'RW', 'D', 'G'].includes(pos)) {
        settings.starters[pos] = num(cell(r, H)) || 0;
        settings.draftCounts[pos] = num(cell(r, J)) || 0;
      }
    }

    for (const [row, key] of Object.entries(SETTINGS_STATS)) {
      const r = Number(row) - 1;
      const weight = num(cell(r, B));
      const flag = num(cell(r, C));
      if (weight && !CATEGORIES_ONLY.has(key)) settings.pointsWeights[key.split('.')[1]] = weight;
      if (flag && !POINTS_ONLY.has(key)) settings.categoryFlags[key] = flag;
    }
    return settings;
  }

  // 'Player Data' per-game rates, at the fixed column indices the workbook's
  // own VLOOKUPs use (two columns are both headed "GP").
  function parsePlayerData(rows) {
    const byName = new Map();
    if (!rows) return byName;
    const n = (row, col) => num(row[col - 1]) || 0; // VLOOKUP of a blank is 0
    for (const row of rows) {
      if (!row || !row[0]) continue;
      const name = String(row[0]).trim();
      if (name === 'Player') continue;
      byName.set(name, {
        gp: n(row, 5),
        rates: {
          toi: n(row, 6), g: n(row, 7), a: n(row, 8), sog: n(row, 10), ppg: n(row, 11), ppp: n(row, 12),
          shg: n(row, 13), shp: n(row, 14), blk: n(row, 15), hit: n(row, 16), pm: n(row, 17),
          pim: n(row, 18), gwg: n(row, 19), fow: n(row, 20), fol: n(row, 21), foPct: n(row, 22)
        },
        goalie: { gp: n(row, 24), w: n(row, 25), otl: n(row, 27), so: n(row, 28), sv: n(row, 29), ga: n(row, 31) }
      });
    }
    return byName;
  }

  // Names listed in a position sheet's column A, below its two header rows.
  function sheetMembers(rows) {
    const names = [];
    for (let r = 2; r < (rows || []).length; r++) {
      const name = rows[r] && rows[r][0];
      if (name) names.push(String(name).trim());
    }
    return names;
  }

  // Which position sheet a List row values the player in, read from its
  // formula: VLOOKUP(B3,'C'!A1:F210,...). Shared-formula rows carry no text,
  // so fall back to the workbook's convention: the last listed position.
  function sheetFromFormula(formula) {
    const match = formula && formula.match(/VLOOKUP\(B\d+,'?([A-Z]+)'?!/);
    return match ? match[1] : null;
  }

  /**
   * Everything valuation.js needs to recompute VORP and ranks, or null when
   * the workbook lacks the sheets (the board then just shows the saved RK).
   */
  function buildModel(sheets, players, settings) {
    const playerData = parsePlayerData(sheets[PLAYER_DATA_SHEET]);
    const memberSheets = {};
    for (const pos of POSITION_SHEETS) {
      if (!sheets[pos]) return null;
      memberSheets[pos] = sheetMembers(sheets[pos]);
    }
    if (!playerData.size) return null;

    const listFormulas = sheets.formulas[LIST_SHEET] || [];
    const header = (sheets[LIST_SHEET][0] || []).map((h) => String(h || '').trim().toUpperCase());
    const vorpCol = header.indexOf('VORP');
    const posCol = header.indexOf('POS');
    const formulaByName = new Map();
    sheets[LIST_SHEET].forEach((row, r) => {
      if (r === 0 || !row || !row[1]) return;
      const f = listFormulas[r] || [];
      formulaByName.set(String(row[1]).trim(), { value: f[vorpCol], rank: f[posCol + 1] });
    });

    const modelPlayers = [];
    for (const p of players) {
      const data = playerData.get(p.name);
      if (!data) continue;
      const f = formulaByName.get(p.name) || {};
      const fallback = p.positions[p.positions.length - 1];
      const valueSheet = sheetFromFormula(f.value) || fallback;
      modelPlayers.push({
        name: p.name,
        isGoalie: p.positions.includes('G'),
        boost: p.boostRaw,
        valueSheet,
        rankSheet: sheetFromFormula(f.rank) || valueSheet,
        gp: data.gp,
        rates: data.rates,
        goalie: data.goalie
      });
    }

    return {
      players: modelPlayers,
      sheets: memberSheets,
      starters: settings.starters,
      draftCounts: settings.draftCounts,
      boostTable: settings.boostTable,
      pointsWeights: settings.pointsWeights,
      categoryFlags: settings.categoryFlags
    };
  }

  /** @returns { players, settings, model } */
  async function importWorkbook(buffer) {
    const sheets = await YDR.xlsx.readSheets(
      buffer,
      [LIST_SHEET, SETTINGS_SHEET, PLAYER_DATA_SHEET, ...POSITION_SHEETS],
      [LIST_SHEET],
      [LIST_SHEET]
    );
    if (!sheets[LIST_SHEET]) throw new Error(`No "${LIST_SHEET}" sheet in this workbook`);
    const players = parseList(sheets[LIST_SHEET], sheets.colors[LIST_SHEET]);
    if (players.length === 0) throw new Error(`"${LIST_SHEET}" has no ranked players — was it saved in Excel?`);
    const settings = parseSettings(sheets[SETTINGS_SHEET]);
    return { players, settings, model: buildModel(sheets, players, settings) };
  }

  const api = { importWorkbook, parseList, parseSettings, OPTION_VALUES };
  YDR.workbook = api;

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis.YDR);
