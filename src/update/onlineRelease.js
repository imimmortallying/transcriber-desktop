"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const https = require("node:https");
const path = require("node:path");
const { canonicalJson, ClientUpdatePackageError } = require("./clientUpdatePackage");
const { parseJsonWithUniqueKeys, validateClientKey } = require("./installationState");
const { PRODUCTION_TRUSTED_SIGNERS } = require("./productionTrust");

const ONLINE_RELEASE_SCHEMA_VERSION = 1;
const ONLINE_RELEASE_PRODUCT = "local-asr-prototype";
const ONLINE_RELEASE_TARGET = "win-x64";
const ONLINE_RELEASE_PURPOSE = "asr-client-online-release-v1";
const ONLINE_RELEASE_SIGNATURE_CONTEXT = "ASR online release metadata v1\0";
const ONLINE_METADATA_MAX_BYTES = 64 * 1024;
const ONLINE_SIGNATURE_MAX_BYTES = 8 * 1024;
const ONLINE_ARTIFACT_MAX_BYTES = 2 * 1024 * 1024 * 1024;
const ONLINE_REQUEST_TIMEOUT_MS = 20_000;
const ONLINE_MAX_REDIRECTS = 4;
const GITHUB_REDIRECT_HOSTS = new Set([
  "github.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
]);

class OnlineReleaseError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function fail(code, message) {
  throw new OnlineReleaseError(code, message);
}

function hasOnlyKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function decodeSignature(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    fail("INVALID_ONLINE_METADATA_SIGNATURE", "Online release metadata signature encoding is invalid.");
  }
  const signature = Buffer.from(value, "base64");
  if (signature.length !== 64) {
    fail("INVALID_ONLINE_METADATA_SIGNATURE", "Online release metadata signature length is invalid.");
  }
  return signature;
}

function parseUrl(value, code, message, { allowHttpForTests = false } = {}) {
  if (typeof value !== "string" || value.length > 2_048) {
    fail(code, message);
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    fail(code, message);
  }
  if ((url.protocol !== "https:" && !(allowHttpForTests && url.protocol === "http:"))
    || url.username || url.password || url.hash || url.search) {
    fail(code, message);
  }
  return url;
}

function isImmutableGitHubReleaseAsset(url) {
  if (url.hostname !== "github.com") {
    return false;
  }
  const pieces = url.pathname.split("/").filter(Boolean);
  if (pieces.length !== 6 || pieces[2] !== "releases" || pieces[3] !== "download") {
    return false;
  }
  return Boolean(pieces[0] && pieces[1] && /^v\d+(?:\.\d+)+$/.test(pieces[4]) && pieces[5].endsWith(".asrupdate"));
}

function isGitHubLatestMetadataAsset(url) {
  if (url.hostname !== "github.com") {
    return false;
  }
  const pieces = url.pathname.split("/").filter(Boolean);
  return pieces.length === 6
    && Boolean(pieces[0] && pieces[1])
    && pieces[2] === "releases"
    && pieces[3] === "latest"
    && pieces[4] === "download"
    && pieces[5] === "latest.json";
}

function normalizeOnlineReleaseMetadata(value, { allowHttpForTests = false } = {}) {
  if (!hasOnlyKeys(value, ["schemaVersion", "purpose", "keyId", "product", "target", "client", "artifact"])
    || value.schemaVersion !== ONLINE_RELEASE_SCHEMA_VERSION
    || value.purpose !== ONLINE_RELEASE_PURPOSE
    || value.product !== ONLINE_RELEASE_PRODUCT
    || value.target !== ONLINE_RELEASE_TARGET
    || typeof value.keyId !== "string" || !/^[a-z0-9][a-z0-9-]{0,127}$/.test(value.keyId)
    || !hasOnlyKeys(value.client, ["version"])
    || !hasOnlyKeys(value.artifact, ["url", "sha256", "bytes"])) {
    fail("INVALID_ONLINE_METADATA", "Online release metadata has an invalid shape.");
  }
  let version;
  try {
    version = validateClientKey(value.client.version);
  } catch {
    fail("INVALID_ONLINE_METADATA", "Online release metadata Client version is invalid.");
  }
  const artifactUrl = parseUrl(value.artifact.url, "INVALID_ONLINE_METADATA", "Online release artifact URL is invalid.", { allowHttpForTests });
  if ((!isImmutableGitHubReleaseAsset(artifactUrl) && !allowHttpForTests)
    || typeof value.artifact.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.artifact.sha256)
    || !Number.isSafeInteger(value.artifact.bytes) || value.artifact.bytes < 1
    || value.artifact.bytes > ONLINE_ARTIFACT_MAX_BYTES) {
    fail("INVALID_ONLINE_METADATA", "Online release artifact is invalid.");
  }
  return {
    schemaVersion: ONLINE_RELEASE_SCHEMA_VERSION,
    purpose: ONLINE_RELEASE_PURPOSE,
    keyId: value.keyId,
    product: ONLINE_RELEASE_PRODUCT,
    target: ONLINE_RELEASE_TARGET,
    client: { version },
    artifact: { url: artifactUrl.toString(), sha256: value.artifact.sha256, bytes: value.artifact.bytes },
  };
}

