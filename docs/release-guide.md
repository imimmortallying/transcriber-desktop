# Client release guide

## What is released

A normal public release contains a Full Setup for new and offline installations
and a signed Client Update for existing installations. For version `X`, the
public asset set is `local-asr-prototype Setup X.exe`,
`local-asr-prototype-client-X-win-x64.asrupdate`, `latest.json` and `latest.sig`.

`npm run dist:client` first creates a Client-only ZIP. It contains the unpacked
Windows Client and Electron files, but never Runtime, user data or local build
configuration. The ZIP is an input to the signed `.asrupdate` package; it is
not uploaded for an ordinary public release.

An `.asrupdate` is a ZIP with exactly three entries: `client.zip`,
`manifest.json` and `manifest.sig`. The manifest declares the Client version,
Runtime API contract and SHA-256/size of `client.zip`; `manifest.sig` is its
Ed25519 signature. Production Clients contain only the pinned public key. The
matching private key, and an optional passphrase file for an encrypted key,
remain outside the repository and all `dist` output.

`latest.json` is separate, signed online metadata. It declares the exact,
versioned GitHub Releases URL, hash and size of the `.asrupdate`; `latest.sig`
is its Ed25519 signature with a metadata-specific signing context. On an
explicit user check, the installed Client reads GitHub's stable
`releases/latest/download/latest.json`, verifies `latest.sig`, then downloads
the immutable update asset only if it is newer. The existing local Coordinator
verification, staging, READY/commit and rollback lifecycle then takes over;
GitHub is discovery and transport, not an updater.

## Practical test map

### Release rule

Before a normal Client release, first test the product functionality that was
actually changed. Then run the standard lightweight distribution gate:

```powershell
npm run verify:distribution
```

Run additional targeted or packaged/E2E checks only when the nature of the
change calls for them. `verify:distribution` is the normal Client release gate;
it does not run `electron-builder`, create `dist` artifacts, build native
Coordinator binaries, or install a Setup. It runs `check`, `test:client-update`,
`test:ui-version`, `test:packaging` and `test:release`.

### 1. Normal pre-release checks

| Command | What it verifies | Cost and release role | When to run it |
| --- | --- | --- | --- |
| `npm run verify:distribution` | The complete lightweight distribution gate: JavaScript syntax; InstallationState, signed update-package, online acquisition and Coordinator unit behavior; the narrow renderer Client-version behavior; static Full Setup/NSIS and E2E-cleanup contracts; and release-script composition/signing-path behavior. | **Lightweight; standard Client release gate.** It uses fixtures and test keys, never production signing material. | Before every normal Client release, after testing the changed product functionality. |
| `npm run check` | `node --check` syntax parsing of the listed application, updater, Coordinator, build-script and test JavaScript files. It does not execute their runtime behavior. | **Lightweight; included in `verify:distribution`.** It is a quick local syntax triage, not an additional release gate when the combined gate has passed. | After editing listed JavaScript files, or directly when a fast parse-only check is useful. |

### 2. Targeted development tests

These are lightweight Node tests unless stated otherwise. They are mainly a way
to shorten feedback while developing one subsystem. Several are already included
by `verify:distribution`; running them directly is useful before the combined
gate or while diagnosing a failure.

