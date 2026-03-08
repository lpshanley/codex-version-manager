import { afterEach, describe, expect, it, vi } from "vitest";

const mockExecSync = vi.fn();

vi.mock("node:child_process", () => ({
	execSync: (...args: unknown[]) => mockExecSync(...args),
}));

describe("isAppRunning", () => {
	afterEach(() => {
		mockExecSync.mockReset();
	});

	it("returns true when pgrep finds the process", async () => {
		mockExecSync.mockReturnValue(Buffer.from("12345"));
		const { isAppRunning } = await import("./process.js");
		expect(isAppRunning("Codex")).toBe(true);
		expect(mockExecSync).toHaveBeenCalledWith(
			expect.stringContaining("pgrep -x"),
			expect.objectContaining({ stdio: "pipe" }),
		);
	});

	it("returns false when pgrep throws", async () => {
		mockExecSync.mockImplementation(() => {
			throw new Error("no process");
		});
		const { isAppRunning } = await import("./process.js");
		expect(isAppRunning("Codex")).toBe(false);
	});
});

describe("openApp", () => {
	afterEach(() => {
		mockExecSync.mockReset();
	});

	it("calls open with the app path", async () => {
		mockExecSync.mockReturnValue(Buffer.from(""));
		const { openApp } = await import("./process.js");
		openApp("/Applications/Codex.app");
		expect(mockExecSync).toHaveBeenCalledWith(
			expect.stringContaining("open"),
			expect.objectContaining({ stdio: "pipe" }),
		);
	});
});

describe("quitApp", () => {
	afterEach(() => {
		mockExecSync.mockReset();
	});

	it("is a no-op if app is not running", async () => {
		mockExecSync.mockImplementation(() => {
			throw new Error("no process");
		});
		const { quitApp } = await import("./process.js");
		await quitApp("Codex");
		// Only one call: pgrep check
		expect(mockExecSync).toHaveBeenCalledTimes(1);
	});

	it("sends osascript quit and waits for process to exit", async () => {
		let callCount = 0;
		mockExecSync.mockImplementation((cmd: string) => {
			if (typeof cmd === "string" && cmd.includes("pgrep")) {
				callCount++;
				if (callCount <= 1) {
					return Buffer.from("12345"); // running initially
				}
				throw new Error("no process"); // gone after quit
			}
			return Buffer.from("");
		});

		const { quitApp } = await import("./process.js");
		await quitApp("Codex", 5000);

		// Should have called osascript to quit
		expect(mockExecSync).toHaveBeenCalledWith(
			expect.stringContaining("osascript"),
			expect.any(Object),
		);
	});
});
