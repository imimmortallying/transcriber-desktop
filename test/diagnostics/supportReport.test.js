const assert = require("node:assert/strict");
const { mkdtemp, readFile, rm } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildSupportReport,
  getSupportReportDirectory,
  isSupportReportPath,
  sanitizeDiagnosticText,
  writeSupportReport,
} = require("../../src/diagnostics/supportReport");

test("sanitizes local paths and user names from support diagnostics", () => {
  const value = "Could not load C:\\Users\\Alice\\ASR\\runtime.dll";

  assert.match(sanitizeDiagnosticText(value), /^Could not load <path>$/);
  assert.equal(sanitizeDiagnosticText("Unable to read C:/Users/Alice/ASR/runtime.dll"), "Unable to read <path>");
  assert.equal(sanitizeDiagnosticText("Unable to read /Users/alice/project"), "Unable to read /Users/<user>/project");
});

test("builds a self-contained report without user paths or input names", () => {
  const report = buildSupportReport({
    reportId: "report-1",
    createdAt: new Date("2026-08-23T00:00:00.000Z"),
    kind: "recognition",
    errorCode: "ASR-RUNTIME-NATIVE-LOAD",
    error: new Error("Could not find C:\\Users\\Alice\\video.mp4"),
    appVersion: "0.1.7",
    supportEmail: "support@example.test",
    operation: { name: "recognition", inputExtension: ".mp4" },
    runtime: {
      runtimeVersion: "1.0.0",
      pythonPresent: true,
      ffmpegPresent: true,
      torchaudioNativeLibraryPresent: true,
      torchCpuLibraryPresent: true,
    },
    runtimeChecks: [{ name: "torchaudio", ok: false, detail: "D:\\ASR\\libtorchaudio.pyd" }],
  });

  assert.match(report.content, /error_code=ASR-RUNTIME-NATIVE-LOAD/);
  assert.match(report.content, /input_extension=\.mp4/);
  assert.match(report.content, /torchaudio=failed/);
  assert.match(report.content, /torchaudio_native_library_present=true/);
  assert.doesNotMatch(report.content, /Alice|video\.mp4|D:\\ASR/);
});

test("writes reports only to an application-owned per-user directory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "local-asr-support-report-"));
  try {
    const report = buildSupportReport({
      reportId: "report-2",
      createdAt: new Date("2026-08-23T00:00:00.000Z"),
      kind: "recognition",
      errorCode: "ASR-RECOGNITION-FAILED",
      error: new Error("failure"),
      appVersion: "0.1.7",
      supportEmail: "support@example.test",
    });
    const written = await writeSupportReport(report, { localAppData: root });

    assert.equal(written.directory, getSupportReportDirectory({ localAppData: root }));
    assert.equal(isSupportReportPath(written.filePath, written.directory), true);
    assert.match(await readFile(written.filePath, "utf8"), /report_id=report-2/);
    assert.equal(isSupportReportPath(path.join(root, "other.txt"), written.directory), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
