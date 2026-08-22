const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const CLIENT_EXECUTABLE = "local-asr-prototype.exe";
const MAX_STATE_FILE_BYTES = 64 * 1024;
const SCHEMA_VERSION = 1;
const SCHEMA_VERSION_V2 = 2;
const MAX_LAUNCH_SCHEMA_VERSION = SCHEMA_VERSION_V2;
const INSPECT_MAX_SCHEMA_ARGUMENT = "--asr-installation-state-max-schema=";
const STATE_DIRECTORY = "InstallationState";
const SLOT_NAMES = ["slot-a.json", "slot-b.json"];
const BOOTSTRAP_DIRECTORY_PREFIX = "InstallationState.bootstrap-";
const INVALID_DIRECTORY_PREFIX = "InstallationState.invalid-";

class InstallationStateError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function fail(code, message) {
  throw new InstallationStateError(code, message);
}

function hasOnlyKeys(value, keys) {
  const actualKeys = Object.keys(value).sort();
  const expectedKeys = [...keys].sort();
  return actualKeys.length === expectedKeys.length && actualKeys.every((key, index) => key === expectedKeys[index]);
}

function validateClientKey(version) {
  if (typeof version !== "string" || !version || version.length > 128) {
    fail("INVALID_CLIENT_KEY", "Installation state Client version is invalid.");
  }
  if (/[<>:"/\\|?*\u0000-\u001f]/.test(version) || version.endsWith(".") || version.endsWith(" ")) {
    fail("INVALID_CLIENT_KEY", "Installation state Client version is not a safe path segment.");
  }
  if (version === "." || version === ".." || path.isAbsolute(version) || path.basename(version) !== version) {
    fail("INVALID_CLIENT_KEY", "Installation state Client version is not a safe path segment.");
  }

  const reservedName = version.split(".", 1)[0].toUpperCase();
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(reservedName)) {
    fail("INVALID_CLIENT_KEY", "Installation state Client version is a reserved Windows name.");
  }

  return version;
}

function validateClientReference(reference, fieldName) {
  if (!reference || typeof reference !== "object" || Array.isArray(reference) || !hasOnlyKeys(reference, ["version"])) {
    fail("INVALID_STATE", `Installation state ${fieldName} is invalid.`);
  }

  return { version: validateClientKey(reference.version) };
}

function normalizeState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !hasOnlyKeys(value, [
    "schemaVersion",
    "generation",
    "activeClient",
    "knownGoodClient",
  ])) {
    fail("INVALID_STATE", "Installation state must contain exactly the schema v1 fields.");
  }
  if (value.schemaVersion !== SCHEMA_VERSION) {
    if (Number.isSafeInteger(value.schemaVersion) && value.schemaVersion > 0) {
      fail("UNSUPPORTED_SCHEMA", "Installation state schema is unsupported.");
    }
    fail("INVALID_STATE", "Installation state schema version is invalid.");
  }
  if (!Number.isSafeInteger(value.generation) || value.generation < 1) {
    fail("INVALID_STATE", "Installation state generation is invalid.");
  }

  const activeClient = validateClientReference(value.activeClient, "activeClient");
  const knownGoodClient = validateClientReference(value.knownGoodClient, "knownGoodClient");
  if (activeClient.version !== knownGoodClient.version) {
    fail("INVALID_STATE", "Schema v1 active and known-good Clients must match.");
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    generation: value.generation,
    activeClient,
    knownGoodClient,
  };
}

