import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
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

export interface CacheInfo {
	path: string;
	electron: string[];
	natives: string[];
	totalSize: number;
}

export function getCacheInfo(): CacheInfo {
	const dir = getCacheDir();
	const info: CacheInfo = { path: dir, electron: [], natives: [], totalSize: 0 };

	const electronDir = join(dir, "electron");
	if (existsSync(electronDir)) {
		info.electron = readdirSync(electronDir).filter((f) => f.endsWith(".zip"));
	}

	const nativesDir = join(dir, "natives");
	if (existsSync(nativesDir)) {
		info.natives = readdirSync(nativesDir);
	}

	return info;
}

export function clearCache(target?: "electron" | "natives"): void {
	const dir = getCacheDir();

	if (!target || target === "electron") {
		const electronDir = join(dir, "electron");
		if (existsSync(electronDir)) {
			rmSync(electronDir, { recursive: true, force: true });
		}
	}

	if (!target || target === "natives") {
		const nativesDir = join(dir, "natives");
		if (existsSync(nativesDir)) {
			rmSync(nativesDir, { recursive: true, force: true });
		}
	}
}
