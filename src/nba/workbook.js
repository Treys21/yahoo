// Reads 2026-27-NBA-Roto-Values.xlsx (nba/build.py) into a board:
//   players  — Player Data projections + your ADJ marks from The List +
//              minutes, injuries and your overrides from Minutes & Health
//   settings — category weights, teams, roster slots, GP mode, boosts
//   schedule — [[dateSerial, team], ...] from the Schedule sheet
// Settings cells are found by their labels, so moving rows in Excel is fine.
globalThis.YDR = globalThis.YDR || {};

(function (YDR) {
  'use strict';

  const SHEETS = ['Settings', 'Player Data', 'The List', 'Minutes & Health', 'Schedule'];
  const STAT_HEADERS = { PTS: 'PTS', REB: 'REB', AST: 'AST', STL: 'STL', BLK: 'BLK', '3PM': '3PM', TO: 'TO' };

  function num(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function header(row) {
    const index = new Map();
    (row || []).forEach((label, col) => {
      if (label !== undefined && label !== null) index.set(String(label).trim().toUpperCase(), col);
    });
    return (label) => index.get(label.toUpperCase());
  }

  function parseSettings(rows) {
    const cell = (r, c) => (rows[r] || [])[c];
    const byLabel = (col, label) => {
      for (let r = 0; r < rows.length; r++) {
        if (String(cell(r, col) ?? '').trim().toLowerCase() === label.toLowerCase()) return cell(r, col + 2);
      }
      return undefined;
    };
    const weights = {};
    const slots = {};
    const boostTable = {};
    for (let r = 1; r < rows.length; r++) {
      const cat = String(cell(r, 0) ?? '').trim();
      if (YDR.nbaModel.CATEGORIES.includes(cat)) weights[cat] = num(cell(r, 1)) ?? 0;
      const slot = String(cell(r, 7) ?? '').trim();
      if (slot in YDR.nbaModel.DEFAULT_SLOTS) slots[slot] = num(cell(r, 8)) ?? 0;
      const mark = String(cell(r, 3) ?? '').trim();
      if (/^[+-]( [+-])*$/.test(mark)) boostTable[mark] = num(cell(r, 5)) ?? 0;
    }
    if (Object.keys(weights).length !== YDR.nbaModel.CATEGORIES.length) {
      throw new Error('Settings is missing the category weights (A2:B10)');
    }
    return {
      weights,
      slots: Object.keys(slots).length ? slots : Object.assign({}, YDR.nbaModel.DEFAULT_SLOTS),
      teams: num(byLabel(3, 'Number of Teams')) || 12,
      gpProjection: String(byLabel(3, 'Games Played Projection') ?? 'Yes').trim().toLowerCase() !== 'no',
      flatGp: num(byLabel(3, 'Flat GP')) || 75,
      boosts: String(byLabel(3, 'Boost or Bust') ?? 'ON').trim().toUpperCase() !== 'OFF',
      boostTable
    };
  }

  function parseMinutes(rows) {
    const h = header(rows[0] || []);
    const out = new Map();
    if (h('Player') === undefined) return out;
    for (const row of rows.slice(1)) {
      if (!row || !row[h('Player')]) continue;
      const get = (label) => (h(label) === undefined ? undefined : row[h(label)]);
      out.set(String(get('Player')), {
        mpg: num(get('Proj MPG')),
        mpg25: num(get('25-26 MPG')),
        gp25: num(get('25-26 GP')),
        status: String(get('Status') ?? ''),
        returnDate: num(get('Return')),
        yourGp: num(get('Your GP')),
        yourMpg: num(get('Your MPG')),
        note: String(get('Note') ?? '')
      });
    }
    return out;
  }

  function parseSchedule(rows) {
    return (rows || []).slice(1).filter((r) => r && num(r[0]) && r[1]).map((r) => [num(r[0]), String(r[1])]);
  }

  function parsePlayers(dataRows, listRows, minutesRows) {
    const minutes = parseMinutes(minutesRows);
    const h = header(dataRows[0]);
    for (const label of ['Player', 'Pos', 'GP', 'FG%', 'FT%', 'FGA (est.)', 'FTA (est.)']) {
      if (h(label) === undefined) throw new Error(`"Player Data" is missing a ${label} column`);
    }
    const lh = header(listRows[0] || []);
    const adjByName = new Map();
    if (lh('NAME') !== undefined && lh('ADJ') !== undefined) {
      for (const row of listRows.slice(1)) {
        if (row && row[lh('NAME')]) adjByName.set(row[lh('NAME')], String(row[lh('ADJ')] ?? '').trim());
      }
    }

    const players = [];
    for (const row of dataRows.slice(1)) {
      if (!row || !row[h('Player')]) continue;
      const get = (label) => row[h(label)];
      const stats = {};
      for (const [cat, label] of Object.entries(STAT_HEADERS)) stats[cat] = num(get(label)) ?? 0;
      const gp = num(get('GP'));
      if (!gp) continue;
      players.push({
        name: String(get('Player')),
        team: String(get('Team') ?? ''),
        positions: String(get('Pos') ?? '').split(',').map((p) => p.trim()).filter(Boolean),
        gp,
        min: num(get('MIN')),
        stats,
        fgPct: num(get('FG%')) ?? 0,
        ftPct: num(get('FT%')) ?? 0,
        fga: num(get('FGA (est.)')) ?? 0,
        fta: num(get('FTA (est.)')) ?? 0,
        adp: num(get('Yahoo ADP')),
        adpEspn: num(get('ESPN ADP')),
        adj: adjByName.get(String(get('Player'))) || '',
        ...minutesFor(minutes.get(String(get('Player'))), gp, num(get('MIN')))
      });
    }
    if (!players.length) throw new Error('"Player Data" has no players');
    return players;
  }

  // Without a Minutes & Health sheet (older workbooks) minutes come from Player Data.
  function minutesFor(m, gp, min) {
    const fallback = { mpg: Math.round((min / gp) * 10) / 10, mpg25: null, gp25: null, status: '', returnDate: null, yourGp: null, yourMpg: null, note: '' };
    if (!m) return fallback;
    return { ...m, mpg: m.mpg ?? fallback.mpg };
  }

  /** @returns { players, settings, schedule } */
  async function importWorkbook(buffer) {
    const sheets = await YDR.xlsx.readSheets(buffer, SHEETS);
    for (const name of ['Settings', 'Player Data']) {
      if (!sheets[name]) throw new Error(`This isn't the NBA roto workbook (no "${name}" sheet)`);
    }
    return {
      players: parsePlayers(sheets['Player Data'], sheets['The List'] || [], sheets['Minutes & Health'] || []),
      settings: parseSettings(sheets.Settings),
      schedule: parseSchedule(sheets.Schedule)
    };
  }

  const api = { importWorkbook };
  YDR.nbaWorkbook = api;

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis.YDR);
