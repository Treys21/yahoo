// Popup / full-tab board: import the workbook, and browse the same board the
// draft room shows — ⚙ settings, markers, sorting — before the draft starts.
(function (YDR) {
  'use strict';

  const summaryEl = document.getElementById('summary');
  const statusEl = document.getElementById('import-status');
  const importFile = document.getElementById('import-file');

  let board = null;
  let overrides = {};
  let valued = null;
  // The same page serves as both the toolbar popup and a full tab. File import
  // only works in the tab: Chrome tears down a popup as soon as the OS file
  // dialog takes focus, so the change event would never fire.
  let inTab = false;

  async function init() {
    inTab = await new Promise((resolve) => chrome.tabs.getCurrent((tab) => resolve(Boolean(tab))));
    document.getElementById('open-tab').hidden = inTab;
    document.body.classList.toggle('tab', inTab);

    await YDR.panel.mount({ onValuationChange: changeValuation }, { container: document.getElementById('board') });
    await load();
  }

  async function load() {
    board = await YDR.storage.getBoard();
    overrides = await YDR.storage.getValuation();
    valued = YDR.boardRows.revalue(board, overrides);
    render();
  }

  function render() {
    if (!board) {
      summaryEl.textContent = 'No spreadsheet imported yet.';
      YDR.panel.render({ status: 'no-rankings', message: '', rows: [] });
      return;
    }
    const when = board.importedAt ? new Date(board.importedAt).toLocaleDateString() : '';
    summaryEl.textContent = `${board.players.length} players · ${board.fileName || 'workbook'}${when ? ` · ${when}` : ''}`;
    if (!board.model && !statusEl.textContent) {
      statusEl.className = 'small err';
      statusEl.textContent = 'This import is from an older version — click Import .xlsx again to enable ⚙ live settings.';
    }

    YDR.panel.render({
      status: 'ok',
      message: 'pre-draft',
      rows: YDR.boardRows.buildRows(board, valued),
      teams: board.settings?.teams || 12,
      valuation: YDR.boardRows.valuationState(board, overrides, valued)
    });
  }

  async function changeValuation(patch) {
    overrides = YDR.boardRows.mergeOverrides(board, overrides, patch);
    await YDR.storage.saveValuation(overrides);
    valued = YDR.boardRows.revalue(board, overrides);
    render();
  }

  function openInTab() {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/popup/popup.html') });
  }

  document.getElementById('open-tab').addEventListener('click', openInTab);
  document.getElementById('open-nba').addEventListener('click', () =>
    chrome.tabs.create({ url: chrome.runtime.getURL('src/nba/board.html') }));

  document.getElementById('import').addEventListener('click', () => {
    if (!inTab) {
      openInTab();
      return;
    }
    importFile.click();
  });

  importFile.addEventListener('change', async () => {
    const file = importFile.files && importFile.files[0];
    if (!file) return;
    statusEl.className = 'small';
    statusEl.textContent = 'Reading…';
    try {
      const { players, settings, model } = await YDR.workbook.importWorkbook(await file.arrayBuffer());
      await YDR.storage.saveBoard({ players, settings, model, fileName: file.name });
      statusEl.className = 'small ok';
      statusEl.textContent = `Imported ${players.length} players${model ? '' : ' (live settings unavailable: Player Data / position sheets not found)'}. Open draft rooms update automatically.`;
      await load();
    } catch (error) {
      // A failed import leaves the existing board untouched.
      statusEl.className = 'small err';
      statusEl.textContent = `Couldn't import: ${error.message}`;
    }
    importFile.value = '';
  });

  document.getElementById('export').addEventListener('click', () => {
    if (!board) return;
    const blob = new Blob([JSON.stringify(board, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'nhl-draft-board.json';
    link.click();
    URL.revokeObjectURL(link.href);
  });

  document.getElementById('reset-overrides').addEventListener('click', async () => {
    await YDR.storage.clearAllOverrides();
    statusEl.className = 'small ok';
    statusEl.textContent = 'Manual ✕ marks cleared.';
  });

  init();
})(globalThis.YDR);
