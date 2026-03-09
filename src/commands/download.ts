import { mkdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Command } from "commander";
import { fetchVersions, formatSize, resolveVersion } from "../lib/appcast.js";
import { currentArch, needsRepack } from "../lib/arch.js";
import { downloadAndExtractRelease, requireAppcastItems } from "../lib/release.js";
import { repackApp } from "../lib/repack.js";
import { run } from "../lib/shell.js";

export function registerDownloadCommand(program: Command): void {
	program
		.command("download")
		.description("Download a Codex version to ~/Downloads (repacks for Intel automatically)")
		.argument("[version]", 'Version to download (e.g. "26.305.950") or "latest"', "latest")
		.option("-o, --output <path>", "Output directory", join(homedir(), "Downloads"))
		.option("--no-sign", "Skip ad-hoc code signing")
		.option("--no-cache", "Force rebuild everything (ignore cache)")
		.option("--dry-run", "Show what would happen without downloading or writing files")
		.action(
			async (
				version: string,
				options: { output: string; sign: boolean; cache: boolean; dryRun?: boolean },
			) => {
				const log = (msg: string) => console.log(`[download] ${msg}`);

				log(`System architecture: ${currentArch()}`);

				// 1. Resolve version
				log("Fetching version list");
				const items = requireAppcastItems(await fetchVersions());

				const item = resolveVersion(items, version);
				log(`Selected: ${item.version} (build ${item.build}, ${formatSize(item.size)})`);
				const outDir = resolve(options.output);

				if (options.dryRun) {
					const outputPath = needsRepack()
						? join(outDir, "CodexIntel.dmg")
						: join(outDir, "Codex.app");
					console.log(
						needsRepack()
							? `[dry-run] Would download Codex ${item.version}, repack it for Intel, and write ${outputPath}.`
							: `[dry-run] Would download Codex ${item.version} and save the app bundle to ${outputPath}.`,
					);
					return;
				}

				// 2. Download
				const workDir = join(tmpdir(), `cvm-download-${Date.now()}`);
				mkdirSync(workDir, { recursive: true });
				const { appName, appPath: srcApp } = downloadAndExtractRelease(item, workDir, log);
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
					run(`ditto ${JSON.stringify(srcApp)} ${JSON.stringify(appDst)}`, { stdio: "pipe" });

					rmSync(workDir, { recursive: true, force: true });
					log(`Codex ${item.version} saved to ${appDst}`);
				}
			},
		);
}
