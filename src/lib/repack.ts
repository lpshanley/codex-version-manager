import {
	chmodSync,
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import plist from "plist";
import { readFileFromAsar } from "./asar.js";
import {
	cacheNativeDir,
	getCachedElectronZip,
	getCachedNative,
	getElectronCachePath,
} from "./cache.js";
import { CliError } from "./errors.js";
import { run, runOutput, runProcess } from "./shell.js";

export interface RepackOptions {
	input: string;
	output: string;
	sign: boolean;
	cache: boolean;
	keepSparkle: boolean;
	createDmg: boolean;
}

type LogFn = (msg: string) => void;

export async function repackApp(
	opts: RepackOptions,
	log: LogFn = (msg) => console.log(`[repack] ${msg}`),
): Promise<void> {
	const inputPath = resolve(opts.input);
	const outputPath = resolve(opts.output);
	const wantDmg = opts.createDmg;

	// If input is a DMG, mount it and get the .app inside
	let srcApp: string;
	let mountPoint: string | null = null;

	if (inputPath.endsWith(".dmg")) {
		mountPoint = join(tmpdir(), `cvm-mount-${Date.now()}`);
		mkdirSync(mountPoint, { recursive: true });
		log(`Mounting ${basename(inputPath)}`);
		run(
			`hdiutil attach ${JSON.stringify(inputPath)} -nobrowse -readonly -mountpoint ${JSON.stringify(mountPoint)}`,
			{ stdio: "pipe" },
		);
		const entries = readdirSync(mountPoint);
		const appName = entries.find((e) => e.endsWith(".app"));
		if (!appName) throw new Error("No .app found in DMG");
		srcApp = join(mountPoint, appName);
	} else {
		srcApp = inputPath;
	}

	try {
		if (!existsSync(srcApp)) {
			throw new Error(`Source app not found: ${srcApp}`);
		}

		// 1. Resolve Electron version
		const electronVersion = getElectronVersion(srcApp);
		log(`Electron version: ${electronVersion}`);

		// 2. Download or use cached Electron x64
		const electronZip = await ensureElectronX64(electronVersion, opts.cache, log);

		// 3. Extract Electron.app from zip
		const workDir = join(tmpdir(), `cvm-work-${Date.now()}`);
		mkdirSync(workDir, { recursive: true });
		const runtimeDir = join(workDir, "electron-runtime");
		mkdirSync(runtimeDir);
		log("Extracting Electron x64 runtime");
		run(`unzip -q ${JSON.stringify(electronZip)} -d ${JSON.stringify(runtimeDir)}`, {
			stdio: "pipe",
		});

		const electronApp = join(runtimeDir, "Electron.app");
		if (!existsSync(electronApp)) {
			throw new Error("Electron.app not found in runtime zip");
		}

		// 4. Build target app: x64 Electron shell + source Resources
		const targetApp = wantDmg ? join(workDir, "Codex.app") : outputPath;
		buildTargetApp(electronApp, srcApp, targetApp, log);

		// 5. Patch Info.plist for transplanted runtime
		fixInfoPlist(join(targetApp, "Contents", "Info.plist"), log);

		// 6. Detect native module versions from asar
		const asarPath = join(targetApp, "Contents", "Resources", "app.asar");
		const bsVersion = getModuleVersionFromAsar(asarPath, "better-sqlite3");
		const npVersion = getModuleVersionFromAsar(asarPath, "node-pty");
		const codexVersion = getBundledCliVersion(targetApp);

		if (bsVersion) log(`Detected better-sqlite3@${bsVersion}`);
		if (npVersion) log(`Detected node-pty@${npVersion}`);
		log(`Detected bundled codex-cli@${codexVersion}`);

		// 7. Create temp build project for @electron/rebuild + CLI binaries
		const buildProjectDir = await createBuildProject(
			electronVersion,
			codexVersion,
			bsVersion,
			npVersion,
			log,
		);

		try {
			// 8. Rebuild native modules with @electron/rebuild
			const appUnpacked = join(targetApp, "Contents", "Resources", "app.asar.unpacked");
			const targetAbi = getElectronAbi(electronVersion);
			const modulesToRebuild: string[] = [];
			const cachedModules: Array<{ name: string; version: string; dir: string }> = [];

			for (const [modName, modVersion] of [
				["better-sqlite3", bsVersion],
				["node-pty", npVersion],
			] as const) {
				if (!modVersion) continue;

				if (opts.cache) {
					const cached = getCachedNative(modName, modVersion, electronVersion);
					if (cached) {
						log(`  ${modName}: using cached build`);
						cachedModules.push({ name: modName, version: modVersion, dir: cached });
						continue;
					}
				}
				modulesToRebuild.push(modName);
			}

			if (modulesToRebuild.length > 0) {
				const moduleList = modulesToRebuild.join(",");
				log(`Rebuilding ${moduleList} with @electron/rebuild for x64`);

				await runProcess(
					"pnpm",
					[
						"exec",
						"electron-rebuild",
						"-f",
						"-w",
						moduleList,
						"--arch=x64",
						`--version=${electronVersion}`,
						"-m",
						buildProjectDir,
					],
					{
						cwd: buildProjectDir,
						stdio: "pipe",
					},
				);

				// Cache and install rebuilt modules
				for (const modName of modulesToRebuild) {
					const modVersion =
						modName === "better-sqlite3" ? (bsVersion as string) : (npVersion as string);
					const releaseDir = join(buildProjectDir, "node_modules", modName, "build", "Release");

					if (!existsSync(releaseDir)) {
						throw new Error(`Build failed: no Release directory for ${modName}`);
					}

					if (opts.cache) {
						cacheNativeDir(modName, modVersion, electronVersion, releaseDir);
						log(`  ${modName}: cached build`);
					}

					installNativeModule(modName, releaseDir, appUnpacked, targetAbi);
					log(`  ${modName}: installed`);
				}
			}

			// Install cached modules
			for (const { name, dir } of cachedModules) {
				installNativeModule(name, dir, appUnpacked, targetAbi);
				log(`  ${name}: installed from cache`);
			}

			// 9. Install x64 codex CLI binaries
			installCodexCli(buildProjectDir, targetApp, log);

			// 10. Handle Sparkle
			if (!opts.keepSparkle) {
				disableSparkle(targetApp, log);
			}

			// 11. Code sign
			if (opts.sign) {
				adHocSign(targetApp, log);
			}

			// 12. Verify architecture
			verifyArch(targetApp, log);

			// 13. Create DMG if requested
			if (wantDmg) {
				createDmg(targetApp, outputPath, "Codex Intel", log);
			}
		} finally {
			// Cleanup build project
			rmSync(buildProjectDir, { recursive: true, force: true });
		}

		// Cleanup work dir
		rmSync(workDir, { recursive: true, force: true });

		log(`Done: ${outputPath}`);
	} finally {
		// Unmount DMG if we mounted one
		if (mountPoint) {
			try {
				run(`hdiutil detach ${JSON.stringify(mountPoint)} -quiet`, { stdio: "pipe" });
			} catch {
				// best effort
			}
			rmSync(mountPoint, { recursive: true, force: true });
		}
	}
}

// ---------------------------------------------------------------------------
// Electron version detection
// ---------------------------------------------------------------------------

function getElectronVersion(appPath: string): string {
	const plistPath = join(
		appPath,
		"Contents",
		"Frameworks",
		"Electron Framework.framework",
		"Resources",
		"Info.plist",
	);

	if (!existsSync(plistPath)) {
		const altPath = join(
			appPath,
			"Contents",
			"Frameworks",
			"Electron Framework.framework",
			"Versions",
			"A",
			"Resources",
			"Info.plist",
		);
		if (!existsSync(altPath)) {
			throw new Error("Could not find Electron Framework Info.plist");
		}
		const data = readFileSync(altPath, "utf-8");
		const info = plist.parse(data) as Record<string, unknown>;
		return info.CFBundleVersion as string;
	}

	const data = readFileSync(plistPath, "utf-8");
	const info = plist.parse(data) as Record<string, unknown>;
	return info.CFBundleVersion as string;
}

// ---------------------------------------------------------------------------
// Electron x64 download (cached)
// ---------------------------------------------------------------------------

async function ensureElectronX64(version: string, useCache: boolean, log: LogFn): Promise<string> {
	if (useCache) {
		const cached = getCachedElectronZip(version);
		if (cached) {
			log(`Using cached Electron x64 v${version}`);
			return cached;
		}
	}

	const dest = getElectronCachePath(version);
	const url = `https://github.com/electron/electron/releases/download/v${version}/electron-v${version}-darwin-x64.zip`;

	log(`Downloading Electron x64 v${version}`);
	run(`curl -fL --retry 3 --retry-delay 2 ${JSON.stringify(url)} -o ${JSON.stringify(dest)}`, {
		stdio: "pipe",
	});

	return dest;
}

// ---------------------------------------------------------------------------
// Build target app: x64 Electron shell + source Resources (NEW)
// ---------------------------------------------------------------------------

function buildTargetApp(electronApp: string, srcApp: string, targetApp: string, log: LogFn): void {
	log("Creating x64 app from Electron runtime");

	// 1. Copy x64 Electron.app → target using ditto (preserves all macOS metadata)
	if (existsSync(targetApp)) {
		rmSync(targetApp, { recursive: true });
	}
	run(`ditto ${JSON.stringify(electronApp)} ${JSON.stringify(targetApp)}`, { stdio: "pipe" });

	// 2. Replace Resources with source app's Resources
	const targetResources = join(targetApp, "Contents", "Resources");
	const srcResources = join(srcApp, "Contents", "Resources");
	log("Transplanting Resources from source app");
	rmSync(targetResources, { recursive: true });
	run(`ditto ${JSON.stringify(srcResources)} ${JSON.stringify(targetResources)}`, {
		stdio: "pipe",
	});

	// 3. Copy source Info.plist over
	const srcPlist = join(srcApp, "Contents", "Info.plist");
	const targetPlist = join(targetApp, "Contents", "Info.plist");
	cpSync(srcPlist, targetPlist);
}

// ---------------------------------------------------------------------------
// Patch Info.plist for transplanted runtime (NEW)
// ---------------------------------------------------------------------------

export function fixInfoPlist(plistPath: string, log: LogFn): void {
	log("Patching Info.plist for Electron shell");

	const data = readFileSync(plistPath, "utf-8");
	const info = plist.parse(data) as Record<string, unknown>;

	// The x64 Electron.app main binary is named "Electron", not "Codex"
	info.CFBundleExecutable = "Electron";

	// Force renderer URL to bundled app protocol (prevents localhost:5175 fallback)
	const lsEnv = (info.LSEnvironment as Record<string, string>) || {};
	lsEnv.ELECTRON_RENDERER_URL = "app://-/index.html";
	info.LSEnvironment = lsEnv;

	writeFileSync(plistPath, plist.build(info as plist.PlistValue));
}

// ---------------------------------------------------------------------------
// Read module version from asar (NEW)
// ---------------------------------------------------------------------------

export function getModuleVersionFromAsar(asarPath: string, moduleName: string): string | null {
	try {
		const buf = readFileFromAsar(asarPath, `node_modules/${moduleName}/package.json`);
		const pkg = JSON.parse(buf.toString("utf-8"));
		return pkg.version || null;
	} catch {
		return null;
	}
}

function getBundledCliVersion(appPath: string): string {
	const codexBinaryPath = join(appPath, "Contents", "Resources", "codex");
	if (!existsSync(codexBinaryPath)) {
		throw new CliError("Could not find bundled codex CLI in app resources");
	}

	const binary = readFileSync(codexBinaryPath).toString("latin1");
	const embeddedVersion = binary.match(
		/Update available!([0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.]+)?)See full release notes/,
	)?.[1];

	if (embeddedVersion) {
		return embeddedVersion;
	}

	try {
		const output = runOutput([JSON.stringify(codexBinaryPath), "--version"].join(" "), {
			stdio: "pipe",
		});
		const runtimeVersion = output.match(/([0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.]+)?)/)?.[1];
		if (runtimeVersion) {
			return runtimeVersion;
		}
	} catch {
		// Fall through to a CLI-specific error.
	}

	throw new CliError("Could not determine bundled codex CLI version");
}

