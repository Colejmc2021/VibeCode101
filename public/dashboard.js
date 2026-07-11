(() => {
  const chatHistory = document.getElementById("chatHistory");
  const globalQueryBar = document.getElementById("globalQueryBar");
  const chatTextarea = document.getElementById("chatTextarea");
  const modelSelector = document.getElementById("composerModelSelector");
  const sendPromptButton = document.getElementById("sendPromptButton");
  const voiceInputButton = document.getElementById("voiceInputButton");
  const fileUploadButton = document.getElementById("fileUploadButton");
  const fileUploadInput = document.getElementById("fileUploadInput");
  const rpcTerminal = document.getElementById("rpcTerminal");
  const telemetryMatrix = document.getElementById("telemetryMatrix");

  if (
    !chatHistory ||
    !globalQueryBar ||
    !chatTextarea ||
    !modelSelector ||
    !sendPromptButton ||
    !voiceInputButton ||
    !fileUploadButton ||
    !fileUploadInput ||
    !rpcTerminal ||
    !telemetryMatrix
  ) {
    return;
  }

  let requestSequence = 1;
  let totalInTokens = 0;
  let totalOutTokens = 0;
  let totalCostUsd = 0;

  function nextRequestId() {
    const id = `req-${String(requestSequence).padStart(4, "0")}`;
    requestSequence += 1;
    return id;
  }

  function appendMessage(role, text, isHtml = false) {
    const bubble = document.createElement("div");
    bubble.className = `message ${role}`;
    if (isHtml) {
      bubble.innerHTML = text;
    } else {
      bubble.textContent = text;
    }
    chatHistory.appendChild(bubble);
    chatHistory.scrollTop = chatHistory.scrollHeight;
    return bubble;
  }

  function markdownToPlainText(markdown) {
    return markdown
      .replace(/^#+\s?/gm, "")
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
      .trim();
  }

  function estimateTokens(inputText, outputText) {
    const inTokens = Math.max(1, Math.ceil(inputText.length / 4));
    const outTokens = Math.max(1, Math.ceil(outputText.length / 4));
    return { inTokens, outTokens };
  }

  function updateTelemetry({ inTokens, outTokens, actionCost }) {
    totalInTokens += inTokens;
    totalOutTokens += outTokens;
    totalCostUsd += actionCost;
    telemetryMatrix.textContent =
      `Telemetry Matrix | In-Tokens: ${totalInTokens} | Out-Tokens: ${totalOutTokens} | Action Cost: $${totalCostUsd.toFixed(2)}`;
  }

  function formatRpcBlock(payload) {
    return [
      `// ${new Date().toISOString()} :: JSON-RPC envelope`,
      JSON.stringify(payload, null, 2),
      "",
    ].join("\n");
  }

  function prependTerminalLog(block) {
    rpcTerminal.textContent = `${block}${rpcTerminal.textContent}`;
  }

  async function submitPrompt(rawPrompt, source) {
    const prompt = rawPrompt.trim();
    if (!prompt) return;

    const requestId = nextRequestId();
    appendMessage("user", prompt);

    const typingBubble = appendMessage(
      "agent",
      `Ask Agent is thinking... <div class="typing-indicator"><span></span><span></span><span></span></div>`,
      true,
    );

    const model = modelSelector.value;
    const customerName = "Alex Rivera";
    const toolBoundary = /order|ticket|case|support/i.test(prompt) ? "cdp_search_index" : "bigquery_zero_copy";
    const rpcPayload = {
      jsonrpc: "2.0",
      id: requestId,
      method: "mcp.execute",
      params: {
        source,
        model,
        customerName,
        tool_boundary: toolBoundary,
        prompt,
      },
    };
    prependTerminalLog(formatRpcBlock(rpcPayload));

    try {
      const response = await fetch("/api/portal/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: null,
          query: prompt,
          model,
          customerName,
        }),
      });

      const payload = await response.json();
      if (!response.ok || !payload.markdown) {
        throw new Error(payload.error || "Unable to resolve request.");
      }

      const answerText = markdownToPlainText(payload.markdown);
      typingBubble.remove();
      appendMessage("agent", answerText);

      const tokenMeta = payload.usage && typeof payload.usage === "object"
        ? {
            inTokens: Number(payload.usage.input_tokens || 0),
            outTokens: Number(payload.usage.output_tokens || 0),
          }
        : estimateTokens(prompt, answerText);

      const actionCost = Number(payload.actionCostUsd || ((tokenMeta.inTokens + tokenMeta.outTokens) * 0.00002));
      updateTelemetry({ ...tokenMeta, actionCost });
    } catch (error) {
      typingBubble.remove();
      appendMessage("agent", `I hit an error while searching service data: ${error.message || "Unknown error"}`);
      updateTelemetry({ inTokens: 1, outTokens: 1, actionCost: 0 });
    }
  }

  function bindInput(input, source) {
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.shiftKey) return;
      event.preventDefault();
      const value = input.value;
      input.value = "";
      void submitPrompt(value, source);
    });
  }

  bindInput(globalQueryBar, "global-query-bar");
  bindInput(chatTextarea, "chat-textarea");

  sendPromptButton.addEventListener("click", () => {
    const value = chatTextarea.value;
    chatTextarea.value = "";
    void submitPrompt(value, "composer-send-button");
  });

  voiceInputButton.addEventListener("click", () => {
    appendMessage("agent", "Voice input is ready for live capture in the next integration pass.");
  });

  fileUploadButton.addEventListener("click", () => {
    fileUploadInput.click();
  });

  fileUploadInput.addEventListener("change", () => {
    const file = fileUploadInput.files?.[0];
    if (!file) return;
    appendMessage("user", `Uploaded file: ${file.name}`);
    prependTerminalLog(formatRpcBlock({
      jsonrpc: "2.0",
      method: "mcp.upload",
      params: { filename: file.name, tool_boundary: "cdp_search_index" },
    }));
    fileUploadInput.value = "";
  });

})();
