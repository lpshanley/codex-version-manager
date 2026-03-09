import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	currentArch: vi.fn(),
	downloadAndExtractRelease: vi.fn(),
	fetchVersions: vi.fn(),
	needsRepack: vi.fn(),
	repackApp: vi.fn(),
	resolveVersion: vi.fn(),
	run: vi.fn(),
}));

vi.mock("../lib/appcast.js", async () => {
	const actual = await vi.importActual<typeof import("../lib/appcast.js")>("../lib/appcast.js");
	return {
		...actual,
		fetchVersions: mocks.fetchVersions,
		resolveVersion: mocks.resolveVersion,
	};
});

vi.mock("../lib/arch.js", () => ({
	currentArch: mocks.currentArch,
	needsRepack: mocks.needsRepack,
}));

vi.mock("../lib/repack.js", () => ({
	repackApp: mocks.repackApp,
}));

vi.mock("../lib/release.js", async () => {
	const actual = await vi.importActual<typeof import("../lib/release.js")>("../lib/release.js");
	return {
		...actual,
		downloadAndExtractRelease: mocks.downloadAndExtractRelease,
	};
});

vi.mock("../lib/shell.js", () => ({
	run: mocks.run,
}));

describe("registerDownloadCommand", () => {
	const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

	beforeEach(() => {
		vi.clearAllMocks();
		mocks.currentArch.mockReturnValue("arm64 (Apple Silicon)");
		mocks.fetchVersions.mockResolvedValue([
			{
				version: "26.305.950",
				build: "1050",
				date: "2025-02-28",
				size: 123_456_789,
				url: "https://example.com/26.zip",
				minOS: "13",
			},
		]);
		mocks.resolveVersion.mockImplementation((items) => items[0]);
		mocks.downloadAndExtractRelease.mockReturnValue({
			appName: "Codex.app",
			appPath: "/tmp/Codex.app",
		});
	});

	afterEach(() => {
		logSpy.mockClear();
	});

	it("copies the app directly on Apple Silicon", async () => {
		mocks.needsRepack.mockReturnValue(false);

		const { registerDownloadCommand } = await import("./download.js");
		const program = new Command();
		registerDownloadCommand(program);
		const outDir = mkdtempSync(join(tmpdir(), "cvm-download-test-"));

		await program.parseAsync(["download", "latest", "--output", outDir], { from: "user" });

		expect(mocks.run).toHaveBeenCalledWith(
			expect.stringContaining("ditto"),
			expect.objectContaining({ stdio: "pipe" }),
		);
		expect(mocks.repackApp).not.toHaveBeenCalled();
	});

	it("repackages on Intel", async () => {
		mocks.currentArch.mockReturnValue("x64 (Intel)");
		mocks.needsRepack.mockReturnValue(true);
		mocks.repackApp.mockResolvedValue(undefined);

		const { registerDownloadCommand } = await import("./download.js");
		const program = new Command();
		registerDownloadCommand(program);
		const outDir = mkdtempSync(join(tmpdir(), "cvm-download-test-"));

		await program.parseAsync(["download", "latest", "--output", outDir], { from: "user" });

		expect(mocks.repackApp).toHaveBeenCalledWith(
			expect.objectContaining({
				createDmg: true,
				input: "/tmp/Codex.app",
			}),
			expect.any(Function),
		);
	});

	it("reports the planned output in dry-run mode", async () => {
		mocks.needsRepack.mockReturnValue(false);

		const { registerDownloadCommand } = await import("./download.js");
		const program = new Command();
		registerDownloadCommand(program);
		const outDir = mkdtempSync(join(tmpdir(), "cvm-download-test-"));

		await program.parseAsync(["download", "latest", "--output", outDir, "--dry-run"], {
			from: "user",
		});

		expect(mocks.downloadAndExtractRelease).not.toHaveBeenCalled();
		expect(mocks.run).not.toHaveBeenCalled();
		expect(logSpy).toHaveBeenCalledWith(
			`[dry-run] Would download Codex 26.305.950 and save the app bundle to ${join(outDir, "Codex.app")}.`,
		);
	});

	it("fails cleanly when the appcast is empty", async () => {
		mocks.fetchVersions.mockResolvedValue([]);

		const { registerDownloadCommand } = await import("./download.js");
		const program = new Command();
		registerDownloadCommand(program);

		await expect(program.parseAsync(["download"], { from: "user" })).rejects.toThrow(
			"No versions found in the update feed.",
		);
	});
});
