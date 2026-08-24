"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { TYPING_IDLE_MS, createTypingPlan } = require("../../src/renderer/editorTyping.js");

function selection(offset, focusOffset = offset) {
  return {
    anchor: { paragraphId: 1, offset },
    focus: { paragraphId: 1, offset: focusOffset },
  };
}

function plan(overrides = {}) {
  return createTypingPlan({
    paragraphId: 1,
    inputType: "insertText",
    data: "а",
    textBefore: "",
    selectionBefore: selection(0),
    previous: null,
    ...overrides,
  });
}

test("continuous typing coalesces one word but closes it after whitespace or punctuation", () => {
  const first = plan();
  assert.equal(first.canContinue, false);
  assert.equal(first.finishAfter, false);

  const second = plan({
    textBefore: "а",
    selectionBefore: selection(1),
    previous: { paragraphId: 1, mode: "insert", afterSelection: selection(1) },
  });
  assert.equal(second.canContinue, true);

  const whitespace = plan({
    data: " ",
    textBefore: "аб",
    selectionBefore: selection(2),
    previous: { paragraphId: 1, mode: "insert", afterSelection: selection(2) },
  });
  assert.equal(whitespace.canContinue, true);
  assert.equal(whitespace.finishAfter, true);

  const punctuation = plan({ data: ",", textBefore: "аб", selectionBefore: selection(2) });
  assert.equal(punctuation.finishAfter, true);
});

test("caret movement and another paragraph start a new typing transaction", () => {
  const previous = { paragraphId: 1, mode: "insert", afterSelection: selection(3) };
  assert.equal(plan({ selectionBefore: selection(1), previous }).canContinue, false);
  assert.equal(plan({ paragraphId: 2, selectionBefore: selection(3), previous }).canContinue, false);
});

test("selection replacement, paste and cut are atomic editor actions", () => {
  assert.equal(plan({ selectionBefore: selection(1, 4) }).atomic, true);
  assert.equal(plan({ inputType: "insertFromPaste" }).finishAfter, true);
  assert.equal(plan({ inputType: "deleteByCut" }).finishAfter, true);
});

test("backspace groups deletion inside text and stops at a word boundary", () => {
  const withinWord = plan({
    inputType: "deleteContentBackward",
    data: null,
    textBefore: "слово",
    selectionBefore: selection(5),
  });
  assert.equal(withinWord.finishAfter, false);

  const whitespace = plan({
    inputType: "deleteContentBackward",
    data: null,
    textBefore: "слово ",
    selectionBefore: selection(6),
  });
  assert.equal(whitespace.finishAfter, true);
});

test("an idle pause is a fallback boundary after semantic typing boundaries", () => {
  assert.equal(TYPING_IDLE_MS, 750);
});
