import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("arch", () => {
	beforeEach(() => {
		vi.resetModules();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("needsRepack returns true on x64", async () => {
		vi.doMock("node:os", () => ({ arch: () => "x64" }));
		const { needsRepack } = await import("./arch.js");
		expect(needsRepack()).toBe(true);
	});

	it("needsRepack returns false on arm64", async () => {
		vi.doMock("node:os", () => ({ arch: () => "arm64" }));
		const { needsRepack } = await import("./arch.js");
		expect(needsRepack()).toBe(false);
	});

	it("currentArch returns descriptive string for arm64", async () => {
		vi.doMock("node:os", () => ({ arch: () => "arm64" }));
		const { currentArch } = await import("./arch.js");
		expect(currentArch()).toBe("arm64 (Apple Silicon)");
	});

	it("currentArch returns descriptive string for x64", async () => {
		vi.doMock("node:os", () => ({ arch: () => "x64" }));
		const { currentArch } = await import("./arch.js");
		expect(currentArch()).toBe("x64 (Intel)");
	});
});
