// Loads the classic-script modules into one shared globalThis.YDR, the same
// way the extension does.
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
require(path.join(root, 'src/lib/match-names.js'));
require(path.join(root, 'src/lib/xlsx-reader.js'));
require(path.join(root, 'src/lib/workbook-import.js'));
require(path.join(root, 'src/lib/draft-protocol.js'));
require(path.join(root, 'src/lib/yahoo-api.js'));
require(path.join(root, 'src/lib/valuation.js'));
require(path.join(root, 'src/nba/model.js'));
require(path.join(root, 'src/nba/workbook.js'));
require(path.join(root, 'src/nba/recommend.js'));
require(path.join(root, 'src/nba/board.js'));

const fixture = (name) => path.join(__dirname, 'fixtures', name);

function readBuffer(file) {
  const b = fs.readFileSync(file);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
}

let boardPromise = null;
function loadBoard() {
  boardPromise = boardPromise || globalThis.YDR.workbook.importWorkbook(readBuffer(fixture('projections.xlsx')));
  return boardPromise;
}

let nbaPromise = null;
function loadNbaBoard() {
  nbaPromise = nbaPromise || globalThis.YDR.nbaWorkbook.importWorkbook(readBuffer(fixture('nba-values.xlsx')));
  return nbaPromise;
}

function loadYahooPlayers() {
  return globalThis.YDR.yahoo.parsePlayers(JSON.parse(fs.readFileSync(fixture('yahoo-players.json'), 'utf8')));
}

module.exports = { YDR: globalThis.YDR, fixture, readBuffer, loadBoard, loadNbaBoard, loadYahooPlayers };
