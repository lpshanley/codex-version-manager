import { describe, expect, it, vi } from "vitest";

vi.mock("node:readline", () => ({
	createInterface: vi.fn(() => ({
		question: vi.fn((_prompt: string, cb: (answer: string) => void) => {
			const answer = (vi as unknown as { __nextAnswer: string }).__nextAnswer ?? "";
			cb(answer);
		}),
		close: vi.fn(),
	})),
}));

function setNextAnswer(answer: string) {
	(vi as unknown as { __nextAnswer: string }).__nextAnswer = answer;
}

describe("confirm", () => {
	it("returns true for empty input (default yes)", async () => {
		setNextAnswer("");
		const { confirm } = await import("./prompt.js");
		expect(await confirm("Continue?")).toBe(true);
	});

	it("returns true for 'y'", async () => {
		setNextAnswer("y");
		const { confirm } = await import("./prompt.js");
		expect(await confirm("Continue?")).toBe(true);
	});

	it("returns true for 'yes'", async () => {
		setNextAnswer("yes");
		const { confirm } = await import("./prompt.js");
		expect(await confirm("Continue?")).toBe(true);
	});

	it("returns true for 'Y'", async () => {
		setNextAnswer("Y");
		const { confirm } = await import("./prompt.js");
		expect(await confirm("Continue?")).toBe(true);
	});

	it("returns false for 'n'", async () => {
		setNextAnswer("n");
		const { confirm } = await import("./prompt.js");
		expect(await confirm("Continue?")).toBe(false);
	});

	it("returns false for 'no'", async () => {
		setNextAnswer("no");
		const { confirm } = await import("./prompt.js");
		expect(await confirm("Continue?")).toBe(false);
	});

	it("returns false for arbitrary input", async () => {
		setNextAnswer("maybe");
		const { confirm } = await import("./prompt.js");
		expect(await confirm("Continue?")).toBe(false);
	});
});
