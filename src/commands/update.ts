import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Command } from "commander";
import { compareReleaseBuilds, fetchVersions, formatSize } from "../lib/appcast.js";
import { currentArch } from "../lib/arch.js";
import { inspectApp } from "../lib/inspect.js";
import { installVersion } from "../lib/install.js";
import { isAppRunning, openApp, quitApp } from "../lib/process.js";
import { confirm } from "../lib/prompt.js";
import { requireAppcastItems } from "../lib/release.js";

const DEFAULT_APP_PATH = "/Applications/Codex.app";

export function registerUpdateCommand(program: Command): void {
	program
		.command("update")
		.description("Check for and install Codex updates")
		.option("--dest <path>", "Path to Codex.app", DEFAULT_APP_PATH)
		.option("--yes", "Skip confirmation prompts")
		.option("--no-sign", "Skip ad-hoc code signing")
		.option("--no-cache", "Force rebuild everything (ignore cache)")
		.option("--dry-run", "Show what would happen without installing or restarting the app")
		.action(
			async (options: {
				dest: string;
				yes?: boolean;
				sign: boolean;
				cache: boolean;
				dryRun?: boolean;
			}) => {
				const log = (msg: string) => console.log(`[update] ${msg}`);
				const appPath = resolve(options.dest);

				log(`System architecture: ${currentArch()}`);

				// 1. Fetch latest version from appcast
				log("Fetching version list");
				const items = requireAppcastItems(await fetchVersions());
				const latest = items[0];

				// 2. Check if app is installed
				if (!existsSync(appPath)) {
					console.log(`Codex is not installed at ${appPath}`);
					console.log(`Latest version available: ${latest.version} (build ${latest.build})`);

					if (options.dryRun) {
						console.log(`[dry-run] Would install Codex ${latest.version} to ${appPath}.`);
						return;
					}

					const shouldInstall = options.yes || (await confirm("Install the latest version?"));
					if (!shouldInstall) {
						console.log("Aborted.");
						return;
					}

					await installVersion(
						{ item: latest, dest: appPath, sign: options.sign, cache: options.cache },
						log,
					);
					return;
				}

				// 3. Inspect currently installed version
				log("Inspecting installed Codex.app");
				const info = await inspectApp(appPath);
				const currentVersion = info.version;
				const currentBuild = info.build;

				log(`Installed: ${currentVersion} (build ${currentBuild})`);
				log(`Latest:    ${latest.version} (build ${latest.build})`);

				// 4. Compare versions
				if (compareReleaseBuilds(info, latest) >= 0) {
					console.log(`Codex is already up to date (${currentVersion}).`);
					return;
				}

				// 5. Confirm update
				console.log();
				console.log(`  Current: ${currentVersion} (build ${currentBuild})`);
				console.log(
					`  Latest:  ${latest.version} (build ${latest.build}, ${formatSize(latest.size)})`,
				);
				console.log();

				const wasRunning = isAppRunning("Codex");
				if (options.dryRun) {
					console.log(
						`[dry-run] Would update ${appPath} to Codex ${latest.version}${wasRunning ? ", closing and reopening Codex around the install" : ""}.`,
					);
					return;
				}

				const shouldUpdate = options.yes || (await confirm("Update to the latest version?"));
				if (!shouldUpdate) {
					console.log("Aborted.");
					return;
				}

				// 6. Close the app if running
				if (wasRunning) {
					log("Closing Codex");
					await quitApp("Codex");
				}

				// 7. Install the new version
				await installVersion(
					{ item: latest, dest: appPath, sign: options.sign, cache: options.cache },
					log,
				);

				// 8. Reopen the app if it was running
				if (wasRunning) {
					log("Reopening Codex");
					openApp(appPath);
				}
			},
		);
}