function normalizeStateV2(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !hasOnlyKeys(value, [
    "schemaVersion",
    "generation",
    "activeClient",
    "knownGoodClient",
    "updateTransaction",
  ])) {
    fail("INVALID_STATE", "Installation state must contain exactly the schema v2 fields.");
  }
  if (value.schemaVersion !== SCHEMA_VERSION_V2) {
    if (Number.isSafeInteger(value.schemaVersion) && value.schemaVersion > 0) {
      fail("UNSUPPORTED_SCHEMA", "Installation state schema is unsupported.");
    }
    fail("INVALID_STATE", "Installation state schema version is invalid.");
  }
  if (!Number.isSafeInteger(value.generation) || value.generation < 1) {
    fail("INVALID_STATE", "Installation state generation is invalid.");
  }

  const activeClient = validateClientReference(value.activeClient, "activeClient");
  const knownGoodClient = validateClientReference(value.knownGoodClient, "knownGoodClient");
  if (value.updateTransaction === null) {
    if (activeClient.version !== knownGoodClient.version) {
      fail("INVALID_STATE", "Schema v2 steady active and known-good Clients must match.");
    }
    return {
      schemaVersion: SCHEMA_VERSION_V2,
      generation: value.generation,
      activeClient,
      knownGoodClient,
      updateTransaction: null,
    };
  }
  if (!value.updateTransaction || typeof value.updateTransaction !== "object" || Array.isArray(value.updateTransaction)
    || !hasOnlyKeys(value.updateTransaction, ["phase", "candidateClient"])) {
    fail("INVALID_STATE", "Installation state schema v2 update transaction is invalid.");
  }

  const { phase } = value.updateTransaction;
  const candidateClient = validateClientReference(value.updateTransaction.candidateClient, "update transaction candidateClient");
  if (phase === "prepared") {
    if (activeClient.version !== knownGoodClient.version || candidateClient.version === knownGoodClient.version) {
      fail("INVALID_STATE", "Schema v2 prepared transaction Clients are inconsistent.");
    }
  } else if (phase === "activated") {
    if (activeClient.version !== candidateClient.version || knownGoodClient.version === candidateClient.version) {
      fail("INVALID_STATE", "Schema v2 activated transaction Clients are inconsistent.");
    }
  } else {
    fail("INVALID_STATE", "Installation state schema v2 update transaction phase is invalid.");
  }

  return {
    schemaVersion: SCHEMA_VERSION_V2,
    generation: value.generation,
    activeClient,
    knownGoodClient,
    updateTransaction: { phase, candidateClient },
  };
}

function sameLogicalState(left, right) {
  if (!left || !right || left.schemaVersion !== right.schemaVersion
    || left.generation !== right.generation
    || left.activeClient.version !== right.activeClient.version
    || left.knownGoodClient.version !== right.knownGoodClient.version) {
    return false;
  }
  if (left.schemaVersion === SCHEMA_VERSION) {
    return true;
  }
  if (left.schemaVersion !== SCHEMA_VERSION_V2) {
    return false;
  }
  if (left.updateTransaction === null || right.updateTransaction === null) {
    return left.updateTransaction === null && right.updateTransaction === null;
  }
  return left.updateTransaction.phase === right.updateTransaction.phase
    && left.updateTransaction.candidateClient.version === right.updateTransaction.candidateClient.version;
}