function onlineReleaseSignaturePayload(metadata) {
  return Buffer.from(`${ONLINE_RELEASE_SIGNATURE_CONTEXT}${canonicalJson(metadata)}`, "utf8");
}

function verifyOnlineReleaseMetadata(value, signature, options = {}) {
  const metadata = normalizeOnlineReleaseMetadata(value, options);
  const trustedSigners = options.trustedSigners || PRODUCTION_TRUSTED_SIGNERS;
  const signer = trustedSigners[metadata.keyId];
  if (!signer || signer.algorithm !== "ed25519" || typeof signer.publicKeyPem !== "string") {
    fail("UNTRUSTED_ONLINE_METADATA_SIGNER", "Online release metadata signer is not trusted.");
  }
  let verified;
  try {
    verified = crypto.verify(null, onlineReleaseSignaturePayload(metadata), signer.publicKeyPem, decodeSignature(signature));
  } catch {
    fail("INVALID_ONLINE_METADATA_SIGNATURE", "Online release metadata signature cannot be verified.");
  }
  if (!verified) {
    fail("INVALID_ONLINE_METADATA_SIGNATURE", "Online release metadata signature is invalid.");
  }
  return metadata;
}

function compareClientVersions(left, right) {
  const parse = (version) => version.split(".").map((part) => {
    if (!/^\d+$/.test(part)) {
      fail("INVALID_CLIENT_VERSION", "Client version must use numeric dot-separated components.");
    }
    return Number(part);
  });
  const leftParts = parse(left);
  const rightParts = parse(right);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (difference !== 0) {
      return difference < 0 ? -1 : 1;
    }
  }
  return 0;
}

function assertMetadataDiscoveryUrl(value, options = {}) {
  const url = parseUrl(value, "ONLINE_RELEASE_NOT_CONFIGURED", "Online release metadata URL is not configured.", options);
  if (!isGitHubLatestMetadataAsset(url) && !options.allowHttpForTests) {
    fail("INVALID_ONLINE_RELEASE_CONFIGURATION", "Online release metadata URL must be a GitHub Releases latest metadata asset URL.");
  }
  return url;
}

function assertOnlineArtifactUrl(value, options = {}) {
  const url = parseUrl(value, "INVALID_ONLINE_METADATA", "Online release artifact URL is invalid.", options);
  if (!isImmutableGitHubReleaseAsset(url)) {
    fail("INVALID_ONLINE_METADATA", "Online release artifact URL must be an immutable GitHub Releases asset URL.");
  }
  return url;
}

function requestResponse(url, {
  request = https.request,
  allowHttpForTests = false,
  redirects = 0,
} = {}) {
  return new Promise((resolve, reject) => {
    const protocol = allowHttpForTests && url.protocol === "http:" ? undefined : https;
    const requestFn = protocol ? protocol.request : request;
    const clientRequest = requestFn(url, { method: "GET", headers: { "Accept": "application/json, application/octet-stream" } }, (response) => {
      const location = response.headers.location;
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && location) {
        response.resume();
        if (redirects >= ONLINE_MAX_REDIRECTS) {
          reject(new OnlineReleaseError("ONLINE_REDIRECT_REJECTED", "Online release request redirected too many times."));
          return;
        }
        let next;
        try {
          next = new URL(location, url);
        } catch {
          reject(new OnlineReleaseError("ONLINE_REDIRECT_REJECTED", "Online release redirect is invalid."));
          return;
        }
        if ((next.protocol !== "https:" && !(allowHttpForTests && next.protocol === "http:"))
          || (!allowHttpForTests && !GITHUB_REDIRECT_HOSTS.has(next.hostname))) {
          reject(new OnlineReleaseError("ONLINE_REDIRECT_REJECTED", "Online release redirect is not an approved GitHub host."));
          return;
        }
        requestResponse(next, { request, allowHttpForTests, redirects: redirects + 1 }).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new OnlineReleaseError("ONLINE_NETWORK_FAILURE", `Online release request failed with HTTP ${response.statusCode}.`));
        return;
      }
      resolve(response);
    });
    clientRequest.once("error", () => reject(new OnlineReleaseError("ONLINE_NETWORK_FAILURE", "Online release request failed.")));
    clientRequest.setTimeout(ONLINE_REQUEST_TIMEOUT_MS, () => clientRequest.destroy(new Error("timeout")));
    clientRequest.end();
  });
}

async function readResponse(response, maximumBytes) {
  const declaredBytes = Number(response.headers["content-length"]);
  if (Number.isSafeInteger(declaredBytes) && (declaredBytes < 1 || declaredBytes > maximumBytes)) {
    response.destroy();
    fail("ONLINE_DOWNLOAD_TOO_LARGE", "Online release response exceeds its size limit.");
  }
  const chunks = [];
  let bytes = 0;
  await new Promise((resolve, reject) => {
    response.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > maximumBytes) {
        response.destroy();
        reject(new OnlineReleaseError("ONLINE_DOWNLOAD_TOO_LARGE", "Online release response exceeds its size limit."));
        return;
      }
      chunks.push(chunk);
    });
    response.once("end", resolve);
    response.once("error", () => reject(new OnlineReleaseError("ONLINE_NETWORK_FAILURE", "Online release response was interrupted.")));
  });
  return Buffer.concat(chunks);
}

