import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listNativeModules, readFileFromAsar } from "./asar.js";

/**
 * Build a minimal asar archive in memory.
 *
 * Asar format:
 *   [0..3]   uint32 LE  - pickle header size (always 4)
 *   [4..7]   uint32 LE  - pickle payload size (header json + alignment)
 *   [8..11]  uint32 LE  - pickle header (repeated payload size minus 4? actually inner payload)
 *   [12..15] uint32 LE  - json string length
 *   [16..]   JSON header
 *   [headerEnd..] file data
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

	// Pad json to 4-byte alignment
	const padding = (4 - (jsonBuf.length % 4)) % 4;
	const paddedJsonLen = jsonBuf.length + padding;

	// Pickle header:
	// [0..3]: first pickle size = 4 (always)
	// [4..7]: second pickle total size = 8 + paddedJsonLen
	// [8..11]: second pickle payload = 4 + paddedJsonLen
	// [12..15]: json string length = jsonBuf.length
	const header = Buffer.alloc(16 + paddedJsonLen);
	header.writeUInt32LE(4, 0);
	header.writeUInt32LE(8 + paddedJsonLen, 4);
	header.writeUInt32LE(4 + paddedJsonLen, 8);
	header.writeUInt32LE(jsonBuf.length, 12);
	jsonBuf.copy(header, 16);

	return Buffer.concat([header, ...dataChunks]);
}

describe("readFileFromAsar", () => {
	const tmpDir = join(tmpdir(), `cvm-asar-test-${Date.now()}`);
	const asarPath = join(tmpDir, "test.asar");

	it("reads a file from a minimal asar archive", () => {
		mkdirSync(tmpDir, { recursive: true });
		const asar = buildAsar({
			"package.json": JSON.stringify({ name: "test", version: "1.0.0" }),
			"index.js": 'console.log("hello")',
		});
		writeFileSync(asarPath, asar);

		const buf = readFileFromAsar(asarPath, "package.json");
		const pkg = JSON.parse(buf.toString("utf-8"));
		expect(pkg.name).toBe("test");
		expect(pkg.version).toBe("1.0.0");

		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("reads nested files", () => {
		mkdirSync(tmpDir, { recursive: true });
		const asar = buildAsar({
			"node_modules/foo/package.json": JSON.stringify({ name: "foo", version: "2.0.0" }),
		});
		writeFileSync(asarPath, asar);

		const buf = readFileFromAsar(asarPath, "node_modules/foo/package.json");
		const pkg = JSON.parse(buf.toString("utf-8"));
		expect(pkg.name).toBe("foo");

		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("throws for missing file", () => {
		mkdirSync(tmpDir, { recursive: true });
		const asar = buildAsar({ "a.txt": "hello" });
		writeFileSync(asarPath, asar);

		expect(() => readFileFromAsar(asarPath, "missing.txt")).toThrow("not found");

		rmSync(tmpDir, { recursive: true, force: true });
	});
});

describe("readFileFromAsar - unpacked files", () => {
	it("reads from .unpacked directory when node is marked unpacked", () => {
		const dir = join(tmpdir(), `cvm-asar-unpacked-test-${Date.now()}`);
		mkdirSync(dir, { recursive: true });
		const asarPath = join(dir, "test.asar");

		// Build an asar where a file is marked as unpacked
		const tree = {
			files: {
				"data.txt": {
					offset: "0",
					size: 5,
					unpacked: true,
				},
			},
		};
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
		writeFileSync(asarPath, header);

		// Create the .unpacked directory with the file
		const unpackedDir = join(dir, "test.asar.unpacked");
		mkdirSync(unpackedDir, { recursive: true });
		writeFileSync(join(unpackedDir, "data.txt"), "hello");

		const buf = readFileFromAsar(asarPath, "data.txt");
		expect(buf.toString("utf-8")).toBe("hello");

		rmSync(dir, { recursive: true, force: true });
	});
});

describe("listNativeModules", () => {
	it("detects .node files in top-level directories", () => {
		const dir = join(tmpdir(), `cvm-asar-toplevel-test-${Date.now()}`);
		mkdirSync(dir, { recursive: true });
		const asarPath = join(dir, "test.asar");

		const asar = buildAsar({
			"native/sparkle.node": "binary-data",
			"package.json": JSON.stringify({ name: "test" }),
		});
		writeFileSync(asarPath, asar);

		const modules = listNativeModules(asarPath);
		const sparkle = modules.find((m) => m.binaries.some((b) => b.includes("sparkle.node")));
		expect(sparkle).toBeDefined();
		expect(sparkle?.version).toBeNull();

		rmSync(dir, { recursive: true, force: true });
	});

	it("returns empty when no native modules exist", () => {
		const dir = join(tmpdir(), `cvm-asar-no-native-test-${Date.now()}`);
		mkdirSync(dir, { recursive: true });
		const asarPath = join(dir, "test.asar");

		const asar = buildAsar({
			"package.json": JSON.stringify({ name: "test" }),
			"index.js": "module.exports = {}",
		});
		writeFileSync(asarPath, asar);

		const modules = listNativeModules(asarPath);
		expect(modules).toEqual([]);

		rmSync(dir, { recursive: true, force: true });
	});

	it("detects .node files in node_modules", () => {
		const tmpDir = join(tmpdir(), `cvm-asar-native-test-${Date.now()}`);
		mkdirSync(tmpDir, { recursive: true });
		const asarPath = join(tmpDir, "test.asar");

		const asar = buildAsar({
			"node_modules/better-sqlite3/package.json": JSON.stringify({
				name: "better-sqlite3",
				version: "12.0.0",
			}),
			"node_modules/better-sqlite3/build/Release/better_sqlite3.node": "binary-data",
		});
		writeFileSync(asarPath, asar);

		const modules = listNativeModules(asarPath);
		expect(modules.length).toBeGreaterThanOrEqual(1);

		const bs3 = modules.find((m) => m.name === "better-sqlite3");
		expect(bs3).toBeDefined();
		expect(bs3?.version).toBe("12.0.0");
		expect(bs3?.binaries.length).toBe(1);

		rmSync(tmpDir, { recursive: true, force: true });
	});
});