function parseJsonWithUniqueKeys(raw) {
  let position = 0;

  const skipWhitespace = () => {
    while (" \t\r\n".includes(raw[position])) {
      position += 1;
    }
  };
  const parseString = () => {
    const start = position;
    if (raw[position] !== '"') {
      throw new SyntaxError("Expected JSON string.");
    }
    position += 1;
    while (position < raw.length) {
      const character = raw[position];
      if (character === '"') {
        position += 1;
        return JSON.parse(raw.slice(start, position));
      }
      if (character === "\\") {
        position += 1;
        const escape = raw[position];
        if (!'"\\/bfnrtu'.includes(escape)) {
          throw new SyntaxError("Invalid JSON escape.");
        }
        if (escape === "u") {
          const codePoint = raw.slice(position + 1, position + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(codePoint)) {
            throw new SyntaxError("Invalid JSON Unicode escape.");
          }
          position += 4;
        }
      } else if (character < " ") {
        throw new SyntaxError("Invalid JSON control character.");
      }
      position += 1;
    }
    throw new SyntaxError("Unterminated JSON string.");
  };
  const parseValue = () => {
    skipWhitespace();
    const character = raw[position];
    if (character === '"') {
      return parseString();
    }
    if (character === "{") {
      position += 1;
      skipWhitespace();
      const value = {};
      const keys = new Set();
      if (raw[position] === "}") {
        position += 1;
        return value;
      }
      while (true) {
        skipWhitespace();
        const key = parseString();
        if (keys.has(key)) {
          fail("DUPLICATE_KEY", "Installation state contains duplicate JSON keys.");
        }
        keys.add(key);
        skipWhitespace();
        if (raw[position] !== ":") {
          throw new SyntaxError("Expected JSON object colon.");
        }
        position += 1;
        value[key] = parseValue();
        skipWhitespace();
        if (raw[position] === "}") {
          position += 1;
          return value;
        }
        if (raw[position] !== ",") {
          throw new SyntaxError("Expected JSON object separator.");
        }
        position += 1;
      }
    }
    if (character === "[") {
      position += 1;
      skipWhitespace();
      const value = [];
      if (raw[position] === "]") {
        position += 1;
        return value;
      }
      while (true) {
        value.push(parseValue());
        skipWhitespace();
        if (raw[position] === "]") {
          position += 1;
          return value;
        }
        if (raw[position] !== ",") {
          throw new SyntaxError("Expected JSON array separator.");
        }
        position += 1;
      }
    }
    for (const literal of ["true", "false", "null"]) {
      if (raw.startsWith(literal, position)) {
        position += literal.length;
        return JSON.parse(literal);
      }
    }
    const number = raw.slice(position).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (!number) {
      throw new SyntaxError("Invalid JSON value.");
    }
    position += number[0].length;
    return JSON.parse(number[0]);
  };

  const value = parseValue();
  skipWhitespace();
  if (position !== raw.length) {
    throw new SyntaxError("Unexpected JSON content.");
  }
  return value;
}

function classifyParsedState(parsed, acceptedSchemaVersions) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)
    || !Number.isSafeInteger(parsed.schemaVersion) || parsed.schemaVersion < 1) {
    return { kind: "uninspectable" };
  }
  if (!acceptedSchemaVersions.includes(parsed.schemaVersion)) {
    return { kind: "unsupported" };
  }

  const normalize = parsed.schemaVersion === SCHEMA_VERSION
    ? normalizeState
    : parsed.schemaVersion === SCHEMA_VERSION_V2
      ? normalizeStateV2
      : undefined;
  if (!normalize) {
    return { kind: "unsupported" };
  }
  try {
    return { kind: "valid", state: normalize(parsed) };
  } catch (error) {
    if (error instanceof InstallationStateError && error.code === "UNSUPPORTED_SCHEMA") {
      return { kind: "unsupported" };
    }
    return { kind: parsed.schemaVersion === SCHEMA_VERSION_V2 ? "uninspectable" : "invalid" };
  }
}

async function classifySlot(slotPath, { fsApi = fs, acceptedSchemaVersions = [SCHEMA_VERSION] } = {}) {
  let raw;
  try {
    const slotInfo = await fsApi.lstat(slotPath);
    if (!slotInfo.isFile() || isReparsePoint(slotInfo) || slotInfo.size > MAX_STATE_FILE_BYTES) {
      return { kind: "uninspectable", path: slotPath };
    }
    raw = await fsApi.readFile(slotPath, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return { kind: "missing", path: slotPath };
    }
    return { kind: "uninspectable", path: slotPath };
  }

  let parsed;
  try {
    parsed = parseJsonWithUniqueKeys(raw);
  } catch (error) {
    return { kind: "uninspectable", path: slotPath };
  }

  return { ...classifyParsedState(parsed, acceptedSchemaVersions), path: slotPath };
}

