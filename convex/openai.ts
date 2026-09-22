// Shared OpenAI access. Both inquiry drafting and preference parsing ask for JSON,
// so the request, timeout, and parsing live here rather than in each caller.

// Overridable without a code deploy so the model can be changed from the dashboard.
export const model = () => process.env.OPENAI_MODEL ?? "gpt-5.1";

export function requireKey() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set.");
  return key;
}

export async function chatJson({ key, instructions, payload, timeoutMs = 15000 }: {
  key: string; instructions: string; payload: unknown; timeoutMs?: number;
}): Promise<Record<string, unknown>> {
  // A hung request must not leave the caller's UI spinning during a demo.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      signal: controller.signal,
      body: JSON.stringify({
        model: model(), response_format: { type: "json_object" },
        messages: [
          { role: "system", content: instructions },
          { role: "user", content: JSON.stringify(payload) },
        ],
      }),
    });
    if (!response.ok) throw new Error(`OpenAI returned ${response.status}`);
    const body = await response.json();
    const content = body?.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("No message content returned");
    const parsed = JSON.parse(content);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Expected a JSON object");
    return parsed as Record<string, unknown>;
  } finally {
    clearTimeout(timeout);
  }
}
