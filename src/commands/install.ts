import type { Command } from "commander";
import { fetchVersions, formatSize, resolveVersion } from "../lib/appcast.js";
import { currentArch } from "../lib/arch.js";
import { installVersion } from "../lib/install.js";
import { requireAppcastItems } from "../lib/release.js";

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

			log("Fetching version list");
			const items = requireAppcastItems(await fetchVersions());

			const item = resolveVersion(items, version);
			log(`Selected: ${item.version} (build ${item.build}, ${formatSize(item.size)})`);

			await installVersion(
				{ item, dest: options.dest, sign: options.sign, cache: options.cache },
				log,
			);
		});
}