| Command | What it actually verifies | Choose it when changing | Release role |
| --- | --- | --- | --- |
| `npm run test:coordinator` | Coordinator executable geometry, selected Client launch, readonly/recoverable state handling, update-command parsing, READY correlation, commit and rollback behavior. | `src/coordinator/main.js`, Coordinator launch/error mapping, or the Coordinator side of Client Update lifecycle. | Targeted; included indirectly through `test:client-update`. |
| `npm run test:runtime` | Runtime-root resolution and manifest/resource/API validation, plus packaged-vs-development Python selection. | Runtime layout, `runtime-manifest.json` contract, or `resolveRuntime` / installation-root resolution. | Targeted only; not in the normal Client gate. |
| `npm run test:update-state` | InstallationState v1/v2 validation, slot selection and corruption precedence, durable update transitions, selected Client safety, and Full Setup capability/handoff boundaries. | `installationState.js`, schema/recovery logic, or Full Setup's state contract. | Targeted; included indirectly through `test:client-update`. |
| `npm run test:update-package` | Signed `.asrupdate` verification and staging with test trust, payload/hash rejection, and cross-volume finalization behavior of the package creator. | Package format, manifest/signature validation, ZIP extraction safety, or package-creation finalization. | Targeted; included indirectly through `test:client-update`. |
| `npm run test:online-update` | Signed `latest.json`/`latest.sig` validation, GitHub URL restrictions, version decision, bounded download/cleanup and the narrow parameterless online-update IPC surface. It uses a controlled local HTTP server, not GitHub. | `onlineRelease`, online release configuration, metadata signing/verification, or online-update IPC. | Targeted; included indirectly through `test:client-update`. |
| `npm run test:ui-version` | Only the renderer path that obtains and renders the running Client version/update state from Electron main. It is **not** a full UI, editor or recognition test. | Client-version or update-state display/API wiring in `renderer`, `preload` or `main`. | Targeted; included in `verify:distribution`. |
| `npm run test:client-update` | The aggregate of `test:update-state`, `test:update-package`, `test:online-update` and `test:coordinator`; it does not package Electron. | A Client Update change spanning state, signed packages, online acquisition or Coordinator behavior. | Targeted aggregate; included in `verify:distribution`. |
| `npm run test:packaging` | Static Full Setup/NSIS composition boundaries and the owned temporary-workspace cleanup guard used by Full Setup E2E. It does not build or install a Setup. | `build/installer.nsh`, packaging resources/contracts, or E2E cleanup safety. | Targeted; included in `verify:distribution`. |
| `npm run test:release` | Release-script argument/version propagation, signing-path preflight ordering, allowlisted release output and Windows npm invocation. It uses isolated files and mocks; it does not use production keys or build a Client. | `releaseClient`, `releaseFullSetup`, signing-path handling or release output composition. | Targeted; included in `verify:distribution`. |

### 3. Heavy / packaged / E2E tests

These commands construct a real launcher, Coordinator binary, packaged Electron
Client, isolated NSIS Setup, or a combination of them. They are not routine
Client release checks. Run the relevant one when packaged behavior or the
specific build/installation infrastructure it covers changed.

| Command | What it actually verifies | Runs a real packaged build? | Choose it when changing |
| --- | --- | --- | --- |
| `npm run test:launcher` | A compiled stable launcher rejects missing/unsafe Coordinator geometry, propagates supported Coordinator exits, and remains fixed to `Coordinator/asr-coordinator.exe` rather than scanning Clients. | **Yes, native launcher build** in test mode, plus a fake Coordinator; no Electron distribution. | `build/stable-launcher.nsi`, `buildStableLauncher`, launcher exit-code protocol or Coordinator bootstrap geometry. |
| `npm run test:coordinator-sea` | The built SEA Coordinator, with Node absent from `PATH`, reads installed state, launches only the selected Windows Client and recovers activated state to known-good. | **Yes, builds the production Coordinator binary** and test launcher; no Electron distribution. | Coordinator bundling/SEA build, Node host/provenance, PE finalization, or installed binary behavior. |
| `npm run test:coordinator-ipc-spike` | An experimental SEA Coordinator and real packaged Electron Client exchange inherited IPC while normal Client lifetime continues. | **Yes: `dist:client` plus a dedicated Coordinator binary.** | Only inherited-IPC spike/prototype changes; it is not general Client Update coverage. |
| `npm run test:client-update-e2e` | A real SEA Coordinator stages a test-signed package, activates a packaged Electron candidate, observes READY/commit, then injects failed READY and observes rollback. | **Yes: `dist:client` plus a dedicated Client Update E2E Coordinator binary.** | End-to-end Client Update lifecycle, inherited READY IPC, packaged candidate startup or Coordinator build changes. |
| `npm run test:client-artifact` | The actual Client-only ZIP is provider-neutral and excludes Runtime, user data, Setup/uninstaller and update-provider artifacts. | **Yes: `dist:client`.** | Electron Client packaging, `build.files`, `buildClientArtifact`, or Client ZIP composition. |
| `npm run test:full-setup-e2e` | An isolated Full Setup build and silent per-user installation lifecycle, including deployed Client/Runtime/Coordinator/launcher geometry and installer repair/uninstall paths exercised by the harness. | **Yes: builds launcher, Coordinator and an isolated electron-builder NSIS Setup, then runs it.** | Full Setup/NSIS lifecycle, Runtime archive/install behavior, launcher/Coordinator deployment, uninstall/repair or installation-state provisioning. |

