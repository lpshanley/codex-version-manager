#!/usr/bin/env node

import { program } from "commander";
import { registerCacheCommand } from "./commands/cache.js";
import { registerDownloadCommand } from "./commands/download.js";
import { registerInspectCommand } from "./commands/inspect.js";
import { registerInstallCommand } from "./commands/install.js";
import { registerListCommand } from "./commands/list.js";
import { registerRepackCommand } from "./commands/repack.js";
import { registerUpdateCommand } from "./commands/update.js";

program
	.name("cvm")
	.description("Codex Version Manager — install, downgrade, and manage OpenAI Codex app versions")
	.version("0.1.0");

registerListCommand(program);
registerInspectCommand(program);
registerDownloadCommand(program);
registerRepackCommand(program);
registerInstallCommand(program);
registerUpdateCommand(program);
registerCacheCommand(program);

program.parse();
