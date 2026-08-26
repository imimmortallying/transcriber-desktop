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

test("rapid toggles are serialized against the media element instead of a stale UI snapshot", async () => {
  const calls = [];
  const pendingPlays = [];
  const documentRef = {
    createElement(tagName) {
      return {
        tagName: tagName.toUpperCase(),
        paused: true,
        ended: false,
        currentTime: 0,
        duration: 30,
        error: null,
        addEventListener() {},
        canPlayType: () => "probably",
        load() {},
        pause() {
          calls.push("pause");
          this.paused = true;
        },
        play() {
          calls.push("play");
          this.paused = false;
          return new Promise((resolve) => pendingPlays.push(resolve));
        },
        removeAttribute() {},
      };
    },
  };
  const controller = createMediaController({ documentRef });
  controller.load({ status: "available", sourceKind: "audio", url: "asr-media://audio/source", mimeType: "audio/wav" });

  const first = controller.togglePlayback();
  for (let index = 0; index < 4 && pendingPlays.length === 0; index += 1) {
    await Promise.resolve();
  }
  assert.equal(pendingPlays.length, 1);
  const second = controller.togglePlayback();
  const third = controller.togglePlayback();
  const fourth = controller.togglePlayback();

  pendingPlays.shift()();
  await first;
  await second;
  for (let index = 0; index < 4 && pendingPlays.length === 0; index += 1) {
    await Promise.resolve();
  }
  assert.equal(pendingPlays.length, 1);
  pendingPlays.shift()();
  await third;
  await fourth;

  assert.deepEqual(calls, ["play", "pause", "play", "pause"]);
  assert.equal(controller.getSnapshot().state, "paused");
});
