"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const test = require("node:test");
const { moveNewOutput } = require("../../scripts/createClientUpdatePackage");

test("cross-volume package finalization uses an exclusive copy", async () => {
  const calls = [];
  const fsApi = {
    async rename() {
      const error = new Error("Cross-device link");
      error.code = "EXDEV";
      throw error;
    },
    async copyFile(source, destination, flags) {
      calls.push({ source, destination, flags });
    },
  };

  await moveNewOutput("C:\\temp\\candidate.asrupdate", "E:\\dist\\candidate.asrupdate", fsApi);

  assert.deepEqual(calls, [{
    source: "C:\\temp\\candidate.asrupdate",
    destination: "E:\\dist\\candidate.asrupdate",
    flags: fs.constants.COPYFILE_EXCL,
  }]);
});

test("package finalization does not mask non-cross-volume failures", async () => {
  const expected = new Error("Access denied");
  expected.code = "EACCES";
  const fsApi = {
    async rename() {
      throw expected;
    },
    async copyFile() {
      throw new Error("copy must not run");
    },
  };

  await assert.rejects(
    moveNewOutput("C:\\temp\\candidate.asrupdate", "E:\\dist\\candidate.asrupdate", fsApi),
    expected,
  );
});
