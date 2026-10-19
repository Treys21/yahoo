const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBoard } = require('./helpers');

test('imports every ranked player from The List, in RK order', async () => {
  const { players } = await loadBoard();
  assert.equal(players.length, 670);
  assert.deepEqual(players.slice(0, 3).map((p) => p.name), ['Nathan MacKinnon', 'Connor McDavid', 'Cale Makar']);
  players.forEach((p, i) => i && assert.ok(p.rank >= players[i - 1].rank));
});

test('maps skater fields from cached formula values', async () => {
  const { players } = await loadBoard();
  const makar = players.find((p) => p.name === 'Cale Makar');
  assert.deepEqual(makar.positions, ['D']);
  assert.equal(makar.rank, 3);
  assert.equal(makar.posRank, 1);
  assert.equal(makar.team, 'COL');
  assert.equal(makar.vorp, 8.71);
  assert.equal(makar.adp, 7.3);
  assert.equal(makar.diff, 4.3);
  assert.equal(makar.stats.g, 22);
});

test('handles multi-position, goalies, boosts, dotted teams and missing ADP', async () => {
  const { players } = await loadBoard();
  const leon = players.find((p) => p.name === 'Leon Draisaitl');
  assert.deepEqual(leon.positions, ['C', 'LW']);

  const vasy = players.find((p) => p.name === 'Andrei Vasilevskiy');
  assert.deepEqual(vasy.positions, ['G']);
  assert.equal(vasy.team, 'TB'); // sheet writes "T.B"
  assert.equal(vasy.stats.w, 34);
  assert.equal(vasy.stats.gaa, 2.59);

  const dahlin = players.find((p) => p.name === 'Rasmus Dahlin');
  assert.equal(dahlin.boost, '++');

  assert.ok(players.some((p) => p.adp === null), "'—' ADP becomes null");
});

test('reads league settings', async () => {
  const { settings } = await loadBoard();
  assert.equal(settings.leagueType, 'Categories');
  assert.equal(settings.teams, 12);
  assert.deepEqual(settings.starters, { C: 2, LW: 2, RW: 2, D: 4, G: 2 });
});