async function readInstallationStateWithSchemas(installationRoot, acceptedSchemaVersions, options = {}) {
  const stateDirectory = path.join(path.resolve(installationRoot), STATE_DIRECTORY);
  const { fsApi = fs } = options;
  let stateDirectoryExists = false;
  try {
    const stateDirectoryInfo = await fsApi.lstat(stateDirectory);
    stateDirectoryExists = true;
    if (!stateDirectoryInfo.isDirectory() || isReparsePoint(stateDirectoryInfo)) {
      return {
        kind: "uninspectable",
        stateDirectory,
        stateDirectoryExists,
        slots: SLOT_NAMES.map((slotName) => ({ kind: "uninspectable", path: path.join(stateDirectory, slotName) })),
      };
    }
  } catch (error) {
    if (!error || error.code !== "ENOENT") {
      stateDirectoryExists = true;
    }
  }
  const slots = await Promise.all(
    SLOT_NAMES.map((slotName) => classifySlot(path.join(stateDirectory, slotName), {
      ...options,
      acceptedSchemaVersions,
    })),
  );

  if (slots.some((slot) => slot.kind === "unsupported")) {
    return { kind: "unsupported", stateDirectory, stateDirectoryExists, slots };
  }
  if (slots.some((slot) => slot.kind === "uninspectable")) {
    return { kind: "uninspectable", stateDirectory, stateDirectoryExists, slots };
  }

  const validSlots = slots.filter((slot) => slot.kind === "valid");
  if (validSlots.length === 0) {
    return { kind: "no-valid-state", stateDirectory, stateDirectoryExists, slots };
  }
  if (validSlots.length === 1) {
    return { kind: "selected", stateDirectory, stateDirectoryExists, slots, selected: validSlots[0].state };
  }

  const [first, second] = validSlots;
  if (first.state.generation !== second.state.generation) {
    return {
      kind: "selected",
      stateDirectory,
      stateDirectoryExists,
      slots,
      selected: first.state.generation > second.state.generation ? first.state : second.state,
    };
  }
  if (sameLogicalState(first.state, second.state)) {
    return { kind: "selected", stateDirectory, stateDirectoryExists, slots, selected: first.state };
  }
  return { kind: "ambiguous", stateDirectory, stateDirectoryExists, slots };
}

async function readInstallationState(installationRoot, options = {}) {
  return readInstallationStateWithSchemas(installationRoot, [SCHEMA_VERSION], options);
}

async function readLaunchInstallationState(installationRoot, options = {}) {
  return readInstallationStateWithSchemas(installationRoot, [SCHEMA_VERSION, SCHEMA_VERSION_V2], options);
}

function parseInspectMaxSchema(argumentsList) {
  const capabilityArguments = argumentsList.filter((argument) => argument.startsWith(INSPECT_MAX_SCHEMA_ARGUMENT));
  if (capabilityArguments.length > 1) {
    fail("INVALID_INSPECT_CAPABILITY", "Installation-state inspect capability was supplied more than once.");
  }
  if (capabilityArguments.length === 0) {
    return SCHEMA_VERSION;
  }

  const rawValue = capabilityArguments[0].slice(INSPECT_MAX_SCHEMA_ARGUMENT.length);
  if (!/^[1-9]\d*$/.test(rawValue)) {
    fail("INVALID_INSPECT_CAPABILITY", "Installation-state inspect capability is invalid.");
  }
  const maxSchemaVersion = Number(rawValue);
  if (!Number.isSafeInteger(maxSchemaVersion) || maxSchemaVersion > MAX_LAUNCH_SCHEMA_VERSION) {
    fail("INVALID_INSPECT_CAPABILITY", "Installation-state inspect capability is unsupported.");
  }
  return maxSchemaVersion;
}

async function inspectInstallationStateForSetup(installationRoot, argumentsList, options = {}) {
  const maxSchemaVersion = parseInspectMaxSchema(argumentsList);
  const stateResult = await readLaunchInstallationState(installationRoot, options);
  if (stateResult.kind === "unsupported" || stateResult.kind === "uninspectable") {
    return stateResult;
  }

  const hasSchemaV2 = stateResult.slots.some(
    (slot) => slot.kind === "valid" && slot.state.schemaVersion === SCHEMA_VERSION_V2,
  );
  if (!hasSchemaV2) {
    return { kind: "compatible", stateResult };
  }
  if (stateResult.kind !== "selected") {
    return { ...stateResult, kind: "uninspectable" };
  }
  if (maxSchemaVersion < SCHEMA_VERSION_V2) {
    return { kind: "setup-schema-capability-insufficient", stateResult };
  }
  return { kind: "v2-state-requires-full-setup-mutation-authority", stateResult };
}

