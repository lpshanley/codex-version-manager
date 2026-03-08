import { existsSync, mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("cache", () => {
	let cacheDir: string;
	const originalEnv = process.env.XDG_CACHE_HOME;

	beforeEach(() => {
		cacheDir = join(tmpdir(), `cvm-cache-test-${Date.now()}`);
		process.env.XDG_CACHE_HOME = cacheDir;
	});

	afterEach(() => {
		if (originalEnv) {
			process.env.XDG_CACHE_HOME = originalEnv;
		} else {
			process.env.XDG_CACHE_HOME = undefined;
		}
		if (existsSync(cacheDir)) {
			rmSync(cacheDir, { recursive: true, force: true });
		}
		vi.resetModules();
	});

	it("getCachedElectronZip returns null when no cache exists", async () => {
		const { getCachedElectronZip } = await import("./cache.js");
		expect(getCachedElectronZip("40.0.0")).toBeNull();
	});

	it("getCachedElectronZip returns path when cached", async () => {
		const electronDir = join(cacheDir, "cvm", "electron");
		mkdirSync(electronDir, { recursive: true });
		writeFileSync(join(electronDir, "electron-v40.0.0-darwin-x64.zip"), "fake");

		const { getCachedElectronZip } = await import("./cache.js");
		const result = getCachedElectronZip("40.0.0");
		expect(result).not.toBeNull();
		expect(result).toContain("electron-v40.0.0-darwin-x64.zip");
	});

	it("getCacheInfo returns empty when cache is clean", async () => {
		const { getCacheInfo } = await import("./cache.js");
		const info = getCacheInfo();
		expect(info.electron).toEqual([]);
		expect(info.natives).toEqual([]);
		expect(info.totalSize).toBe(0);
	});

	it("clearCache removes all cache dirs", async () => {
		const electronDir = join(cacheDir, "cvm", "electron");
		const nativesDir = join(cacheDir, "cvm", "natives");
		mkdirSync(electronDir, { recursive: true });
		mkdirSync(nativesDir, { recursive: true });
		const electronFile = join(electronDir, "test.zip");
		const nativeDir = join(nativesDir, "native-build");
		writeFileSync(electronFile, "data");
		mkdirSync(nativeDir, { recursive: true });

		const { clearCache } = await import("./cache.js");
		const result = clearCache();

		expect(existsSync(electronFile)).toBe(false);
		expect(existsSync(nativeDir)).toBe(false);
		expect(result.removedEntries).toBe(2);
		expect(result.reclaimedSize).toBeGreaterThan(0);
	});

	it("clearCache can target only electron", async () => {
		const electronDir = join(cacheDir, "cvm", "electron");
		const nativesDir = join(cacheDir, "cvm", "natives");
		mkdirSync(electronDir, { recursive: true });
		mkdirSync(nativesDir, { recursive: true });
		const electronFile = join(electronDir, "test.zip");
		const nativeFile = join(nativesDir, "test");
		writeFileSync(electronFile, "data");
		writeFileSync(nativeFile, "data");

		const { clearCache } = await import("./cache.js");
		const result = clearCache("electron");

		expect(existsSync(electronFile)).toBe(false);
		expect(existsSync(nativeFile)).toBe(true);
		expect(result.removedEntries).toBe(1);
	});

	it("clearCache can target only natives", async () => {
		const electronDir = join(cacheDir, "cvm", "electron");
		const nativesDir = join(cacheDir, "cvm", "natives");
		mkdirSync(electronDir, { recursive: true });
		mkdirSync(nativesDir, { recursive: true });
		const electronFile = join(electronDir, "test.zip");
		const nativeFile = join(nativesDir, "test");
		writeFileSync(electronFile, "data");
		writeFileSync(nativeFile, "data");

		const { clearCache } = await import("./cache.js");
		const result = clearCache("natives");

		expect(existsSync(electronFile)).toBe(true);
		expect(existsSync(nativeFile)).toBe(false);
		expect(result.removedEntries).toBe(1);
	});

	it("getElectronCachePath returns correct path and creates directory", async () => {
		const { getElectronCachePath } = await import("./cache.js");
		const result = getElectronCachePath("40.0.0");
		expect(result).toContain("electron");
		expect(result).toContain("electron-v40.0.0-darwin-x64.zip");
		expect(existsSync(join(cacheDir, "cvm", "electron"))).toBe(true);
	});

	it("getCachedNative returns null when no cache exists", async () => {
		const { getCachedNative } = await import("./cache.js");
		expect(getCachedNative("better-sqlite3", "12.0.0", "40.0.0")).toBeNull();
	});

	it("getCachedNative returns null for empty directory", async () => {
		const nativeDir = join(cacheDir, "cvm", "natives", "better-sqlite3@12.0.0-electron-40.0.0-x64");
		mkdirSync(nativeDir, { recursive: true });

		const { getCachedNative } = await import("./cache.js");
		expect(getCachedNative("better-sqlite3", "12.0.0", "40.0.0")).toBeNull();
	});

	it("getCachedNative returns dir when files exist", async () => {
		const nativeDir = join(cacheDir, "cvm", "natives", "better-sqlite3@12.0.0-electron-40.0.0-x64");
		mkdirSync(nativeDir, { recursive: true });
		writeFileSync(join(nativeDir, "better_sqlite3.node"), "binary");

		const { getCachedNative } = await import("./cache.js");
		const result = getCachedNative("better-sqlite3", "12.0.0", "40.0.0");
		expect(result).not.toBeNull();
		expect(result).toContain("better-sqlite3@12.0.0-electron-40.0.0-x64");
	});

	it("cacheNativeDir copies files into cache", async () => {
		const sourceDir = join(cacheDir, "source");
		mkdirSync(sourceDir, { recursive: true });
		writeFileSync(join(sourceDir, "pty.node"), "binary-data");

		const { cacheNativeDir, getCachedNative } = await import("./cache.js");
		cacheNativeDir("node-pty", "1.0.0", "40.0.0", sourceDir);

		const cached = getCachedNative("node-pty", "1.0.0", "40.0.0");
		expect(cached).not.toBeNull();
		expect(existsSync(join(cached as string, "pty.node"))).toBe(true);
	});

	it("getCacheInfo returns electron and natives when populated", async () => {
		const electronDir = join(cacheDir, "cvm", "electron");
		const nativesDir = join(cacheDir, "cvm", "natives");
		mkdirSync(electronDir, { recursive: true });
		mkdirSync(nativesDir, { recursive: true });
		writeFileSync(join(electronDir, "electron-v40.0.0-darwin-x64.zip"), "data");
		mkdirSync(join(nativesDir, "better-sqlite3@12.0.0-electron-40.0.0-x64"), { recursive: true });

		const { getCacheInfo } = await import("./cache.js");
		const info = getCacheInfo();
		expect(info.electron[0]?.name).toBe("electron-v40.0.0-darwin-x64.zip");
		expect(info.natives[0]?.name).toBe("better-sqlite3@12.0.0-electron-40.0.0-x64");
		expect(info.totalSize).toBeGreaterThan(0);
	});

	it("getCacheInfo filters non-zip files from electron list", async () => {
		const electronDir = join(cacheDir, "cvm", "electron");
		mkdirSync(electronDir, { recursive: true });
		writeFileSync(join(electronDir, "electron-v40.0.0-darwin-x64.zip"), "data");
		writeFileSync(join(electronDir, "readme.txt"), "not a zip");

		const { getCacheInfo } = await import("./cache.js");
		const info = getCacheInfo();
		expect(info.electron.map((entry) => entry.name)).toEqual(["electron-v40.0.0-darwin-x64.zip"]);
	});

	it("pruneCache removes stale cache entries", async () => {
		const electronDir = join(cacheDir, "cvm", "electron");
		mkdirSync(electronDir, { recursive: true });
		const staleZip = join(electronDir, "electron-v40.0.0-darwin-x64.zip");
		const freshZip = join(electronDir, "electron-v41.0.0-darwin-x64.zip");
		writeFileSync(staleZip, "stale");
		writeFileSync(freshZip, "fresh");
		const staleDate = new Date(Date.now() - 45 * 24 * 60 * 60 * 1_000);
		utimesSync(staleZip, staleDate, staleDate);

		const { pruneCache } = await import("./cache.js");
		const result = pruneCache(30, "electron");

		expect(result.removedEntries).toBe(1);
		expect(existsSync(staleZip)).toBe(false);
		expect(existsSync(freshZip)).toBe(true);
	});
});
