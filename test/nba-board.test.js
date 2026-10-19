const test = require('node:test');
const assert = require('node:assert/strict');
const { YDR, loadNbaBoard } = require('./helpers');

// Every projected player linked to a made-up Yahoo id (1, 2, 3, ... in sheet order).
async function setup() {
  const board = await loadNbaBoard();
  const links = new Map(board.players.map((p, i) => [p, { id: i + 1, name: p.name, team: p.team, positions: p.positions }]));
  const idOf = (name) => links.get(board.players.find((p) => p.name === name)).id;
  return { board, links, idOf };
}

function draftWith(frames) {
  const state = YDR.protocol.createState();
  frames.forEach((f) => YDR.protocol.apply(state, f));
  return state;
}

test('a live draft: picks drop off, mine are tracked, the queue skips drafted players', async () => {
  const { board, links, idOf } = await setup();
  const order = [3, 7, 1, 2, 4, 5, 6, 8, 9, 10, 11, 12];
  const draft = draftWith([
    `R|${order.join('|')}`,
    `0|1|${idOf('Nikola Jokic')}|3|C|0`,
    `0|2|${idOf('Shai Gilgeous-Alexander')}|7|PG|0`,
    `0|3|${idOf('Victor Wembanyama')}|1|C|0`, // me
    `0|4|${idOf('Luka Doncic')}|2|PG|0`,
    'D|5|4|30'
  ]);
  const myPick = YDR.protocol.nextPickFor(draft, 1, 5, 12);
  const built = YDR.nbaBoard.createBoard().build(board, {}, {
    links, picks: draft.picks.values(), myTeamId: 1, teamIds: order, teams: 12,
    currentPick: 5, myPick, followingPick: YDR.protocol.nextPickFor(draft, 1, myPick + 1, 12)
  });

  assert.equal(myPick, 22); // pick 3 in round 1 → 22nd overall in round 2
  const wemby = built.rows.find((r) => r.name === 'Victor Wembanyama');
  assert.equal(wemby.byMe, true);
  assert.equal(wemby.pickNo, 3);
  assert.equal(built.rec.myOpen, 12);
  assert.ok(built.rec.outlook.BLK > 6.5, 'Wembanyama already helps blocks');
  const drafted = new Set([1, 2, 3, 4].map((n) => draft.picks.get(n).playerId));
  assert.equal(built.queueYahooIds.length, YDR.nbaRecommend.QUEUE_SIZE);
  assert.ok(built.queueYahooIds.every((id) => !drafted.has(id)));
  assert.ok(built.rows.filter((r) => r.queued).every((r) => !r.pickNo));
});

test('players marked drafted by hand leave the pool without joining a roster', async () => {
  const { board, links } = await setup();
  const built = YDR.nbaBoard.createBoard().build(board, {}, { links, manual: new Set(['Nikola Jokic']), myTeamId: 1 });
  const jokic = built.rows.find((r) => r.name === 'Nikola Jokic');
  assert.equal(jokic.manual, true);
  assert.equal(jokic.order, null);
  assert.equal(built.rec.myOpen, 13);
});

test('punting FT% from the panel re-values the board; reset drops the override', async () => {
  const { board } = await setup();
  const state = YDR.nbaBoard.createBoard();
  const base = state.build(board, {}).rows.find((r) => r.name === 'Giannis Antetokounmpo');
  const punt = YDR.nbaBoard.toggleCategory(board, {}, 'FT%');
  assert.deepEqual(punt, { weights: { 'FT%': 0 } });
  const punted = state.build(board, punt).rows.find((r) => r.name === 'Giannis Antetokounmpo');
  assert.ok(punted.rank < base.rank, `${punted.rank} vs ${base.rank}`);
  assert.deepEqual(YDR.nbaBoard.toggleCategory(board, punt, 'FT%'), {});
  assert.deepEqual(YDR.nbaBoard.mergeOverrides(board, punt, null), {});
  assert.deepEqual(YDR.nbaBoard.mergeOverrides(board, {}, { gpProjection: true }), {}, 'same as the workbook');
});

test('offline practice: players marked mine form your roster', async () => {
  const board = await loadNbaBoard();
  const built = YDR.nbaBoard.createBoard().build(board, {}, {
    mine: new Set(['Nikola Jokic', 'Stephen Curry']), manual: new Set(['Shai Gilgeous-Alexander']),
    myTeamId: 1, teamIds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
  });
  assert.equal(built.rec.myOpen, 11);
  const jokic = built.rows.find((r) => r.name === 'Nikola Jokic');
  assert.equal(jokic.byMe, true);
  assert.ok(jokic.starts > 70, 'his starts come from your lineup');
  assert.ok(built.rec.outlook['3PM'] > 6.5 && built.rec.outlook.REB > 6.5);
  assert.equal(built.rows.find((r) => r.name === 'Shai Gilgeous-Alexander').byMe, false);
});
