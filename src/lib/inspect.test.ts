import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import plist from "plist";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { inspectApp } from "./inspect.js";

/**
 * Build a minimal asar archive in memory (same helper as asar.test.ts).
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

describe("inspectApp", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = join(tmpdir(), `cvm-inspect-test-${Date.now()}`);
		mkdirSync(tmpDir, { recursive: true });
	});

	afterEach(() => {
		if (existsSync(tmpDir)) {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("throws for unsupported file types", async () => {
		await expect(inspectApp("/some/file.zip")).rejects.toThrow("Unsupported file type");
	});

	it("throws for unsupported extensions", async () => {
		await expect(inspectApp("/some/file.pkg")).rejects.toThrow("Unsupported file type");
	});

	it("throws when Info.plist is missing", async () => {
		const appPath = join(tmpDir, "Test.app");
		mkdirSync(join(appPath, "Contents"), { recursive: true });

		await expect(inspectApp(appPath)).rejects.toThrow("Info.plist not found");
	});

	it("inspects a minimal non-Electron .app bundle", async () => {
		const appPath = join(tmpDir, "MyApp.app");
		const contentsDir = join(appPath, "Contents");
		const macosDir = join(contentsDir, "MacOS");
		const resourcesDir = join(contentsDir, "Resources");

		mkdirSync(macosDir, { recursive: true });
		mkdirSync(resourcesDir, { recursive: true });

		// Write Info.plist
		const plistData = {
			CFBundleDisplayName: "My App",
			CFBundleIdentifier: "com.test.myapp",
			CFBundleShortVersionString: "2.0.0",
			CFBundleVersion: "200",
			CFBundleExecutable: "MyApp",
			LSMinimumSystemVersion: "13.0",
		};
		writeFileSync(join(contentsDir, "Info.plist"), plist.build(plistData as plist.PlistValue));

		// Write a dummy binary (won't be recognized as arm64/x86_64)
		writeFileSync(join(macosDir, "MyApp"), "not-a-real-binary");

		const info = await inspectApp(appPath);

		expect(info.name).toBe("My App");
		expect(info.bundleId).toBe("com.test.myapp");
		expect(info.version).toBe("2.0.0");
		expect(info.build).toBe("200");
		expect(info.minSystemVersion).toBe("13.0");
		expect(info.isElectron).toBe(false);
		expect(info.architectures).toEqual(["unknown"]);
		expect(info.feedUrl).toBeNull();
		expect(info.sparklePublicKey).toBeNull();
		expect(info.nativeModules).toEqual([]);
	});

	it("detects Electron apps with asar and extracts feed URL", async () => {
		const appPath = join(tmpDir, "Codex.app");
		const contentsDir = join(appPath, "Contents");
		const macosDir = join(contentsDir, "MacOS");
		const resourcesDir = join(contentsDir, "Resources");

		mkdirSync(macosDir, { recursive: true });
		mkdirSync(resourcesDir, { recursive: true });

		const plistData = {
			CFBundleName: "Codex",
			CFBundleIdentifier: "com.openai.codex",
			CFBundleShortVersionString: "1.0.0",
			CFBundleVersion: "100",
			CFBundleExecutable: "Codex",
			SUPublicEDKey: "test-public-key",
		};
		writeFileSync(join(contentsDir, "Info.plist"), plist.build(plistData as plist.PlistValue));
		writeFileSync(join(macosDir, "Codex"), "dummy");

		// Create a minimal asar with package.json containing a feed URL
		const asar = buildAsar({
			"package.json": JSON.stringify({
				name: "codex",
				version: "1.0.0",
				appcastFeedUrl: "https://example.com/appcast.xml",
			}),
		});
		writeFileSync(join(resourcesDir, "app.asar"), asar);

		const info = await inspectApp(appPath);

		expect(info.isElectron).toBe(true);
		expect(info.name).toBe("Codex");
		expect(info.sparklePublicKey).toBe("test-public-key");
	});

	it("uses SUFeedURL from Info.plist when present", async () => {
		const appPath = join(tmpDir, "FeedApp.app");
		const contentsDir = join(appPath, "Contents");
		const macosDir = join(contentsDir, "MacOS");
		const resourcesDir = join(contentsDir, "Resources");

		mkdirSync(macosDir, { recursive: true });
		mkdirSync(resourcesDir, { recursive: true });

		const plistData = {
			CFBundleName: "FeedApp",
			CFBundleIdentifier: "com.test.feedapp",
			CFBundleShortVersionString: "1.0.0",
			CFBundleVersion: "1",
			CFBundleExecutable: "FeedApp",
			SUFeedURL: "https://example.com/feed.xml",
		};
		writeFileSync(join(contentsDir, "Info.plist"), plist.build(plistData as plist.PlistValue));
		writeFileSync(join(macosDir, "FeedApp"), "dummy");

		const info = await inspectApp(appPath);

		expect(info.feedUrl).toBe("https://example.com/feed.xml");
	});

	it("falls back to CFBundleName when CFBundleDisplayName is absent", async () => {
		const appPath = join(tmpDir, "Fallback.app");
		const contentsDir = join(appPath, "Contents");
		const macosDir = join(contentsDir, "MacOS");
		const resourcesDir = join(contentsDir, "Resources");

		mkdirSync(macosDir, { recursive: true });
		mkdirSync(resourcesDir, { recursive: true });

		const plistData = {
			CFBundleName: "FallbackName",
			CFBundleIdentifier: "com.test.fallback",
			CFBundleShortVersionString: "1.0.0",
			CFBundleVersion: "1",
			CFBundleExecutable: "Fallback",
		};
		writeFileSync(join(contentsDir, "Info.plist"), plist.build(plistData as plist.PlistValue));
		writeFileSync(join(macosDir, "Fallback"), "dummy");

		const info = await inspectApp(appPath);
		expect(info.name).toBe("FallbackName");
	});

	it("falls back to directory name when no bundle name fields exist", async () => {
		const appPath = join(tmpDir, "DirName.app");
		const contentsDir = join(appPath, "Contents");
		const macosDir = join(contentsDir, "MacOS");
		const resourcesDir = join(contentsDir, "Resources");

		mkdirSync(macosDir, { recursive: true });
		mkdirSync(resourcesDir, { recursive: true });

		const plistData = {
			CFBundleIdentifier: "com.test.dirname",
			CFBundleShortVersionString: "1.0.0",
			CFBundleVersion: "1",
			CFBundleExecutable: "DirName",
		};
		writeFileSync(join(contentsDir, "Info.plist"), plist.build(plistData as plist.PlistValue));
		writeFileSync(join(macosDir, "DirName"), "dummy");

		const info = await inspectApp(appPath);
		expect(info.name).toBe("DirName");
	});

	it("detects architectures when binary is missing", async () => {
		const appPath = join(tmpDir, "NoBinary.app");
		const contentsDir = join(appPath, "Contents");
		const macosDir = join(contentsDir, "MacOS");

		mkdirSync(macosDir, { recursive: true });

		const plistData = {
			CFBundleName: "NoBinary",
			CFBundleIdentifier: "com.test.nobinary",
			CFBundleShortVersionString: "1.0.0",
			CFBundleVersion: "1",
			CFBundleExecutable: "MissingExecutable",
		};
		writeFileSync(join(contentsDir, "Info.plist"), plist.build(plistData as plist.PlistValue));

		const info = await inspectApp(appPath);
		expect(info.architectures).toEqual(["unknown"]);
	});

	it("uses basename as executable when CFBundleExecutable is missing", async () => {
		const appPath = join(tmpDir, "NoExec.app");
		const contentsDir = join(appPath, "Contents");
		const macosDir = join(contentsDir, "MacOS");

		mkdirSync(macosDir, { recursive: true });

		const plistData = {
			CFBundleName: "NoExec",
			CFBundleIdentifier: "com.test.noexec",
			CFBundleShortVersionString: "1.0.0",
			CFBundleVersion: "1",
		};
		writeFileSync(join(contentsDir, "Info.plist"), plist.build(plistData as plist.PlistValue));

		const info = await inspectApp(appPath);
		// Should use "NoExec" (basename minus .app) as executable name
		expect(info.architectures).toEqual(["unknown"]);
	});

	it("handles Electron app with native modules in asar", async () => {
		const appPath = join(tmpDir, "WithNative.app");
		const contentsDir = join(appPath, "Contents");
		const macosDir = join(contentsDir, "MacOS");
		const resourcesDir = join(contentsDir, "Resources");

		mkdirSync(macosDir, { recursive: true });
		mkdirSync(resourcesDir, { recursive: true });

		const plistData = {
			CFBundleName: "WithNative",
			CFBundleIdentifier: "com.test.native",
			CFBundleShortVersionString: "1.0.0",
			CFBundleVersion: "1",
			CFBundleExecutable: "WithNative",
		};
		writeFileSync(join(contentsDir, "Info.plist"), plist.build(plistData as plist.PlistValue));
		writeFileSync(join(macosDir, "WithNative"), "dummy");

		// Create asar with a native module
		const asar = buildAsar({
			"package.json": JSON.stringify({ name: "test-app", version: "1.0.0" }),
			"node_modules/better-sqlite3/package.json": JSON.stringify({
				name: "better-sqlite3",
				version: "12.0.0",
			}),
			"node_modules/better-sqlite3/build/Release/better_sqlite3.node": "binary",
		});
		writeFileSync(join(resourcesDir, "app.asar"), asar);

		const info = await inspectApp(appPath);

		expect(info.isElectron).toBe(true);
		expect(info.nativeModules.length).toBeGreaterThanOrEqual(1);
		const bs3 = info.nativeModules.find((m) => m.name === "better-sqlite3");
		expect(bs3).toBeDefined();
		expect(bs3?.version).toBe("12.0.0");
	});

	it("handles corrupt asar gracefully (continues without feed URL)", async () => {
		const appPath = join(tmpDir, "CorruptAsar.app");
		const contentsDir = join(appPath, "Contents");
		const macosDir = join(contentsDir, "MacOS");
		const resourcesDir = join(contentsDir, "Resources");

		mkdirSync(macosDir, { recursive: true });
		mkdirSync(resourcesDir, { recursive: true });

		const plistData = {
			CFBundleName: "CorruptAsar",
			CFBundleIdentifier: "com.test.corrupt",
			CFBundleShortVersionString: "1.0.0",
			CFBundleVersion: "1",
			CFBundleExecutable: "CorruptAsar",
		};
		writeFileSync(join(contentsDir, "Info.plist"), plist.build(plistData as plist.PlistValue));
		writeFileSync(join(macosDir, "CorruptAsar"), "dummy");

		// Write invalid asar data
		writeFileSync(join(resourcesDir, "app.asar"), "not-a-valid-asar");

		const info = await inspectApp(appPath);

		expect(info.isElectron).toBe(true);
		expect(info.feedUrl).toBeNull();
		expect(info.nativeModules).toEqual([]);
	});

	it("handles missing version/build fields gracefully", async () => {
		const appPath = join(tmpDir, "Minimal.app");
		const contentsDir = join(appPath, "Contents");
		const macosDir = join(contentsDir, "MacOS");

		mkdirSync(macosDir, { recursive: true });

		// Minimal plist with almost no fields
		const plistData = {
			CFBundleExecutable: "Minimal",
		};
		writeFileSync(join(contentsDir, "Info.plist"), plist.build(plistData as plist.PlistValue));
		writeFileSync(join(macosDir, "Minimal"), "dummy");

		const info = await inspectApp(appPath);

		expect(info.bundleId).toBe("");
		expect(info.version).toBe("");
		expect(info.build).toBe("");
		expect(info.minSystemVersion).toBe("");
	});
});
