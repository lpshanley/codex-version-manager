import type { Command } from "commander";
import { formatSize } from "../lib/appcast.js";
import { clearCache, getCacheInfo, pruneCache } from "../lib/cache.js";
import type { CacheEntry } from "../lib/cache.js";

function formatDate(date: Date): string {
	return date.toISOString().slice(0, 10);
}

function printEntries(title: string, entries: CacheEntry[], totalSize: number): void {
	if (entries.length === 0) {
		return;
	}

	console.log(
		`${title} (${entries.length} ${entries.length === 1 ? "entry" : "entries"}, ${formatSize(totalSize)})`,
	);
	for (const entry of entries) {
		console.log(`  ${entry.name}  ${formatSize(entry.size)}  ${formatDate(entry.modifiedAt)}`);
	}
}

function parseDays(rawDays: string): number {
	const days = Number.parseInt(rawDays, 10);
	if (!Number.isFinite(days) || days < 0) {
		throw new Error(`Invalid value for --days: ${rawDays}`);
	}

	return days;
}

export function registerCacheCommand(program: Command): void {
	const cache = program.command("cache").description("Manage the build cache");

	cache
		.command("status")
		.description("Show what's in the cache")
		.action(() => {
			const info = getCacheInfo();
			console.log(`Cache: ${info.path}`);
			console.log(`Total size: ${formatSize(info.totalSize)}\n`);

			if (info.electron.length === 0 && info.natives.length === 0) {
				console.log("Cache is empty.");
				return;
			}

			printEntries("Electron", info.electron, info.electronSize);
			printEntries("Natives", info.natives, info.nativesSize);
		});

	cache
		.command("clear")
		.description("Clear the build cache")
		.option("--electron", "Only clear Electron downloads")
		.option("--natives", "Only clear rebuilt native modules")
		.action((options: { electron?: boolean; natives?: boolean }) => {
			const target = options.electron ? "electron" : options.natives ? "natives" : undefined;
			const result = clearCache(target);

			const what = target ?? "all";
			console.log(
				`Cleared ${what} cache (${result.removedEntries} ${result.removedEntries === 1 ? "entry" : "entries"}, ${formatSize(result.reclaimedSize)}).`,
			);
		});

	cache
		.command("prune")
		.description("Remove cache entries older than a given number of days")
		.option("--days <days>", "Prune entries older than this many days", "30")
		.option("--electron", "Only prune Electron downloads")
		.option("--natives", "Only prune rebuilt native modules")
		.action((options: { days: string; electron?: boolean; natives?: boolean }) => {
			const target = options.electron ? "electron" : options.natives ? "natives" : undefined;
			const days = parseDays(options.days);
			const result = pruneCache(days, target);
			const what = target ?? "all";

			console.log(
				`Pruned ${what} cache older than ${days}d (${result.removedEntries} ${result.removedEntries === 1 ? "entry" : "entries"}, ${formatSize(result.reclaimedSize)}).`,
			);
		});
}
