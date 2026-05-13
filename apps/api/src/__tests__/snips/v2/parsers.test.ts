import {
  ALLOW_TEST_SUITE_WEBSITE,
  describeIf,
  TEST_SUITE_WEBSITE,
} from "../lib";
import { scrape, scrapeRaw, scrapeTimeout, idmux, Identity } from "./lib";

let identity: Identity;

beforeAll(async () => {
  identity = await idmux({
    name: "parsers",
    concurrency: 100,
    credits: 1000000,
  });
}, 10000 + scrapeTimeout);

describeIf(ALLOW_TEST_SUITE_WEBSITE)("Parsers parameter tests", () => {
  const pdfUrl = `${TEST_SUITE_WEBSITE}/example.pdf`;
  const htmlUrl = TEST_SUITE_WEBSITE;

  describe("Array format", () => {
    it.concurrent(
      "accepts parsers: ['pdf'] and parses PDF",
      async () => {
        const response = await scrape(
          {
            url: pdfUrl,
            parsers: ["pdf"],
          },
          identity,
        );

        expect(response.markdown).toBeDefined();
        expect(response.markdown).toContain("PDF Test File");
        expect(response.metadata.numPages).toBeGreaterThan(0);
      },
      scrapeTimeout * 2,
    );

    it.concurrent(
      "accepts parsers: [] and returns PDF in base64",
      async () => {
        const response = await scrape(
          {
            url: pdfUrl,
            parsers: [],
          },
          identity,
        );

        expect(response.markdown).toBeDefined();
        expect(response.markdown).toContain("JVBER"); // base64
      },
      scrapeTimeout * 2,
    );

    it.concurrent(
      "accepts parsers: ['pdf'] on HTML pages (no effect)",
      async () => {
        const response = await scrape(
          {
            url: htmlUrl,
            parsers: ["pdf"],
          },
          identity,
        );

        expect(response.markdown).toBeDefined();
        expect(response.markdown).toContain("Firecrawl");
      },
      scrapeTimeout,
    );

    it.concurrent(
      "accepts empty parsers array on HTML pages",
      async () => {
        const response = await scrape(
          {
            url: htmlUrl,
            parsers: [],
          },
          identity,
        );

        expect(response.markdown).toBeDefined();
        expect(response.markdown).toContain("Firecrawl");
      },
      scrapeTimeout,
    );
  });

  describe("Object format", () => {
    it.concurrent(
      "accepts parsers: [{type: 'pdf'}] and parses PDF",
      async () => {
        const response = await scrape(
          {
            url: pdfUrl,
            parsers: [{ type: "pdf" }],
          },
          identity,
        );

        expect(response.markdown).toBeDefined();
        expect(response.markdown).toContain("PDF Test File");
        expect(response.metadata.numPages).toBeGreaterThan(0);
      },
      scrapeTimeout * 2,
    );

    it.concurrent(
      "accepts parsers: [{type: 'pdf', maxPages: 1}] and limits pages",
      async () => {
        const response = await scrape(
          {
            url: pdfUrl,
            parsers: [{ type: "pdf", maxPages: 1 }],
          },
          identity,
        );

        expect(response.markdown).toBeDefined();
        expect(response.markdown).toContain("PDF Test File");
        expect(response.metadata.numPages).toBe(1);
      },
      scrapeTimeout * 2,
    );

    it.concurrent(
      "handles maxPages larger than actual pages",
      async () => {
        const response = await scrape(
          {
            url: pdfUrl,
            parsers: [{ type: "pdf", maxPages: 10000 }],
          },
          identity,
        );

        expect(response.markdown).toBeDefined();
        expect(response.markdown).toContain("PDF Test File");
        expect(response.metadata.numPages).toBeGreaterThan(0);
        expect(response.metadata.numPages).toBeLessThan(10000);
      },
      scrapeTimeout * 2,
    );
  });

  describe("Mode - object format", () => {
    it.concurrent(
      "accepts mode: 'fast' and parses PDF with Rust parser",
      async () => {
        const response = await scrape(
          {
            url: pdfUrl,
            parsers: [{ type: "pdf", mode: "fast" }],
          },
          identity,
        );

        expect(response.markdown).toBeDefined();
        expect(response.markdown).toContain("PDF Test File");
        expect(response.metadata.numPages).toBeGreaterThan(0);
      },
      scrapeTimeout * 2,
    );

    it.concurrent(
      "accepts mode: 'auto' and parses PDF",
      async () => {
        const response = await scrape(
          {
            url: pdfUrl,
            parsers: [{ type: "pdf", mode: "auto" }],
          },
          identity,
        );

        expect(response.markdown).toBeDefined();
        expect(response.markdown).toContain("PDF Test File");
        expect(response.metadata.numPages).toBeGreaterThan(0);
      },
      scrapeTimeout * 2,
    );

    it.concurrent(
      "accepts mode: 'ocr' and parses PDF via OCR",
      async () => {
        const response = await scrape(
          {
            url: pdfUrl,
            parsers: [{ type: "pdf", mode: "ocr" }],
          },
          identity,
        );

        expect(response.markdown).toBeDefined();
        expect(response.markdown).toContain("PDF Test File");
        expect(response.metadata.numPages).toBeGreaterThan(0);
      },
      scrapeTimeout * 2,
    );

    it.concurrent(
      "accepts mode with maxPages combined",
      async () => {
        const response = await scrape(
          {
            url: pdfUrl,
            parsers: [{ type: "pdf", mode: "fast", maxPages: 1 }],
          },
          identity,
        );

        expect(response.markdown).toBeDefined();
        expect(response.markdown).toContain("PDF Test File");
        expect(response.metadata.numPages).toBe(1);
      },
      scrapeTimeout * 2,
    );
  });

  // The async path silently falls back to sync /ocr on any error (404,
  // 503, network, terminal failure, …), so this test verifies the
  // user-visible contract: flag=true produces an identically-shaped
  // response to the existing sync path. Whether the request actually
  // traversed /jobs vs. /ocr depends on staging — both outcomes
  // satisfy the acceptance criteria.
  describe("__experimental_firePdfAsync (opt-in async fire-pdf)", () => {
    it.concurrent(
      "with mode 'ocr' returns markdown identical-shape to sync",
      async () => {
        const response = await scrape(
          {
            url: pdfUrl,
            parsers: [{ type: "pdf", mode: "ocr" }],
            __experimental_firePdfAsync: true,
          },
          identity,
        );

        expect(response.markdown).toBeDefined();
        expect(response.markdown).toContain("PDF Test File");
        expect(response.metadata.numPages).toBeGreaterThan(0);
      },
      scrapeTimeout * 2,
    );
  });

  describe("Default behavior", () => {
    it.concurrent(
      "parses PDF by default when parsers not specified",
      async () => {
        const response = await scrape(
          {
            url: pdfUrl,
          },
          identity,
        );

        expect(response.markdown).toBeDefined();
        expect(response.markdown).toContain("PDF Test File");
        expect(response.metadata.numPages).toBeGreaterThan(0);
      },
      scrapeTimeout * 2,
    );
  });

  describe("Invalid inputs", () => {
    it.concurrent(
      "rejects invalid parser types",
      async () => {
        const raw = await scrapeRaw(
          {
            url: pdfUrl,
            parsers: ["invalid-parser" as any],
          },
          identity,
        );

        expect(raw.statusCode).toBe(400);
        expect(raw.body.success).toBe(false);
        expect(raw.body.error).toBe("Bad Request");
      },
      scrapeTimeout,
    );

    it.concurrent(
      "rejects non-array parsers",
      async () => {
        const raw = await scrapeRaw(
          {
            url: pdfUrl,
            parsers: "pdf" as any,
          },
          identity,
        );

        expect(raw.statusCode).toBe(400);
        expect(raw.body.success).toBe(false);
        expect(raw.body.error).toBe("Bad Request");
      },
      scrapeTimeout,
    );

    it.concurrent(
      "rejects old object format",
      async () => {
        const raw = await scrapeRaw(
          {
            url: pdfUrl,
            parsers: { pdf: true } as any,
          },
          identity,
        );

        expect(raw.statusCode).toBe(400);
        expect(raw.body.success).toBe(false);
        expect(raw.body.error).toBe("Bad Request");
      },
      scrapeTimeout,
    );

    it.concurrent(
      "rejects negative maxPages",
      async () => {
        const raw = await scrapeRaw(
          {
            url: pdfUrl,
            parsers: [{ type: "pdf", maxPages: -1 }],
          },
          identity,
        );

        expect(raw.statusCode).toBe(400);
        expect(raw.body.success).toBe(false);
        expect(raw.body.error).toBe("Bad Request");
      },
      scrapeTimeout,
    );

    it.concurrent(
      "rejects maxPages over limit",
      async () => {
        const raw = await scrapeRaw(
          {
            url: pdfUrl,
            parsers: [{ type: "pdf", maxPages: 10001 }],
          },
          identity,
        );

        expect(raw.statusCode).toBe(400);
        expect(raw.body.success).toBe(false);
        expect(raw.body.error).toBe("Bad Request");
      },
      scrapeTimeout,
    );

    it.concurrent(
      "rejects invalid mode in object format",
      async () => {
        const raw = await scrapeRaw(
          {
            url: pdfUrl,
            parsers: [{ type: "pdf", mode: "invalid" } as any],
          },
          identity,
        );

        expect(raw.statusCode).toBe(400);
        expect(raw.body.success).toBe(false);
        expect(raw.body.error).toBe("Bad Request");
      },
      scrapeTimeout,
    );

    it.concurrent(
      "rejects colon-separated shorthand strings",
      async () => {
        const raw = await scrapeRaw(
          {
            url: pdfUrl,
            parsers: ["pdf:fast" as any],
          },
          identity,
        );

        expect(raw.statusCode).toBe(400);
        expect(raw.body.success).toBe(false);
        expect(raw.body.error).toBe("Bad Request");
      },
      scrapeTimeout,
    );
  });

  describe("Billing implications", () => {
    it.concurrent(
      "bills correctly with parsers: ['pdf']",
      async () => {
        const response = await scrape(
          {
            url: pdfUrl,
            parsers: ["pdf"],
          },
          identity,
        );

        // Should bill based on number of pages when PDF parsing is enabled
        expect(response.metadata.creditsUsed).toBeGreaterThanOrEqual(
          response.metadata.numPages || 1,
        );
      },
      scrapeTimeout * 2,
    );

    it.concurrent(
      "bills flat rate with parsers: []",
      async () => {
        const response = await scrape(
          {
            url: pdfUrl,
            parsers: [],
          },
          identity,
        );

        // Should bill flat rate (1 credit) when PDF parsing is disabled
        expect(response.metadata.creditsUsed).toBe(1);
      },
      scrapeTimeout * 2,
    );

    it.concurrent(
      "bills based on limited pages with maxPages",
      async () => {
        const response = await scrape(
          {
            url: pdfUrl,
            parsers: [{ type: "pdf", maxPages: 1 }],
          },
          identity,
        );

        // Should bill based on limited pages (1 page = 1 credit)
        expect(response.metadata.creditsUsed).toBe(1);
        expect(response.metadata.numPages).toBe(1);
      },
      scrapeTimeout * 2,
    );
  });
});
