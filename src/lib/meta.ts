import { readFileSync } from "node:fs";

interface PackageMeta {
	version?: string;
}

let cachedPackageMeta: PackageMeta | null = null;

function readPackageMeta(): PackageMeta {
	if (cachedPackageMeta) {
		return cachedPackageMeta;
	}

	const packageJson = readFileSync(new URL("../../package.json", import.meta.url), "utf-8");
	cachedPackageMeta = JSON.parse(packageJson) as PackageMeta;
	return cachedPackageMeta;
}

export function getCliVersion(): string {
	return readPackageMeta().version ?? "0.0.0";
}
