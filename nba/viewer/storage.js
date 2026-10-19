// Stand-in for src/lib/storage.js outside the extension: the same get/set API
// over localStorage, so the panel remembers sort, filters and settings.
globalThis.YDR = globalThis.YDR || {};

(function (YDR) {
  'use strict';

  const PREFIX = 'nba-viewer:';

  function get(key, fallback) {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      return Promise.resolve(raw === null ? fallback : JSON.parse(raw));
    } catch {
      return Promise.resolve(fallback);
    }
  }

  function set(items) {
    try {
      for (const [key, value] of Object.entries(items)) localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch {
      // private window or storage blocked: settings just won't persist
    }
    return Promise.resolve();
  }

  YDR.storage = { get, set, alive: () => true, onChanged: () => {} };
})(globalThis.YDR);
