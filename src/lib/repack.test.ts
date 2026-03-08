import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import plist from "plist";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	disableSparkle,
	fixInfoPlist,
	getElectronAbi,
	getModuleVersionFromAsar,
	installNativeModule,
	replaceBundledCliWithWrapper,
} from "./repack.js";

/**
 * Build a minimal asar archive in memory.
 */
function buildAsar(files: Record<string, string>): Buffer {
	const tree: Record<string, unknown> = { files: {} };
	const dataChunks: Buffer[] = [];
	let offset = 0;

	for (const [path, content] of Object.entries(files)) {
		const parts = path.split("/");
		let node = tree.files as Record<string, unknown>;

		for (let i = 0; i < parts.length - 1; i++) {
			if (!node[parts[i]]) {
				node[parts[i]] = { files: {} };
			}
			node = (node[parts[i]] as { files: Record<string, unknown> }).files;
		}

		const buf = Buffer.from(content, "utf-8");
		node[parts[parts.length - 1]] = {
			offset: String(offset),
			size: buf.length,
		};
		dataChunks.push(buf);
		offset += buf.length;
	}

	const jsonStr = JSON.stringify(tree);
	const jsonBuf = Buffer.from(jsonStr, "utf-8");
	const padding = (4 - (jsonBuf.length % 4)) % 4;
	const paddedJsonLen = jsonBuf.length + padding;

	const header = Buffer.alloc(16 + paddedJsonLen);
	header.writeUInt32LE(4, 0);
	header.writeUInt32LE(8 + paddedJsonLen, 4);
	header.writeUInt32LE(4 + paddedJsonLen, 8);
	header.writeUInt32LE(jsonBuf.length, 12);
	jsonBuf.copy(header, 16);

	return Buffer.concat([header, ...dataChunks]);
}

describe("getElectronAbi", () => {
	it("maps Electron 40.x to ABI 143", () => {
		expect(getElectronAbi("40.1.0")).toBe("143");
	});

	it("maps Electron 35.x to ABI 138", () => {
		expect(getElectronAbi("35.0.0")).toBe("138");
	});

	it("maps Electron 30.x to ABI 133", () => {
		expect(getElectronAbi("30.2.1")).toBe("133");
	});

	it("returns default 143 for unknown major", () => {
		expect(getElectronAbi("99.0.0")).toBe("143");
	});

	it("handles all known versions", () => {
		const expected: Record<string, string> = {
			"40.0.0": "143",
			"39.0.0": "142",
			"38.0.0": "141",
			"37.0.0": "140",
			"36.0.0": "139",
			"35.0.0": "138",
			"34.0.0": "137",
			"33.0.0": "136",
			"32.0.0": "135",
			"31.0.0": "134",
			"30.0.0": "133",
		};
		for (const [version, abi] of Object.entries(expected)) {
			expect(getElectronAbi(version)).toBe(abi);
		}
	});
});

