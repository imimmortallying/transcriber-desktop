const { randomUUID } = require("node:crypto");
const { mkdir, writeFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const REPORT_FORMAT_VERSION = 1;
const REPORT_DIRECTORY_SEGMENTS = ["Local ASR", "support-reports"];
const MAX_DIAGNOSTIC_TEXT_LENGTH = 12_000;

function sanitizeDiagnosticText(value) {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value)
    .replace(/(?:[A-Za-z]:[\\/]|\\\\|\/\/)[^\r\n]*/g, "<path>")
    .replace(/\/Users\/[^/\r\n]+/g, "/Users/<user>")
    .slice(0, MAX_DIAGNOSTIC_TEXT_LENGTH);
}

function reportValue(value) {
  return sanitizeDiagnosticText(value).replace(/\r?\n/g, "\\n");
}

function timestampForFileName(createdAt) {
  return createdAt.toISOString().replace(/[:.]/g, "-");
}

function getSupportReportDirectory({ localAppData, fallbackDirectory }) {
  const baseDirectory = typeof localAppData === "string" && localAppData.trim()
    ? localAppData
    : fallbackDirectory;
  if (typeof baseDirectory !== "string" || !baseDirectory.trim()) {
    throw new Error("A per-user support report directory is unavailable.");
  }
  return path.join(baseDirectory, ...REPORT_DIRECTORY_SEGMENTS);
}

function isSupportReportPath(reportPath, reportDirectory) {
  if (typeof reportPath !== "string" || typeof reportDirectory !== "string") {
    return false;
  }
  const relativePath = path.relative(path.resolve(reportDirectory), path.resolve(reportPath));
  return Boolean(relativePath)
    && relativePath !== ".."
    && !relativePath.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relativePath)
    && path.dirname(relativePath) === "."
    && relativePath.toLowerCase().endsWith(".txt");
}

function buildSupportReport({
  reportId = randomUUID(),
  createdAt = new Date(),
  kind,
  errorCode,
  error,
  appVersion,
  supportEmail,
  runtime,
  runtimeChecks = [],
  operation,
}) {
  if (!(createdAt instanceof Date) || Number.isNaN(createdAt.valueOf())) {
    throw new Error("Support report timestamp is invalid.");
  }

  const normalizedError = error instanceof Error
    ? error
    : new Error(typeof error === "string" ? error : "Unknown error");
  const lines = [
    "ASR Support Report",
    `format_version=${REPORT_FORMAT_VERSION}`,
    `report_id=${reportValue(reportId)}`,
    `created_at=${createdAt.toISOString()}`,
    `kind=${reportValue(kind)}`,
    `error_code=${reportValue(errorCode)}`,
    `app_version=${reportValue(appVersion)}`,
    `support_email=${reportValue(supportEmail)}`,
    "",
    "[System]",
    `platform=${process.platform}`,
    `os_release=${reportValue(os.release())}`,
    `os_arch=${reportValue(os.arch())}`,
    `process_arch=${reportValue(process.arch)}`,
    `locale=${reportValue(Intl.DateTimeFormat().resolvedOptions().locale)}`,
    `node=${reportValue(process.versions.node)}`,
    `electron=${reportValue(process.versions.electron || "unavailable")}`,
    "",
    "[Operation]",
    `name=${reportValue(operation?.name || "unknown")}`,
    `input_extension=${reportValue(operation?.inputExtension || "not-collected")}`,
    "",
    "[Runtime]",
    `manifest_version=${reportValue(runtime?.manifestVersion ?? "unavailable")}`,
    `runtime_id=${reportValue(runtime?.runtimeId ?? "unavailable")}`,
    `runtime_version=${reportValue(runtime?.runtimeVersion ?? "unavailable")}`,
    `runtime_api_version=${reportValue(runtime?.runtimeApiVersion ?? "unavailable")}`,
    `python_present=${reportValue(runtime?.pythonPresent ?? "unavailable")}`,
    `ffmpeg_present=${reportValue(runtime?.ffmpegPresent ?? "unavailable")}`,
    `torchaudio_native_library_present=${reportValue(runtime?.torchaudioNativeLibraryPresent ?? "unavailable")}`,
    `torch_cpu_library_present=${reportValue(runtime?.torchCpuLibraryPresent ?? "unavailable")}`,
    "",
    "[Runtime checks]",
  ];

  if (runtimeChecks.length === 0) {
    lines.push("none");
  } else {
    for (const check of runtimeChecks) {
      lines.push(`${reportValue(check.name)}=${reportValue(check.ok ? "ok" : "failed")}`);
      if (check.detail) {
        lines.push(`${reportValue(check.name)}_detail=${reportValue(check.detail)}`);
      }
    }
  }

  lines.push(
    "",
    "[Error]",
    `name=${reportValue(normalizedError.name)}`,
    `message=${reportValue(normalizedError.message)}`,
    "stack:",
    sanitizeDiagnosticText(normalizedError.stack || normalizedError.message || "unavailable"),
    "",
    "[Privacy]",
    "This report excludes audio, video, transcript, project contents, file names, full paths, user names, IP addresses and hardware identifiers.",
    "",
  );

  return {
    reportId,
    createdAt,
    content: lines.join("\n"),
  };
}

async function writeSupportReport(report, directories) {
  const directory = getSupportReportDirectory(directories);
  await mkdir(directory, { recursive: true });
  const fileName = `ASR-support-${timestampForFileName(report.createdAt)}-${report.reportId}.txt`;
  const filePath = path.join(directory, fileName);
  await writeFile(filePath, report.content, { encoding: "utf8", flag: "wx" });
  return { directory, filePath };
}

module.exports = {
  REPORT_FORMAT_VERSION,
  buildSupportReport,
  getSupportReportDirectory,
  isSupportReportPath,
  sanitizeDiagnosticText,
  writeSupportReport,
};
