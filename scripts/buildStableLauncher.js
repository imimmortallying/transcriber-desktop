const { createHash } = require("node:crypto");
const { createWriteStream } = require("node:fs");
const { access, mkdir, readFile, rename, rm, stat } = require("node:fs/promises");
const https = require("node:https");
const path = require("node:path");
const { pipeline } = require("node:stream/promises");
const { spawn } = require("node:child_process");
const { path7za: archiver } = require("7zip-bin");

const projectRoot = path.resolve(__dirname, "..");
const buildDirectory = path.join(projectRoot, "build");
const toolCacheDirectory = path.join(buildDirectory, "tool-cache");
const nsisVersion = "3.0.4.1";
const nsisArchiveName = `nsis-${nsisVersion}.7z`;
const nsisArchiveUrl = `https://github.com/electron-userland/electron-builder-binaries/releases/download/nsis-${nsisVersion}/${nsisArchiveName}`;
const nsisArchiveSha512 = "VKMiizYdmNdJOWpRGz4trl4lD++BvYP2irAXpMilheUP0pc93iKlWAoP843Vlraj8YG19CVn0j+dCo/hURz9+Q==";
const nsisArchivePath = path.join(toolCacheDirectory, nsisArchiveName);
const nsisDirectory = path.join(toolCacheDirectory, `nsis-${nsisVersion}`);
const launcherSource = path.join(buildDirectory, "stable-launcher.nsi");
const launcherOutput = path.join(buildDirectory, "stable-launcher.exe");

async function sha512(filePath) {
  const hash = createHash("sha512");
  hash.update(await readFile(filePath));
  return hash.digest("base64");
}

async function hasExpectedArchive() {
  try {
    return await sha512(nsisArchivePath) === nsisArchiveSha512;
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function download(url, destination, redirectsRemaining = 5) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        if (redirectsRemaining === 0) {
          reject(new Error("NSIS download exceeded the redirect limit."));
          return;
        }
        resolve(download(new URL(response.headers.location, url), destination, redirectsRemaining - 1));
        return;
      }

      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Unable to download pinned NSIS ${nsisVersion}: HTTP ${response.statusCode}.`));
        return;
      }

      pipeline(response, createWriteStream(destination)).then(resolve, reject);
    });
    request.once("error", reject);
  });
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

async function ensureNsisArchive() {
  await mkdir(toolCacheDirectory, { recursive: true });
  if (await hasExpectedArchive()) {
    return;
  }

  const temporaryArchivePath = `${nsisArchivePath}.download`;
  await rm(nsisArchivePath, { force: true });
  await rm(temporaryArchivePath, { force: true });
  await download(nsisArchiveUrl, temporaryArchivePath);
  const downloadedHash = await sha512(temporaryArchivePath);
  if (downloadedHash !== nsisArchiveSha512) {
    await rm(temporaryArchivePath, { force: true });
    throw new Error(`Pinned NSIS ${nsisVersion} failed SHA-512 verification.`);
  }

  await rename(temporaryArchivePath, nsisArchivePath);
}

async function getNsisCompiler() {
  await ensureNsisArchive();
  const compilerPath = path.join(nsisDirectory, "Bin", "makensis.exe");
  await rm(nsisDirectory, { recursive: true, force: true });
  await mkdir(nsisDirectory, { recursive: true });
  await run(archiver, ["x", "-y", `-o${nsisDirectory}`, nsisArchivePath]);
  await access(compilerPath);
  return compilerPath;
}

async function buildStableLauncher({ outputPath = launcherOutput, testMode = false } = {}) {
  const compilerPath = await getNsisCompiler();
  await mkdir(path.dirname(outputPath), { recursive: true });
  await rm(outputPath, { force: true });
  const argumentsList = [
    "-V2",
    "-INPUTCHARSET",
    "UTF8",
    `-DOUTPUT_PATH=${outputPath}`,
  ];
  if (testMode) {
    argumentsList.push("-DASR_LAUNCHER_TEST");
  }
  argumentsList.push(launcherSource);
  await run(compilerPath, argumentsList, { cwd: buildDirectory });

  const launcherInfo = await stat(outputPath);
  if (!launcherInfo.isFile() || launcherInfo.size === 0) {
    throw new Error("Stable launcher build did not produce an executable.");
  }
  return outputPath;
}

if (require.main === module) {
  buildStableLauncher().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  buildStableLauncher,
  getNsisCompiler,
  launcherOutput,
  launcherSource,
  nsisArchiveSha512,
  nsisArchiveUrl,
  nsisVersion,
  run,
};
