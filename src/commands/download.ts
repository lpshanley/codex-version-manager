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
		.action(async (version: string, options: { output: string; sign: boolean; cache: boolean }) => {
			const log = (msg: string) => console.log(`[download] ${msg}`);

			log(`System architecture: ${currentArch()}`);

			// 1. Resolve version
			log("Fetching version list");
			const items = requireAppcastItems(await fetchVersions());

			const item = resolveVersion(items, version);
			log(`Selected: ${item.version} (build ${item.build}, ${formatSize(item.size)})`);

			// 2. Download
			const workDir = join(tmpdir(), `cvm-download-${Date.now()}`);
			mkdirSync(workDir, { recursive: true });
			const { appName, appPath: srcApp } = downloadAndExtractRelease(item, workDir, log);
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
				run(`ditto ${JSON.stringify(srcApp)} ${JSON.stringify(appDst)}`, { stdio: "pipe" });

				rmSync(workDir, { recursive: true, force: true });
				log(`Codex ${item.version} saved to ${appDst}`);
			}
		});
}
