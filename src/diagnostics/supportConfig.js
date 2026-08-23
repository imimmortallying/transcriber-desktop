const { localAsr = {} } = require("../../package.json");

const SUPPORT_EMAIL = localAsr.supportEmail;

if (typeof SUPPORT_EMAIL !== "string" || !SUPPORT_EMAIL.includes("@")) {
  throw new Error("ASR support email is not configured.");
}

module.exports = { SUPPORT_EMAIL };
