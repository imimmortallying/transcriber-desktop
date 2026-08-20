const assert = require("node:assert/strict");
const { mkdtemp, rm, symlink, writeFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { cleanupOwnedWorkspace, getSentinelPath, verifyOwnedWorkspace } = require("./fullSetupE2eCleanup");

async function createOwnedWorkspace() {
  const nonce = "cleanup-test-nonce";
  const workspace = await mkdtemp(path.join(os.tmpdir(), "asr-full-setup-e2e-cleanup-"));
  await writeFile(getSentinelPath(workspace), `${nonce}\n`, "utf8");
  return { nonce, workspace };
}

test("owned E2E temp workspace is verified and cleaned only after canonical checks", async () => {
  const { nonce, workspace } = await createOwnedWorkspace();
  const canonicalWorkspace = await verifyOwnedWorkspace({ workspace, nonce });
  assert.ok(canonicalWorkspace);
  await cleanupOwnedWorkspace({ workspace, nonce });
  await assert.rejects(verifyOwnedWorkspace({ workspace, nonce }), { code: "ENOENT" });
});

test("cleanup guard rejects an existing path outside system temp", async () => {
  await assert.rejects(
    verifyOwnedWorkspace({ workspace: path.resolve(__dirname, "../.."), nonce: "cleanup-test-nonce" }),
    /outside the canonical system temp directory/,
  );
});

test("cleanup guard rejects missing or wrong sentinels", async () => {
  const { nonce, workspace } = await createOwnedWorkspace();
  try {
    await rm(getSentinelPath(workspace));
    await assert.rejects(verifyOwnedWorkspace({ workspace, nonce }), { code: "ENOENT" });
    await writeFile(getSentinelPath(workspace), "wrong\n", "utf8");
    await assert.rejects(verifyOwnedWorkspace({ workspace, nonce }), /sentinel does not match/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("cleanup guard rejects a reparse-style workspace root when supported", async (t) => {
  const nonce = "cleanup-test-nonce";
  const target = await mkdtemp(path.join(os.tmpdir(), "asr-full-setup-e2e-target-"));
  const workspace = path.join(os.tmpdir(), `asr-full-setup-e2e-link-${Date.now()}`);
  try {
    await writeFile(getSentinelPath(target), `${nonce}\n`, "utf8");
    try {
      await symlink(target, workspace, process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      if (error.code === "EPERM" || error.code === "EACCES") {
        t.skip("Current Windows configuration cannot create a test reparse point.");
        return;
      }
      throw error;
    }
    await assert.rejects(verifyOwnedWorkspace({ workspace, nonce }), /regular directory|filesystem indirection/);
  } finally {
    await rm(workspace, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    await rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
});
