import { execSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Command } from "commander";
import { type AppcastItem, fetchVersions, formatSize } from "../lib/appcast.js";
import { currentArch, needsRepack } from "../lib/arch.js";
import { repackApp } from "../lib/repack.js";

export function registerDownloadCommand(program: Command): void {
	program
		.command("download")
		.description("Download a Codex version to ~/Downloads (repacks for Intel automatically)")
		.argument("[version]", 'Version to download (e.g. "26.305.950") or "latest"', "latest")
		.option("-o, --output <path>", "Output directory", join(homedir(), "Downloads"))
		.option("--no-sign", "Skip ad-hoc code signing")
		.option("--no-cache", "Force rebuild everything (ignore cache)")
		.action(async (version: string, options: { output: string; sign: boolean; cache: boolean }) => {
			const log = (msg: string) => console.log(`[download] ${msg}`);

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
			const workDir = join(tmpdir(), `cvm-download-${Date.now()}`);
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
			const outDir = resolve(options.output);
			mkdirSync(outDir, { recursive: true });

			if (needsRepack()) {
				// Intel: repack → DMG
				log("Intel architecture detected — repacking for x64");
				const dmgPath = join(outDir, "CodexIntel.dmg");
				await repackApp(
					{
						input: srcApp,
						output: dmgPath,
						sign: options.sign,
						cache: options.cache,
						keepSparkle: false,
						createDmg: true,
					},
					log,
				);

				rmSync(workDir, { recursive: true, force: true });
				log(`Codex ${item.version} (Intel) saved to ${dmgPath}`);
			} else {
				// ARM: just copy the .app to output dir
				const appDst = join(outDir, appName);
				execSync(`ditto ${JSON.stringify(srcApp)} ${JSON.stringify(appDst)}`, { stdio: "pipe" });

				rmSync(workDir, { recursive: true, force: true });
				log(`Codex ${item.version} saved to ${appDst}`);
			}
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
