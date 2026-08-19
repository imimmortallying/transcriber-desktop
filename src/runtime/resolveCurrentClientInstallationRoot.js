const path = require("node:path");

function resolveCurrentClientInstallationRoot(resourcesPath) {
  return path.resolve(resourcesPath, "..", "..");
}

module.exports = { resolveCurrentClientInstallationRoot };
