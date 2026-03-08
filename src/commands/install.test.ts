import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	currentArch: vi.fn(),
	fetchVersions: vi.fn(),
	installVersion: vi.fn(),
	resolveVersion: vi.fn(),
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
}));

vi.mock("../lib/install.js", () => ({
	installVersion: mocks.installVersion,
}));

describe("registerInstallCommand", () => {
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
		mocks.installVersion.mockResolvedValue(undefined);
	});

	afterEach(() => {
		logSpy.mockClear();
	});

	it("installs the selected release", async () => {
		const { registerInstallCommand } = await import("./install.js");
		const program = new Command();
		registerInstallCommand(program);

		await program.parseAsync(["install", "latest", "--dest", "/Applications/Codex.app"], {
			from: "user",
		});

		expect(mocks.installVersion).toHaveBeenCalledWith(
			{
				item: expect.objectContaining({ version: "26.305.950" }),
				dest: "/Applications/Codex.app",
				sign: true,
				cache: true,
			},
			expect.any(Function),
		);
	});
});
