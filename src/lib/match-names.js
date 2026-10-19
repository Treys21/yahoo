// Spreadsheet names never match Yahoo's strings exactly, so both sides get
// normalized before comparison. Pure logic — also loaded by the tests.
globalThis.YDR = globalThis.YDR || {};

(function (YDR) {
  'use strict';

  const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);

  // The sheet writes some teams with dots (T.B, N.J, L.A, S.J); Yahoo uses
  // other spellings for a few more. Everything maps to one canonical code.
  const TEAM_ALIASES = {
    TB: 'TB', TBL: 'TB',
    NJ: 'NJ', NJD: 'NJ',
    LA: 'LA', LAK: 'LA',
    SJ: 'SJ', SJS: 'SJ',
    VGK: 'VGK', VEG: 'VGK', LV: 'VGK',
    WSH: 'WSH', WAS: 'WSH',
    MTL: 'MTL', MON: 'MTL',
    CBJ: 'CBJ', CLS: 'CBJ',
    UTA: 'UTA', UTAH: 'UTA', UHC: 'UTA',
    NSH: 'NSH', NAS: 'NSH',
    CGY: 'CGY', CAL: 'CGY',
    WPG: 'WPG', WIN: 'WPG',
    // NBA: FantasyPros and Yahoo spell a few teams differently.
    GS: 'GS', GSW: 'GS',
    NY: 'NY', NYK: 'NY',
    SA: 'SA', SAS: 'SA',
    NO: 'NO', NOP: 'NO', NOR: 'NO',
    PHO: 'PHO', PHX: 'PHO',
    UTH: 'UTA',
    BKN: 'BKN', BRK: 'BKN', BK: 'BKN',
    CHA: 'CHA', CHO: 'CHA'
  };

  function normalizeTeam(team) {
    if (!team) return '';
    const code = String(team).toUpperCase().replace(/[^A-Z]/g, '');
    return TEAM_ALIASES[code] || code;
  }

  // "Pierre-Luc Dubois" -> "pierreluc dubois", "Alexis Lafrenière" -> "alexis lafreniere"
  function normalizeName(name) {
    if (!name) return '';
    return String(name)
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/\([^)]*\)/g, ' ') // the sheet disambiguates with "Elias Pettersson (D)"
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter((part, index, parts) => {
        if (!part) return false;
        return !(index === parts.length - 1 && index > 1 && SUFFIXES.has(part));
      })
      .join(' ')
      .trim();
  }

  function lastName(name) {
    const parts = normalizeName(name).split(' ');
    return parts[parts.length - 1] || '';
  }

  /**
   * Index the rankings so draft picks (and Yahoo row names) resolve back to a
   * ranked player. Ambiguous keys stay arrays so a tie is broken deliberately.
   */
  function buildIndex(players) {
    const byName = new Map();
    const byLastTeam = new Map();
    for (const player of players) {
      const key = normalizeName(player.name);
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key).push(player);

      const lastKey = `${lastName(player.name)}|${player.team}`;
      if (!byLastTeam.has(lastKey)) byLastTeam.set(lastKey, []);
      byLastTeam.get(lastKey).push(player);
    }
    return { byName, byLastTeam };
  }

  /**
   * Resolve a Yahoo player ({ name, team?, positions? }) to a ranked player,
   * or null when nothing is confident enough.
   */
  function matchPlayer(target, index) {
    const team = normalizeTeam(target.team);
    const positions = target.positions || [];
    const candidates = index.byName.get(normalizeName(target.name));

    if (candidates && candidates.length === 1) return candidates[0];
    if (candidates && candidates.length > 1) {
      if (team) {
        const byTeam = candidates.filter((c) => c.team === team);
        if (byTeam.length === 1) return byTeam[0];
      }
      if (positions.length) {
        const byPos = candidates.filter((c) => c.positions.some((p) => positions.includes(p)));
        if (byPos.length === 1) return byPos[0];
      }
      return null;
    }

    // Nickname / transliteration fallback ("Mitch" vs "Mitchell", "Yegor" vs
    // "Egor"): last name + team, unique only, and either the first initial or
    // a position has to agree so it can't grab a different player.
    if (!team) return null;
    const fallback = index.byLastTeam.get(`${lastName(target.name)}|${team}`);
    if (!fallback || fallback.length !== 1) return null;
    const candidate = fallback[0];
    const sameInitial = normalizeName(candidate.name)[0] === normalizeName(target.name)[0];
    const samePosition = candidate.positions.some((p) => positions.includes(p));
    return sameInitial || samePosition ? candidate : null;
  }

  const api = { normalizeName, normalizeTeam, buildIndex, matchPlayer };
  YDR.match = api;

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis.YDR);
