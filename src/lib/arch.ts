import { arch } from "node:os";

export function needsRepack(): boolean {
	return arch() === "x64";
}

export function currentArch(): string {
	return arch() === "arm64" ? "arm64 (Apple Silicon)" : "x64 (Intel)";
}
