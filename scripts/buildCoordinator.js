const { createHash } = require("node:crypto");
const { createReadStream, createWriteStream } = require("node:fs");
const { copyFile, mkdir, readFile, rename, rm, stat, writeFile } = require("node:fs/promises");
const https = require("node:https");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { pipeline } = require("node:stream/promises");
const { build } = require("esbuild");
const { inject } = require("postject");

const projectRoot = path.resolve(__dirname, "..");
const buildDirectory = path.join(projectRoot, "build");
const coordinatorDirectory = path.join(buildDirectory, "coordinator");
const coordinatorEntryPoint = path.join(projectRoot, "src", "coordinator", "main.js");
const coordinatorOutput = path.join(coordinatorDirectory, "asr-coordinator.exe");
const nodeVersion = "v24.16.0";
const nodeArchiveUrl = `https://nodejs.org/download/release/${nodeVersion}/win-x64/node.exe`;
const nodeExecutableSha256 = "b3094d0b49f9ad602262a9921551737bb97637c05dd357a06ae98188d7290aa3";
const nodeToolDirectory = path.join(buildDirectory, "tool-cache", `node-${nodeVersion}-win-x64`);
const nodeExecutable = path.join(nodeToolDirectory, "node.exe");
const seaFuse = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";
const dosELfanewOffset = 0x3c;
const peSignature = "PE\0\0";
const peSignatureSize = 4;
const coffHeaderSize = 20;
const coffOptionalHeaderSizeOffset = 16;
const optionalHeaderMagicOffset = 0;
const optionalHeaderSubsystemOffset = 68;
const pe32PlusOptionalHeaderMagic = 0x20b;
const windowsGuiSubsystem = 2;
const windowsCuiSubsystem = 3;

function inspectPeSubsystem(executable) {
  if (executable.length < dosELfanewOffset + 4 || executable.toString("ascii", 0, 2) !== "MZ") {
    throw new Error("Coordinator SEA output does not have a valid DOS/MZ header.");
  }

  const peHeaderOffset = executable.readUInt32LE(dosELfanewOffset);
  const minimumPeHeaderSize = peSignatureSize + coffHeaderSize;
  if (peHeaderOffset > executable.length - minimumPeHeaderSize) {
    throw new Error("Coordinator SEA output has an invalid PE header offset.");
  }
  if (executable.toString("ascii", peHeaderOffset, peHeaderOffset + peSignatureSize) !== peSignature) {
    throw new Error("Coordinator SEA output does not have a valid PE signature.");
  }

  const coffHeaderOffset = peHeaderOffset + peSignatureSize;
  const optionalHeaderSize = executable.readUInt16LE(coffHeaderOffset + coffOptionalHeaderSizeOffset);
  const optionalHeaderOffset = coffHeaderOffset + coffHeaderSize;
  const minimumOptionalHeaderSize = optionalHeaderSubsystemOffset + 2;
  if (
    optionalHeaderSize < minimumOptionalHeaderSize
    || optionalHeaderOffset > executable.length - optionalHeaderSize
  ) {
    throw new Error("Coordinator SEA output has a truncated Optional Header.");
  }
  if (executable.readUInt16LE(optionalHeaderOffset + optionalHeaderMagicOffset) !== pe32PlusOptionalHeaderMagic) {
    throw new Error("Coordinator SEA output does not have a PE32+ Optional Header.");
  }

  const subsystemOffset = optionalHeaderOffset + optionalHeaderSubsystemOffset;
  return {
    subsystem: executable.readUInt16LE(subsystemOffset),
    subsystemOffset,
  };
}

async function transformToWindowsGuiExecutable(executablePath) {
  const executable = await readFile(executablePath);
  const { subsystem, subsystemOffset } = inspectPeSubsystem(executable);
  if (subsystem !== windowsCuiSubsystem) {
    throw new Error("Coordinator SEA output does not have the expected WINDOWS_CUI subsystem.");
  }

  executable.writeUInt16LE(windowsGuiSubsystem, subsystemOffset);
  await writeFile(executablePath, executable);

  const transformed = inspectPeSubsystem(await readFile(executablePath));
  if (transformed.subsystem !== windowsGuiSubsystem) {
    throw new Error("Coordinator SEA output did not retain the WINDOWS_GUI subsystem.");
  }
}