// ---------------------------------------------------------------------------
// Create temp npm build project (NEW)
// ---------------------------------------------------------------------------

async function createBuildProject(
	electronVersion: string,
	codexVersion: string,
	bsVersion: string | null,
	npVersion: string | null,
	log: LogFn,
): Promise<string> {
	const projectDir = join(tmpdir(), `cvm-build-${Date.now()}`);
	mkdirSync(projectDir, { recursive: true });

	// @openai/codex publishes platform binaries as optional deps using npm aliases.
	// On ARM Macs, the desktop app bundle already tells us which Codex version to install,
	// so we pin the x64 build explicitly instead of resolving a moving dist-tag.
	const deps: Record<string, string> = {
		"@openai/codex-darwin-x64": `npm:@openai/codex@${codexVersion}-darwin-x64`,
	};
	if (bsVersion) deps["better-sqlite3"] = bsVersion;
	if (npVersion) deps["node-pty"] = npVersion;

	writeFileSync(
		join(projectDir, "package.json"),
		JSON.stringify(
			{
				name: "cvm-build",
				private: true,
				version: "1.0.0",
				dependencies: deps,
				devDependencies: {
					"@electron/rebuild": "3.7.2",
				},
			},
			null,
			2,
		),
	);

	log("Installing build dependencies (@electron/rebuild, native modules, codex CLI)");
	run("pnpm install --ignore-workspace --force", {
		cwd: projectDir,
		stdio: "pipe",
		env: { ...process.env },
	});

	return projectDir;
}

