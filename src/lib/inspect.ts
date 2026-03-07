import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import plist from "plist";
import { listNativeModules, readFileFromAsar } from "./asar.js";
import type { NativeModule } from "./asar.js";

export type { NativeModule };

export interface AppInfo {
	name: string;
	bundleId: string;
	version: string;
	build: string;
	architectures: string[];
	minSystemVersion: string;
	feedUrl: string | null;
	sparklePublicKey: string | null;
	isElectron: boolean;
	nativeModules: NativeModule[];
}

export async function inspectApp(path: string): Promise<AppInfo> {
	if (path.endsWith(".dmg")) {
		return inspectDmg(path);
	}
	if (path.endsWith(".app")) {
		return inspectAppBundle(path);
	}
	throw new Error(`Unsupported file type: ${basename(path)}. Provide a .app or .dmg path.`);
}

async function inspectDmg(dmgPath: string): Promise<AppInfo> {
	const mountPoint = mkdtempSync(join(tmpdir(), "cvm-"));

	try {
		execSync(
			`hdiutil attach ${JSON.stringify(dmgPath)} -nobrowse -readonly -mountpoint ${JSON.stringify(mountPoint)}`,
			{ stdio: "pipe" },
		);

		// Find the .app inside
		const entries = readdirSync(mountPoint);
		const appName = entries.find((e) => e.endsWith(".app"));
		if (!appName) {
			throw new Error("No .app bundle found in DMG");
		}

		return await inspectAppBundle(join(mountPoint, appName));
	} finally {
		try {
			execSync(`hdiutil detach ${JSON.stringify(mountPoint)} -quiet`, {
				stdio: "pipe",
			});
		} catch {
			// Best effort unmount
		}
		try {
			rmSync(mountPoint, { recursive: true, force: true });
		} catch {
			// Best effort cleanup
		}
	}
}

async function inspectAppBundle(appPath: string): Promise<AppInfo> {
	const plistPath = join(appPath, "Contents", "Info.plist");
	if (!existsSync(plistPath)) {
		throw new Error(`Info.plist not found at ${plistPath}`);
	}

	const plistData = readFileSync(plistPath, "utf-8");
	const info = plist.parse(plistData) as Record<string, unknown>;

	const executableName = (info.CFBundleExecutable as string) || basename(appPath, ".app");

	// Detect architecture
	const architectures = detectArchitectures(join(appPath, "Contents", "MacOS", executableName));

	// Check for Electron asar
	const asarPath = join(appPath, "Contents", "Resources", "app.asar");
	const isElectron = existsSync(asarPath);

	// Try to find feed URL from multiple sources
	let feedUrl = (info.SUFeedURL as string) || null;
	let nativeModules: NativeModule[] = [];

	if (isElectron) {
		try {
			const pkgBuf = readFileFromAsar(asarPath, "package.json");
			const asarMeta = JSON.parse(pkgBuf.toString("utf-8"));

			if (!feedUrl) {
				feedUrl = findFeedUrl(asarMeta);
			}
		} catch {
			// asar reading failed, continue without it
		}

		try {
			nativeModules = listNativeModules(asarPath);
		} catch {
			// native module scan failed, continue without it
		}
	}

	return {
		name:
			(info.CFBundleDisplayName as string) ||
			(info.CFBundleName as string) ||
			basename(appPath, ".app"),
		bundleId: (info.CFBundleIdentifier as string) || "",
		version: (info.CFBundleShortVersionString as string) || "",
		build: String(info.CFBundleVersion ?? ""),
		architectures,
		minSystemVersion: (info.LSMinimumSystemVersion as string) || "",
		feedUrl,
		sparklePublicKey: (info.SUPublicEDKey as string) || null,
		isElectron,
		nativeModules,
	};
}

function detectArchitectures(binaryPath: string): string[] {
	if (!existsSync(binaryPath)) {
		return ["unknown"];
	}

	try {
		const output = execSync(`file ${JSON.stringify(binaryPath)}`, {
			encoding: "utf-8",
		});

		const archs: string[] = [];
		if (output.includes("arm64")) archs.push("arm64");
		if (output.includes("x86_64")) archs.push("x86_64");
		if (archs.length === 0) archs.push("unknown");
		return archs;
	} catch {
		return ["unknown"];
	}
}

/**
 * Search an object for keys that look like they contain a feed/appcast URL.
 */
function findFeedUrl(obj: Record<string, unknown>): string | null {
	const feedKeyPatterns = [/feed.*url/i, /appcast/i, /update.*url/i, /sparkle.*url/i];

	for (const [key, value] of Object.entries(obj)) {
		if (typeof value !== "string") continue;
		for (const pattern of feedKeyPatterns) {
			if (pattern.test(key) && value.startsWith("http")) {
				return value;
			}
		}
	}

	return null;
}
