export class CliError extends Error {
	readonly exitCode: number;

	constructor(message: string, exitCode = 1, options?: ErrorOptions) {
		super(message, options);
		this.name = "CliError";
		this.exitCode = exitCode;
	}
}

export function getErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}

	return String(error);
}

export function getExitCode(error: unknown): number {
	return error instanceof CliError ? error.exitCode : 1;
}
