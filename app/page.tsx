"use client";

import { useState, type ChangeEvent, type FormEvent, type ReactElement } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";

type ParsedDocument = {
  name: string;
  text: string;
  pageCount: number;
  parseMs: number;
};

async function parsePdfInBrowser(file: File): Promise<ParsedDocument> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const started = performance.now();

  const data = await file.arrayBuffer();
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(data),
  });

  const document = await loadingTask.promise;
  const pages: string[] = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .filter(Boolean)
      .join(" ");
    pages.push(pageText);
  }

  return {
    name: file.name,
    text: pages.join("\n\n").replace(/\s+/g, " ").trim(),
    pageCount: document.numPages,
    parseMs: performance.now() - started,
  };
}

function getMessageText(message: { parts?: Array<{ type: string; text?: string }> }): string {
  if (!message.parts) {
    return "";
  }
  return message.parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text ?? "")
    .join("");
}

export default function Page(): ReactElement {
  const [input, setInput] = useState("");
  const [parsedDocument, setParsedDocument] = useState<ParsedDocument | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  const [transport] = useState(() => new DefaultChatTransport({ api: "/api/chat" }));
  const { messages, sendMessage, status, error } = useChat({ transport });

  async function onFileChange(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setIsParsing(true);
    setParseError(null);

    try {
      const parsed = await parsePdfInBrowser(file);
      setParsedDocument(parsed);
    } catch {
      setParseError("Unable to parse PDF in browser.");
    } finally {
      setIsParsing(false);
      event.target.value = "";
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || status === "streaming" || status === "submitted") {
      return;
    }

    await sendMessage(
      { text: trimmed },
      {
        body: {
          documentContext: parsedDocument?.text ?? "",
          documentName: parsedDocument?.name ?? "",
        },
      },
    );
    setInput("");
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto grid max-w-6xl gap-4 px-4 py-6 lg:grid-cols-[360px_1fr]">
        <aside className="rounded-2xl border border-white/10 bg-slate-900/70 p-5">
          <h1 className="text-lg font-semibold">Headless Browser Document Agent</h1>
          <p className="mt-2 text-sm text-slate-300">
            PDF parsing runs fully in-browser. Only extracted text is sent as context with chat history.
          </p>

          <div className="mt-4 rounded-xl border border-white/10 bg-slate-950/60 p-4">
            <label htmlFor="pdf-upload" className="mb-2 block text-xs uppercase tracking-wide text-slate-300">
              Upload PDF
            </label>
            <input
              id="pdf-upload"
              type="file"
              accept="application/pdf"
              onChange={onFileChange}
              className="w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-cyan-500/20 file:px-3 file:py-2 file:text-cyan-200 hover:file:bg-cyan-500/30"
            />
            <div className="mt-3 space-y-1 text-xs text-slate-300">
              <p>Status: {isParsing ? "Parsing..." : "Idle"}</p>
              <p>Document: {parsedDocument?.name ?? "None"}</p>
              <p>Pages: {parsedDocument?.pageCount ?? 0}</p>
              <p>Context chars: {parsedDocument?.text.length ?? 0}</p>
              <p>Parse time: {parsedDocument ? `${parsedDocument.parseMs.toFixed(1)} ms` : "-"}</p>
            </div>
            {parseError ? <p className="mt-2 text-xs text-rose-300">{parseError}</p> : null}
          </div>
        </aside>

        <section className="flex min-h-[80vh] flex-col rounded-2xl border border-white/10 bg-slate-900/60 p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Chat</h2>
            <p className="text-xs text-slate-400">Status: {status}</p>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto rounded-xl border border-white/10 bg-slate-950/60 p-4">
            {messages.length === 0 ? (
              <p className="text-sm text-slate-400">
                Upload a PDF and ask questions. The backend receives your chat plus extracted document text context.
              </p>
            ) : (
              messages.map((message) => {
                const text = getMessageText(message);
                return (
                  <article
                    key={message.id}
                    className={`max-w-[90%] rounded-2xl px-4 py-3 text-sm ${
                      message.role === "user"
                        ? "ml-auto bg-gradient-to-r from-cyan-500 to-blue-500 text-white"
                        : "mr-auto border border-white/10 bg-slate-900"
                    }`}
                  >
                    <p className="mb-1 text-[11px] uppercase tracking-wide opacity-80">{message.role}</p>
                    <p className="whitespace-pre-wrap leading-6">{text}</p>
                  </article>
                );
              })
            )}
          </div>

          <form onSubmit={onSubmit} className="mt-4 rounded-xl border border-white/10 bg-slate-950/60 p-3">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              rows={3}
              placeholder="Ask a question about your uploaded document..."
              className="w-full resize-none rounded-lg border border-white/10 bg-slate-950 p-3 text-sm outline-none ring-cyan-500/40 focus:ring"
            />
            <div className="mt-3 flex items-center justify-between">
              <p className="text-xs text-slate-400">
                Context source: {parsedDocument?.name ? `PDF: ${parsedDocument.name}` : "No document loaded"}
              </p>
              <button
                type="submit"
                disabled={status === "streaming" || status === "submitted" || input.trim().length === 0}
                className="rounded-lg bg-gradient-to-r from-fuchsia-500 to-cyan-500 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {status === "streaming" || status === "submitted" ? "Streaming..." : "Send"}
              </button>
            </div>
            {error ? <p className="mt-2 text-xs text-rose-300">{error.message}</p> : null}
          </form>
        </section>
      </div>
    </main>
  );
}
