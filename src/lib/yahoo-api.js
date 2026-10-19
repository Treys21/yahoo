// Yahoo's draft client loads its player pool from a public JSON endpoint. We
// fetch the same list so every websocket pick (a bare Yahoo player id) can be
// resolved to a full name, team and positions — and then to your ranking.
globalThis.YDR = globalThis.YDR || {};

(function (YDR) {
  'use strict';

  // The draft URL says "hockey" (or "nba"); the API wants the sport's game code.
  const GAME_CODES = { hockey: 'nhl', nhl: 'nhl', basketball: 'nba', nba: 'nba' };

  /** /draftclient/hockey/<draftId>/<teamId>, /draftclient/nba/<draftId>/<teamId> */
  function parseDraftRoute(url) {
    const match = String(url).match(/\/draftclient\/([a-z]+)\/(\d+)\/(\d+)/i);
    if (!match) return null;
    return {
      game: GAME_CODES[match[1].toLowerCase()] || match[1].toLowerCase(),
      draftId: match[2],
      teamId: parseInt(match[3], 10)
    };
  }

  function toPlayer(raw) {
    let positions = raw.pos;
    if (typeof positions === 'string') {
      try {
        positions = JSON.parse(positions);
      } catch {
        positions = positions.split(',');
      }
    }
    if (!Array.isArray(positions) || positions.length === 0) {
      positions = String(raw.display_pos || '').split(',');
    }
    return {
      id: raw.id,
      name: `${raw.fname || ''} ${raw.lname || ''}`.trim(),
      team: YDR.match.normalizeTeam(raw.team_abbr),
      positions: positions.map((p) => String(p).trim().toUpperCase()).filter(Boolean)
    };
  }

  function parsePlayers(json) {
    const list = json && json.service && json.service.player_list;
    if (!Array.isArray(list)) throw new Error('Unexpected Yahoo players response');
    return list.map(toPlayer);
  }

  async function getPlayers(route) {
    const url = `https://pub-api.fantasysports.yahoo.com/fantasy/v3/players/${route.game}/${route.draftId}`;
    const response = await fetch(url, { credentials: 'include' });
    if (!response.ok) throw new Error(`Yahoo players ${response.status}`);
    return parsePlayers(await response.json());
  }

  /**
   * Link each ranking to a Yahoo player.
   *
   * Rankings the sheet disambiguated by hand ("Elias Pettersson (D)") claim
   * their player first. If a ranking's best match is already claimed, it falls
   * back to the one unclaimed Yahoo player with the same name and team — this
   * rescues namesakes whose sheet position is wrong.
   *
   * @returns { links: Map<ranking, yahooPlayer>, byYahooId: Map<id, ranking>, unmatched: ranking[] }
   */
  function linkRankings(rankings, yahooPlayers) {
    const index = YDR.match.buildIndex(yahooPlayers);
    const links = new Map();
    const byYahooId = new Map();
    const unmatched = [];
    const tagged = (r) => /\(.*\)/.test(r.name);
    const ordered = rankings.filter(tagged).concat(rankings.filter((r) => !tagged(r)));

    for (const ranking of ordered) {
      let player = YDR.match.matchPlayer(ranking, index);
      if (player && byYahooId.has(player.id)) {
        const namesakes = (index.byName.get(YDR.match.normalizeName(ranking.name)) || []).filter(
          (p) => p.team === ranking.team && !byYahooId.has(p.id)
        );
        player = namesakes.length === 1 ? namesakes[0] : null;
      }
      if (player) {
        links.set(ranking, player);
        byYahooId.set(player.id, ranking);
      } else {
        unmatched.push(ranking);
      }
    }
    return { links, byYahooId, unmatched };
  }

  const api = { parseDraftRoute, parsePlayers, getPlayers, linkRankings };
  YDR.yahoo = api;

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis.YDR);