function metadataSignatureUrl(metadataUrl, options = {}) {
  const url = assertMetadataDiscoveryUrl(metadataUrl, options);
  if (!url.pathname.endsWith("/latest.json")) {
    fail("INVALID_ONLINE_RELEASE_CONFIGURATION", "Online release metadata URL must end with latest.json.");
  }
  url.pathname = `${url.pathname.slice(0, -"latest.json".length)}latest.sig`;
  return url;
}

async function checkForOnlineUpdate({ installedVersion, metadataUrl, ...options }) {
  const discoveryUrl = assertMetadataDiscoveryUrl(metadataUrl, options);
  try {
    const [metadataResponse, signatureResponse] = await Promise.all([
      requestResponse(discoveryUrl, options),
      requestResponse(metadataSignatureUrl(metadataUrl, options), options),
    ]);
    const [rawMetadata, rawSignature] = await Promise.all([
      readResponse(metadataResponse, ONLINE_METADATA_MAX_BYTES),
      readResponse(signatureResponse, ONLINE_SIGNATURE_MAX_BYTES),
    ]);
    const parsed = parseJsonWithUniqueKeys(rawMetadata.toString("utf8"));
    const metadata = verifyOnlineReleaseMetadata(parsed, rawSignature.toString("utf8").trim(), options);
    return compareClientVersions(metadata.client.version, installedVersion) > 0
      ? { available: true, metadata, metadataSignature: rawSignature.toString("utf8").trim() }
      : { available: false, metadata, metadataSignature: rawSignature.toString("utf8").trim() };
  } catch (error) {
    if (error instanceof OnlineReleaseError) {
      throw error;
    }
    fail("INVALID_ONLINE_METADATA", "Online release metadata cannot be read safely.");
  }
}

async function downloadOnlineUpdate(metadata, metadataSignature, temporaryDirectory, options = {}) {
  const verified = verifyOnlineReleaseMetadata(metadata, metadataSignature, options);
  const directory = path.resolve(temporaryDirectory);
  const temporaryPath = path.join(directory, "client.asrupdate.partial");
  const packagePath = path.join(directory, "client.asrupdate");
  try {
    const response = await requestResponse(new URL(verified.artifact.url), options);
    const declaredBytes = Number(response.headers["content-length"]);
    if (Number.isSafeInteger(declaredBytes) && declaredBytes !== verified.artifact.bytes) {
      response.destroy();
      fail("ONLINE_ARTIFACT_INTEGRITY_FAILURE", "Online update download size does not match signed metadata.");
    }
    const output = await fs.open(temporaryPath, "wx");
    const hash = crypto.createHash("sha256");
    let bytes = 0;
    try {
      await new Promise((resolve, reject) => {
        response.on("data", async (chunk) => {
          response.pause();
          try {
            bytes += chunk.length;
            if (bytes > verified.artifact.bytes || bytes > ONLINE_ARTIFACT_MAX_BYTES) {
              throw new OnlineReleaseError("ONLINE_ARTIFACT_INTEGRITY_FAILURE", "Online update download exceeds signed size.");
            }
            hash.update(chunk);
            await output.write(chunk);
            response.resume();
          } catch (error) {
            response.destroy();
            reject(error);
          }
        });
        response.once("end", resolve);
        response.once("error", () => reject(new OnlineReleaseError("ONLINE_NETWORK_FAILURE", "Online update download was interrupted.")));
      });
      await output.sync();
    } finally {
      await output.close();
    }
    if (bytes !== verified.artifact.bytes || hash.digest("hex") !== verified.artifact.sha256) {
      fail("ONLINE_ARTIFACT_INTEGRITY_FAILURE", "Online update download does not match signed metadata.");
    }
    await fs.rename(temporaryPath, packagePath);
    return packagePath;
  } catch (error) {
    await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

module.exports = {
  GITHUB_REDIRECT_HOSTS,
  ONLINE_ARTIFACT_MAX_BYTES,
  ONLINE_METADATA_MAX_BYTES,
  ONLINE_SIGNATURE_MAX_BYTES,
  ONLINE_RELEASE_PRODUCT,
  ONLINE_RELEASE_PURPOSE,
  ONLINE_RELEASE_SCHEMA_VERSION,
  ONLINE_RELEASE_SIGNATURE_CONTEXT,
  ONLINE_RELEASE_TARGET,
  OnlineReleaseError,
  assertOnlineArtifactUrl,
  assertMetadataDiscoveryUrl,
  checkForOnlineUpdate,
  compareClientVersions,
  downloadOnlineUpdate,
  metadataSignatureUrl,
  normalizeOnlineReleaseMetadata,
  onlineReleaseSignaturePayload,
  verifyOnlineReleaseMetadata,
};
