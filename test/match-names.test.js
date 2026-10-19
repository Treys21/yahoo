const test = require('node:test');
const assert = require('node:assert/strict');
const { YDR, loadBoard, loadYahooPlayers } = require('./helpers');

test('normalizes names and teams', () => {
  assert.equal(YDR.match.normalizeName('Alexis Lafrenière'), 'alexis lafreniere');
  assert.equal(YDR.match.normalizeName('Elias Pettersson (D)'), 'elias pettersson');
  assert.equal(YDR.match.normalizeName('Pierre-Luc Dubois'), 'pierreluc dubois');
  for (const [raw, code] of [['T.B', 'TB'], ['N.J', 'NJ'], ['L.A', 'LA'], ['S.J', 'SJ'], ['TBL', 'TB'], ['VGK', 'VGK']]) {
    assert.equal(YDR.match.normalizeTeam(raw), code);
  }
});

test('every ranked player links to exactly one Yahoo player', async () => {
  const { players } = await loadBoard();
  const { links, byYahooId, unmatched } = YDR.yahoo.linkRankings(players, loadYahooPlayers());
  assert.deepEqual(unmatched.map((p) => p.name), []);
  assert.equal(byYahooId.size, players.length);
  assert.equal(links.get(players.find((p) => p.name === 'Connor McDavid')).id, 6743);
});

test('namesakes on the same team resolve to different Yahoo players', async () => {
  const { players } = await loadBoard();
  const { links } = YDR.yahoo.linkRankings(players, loadYahooPlayers());
  const forward = links.get(players.find((p) => p.name === 'Elias Pettersson'));
  const defense = links.get(players.find((p) => p.name === 'Elias Pettersson (D)'));
  assert.equal(defense.id, 32762);
  assert.equal(forward.id, 7520);
  assert.deepEqual(forward.positions, ['C']); // sheet mislabels him D
});

test('transliterated first names fall back to last name + team', async () => {
  const { players } = await loadBoard();
  const { links } = YDR.yahoo.linkRankings(players, loadYahooPlayers());
  assert.equal(links.get(players.find((p) => p.name === 'Yegor Chinakhov')).name, 'Egor Chinakhov');
});

test('same name on different teams is broken by team', () => {
  const index = YDR.match.buildIndex(loadYahooPlayers());
  const carolina = YDR.match.matchPlayer({ name: 'Sebastian Aho', team: 'CAR', positions: ['C'] }, index);
  const pittsburgh = YDR.match.matchPlayer({ name: 'Sebastian Aho', team: 'PIT', positions: ['D'] }, index);
  assert.notEqual(carolina.id, pittsburgh.id);
});
