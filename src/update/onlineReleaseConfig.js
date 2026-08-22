"use strict";

const ONLINE_RELEASE_REPOSITORY = "imimmortallying/asr-desktop-releases";
const DEFAULT_ONLINE_RELEASE_METADATA_URL = `https://github.com/${ONLINE_RELEASE_REPOSITORY}/releases/latest/download/latest.json`;

// Production Clients use the public distribution repository. The environment
// override is intentionally development/test-only and never supplies credentials.
const ONLINE_RELEASE_METADATA_URL = process.env.ASR_ONLINE_RELEASE_METADATA_URL || DEFAULT_ONLINE_RELEASE_METADATA_URL;

module.exports = {
  DEFAULT_ONLINE_RELEASE_METADATA_URL,
  ONLINE_RELEASE_METADATA_URL,
  ONLINE_RELEASE_REPOSITORY,
};
