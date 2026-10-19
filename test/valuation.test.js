const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { YDR, fixture, loadBoard } = require('./helpers');

// Ranks/VORP that Excel itself produced after changing Settings on a copy of
// the workbook and recalculating (scripted through Microsoft Excel).
const recalcs = JSON.parse(fs.readFileSync(fixture('excel-recalcs.json'), 'utf8'));

function check(valued, expected) {
  let checked = 0;
  for (const [name, [rank, vorp, posRank]] of Object.entries(expected)) {
    const v = valued.byName.get(name);
    assert.ok(v, `missing ${name}`);
    assert.equal(v.rank, rank, `${name} rank`);
    assert.ok(Math.abs(v.vorp - vorp) < 0.006, `${name} vorp ${v.vorp} vs ${vorp}`);
    assert.equal(v.posRank, posRank, `${name} positional rank`);
    checked++;
  }
  return checked;
}

test('reproduces the saved workbook exactly (Categories · 12 · Blend · GP on)', async () => {
  const { players, settings, model } = await loadBoard();
  const valued = YDR.valuation.valuate(model, {
    leagueType: settings.leagueType, gpProjection: settings.gpProjection, forwards: settings.forwards,
    replacement: settings.replacement, teams: settings.teams, boosts: true
  });
  const expected = Object.fromEntries(players.map((p) => [p.name, [p.rank, p.vorp, p.posRank]]));
  assert.equal(check(valued, expected), 670);
  assert.deepEqual(valued.levels, { C: 23, LW: 21, RW: 22, D: 37, G: 21, F: 66 });
});

for (const { scenario, options, expected } of recalcs) {
  test(`matches Excel's recalculation: ${scenario}`, async () => {
    const { model } = await loadBoard();
    assert.equal(check(YDR.valuation.valuate(model, options), expected), 670);
  });
}

test('turning boosts off removes their effect', async () => {
  const { model, settings } = await loadBoard();
  const base = { leagueType: 'Categories', gpProjection: true, forwards: 'C/LW/RW', replacement: 'Blend', teams: 12 };
  const on = YDR.valuation.valuate(model, { ...base, boosts: true }).byName.get('Rasmus Dahlin');
  const off = YDR.valuation.valuate(model, { ...base, boosts: false }).byName.get('Rasmus Dahlin');
  assert.ok(on.vorp > off.vorp, 'a "+ +" boost raises his value');
  assert.ok(Math.abs(off.stats.g - on.stats.g / 1.1) < 1e-9);
  assert.equal(settings.boostTable['+ +'], 0.1);
});

test('reads the colour legend markers from font colours', async () => {
  const { players } = await loadBoard();
  const count = (key, sign) => players.filter((p) => p.markers[key] === sign).length;
  assert.equal(count('sos', 1), 206);
  assert.equal(count('sos', -1), 212);
  assert.equal(count('age', 1), 167);
  assert.equal(count('age', -1), 210);
  assert.equal(count('contract', 1), 181);
  assert.equal(count('toi', 1), 95);
  assert.equal(count('toi', -1), 110);
  assert.equal(count('pp1', 1), 111);
  assert.equal(count('pp1Partial', 1), 57);
  assert.deepEqual(players.find((p) => p.name === 'Lane Hutson').markers, { sos: -1, age: 1, pp1: 1 });
});
