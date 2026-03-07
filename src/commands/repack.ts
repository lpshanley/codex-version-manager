import type { Command } from "commander";
import { repackApp } from "../lib/repack.js";

export function registerRepackCommand(program: Command): void {
	program
		.command("repack")
		.description("Repackage a Codex .app or .dmg for Intel (x86_64)")
		.argument("<input>", "Path to source .app bundle or .dmg")
		.argument("[output]", "Output .dmg or .app path", "CodexIntel.dmg")
		.option("--no-sign", "Skip ad-hoc code signing")
		.option("--no-cache", "Force rebuild everything (ignore cache)")
		.option("--no-dmg", "Output bare .app instead of DMG")
		.option("--keep-sparkle", "Keep Sparkle auto-update (advanced)", false)
		.action(
			async (
				input: string,
				output: string,
				options: { sign: boolean; cache: boolean; dmg: boolean; keepSparkle: boolean },
			) => {
				await repackApp({
					input,
					output,
					sign: options.sign,
					cache: options.cache,
					keepSparkle: options.keepSparkle,
					createDmg: options.dmg,
				});
			},
		);
}
