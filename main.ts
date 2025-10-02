// main.ts
// Telegram DeepSeek Chatbot (Deno)
// Features: A strong AI chatbot using DeepSeek's free API to answer any question.
// Uses DeepSeek API for chat completions (model: deepseek-chat).
// Requires Deno 2.0+.
// Notes: Requires BOT_TOKEN and DEEPSEEK_API_KEY env vars. Deploy as webhook at SECRET_PATH.
// To get a free DeepSeek API key, sign up at https://platform.deepseek.com/ and generate one in your dashboard. The free tier has daily usage limits (e.g., tokens per day). Check https://platform.deepseek.com/docs for details.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const TOKEN = Deno.env.get("BOT_TOKEN")!;
if (!TOKEN) throw new Error("BOT_TOKEN env var is required");
const DEEPSEEK_API_KEY = Deno.env.get("DEEPSEEK_API_KEY")!;
if (!DEEPSEEK_API_KEY) throw new Error("DEEPSEEK_API_KEY env var is required");
const TELEGRAM_API = `https://api.telegram.org/bot${TOKEN}`;
const DEEPSEEK_API = "https://api.deepseek.com/v1/chat/completions";
const SECRET_PATH = "/masakoffvpnhelper"; // make sure webhook path matches
const MODEL = "deepseek-chat"; // Use deepseek-chat for general queries; adjust if needed (e.g., deepseek-coder for code-related)

// -------------------- Telegram helpers --------------------
async function sendMessage(chatId: string | number, text: string, options: any = {}): Promise<number | null> {
  try {
    const body: any = { chat_id: chatId, text, ...options };
    const res = await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return data.result?.message_id ?? null;
  } catch (e) {
    console.error("sendMessage error", e);
    return null;
  }
}

// -------------------- AI Response --------------------
async function getAIResponse(prompt: string): Promise<string | undefined> {
  try {
    const body = {
      model: MODEL,
      messages: [
        { role: "system", content: "You are a helpful and intelligent AI assistant." },
        { role: "user", content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 1024,
    };
    const res = await fetch(DEEPSEEK_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error("DeepSeek API response not ok:", await res.text());
      return undefined;
    }
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim();
  } catch (e) {
    console.error("DeepSeek API error", e);
    return undefined;
  }
}

// -------------------- Main handler --------------------
async function handleUpdate(update: any) {
  if (update.message) {
    const msg = update.message;
    if (msg.chat.type !== "private") return;
    const text = msg.text?.trim() || "";
    const chatId = String(msg.chat.id);

    if (text.startsWith("/start") || text.startsWith("/help")) {
      const helpText = `🌟 Welcome to DeepSeek Chatbot!\n\nI'm powered by DeepSeek's API to answer any question you have. 🤖\n\nJust send me a message with your question or topic, and I'll respond! Note: This uses the free tier, so there may be usage limits.`;
      await sendMessage(chatId, helpText);
      return;
    }

    if (!text) return;

    await sendMessage(chatId, "Thinking...");

    let aiResponse: string | undefined;
    try {
      aiResponse = await getAIResponse(text);
    } catch (e) {
      console.error("AI response error", e);
      await sendMessage(chatId, "Failed to get a response. Try again later.");
      return;
    }

    if (!aiResponse) {
      await sendMessage(chatId, "Could not generate a response.");
      return;
    }

    await sendMessage(chatId, aiResponse);
  }
}

// -------------------- Server / Webhook --------------------
serve(async (req: Request) => {
  try {
    const url = new URL(req.url);
    if (url.pathname !== SECRET_PATH) return new Response("Not found", { status: 404 });
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

    const update = await req.json();
    await handleUpdate(update);

    return new Response("OK");
  } catch (e) {
    console.error("server error", e);
    return new Response("Error", { status: 500 });
  }
});