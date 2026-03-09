import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildProgram } from "./cli.js";
import { getCliVersion } from "./lib/meta.js";

const packageJson = JSON.parse(
	readFileSync(new URL("../package.json", import.meta.url), "utf-8"),
) as { version: string };

describe("buildProgram", () => {
	it("uses the package version for the CLI", () => {
		const program = buildProgram();
		expect(getCliVersion()).toBe(packageJson.version);
		expect(program.version()).toBe(packageJson.version);
	});
});
