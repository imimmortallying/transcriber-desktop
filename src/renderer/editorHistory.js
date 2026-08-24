(function attachEditorHistory(global) {
  "use strict";

  function clone(value) {
    return global.structuredClone ? global.structuredClone(value) : JSON.parse(JSON.stringify(value));
  }

  function estimateSize(value) {
    return JSON.stringify(value).length * 2;
  }

  function createEditorHistory({ maxEntries = 100, maxBytes = 24 * 1024 * 1024 } = {}) {
    let entries = [];
    let cursor = -1;
    let bytes = 0;
    let pendingTyping = null;

    function createEntry(state, selection, meta) {
      const document = clone(state);
      return {
        document,
        selection: clone(selection),
        meta: { ...meta },
        bytes: estimateSize(document),
      };
    }

    function trim() {
      while (entries.length > 1 && (entries.length > maxEntries || bytes > maxBytes)) {
        bytes -= entries.shift().bytes;
        cursor -= 1;
      }
    }

    function discardRedo() {
      while (entries.length - 1 > cursor) {
        bytes -= entries.pop().bytes;
      }
    }

    function push(state, selection, meta = {}) {
      discardRedo();
      const entry = createEntry(state, selection, meta);
      entries.push(entry);
      cursor = entries.length - 1;
      bytes += entry.bytes;
      trim();
      return clone(entry);
    }

    function setCurrentSelection(selection) {
      if (cursor >= 0) {
        entries[cursor].selection = clone(selection);
      }
    }

    return {
      initialize(state, selection) {
        const entry = createEntry(state, selection, { kind: "initial" });
        entries = [entry];
        cursor = 0;
        bytes = entry.bytes;
        pendingTyping = null;
      },

      clear() {
        entries = [];
        cursor = -1;
        bytes = 0;
        pendingTyping = null;
      },

      setCurrentSelection,

      beginTyping({ continuityKey, selection }) {
        if (cursor < 0) {
          throw new Error("История документа не инициализирована.");
        }
        if (pendingTyping) {
          return pendingTyping.continuityKey === continuityKey;
        }
        setCurrentSelection(selection);
        pendingTyping = { continuityKey };
        return true;
      },

      hasPendingTyping() {
        return Boolean(pendingTyping);
      },

      finishTyping(state, selection, meta = {}) {
        if (!pendingTyping) {
          return null;
        }
        pendingTyping = null;
        return push(state, selection, { ...meta, kind: meta.kind || "typing" });
      },

      record(state, selection, meta = {}) {
        if (pendingTyping) {
          throw new Error("Нельзя записать структурную операцию до завершения ввода.");
        }
        return push(state, selection, meta);
      },

      undo() {
        if (pendingTyping || cursor <= 0) {
          return null;
        }
        cursor -= 1;
        return clone(entries[cursor]);
      },

      redo() {
        if (pendingTyping || cursor >= entries.length - 1) {
          return null;
        }
        cursor += 1;
        return clone(entries[cursor]);
      },

      canUndo() {
        return !pendingTyping && cursor > 0;
      },

      canRedo() {
        return !pendingTyping && cursor >= 0 && cursor < entries.length - 1;
      },

      stats() {
        return { entries: entries.length, cursor, bytes, pendingTyping: Boolean(pendingTyping) };
      },
    };
  }

  const api = { createEditorHistory };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  global.EditorHistory = api;
}(globalThis));
