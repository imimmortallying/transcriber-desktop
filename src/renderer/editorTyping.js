(function attachEditorTyping(global) {
  "use strict";

  const ATOMIC_INPUT_TYPES = new Set([
    "insertFromPaste",
    "insertFromDrop",
    "deleteByCut",
    "insertReplacementText",
  ]);
  const TYPING_IDLE_MS = 750;

  function isCollapsed(selection) {
    return selection?.anchor?.paragraphId === selection?.focus?.paragraphId
      && selection?.anchor?.offset === selection?.focus?.offset;
  }

  function isSameSelection(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  function isBoundaryCharacter(value) {
    return /[\s.,;:!?…()\[\]{}"«»—–-]/u.test(value || "");
  }

  function deletedCharacter(inputType, textBefore, selectionBefore) {
    if (!isCollapsed(selectionBefore)) {
      return "";
    }
    const offset = selectionBefore.anchor.offset;
    if (inputType === "deleteContentBackward") {
      return textBefore.slice(Math.max(0, offset - 1), offset);
    }
    if (inputType === "deleteContentForward") {
      return textBefore.slice(offset, offset + 1);
    }
    return "";
  }

  function createTypingPlan({ paragraphId, inputType, data, textBefore, selectionBefore, previous }) {
    const atomic = ATOMIC_INPUT_TYPES.has(inputType) || !isCollapsed(selectionBefore);
    const insertion = inputType === "insertText" || inputType === "insertParagraph" || inputType === "insertLineBreak";
    const deletion = inputType === "deleteContentBackward" || inputType === "deleteContentForward";
    const mode = insertion ? "insert" : deletion ? inputType : "other";
    const boundary = insertion
      ? inputType !== "insertText" || isBoundaryCharacter(String(data || "").at(-1))
      : deletion && isBoundaryCharacter(deletedCharacter(inputType, textBefore, selectionBefore));
    const canContinue = Boolean(previous)
      && !atomic
      && previous.paragraphId === paragraphId
      && previous.mode === mode
      && isSameSelection(selectionBefore, previous.afterSelection);

    return {
      atomic,
      canContinue,
      finishAfter: atomic || boundary || mode === "other",
      mode,
    };
  }

  const api = { TYPING_IDLE_MS, createTypingPlan };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  global.EditorTyping = api;
}(globalThis));
