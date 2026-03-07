import type { Command } from "commander";
import { clearCache, getCacheInfo } from "../lib/cache.js";

export function registerCacheCommand(program: Command): void {
	const cache = program.command("cache").description("Manage the build cache");

	cache
		.command("status")
		.description("Show what's in the cache")
		.action(() => {
			const info = getCacheInfo();
			console.log(`Cache: ${info.path}\n`);

			if (info.electron.length === 0 && info.natives.length === 0) {
				console.log("Cache is empty.");
				return;
			}

			if (info.electron.length > 0) {
				console.log("Electron:");
				for (const f of info.electron) {
					console.log(`  ${f}`);
				}
			}

			if (info.natives.length > 0) {
				console.log("Natives:");
				for (const n of info.natives) {
					console.log(`  ${n}`);
				}
			}
		});

	cache
		.command("clear")
		.description("Clear the build cache")
		.option("--electron", "Only clear Electron downloads")
		.option("--natives", "Only clear rebuilt native modules")
		.action((options: { electron?: boolean; natives?: boolean }) => {
			const target = options.electron ? "electron" : options.natives ? "natives" : undefined;

			clearCache(target);

			const what = target ?? "all";
			console.log(`Cleared ${what} cache.`);
		});
}
