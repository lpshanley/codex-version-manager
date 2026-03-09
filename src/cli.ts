import { Command } from "commander";
import { registerCacheCommand } from "./commands/cache.js";
import { registerDownloadCommand } from "./commands/download.js";
import { registerInspectCommand } from "./commands/inspect.js";
import { registerInstallCommand } from "./commands/install.js";
import { registerListCommand } from "./commands/list.js";
import { registerRepackCommand } from "./commands/repack.js";
import { registerUpdateCommand } from "./commands/update.js";
import { getCliVersion } from "./lib/meta.js";

export function buildProgram(): Command {
	const program = new Command();

	program
		.name("cvm")
		.description("Codex Version Manager — install, downgrade, and manage OpenAI Codex app versions")
		.version(getCliVersion());

	registerListCommand(program);
	registerInspectCommand(program);
	registerDownloadCommand(program);
	registerRepackCommand(program);
	registerInstallCommand(program);
	registerUpdateCommand(program);
	registerCacheCommand(program);

	return program;
}

export async function run(argv = process.argv): Promise<void> {
	const program = buildProgram();
	await program.parseAsync(argv);
}
