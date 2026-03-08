# cvm — Codex Version Manager

[![CI](https://github.com/lpshanley/codex-version-manager/actions/workflows/ci.yml/badge.svg)](https://github.com/lpshanley/codex-version-manager/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/lpshanley/codex-version-manager/graph/badge.svg)](https://codecov.io/gh/lpshanley/codex-version-manager)

Install, downgrade, and manage [OpenAI Codex](https://openai.com/index/codex/) desktop app versions on macOS.

On Intel Macs, cvm automatically repacks the ARM-only Codex release into a native x86_64 app — no Rosetta required. On Apple Silicon, it works as a straightforward version manager.

## Install

```sh
npx @lpshanley/cvm@latest <command>
```

Or install globally:

```sh
npm i -g @lpshanley/cvm
cvm <command>
```

## Commands

### `cvm list`

List all available Codex versions from the Sparkle update feed.

```
VERSION      BUILD  DATE        SIZE
26.305.950   1050   2025-02-28  117.8 MB
25.200.800   1040   2025-02-10  95.4 MB
```

### `cvm install [version]`

Download and install a specific version (or `latest`) to `/Applications/Codex.app`.

```sh
cvm install                  # install latest
cvm install 25.200.800       # install specific version
cvm install latest --dest ~/Apps/Codex.app
```

On Intel, the app is automatically repacked with native x86_64 Electron, native modules, and CLI binaries before installing.

### `cvm download [version]`

Download a version to `~/Downloads` without installing.

```sh
cvm download                 # download latest
cvm download 25.200.800      # download specific version
cvm download latest -o ~/Desktop
```

On Intel, produces a `CodexIntel.dmg` with an Applications shortcut for drag-to-install. On Apple Silicon, copies the `.app` directly.

### `cvm repack <input> [output]`

Manually repack a `.app` or `.dmg` for Intel. Useful for converting an already-downloaded Codex release.

```sh
cvm repack ~/Downloads/Codex.app           # → CodexIntel.dmg
cvm repack ~/Downloads/Codex.app My.app --no-dmg
cvm repack ~/Downloads/Codex.dmg
```

Options:
- `--no-sign` — skip ad-hoc code signing
- `--no-cache` — rebuild everything from scratch
- `--no-dmg` — output a bare `.app` instead of a DMG
- `--keep-sparkle` — keep Sparkle auto-update (advanced)

### `cvm inspect <path>`

Show metadata from a `.app` bundle or `.dmg`: version, architecture, Electron version, native modules, etc.

```sh
cvm inspect /Applications/Codex.app
cvm inspect ~/Downloads/CodexIntel.dmg
```

### `cvm cache status` / `cvm cache clear`

View or clear the build cache (`~/.cache/cvm/`). The cache stores downloaded Electron runtimes and rebuilt native modules.

```sh
cvm cache status
cvm cache clear              # clear everything
cvm cache clear --electron   # only Electron zips
cvm cache clear --natives    # only native module builds
```

## How the Intel repack works

Codex ships as an ARM-only (arm64) Electron app. On Intel Macs, cvm:

1. Downloads the matching x86_64 Electron runtime from GitHub
2. Uses it as the app shell, transplanting Codex's `Resources/` and `Info.plist`
3. Patches `Info.plist` to set the correct executable name and renderer URL
4. Rebuilds native modules (`better-sqlite3`, `node-pty`) for x64 using `@electron/rebuild`
5. Installs real x86_64 `codex` and `rg` CLI binaries from npm
6. Removes Sparkle auto-update artifacts (to prevent overwriting with ARM builds)
7. Ad-hoc signs the app bundle
8. Packages into a compressed DMG with an Applications shortcut

Native module builds and Electron downloads are cached at `~/.cache/cvm/` for fast subsequent runs.

## Development

```sh
pnpm install
pnpm dev list             # run from source
pnpm check                # lint (biome)
pnpm test                 # unit tests (vitest)
pnpm build                # compile TypeScript
```

## License

ISC
