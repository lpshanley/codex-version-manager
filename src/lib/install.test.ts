import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	downloadAndExtractRelease: vi.fn(),
	needsRepack: vi.fn(),
	repackApp: vi.fn(),
	run: vi.fn(),
}));

vi.mock("./arch.js", () => ({
	needsRepack: mocks.needsRepack,
}));

vi.mock("./repack.js", () => ({
	repackApp: mocks.repackApp,
}));

vi.mock("./release.js", () => ({
	downloadAndExtractRelease: mocks.downloadAndExtractRelease,
}));

vi.mock("./shell.js", () => ({
	run: mocks.run,
}));

describe("installVersion", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.downloadAndExtractRelease.mockReturnValue({
			appName: "Codex.app",
			appPath: "/tmp/Codex.app",
		});
		mocks.repackApp.mockResolvedValue(undefined);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it("copies the app directly on Apple Silicon", async () => {
		mocks.needsRepack.mockReturnValue(false);
		const { installVersion } = await import("./install.js");

		await installVersion({
			item: {
				version: "26.305.950",
				build: "1050",
				date: "2025-02-28",
				size: 123_456_789,
				url: "https://example.com/26.zip",
				minOS: "13",
			},
			dest: "/Applications/Codex.app",
			sign: true,
			cache: true,
		});

		expect(mocks.run).toHaveBeenCalledWith(
			expect.stringContaining('ditto "/tmp/Codex.app" "/Applications/Codex.app"'),
			expect.objectContaining({ stdio: "pipe" }),
		);
		expect(mocks.repackApp).not.toHaveBeenCalled();
	});

	it("repackages before installing on Intel", async () => {
		mocks.needsRepack.mockReturnValue(true);
		const { installVersion } = await import("./install.js");

		await installVersion({
			item: {
				version: "26.305.950",
				build: "1050",
				date: "2025-02-28",
				size: 123_456_789,
				url: "https://example.com/26.zip",
				minOS: "13",
			},
			dest: "/Applications/Codex.app",
			sign: true,
			cache: true,
		});

		expect(mocks.repackApp).toHaveBeenCalledWith(
			expect.objectContaining({
				cache: true,
				createDmg: false,
				input: "/tmp/Codex.app",
				sign: true,
			}),
			expect.any(Function),
		);
		expect(mocks.run).toHaveBeenCalledWith(
			expect.stringContaining('ditto "'),
			expect.objectContaining({ stdio: "pipe" }),
		);
	});
});
