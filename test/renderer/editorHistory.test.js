"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { createEditorHistory } = require("../../src/renderer/editorHistory.js");

function state(text) {
  return {
    paragraphs: [{ id: 1, type: "text", text, speakerId: null, start: 0, timing: [] }],
    speakers: [],
    nextParagraphId: 2,
    nextSpeakerId: 1,
  };
}

function selection(offset = 0) {
  return {
    anchor: { paragraphId: 1, offset },
    focus: { paragraphId: 1, offset },
  };
}

test("timeline owns immutable snapshots and restores selection", () => {
  const history = createEditorHistory();
  const initial = state("one");
  history.initialize(initial, selection(1));
  initial.paragraphs[0].text = "changed outside history";

  history.record(state("two"), selection(2), { kind: "anything-new" });
  const undone = history.undo();
  assert.equal(undone.document.paragraphs[0].text, "one");
  assert.deepEqual(undone.selection, selection(1));

  const redone = history.redo();
  assert.equal(redone.document.paragraphs[0].text, "two");
  assert.equal(redone.meta.kind, "anything-new");
});

test("typing remains pending until its controller finishes it", () => {
  const history = createEditorHistory();
  history.initialize(state("one"), selection(3));
  history.beginTyping({ continuityKey: "1", selection: selection(3) });

  assert.equal(history.canUndo(), false);
  assert.equal(history.undo(), null);
  history.finishTyping(state("one!"), selection(4));

  assert.equal(history.canUndo(), true);
  assert.equal(history.undo().document.paragraphs[0].text, "one");
});

test("a new transaction discards the redo branch", () => {
  const history = createEditorHistory();
  history.initialize(state("one"), selection(3));
  history.record(state("two"), selection(3), { kind: "typing" });
  history.record(state("three"), selection(5), { kind: "split" });
  history.undo();

  history.record(state("replacement"), selection(11), { kind: "speaker-assign" });

  assert.equal(history.canRedo(), false);
  assert.equal(history.undo().document.paragraphs[0].text, "two");
});

test("entry limit retains the newest contiguous timeline", () => {
  const history = createEditorHistory({ maxEntries: 3 });
  history.initialize(state("zero"), selection());
  history.record(state("one"), selection(1));
  history.record(state("two"), selection(2));
  history.record(state("three"), selection(3));

  assert.equal(history.stats().entries, 3);
  assert.equal(history.undo().document.paragraphs[0].text, "two");
  assert.equal(history.undo().document.paragraphs[0].text, "one");
  assert.equal(history.undo(), null);
});

test("byte limit releases whole oldest snapshots", () => {
  const history = createEditorHistory({ maxEntries: 100, maxBytes: 1 });
  history.initialize(state("zero"), selection());
  history.record(state("newest"), selection(6));

  assert.equal(history.stats().entries, 1);
  assert.equal(history.undo(), null);
});
