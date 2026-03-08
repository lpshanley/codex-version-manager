import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	clearCache: vi.fn(),
	getCacheInfo: vi.fn(),
}));

vi.mock("../lib/cache.js", () => ({
	clearCache: mocks.clearCache,
	getCacheInfo: mocks.getCacheInfo,
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
			electron: ["electron-v40.0.0-darwin-x64.zip"],
			natives: ["better-sqlite3@12.0.0-electron-40.0.0-x64"],
			totalSize: 0,
		});

		const { registerCacheCommand } = await import("./cache.js");
		const program = new Command();
		registerCacheCommand(program);

		await program.parseAsync(["cache", "status"], { from: "user" });

		const output = logSpy.mock.calls.map(([line]) => line);
		expect(output).toContain("Cache: /tmp/cvm\n");
		expect(output).toContain("Electron:");
		expect(output).toContain("  electron-v40.0.0-darwin-x64.zip");
		expect(output).toContain("Natives:");
		expect(output).toContain("  better-sqlite3@12.0.0-electron-40.0.0-x64");
	});

	it("clears only the targeted cache", async () => {
		const { registerCacheCommand } = await import("./cache.js");
		const program = new Command();
		registerCacheCommand(program);

		await program.parseAsync(["cache", "clear", "--electron"], { from: "user" });

		expect(mocks.clearCache).toHaveBeenCalledWith("electron");
		expect(logSpy).toHaveBeenCalledWith("Cleared electron cache.");
	});
});
