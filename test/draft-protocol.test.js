const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { YDR, fixture } = require('./helpers');

const P = YDR.protocol;
const liveFrames = JSON.parse(fs.readFileSync(fixture('ws-frames.json'), 'utf8'));

test('applies live PICK_MADE / CURRENT_PICK_CHANGED frames captured from a mock draft', () => {
  const state = P.createState();
  liveFrames.forEach((f) => P.apply(state, f));
  assert.equal(state.picks.size, 28); // picks 12..39
  assert.deepEqual(state.picks.get(12), { pickNo: 12, playerId: 7528, teamId: 12, pos: 'C', keeper: false });
  assert.deepEqual(state.onClock, { pickNo: 40, teamId: 9, countdown: 30 });
});

test('PICK_LIST_CHANGED replaces history and skips empty slots', () => {
  const state = P.createState();
  P.apply(state, '0|99|1|1|C|0');
  P.apply(state, 'P|1=6743,1,0|2=3358,2,0|3=,3,');
  assert.deepEqual([...state.picks.keys()], [1, 2]);
  assert.equal(state.picks.get(2).playerId, 3358);
});

test('PICK_UNDONE, keepers and reset', () => {
  const state = P.createState();
  P.apply(state, '0|1|6743|1|C|0');
  P.apply(state, 'K|24=7908|36=5057');
  assert.equal(state.picks.size, 3);
  assert.equal(state.picks.get(24).keeper, true);
  P.apply(state, 'u|1|1|6743');
  assert.equal(state.picks.has(1), false);
  P.apply(state, 'P|2=3358,2,0');
  assert.ok(state.picks.has(24), 'keepers survive a pick-list refresh');
  P.apply(state, 'r');
  assert.equal(state.picks.size, 0);
});

test('ignores unrelated frames', () => {
  const state = P.createState();
  assert.equal(P.apply(state, 'C|24'), false);
  assert.equal(P.apply(state, 'O|draft-labels|15|[]'), false);
  assert.equal(P.isRelevant('6|10'), false);
  assert.equal(P.isRelevant('0|1|2|3|C|0'), true);
});

test('snake order: inferred from round one, next pick for a team', () => {
  const state = P.createState();
  const order = [5, 3, 8, 1];
  order.forEach((team, i) => P.apply(state, `0|${i + 1}|${100 + i}|${team}|C|0`));
  assert.deepEqual(P.draftOrder(state), order);
  assert.equal(P.teamForPick(order, 5), 1); // round 2 reverses
  assert.equal(P.teamForPick(order, 8), 5);
  assert.equal(P.nextPickFor(state, 5, 5, 4), 8);
  assert.equal(P.nextPickFor(state, 8, 5, 4), 6);
  assert.equal(P.nextPickFor(state, 8, 9, 4), 11);
});

test('explicit draft order frame wins', () => {
  const state = P.createState();
  P.apply(state, 'R|2|1|4|3');
  assert.deepEqual(P.draftOrder(state), [2, 1, 4, 3]);
});

test('parses draft room routes', () => {
  assert.deepEqual(
    YDR.yahoo.parseDraftRoute('https://hockey.fantasysports.yahoo.com/draftclient/hockey/2381353/10?auth='),
    { game: 'nhl', draftId: '2381353', teamId: 10 }
  );
  assert.equal(YDR.yahoo.parseDraftRoute('https://hockey.fantasysports.yahoo.com/hockey/mock_lobby'), null);
});

test('QUEUE_LIST_CHANGED carries your queue in order', () => {
  const state = P.createState();
  assert.equal(state.queue, null);
  assert.equal(P.isRelevant('Q|6743|3358'), true);
  P.apply(state, 'Q|6743|3358|7528');
  assert.deepEqual(state.queue, [6743, 3358, 7528]);
  P.apply(state, 'Q');
  assert.deepEqual(state.queue, []);
});

test('parses NBA draft room routes', () => {
  assert.deepEqual(
    YDR.yahoo.parseDraftRoute('https://basketball.fantasysports.yahoo.com/draftclient/nba/98765/4'),
    { game: 'nba', draftId: '98765', teamId: 4 }
  );
});

test('the R frame lists the team for every pick (as Yahoo sends it)', () => {
  const state = P.createState();
  const snake = [];
  for (let round = 0; round < 13; round++) {
    const r = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    snake.push(...(round % 2 ? r.reverse() : r));
  }
  P.apply(state, `R|${snake.join('|')}`);
  assert.deepEqual(P.draftOrder(state), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.equal(P.nextPickFor(state, 5, 47, 12), 53);
  assert.equal(P.nextPickFor(state, 5, 54, 12), 68);
  assert.equal(P.nextPickFor(state, 5, 145, 12), 149);
  assert.equal(P.nextPickFor(state, 5, 150, 12), null);
});

test('before the draft starts, the slot order stands in for your picks', () => {
  const P = require('../src/lib/draft-protocol.js');
  const empty = P.createState();
  const assumed = Array.from({ length: 12 }, (_, i) => i + 1);
  // Slot 5 in a 12-team snake: picks 5, 20, 29, 44, ...
  assert.equal(P.nextPickFor(empty, 5, 1, 12, assumed), 5);
  assert.equal(P.nextPickFor(empty, 5, 6, 12, assumed), 20);
  assert.equal(P.nextPickFor(empty, 5, 21, 12, assumed), 29);
  // Slot 11 in a 12-team snake: picks 11, 14, 23, 26, ...
  assert.equal(P.nextPickFor(empty, 11, 1, 12, assumed), 11);
  assert.equal(P.nextPickFor(empty, 11, 12, 12, assumed), 14);
  // Without an assumed order, nothing is known yet.
  assert.equal(P.nextPickFor(empty, 5, 1, 12), null);
});