function isReparsePoint(info) {
  return info.isSymbolicLink();
}

function isUnavailablePathError(error) {
  return error && ["ENOENT", "ENOTDIR"].includes(error.code);
}

async function assertSelectedClient(installationRoot, state, { fsApi = fs } = {}) {
  const rootPath = path.resolve(installationRoot);
  const clientVersion = validateClientKey(state.activeClient.version);
  const clientsPath = path.join(rootPath, "Clients");
  const clientPath = path.join(clientsPath, clientVersion);
  const executablePath = path.join(clientPath, CLIENT_EXECUTABLE);

  try {
    const [rootInfo, clientsInfo, clientInfo, executableInfo] = await Promise.all([
      fsApi.lstat(rootPath),
      fsApi.lstat(clientsPath),
      fsApi.lstat(clientPath),
      fsApi.lstat(executablePath),
    ]);
    if (!rootInfo.isDirectory() || !clientsInfo.isDirectory() || !clientInfo.isDirectory() || !executableInfo.isFile()
      || isReparsePoint(rootInfo) || isReparsePoint(clientsInfo) || isReparsePoint(clientInfo) || isReparsePoint(executableInfo)) {
      fail("UNSAFE_SELECTED_CLIENT", "Installation state selected Client has an unexpected filesystem type.");
    }

    const [realRoot, realClients, realClient, realExecutable] = await Promise.all([
      fsApi.realpath(rootPath),
      fsApi.realpath(clientsPath),
      fsApi.realpath(clientPath),
      fsApi.realpath(executablePath),
    ]);
    const isContained = (parentPath, childPath) => {
      const relative = path.relative(parentPath, childPath);
      return relative && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
    };
    if (!isContained(realRoot, realClients) || !isContained(realClients, realClient) || !isContained(realClient, realExecutable)) {
      fail("UNSAFE_SELECTED_CLIENT", "Installation state selected Client escapes the installation root.");
    }
  } catch (error) {
    if (error instanceof InstallationStateError) {
      throw error;
    }
    if (isUnavailablePathError(error)) {
      fail("SELECTED_CLIENT_UNAVAILABLE", "Installation state selected Client is missing or incomplete.");
    }
    fail("UNSAFE_SELECTED_CLIENT", "Installation state selected Client cannot be safely inspected.");
  }

  return { version: clientVersion, clientPath, executablePath };
}

async function assertClientReference(installationRoot, clientReference, options = {}) {
  return assertSelectedClient(installationRoot, {
    schemaVersion: SCHEMA_VERSION,
    generation: 1,
    activeClient: clientReference,
    knownGoodClient: clientReference,
  }, options);
}

function stateForVersion(version, generation) {
  const client = { version: validateClientKey(version) };
  return {
    schemaVersion: SCHEMA_VERSION,
    generation,
    activeClient: client,
    knownGoodClient: { ...client },
  };
}

function stateV2ForVersion(version, generation) {
  const client = { version: validateClientKey(version) };
  return {
    schemaVersion: SCHEMA_VERSION_V2,
    generation,
    activeClient: client,
    knownGoodClient: { ...client },
    updateTransaction: null,
  };
}

