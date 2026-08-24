"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { classifyPlaybackCapability, createMediaController } = require("../../src/renderer/mediaController");

test("media capability probe does not claim support beyond HTMLMediaElement", () => {
  assert.equal(classifyPlaybackCapability("probably"), "probably");
  assert.equal(classifyPlaybackCapability("maybe"), "maybe");
  assert.equal(classifyPlaybackCapability(""), "unsupported");
  assert.equal(classifyPlaybackCapability("unexpected"), "unsupported");
});

test("controller creates audio and video elements from the shared source contract", async () => {
  const created = [];
  const documentRef = {
    createElement(tagName) {
      const element = {
        tagName: tagName.toUpperCase(),
        paused: true,
        ended: false,
        currentTime: 0,
        duration: 30,
        error: null,
        addEventListener() {},
        canPlayType: () => "probably",
        load() {},
        pause() { this.paused = true; },
        play() { this.paused = false; return Promise.resolve(); },
        removeAttribute() {},
      };
      created.push(element);
      return element;
    },
  };
  const controller = createMediaController({ documentRef });

  controller.load({ status: "available", sourceKind: "audio", url: "asr-media://audio/source", mimeType: "audio/wav" });
  assert.equal(controller.getElement().tagName, "AUDIO");
  controller.seek(60);
  assert.equal(controller.getSnapshot().currentTime, 30);
  assert.equal(controller.getSnapshot().state, "paused");
  await controller.play();
  controller.seek(-5);
  assert.equal(controller.getSnapshot().currentTime, 0);
  assert.equal(controller.getSnapshot().state, "playing");

  controller.load({ status: "available", sourceKind: "video", url: "asr-media://video/source", mimeType: "video/mp4" });
  assert.equal(controller.getElement().tagName, "VIDEO");
  assert.equal(created.length, 2);
});