// ---------------------------------------------------------------------------
// Install native module binaries into app bundle
// ---------------------------------------------------------------------------

export function installNativeModule(
	name: string,
	sourceDir: string,
	appUnpacked: string,
	targetAbi: string,
): void {
	if (name === "better-sqlite3") {
		const src = join(sourceDir, "better_sqlite3.node");
		const dst = join(
			appUnpacked,
			"node_modules",
			"better-sqlite3",
			"build",
			"Release",
			"better_sqlite3.node",
		);
		if (existsSync(src)) {
			cpSync(src, dst);
			chmodSync(dst, 0o755);
		}
	} else if (name === "node-pty") {
		const ptySrc = join(sourceDir, "pty.node");
		const ptyDst = join(appUnpacked, "node_modules", "node-pty", "build", "Release", "pty.node");
		if (existsSync(ptySrc)) {
			cpSync(ptySrc, ptyDst);
			chmodSync(ptyDst, 0o755);
		}

		// Install to x64 version-specific bin directory
		const x64BinDir = join(
			appUnpacked,
			"node_modules",
			"node-pty",
			"bin",
			`darwin-x64-${targetAbi}`,
		);
		mkdirSync(x64BinDir, { recursive: true });
		if (existsSync(ptySrc)) {
			cpSync(ptySrc, join(x64BinDir, "node-pty.node"));
			chmodSync(join(x64BinDir, "node-pty.node"), 0o755);
		}

		// arm64 fallback: also install x64 binary into arm64 directory
		// in case the runtime probes darwin-arm64-{abi} path
		const arm64BinDir = join(
			appUnpacked,
			"node_modules",
			"node-pty",
			"bin",
			`darwin-arm64-${targetAbi}`,
		);
		mkdirSync(arm64BinDir, { recursive: true });
		if (existsSync(ptySrc)) {
			cpSync(ptySrc, join(arm64BinDir, "node-pty.node"));
			chmodSync(join(arm64BinDir, "node-pty.node"), 0o755);
		}

		// spawn-helper if present
		const spawnSrc = join(sourceDir, "spawn-helper");
		const spawnDst = join(
			appUnpacked,
			"node_modules",
			"node-pty",
			"build",
			"Release",
			"spawn-helper",
		);
		if (existsSync(spawnSrc)) {
			cpSync(spawnSrc, spawnDst);
			chmodSync(spawnDst, 0o755);
		}
	}
}

