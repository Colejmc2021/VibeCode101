"use client";

import { useMemo, useRef, useState, type ReactElement } from "react";
import ReactMarkdown from "react-markdown";

type ModelOption =
  | "Claude 3.5 Sonnet (Salesforce Default)"
  | "GPT-4o (BYOLLM)"
  | "Llama 3.3 (Open Source Framework)";

type RpcLogEntry = {
  timestamp: string;
  direction: ">>" | "<<";
  payload: Record<string, unknown>;
};

const modelOptions: ModelOption[] = [
  "Claude 3.5 Sonnet (Salesforce Default)",
  "GPT-4o (BYOLLM)",
  "Llama 3.3 (Open Source Framework)",
];

type QueryAction = "Summarize Health" | "Check Orders" | "Query Docs";

export default function Page(): ReactElement {
  const rpcSequenceRef = useRef(1);
  const [naturalLanguageInput, setNaturalLanguageInput] = useState("");
  const [selectedModel, setSelectedModel] = useState<ModelOption>(modelOptions[0]);
  const [isQuerying, setIsQuerying] = useState(false);
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

  function handleModelChange(nextModel: ModelOption): void {
    setSelectedModel(nextModel);
    appendLog(">>", {
      jsonrpc: "2.0",
      method: "routing.model_changed",
      params: {
        model: nextModel,
        provider:
          nextModel === "Claude 3.5 Sonnet (Salesforce Default)"
            ? "anthropic"
            : nextModel === "GPT-4o (BYOLLM)"
              ? "openai"
              : "oss-router",
      },
    });
  }

  async function runPortalQuery(action?: QueryAction): Promise<void> {
    if (isQuerying) {
      return;
    }

    const query = naturalLanguageInput.trim() || (action ? `Quick action: ${action}` : "Summarize account health");
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

      setAiConsoleMarkdown(payload.markdown);
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
    void runPortalQuery(action);
  }

  return (
    <main className="min-h-screen bg-[#0a0d14] text-slate-100">
      <div className="mx-auto flex h-screen max-w-[1800px] gap-4 p-4">
        <aside className="w-[300px] rounded-2xl border border-white/10 bg-gradient-to-b from-slate-900 to-slate-950 p-5 shadow-2xl">
          <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-cyan-200">Data Cloud Unified Profile</h2>
          <div className="mt-5 space-y-4 text-sm">
            <ProfileField label="Name" value="Alex Morgan" />
            <ProfileField label="Company" value="Summit Retail Group" />
            <ProfileField label="Tier" value="Platinum" />
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2">
              <p className="text-xs uppercase tracking-wide text-emerald-300">Data Status</p>
              <p className="mt-1 flex items-center gap-2 font-medium text-emerald-200">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_12px_#34d399]" />
                Active and synchronized
              </p>
            </div>
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col rounded-2xl border border-white/10 bg-slate-900/70 p-4 shadow-[0_20px_60px_rgba(0,0,0,0.35)] backdrop-blur">
          <div className="rounded-2xl border border-white/10 bg-[#0e1320] p-4">
            <div className="grid grid-cols-[1fr_320px_auto] gap-3">
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
                className="h-11 rounded-xl border border-white/10 bg-slate-950/80 px-4 text-sm text-slate-100 outline-none ring-cyan-400/40 placeholder:text-slate-400 focus:ring"
              />
              <select
                value={selectedModel}
                onChange={(event) => handleModelChange(event.target.value as ModelOption)}
                className="h-11 rounded-xl border border-cyan-400/30 bg-slate-950 px-4 text-sm font-medium text-cyan-100 outline-none ring-cyan-400/40 focus:ring"
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
                className="h-11 rounded-xl border border-cyan-400/40 bg-cyan-500/15 px-4 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isQuerying ? "Running..." : "Run Query"}
              </button>
            </div>
            <div className="mt-3 flex gap-2">
              {(["Summarize Health", "Check Orders", "Query Docs"] as const).map((action) => (
                <button
                  key={action}
                  onClick={() => handleQuickAction(action)}
                  className="rounded-lg border border-white/15 bg-slate-900 px-4 py-2 text-sm font-medium text-slate-100 transition hover:border-cyan-400/40 hover:bg-cyan-500/10"
                >
                  {action}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 flex min-h-0 flex-1 flex-col rounded-2xl border border-white/10 bg-[#0b111d] p-4">
            <div className="mb-3 flex items-center justify-between">
              <h1 className="text-lg font-semibold text-slate-100">AI Response Console</h1>
              <span className="rounded-full border border-cyan-400/30 bg-cyan-500/10 px-3 py-1 text-xs text-cyan-200">
                Markdown Render Enabled
              </span>
            </div>
            <div className="prose prose-invert max-w-none flex-1 overflow-y-auto rounded-xl border border-white/10 bg-slate-950/70 p-4 prose-headings:text-slate-100 prose-strong:text-cyan-200">
              <ReactMarkdown>{aiConsoleMarkdown}</ReactMarkdown>
            </div>
            <div className="mt-4 rounded-xl border border-cyan-400/30 bg-gradient-to-r from-[#111a2d] to-[#1a1530] px-4 py-3 shadow-[0_0_25px_rgba(45,212,191,0.18)]">
              <p className="font-mono text-sm tracking-wide text-cyan-100">
                Total Tokens: 3,450 | Input: 2,100 | Output: 1,350 | Flex Credit Cost: 1 Action ($0.10)
              </p>
            </div>
          </div>
        </section>

        <aside
          className={`rounded-2xl border border-white/10 bg-[#090d17] p-4 transition-all duration-300 ${
            isLogCollapsed ? "w-[70px]" : "w-[370px]"
          }`}
        >
          <button
            onClick={() => setIsLogCollapsed((previous) => !previous)}
            className="mb-3 w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-xs uppercase tracking-wide text-slate-200"
          >
            {isLogCollapsed ? "Expand" : "Collapse"}
          </button>
          {!isLogCollapsed ? (
            <>
              <h2 className="mb-3 text-sm font-semibold text-violet-200">Live MCP Protocol Log</h2>
              <pre className="h-[calc(100vh-170px)] overflow-y-auto rounded-xl border border-violet-500/20 bg-black/70 p-3 font-mono text-xs leading-5 text-emerald-300">
                {logText}
              </pre>
            </>
          ) : (
            <p className="mt-4 rotate-180 text-center text-xs tracking-[0.2em] text-violet-200 [writing-mode:vertical-rl]">
              MCP LOG
            </p>
          )}
        </aside>
      </div>
    </main>
  );
}

function ProfileField({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-sm font-medium text-slate-100">{value}</p>
    </div>
  );
}
