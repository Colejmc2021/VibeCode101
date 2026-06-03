import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { Pinecone } from "@pinecone-database/pinecone";

type FirecrawlPage = {
  url?: string;
  markdown?: string;
  title?: string;
  metadata?: Record<string, unknown>;
};

type NormalizedChunk = {
  id: string;
  sourceUrl: string;
  title: string;
  chunkIndex: number;
  text: string;
};

const TARGET_URL = "https://www.permaseal.com";
const OUTPUT_DIR = ".firecrawl";
const CRAWL_OUTPUT_PATH = `${OUTPUT_DIR}/permaseal-crawl.json`;
const NORMALIZED_OUTPUT_PATH = `${OUTPUT_DIR}/permaseal-normalized.json`;
const EMBED_MODEL = "text-embedding-004";

function chunkText(text: string, size = 1200, overlap = 200): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];

  const chunks: string[] = [];
  let offset = 0;
  while (offset < normalized.length) {
    const end = Math.min(offset + size, normalized.length);
    chunks.push(normalized.slice(offset, end));
    if (end >= normalized.length) break;
    offset = Math.max(0, end - overlap);
  }
  return chunks;
}

function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", shell: false });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Command failed (${command} ${args.join(" ")}) with code ${code}`));
    });
  });
}

function buildId(url: string, chunkIndex: number): string {
  const base = url.replace(/^https?:\/\//, "").replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase();
  return `${base}-${chunkIndex}`.slice(0, 128);
}

async function embedText(text: string, geminiApiKey: string): Promise<number[]> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent?key=${geminiApiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: {
          parts: [{ text }],
        },
      }),
    },
  );

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Gemini embedding failed (${response.status}): ${errorBody}`);
  }

  const payload = (await response.json()) as {
    embedding?: { values?: number[] };
  };

  const values = payload.embedding?.values;
  if (!values || !Array.isArray(values)) {
    throw new Error("Gemini embedding response missing embedding values.");
  }

  return values;
}

function extractPages(raw: unknown): FirecrawlPage[] {
  if (!raw || typeof raw !== "object") return [];
  const root = raw as Record<string, unknown>;
  const data = root.data;
  if (!Array.isArray(data)) return [];
  return data as FirecrawlPage[];
}

async function main(): Promise<void> {
  const pineconeApiKey = process.env.PINECONE_API_KEY;
  const pineconeIndex = process.env.PINECONE_INDEX;
  const geminiApiKey = process.env.GEMINI_API_KEY;
  const namespace = process.env.PINECONE_NAMESPACE ?? "permaseal";

  if (!pineconeApiKey || !pineconeIndex || !geminiApiKey) {
    throw new Error(
      "Missing required env vars: PINECONE_API_KEY, PINECONE_INDEX, and GEMINI_API_KEY must all be set.",
    );
  }

  await mkdir(OUTPUT_DIR, { recursive: true });

  console.log("1) Crawling permaseal website with Firecrawl...");
  await runCommand("firecrawl", [
    "crawl",
    TARGET_URL,
    "--wait",
    "--limit",
    "50",
    "--max-depth",
    "3",
    "--scrape-formats",
    "markdown",
    "--output",
    CRAWL_OUTPUT_PATH,
    "--json",
  ]);

  const crawlRaw = JSON.parse(await readFile(CRAWL_OUTPUT_PATH, "utf8")) as unknown;
  const pages = extractPages(crawlRaw);
  if (pages.length === 0) {
    throw new Error("Crawl completed but returned no pages.");
  }

  console.log(`2) Normalizing ${pages.length} pages into chunks...`);
  const normalized: NormalizedChunk[] = [];
  for (const page of pages) {
    const sourceUrl = page.url ?? "unknown-url";
    const title = page.title ?? "Untitled";
    const chunks = chunkText(page.markdown ?? "");
    chunks.forEach((text, chunkIndex) => {
      normalized.push({
        id: buildId(sourceUrl, chunkIndex),
        sourceUrl,
        title,
        chunkIndex,
        text,
      });
    });
  }

  await writeFile(NORMALIZED_OUTPUT_PATH, JSON.stringify(normalized, null, 2), "utf8");
  console.log(`   Wrote normalized chunks to ${NORMALIZED_OUTPUT_PATH} (${normalized.length} chunks)`);

  console.log("3) Embedding + upserting chunks into Pinecone...");
  const pinecone = new Pinecone({ apiKey: pineconeApiKey });
  const index = pinecone.index(pineconeIndex).namespace(namespace);

  const batchSize = 20;
  for (let i = 0; i < normalized.length; i += batchSize) {
    const batch = normalized.slice(i, i + batchSize);
    const vectors = await Promise.all(
      batch.map(async (item) => {
        const values = await embedText(item.text, geminiApiKey);
        return {
          id: item.id,
          values,
          metadata: {
            sourceUrl: item.sourceUrl,
            title: item.title,
            chunkIndex: item.chunkIndex,
            text: item.text.slice(0, 3000),
          },
        };
      }),
    );
    await index.upsert({ records: vectors });
    console.log(`   Upserted ${Math.min(i + batchSize, normalized.length)} / ${normalized.length}`);
  }

  console.log("Done. Pinecone ingestion complete.");
}

main().catch((error) => {
  console.error("Ingestion failed:", error);
  process.exitCode = 1;
});
