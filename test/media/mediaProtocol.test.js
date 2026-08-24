"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createMediaProtocolHandler, parseMediaProtocolToken } = require("../../src/mediaProtocol");

test("media protocol accepts only an opaque source capability URL", () => {
  assert.equal(parseMediaProtocolToken("asr-media://token-123/source"), "token-123");
  assert.equal(parseMediaProtocolToken("asr-media://token-123/other"), null);
  assert.equal(parseMediaProtocolToken("file:///C:/recordings/meeting.mp4"), null);
});

test("media protocol forwards GET range requests only after authorization", async () => {
  const requests = [];
  const handler = createMediaProtocolHandler({
    resolveAuthorization: async (token) => token === "allowed" ? { filePath: "C:\\recordings\\meeting.mp4" } : null,
    fetchFile: async (url, options) => {
      requests.push({ url, options });
      return { ok: true };
    },
    createResponse: (body, init) => ({ body, ...init }),
  });

  assert.deepEqual(await handler({ url: "asr-media://denied/source", method: "GET", headers: {} }), {
    body: "Not found",
    status: 404,
  });
  assert.deepEqual(await handler({
    url: "asr-media://allowed/source",
    method: "GET",
    headers: { Range: "bytes=100-" },
  }), { ok: true });
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /^file:/);
  assert.deepEqual(requests[0].options, {
    method: "GET",
    headers: { Range: "bytes=100-" },
  });
});
