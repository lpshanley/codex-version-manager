import { XMLParser } from "fast-xml-parser";

export const APPCAST_URL = "https://persistent.oaistatic.com/codex-app-prod/appcast.xml";

export interface AppcastItem {
	version: string;
	build: string;
	date: string;
	size: number;
	url: string;
	minOS: string;
}

export async function fetchVersions(url: string = APPCAST_URL): Promise<AppcastItem[]> {
	const resp = await fetch(url, {
		signal: AbortSignal.timeout(10_000),
	});

	if (!resp.ok) {
		throw new Error(`Failed to fetch appcast: ${resp.status} ${resp.statusText}`);
	}

	const xml = await resp.text();
	return parseAppcast(xml);
}

export function parseAppcast(xml: string): AppcastItem[] {
	const parser = new XMLParser({
		ignoreAttributes: false,
		attributeNamePrefix: "@_",
	});

	const parsed = parser.parse(xml);
	const channel = parsed?.rss?.channel;
	if (!channel) {
		return [];
	}

	// Normalize to array (single item comes as object)
	const rawItems = Array.isArray(channel.item) ? channel.item : channel.item ? [channel.item] : [];

	return rawItems.map((item: Record<string, unknown>): AppcastItem => {
		const enclosure = item.enclosure as Record<string, unknown> | undefined;

		return {
			version: (item["sparkle:shortVersionString"] as string) || (item.title as string) || "",
			build: String(item["sparkle:version"] ?? ""),
			date: (item.pubDate as string) || "",
			size: Number(enclosure?.["@_length"] ?? 0),
			url: (enclosure?.["@_url"] as string) || "",
			minOS: String(item["sparkle:minimumSystemVersion"] ?? ""),
		};
	});
}

export function resolveVersion(items: AppcastItem[], version: string): AppcastItem {
	if (version === "latest") {
		return items[0];
	}

	const match = items.find((i) => i.version === version || i.build === version);

	if (!match) {
		const available = items.map((i) => i.version).join(", ");
		throw new Error(`Version "${version}" not found. Available: ${available}`);
	}

	return match;
}

export function formatSize(bytes: number): string {
	if (bytes >= 1_000_000_000) {
		return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
	}
	if (bytes >= 1_000_000) {
		return `${(bytes / 1_000_000).toFixed(1)} MB`;
	}
	if (bytes >= 1_000) {
		return `${(bytes / 1_000).toFixed(1)} KB`;
	}
	return `${bytes} B`;
}
