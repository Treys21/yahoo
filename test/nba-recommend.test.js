const test = require('node:test');
const assert = require('node:assert/strict');
const { YDR, loadNbaBoard } = require('./helpers');

const R = YDR.nbaRecommend;
const TEAMS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

async function valuedPlayers() {
  const { players, settings } = await loadNbaBoard();
  const valued = YDR.nbaModel.valuate(players, settings);
  const rows = players.map((p) => {
    const v = valued.byName.get(p.name);
    return { name: p.name, positions: p.positions, z: v.z, value: v.value, adp: p.adp, teamId: null };
  });
  return { rows, settings };
}

function ctx(rows, settings, extra = {}) {
  return { players: rows, teamIds: TEAMS, myTeamId: 1, slots: settings.slots, weights: settings.weights,
    currentPick: 1, myPick: 1, followingPick: 24, ...extra };
}

test('normal CDF', () => {
  assert.ok(Math.abs(R.phi(0) - 0.5) < 1e-7);
  assert.ok(Math.abs(R.phi(1.96) - 0.975) < 1e-4);
  assert.ok(Math.abs(R.phi(-1) - 0.158655) < 1e-4);
});

test('before any picks, GAIN ranks the top of the board like VALUE', async () => {
  const { rows, settings } = await valuedPlayers();
  const rec = R.recommend(ctx(rows, settings));
  const byGain = rec.candidates.slice().sort((a, b) => b.gain - a.gain).map((c) => c.name);
  const byValue = rows.slice().sort((a, b) => b.value - a.value).map((r) => r.name);
  assert.deepEqual(byGain.slice(0, 3), byValue.slice(0, 3));
  assert.equal(rec.myOpen, 13);
  for (const c of YDR.nbaModel.CATEGORIES) assert.ok(Math.abs(rec.outlook[c] - 6.5) < 1e-6, 'all teams even');
});

test('a team stacked in big-man stats is steered toward the categories it lacks', async () => {
  const { rows, settings } = await valuedPlayers();
  const before = R.recommend(ctx(rows, settings, { currentPick: 49, myPick: 49, followingPick: 72 }));
  // Give me four bigs: elite REB/BLK/FG%, weak 3PM / FT% / AST.
  const bigs = ['Victor Wembanyama', 'Walker Kessler', 'Jalen Duren', 'Anthony Davis'];
  const mine = rows.map((r) => (bigs.includes(r.name) ? { ...r, teamId: 1 } : r));
  const after = R.recommend(ctx(mine, settings, { currentPick: 49, myPick: 49, followingPick: 72 }));

  assert.ok(after.outlook.BLK > 9 && after.outlook['3PM'] < 5, 'outlook reflects the roster');
  // A shooter now beats a shot-blocker by more than he did for an empty roster.
  const edge = (rec) => rec.byName.get('Stephen Curry').gain - rec.byName.get('Alex Sarr').gain;
  assert.ok(edge(after) > edge(before), `${edge(after)} vs ${edge(before)}`);
  // And the blocks he'd add are worth less than before: that race is already won.
  assert.ok(after.byName.get('Alex Sarr').catGain.BLK < before.byName.get('Alex Sarr').catGain.BLK);
});

test('roster feasibility: with one pick left and no center, only centers are offered', async () => {
  const { rows, settings } = await valuedPlayers();
  const guards = rows.filter((r) => !r.positions.includes('C') && !r.positions.includes('PF')).slice(0, 12);
  const mine = new Set(guards.map((g) => g.name));
  const withMine = rows.map((r) => (mine.has(r.name) ? { ...r, teamId: 1 } : r));
  const rec = R.recommend(ctx(withMine, settings, { currentPick: 145, myPick: 145, followingPick: null }));
  assert.equal(rec.myOpen, 1);
  assert.ok(rec.needs.length > 1, `needs ${rec.needs}`);
  // 12 guards/wings can't fill C, C and PF, so there is no single pick that completes the lineup.
  assert.equal(rec.ranked.length, 0);
});

