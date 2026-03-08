import { execSync, spawn } from "node:child_process";
import type { ExecSyncOptions, SpawnOptions } from "node:child_process";
import { CliError, getErrorMessage } from "./errors.js";

interface RunCommandOptions extends ExecSyncOptions {
	cwd?: string;
	encoding?: BufferEncoding;
}

function formatCommandError(command: string, error: unknown): CliError {
	if (error instanceof Error && "stderr" in error) {
		const stderr = error.stderr;
		const output =
			typeof stderr === "string"
				? stderr.trim()
				: Buffer.isBuffer(stderr)
					? stderr.toString("utf-8").trim()
					: "";

		if (output) {
			return new CliError(`Command failed: ${command}\n${output}`, 1, { cause: error });
		}
	}

	return new CliError(`Command failed: ${command}\n${getErrorMessage(error)}`, 1, { cause: error });
}

export function run(command: string, options: RunCommandOptions = {}): void {
	try {
		execSync(command, options);
	} catch (error) {
		throw formatCommandError(command, error);
	}
}

export function runOutput(command: string, options: RunCommandOptions = {}): string {
	try {
		return execSync(command, { ...options, encoding: "utf-8" }).trim();
	} catch (error) {
		throw formatCommandError(command, error);
	}
}

export async function runProcess(
	command: string,
	args: string[],
	options: SpawnOptions = {},
): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const proc = spawn(command, args, options);
		let stderr = "";

		if (proc.stderr) {
			proc.stderr.on("data", (chunk: Buffer | string) => {
				stderr += chunk.toString();
			});
		}

		proc.on("close", (code) => {
			if (code === 0) {
				resolve();
				return;
			}

			const details = stderr.trim();
			reject(
				new CliError(
					details
						? `Command failed: ${command} ${args.join(" ")}\n${details}`
						: `Command failed: ${command} ${args.join(" ")} (exit ${code ?? "unknown"})`,
				),
			);
		});
		proc.on("error", (error) => {
			reject(new CliError(`Command failed: ${command} ${args.join(" ")}\n${error.message}`));
		});
	});
}
