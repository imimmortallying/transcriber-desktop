"use strict";

function showTranscriptContextMenu({ Menu, browserWindow, includeMediaAction }) {
  return new Promise((resolve) => {
    let selectedAction = null;
    const template = [
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "selectAll" },
    ];
    if (includeMediaAction) {
      template.push(
        { type: "separator" },
        {
          label: "Перейти к записи",
          click() {
            selectedAction = "seek-to-media";
          },
        },
      );
    }
    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: browserWindow, callback: () => resolve(selectedAction) });
  });
}

module.exports = { showTranscriptContextMenu };