test('feasible picks fill the open slot', async () => {
  const { rows, settings } = await valuedPlayers();
  const pool = rows.slice().sort((a, b) => b.value - a.value);
  const take = [];
  const counts = { C: 0 };
  // 12 players that fill everything except one C.
  for (const r of pool) {
    if (take.length === 12) break;
    if (r.positions.includes('C')) {
      if (counts.C >= 1) continue;
      counts.C++;
    }
    take.push(r.name);
  }
  const mine = rows.map((r) => (take.includes(r.name) ? { ...r, teamId: 1 } : r));
  const rec = R.recommend(ctx(mine, settings, { currentPick: 145, myPick: 145, followingPick: null }));
  assert.deepEqual(rec.needs, ['C']);
  assert.ok(rec.ranked.length > 0);
  assert.ok(rec.ranked.every((c) => c.positions.includes('C')));
});

test('survival: late-ADP players come back, imminent ones do not', async () => {
  const { rows, settings } = await valuedPlayers();
  const rec = R.recommend(ctx(rows, settings, { currentPick: 12, myPick: 12, followingPick: 13 }));
  // At the turn (12 then 13) nothing can be taken in between.
  for (const c of rec.candidates) assert.ok(c.back > 0.99, `${c.name} ${c.back}`);

  const wide = R.recommend(ctx(rows, settings, { currentPick: 1, myPick: 1, followingPick: 24 }));
  assert.ok(wide.byName.get('Victor Wembanyama').back < 0.01);
  assert.ok(wide.byName.get('Tobias Harris').back > 0.99);
});

test('the queue holds the top feasible players by score, without drafted ones', async () => {
  const { rows, settings } = await valuedPlayers();
  const taken = rows.map((r, i) => (i < 5 ? { ...r, teamId: TEAMS[i + 1] } : r));
  const rec = R.recommend(ctx(taken, settings, { currentPick: 6, myPick: 6, followingPick: 19 }));
  assert.equal(rec.queue.length, R.QUEUE_SIZE);
  const draftedNames = new Set(taken.filter((r) => r.teamId).map((r) => r.name));
  assert.ok(rec.queue.every((n) => !draftedNames.has(n)));
  assert.deepEqual(rec.queue, rec.ranked.slice(0, R.QUEUE_SIZE).map((c) => c.name));
});

test('nightly lineups: five centers on a team that plays every night, two C + two Util slots', () => {
  const days = Array.from({ length: 100 }, (_, i) => i + 1);
  const season = { days, byTeam: new Map([['AAA', days]]) };
  const slots = R.starterSlots(YDR.nbaModel.DEFAULT_SLOTS);
  const centers = [5, 4, 3, 2, 1].map((priority) => ({ team: 'AAA', positions: ['C'], gp: 100, gamesOut: 0, priority }));
  const starts = R.simulateStarts(centers, slots, season);
  // Four slots × 82 = 328 games. Caps are per slot, so a player can start at C one
  // night and Util the next: the top three count all 100 games, the fourth gets
  // the last 28, the fifth never starts.
  assert.deepEqual(starts.map((s) => Math.round(s)), [100, 100, 100, 28, 0]);
});

test('nightly lineups: an injured player starts only after his return', () => {
  const days = Array.from({ length: 80 }, (_, i) => i + 1);
  const season = { days, byTeam: new Map([['AAA', days]]) };
  const slots = R.starterSlots(YDR.nbaModel.DEFAULT_SLOTS);
  const [starts] = R.simulateStarts([{ team: 'AAA', positions: ['PG'], gp: 40, gamesOut: 40, priority: 1 }], slots, season);
  assert.ok(Math.abs(starts - 40) < 1e-9);
});

