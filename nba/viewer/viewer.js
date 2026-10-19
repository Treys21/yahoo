// Offline rankings page: the draft-room panel, inline, over the exported workbook.
// Players marked "taken" leave the pool; "mine" builds your roster so the
// recommendations, outlook and starts react as they would in a draft.
(function (YDR) {
  'use strict';

  const ME = 1;
  const summaryEl = document.getElementById('summary');
  const statusEl = document.getElementById('status');
  const importFile = document.getElementById('import-file');
  const boardState = YDR.nbaBoard.createBoard();

  let board = globalThis.NBA_BOARD || null;
  let overrides = {};
  let taken = new Set();
  let mine = new Set();
  let mode = 'taken';

  function setStatus(kind, text) {
    statusEl.className = `small ${kind}`;
    statusEl.textContent = text;
  }

  async function load() {
    overrides = await YDR.storage.get('nbaOptions', {});
    taken = new Set(await YDR.storage.get('taken', []));
    mine = new Set(await YDR.storage.get('mine', []));
    mode = await YDR.storage.get('markMode', 'taken');
  }

  function save() {
    return YDR.storage.set({ nbaOptions: overrides, taken: [...taken], mine: [...mine], markMode: mode });
  }

  function render() {
    document.querySelectorAll('#mark-mode button').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
    if (!board) {
      summaryEl.textContent = '';
      YDR.nbaPanel.render({ status: 'no-board', rows: [], emptyMessage: 'No data yet. Run <code>npm run viewer</code> (or open a workbook above).' });
      return;
    }
    const teams = board.settings.teams;
    const built = boardState.build(board, overrides, {
      manual: taken,
      mine,
      myTeamId: ME,
      teamIds: Array.from({ length: teams }, (_, i) => i + 1)
    });
    const when = board.exportedAt ? new Date(board.exportedAt).toLocaleString() : '';
    summaryEl.textContent = `${board.players.length} players · ${board.fileName || 'workbook'}${when ? ` · exported ${when}` : ''}`;
    const marked = taken.size + mine.size;
    YDR.nbaPanel.render({
      status: 'ok',
      message: marked ? `${mine.size} mine · ${taken.size} taken` : 'offline',
      rows: built.rows,
      rec: built.rec,
      options: built.opts,
      poolSize: built.valued.poolSize,
      changed: Object.keys(overrides).length > 0
    });
  }

  async function update(fn) {
    fn();
    await save();
    render();
  }

  async function init() {
    await load();
    await YDR.nbaPanel.mount({
      onToggleDrafted: (name) => update(() => {
        if (taken.has(name) || mine.has(name)) {
          taken.delete(name);
          mine.delete(name);
        } else {
          (mode === 'mine' ? mine : taken).add(name);
        }
      }),
      onOptionChange: (patch) => update(() => { overrides = YDR.nbaBoard.mergeOverrides(board, overrides, patch); }),
      onToggleCategory: (cat) => update(() => { overrides = YDR.nbaBoard.toggleCategory(board, overrides, cat); })
    }, { container: document.getElementById('board') });
    render();
  }

  document.querySelectorAll('#mark-mode button').forEach((b) =>
    b.addEventListener('click', () => update(() => { mode = b.dataset.mode; })));
  document.getElementById('clear').addEventListener('click', () => update(() => {
    taken.clear();
    mine.clear();
  }));
  document.getElementById('import').addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', async () => {
    const file = importFile.files && importFile.files[0];
    if (!file) return;
    setStatus('', 'Reading…');
    try {
      const parsed = await YDR.nbaWorkbook.importWorkbook(await file.arrayBuffer());
      board = { ...parsed, fileName: file.name, exportedAt: new Date().toISOString() };
      setStatus('ok', `Loaded ${file.name} for this session. Run npm run viewer to make it the default.`);
      render();
    } catch (error) {
      setStatus('err', `Couldn't read it: ${error.message}`);
    }
    importFile.value = '';
  });

  init();
})(globalThis.YDR);