// ---------------------------------------------------------------------------
// Install x64 codex CLI binaries from npm (NEW)
// ---------------------------------------------------------------------------

function installCodexCli(projectDir: string, outApp: string, log: LogFn): void {
	const vendorBase = join(
		projectDir,
		"node_modules",
		"@openai",
		"codex-darwin-x64",
		"vendor",
		"x86_64-apple-darwin",
	);

	const codexBin = join(vendorBase, "codex", "codex");
	const rgBin = join(vendorBase, "path", "rg");

	if (!existsSync(codexBin)) {
		log("WARNING: @openai/codex-darwin-x64 not found, falling back to PATH wrapper");
		replaceBundledCliWithWrapper(outApp, log);
		return;
	}

	log("Installing x64 codex CLI binaries");
	const resources = join(outApp, "Contents", "Resources");
	const appUnpacked = join(resources, "app.asar.unpacked");

	// Install codex binary to Resources/codex and app.asar.unpacked/codex
	for (const dir of [resources, appUnpacked]) {
		const dst = join(dir, "codex");
		cpSync(codexBin, dst);
		chmodSync(dst, 0o755);
	}

	// Install rg binary to Resources/rg
	if (existsSync(rgBin)) {
		const rgDst = join(resources, "rg");
		cpSync(rgBin, rgDst);
		chmodSync(rgDst, 0o755);
		log("  codex and rg binaries installed");
	} else {
		log("  codex binary installed (rg not found)");
	}
}