describe("getModuleVersionFromAsar", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = join(tmpdir(), `cvm-repack-test-${Date.now()}`);
		mkdirSync(tmpDir, { recursive: true });
	});

	afterEach(() => {
		if (existsSync(tmpDir)) {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("extracts module version from asar", () => {
		const asarPath = join(tmpDir, "test.asar");
		const asar = buildAsar({
			"node_modules/better-sqlite3/package.json": JSON.stringify({
				name: "better-sqlite3",
				version: "12.0.0",
			}),
		});
		writeFileSync(asarPath, asar);

		expect(getModuleVersionFromAsar(asarPath, "better-sqlite3")).toBe("12.0.0");
	});

	it("returns null for missing module", () => {
		const asarPath = join(tmpDir, "test.asar");
		const asar = buildAsar({
			"package.json": JSON.stringify({ name: "test", version: "1.0.0" }),
		});
		writeFileSync(asarPath, asar);

		expect(getModuleVersionFromAsar(asarPath, "nonexistent")).toBeNull();
	});

	it("returns null for missing asar file", () => {
		expect(getModuleVersionFromAsar(join(tmpDir, "missing.asar"), "mod")).toBeNull();
	});

	it("returns null when package.json has no version", () => {
		const asarPath = join(tmpDir, "test.asar");
		const asar = buildAsar({
			"node_modules/mymod/package.json": JSON.stringify({ name: "mymod" }),
		});
		writeFileSync(asarPath, asar);

		expect(getModuleVersionFromAsar(asarPath, "mymod")).toBeNull();
	});
});

describe("installNativeModule", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = join(tmpdir(), `cvm-install-native-test-${Date.now()}`);
		mkdirSync(tmpDir, { recursive: true });
	});

	afterEach(() => {
		if (existsSync(tmpDir)) {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("installs better-sqlite3 binary", () => {
		const sourceDir = join(tmpDir, "source");
		mkdirSync(sourceDir, { recursive: true });
		writeFileSync(join(sourceDir, "better_sqlite3.node"), "binary-data");

		const appUnpacked = join(tmpDir, "app.asar.unpacked");
		const targetDir = join(appUnpacked, "node_modules", "better-sqlite3", "build", "Release");
		mkdirSync(targetDir, { recursive: true });

		installNativeModule("better-sqlite3", sourceDir, appUnpacked, "143");

		expect(existsSync(join(targetDir, "better_sqlite3.node"))).toBe(true);
	});

	it("installs node-pty binaries to multiple locations", () => {
		const sourceDir = join(tmpDir, "source");
		mkdirSync(sourceDir, { recursive: true });
		writeFileSync(join(sourceDir, "pty.node"), "pty-binary");
		writeFileSync(join(sourceDir, "spawn-helper"), "helper-binary");

		const appUnpacked = join(tmpDir, "app.asar.unpacked");
		const releaseDir = join(appUnpacked, "node_modules", "node-pty", "build", "Release");
		mkdirSync(releaseDir, { recursive: true });

		installNativeModule("node-pty", sourceDir, appUnpacked, "143");

		// Check Release dir
		expect(existsSync(join(releaseDir, "pty.node"))).toBe(true);
		expect(existsSync(join(releaseDir, "spawn-helper"))).toBe(true);

		// Check x64 bin dir
		const x64BinDir = join(appUnpacked, "node_modules", "node-pty", "bin", "darwin-x64-143");
		expect(existsSync(join(x64BinDir, "node-pty.node"))).toBe(true);

		// Check arm64 fallback dir
		const arm64BinDir = join(appUnpacked, "node_modules", "node-pty", "bin", "darwin-arm64-143");
		expect(existsSync(join(arm64BinDir, "node-pty.node"))).toBe(true);
	});

	it("skips when source file is missing", () => {
		const sourceDir = join(tmpDir, "empty-source");
		mkdirSync(sourceDir, { recursive: true });

		const appUnpacked = join(tmpDir, "app.asar.unpacked");
		const targetDir = join(appUnpacked, "node_modules", "better-sqlite3", "build", "Release");
		mkdirSync(targetDir, { recursive: true });

		// Should not throw
		installNativeModule("better-sqlite3", sourceDir, appUnpacked, "143");
		expect(existsSync(join(targetDir, "better_sqlite3.node"))).toBe(false);
	});
});

describe("disableSparkle", () => {
	let tmpDir: string;
	const log = vi.fn();

	beforeEach(() => {
		tmpDir = join(tmpdir(), `cvm-sparkle-test-${Date.now()}`);
		mkdirSync(tmpDir, { recursive: true });
		log.mockClear();
	});

	afterEach(() => {
		if (existsSync(tmpDir)) {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("removes sparkle.node from Resources/native", () => {
		const outApp = join(tmpDir, "Test.app");
		const sparklePath = join(outApp, "Contents", "Resources", "native");
		mkdirSync(sparklePath, { recursive: true });
		writeFileSync(join(sparklePath, "sparkle.node"), "data");

		disableSparkle(outApp, log);

		expect(existsSync(join(sparklePath, "sparkle.node"))).toBe(false);
		expect(log).toHaveBeenCalled();
	});

	it("removes sparkle.node from app.asar.unpacked/native", () => {
		const outApp = join(tmpDir, "Test.app");
		const sparklePath = join(outApp, "Contents", "Resources", "app.asar.unpacked", "native");
		mkdirSync(sparklePath, { recursive: true });
		writeFileSync(join(sparklePath, "sparkle.node"), "data");

		disableSparkle(outApp, log);

		expect(existsSync(join(sparklePath, "sparkle.node"))).toBe(false);
	});

	it("is a no-op when sparkle.node does not exist", () => {
		const outApp = join(tmpDir, "Test.app");
		mkdirSync(join(outApp, "Contents", "Resources"), { recursive: true });

		disableSparkle(outApp, log);

		// Should not throw
		expect(log).toHaveBeenCalledWith("Removing sparkle.node artifacts");
	});
});

describe("fixInfoPlist", () => {
	let tmpDir: string;
	const log = vi.fn();

	beforeEach(() => {
		tmpDir = join(tmpdir(), `cvm-plist-test-${Date.now()}`);
		mkdirSync(tmpDir, { recursive: true });
		log.mockClear();
	});

	afterEach(() => {
		if (existsSync(tmpDir)) {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("sets CFBundleExecutable to Electron", () => {
		const plistPath = join(tmpDir, "Info.plist");
		const original = {
			CFBundleExecutable: "Codex",
			CFBundleName: "Codex",
		};
		writeFileSync(plistPath, plist.build(original as plist.PlistValue));

		fixInfoPlist(plistPath, log);

		const data = readFileSync(plistPath, "utf-8");
		const result = plist.parse(data) as Record<string, unknown>;
		expect(result.CFBundleExecutable).toBe("Electron");
	});

	it("sets ELECTRON_RENDERER_URL in LSEnvironment", () => {
		const plistPath = join(tmpDir, "Info.plist");
		const original = {
			CFBundleExecutable: "Codex",
		};
		writeFileSync(plistPath, plist.build(original as plist.PlistValue));

		fixInfoPlist(plistPath, log);

		const data = readFileSync(plistPath, "utf-8");
		const result = plist.parse(data) as Record<string, unknown>;
		const lsEnv = result.LSEnvironment as Record<string, string>;
		expect(lsEnv.ELECTRON_RENDERER_URL).toBe("app://-/index.html");
	});

	it("preserves existing LSEnvironment entries", () => {
		const plistPath = join(tmpDir, "Info.plist");
		const original = {
			CFBundleExecutable: "Codex",
			LSEnvironment: { EXISTING_VAR: "value" },
		};
		writeFileSync(plistPath, plist.build(original as plist.PlistValue));

		fixInfoPlist(plistPath, log);

		const data = readFileSync(plistPath, "utf-8");
		const result = plist.parse(data) as Record<string, unknown>;
		const lsEnv = result.LSEnvironment as Record<string, string>;
		expect(lsEnv.EXISTING_VAR).toBe("value");
		expect(lsEnv.ELECTRON_RENDERER_URL).toBe("app://-/index.html");
	});
});

describe("replaceBundledCliWithWrapper", () => {
	let tmpDir: string;
	const log = vi.fn();

	beforeEach(() => {
		tmpDir = join(tmpdir(), `cvm-wrapper-test-${Date.now()}`);
		mkdirSync(tmpDir, { recursive: true });
		log.mockClear();
	});

	afterEach(() => {
		if (existsSync(tmpDir)) {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("replaces existing codex binary with shell wrapper", () => {
		const outApp = join(tmpDir, "Test.app");
		const codexPath = join(outApp, "Contents", "Resources", "codex");
		mkdirSync(join(outApp, "Contents", "Resources"), { recursive: true });
		writeFileSync(codexPath, "original-binary");

		replaceBundledCliWithWrapper(outApp, log);

		const content = readFileSync(codexPath, "utf-8");
		expect(content).toContain("#!/usr/bin/env bash");
		expect(content).toContain("resolve_codex");
	});

	it("is a no-op when codex binary does not exist", () => {
		const outApp = join(tmpDir, "Test.app");
		mkdirSync(join(outApp, "Contents", "Resources"), { recursive: true });

		replaceBundledCliWithWrapper(outApp, log);

		expect(log).not.toHaveBeenCalled();
	});
});
