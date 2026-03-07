import type { Command } from "commander";
import { fetchVersions, formatSize } from "../lib/appcast.js";

export function registerListCommand(program: Command): void {
	program
		.command("list")
		.description("List available Codex versions from the update feed")
		.action(async () => {
			const items = await fetchVersions();

			if (items.length === 0) {
				console.log("No versions found.");
				return;
			}

			// Calculate column widths
			const rows = items.map((item) => ({
				version: item.version,
				build: item.build,
				date: formatDate(item.date),
				size: formatSize(item.size),
			}));

			const cols = {
				version: Math.max(7, ...rows.map((r) => r.version.length)),
				build: Math.max(5, ...rows.map((r) => r.build.length)),
				date: Math.max(4, ...rows.map((r) => r.date.length)),
				size: Math.max(4, ...rows.map((r) => r.size.length)),
			};

			const header = [
				"VERSION".padEnd(cols.version),
				"BUILD".padEnd(cols.build),
				"DATE".padEnd(cols.date),
				"SIZE".padEnd(cols.size),
			].join("  ");

			const separator = [
				"-".repeat(cols.version),
				"-".repeat(cols.build),
				"-".repeat(cols.date),
				"-".repeat(cols.size),
			].join("  ");

			console.log(header);
			console.log(separator);

			for (const row of rows) {
				console.log(
					[
						row.version.padEnd(cols.version),
						row.build.padEnd(cols.build),
						row.date.padEnd(cols.date),
						row.size.padEnd(cols.size),
					].join("  "),
				);
			}
		});
}

function formatDate(raw: string): string {
	const d = new Date(raw);
	if (Number.isNaN(d.getTime())) return raw;
	return d.toISOString().slice(0, 10);
}
