import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Command } from "commander";
import { type AppcastItem, fetchVersions, formatSize } from "../lib/appcast.js";
import { currentArch, needsRepack } from "../lib/arch.js";
import { repackApp } from "../lib/repack.js";

export function registerInstallCommand(program: Command): void {
	program
		.command("install")
		.description("Download and install a Codex version (repacks for Intel automatically)")
		.argument("[version]", 'Version to install (e.g. "26.305.950") or "latest"', "latest")
		.option("--dest <path>", "Install destination", "/Applications/Codex.app")
		.option("--no-sign", "Skip ad-hoc code signing")
		.option("--no-cache", "Force rebuild everything (ignore cache)")
		.action(async (version: string, options: { dest: string; sign: boolean; cache: boolean }) => {
			const log = (msg: string) => console.log(`[install] ${msg}`);

			log(`System architecture: ${currentArch()}`);

			// 1. Resolve version
			log("Fetching version list");
			const items = await fetchVersions();
			if (items.length === 0) {
				console.error("No versions found in the update feed.");
				process.exit(1);
			}

			const item = resolveVersion(items, version);
			log(`Selected: ${item.version} (build ${item.build}, ${formatSize(item.size)})`);

			// 2. Download
			const workDir = join(tmpdir(), `cvm-install-${Date.now()}`);
			mkdirSync(workDir, { recursive: true });

			const zipPath = join(workDir, `Codex-${item.version}.zip`);
			log(`Downloading Codex ${item.version}`);
			execSync(
				`curl -fL --retry 3 --retry-delay 2 --progress-bar ${JSON.stringify(item.url)} -o ${JSON.stringify(zipPath)}`,
				{ stdio: ["pipe", "inherit", "inherit"] },
			);

			// 3. Extract .app from zip
			const extractDir = join(workDir, "extracted");
			mkdirSync(extractDir);
			execSync(`unzip -q ${JSON.stringify(zipPath)} -d ${JSON.stringify(extractDir)}`, {
				stdio: "pipe",
			});

			const entries = readdirSync(extractDir);
			const appName = entries.find((e) => e.endsWith(".app"));
			if (!appName) {
				throw new Error("No .app found in downloaded zip");
			}

			const srcApp = join(extractDir, appName);
			const dest = resolve(options.dest);

			if (needsRepack()) {
				// Intel: repack then install
				log("Intel architecture detected — repacking for x64");
				const repackedApp = join(workDir, "Codex.app");
				await repackApp(
					{
						input: srcApp,
						output: repackedApp,
						sign: options.sign,
						cache: options.cache,
						keepSparkle: false,
						createDmg: false,
					},
					log,
				);

				log(`Installing to ${dest}`);
				if (existsSync(dest)) {
					rmSync(dest, { recursive: true });
				}
				execSync(`ditto ${JSON.stringify(repackedApp)} ${JSON.stringify(dest)}`, { stdio: "pipe" });
			} else {
				// ARM: install directly
				log(`Installing to ${dest}`);
				if (existsSync(dest)) {
					rmSync(dest, { recursive: true });
				}
				execSync(`ditto ${JSON.stringify(srcApp)} ${JSON.stringify(dest)}`, { stdio: "pipe" });
			}

			// Cleanup
			rmSync(workDir, { recursive: true, force: true });

			log(`Codex ${item.version} installed to ${dest}`);
		});
}

function resolveVersion(items: AppcastItem[], version: string): AppcastItem {
	if (version === "latest") {
		return items[0];
	}

	const match = items.find((i) => i.version === version || i.build === version);

	if (!match) {
		const available = items.map((i) => i.version).join(", ");
		console.error(`Version "${version}" not found. Available: ${available}`);
		process.exit(1);
	}

	return match;
}
