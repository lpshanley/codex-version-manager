import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchVersions, formatSize, parseAppcast } from "./appcast.js";

const SAMPLE_XML = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <title>Codex</title>
    <item>
      <title>Version 26.305.950</title>
      <sparkle:shortVersionString>26.305.950</sparkle:shortVersionString>
      <sparkle:version>1050</sparkle:version>
      <pubDate>Fri, 28 Feb 2025 00:00:00 +0000</pubDate>
      <sparkle:minimumSystemVersion>13.0</sparkle:minimumSystemVersion>
      <enclosure url="https://example.com/Codex-26.305.950.zip" length="123456789" type="application/octet-stream" sparkle:edSignature="abc123"/>
    </item>
    <item>
      <title>Version 25.200.800</title>
      <sparkle:shortVersionString>25.200.800</sparkle:shortVersionString>
      <sparkle:version>1040</sparkle:version>
      <pubDate>Mon, 10 Feb 2025 00:00:00 +0000</pubDate>
      <sparkle:minimumSystemVersion>13.0</sparkle:minimumSystemVersion>
      <enclosure url="https://example.com/Codex-25.200.800.zip" length="100000000" type="application/octet-stream" sparkle:edSignature="def456"/>
    </item>
  </channel>
</rss>`;

describe("parseAppcast", () => {
	it("parses multiple items from appcast XML", () => {
		const items = parseAppcast(SAMPLE_XML);
		expect(items).toHaveLength(2);
	});

	it("extracts version from sparkle:shortVersionString", () => {
		const items = parseAppcast(SAMPLE_XML);
		expect(items[0].version).toBe("26.305.950");
		expect(items[1].version).toBe("25.200.800");
	});

	it("extracts build number from sparkle:version", () => {
		const items = parseAppcast(SAMPLE_XML);
		expect(items[0].build).toBe("1050");
		expect(items[1].build).toBe("1040");
	});

	it("extracts download URL and size from enclosure", () => {
		const items = parseAppcast(SAMPLE_XML);
		expect(items[0].url).toBe("https://example.com/Codex-26.305.950.zip");
		expect(items[0].size).toBe(123456789);
	});

	it("extracts minimum OS version", () => {
		const items = parseAppcast(SAMPLE_XML);
		expect(items[0].minOS).toBe("13");
	});

	it("returns empty array for empty XML", () => {
		const items = parseAppcast("<rss><channel></channel></rss>");
		expect(items).toEqual([]);
	});

	it("handles single item (non-array)", () => {
		const xml = `<?xml version="1.0"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <item>
      <sparkle:shortVersionString>1.0.0</sparkle:shortVersionString>
      <sparkle:version>100</sparkle:version>
      <pubDate>Mon, 01 Jan 2025 00:00:00 +0000</pubDate>
      <sparkle:minimumSystemVersion>13.0</sparkle:minimumSystemVersion>
      <enclosure url="https://example.com/app.zip" length="50000000"/>
    </item>
  </channel>
</rss>`;
		const items = parseAppcast(xml);
		expect(items).toHaveLength(1);
		expect(items[0].version).toBe("1.0.0");
	});
});

describe("fetchVersions", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("fetches and parses appcast from URL", async () => {
		const xml = `<?xml version="1.0"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <item>
      <sparkle:shortVersionString>1.0.0</sparkle:shortVersionString>
      <sparkle:version>100</sparkle:version>
      <pubDate>Mon, 01 Jan 2025 00:00:00 +0000</pubDate>
      <sparkle:minimumSystemVersion>13.0</sparkle:minimumSystemVersion>
      <enclosure url="https://example.com/app.zip" length="50000000"/>
    </item>
  </channel>
</rss>`;

		vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(xml, { status: 200 }));

		const items = await fetchVersions("https://example.com/appcast.xml");
		expect(items).toHaveLength(1);
		expect(items[0].version).toBe("1.0.0");
	});

	it("throws on non-OK response", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response("Not Found", { status: 404, statusText: "Not Found" }),
		);

		await expect(fetchVersions("https://example.com/missing")).rejects.toThrow(
			"Failed to fetch appcast: 404 Not Found",
		);
	});
});

describe("formatSize", () => {
	it("formats bytes", () => {
		expect(formatSize(500)).toBe("500 B");
	});

	it("formats kilobytes", () => {
		expect(formatSize(1500)).toBe("1.5 KB");
	});

	it("formats megabytes", () => {
		expect(formatSize(150_000_000)).toBe("150.0 MB");
	});

	it("formats gigabytes", () => {
		expect(formatSize(2_500_000_000)).toBe("2.5 GB");
	});
});
