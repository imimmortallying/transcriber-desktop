"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { showTranscriptContextMenu } = require("../../src/transcriptContextMenu.js");

function createMenu({ selectMediaAction = false } = {}) {
  let template = null;
  return {
    Menu: {
      buildFromTemplate(nextTemplate) {
        template = nextTemplate;
        return {
          popup({ callback }) {
            if (selectMediaAction) {
              template.find((item) => item.label === "Перейти к записи")?.click();
            }
            callback();
          },
        };
      },
    },
    template: () => template,
  };
}

test("editable context menu preserves standard editing roles and adds a selected media action", async () => {
  const menu = createMenu({ selectMediaAction: true });
  const action = await showTranscriptContextMenu({
    Menu: menu.Menu,
    browserWindow: {},
    includeMediaAction: true,
  });

  assert.equal(action, "seek-to-media");
  assert.deepEqual(menu.template().filter((item) => item.role).map((item) => item.role), [
    "undo", "redo", "cut", "copy", "paste", "selectAll",
  ]);
  assert.ok(menu.template().some((item) => item.label === "Перейти к записи"));
});

test("unanchored or disabled review context menu omits the media action", async () => {
  const menu = createMenu();
  const action = await showTranscriptContextMenu({
    Menu: menu.Menu,
    browserWindow: {},
    includeMediaAction: false,
  });

  assert.equal(action, null);
  assert.doesNotMatch(JSON.stringify(menu.template()), /Перейти к записи/);
});
