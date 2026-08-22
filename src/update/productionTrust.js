"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");

// This is public application trust material. The matching private key exists
// only in the separate production release-signing environment.
const PRODUCTION_TRUSTED_SIGNERS = Object.freeze({
  "asr-prod-ed25519-e4cb8825e9276bf0": Object.freeze({
    algorithm: "ed25519",
    publicKeyPem: [
      "-----BEGIN PUBLIC KEY-----",
      "MCowBQYDK2VwAyEAzew3EHpuaCvvrzSCEjlTeMbNJ3zjFK55/G+09qJDv3c=",
      "-----END PUBLIC KEY-----",
      "",
    ].join("\n"),
  }),
});

async function loadProductionPrivateKey({ keyId, privateKeyFile, privateKeyPassphraseFile }) {
  const signer = PRODUCTION_TRUSTED_SIGNERS[keyId];
  if (!signer) {
    throw new Error("The key ID is not a pinned production signing key.");
  }
  if (typeof privateKeyFile !== "string" || !privateKeyFile) {
    throw new Error("A production private-key file is required.");
  }

  const [privateKeyPem, rawPassphrase] = await Promise.all([
    fs.readFile(privateKeyFile, "utf8"),
    privateKeyPassphraseFile ? fs.readFile(privateKeyPassphraseFile, "utf8") : undefined,
  ]);
  const privateKey = crypto.createPrivateKey({
    key: privateKeyPem,
    format: "pem",
    type: "pkcs8",
    ...(rawPassphrase === undefined ? {} : { passphrase: rawPassphrase.replace(/\r?\n$/, "") }),
  });
  if (crypto.createPublicKey(privateKey).export({ type: "spki", format: "pem" }) !== signer.publicKeyPem) {
    throw new Error("The supplied private key does not match the pinned production signing key.");
  }
  return privateKey;
}

async function assertProductionSigningConfiguration(options) {
  await loadProductionPrivateKey(options);
}

module.exports = {
  PRODUCTION_TRUSTED_SIGNERS,
  assertProductionSigningConfiguration,
  loadProductionPrivateKey,
};