`npm run dist:client` and `npm run dist:win` are build commands, not test gates:
the former is the input for `test:client-artifact` and Client release creation;
the latter builds the production Full Setup. Do not run either during ordinary
development iteration; `release:public` runs both once for an actual public
release. `build:launcher`, `build:coordinator`,
`build:coordinator-ipc-spike` and `build:coordinator-client-update-e2e` are
similarly build helpers; the heavy tests above invoke the helpers they require.

## One-time local signing-path setup

Set persistent user environment variables to absolute paths. They hold paths
only: never put a private key or its passphrase text in the repository, `.env`,
or `dist`.

```powershell
setx ASR_RELEASE_PRIVATE_KEY_FILE "D:\ASR-release-signing\asr-production-private-key.pem"
setx ASR_RELEASE_PRIVATE_KEY_PASSPHRASE_FILE "D:\ASR-release-signing\asr-production-passphrase.txt"
```

Omit `ASR_RELEASE_PRIVATE_KEY_PASSPHRASE_FILE` only for an unencrypted private
key. Open a new PowerShell after `setx`. The release command checks the files
and verifies that the private key matches the repository-pinned public key
before it changes project metadata or starts the Client build.

The private key is PKCS#8 PEM and the public key is the pinned Ed25519 trust
anchor in `src/update/productionTrust.js`. `release:public` and `release:client` consume the two
environment paths and invoke both signing scripts. For a manual release,
`create:update-package` consumes the private-key path (and optional passphrase
path) to sign `manifest.json`; `createOnlineReleaseMetadata.js` consumes the
same material to sign `latest.json`. Keep both files outside the repository;
the optional repository-local `release-signing/` directory is ignored, but an
external directory such as `D:\ASR-release-signing` is preferred. Neither file
may be copied to `dist`, a `.asrupdate`, a Setup, or GitHub.

### Current passphrase-file convenience and future hardening

Using an encrypted PKCS#8 key together with a separate plaintext passphrase
file is an accepted local convenience for the current tooling. It lets the
release scripts run non-interactively, but it is not the desired final security
model: anyone able to read both files can use the production signing key.

**Future hardening — not implemented in this task:** keep the private key
encrypted, avoid permanently storing its passphrase as plaintext, and prefer
either interactive passphrase input at release time or OS-backed secret storage.
This is deliberately a future tooling decision; the current environment-variable
and passphrase-file workflow remains unchanged.

## Routine public release

This is the preferred routine release path. Use the manual procedure below only
for recovery, debugging or deliberately composing a release step by step.

1. Test the product functionality that was actually changed. Choose the next
   numeric version, such as `0.1.2`.
2. Run the standard lightweight distribution gate:

   ```powershell
   npm run verify:distribution
   ```

3. Run the routine public release command:

   ```powershell
   npm run release:public -- 0.1.2
   ```

   This validates production signing configuration before any build, persists
   `0.1.2` once into `package.json` and `package-lock.json`, creates the signed
   Client Update assets and builds the matching Full Setup. It stages the four
   public files in `dist/release-0.1.2/`; it does not create a GitHub Release or
   commit anything.
4. Create a published, non-prerelease GitHub Release in
   `imimmortallying/asr-desktop-releases`, targeting the reviewed release commit,
   with tag `v0.1.2` and release name `ASR v0.1.2`. Make it the repository's
   current **Latest** release: Client discovery reads GitHub's
   `releases/latest/download/latest.json` path.
5. Upload exactly these generated assets:

   ```text
   dist/release-0.1.2/local-asr-prototype Setup 0.1.2.exe
   dist/release-0.1.2/local-asr-prototype-client-0.1.2-win-x64.asrupdate
   dist/release-0.1.2/latest.json
   dist/release-0.1.2/latest.sig
   ```

   New and offline users download the Full Setup `.exe`; it already contains
   Client `0.1.2`, Runtime, Coordinator, launcher and installer-owned state.
   Existing users update from inside ASR: `.asrupdate` is the signed Client-only
   payload, while `latest.json` and `latest.sig` are its online-discovery
   infrastructure. Do not upload the Client ZIP, `dist/win-unpacked`, blockmap,
   Runtime separately, `client.zip`, `manifest.json`, `manifest.sig`, or any
   private-key/passphrase material.

