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
		.option("--dry-run", "Show what would happen without repacking")
		.action(
			async (
				input: string,
				output: string,
				options: {
					sign: boolean;
					cache: boolean;
					dmg: boolean;
					keepSparkle: boolean;
					dryRun?: boolean;
				},
			) => {
				if (options.dryRun) {
					console.log(
						`[dry-run] Would repack ${input} to ${output} as a ${options.dmg ? "DMG" : "bare app"}${options.keepSparkle ? " with Sparkle preserved" : ""}.`,
					);
					return;
				}

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
