import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText } from "ai";

export const runtime = "nodejs";

type QueryRequest = {
  action?: "Summarize Health" | "Check Orders" | "Query Docs" | null;
  query?: string;
  model?: string;
  customerName?: string;
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

function escapeSoqlLiteral(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

type SalesforceTokenRefreshResponse = {
  access_token?: string;
  instance_url?: string;
  error?: string;
  error_description?: string;
};

async function fetchSalesforceProfileContext(customerName?: string): Promise<string> {
  const cookieStore = await cookies();
  let accessToken = cookieStore.get("sf_access_token")?.value ?? process.env.SALESFORCE_ACCESS_TOKEN;
  let rawInstanceUrl = cookieStore.get("sf_instance_url")?.value ?? process.env.SALESFORCE_INSTANCE_URL;
  const refreshToken = cookieStore.get("sf_refresh_token")?.value ?? process.env.SALESFORCE_REFRESH_TOKEN;
  const clientId = process.env.SALESFORCE_CLIENT_ID;
  const clientSecret = process.env.SALESFORCE_CLIENT_SECRET;
  const loginUrl = process.env.SALESFORCE_LOGIN_URL ?? "https://login.salesforce.com";
  const contactId = process.env.SALESFORCE_CONTACT_ID;
  const apiVersion = process.env.SALESFORCE_API_VERSION ?? "v64.0";
  let instanceUrl = rawInstanceUrl?.replace(".lightning.force.com", ".my.salesforce.com");

  async function fetchClientCredentialsToken(): Promise<boolean> {
    if (!clientId || !clientSecret) {
      return false;
    }
    const tokenUrl = new URL("/services/oauth2/token", loginUrl);
    const tokenResponse = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
      }),
      cache: "no-store",
    });
    const tokenPayload = (await tokenResponse.json()) as SalesforceTokenRefreshResponse;
    if (!tokenResponse.ok || !tokenPayload.access_token) {
      return false;
    }
    accessToken = tokenPayload.access_token;
    rawInstanceUrl = tokenPayload.instance_url ?? rawInstanceUrl;
    instanceUrl = rawInstanceUrl?.replace(".lightning.force.com", ".my.salesforce.com");
    return true;
  }

  async function refreshAccessToken(): Promise<boolean> {
    if (!refreshToken || !clientId || !clientSecret) {
      return false;
    }
    const tokenUrl = new URL("/services/oauth2/token", loginUrl);
    const tokenResponse = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }),
      cache: "no-store",
    });
    const tokenPayload = (await tokenResponse.json()) as SalesforceTokenRefreshResponse;
    if (!tokenResponse.ok || !tokenPayload.access_token) {
      return false;
    }
    accessToken = tokenPayload.access_token;
    rawInstanceUrl = tokenPayload.instance_url ?? rawInstanceUrl;
    instanceUrl = rawInstanceUrl?.replace(".lightning.force.com", ".my.salesforce.com");
    return true;
  }

  if (!accessToken || !instanceUrl) {
    const refreshed = await refreshAccessToken();
    const clientCredsToken = refreshed ? true : await fetchClientCredentialsToken();
    if ((!refreshed && !clientCredsToken) || !accessToken || !instanceUrl) {
      return "No live Salesforce context available.";
    }
  }

  const soql = customerName?.trim()
    ? `SELECT Name, Account.Name FROM Contact WHERE Name = '${escapeSoqlLiteral(customerName.trim())}' LIMIT 1`
    : contactId
      ? `SELECT Name, Account.Name FROM Contact WHERE Id = '${contactId}' LIMIT 1`
      : "SELECT Name, Account.Name FROM Contact WHERE Name != null ORDER BY LastModifiedDate DESC LIMIT 1";
  const queryUrl = new URL(`/services/data/${apiVersion}/query`, instanceUrl);
  queryUrl.searchParams.set("q", soql);

  async function runQuery(): Promise<Response> {
    return fetch(queryUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });
  }

  let response = await runQuery();
  if (response.status === 401 && (await refreshAccessToken())) {
    response = await runQuery();
  } else if (response.status === 401 && (await fetchClientCredentialsToken())) {
    response = await runQuery();
  }

  if (!response.ok) {
    return "No live Salesforce context available.";
  }

  const payload = (await response.json()) as {
    records?: Array<{ Name?: string; Account?: { Name?: string } }>;
  };
  const record = payload.records?.[0];
  const contactName = record?.Name ?? "Unknown Contact";
  const accountName = record?.Account?.Name ?? "No Account";
  return `Contact: ${contactName}\nAccount: ${accountName}\nTier: Live`;
}

async function generateLlmOverview(query: string, modelLabel?: string, customerName?: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "your_actual_api_key_here") {
    return "## Overview\n\nModel key is not configured. Add `GEMINI_API_KEY` to generate AI overviews.";
  }

  const google = createGoogleGenerativeAI({ apiKey });
  const salesforceContext = await fetchSalesforceProfileContext(customerName);
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
        llmMarkdown = await generateLlmOverview(query, body.model, body.customerName);
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
