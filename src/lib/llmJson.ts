import "dotenv/config";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export async function llmJson(
  prompt: string,
  options?: {
    maxCompletionTokens?: number;
    systemPrompt?: string;
    temperature?: number;
  }
): Promise<string> {
  const endpoint = mustEnv("AZURE_OPENAI_ENDPOINT").replace(/\/+$/, "");
  const deployment = mustEnv("AZURE_OPENAI_DEPLOYMENT");
  const apiKey = mustEnv("AZURE_OPENAI_API_KEY");
  const apiVersion =
    process.env.AZURE_OPENAI_API_VERSION || "2025-01-01-preview";

  const url = `${endpoint}/openai/deployments/${encodeURIComponent(
    deployment,
  )}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify({
      max_completion_tokens: options?.maxCompletionTokens ?? 60,
      temperature: options?.temperature ?? 0,
      messages: [
        {
          role: "system",
          content:
            options?.systemPrompt ??
            "You are a classifier. Return ONLY valid JSON. No markdown. No commentary.",
        },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Azure OpenAI failed: ${res.status} ${res.statusText} ${text}`,
    );
  }

  const data = (await res.json()) as any;
  const content = data?.choices?.[0]?.message?.content;

  if (!content || typeof content !== "string") {
    throw new Error("Azure OpenAI returned empty content");
  }

  return content;
}
