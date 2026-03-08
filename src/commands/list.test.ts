import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	fetchVersions: vi.fn(),
}));

vi.mock("../lib/appcast.js", async () => {
	const actual = await vi.importActual<typeof import("../lib/appcast.js")>("../lib/appcast.js");
	return {
		...actual,
		fetchVersions: mocks.fetchVersions,
	};
});

describe("registerListCommand", () => {
	const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		logSpy.mockClear();
	});

	it("renders a version table", async () => {
		mocks.fetchVersions.mockResolvedValue([
			{
				version: "26.305.950",
				build: "1050",
				date: "Fri, 28 Feb 2025 00:00:00 +0000",
				size: 123_456_789,
				url: "https://example.com/26.zip",
				minOS: "13",
			},
		]);

		const { registerListCommand } = await import("./list.js");
		const program = new Command();
		registerListCommand(program);

		await program.parseAsync(["list"], { from: "user" });

		const output = logSpy.mock.calls.map(([line]) => line);
		expect(output[0]).toContain("VERSION");
		expect(output[2]).toContain("26.305.950");
		expect(output[2]).toContain("1050");
		expect(output[2]).toContain("2025-02-28");
	});

	it("handles an empty appcast", async () => {
		mocks.fetchVersions.mockResolvedValue([]);

		const { registerListCommand } = await import("./list.js");
		const program = new Command();
		registerListCommand(program);

		await program.parseAsync(["list"], { from: "user" });

		expect(logSpy).toHaveBeenCalledWith("No versions found.");
	});
});
