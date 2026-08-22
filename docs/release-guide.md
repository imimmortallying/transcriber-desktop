# Client release guide

## What is released

`npm run dist:client` first creates a Client-only ZIP. It contains the unpacked
Windows Client and Electron files, but never Runtime, user data or local build
configuration. The ZIP is an input to the signed `.asrupdate` package; it is
not uploaded for an ordinary online release.

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

## Verification without a packaged build

Most distribution changes do not require `electron-builder`. Run the focused
command that matches the change:

- `npm run test:client-update` — state, signed-package, online and Coordinator
  lifecycle tests.
- `npm run test:packaging` — static Full Setup/NSIS and cleanup-contract tests.
- `npm run test:release` — release composition and signing-path tests using
  isolated test files, never production secrets.
- `npm run verify:distribution` — the lightweight combined check above,
  including syntax and renderer update-state coverage.

`npm run dist:client` and `npm run dist:win` are intentionally separate real
builds. Use them only when validating Client-only packaging or Full Setup
behavior respectively.

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
anchor in `src/update/productionTrust.js`. `release:client` consumes the two
environment paths and invokes both signing scripts. For a manual release,
`create:update-package` consumes the private-key path (and optional passphrase
path) to sign `manifest.json`; `createOnlineReleaseMetadata.js` consumes the
same material to sign `latest.json`. Keep both files outside the repository;
the optional repository-local `release-signing/` directory is ignored, but an
external directory such as `D:\ASR-release-signing` is preferred. Neither file
may be copied to `dist`, a `.asrupdate`, a Setup, or GitHub.

## Routine Client release

1. Finish and test the intended changes. Choose the next numeric version such
   as `0.1.2`.
2. Run `npm run release:client -- 0.1.2`.
   This persists `0.1.2` into `package.json` and `package-lock.json`, builds
   the Client ZIP, creates the signed update package and creates the signed
   online metadata. It does not create a GitHub Release or commit anything.
3. Create a GitHub Release in `imimmortallying/asr-desktop-releases` with tag
   `v0.1.2` and release name `ASR Client v0.1.2`.
4. Upload exactly these generated assets:

   ```text
   dist/release-0.1.2/local-asr-prototype-client-0.1.2-win-x64.asrupdate
   dist/release-0.1.2/latest.json
   dist/release-0.1.2/latest.sig
   ```

The script refuses to overwrite an existing `dist/release-<version>` directory.
Its final output repeats the tag, release name and exact upload paths.

For a deliberate manual composition, first run `npm run dist:client`, then run
`npm run create:update-package -- --input <Client ZIP> --output <package.asrupdate> --version <version> --key-id asr-prod-ed25519-e4cb8825e9276bf0 --private-key-file <external PEM> [--private-key-passphrase-file <external text file>]`, followed by `node scripts/createOnlineReleaseMetadata.js` with the signed package, immutable GitHub asset URL and the same key arguments. Both scripts fail before writing output when their required signing material is absent or does not match the pinned public key.

## Rebuilding Full Setup

Client-only releases do not rebuild Runtime, launcher, Coordinator, Full Setup
or Windows Installed Apps registration. Rebuild the complete installer when
those installation components or Runtime changed, or when the Installed Apps
metadata (including `EstimatedSize`) must be refreshed:

```powershell
npm run release:full -- 0.1.2
```

This persists the version and invokes the existing `dist:win` build. It does
not sign Client update metadata and does not publish anything.
