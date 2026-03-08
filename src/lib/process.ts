import { run } from "./shell.js";

/**
 * Check if a macOS application is currently running.
 */
export function isAppRunning(appName: string): boolean {
	try {
		run(`pgrep -x ${JSON.stringify(appName)}`, { stdio: "pipe" });
		return true;
	} catch {
		return false;
	}
}

/**
 * Gracefully quit a macOS application via AppleScript.
 * Falls back to SIGTERM, then SIGKILL after the timeout.
 */
export async function quitApp(appName: string, timeoutMs = 10_000): Promise<void> {
	if (!isAppRunning(appName)) return;

	try {
		run(`osascript -e 'tell application ${JSON.stringify(appName)} to quit'`, { stdio: "pipe" });
	} catch {
		try {
			run(`pkill -x ${JSON.stringify(appName)}`, { stdio: "pipe" });
		} catch {
			return;
		}
	}

	// Wait for process to exit
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		if (!isAppRunning(appName)) return;
		await new Promise((r) => setTimeout(r, 500));
	}

	// Force kill as last resort
	try {
		run(`pkill -9 -x ${JSON.stringify(appName)}`, { stdio: "pipe" });
	} catch {
		// already dead
	}
}

/**
 * Open a macOS application by path.
 */
export function openApp(appPath: string): void {
	run(`open ${JSON.stringify(appPath)}`, { stdio: "pipe" });
}
