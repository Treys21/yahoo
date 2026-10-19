const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { YDR, fixture, readBuffer, loadNbaBoard } = require('./helpers');

// The shipped workbook, saved by Excel: its cached The List values are what
// Excel computed under the default Settings.
async function excelList() {
  const sheets = await YDR.xlsx.readSheets(readBuffer(fixture('nba-values.xlsx')), ['The List']);
  const [head, ...rows] = sheets['The List'];
  const col = (label) => head.indexOf(label);
  return new Map(rows.filter((r) => r && r[col('NAME')]).map((r) => [
    r[col('NAME')], [Number(r[col('RK')]), Number(r[col('VORP')]), Number(r[col('PRK')])]
  ]));
}

function check(valued, expected) {
  let n = 0;
  for (const [name, [rank, vorp, posRank]] of expected) {
    const v = valued.byName.get(name);
    assert.ok(v, `missing ${name}`);
    assert.ok(Math.abs(v.vorp - vorp) < 1e-6, `${name} vorp ${v.vorp} vs ${vorp}`);
    assert.equal(v.rank, rank, `${name} rank`);
    assert.equal(v.posRank, posRank, `${name} positional rank`);
    n++;
  }
  return n;
}

test('imports the workbook: projections, Yahoo defaults and ADP', async () => {
  const { players, settings } = await loadNbaBoard();
  const { schedule } = await loadNbaBoard();
  assert.equal(players.length, 265);
  assert.equal(schedule.length, 2400, '1,200 games, both teams');
  assert.equal(settings.teams, 12);
  assert.equal(settings.gpProjection, true);
  assert.equal(settings.boosts, true);
  assert.deepEqual(settings.slots, YDR.nbaModel.DEFAULT_SLOTS);
  assert.equal(settings.boostTable['+ +'], 0.1);
  assert.equal(Object.values(settings.weights).every((w) => w === 1), true);
  const jokic = players.find((p) => p.name === 'Nikola Jokic');
  assert.deepEqual(jokic.positions, ['C']);
  assert.equal(jokic.mpg, 36.2);
  assert.ok(jokic.mpg25 > 30);
  const williams = players.find((p) => p.name === 'Mark Williams');
  assert.equal(williams.status, 'Out');
  assert.ok(williams.returnDate > 46400, 'return date is an Excel serial in February 2027');
  assert.equal(jokic.adp, 2);
  assert.ok(jokic.fga > 1000 && jokic.fta > 400);
});

test("reproduces Excel's values under the default Settings", async () => {
  const { players, settings, schedule } = await loadNbaBoard();
  const valued = YDR.nbaModel.valuate(players, settings, schedule);
  assert.equal(check(valued, await excelList()), 265);
  assert.equal(valued.poolSize, 156);
});

const recalcs = JSON.parse(fs.readFileSync(fixture('nba-excel-recalcs.json'), 'utf8'));
for (const { scenario, options, adj, minutes, expected } of recalcs) {
  test(`matches Excel's recalculation: ${scenario}`, async () => {
    const board = await loadNbaBoard();
    const players = board.players.map((p) => ({ ...p, adj: adj[p.name] || '', ...(minutes[p.name] || {}) }));
    const valued = YDR.nbaModel.valuate(players, { ...board.settings, ...options }, board.schedule);
    assert.equal(check(valued, new Map(Object.entries(expected))), 265);
  });
}

test('an injury caps games at what is left after the return date', async () => {
  const { players, settings, schedule } = await loadNbaBoard();
  const byTeam = YDR.nbaModel.teamDates(schedule);
  const williams = players.find((p) => p.name === 'Mark Williams');
  const m = YDR.nbaModel.minutes(williams, byTeam);
  assert.ok(m.gamesOut > 40 && m.gamesOut < 55, `${m.gamesOut}`);
  assert.equal(m.gpUsed, Math.min(williams.gp, 82 - m.gamesOut));
  const valued = YDR.nbaModel.valuate(players, settings, schedule);
  assert.equal(valued.byName.get('Mark Williams').stats.gamesOut, m.gamesOut);
});