The script refuses to overwrite an existing `dist/release-<version>` directory.
Its final output repeats the tag, release name and exact upload paths.

## Manual Client release (recovery/debugging only)

Use this sequence only when the preferred `release:public` path cannot be used
or when a release must be diagnosed step by step. It creates exactly the same
three Client Update assets, not a routine public Full Setup. Run it from the
repository root in PowerShell. Substitute a
new numeric version for `0.1.2`; do not reuse an existing `dist/release-<version>`
directory.

1. Select the version once, persist it before the build, and fail closed if the
   persisted version is not the value that will be signed. `npm version` updates
   both `package.json` and `package-lock.json` without creating a Git tag.

   ```powershell
   $version = "0.1.2"
   npm version $version --no-git-tag-version --allow-same-version
   $persistedVersion = node -p "require('./package.json').version"
   if ($persistedVersion -ne $version) { throw "package.json version does not match the release version." }
   ```

   Every later occurrence of `$version`, including `--version` and the GitHub
   tag, must refer to this same value. The package-signing CLI does not infer or
   cross-check it against `package.json`.

2. Run the lightweight source/test gate, then build the Client artifact.

   ```powershell
   npm run verify:distribution
   npm run dist:client
   ```

   The first command does not make an Electron distribution. The second command
   creates the only Client input artifact at
   `dist/local-asr-prototype-client-$version-win-x64.zip`.

3. Name the input and the three intended release outputs, and create a new
   output directory. The signing scripts refuse to overwrite output files.

   ```powershell
   $keyId = "asr-prod-ed25519-e4cb8825e9276bf0"
   $clientZip = Join-Path $PWD "dist/local-asr-prototype-client-$version-win-x64.zip"
   if (-not (Test-Path -LiteralPath $clientZip -PathType Leaf)) { throw "Client ZIP was not produced for $version." }
   $releaseDirectory = Join-Path $PWD "dist/release-$version"
   if (Test-Path -LiteralPath $releaseDirectory) { throw "Release directory already exists: $releaseDirectory" }
   New-Item -ItemType Directory -Path $releaseDirectory | Out-Null
   $updatePackage = Join-Path $releaseDirectory "local-asr-prototype-client-$version-win-x64.asrupdate"
   $latestJson = Join-Path $releaseDirectory "latest.json"
   $artifactUrl = "https://github.com/imimmortallying/asr-desktop-releases/releases/download/v$version/local-asr-prototype-client-$version-win-x64.asrupdate"
   ```

4. Create and sign the Client update package. The environment variables set in
   the previous section name external files. Omit both displayed
   `--private-key-passphrase-file` lines when the key is intentionally
   unencrypted; otherwise retain them exactly.

   ```powershell
   npm run create:update-package -- `
     --input $clientZip `
     --output $updatePackage `
     --version $version `
     --key-id $keyId `
     --private-key-file $env:ASR_RELEASE_PRIVATE_KEY_FILE `
     --private-key-passphrase-file $env:ASR_RELEASE_PRIVATE_KEY_PASSPHRASE_FILE
   ```

   This produces `local-asr-prototype-client-$version-win-x64.asrupdate`. The
   script uses the current Runtime API version, puts `client.zip`,
   `manifest.json` and `manifest.sig` inside the package, and re-verifies its
   generated package before publishing it to the requested path.

5. Create and sign the online discovery metadata. Its signature filename is
   derived automatically: `$latestJson` produces `latest.sig` in the same
   directory; there is no separate signature-output argument.

   ```powershell
   node scripts/createOnlineReleaseMetadata.js `
     --input $updatePackage `
     --output $latestJson `
     --artifact-url $artifactUrl `
     --key-id $keyId `
     --private-key-file $env:ASR_RELEASE_PRIVATE_KEY_FILE `
     --private-key-passphrase-file $env:ASR_RELEASE_PRIVATE_KEY_PASSPHRASE_FILE
   ```

   This verifies the input `.asrupdate` with the pinned production public key
   before it writes `latest.json` and `latest.sig`. At this point the release
   directory must contain exactly:

   ```text
   local-asr-prototype-client-0.1.2-win-x64.asrupdate
   latest.json
   latest.sig
   ```

