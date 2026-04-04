import { AzureOpenAI } from "openai";

if (!process.env.AZURE_OPENAI_API_KEY)
  throw new Error("Missing AZURE_OPENAI_API_KEY");

if (!process.env.AZURE_OPENAI_ENDPOINT)
  throw new Error("Missing AZURE_OPENAI_ENDPOINT");

if (!process.env.AZURE_OPENAI_CHAT_DEPLOYMENT)
  throw new Error("Missing AZURE_OPENAI_CHAT_DEPLOYMENT");

if (!process.env.AZURE_OPENAI_API_VERSION)
  throw new Error("Missing AZURE_OPENAI_API_VERSION");

export const azureClient = new AzureOpenAI({
  apiKey: process.env.AZURE_OPENAI_API_KEY,
  endpoint: process.env.AZURE_OPENAI_ENDPOINT,
  apiVersion: process.env.AZURE_OPENAI_API_VERSION,
  deployment: process.env.AZURE_OPENAI_CHAT_DEPLOYMENT,
});

export async function chat(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  temperature = 0,
  maxTokens = 100,
) {
  const res = await azureClient.chat.completions.create({
    messages,
    temperature,
    max_tokens: maxTokens,
  });

  return res.choices[0]?.message?.content ?? "";
}
