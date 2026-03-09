#!/usr/bin/env node

import { run } from "./cli.js";
import { getErrorMessage, getExitCode } from "./lib/errors.js";

run().catch((error: unknown) => {
	console.error(getErrorMessage(error));
	process.exitCode = getExitCode(error);
});