async function writeSnapshot(directory, slotName, state, { fsApi = fs, id = randomUUID() } = {}) {
  const finalPath = path.join(directory, slotName);
  const temporaryPath = path.join(directory, `.${slotName}.tmp-${id}`);
  const normalizedState = state && state.schemaVersion === SCHEMA_VERSION_V2
    ? normalizeStateV2(state)
    : normalizeState(state);
  const serialized = `${JSON.stringify(normalizedState, null, 2)}\n`;
  let handle;
  try {
    handle = await fsApi.open(temporaryPath, "w");
    await handle.writeFile(serialized, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fsApi.rename(temporaryPath, finalPath);
  } catch (error) {
    if (handle) {
      await handle.close().catch(() => {});
    }
    await fsApi.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

function selectedStateForTransition(readResult) {
  if (!readResult || readResult.kind !== "selected") {
    fail("UPDATE_STATE_UNAVAILABLE", "Installation state is unavailable for an update transition.");
  }
  return readResult.selected;
}

function steadyStateV2(state, generation) {
  return normalizeStateV2({
    schemaVersion: SCHEMA_VERSION_V2,
    generation,
    activeClient: { ...state.activeClient },
    knownGoodClient: { ...state.knownGoodClient },
    updateTransaction: null,
  });
}

function selectTransitionSlot(readResult) {
  return readResult.slots.find((slot) => slot.kind !== "valid")
    || readResult.slots.find((slot) => slot.state.generation !== readResult.selected.generation)
    || readResult.slots[0];
}

async function publishUpdateTransition(installationRoot, transition, options = {}) {
  const readResult = await readLaunchInstallationState(installationRoot, options);
  const current = selectedStateForTransition(readResult);
  const nextState = normalizeStateV2(transition(current, current.generation + 1));
  await writeSnapshot(readResult.stateDirectory, path.basename(selectTransitionSlot(readResult).path), nextState, options);
  return nextState;
}

function requiresNoTransaction(state) {
  if (state.schemaVersion === SCHEMA_VERSION_V2 && state.updateTransaction !== null) {
    fail("UPDATE_TRANSACTION_EXISTS", "Installation state already contains an update transaction.");
  }
}

async function prepareClientUpdate(installationRoot, candidateClient, options = {}) {
  const candidate = validateClientReference(candidateClient, "update transaction candidateClient");
  return publishUpdateTransition(installationRoot, (current, generation) => {
    requiresNoTransaction(current);
    if (current.activeClient.version !== current.knownGoodClient.version
      || current.knownGoodClient.version === candidate.version) {
      fail("INVALID_UPDATE_TRANSITION", "Candidate Client cannot be prepared from the current state.");
    }
    return {
      schemaVersion: SCHEMA_VERSION_V2,
      generation,
      activeClient: { ...current.activeClient },
      knownGoodClient: { ...current.knownGoodClient },
      updateTransaction: { phase: "prepared", candidateClient: candidate },
    };
  }, options);
}

async function cancelPreparedClientUpdate(installationRoot, options = {}) {
  return publishUpdateTransition(installationRoot, (current, generation) => {
    if (current.schemaVersion !== SCHEMA_VERSION_V2 || current.updateTransaction?.phase !== "prepared") {
      fail("NO_PREPARED_UPDATE", "Installation state has no prepared update to cancel.");
    }
    return steadyStateV2(current, generation);
  }, options);
}

async function activatePreparedClientUpdate(installationRoot, options = {}) {
  return publishUpdateTransition(installationRoot, (current, generation) => {
    if (current.schemaVersion !== SCHEMA_VERSION_V2 || current.updateTransaction?.phase !== "prepared") {
      fail("NO_PREPARED_UPDATE", "Installation state has no prepared update to activate.");
    }
    const candidateClient = { ...current.updateTransaction.candidateClient };
    return {
      schemaVersion: SCHEMA_VERSION_V2,
      generation,
      activeClient: candidateClient,
      knownGoodClient: { ...current.knownGoodClient },
      updateTransaction: { phase: "activated", candidateClient },
    };
  }, options);
}

async function commitActivatedClientUpdate(installationRoot, options = {}) {
  return publishUpdateTransition(installationRoot, (current, generation) => {
    if (current.schemaVersion !== SCHEMA_VERSION_V2 || current.updateTransaction?.phase !== "activated") {
      fail("NO_ACTIVATED_UPDATE", "Installation state has no activated update to commit.");
    }
    const candidateClient = { ...current.updateTransaction.candidateClient };
    return {
      schemaVersion: SCHEMA_VERSION_V2,
      generation,
      activeClient: candidateClient,
      knownGoodClient: { ...candidateClient },
      updateTransaction: null,
    };
  }, options);
}

async function rollbackActivatedClientUpdate(installationRoot, options = {}) {
  return publishUpdateTransition(installationRoot, (current, generation) => {
    if (current.schemaVersion !== SCHEMA_VERSION_V2 || current.updateTransaction?.phase !== "activated") {
      fail("NO_ACTIVATED_UPDATE", "Installation state has no activated update to roll back.");
    }
    return {
      schemaVersion: SCHEMA_VERSION_V2,
      generation,
      activeClient: { ...current.knownGoodClient },
      knownGoodClient: { ...current.knownGoodClient },
      updateTransaction: null,
    };
  }, options);
}

async function prepareStateDirectory(directory, state, options = {}) {
  const { fsApi = fs } = options;
  await fsApi.mkdir(directory, { recursive: false });
  await writeSnapshot(directory, SLOT_NAMES[0], state, options);
  await writeSnapshot(directory, SLOT_NAMES[1], state, options);
}

async function publishInitialState(installationRoot, version, options = {}) {
  const { fsApi = fs, id = randomUUID() } = options;
  const rootPath = path.resolve(installationRoot);
  const stateDirectory = path.join(rootPath, STATE_DIRECTORY);
  const stagingDirectory = path.join(rootPath, `${BOOTSTRAP_DIRECTORY_PREFIX}${id}`);
  const state = stateForVersion(version, 1);
  await assertSelectedClient(rootPath, state, { fsApi });

  try {
    await prepareStateDirectory(stagingDirectory, state, { ...options, fsApi, id });
    await fsApi.rename(stagingDirectory, stateDirectory);
  } catch (error) {
    await fsApi.rm(stagingDirectory, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
  return state;
}

async function repairRedundancy(stateDirectory, state, slots, options = {}) {
  const invalidSlot = slots.find((slot) => slot.kind !== "valid");
  const repairedState = { ...state, generation: state.generation + 1 };
  await writeSnapshot(stateDirectory, path.basename(invalidSlot.path), repairedState, options);
  return repairedState;
}

async function replaceWithFreshState(installationRoot, version, options = {}) {
  const { fsApi = fs, id = randomUUID() } = options;
  const rootPath = path.resolve(installationRoot);
  const stateDirectory = path.join(rootPath, STATE_DIRECTORY);
  const stagingDirectory = path.join(rootPath, `${BOOTSTRAP_DIRECTORY_PREFIX}${id}`);
  const invalidDirectory = path.join(rootPath, `${INVALID_DIRECTORY_PREFIX}${id}`);
  const state = stateForVersion(version, 1);
  await assertSelectedClient(rootPath, state, { fsApi });

  try {
    await prepareStateDirectory(stagingDirectory, state, { ...options, fsApi, id });
    await fsApi.rename(stateDirectory, invalidDirectory);
    await fsApi.rename(stagingDirectory, stateDirectory);
    await fsApi.rm(invalidDirectory, { recursive: true, force: true }).catch(() => {});
  } catch (error) {
    await fsApi.rm(stagingDirectory, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
  return state;
}

async function reconcileInstallationState(installationRoot, installedVersion, { mode = "repair", ...options } = {}) {
  const readResult = await readLaunchInstallationState(installationRoot, options);
  if (readResult.kind === "unsupported") {
    fail("UNSUPPORTED_SCHEMA", "Installation state was created by a newer incompatible version.");
  }
  if (readResult.kind === "uninspectable") {
    fail("UNINSPECTABLE_STATE", "Installation state cannot be safely inspected.");
  }

  const hasSchemaV2 = readResult.slots.some(
    (slot) => slot.kind === "valid" && slot.state.schemaVersion === SCHEMA_VERSION_V2,
  );
  if (hasSchemaV2 && readResult.kind !== "selected") {
    fail("UNINSPECTABLE_STATE", "Installation state schema v2 handoff is ambiguous.");
  }

  const desiredState = stateForVersion(installedVersion, 1);
  await assertSelectedClient(installationRoot, desiredState, options);

  if (hasSchemaV2) {
    if (mode !== "provision") {
      fail("V2_STATE_REQUIRES_FULL_SETUP_MUTATION_AUTHORITY", "Installation state schema v2 requires explicit Full Setup handoff.");
    }
    const nextState = stateV2ForVersion(installedVersion, readResult.selected.generation + 1);
    const targetSlot = selectTransitionSlot(readResult);
    await writeSnapshot(readResult.stateDirectory, path.basename(targetSlot.path), nextState, options);
    return {
      action: readResult.selected.updateTransaction === null
        ? "provisioned-v2-steady"
        : "provisioned-v2-handoff",
      state: nextState,
    };
  }

  if (readResult.kind === "no-valid-state" || readResult.kind === "ambiguous") {
    if (!readResult.stateDirectoryExists && readResult.slots.every((slot) => slot.kind === "missing")) {
      return { action: "bootstrapped", state: await publishInitialState(installationRoot, installedVersion, options) };
    }
    return { action: "replaced-corrupt", state: await replaceWithFreshState(installationRoot, installedVersion, options) };
  }

  if (readResult.selected.activeClient.version !== installedVersion) {
    if (mode !== "provision") {
      fail("STATE_VERSION_MISMATCH", "Installation state does not match the installed Client.");
    }
    const nextState = stateForVersion(installedVersion, readResult.selected.generation + 1);
    const targetSlot = selectTransitionSlot(readResult);
    await writeSnapshot(readResult.stateDirectory, path.basename(targetSlot.path), nextState, options);
    return { action: "provisioned-newer", state: nextState };
  }

  await assertSelectedClient(installationRoot, readResult.selected, options);
  const validSlots = readResult.slots.filter((slot) => slot.kind === "valid");
  if (validSlots.length === 1) {
    return {
      action: "repaired-redundancy",
      state: await repairRedundancy(readResult.stateDirectory, readResult.selected, readResult.slots, options),
    };
  }
  return { action: "preserved", state: readResult.selected };
}

async function removeProvisioningStateArtifacts(installationRoot, { fsApi = fs } = {}) {
  const rootPath = path.resolve(installationRoot);
  await fsApi.rm(path.join(rootPath, STATE_DIRECTORY), { recursive: true, force: true });
  let entries;
  try {
    entries = await fsApi.readdir(rootPath, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
  await Promise.all(entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(BOOTSTRAP_DIRECTORY_PREFIX))
    .map((entry) => fsApi.rm(path.join(rootPath, entry.name), { recursive: true, force: true })));
}

function derivePackagedInstallation() {
  const resourcesPath = path.resolve(process.resourcesPath || "");
  const clientPath = path.dirname(resourcesPath);
  const clientsPath = path.dirname(clientPath);
  const installationRoot = path.dirname(clientsPath);
  if (path.basename(resourcesPath) !== "resources" || path.basename(clientsPath) !== "Clients") {
    fail("INVALID_PACKAGED_LAYOUT", "Client provisioning requires the versioned packaged installation layout.");
  }
  const version = validateClientKey(path.basename(clientPath));
  return { installationRoot, version };
}

module.exports = {
  BOOTSTRAP_DIRECTORY_PREFIX,
  CLIENT_EXECUTABLE,
  InstallationStateError,
  INVALID_DIRECTORY_PREFIX,
  INSPECT_MAX_SCHEMA_ARGUMENT,
  MAX_STATE_FILE_BYTES,
  MAX_LAUNCH_SCHEMA_VERSION,
  SCHEMA_VERSION,
  SCHEMA_VERSION_V2,
  SLOT_NAMES,
  STATE_DIRECTORY,
  activatePreparedClientUpdate,
  assertClientReference,
  assertSelectedClient,
  cancelPreparedClientUpdate,
  classifySlot,
  commitActivatedClientUpdate,
  derivePackagedInstallation,
  inspectInstallationStateForSetup,
  normalizeState,
  normalizeStateV2,
  parseJsonWithUniqueKeys,
  parseInspectMaxSchema,
  prepareClientUpdate,
  publishInitialState,
  readInstallationState,
  readLaunchInstallationState,
  reconcileInstallationState,
  removeProvisioningStateArtifacts,
  rollbackActivatedClientUpdate,
  sameLogicalState,
  stateForVersion,
  stateV2ForVersion,
  validateClientKey,
};
