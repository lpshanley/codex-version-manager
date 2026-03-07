import type { Command } from "commander";
import { inspectApp } from "../lib/inspect.js";

export function registerInspectCommand(program: Command): void {
	program
		.command("inspect")
		.description("Extract metadata from a .app bundle or .dmg")
		.argument("<path>", "Path to a .app bundle or .dmg file")
		.action(async (path: string) => {
			const info = await inspectApp(path);

			const rows: [string, string][] = [
				["Name", info.name],
				["Bundle ID", info.bundleId],
				["Version", info.version],
				["Build", info.build],
				["Architecture", info.architectures.join(", ")],
				["Min macOS", info.minSystemVersion || "n/a"],
				["Electron", info.isElectron ? "yes" : "no"],
				["Feed URL", info.feedUrl || "not found"],
				["Sparkle Key", info.sparklePublicKey || "not found"],
			];

			const labelWidth = Math.max(...rows.map(([label]) => label.length));

			for (const [label, value] of rows) {
				console.log(`${(`${label}:`).padEnd(labelWidth + 2)}${value}`);
			}

			if (info.nativeModules.length > 0) {
				console.log();
				console.log("Native Modules:");

				const nameWidth = Math.max(4, ...info.nativeModules.map((m) => m.name.length));
				const versionWidth = Math.max(
					7,
					...info.nativeModules.map((m) => (m.version || "").length),
				);

				console.log(`  ${"NAME".padEnd(nameWidth)}  ${"VERSION".padEnd(versionWidth)}  BINARIES`);
				console.log(`  ${"-".repeat(nameWidth)}  ${"-".repeat(versionWidth)}  --------`);

				for (const mod of info.nativeModules) {
					const ver = mod.version ?? "-";
					console.log(
						`  ${mod.name.padEnd(nameWidth)}  ${ver.padEnd(versionWidth)}  ${mod.binaries.length} .node file${mod.binaries.length !== 1 ? "s" : ""}`,
					);
				}
			}
		});
}
