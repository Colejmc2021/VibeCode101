import { NextResponse } from "next/server";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText } from "ai";

export const runtime = "nodejs";

type QueryRequest = {
  action?: "Summarize Health" | "Check Orders" | "Query Docs" | null;
  query?: string;
  model?: string;
};

function resolveModelCandidates(modelLabel: string | undefined): string[] {
  const defaultLabel = "🟣 Gemini 3.5 (Salesforce Default)";
  const chosen = modelLabel ?? defaultLabel;

  if (chosen === "🟣 Gemini 3.5 (Salesforce Default)") {
    return ["gemini-3.5-flash", "gemini-3.1-pro-preview", "gemini-2.5-pro"];
  }
  if (chosen === "🟢 GPT-4o (BYOLLM)") {
    return ["gemini-3.1-pro-preview", "gemini-3-flash-preview", "gemini-2.5-pro"];
  }
  return ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash"];
}

function mockMarkdown(action: QueryRequest["action"], query: string): { markdown: string; records: number } {
  if (action === "Summarize Health") {
    return {
      records: 13,
      markdown: `## Salesforce Org Health Snapshot

- **Data ingestion pipelines:** 12/13 healthy (1 delayed)
- **MCP tool latency p95:** 423ms
- **Identity resolution freshness:** 8 minutes
- **Open high-priority cases:** 3

### Suggested next action
Route delayed ingestion alerts to the data engineering queue and trigger retry workflow for connector \`orders-stream\`.`,
    };
  }

  if (action === "Check Orders") {
    return {
      records: 42,
      markdown: `## Orders Overview

| Metric | Value |
| --- | --- |
| Open Orders | 42 |
| Fulfilled (24h) | 317 |
| At Risk | 5 |

### Notable exceptions
1. **Order #A-10429** stalled at payment verification.
2. **Order #A-10471** waiting on warehouse sync.`,
    };
  }

  if (action === "Query Docs") {
    return {
      records: 7,
      markdown: `## Documentation Query Result

### Topic
\`How does Data Cloud profile unification work?\`

Unified profiles are generated through identity resolution rulesets that map source entities (email, phone, and customer IDs) into a canonical individual record. Matching confidence and reconciliation policy determine merge behavior across sources.`,
    };
  }

  return {
    records: 1,
    markdown: `## Overview

Salesforce profile context is unavailable in this environment. Configure live credentials to generate grounded account-specific insights.`,
  };
}

async function fetchSalesforceProfileContext(): Promise<string> {
  const accessToken = process.env.SALESFORCE_ACCESS_TOKEN;
  const rawInstanceUrl = process.env.SALESFORCE_INSTANCE_URL;
  const contactId = process.env.SALESFORCE_CONTACT_ID;
  const apiVersion = process.env.SALESFORCE_API_VERSION ?? "v64.0";
  const instanceUrl = rawInstanceUrl?.replace(".lightning.force.com", ".my.salesforce.com");

  if (!accessToken || !instanceUrl) {
    return "No live Salesforce context available.";
  }

  const soql = contactId
    ? `SELECT Name, Account.Name FROM Contact WHERE Id = '${contactId}' LIMIT 1`
    : "SELECT Name, Account.Name FROM Contact WHERE Name != null ORDER BY LastModifiedDate DESC LIMIT 1";
  const queryUrl = new URL(`/services/data/${apiVersion}/query`, instanceUrl);
  queryUrl.searchParams.set("q", soql);

  const response = await fetch(queryUrl, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    return "Live Salesforce query failed.";
  }

  const payload = (await response.json()) as {
    records?: Array<{ Name?: string; Account?: { Name?: string } }>;
  };
  const record = payload.records?.[0];
  const contactName = record?.Name ?? "Unknown Contact";
  const accountName = record?.Account?.Name ?? "No Account";
  return `Contact: ${contactName}\nAccount: ${accountName}\nTier: Live`;
}

async function generateLlmOverview(query: string, modelLabel?: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "your_actual_api_key_here") {
    return "## Overview\n\nModel key is not configured. Add `GEMINI_API_KEY` to generate AI overviews.";
  }

  const google = createGoogleGenerativeAI({ apiKey });
  const salesforceContext = await fetchSalesforceProfileContext();
  const envPreferred = process.env.GEMINI_OVERVIEW_MODEL;
  const modelCandidates = envPreferred
    ? [envPreferred, ...resolveModelCandidates(modelLabel).filter((m) => m !== envPreferred)]
    : resolveModelCandidates(modelLabel);

  let lastError = "Unknown model error";
  for (const modelId of modelCandidates) {
    try {
      const { text } = await generateText({
        model: google(modelId),
        system: `You are a Salesforce account assistant.
Generate a concise markdown overview grounded in this context:
${salesforceContext}
Never include the raw user query in the output.`,
        prompt: query,
      });
      if (text.trim().length > 0) {
        return text;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Unknown model error";
    }
  }

  throw new Error(lastError);
}

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json()) as QueryRequest;
  const query = body.query?.trim() || "No query provided.";
  const endpoint = process.env.SALESFORCE_PORTAL_ENDPOINT;
  const apiKey = process.env.SALESFORCE_PORTAL_API_KEY;

  if (!endpoint) {
    if (!body.action) {
      let llmMarkdown = "";
      try {
        llmMarkdown = await generateLlmOverview(query, body.model);
      } catch (error) {
        const detail = error instanceof Error ? error.message : "Unknown model error";
        llmMarkdown =
          `## Overview unavailable\n\nAI overview generation failed: ${detail}\n\nUpdate your model API key and retry.`;
      }
      return NextResponse.json({
        transport: "llm",
        markdown: llmMarkdown,
        rpcResult: {
          action: "AI Overview",
          records: 1,
        },
      });
    }

    const mocked = mockMarkdown(body.action ?? null, query);
    return NextResponse.json({
      transport: "mock",
      markdown: mocked.markdown,
      rpcResult: {
        action: body.action ?? "Custom Query",
        records: mocked.records,
      },
    });
  }

  try {
    const upstream = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        action: body.action ?? null,
        query,
        model: body.model ?? "unknown",
      }),
    });

    const upstreamPayload = (await upstream.json()) as {
      markdown?: string;
      rpcResult?: Record<string, unknown>;
      error?: string;
    };

    if (!upstream.ok || !upstreamPayload.markdown) {
      return NextResponse.json(
        {
          error: upstreamPayload.error ?? "Salesforce endpoint returned an invalid response.",
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      transport: "live",
      markdown: upstreamPayload.markdown,
      rpcResult: upstreamPayload.rpcResult ?? { action: body.action ?? "Custom Query", records: 0 },
    });
  } catch {
    return NextResponse.json(
      {
        error: "Unable to reach Salesforce endpoint. Check SALESFORCE_PORTAL_ENDPOINT and auth.",
      },
      { status: 502 },
    );
  }
}