// Fallback PATH wrapper for codex CLI
export function replaceBundledCliWithWrapper(outApp: string, log: LogFn): void {
	const dst = join(outApp, "Contents", "Resources", "codex");
	if (!existsSync(dst)) return;

	log("Replacing bundled codex CLI with PATH wrapper");

	const wrapper = `#!/usr/bin/env bash
set -euo pipefail

resolve_codex() {
  if command -v codex >/dev/null 2>&1; then
    command -v codex
    return 0
  fi
  for p in /usr/local/bin/codex /opt/homebrew/bin/codex; do
    if [[ -x "$p" ]]; then
      printf '%s\\n' "$p"
      return 0
    fi
  done
  if [[ -d "$HOME/.nvm/versions/node" ]]; then
    p="$(ls -1d "$HOME/.nvm/versions/node/"*/bin/codex 2>/dev/null | tail -n 1 || true)"
    if [[ -n "\${p}" && -x "\${p}" ]]; then
      printf '%s\\n' "$p"
      return 0
    fi
  fi
  p="$(/bin/bash -lc 'command -v codex' 2>/dev/null || true)"
  if [[ -n "$p" && -x "$p" ]]; then
    printf '%s\\n' "$p"
    return 0
  fi
  return 1
}

if COD="$(resolve_codex)"; then
  exec "$COD" "$@"
fi

echo "codex CLI not found. Install Codex CLI (x64) and ensure it is discoverable from GUI apps." >&2
exit 127
`;

	writeFileSync(dst, wrapper, { mode: 0o755 });
}

