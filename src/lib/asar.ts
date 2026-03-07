import { closeSync, openSync, readFileSync, readSync } from "node:fs";

/**
 * Asar format (Chromium pickle-based):
 *   [0..3]   uint32 LE - first pickle payload size (always 4)
 *   [4..7]   uint32 LE - second pickle total size (header + padding)
 *   [8..11]  uint32 LE - second pickle payload size
 *   [12..15] uint32 LE - JSON string length
 *   [16..]   JSON header string
 *   [headerEnd..] concatenated file contents
 *
 * File offsets in the JSON tree are relative to headerEnd.
 */

interface AsarNode {
	files?: Record<string, AsarNode>;
	offset?: string;
	size?: number;
	unpacked?: boolean;
	integrity?: unknown;
}

interface AsarHeader {
	tree: AsarNode;
	headerEnd: number;
	fd: number;
}

function openAsar(asarPath: string): AsarHeader {
	const fd = openSync(asarPath, "r");

	const prefix = Buffer.alloc(8);
	readSync(fd, prefix, 0, 8, 0);

	const headerPickleSize = prefix.readUInt32LE(4);
	const headerEnd = 8 + headerPickleSize;

	const jsonSize = headerPickleSize - 8;
	const jsonBuf = Buffer.alloc(jsonSize);
	readSync(fd, jsonBuf, 0, jsonSize, 16);

	const tree: AsarNode = JSON.parse(jsonBuf.toString("utf-8").replace(/\0+$/, ""));

	return { tree, headerEnd, fd };
}

function navigateTo(tree: AsarNode, filePath: string): AsarNode | null {
	const parts = filePath.split("/").filter(Boolean);
	let node: AsarNode | undefined = tree;
	for (const part of parts) {
		node = node?.files?.[part];
		if (!node) return null;
	}
	return node;
}

function readNode(header: AsarHeader, node: AsarNode, asarPath: string, filePath: string): Buffer {
	if (node.unpacked) {
		const unpackedPath = `${asarPath}.unpacked/${filePath}`;
		return readFileSync(unpackedPath);
	}

	const offset = Number(node.offset);
	const size = Number(node.size);
	const buf = Buffer.alloc(size);
	readSync(header.fd, buf, 0, size, header.headerEnd + offset);
	return buf;
}

/**
 * Read a single file from an asar archive without extracting the whole thing.
 */
export function readFileFromAsar(asarPath: string, targetFile: string): Buffer {
	const header = openAsar(asarPath);
	try {
		const node = navigateTo(header.tree, targetFile);
		if (!node) {
			throw new Error(`File "${targetFile}" not found in asar archive`);
		}
		return readNode(header, node, asarPath, targetFile);
	} finally {
		closeSync(header.fd);
	}
}

export interface NativeModule {
	name: string;
	version: string | null;
	binaries: string[];
}

/**
 * Scan the asar's node_modules for packages that contain native .node binaries.
 * Also checks top-level directories (e.g. native/) for .node files.
 */
export function listNativeModules(asarPath: string): NativeModule[] {
	const header = openAsar(asarPath);
	try {
		const modules: NativeModule[] = [];

		// Check node_modules/
		const nodeModules = header.tree.files?.node_modules;
		if (nodeModules?.files) {
			for (const [name, modNode] of Object.entries(nodeModules.files)) {
				const nodeFiles = findNodeFiles(modNode, `node_modules/${name}`);
				if (nodeFiles.length === 0) continue;

				// Read package.json for version
				let version = "unknown";
				const pkgNode = navigateTo(modNode, "package.json");
				if (pkgNode?.size) {
					try {
						const buf = readNode(header, pkgNode, asarPath, `node_modules/${name}/package.json`);
						const pkg = JSON.parse(buf.toString("utf-8"));
						version = pkg.version || "unknown";
					} catch {
						// skip
					}
				}

				modules.push({ name, version, binaries: nodeFiles });
			}
		}

		// Check top-level directories for .node files (e.g. native/sparkle.node)
		for (const [dirName, dirNode] of Object.entries(header.tree.files || {})) {
			if (dirName === "node_modules") continue;
			const nodeFiles = findNodeFiles(dirNode, dirName);
			for (const filePath of nodeFiles) {
				modules.push({
					name: filePath,
					version: null,
					binaries: [filePath],
				});
			}
		}

		return modules;
	} finally {
		closeSync(header.fd);
	}
}

/**
 * Recursively find all .node file paths under a tree node.
 */
function findNodeFiles(node: AsarNode, prefix: string): string[] {
	const results: string[] = [];

	if (!node.files) {
		// Leaf node - check if it's a .node file
		if (prefix.endsWith(".node")) {
			results.push(prefix);
		}
		return results;
	}

	for (const [name, child] of Object.entries(node.files)) {
		results.push(...findNodeFiles(child, `${prefix}/${name}`));
	}

	return results;
}
