"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { classifyPlaybackCapability } = require("../../src/renderer/mediaController");

test("media capability probe does not claim support beyond HTMLMediaElement", () => {
  assert.equal(classifyPlaybackCapability("probably"), "probably");
  assert.equal(classifyPlaybackCapability("maybe"), "maybe");
  assert.equal(classifyPlaybackCapability(""), "unsupported");
  assert.equal(classifyPlaybackCapability("unexpected"), "unsupported");
});
