// Thin typed wrappers over chrome.storage.local. Shared by every content script
// and the popup, which all run as classic scripts in the same isolated world.
globalThis.YDR = globalThis.YDR || {};

(function (YDR) {
  'use strict';

  const DEFAULTS = {
    // { players: [...], settings: {...}, fileName, importedAt }
    board: null,
    // { [draftId]: [rankingName, ...] } — manual drafted/undrafted flips
    overrides: {},
    ui: {
      x: null,
      w: null, // panel size after a manual resize
      h: null,
      y: null,
      collapsed: false,
      sortBy: 'rank',
      sortDir: 'asc',
      position: 'ALL',
      hideDrafted: true,
      search: '',
      showValuation: false
    }
  };

  // After the extension is reloaded, scripts already injected into an open tab
  // keep running but lose chrome.storage ("Extension context invalidated").
  // Treat that as "nothing stored" instead of throwing; the tab needs a reload.
  const alive = () => Boolean(globalThis.chrome && chrome.runtime && chrome.runtime.id);

  function get(key, fallback) {
    return new Promise((resolve) => {
      if (!alive()) return resolve(fallback);
      try {
        chrome.storage.local.get(key, (result) => {
          const value = result && result[key];
          resolve(value === undefined || value === null ? fallback : value);
        });
      } catch {
        resolve(fallback);
      }
    });
  }

  function set(items) {
    return new Promise((resolve) => {
      if (!alive()) return resolve();
      try {
        chrome.storage.local.set(items, resolve);
      } catch {
        resolve();
      }
    });
  }

  YDR.storage = {
    DEFAULTS,

    // Raw access for other boards (the NBA board keeps its own keys).
    get,
    set,
    alive,

    getBoard: () => get('board', DEFAULTS.board),

    // Never clobber a good board with an empty one — a bad import must be a no-op.
    async saveBoard(board) {
      if (!board || !Array.isArray(board.players) || board.players.length === 0) return false;
      await set({ board: Object.assign({ importedAt: Date.now() }, board) });
      return true;
    },

    // Valuation settings changed on the board ({ gpProjection, replacement, ... }).
    // Empty means "use the workbook's Settings sheet".
    getValuation: () => get('valuation', {}),
    saveValuation: (options) => set({ valuation: options || {} }),

    async getOverrides(draftId) {
      const all = await get('overrides', {});
      return new Set(all[draftId] || []);
    },
    async saveOverrides(draftId, names) {
      const all = await get('overrides', {});
      all[draftId] = [...names];
      await set({ overrides: all });
    },
    clearAllOverrides: () => set({ overrides: {} }),

    async getUi() {
      const stored = await get('ui', {});
      return Object.assign({}, DEFAULTS.ui, stored);
    },
    async saveUi(patch) {
      const current = await this.getUi();
      await set({ ui: Object.assign({}, current, patch) });
    },

    onChanged(callback) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local') callback(changes);
      });
    }
  };
})(globalThis.YDR);
