import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { convertToModelMessages, streamText, type UIMessage } from "ai";

export const runtime = "nodejs";

type ChatRequestBody = {
  messages: UIMessage[];
  documentContext?: string;
  documentName?: string;
};

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json()) as ChatRequestBody;
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const { documentContext, documentName } = body;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "your_actual_api_key_here") {
    return Response.json(
      { error: "Set a valid GEMINI_API_KEY in .env.local and restart the dev server." },
      { status: 500 },
    );
  }

  const google = createGoogleGenerativeAI({ apiKey });

  const modelMessages = await convertToModelMessages(messages);
  const trimmedContext = documentContext?.trim();

  const systemPrompt = trimmedContext
    ? `You are a precise document analysis assistant.
Use the provided document context as the primary source of truth and cite relevant snippets in your answer.
If context is insufficient, clearly say what is missing.

Document Name: ${documentName ?? "Untitled PDF"}
Document Context:
${trimmedContext}`
    : "You are a helpful AI assistant. No document context was provided.";

  const result = streamText({
    model: google("gemini-2.5-flash"),
    system: systemPrompt,
    messages: modelMessages,
  });

  return result.toUIMessageStreamResponse();
}
