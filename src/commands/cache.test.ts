import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	clearCache: vi.fn(),
	getCacheInfo: vi.fn(),
	pruneCache: vi.fn(),
}));

vi.mock("../lib/cache.js", () => ({
	clearCache: mocks.clearCache,
	getCacheInfo: mocks.getCacheInfo,
	pruneCache: mocks.pruneCache,
}));

describe("registerCacheCommand", () => {
	const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		logSpy.mockClear();
	});

	it("prints cache contents", async () => {
		mocks.getCacheInfo.mockReturnValue({
			path: "/tmp/cvm",
			electron: [
				{
					name: "electron-v40.0.0-darwin-x64.zip",
					path: "/tmp/cvm/electron/electron-v40.0.0-darwin-x64.zip",
					size: 123,
					modifiedAt: new Date("2026-03-08T00:00:00.000Z"),
				},
			],
			natives: [
				{
					name: "better-sqlite3@12.0.0-electron-40.0.0-x64",
					path: "/tmp/cvm/natives/better-sqlite3@12.0.0-electron-40.0.0-x64",
					size: 456,
					modifiedAt: new Date("2026-03-07T00:00:00.000Z"),
				},
			],
			electronSize: 123,
			nativesSize: 456,
			totalSize: 579,
		});

		const { registerCacheCommand } = await import("./cache.js");
		const program = new Command();
		registerCacheCommand(program);

		await program.parseAsync(["cache", "status"], { from: "user" });

		const output = logSpy.mock.calls.map(([line]) => line);
		expect(output).toContain("Cache: /tmp/cvm");
		expect(output).toContain("Total size: 579 B\n");
		expect(output).toContain("Electron (1 entry, 123 B)");
		expect(output).toContain("  electron-v40.0.0-darwin-x64.zip  123 B  2026-03-08");
		expect(output).toContain("Natives (1 entry, 456 B)");
		expect(output).toContain("  better-sqlite3@12.0.0-electron-40.0.0-x64  456 B  2026-03-07");
	});

	it("clears only the targeted cache", async () => {
		mocks.clearCache.mockReturnValue({ removedEntries: 1, reclaimedSize: 123 });

		const { registerCacheCommand } = await import("./cache.js");
		const program = new Command();
		registerCacheCommand(program);

		await program.parseAsync(["cache", "clear", "--electron"], { from: "user" });

		expect(mocks.clearCache).toHaveBeenCalledWith("electron");
		expect(logSpy).toHaveBeenCalledWith("Cleared electron cache (1 entry, 123 B).");
	});

	it("prunes stale cache entries", async () => {
		mocks.pruneCache.mockReturnValue({ removedEntries: 2, reclaimedSize: 600 });

		const { registerCacheCommand } = await import("./cache.js");
		const program = new Command();
		registerCacheCommand(program);

		await program.parseAsync(["cache", "prune", "--days", "14", "--natives"], { from: "user" });

		expect(mocks.pruneCache).toHaveBeenCalledWith(14, "natives");
		expect(logSpy).toHaveBeenCalledWith("Pruned natives cache older than 14d (2 entries, 600 B).");
	});
});
