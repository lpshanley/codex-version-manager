import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	confirm: vi.fn(),
	currentArch: vi.fn(),
	fetchVersions: vi.fn(),
	installVersion: vi.fn(),
	inspectApp: vi.fn(),
	isAppRunning: vi.fn(),
	openApp: vi.fn(),
	quitApp: vi.fn(),
}));

vi.mock("../lib/appcast.js", async () => {
	const actual = await vi.importActual<typeof import("../lib/appcast.js")>("../lib/appcast.js");
	return {
		...actual,
		fetchVersions: mocks.fetchVersions,
	};
});

vi.mock("../lib/arch.js", () => ({
	currentArch: mocks.currentArch,
}));

vi.mock("../lib/inspect.js", () => ({
	inspectApp: mocks.inspectApp,
}));

vi.mock("../lib/install.js", () => ({
	installVersion: mocks.installVersion,
}));

vi.mock("../lib/process.js", () => ({
	isAppRunning: mocks.isAppRunning,
	openApp: mocks.openApp,
	quitApp: mocks.quitApp,
}));

vi.mock("../lib/prompt.js", () => ({
	confirm: mocks.confirm,
}));

describe("registerUpdateCommand", () => {
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
		mocks.installVersion.mockResolvedValue(undefined);
		mocks.confirm.mockResolvedValue(true);
		mocks.isAppRunning.mockReturnValue(false);
		mocks.quitApp.mockResolvedValue(undefined);
	});

	afterEach(() => {
		logSpy.mockClear();
	});

	it("treats a newer installed build as already up to date", async () => {
		const appPath = mkdtempSync(join(tmpdir(), "cvm-update-test-"));
		mocks.inspectApp.mockResolvedValue({
			version: "26.400.1000",
			build: "1051",
			name: "Codex",
			bundleId: "com.openai.codex",
			architectures: ["arm64"],
			minSystemVersion: "13.0",
			feedUrl: null,
			sparklePublicKey: null,
			isElectron: true,
			nativeModules: [],
		});

		const { registerUpdateCommand } = await import("./update.js");
		const program = new Command();
		registerUpdateCommand(program);

		await program.parseAsync(["update", "--dest", appPath], { from: "user" });

		expect(mocks.installVersion).not.toHaveBeenCalled();
		expect(logSpy).toHaveBeenCalledWith("Codex is already up to date (26.400.1000).");
	});

	it("installs when the app is missing", async () => {
		const missingPath = join(tmpdir(), "cvm-missing-app", "Codex.app");

		const { registerUpdateCommand } = await import("./update.js");
		const program = new Command();
		registerUpdateCommand(program);

		await program.parseAsync(["update", "--dest", missingPath, "--yes"], { from: "user" });

		expect(mocks.installVersion).toHaveBeenCalledWith(
			{
				item: expect.objectContaining({ version: "26.305.950" }),
				dest: missingPath,
				sign: true,
				cache: true,
			},
			expect.any(Function),
		);
	});

	it("updates and reopens the app when it was running", async () => {
		const appPath = mkdtempSync(join(tmpdir(), "cvm-update-running-"));
		mkdirSync(join(appPath, "Contents"), { recursive: true });
		mocks.inspectApp.mockResolvedValue({
			version: "26.200.1000",
			build: "1000",
			name: "Codex",
			bundleId: "com.openai.codex",
			architectures: ["arm64"],
			minSystemVersion: "13.0",
			feedUrl: null,
			sparklePublicKey: null,
			isElectron: true,
			nativeModules: [],
		});
		mocks.isAppRunning.mockReturnValue(true);

		const { registerUpdateCommand } = await import("./update.js");
		const program = new Command();
		registerUpdateCommand(program);

		await program.parseAsync(["update", "--dest", appPath, "--yes"], { from: "user" });

		expect(mocks.quitApp).toHaveBeenCalledWith("Codex");
		expect(mocks.installVersion).toHaveBeenCalled();
		expect(mocks.openApp).toHaveBeenCalledWith(appPath);
	});
});
