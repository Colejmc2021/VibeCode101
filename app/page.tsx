"use client";

import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import ReactMarkdown from "react-markdown";

type ModelOption =
  | "🟣 Gemini 3.5 (Salesforce Default)"
  | "🟢 GPT-4o (BYOLLM)"
  | "🟠 Llama 3.3 (Open Source Framework)";

type RpcLogEntry = {
  timestamp: string;
  direction: ">>" | "<<";
  payload: Record<string, unknown>;
};

const modelOptions: ModelOption[] = [
  "🟣 Gemini 3.5 (Salesforce Default)",
  "🟢 GPT-4o (BYOLLM)",
  "🟠 Llama 3.3 (Open Source Framework)",
];

type QueryAction = "Summarize Health" | "Check Orders" | "Query Docs";

type SalesforceProfile = {
  name: string;
  company: string;
  tier: string;
};

type InsightMetric = "Next Best Action" | "Propensity to Buy" | "Lifetime Value";

export default function Page(): ReactElement {
  const rpcSequenceRef = useRef(1);
  const [naturalLanguageInput, setNaturalLanguageInput] = useState("");
  const [selectedModel, setSelectedModel] = useState<ModelOption>(modelOptions[0]);
  const [isQuerying, setIsQuerying] = useState(false);
  const [salesforceProfile, setSalesforceProfile] = useState<SalesforceProfile>({
    name: "Alex Morgan",
    company: "Summit Retail Group",
    tier: "Platinum",
  });
  const [aiConsoleMarkdown, setAiConsoleMarkdown] = useState<string>(
    "## AI Response Console\n\nUse the top quick actions to simulate routed Salesforce MCP queries.",
  );
  const [isLogCollapsed, setIsLogCollapsed] = useState(false);
  const [rpcLogs, setRpcLogs] = useState<RpcLogEntry[]>([
    {
      timestamp: "evt-0000",
      direction: "<<",
      payload: {
        jsonrpc: "2.0",
        method: "session.ready",
        params: {
          workspace: "customer-portal",
          status: "connected",
        },
      },
    },
  ]);

  const logText = useMemo(() => {
    return rpcLogs
      .map((entry) => `[${entry.timestamp}] ${entry.direction} ${JSON.stringify(entry.payload, null, 2)}`)
      .join("\n\n");
  }, [rpcLogs]);

  function nextEventLabel(): string {
    const current = rpcSequenceRef.current;
    rpcSequenceRef.current += 1;
    return `evt-${String(current).padStart(4, "0")}`;
  }

  function appendLog(direction: RpcLogEntry["direction"], payload: Record<string, unknown>): void {
    setRpcLogs((previous) => [...previous, { timestamp: nextEventLabel(), direction, payload }]);
  }

  async function loadSalesforceProfile(): Promise<void> {
    appendLog(">>", {
      jsonrpc: "2.0",
      method: "salesforce.profile.fetch",
      params: { source: "portal-ui" },
    });
    try {
      const response = await fetch("/api/salesforce/profile", { cache: "no-store" });
      const payload = (await response.json()) as {
        connected: boolean;
        profile?: { name: string; company: string; tier: string };
        error?: string;
      };

      if (!response.ok || !payload.connected || !payload.profile) {
        appendLog("<<", {
          jsonrpc: "2.0",
          method: "salesforce.profile.fetch",
          error: payload.error ?? "Profile fallback in use",
        });
        return;
      }

      setSalesforceProfile(payload.profile);
      appendLog("<<", {
        jsonrpc: "2.0",
        method: "salesforce.profile.fetch",
        result: payload.profile,
      });
    } catch {
      // Keep the premium fallback profile if Salesforce is unavailable.
    }
  }

  useEffect(() => {
    void loadSalesforceProfile();
  }, []);

  function handleModelChange(nextModel: ModelOption): void {
    setSelectedModel(nextModel);
    appendLog(">>", {
      jsonrpc: "2.0",
      method: "routing.model_changed",
      params: {
        model: nextModel,
        provider:
          nextModel === "🟣 Gemini 3.5 (Salesforce Default)"
            ? "google"
            : nextModel === "🟢 GPT-4o (BYOLLM)"
              ? "byollm-router"
              : "oss-router",
      },
    });
  }

  async function runPortalQuery(action?: QueryAction, customQuery?: string): Promise<void> {
    if (isQuerying) {
      return;
    }

    const query =
      customQuery?.trim() ||
      naturalLanguageInput.trim() ||
      (action ? `Quick action: ${action}` : "Summarize account health");
    const requestId = `${(action ?? "custom-query").toLowerCase().replace(/\s+/g, "-")}-request-${nextEventLabel()}`;

    appendLog(">>", {
      jsonrpc: "2.0",
      id: requestId,
      method: "mcp.execute",
      params: {
        action: action ?? "Custom Query",
        model: selectedModel,
        query,
      },
    });

    setAiConsoleMarkdown("### Generating overview...\n\nPlease wait while the model analyzes Salesforce context.");
    setIsQuerying(true);
    try {
      const response = await fetch("/api/portal/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: action ?? null,
          query,
          model: selectedModel,
        }),
      });

      const payload = (await response.json()) as {
        markdown?: string;
        transport?: "mock" | "live";
        rpcResult?: Record<string, unknown>;
        error?: string;
      };

      if (!response.ok || !payload.markdown) {
        throw new Error(payload.error ?? "Failed to run portal query.");
      }

      const nextMarkdown = payload.markdown.trim();
      setAiConsoleMarkdown(
        nextMarkdown.length > 0
          ? nextMarkdown
          : "### Overview unavailable\n\nNo content was returned by the selected model. Please retry.",
      );
      appendLog("<<", {
        jsonrpc: "2.0",
        id: requestId,
        result: {
          status: "ok",
          transport: payload.transport ?? "mock",
          ...(payload.rpcResult ?? {}),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown query error";
      appendLog("<<", {
        jsonrpc: "2.0",
        id: requestId,
        error: {
          code: -32000,
          message,
        },
      });
      setAiConsoleMarkdown(`## Query Error\n\n${message}`);
    } finally {
      setIsQuerying(false);
    }
  }

  function handleQuickAction(action: QueryAction): void {
    const prompts: Record<QueryAction, string> = {
      "Summarize Health": `Generate a concise health summary for ${salesforceProfile.name}, including status, opportunity, and next action.`,
      "Check Orders": `Generate an order-focused overview for ${salesforceProfile.name}, including likely issues and outreach recommendation.`,
      "Query Docs": `Generate a short support overview for ${salesforceProfile.name} using available Salesforce context.`,
    };
    const prompt = prompts[action];
    setNaturalLanguageInput(prompt);
    void runPortalQuery(undefined, prompt);
  }

  function handleInsightClick(metric: InsightMetric): void {
    const metricPrompt: Record<InsightMetric, string> = {
      "Next Best Action": `Generate an AI overview for Next Best Action for ${salesforceProfile.name}. Include recommended action, reason, risk, and a one-step follow-up.`,
      "Propensity to Buy": `Generate an AI overview for Propensity to Buy for ${salesforceProfile.name}. Include confidence level, top purchase signals, and short sales guidance.`,
      "Lifetime Value": `Generate an AI overview for Lifetime Value for ${salesforceProfile.name}. Include estimated value, trend explanation, and one retention recommendation.`,
    };

    const prompt = metricPrompt[metric];
    setNaturalLanguageInput(prompt);
    void runPortalQuery(undefined, prompt);
  }

  return (
    <main className="portal-page">
      <div className="portal-shell">
        <aside className="portal-sidebar">
          <div className="space-y-3">
            <MetricRow label="Customer Id" value="57433532" />
            <MetricRow label="Email Address" value="ajohnson@example.com" />
            <MetricRow label="Loyalty Status" value={salesforceProfile.tier} />
          </div>

          <div className="portal-sidebar-section">
            <InsightButton
              label="Next Best Action"
              value="Renewable Energy Programs"
              onClick={() => handleInsightClick("Next Best Action")}
            />
            <InsightButton
              label="Propensity to Buy"
              value="Most Likely"
              onClick={() => handleInsightClick("Propensity to Buy")}
            />
            <InsightButton label="Lifetime Value" value="$50,000.00" onClick={() => handleInsightClick("Lifetime Value")} />
            <MetricRow label="Segments" value="Residential Customer, Regulated Electric Service" />

            <div className="portal-engagement-wrap">
              <p className="portal-engagement-title">Engagement Score</p>
              <div className="portal-engagement-gauge-wrap">
                <HalfGauge percentage={84} />
              </div>
            </div>
          </div>
        </aside>

        <section className="portal-main">
          <div className="portal-header">
            <div>
              <p className="text-[11px] uppercase tracking-[0.18em] text-cyan-200">D350 Headless Portal</p>
              <h1 className="mt-1 text-2xl font-semibold text-slate-100">Welcome, {salesforceProfile.name}</h1>
            </div>
          </div>

          <div className="portal-top-card">
            <div className="portal-query-grid">
              <input
                value={naturalLanguageInput}
                onChange={(event) => setNaturalLanguageInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void runPortalQuery();
                  }
                }}
                placeholder="Ask questions about Salesforce data..."
                className="portal-query-input"
              />
              <select
                value={selectedModel}
                onChange={(event) => handleModelChange(event.target.value as ModelOption)}
                className="portal-query-select"
              >
                {modelOptions.map((model) => (
                  <option key={model} value={model} className="bg-slate-950 text-slate-100">
                    {model}
                  </option>
                ))}
              </select>
              <button
                onClick={() => void runPortalQuery()}
                disabled={isQuerying}
                className="portal-run-button disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isQuerying ? "Running..." : "Run Query"}
              </button>
            </div>
            <div className="portal-actions">
              {(["Summarize Health", "Check Orders", "Query Docs"] as const).map((action) => (
                <button
                  key={action}
                  onClick={() => handleQuickAction(action)}
                  className="portal-action-button"
                >
                  {action}
                </button>
              ))}
            </div>
          </div>

          <div className="portal-response-card">
            <div className="portal-response-header">
              <h1 className="portal-response-title">AI Response Console</h1>
              <span className="portal-response-badge">Markdown Render Enabled</span>
            </div>
            <div className="portal-response-body prose max-w-none prose-invert prose-headings:text-slate-100 prose-strong:text-cyan-200 prose-p:text-slate-100 prose-li:text-slate-100">
              <ReactMarkdown>{aiConsoleMarkdown}</ReactMarkdown>
            </div>
            <div className="portal-telemetry">
              <p className="portal-telemetry-text">
                Total Tokens: 3,450 | Input: 2,100 | Output: 1,350 | Flex Credit Cost: 1 Action ($0.10)
              </p>
            </div>
          </div>
        </section>

        <aside
          className={`portal-log-panel ${
            isLogCollapsed ? "portal-log-panel-collapsed" : "portal-log-panel-expanded"
          }`}
        >
          <button
            onClick={() => setIsLogCollapsed((previous) => !previous)}
            className="portal-log-toggle"
          >
            {isLogCollapsed ? "Expand" : "Collapse"}
          </button>
          {!isLogCollapsed ? (
            <>
              <h2 className="portal-log-title">Live MCP Protocol Log</h2>
              <pre className="portal-log-body">
                {logText}
              </pre>
            </>
          ) : (
            <p className="portal-log-collapsed-label">
              MCP LOG
            </p>
          )}
        </aside>
      </div>
    </main>
  );
}

function MetricRow({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="portal-metric-row">
      <p className="portal-metric-label">{label}</p>
      <p className="portal-metric-value">{value}</p>
    </div>
  );
}

function InsightButton({
  label,
  value,
  onClick,
}: {
  label: string;
  value: string;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      onClick={onClick}
      className="portal-insight-button"
    >
      <p className="portal-insight-label">{label}</p>
      <p className="portal-insight-value">{value}</p>
      <p className="portal-insight-hint">Click for AI overview</p>
    </button>
  );
}

function HalfGauge({ percentage }: { percentage: number }): ReactElement {
  const clamped = Math.max(0, Math.min(100, percentage));

  return (
    <div className="portal-gauge">
      <svg viewBox="0 0 120 70" className="portal-gauge-svg">
        <path
          d="M12 60 A48 48 0 0 1 108 60"
          className="portal-gauge-bg"
          pathLength={100}
        />
        <path
          d="M12 60 A48 48 0 0 1 108 60"
          className="portal-gauge-fill"
          pathLength={100}
          strokeDasharray={`${clamped} 100`}
        />
      </svg>
      <div className="portal-gauge-value">{clamped}%</div>
    </div>
  );
}
