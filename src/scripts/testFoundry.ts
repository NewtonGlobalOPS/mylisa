import "dotenv/config";
import { AzureOpenAI } from "openai";

async function run() {
  const client = new AzureOpenAI({
    apiKey: process.env.AZURE_OPENAI_API_KEY!,
    endpoint: process.env.AZURE_OPENAI_ENDPOINT!,
    apiVersion: process.env.AZURE_OPENAI_API_VERSION!,
    deployment: process.env.AZURE_OPENAI_CHAT_DEPLOYMENT!,
  });

  const response = await client.chat.completions.create({
    messages: [
      { role: "system", content: "Return JSON only." },
      { role: "user", content: "Classify: Photosynthesis in plants." },
    ],
    temperature: 0,
    max_tokens: 50,
  });

  console.log("Response:");
  console.log(response.choices[0]?.message?.content);
}

run().catch(console.error);
