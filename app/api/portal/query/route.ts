import { NextResponse } from "next/server";

export const runtime = "nodejs";

type QueryRequest = {
  action?: "Summarize Health" | "Check Orders" | "Query Docs" | null;
  query?: string;
  model?: string;
};

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
    markdown: `## Custom Query Result

**Query:** ${query}

This is a mock response from the customer portal backend. Configure a live Salesforce endpoint to return real MCP-backed data.`,
  };
}

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json()) as QueryRequest;
  const query = body.query?.trim() || "No query provided.";
  const endpoint = process.env.SALESFORCE_PORTAL_ENDPOINT;
  const apiKey = process.env.SALESFORCE_PORTAL_API_KEY;

  if (!endpoint) {
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
