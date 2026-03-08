import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AppcastItem } from "./appcast.js";
import { needsRepack } from "./arch.js";
import { downloadAndExtractRelease } from "./release.js";
import { repackApp } from "./repack.js";
import { run } from "./shell.js";

export interface InstallOptions {
	/** The AppcastItem describing the version to install */
	item: AppcastItem;
	/** Destination path for the .app bundle */
	dest: string;
	/** Whether to ad-hoc code sign (Intel only) */
	sign: boolean;
	/** Whether to use the build cache (Intel only) */
	cache: boolean;
}

type LogFn = (msg: string) => void;

/**
 * Download, extract, and install a Codex version.
 * Handles both ARM (direct install) and Intel (repack) flows.
 */
export async function installVersion(
	opts: InstallOptions,
	log: LogFn = (msg) => console.log(`[install] ${msg}`),
): Promise<void> {
	const { item, dest: rawDest, sign, cache } = opts;

	const workDir = join(tmpdir(), `cvm-install-${Date.now()}`);
	mkdirSync(workDir, { recursive: true });

	try {
		const { appPath: srcApp } = downloadAndExtractRelease(item, workDir, log);
		const dest = resolve(rawDest);

		if (needsRepack()) {
			log("Intel architecture detected — repacking for x64");
			const repackedApp = join(workDir, "Codex.app");
			await repackApp(
				{
					input: srcApp,
					output: repackedApp,
					sign,
					cache,
					keepSparkle: false,
					createDmg: false,
				},
				log,
			);

			log(`Installing to ${dest}`);
			if (existsSync(dest)) {
				rmSync(dest, { recursive: true });
			}
			run(`ditto ${JSON.stringify(repackedApp)} ${JSON.stringify(dest)}`, { stdio: "pipe" });
		} else {
			log(`Installing to ${dest}`);
			if (existsSync(dest)) {
				rmSync(dest, { recursive: true });
			}
			run(`ditto ${JSON.stringify(srcApp)} ${JSON.stringify(dest)}`, { stdio: "pipe" });
		}

		log(`Codex ${item.version} installed to ${dest}`);
	} finally {
		rmSync(workDir, { recursive: true, force: true });
	}
}