test('with the real schedule, a sixth center sits; a point guard starts', async () => {
  const board = await loadNbaBoard();
  const links = new Map(board.players.map((p, i) => [p, { id: i + 1, name: p.name, team: p.team, positions: p.positions }]));
  const id = (name) => links.get(board.players.find((p) => p.name === name)).id;
  // C-only centers: they can use C, C, Util, Util — 328 capped games between them.
  const mine = ['Nikola Jokic', 'Walker Kessler', 'Jarrett Allen', 'Jalen Duren', 'Rudy Gobert'];
  const picks = mine.map((name, i) => ({ pickNo: 1 + i * 24, playerId: id(name), teamId: 1 }));
  const ctx = { links, picks, myTeamId: 1, teams: 12, teamIds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], currentPick: 121, myPick: 121, followingPick: 144 };

  const built = YDR.nbaBoard.createBoard().build(board, {}, ctx);
  const share = (name) => {
    const c = built.rec.byName.get(name);
    return c.starts / c.gp;
  };
  // Five C-only centers already need ~370 of those 328 games: a sixth barely plays.
  assert.ok(share('Jakob Poeltl') < 0.3, `Poeltl ${share('Jakob Poeltl')}`);
  // A point guard walks into an empty PG slot.
  assert.ok(share('Fred VanVleet') > 0.95, `VanVleet ${share('Fred VanVleet')}`);
  // Without a schedule there is no simulation.
  const flat = YDR.nbaBoard.createBoard().build({ ...board, schedule: [] }, {}, ctx);
  assert.equal(flat.rec.byName.get('Jakob Poeltl').starts, null);
});

test('a mid-draft rebuild with the nightly simulation stays fast', async () => {
  const board = await loadNbaBoard();
  const links = new Map(board.players.map((p, i) => [p, { id: i + 1, name: p.name, team: p.team, positions: p.positions }]));
  const picks = board.players.slice(0, 72).map((p, i) => ({ pickNo: i + 1, playerId: links.get(p).id, teamId: (i % 12) + 1 }));
  const state = YDR.nbaBoard.createBoard();
  const ctx = { links, picks, myTeamId: 5, teams: 12, teamIds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], currentPick: 73, myPick: 77, followingPick: 92 };
  state.build(board, {}, ctx); // warm the valuation memo
  const t = Date.now();
  state.build(board, {}, ctx);
  const ms = Date.now() - t;
  assert.ok(ms < 1500, `${ms}ms`);
  console.log(`rebuild with simulation: ${ms}ms`);
});

test('H2H: with every team even, each category is worth half the matchups', async () => {
  const { rows, settings } = await valuedPlayers();
  const rec = R.recommend(ctx(rows, settings, { scoring: 'h2h' }));
  assert.equal(rec.scoring, 'h2h');
  assert.equal(rec.maxPoints, R.H2H_WEEKS);
  for (const c of YDR.nbaModel.CATEGORIES) assert.ok(Math.abs(rec.outlook[c] - R.H2H_WEEKS / 2) < 1e-6, c);
});

test('H2H outlook stays within 0..H2H_WEEKS for every category', async () => {
  const { rows, settings } = await valuedPlayers();
  const mine = rows.map((r, i) => (i < 9 ? { ...r, teamId: 1 } : r));
  const rec = R.recommend(ctx(mine, settings, { scoring: 'h2h', currentPick: 40, myPick: 40, followingPick: 60 }));
  for (const c of YDR.nbaModel.CATEGORIES) {
    assert.ok(rec.outlook[c] >= 0 && rec.outlook[c] <= R.H2H_WEEKS, `${c}=${rec.outlook[c]}`);
  }
});

test('roto stays the default scoring and keeps its points scale', async () => {
  const { rows, settings } = await valuedPlayers();
  const rec = R.recommend(ctx(rows, settings));
  assert.equal(rec.scoring, 'roto');
  assert.equal(rec.maxPoints, TEAMS.length);
});
