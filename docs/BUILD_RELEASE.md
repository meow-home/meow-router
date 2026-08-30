# Build & Release

## Tooling

Recommended:

- Electron
- Electron Builder
- TypeScript
- React
- Vite
- SQLite
- Drizzle ORM
- keytar or an equivalent OS secure credential mechanism

## Development

```bash
npm install
npm run dev
```

## Validation

```bash
npm run typecheck
npm run lint
npm test
```

## Production build

```bash
npm run build
npm run package
```

## Continuous Integration (GitHub Actions)

The `.github/workflows/ci.yml` workflow runs on every push/PR to `main`:

- installs dependencies with pnpm (frozen lockfile);
- typechecks, lints, tests and builds the desktop app on `ubuntu-latest`.

It is required to be green before a release tag is published.

## Releasing (GitHub Actions)

The `.github/workflows/release.yml` workflow builds installers for Windows,
macOS and Linux, then attaches them to a GitHub Release.

To cut a release, push a `v*` tag to `main`:

```bash
git checkout main
git pull
git tag v1.2.3
git push origin v1.2.3
```

The version is taken from the tag (the leading `v` is stripped) and fed to
`electron-builder` via `--config.extraMetadata.version`, so the produced
installers are named by the tagged version.

Artifacts are produced per-OS (matrix build): NSIS `.exe` on Windows, `.dmg` on
macOS, and AppImage/`.deb` on Linux. `--publish never` keeps `electron-builder`
from pushing to a release provider; the GitHub Release is created by
the `gh` CLI (preinstalled on GitHub-hosted runners) with auto-generated release
notes. If a release for the tag already exists (e.g. after a failed or partial
run) it is deleted first, so a clean release is created with the full set of
installers.

### Re-running a release

The release workflow can be re-run for an existing tag from the Actions tab:

1. Go to **Actions** → **Release** → **Run workflow**.
2. Enter the tag (e.g. `v0.1.1`) and run it.
3. The workflow checks out that exact tag and re-creates the release with all
   installers, replacing any partial/stale assets from a previous run.

Artifact names use a snake_case convention via the electron-builder
`artifactName`/`executableName` macros, e.g. `Meow_gateway_1.2.3_x64.exe`
(Windows) and `Meow_gateway_1.2.3_x86_64.AppImage` /
`Meow_gateway_1.2.3_amd64.deb` (Linux).

### In-app update check

The packaged app can check for updates in-app. From the sidebar footer, a user
clicks **Check update** to read the latest GitHub release. The check queries
`https://api.github.com/repos/meow-home/meow-router/releases/latest`, reads the
newest stable (non-prerelease, non-draft) `v*` tag, and compares it against the
current app version. If a newer version is found, the app selects the platform
installer by the snake_case naming convention above
(`Meow_gateway_<version>_x64.exe` on Windows, `.dmg` on macOS,
`.AppImage`/`.deb` on Linux), verifies its SHA-256 digest when the release
exposes one, downloads it, opens it, and emits an OS notification when a
background download completes.

> Consumers must ensure the per-OS installers are attached as GitHub Release
> assets for the in-app checker to locate them. Package maintainers publishing
> new releases MUST attach the installers (the release workflow already does
> this) — otherwise the in-app checker cannot find a matching asset.

> NOTE: builds are currently unsigned. Code signing / notarization secrets are
> not configured yet, so the app bundles are produced but not signed. Add
> `CSC_LINK` / `CSC_KEY_PASSWORD` (and Apple notarization credentials) to the
> release job to sign, and mark the release accordingly.

## Platform targets

### Windows

Produce `.exe` installer.

### macOS

Produce `.dmg`.

### Linux

Produce AppImage and/or `.deb`.

## Release checklist

- version updated;
- migrations tested from previous version;
- clean install tested;
- upgrade tested;
- provider credentials preserved;
- gateway starts/stops correctly;
- no debug logs;
- no secrets in packaged files;
- API compatibility smoke test passed.
