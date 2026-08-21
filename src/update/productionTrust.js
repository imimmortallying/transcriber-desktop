"use strict";

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

module.exports = { PRODUCTION_TRUSTED_SIGNERS };
