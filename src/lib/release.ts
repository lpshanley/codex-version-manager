import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { AppcastItem } from "./appcast.js";
import { formatSize } from "./appcast.js";
import { CliError } from "./errors.js";
import { run } from "./shell.js";

type LogFn = (msg: string) => void;

export interface DownloadedApp {
	appName: string;
	appPath: string;
}

export function requireAppcastItems(items: AppcastItem[]): AppcastItem[] {
	if (items.length === 0) {
		throw new CliError("No versions found in the update feed.");
	}

	return items;
}

export function downloadAndExtractRelease(
	item: AppcastItem,
	workDir: string,
	log: LogFn,
): DownloadedApp {
	mkdirSync(workDir, { recursive: true });

	const zipPath = join(workDir, `Codex-${item.version}.zip`);
	log(`Downloading Codex ${item.version} (${formatSize(item.size)})`);
	run(
		`curl -fL --retry 3 --retry-delay 2 --progress-bar ${JSON.stringify(item.url)} -o ${JSON.stringify(zipPath)}`,
		{ stdio: ["pipe", "inherit", "inherit"] },
	);

	const extractDir = join(workDir, "extracted");
	mkdirSync(extractDir, { recursive: true });
	run(`unzip -q ${JSON.stringify(zipPath)} -d ${JSON.stringify(extractDir)}`, { stdio: "pipe" });

	const appName = readdirSync(extractDir).find((entry) => entry.endsWith(".app"));
	if (!appName) {
		throw new CliError("No .app found in downloaded zip");
	}

	const appPath = join(extractDir, appName);
	if (!existsSync(appPath)) {
		throw new CliError(`Downloaded app bundle is missing: ${appPath}`);
	}

	return { appName, appPath };
}
