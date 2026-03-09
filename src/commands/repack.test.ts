import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	repackApp: vi.fn(),
}));

vi.mock("../lib/repack.js", () => ({
	repackApp: mocks.repackApp,
}));

describe("registerRepackCommand", () => {
	const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

	beforeEach(() => {
		vi.clearAllMocks();
		mocks.repackApp.mockResolvedValue(undefined);
	});

	afterEach(() => {
		logSpy.mockClear();
	});

	it("repackages when not in dry-run mode", async () => {
		const { registerRepackCommand } = await import("./repack.js");
		const program = new Command();
		registerRepackCommand(program);

		await program.parseAsync(["repack", "Codex.dmg", "CodexIntel.dmg"], { from: "user" });

		expect(mocks.repackApp).toHaveBeenCalledWith({
			input: "Codex.dmg",
			output: "CodexIntel.dmg",
			sign: true,
			cache: true,
			keepSparkle: false,
			createDmg: true,
		});
	});

	it("reports the plan in dry-run mode", async () => {
		const { registerRepackCommand } = await import("./repack.js");
		const program = new Command();
		registerRepackCommand(program);

		await program.parseAsync(["repack", "Codex.dmg", "CodexIntel.dmg", "--dry-run"], {
			from: "user",
		});

		expect(mocks.repackApp).not.toHaveBeenCalled();
		expect(logSpy).toHaveBeenCalledWith(
			"[dry-run] Would repack Codex.dmg to CodexIntel.dmg as a DMG.",
		);
	});
});
