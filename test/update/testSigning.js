"use strict";

const TEST_KEY_ID = "asr-test-ed25519-2026";
const TEST_PRIVATE_KEY = [
  "-----BEGIN PRIVATE KEY-----",
  "MC4CAQAwBQYDK2VwBCIEICcHbv16GrgmdjHglhtxCLIER68R5tonjq5p5i/ajEuV",
  "-----END PRIVATE KEY-----",
  "",
].join("\n");
const TEST_TRUSTED_SIGNERS = Object.freeze({
  [TEST_KEY_ID]: Object.freeze({
    algorithm: "ed25519",
    publicKeyPem: [
      "-----BEGIN PUBLIC KEY-----",
      "MCowBQYDK2VwAyEAVlMmhOdX1BaSji1HIKSKshdgAsJ+/bvxCu+xAl8p4KY=",
      "-----END PUBLIC KEY-----",
      "",
    ].join("\n"),
  }),
});

module.exports = { TEST_KEY_ID, TEST_PRIVATE_KEY, TEST_TRUSTED_SIGNERS };
