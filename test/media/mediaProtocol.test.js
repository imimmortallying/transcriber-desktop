"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createMediaProtocolHandler, parseMediaProtocolToken, parseSingleByteRange } = require("../../src/mediaProtocol");

test("media protocol accepts only an opaque source capability URL", () => {
  assert.equal(parseMediaProtocolToken("asr-media://token-123/source"), "token-123");
  assert.equal(parseMediaProtocolToken("asr-media://token-123/other"), null);
  assert.equal(parseMediaProtocolToken("file:///C:/recordings/meeting.mp4"), null);
});

test("media protocol serves authorized byte ranges without delegating seek semantics to file fetch", async () => {
  const streams = [];
  const handler = createMediaProtocolHandler({
    resolveAuthorization: async (token) => token === "allowed" ? { filePath: "C:\\recordings\\meeting.mp4" } : null,
    statFile: async () => ({ size: 500, isFile: () => true }),
    createFileStream: (filePath, options) => {
      streams.push({ filePath, options });
      return { filePath, options };
    },
    toWebStream: (stream) => stream,
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
  }), {
    body: { filePath: "C:\\recordings\\meeting.mp4", options: { start: 100, end: 499 } },
    status: 206,
    headers: {
      "Accept-Ranges": "bytes",
      "Content-Length": "400",
      "Content-Range": "bytes 100-499/500",
    },
  });
  assert.deepEqual(streams, [{ filePath: "C:\\recordings\\meeting.mp4", options: { start: 100, end: 499 } }]);
  assert.deepEqual(await handler({
    url: "asr-media://allowed/source",
    method: "GET",
    headers: { Range: "bytes=900-" },
  }), {
    body: null,
    status: 416,
    headers: { "Accept-Ranges": "bytes", "Content-Range": "bytes */500" },
  });
});

test("media protocol parses standard single byte ranges", () => {
  assert.deepEqual(parseSingleByteRange("bytes=5-9", 26), { start: 5, end: 9 });
  assert.deepEqual(parseSingleByteRange("bytes=20-", 26), { start: 20, end: 25 });
  assert.deepEqual(parseSingleByteRange("bytes=-5", 26), { start: 21, end: 25 });
  assert.deepEqual(parseSingleByteRange("bytes=26-", 26), { invalid: true });
});
