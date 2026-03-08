import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function getCacheDir(): string {
	const xdg = process.env.XDG_CACHE_HOME;
	const base = xdg || join(homedir(), ".cache");
	const dir = join(base, "cvm");
	mkdirSync(dir, { recursive: true });
	return dir;
}

// -- Electron zip cache --

export function getCachedElectronZip(version: string): string | null {
	const zipPath = join(getCacheDir(), "electron", `electron-v${version}-darwin-x64.zip`);
	return existsSync(zipPath) ? zipPath : null;
}

export function getElectronCachePath(version: string): string {
	const dir = join(getCacheDir(), "electron");
	mkdirSync(dir, { recursive: true });
	return join(dir, `electron-v${version}-darwin-x64.zip`);
}

// -- Native module cache --

function nativeCacheKey(
	moduleName: string,
	moduleVersion: string,
	electronVersion: string,
): string {
	return `${moduleName}@${moduleVersion}-electron-${electronVersion}-x64`;
}

function nativeCacheDir(
	moduleName: string,
	moduleVersion: string,
	electronVersion: string,
): string {
	return join(getCacheDir(), "natives", nativeCacheKey(moduleName, moduleVersion, electronVersion));
}

export function getCachedNative(
	moduleName: string,
	moduleVersion: string,
	electronVersion: string,
): string | null {
	const dir = nativeCacheDir(moduleName, moduleVersion, electronVersion);
	if (!existsSync(dir)) return null;

	const files = readdirSync(dir);
	if (files.length === 0) return null;

	return dir;
}

export function cacheNativeDir(
	moduleName: string,
	moduleVersion: string,
	electronVersion: string,
	sourceDir: string,
): void {
	const dir = nativeCacheDir(moduleName, moduleVersion, electronVersion);
	mkdirSync(dir, { recursive: true });
	cpSync(sourceDir, dir, { recursive: true });
}

// -- Cache management --

export interface CacheEntry {
	name: string;
	path: string;
	size: number;
	modifiedAt: Date;
}

export interface CacheInfo {
	path: string;
	electron: CacheEntry[];
	natives: CacheEntry[];
	electronSize: number;
	nativesSize: number;
	totalSize: number;
}

export interface CacheMutationResult {
	removedEntries: number;
	reclaimedSize: number;
}

function getPathSize(path: string): number {
	const stats = statSync(path);
	if (!stats.isDirectory()) {
		return stats.size;
	}

	return readdirSync(path).reduce((total, entry) => total + getPathSize(join(path, entry)), 0);
}

function listCacheEntries(
	dir: string,
	filter: (name: string) => boolean = () => true,
): CacheEntry[] {
	if (!existsSync(dir)) {
		return [];
	}

	return readdirSync(dir)
		.filter(filter)
		.map((name) => {
			const path = join(dir, name);
			const stats = statSync(path);
			return {
				name,
				path,
				size: getPathSize(path),
				modifiedAt: stats.mtime,
			};
		})
		.sort((left, right) => right.modifiedAt.getTime() - left.modifiedAt.getTime());
}

export function getCacheInfo(): CacheInfo {
	const dir = getCacheDir();

	const electronDir = join(dir, "electron");
	const nativesDir = join(dir, "natives");
	const electron = listCacheEntries(electronDir, (name) => name.endsWith(".zip"));
	const natives = listCacheEntries(nativesDir);
	const electronSize = electron.reduce((total, entry) => total + entry.size, 0);
	const nativesSize = natives.reduce((total, entry) => total + entry.size, 0);

	return {
		path: dir,
		electron,
		natives,
		electronSize,
		nativesSize,
		totalSize: electronSize + nativesSize,
	};
}

function removeEntries(paths: string[]): CacheMutationResult {
	let reclaimedSize = 0;

	for (const path of paths) {
		reclaimedSize += getPathSize(path);
		rmSync(path, { recursive: true, force: true });
	}

	return { removedEntries: paths.length, reclaimedSize };
}

function targetEntries(target?: "electron" | "natives"): CacheEntry[] {
	const info = getCacheInfo();
	if (target === "electron") {
		return info.electron;
	}
	if (target === "natives") {
		return info.natives;
	}

	return [...info.electron, ...info.natives];
}

export function clearCache(target?: "electron" | "natives"): CacheMutationResult {
	return removeEntries(targetEntries(target).map((entry) => entry.path));
}

export function pruneCache(
	maxAgeDays: number,
	target?: "electron" | "natives",
): CacheMutationResult {
	const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1_000;
	const staleEntries = targetEntries(target).filter((entry) => entry.modifiedAt.getTime() < cutoff);

	return removeEntries(staleEntries.map((entry) => entry.path));
}
