// Pre-draft NBA board: import the workbook (or use the bundled one) and browse
// the same panel the draft room shows, with no picks made yet.
(function (YDR) {
  'use strict';

  const BUNDLED = '../../nba/2026-27-NBA-Roto-Values.xlsx';
  const BUNDLE_VERSION = 2; // keep in step with content.js
  const summaryEl = document.getElementById('summary');
  const statusEl = document.getElementById('import-status');
  const importFile = document.getElementById('import-file');
  const boardState = YDR.nbaBoard.createBoard();

  let board = null;
  let overrides = {};

  function setStatus(kind, text) {
    statusEl.className = `small ${kind}`;
    statusEl.textContent = text;
  }

  async function save(parsed, fileName, bundled) {
    await YDR.storage.set({ nbaBoard: { ...parsed, fileName, bundled, bundleVersion: bundled ? BUNDLE_VERSION : null, importedAt: Date.now() } });
    await load();
  }

  async function loadBundled() {
    const response = await fetch(BUNDLED);
    const parsed = await YDR.nbaWorkbook.importWorkbook(await response.arrayBuffer());
    await save(parsed, BUNDLED.split('/').pop(), true);
    setStatus('ok', `Loaded the bundled projections (${parsed.players.length} players).`);
  }

  async function load() {
    board = await YDR.storage.get('nbaBoard', null);
    overrides = await YDR.storage.get('nbaOptions', {});
    if (!board || (board.bundled && board.bundleVersion !== BUNDLE_VERSION)) {
      await loadBundled();
      return;
    }
    render();
  }

  function render() {
    const when = board.importedAt ? new Date(board.importedAt).toLocaleDateString() : '';
    summaryEl.textContent = `${board.players.length} players · ${board.fileName}${board.bundled ? ' (bundled)' : ''}${when ? ` · ${when}` : ''}`;
    const built = boardState.build(board, overrides);
    YDR.nbaPanel.render({
      status: 'ok',
      message: 'pre-draft',
      rows: built.rows,
      rec: built.rec,
      options: built.opts,
      poolSize: built.valued.poolSize,
      changed: Object.keys(overrides).length > 0
    });
  }

  async function saveOverrides(next) {
    overrides = next;
    await YDR.storage.set({ nbaOptions: overrides });
    render();
  }

  async function init() {
    await YDR.nbaPanel.mount({
      onOptionChange: (patch) => saveOverrides(YDR.nbaBoard.mergeOverrides(board, overrides, patch)),
      onToggleCategory: (cat) => saveOverrides(YDR.nbaBoard.toggleCategory(board, overrides, cat))
    }, { container: document.getElementById('board') });
    try {
      await load();
    } catch (error) {
      setStatus('err', `Couldn't load projections: ${error.message}`);
    }
  }

  document.getElementById('import').addEventListener('click', () => importFile.click());
  document.getElementById('bundled').addEventListener('click', () =>
    loadBundled().catch((error) => setStatus('err', `Couldn't load: ${error.message}`)));

  importFile.addEventListener('change', async () => {
    const file = importFile.files && importFile.files[0];
    if (!file) return;
    setStatus('', 'Reading…');
    try {
      const parsed = await YDR.nbaWorkbook.importWorkbook(await file.arrayBuffer());
      await save(parsed, file.name, false);
      setStatus('ok', `Imported ${parsed.players.length} players. Open draft rooms update automatically.`);
    } catch (error) {
      setStatus('err', `Couldn't import: ${error.message}`); // the existing board stays
    }
    importFile.value = '';
  });

  document.getElementById('reset-marks').addEventListener('click', async () => {
    await YDR.storage.set({ nbaOverrides: {} });
    setStatus('ok', 'Manual ✕ marks cleared.');
  });

  init();
})(globalThis.YDR);