async function sha256(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

function download(url, destination) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        reject(new Error("Pinned Node host download unexpectedly redirected."));
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Unable to download pinned Node host: HTTP ${response.statusCode}.`));
        return;
      }
      pipeline(response, createWriteStream(destination)).then(resolve, reject);
    });
    request.once("error", reject);
  });
}

async function hasVerifiedNodeHost() {
  try {
    return await sha256(nodeExecutable) === nodeExecutableSha256;
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function ensureNodeHost() {
  await mkdir(nodeToolDirectory, { recursive: true });
  if (await hasVerifiedNodeHost()) {
    return nodeExecutable;
  }

  const temporaryPath = `${nodeExecutable}.download`;
  await rm(nodeExecutable, { force: true });
  await rm(temporaryPath, { force: true });
  await download(nodeArchiveUrl, temporaryPath);
  if (await sha256(temporaryPath) !== nodeExecutableSha256) {
    await rm(temporaryPath, { force: true });
    throw new Error("Pinned Node host failed SHA-256 verification.");
  }
  await rename(temporaryPath, nodeExecutable);
  return nodeExecutable;
}

function run(command, argumentsList, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, argumentsList, { stdio: "inherit", ...options });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${path.basename(command)} exited with code ${code}.`));
    });
  });
}

async function buildCoordinator({
  entryPoint = coordinatorEntryPoint,
  outputPath = coordinatorOutput,
} = {}) {
  const outputDirectory = path.dirname(outputPath);
  const outputStagingDirectory = path.join(outputDirectory, "staging");
  const outputBundledEntryPoint = path.join(outputStagingDirectory, "coordinator.cjs");
  const outputSeaConfigPath = path.join(outputStagingDirectory, "sea-config.json");
  const outputSeaBlobPath = path.join(outputStagingDirectory, "coordinator.blob");
  const stagedOutput = path.join(outputStagingDirectory, "asr-coordinator.exe");
  const nodeHost = await ensureNodeHost();
  await mkdir(outputDirectory, { recursive: true });
  await rm(outputPath, { force: true });
  await rm(outputStagingDirectory, { recursive: true, force: true });
  await mkdir(outputStagingDirectory, { recursive: true });

  try {
    await build({
      entryPoints: [entryPoint],
      outfile: outputBundledEntryPoint,
      bundle: true,
      format: "cjs",
      platform: "node",
      target: "node24",
      logLevel: "silent",
    });
    await writeFile(
      outputSeaConfigPath,
      `${JSON.stringify({
        main: outputBundledEntryPoint,
        output: outputSeaBlobPath,
        mainFormat: "commonjs",
        disableExperimentalSEAWarning: true,
        useSnapshot: false,
        useCodeCache: false,
        execArgvExtension: "none",
      }, null, 2)}\n`,
      "utf8",
    );
    await run(nodeHost, ["--experimental-sea-config", outputSeaConfigPath]);
    await copyFile(nodeHost, stagedOutput);
    await inject(stagedOutput, "NODE_SEA_BLOB", await readFile(outputSeaBlobPath), {
      sentinelFuse: seaFuse,
    });
    await transformToWindowsGuiExecutable(stagedOutput);
    const outputInfo = await stat(stagedOutput);
    const { subsystem } = inspectPeSubsystem(await readFile(stagedOutput));
    if (!outputInfo.isFile() || outputInfo.size === 0 || subsystem !== windowsGuiSubsystem) {
      throw new Error("Coordinator SEA build did not produce an executable.");
    }
    await rename(stagedOutput, outputPath);
    return outputPath;
  } finally {
    await rm(outputStagingDirectory, { recursive: true, force: true });
  }
}

if (require.main === module) {
  buildCoordinator().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  buildCoordinator,
  coordinatorOutput,
  nodeArchiveUrl,
  nodeExecutableSha256,
  nodeVersion,
};