// ---------------------------------------------------------------------------
// Sparkle: just delete sparkle.node (simplified)
// ---------------------------------------------------------------------------

export function disableSparkle(outApp: string, log: LogFn): void {
	log("Removing sparkle.node artifacts");

	for (const sparklePath of [
		join(outApp, "Contents", "Resources", "native", "sparkle.node"),
		join(outApp, "Contents", "Resources", "app.asar.unpacked", "native", "sparkle.node"),
	]) {
		if (existsSync(sparklePath)) {
			rmSync(sparklePath);
			log(`  Removed: ${basename(sparklePath)}`);
		}
	}
}

// ---------------------------------------------------------------------------
// Code signing (simplified, matches reference script)
// ---------------------------------------------------------------------------

function adHocSign(outApp: string, log: LogFn): void {
	// Clear extended attributes
	log("Clearing extended attributes");
	run(`xattr -cr ${JSON.stringify(outApp)}`, { stdio: "pipe", shell: "/bin/bash" });

	// Single deep sign pass
	log("Ad-hoc signing app bundle");
	run(`codesign --force --deep --sign - --timestamp=none ${JSON.stringify(outApp)}`, {
		stdio: "pipe",
	});

	// Verify
	log("Verifying signature");
	run(`codesign --verify --deep --strict ${JSON.stringify(outApp)}`, { stdio: "pipe" });
}

// ---------------------------------------------------------------------------
// DMG creation (NEW)
// ---------------------------------------------------------------------------

function createDmg(appPath: string, dmgOutputPath: string, volumeName: string, log: LogFn): void {
	log(`Creating DMG: ${basename(dmgOutputPath)}`);

	const dmgRoot = join(tmpdir(), `cvm-dmg-${Date.now()}`);
	mkdirSync(dmgRoot, { recursive: true });

	// Copy app into staging dir using ditto
	run(`ditto ${JSON.stringify(appPath)} ${JSON.stringify(join(dmgRoot, basename(appPath)))}`, {
		stdio: "pipe",
	});

	// Create Applications symlink for drag-to-install
	run(`ln -s /Applications ${JSON.stringify(join(dmgRoot, "Applications"))}`, { stdio: "pipe" });

	// Build compressed DMG
	if (existsSync(dmgOutputPath)) {
		rmSync(dmgOutputPath);
	}
	run(
		`hdiutil create -volname ${JSON.stringify(volumeName)} -srcfolder ${JSON.stringify(dmgRoot)} -ov -format UDZO ${JSON.stringify(dmgOutputPath)}`,
		{ stdio: "pipe" },
	);

	// Cleanup staging
	rmSync(dmgRoot, { recursive: true, force: true });
	log(`DMG created: ${dmgOutputPath}`);
}

// ---------------------------------------------------------------------------
// Architecture verification
// ---------------------------------------------------------------------------

function verifyArch(outApp: string, log: LogFn): void {
	log("Verifying x86_64 architecture");
	// x64 Electron shell binary is named "Electron"
	const mainBin = join(outApp, "Contents", "MacOS", "Electron");
	const output = runOutput(`file ${JSON.stringify(mainBin)}`);

	if (!output.includes("x86_64")) {
		throw new Error(`Architecture verification failed: ${output.trim()}`);
	}
	log(`  ${output.trim()}`);
}

// ---------------------------------------------------------------------------
// Electron ABI mapping
// ---------------------------------------------------------------------------

export function getElectronAbi(electronVersion: string): string {
	const major = Number.parseInt(electronVersion.split(".")[0], 10);
	const abiMap: Record<number, string> = {
		40: "143",
		39: "142",
		38: "141",
		37: "140",
		36: "139",
		35: "138",
		34: "137",
		33: "136",
		32: "135",
		31: "134",
		30: "133",
	};
	return abiMap[major] || "143";
}