6. Only for an explicitly authorized Client-only recovery/debug release, create
   a published, non-prerelease GitHub Release in
   `imimmortallying/asr-desktop-releases`, targeting the reviewed release commit,
   with tag `v0.1.2` and release name `ASR Client v0.1.2`, replacing the example
   version with `$version`. Make it the repository's current **Latest** release:
   Client discovery reads GitHub's `releases/latest/download/latest.json` path.
   Upload exactly the three files in the release directory:

   ```text
   local-asr-prototype-client-<version>-win-x64.asrupdate
   latest.json
   latest.sig
   ```

   This three-file path does **not** satisfy the normal public-release policy:
   for a regular release use `release:public` so the matching Full Setup is
   published too. Do **not** upload the Client ZIP, its unpacked `dist/win-unpacked` directory,
   `client.zip`, `manifest.json` or `manifest.sig` separately, Runtime, a Full
   Setup, or any private-key/passphrase file. The Client ZIP and the latter two
   manifest files are implementation inputs or contents of the `.asrupdate`,
   not ordinary online-release assets.

## Signing implementation and verification

The release scripts use Node's built-in `node:crypto` Ed25519 support; there is
no external signing library. The production public-key allowlist is
`PRODUCTION_TRUSTED_SIGNERS` in `src/update/productionTrust.js`.

- `loadProductionPrivateKey()` in that file reads the PEM from
  `--private-key-file` and, when supplied, reads the passphrase text file. It
  removes one trailing CRLF/LF from the passphrase and calls
  `crypto.createPrivateKey({ key, format: "pem", type: "pkcs8", passphrase })`.
  It then derives the public key with `crypto.createPublicKey()` and refuses a
  key that is not byte-for-byte the pinned SPKI PEM for the requested `keyId`.
  With no passphrase-file argument, the same loader supports an unencrypted
  PKCS#8 PEM.
- `createClientUpdatePackage()` in `scripts/createClientUpdatePackage.js`
  builds the manifest, canonicalizes it with `canonicalJson()` from
  `src/update/clientUpdatePackage.js`, UTF-8 encodes that canonical JSON, and
  calls `crypto.sign(null, bytes, privateKey)`. The exact signed bytes are the
  recursively key-sorted, compact JSON representation of the manifest — not the
  pretty-printed `manifest.json` bytes in the ZIP. The signature is base64 text
  plus a trailing newline in `manifest.sig`.
- `createOnlineReleaseMetadata()` in
  `scripts/createOnlineReleaseMetadata.js` calls `crypto.sign(null,
  onlineReleaseSignaturePayload(metadata), privateKey)`. The payload function
  in `src/update/onlineRelease.js` UTF-8 encodes the exact concatenation of the
  domain-separation string `ASR online release metadata v1\0` and canonical JSON
  metadata. Thus a valid package signature cannot be repurposed as a metadata
  signature. `latest.sig` is likewise base64 text plus a trailing newline.
  Both readers trim the file and require the decoded Ed25519 signature to be
  exactly 64 bytes.
- In the application, `readAndVerifyManifest()` in
  `src/update/clientUpdatePackage.js` parses the manifest with duplicate-key
  rejection, normalizes its strict schema, and calls `crypto.verify(null,
  canonical-manifest-bytes, pinned-public-key, signature)`. Coordinator calls
  it through `stageVerifiedClientUpdate()` before Client staging. For online
  releases, the Electron main process calls `checkForOnlineUpdate()` from
  `src/main.js`; `verifyOnlineReleaseMetadata()` in `src/update/onlineRelease.js`
  applies the same pinned key set and `crypto.verify()` to the domain-separated
  metadata payload before version selection, and verifies it again before
  download.

## Specialized Full Setup rebuild

Every normal public release already builds the matching Full Setup through
`release:public`. `release:full` remains a specialized internal command for a
deliberate Full Setup-only rebuild, such as installer/Runtime repair work that
is not being published as a Client release:

```powershell
npm run release:full -- 0.1.2
```

This persists the version and invokes the existing `dist:win` build. It does
not create signed Client update metadata, stage public assets or publish
anything.
