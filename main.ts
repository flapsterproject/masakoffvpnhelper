// main.ts
// Telegram Groq Chatbot (Deno)
// Features: A unique, fast AI chatbot using Groq's free API for logical, detailed answers, better than ChatGPT in speed and reasoning.
// Uses Groq API for chat completions (model: llama3-70b-8192 for strong logical responses).
// Supports conversation history for context-aware replies, multiple modes (e.g., /code for coding help, /math for math solving).
// Requires Deno 2.0+.
// Notes: Requires BOT_TOKEN and GROQ_API_KEY env vars. Deploy as webhook at SECRET_PATH.
// To get a free Groq API key, sign up at https://console.groq.com/ and generate one. Free tier has rate limits (e.g., ~10 queries/min); check docs for details.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const TOKEN = Deno.env.get("BOT_TOKEN")!;
if (!TOKEN) throw new Error("BOT_TOKEN env var is required");
const TELEGRAM_API = `https://api.telegram.org/bot${TOKEN}`;
const GROQ_API = "https://api.groq.com/openai/v1/chat/completions";
const SECRET_PATH = "/masakoffvpnhelper"; // make sure webhook path matches
const MODEL = "llama3-70b-8192"; // Fast and logical model; adjust if needed (e.g., mixtral-8x7b-32768 for mixture of experts)

// Conversation history storage (in-memory, per chat)
const chatHistories: Map<string, any[]> = new Map();

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
async function getAIResponse(chatId: string, prompt: string, mode: string = "default"): Promise<string | undefined> {
  let systemPrompt = "You are a highly intelligent AI assistant, providing logical, detailed, and truthful answers. Always reason step-by-step, explain your thought process, and provide evidence or examples where possible. Be helpful, concise yet comprehensive, and engaging.";

  if (mode === "code") {
    systemPrompt = "You are an expert coder. Provide clean, efficient code with explanations, error handling, and best practices. Support multiple languages.";
  } else if (mode === "math") {
    systemPrompt = "You are a math genius. Solve problems step-by-step, use LaTeX for equations where appropriate, and explain concepts clearly.";
  } else if (mode === "creative") {
    systemPrompt = "You are a creative storyteller. Generate imaginative stories, poems, or ideas based on the user's prompt.";
  }

  try {
    let history = chatHistories.get(chatId) || [];
    history.push({ role: "user", content: prompt });

    const body = {
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        ...history.slice(-10), // Keep last 10 messages for context
      ],
      temperature: 0.7,
      max_tokens: 2048,
    };
    const res = await fetch(GROQ_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error("Groq API response not ok:", await res.text());
      return undefined;
    }
    const data = await res.json();
    const response = data.choices?.[0]?.message?.content?.trim();
    if (response) {
      history.push({ role: "assistant", content: response });
      chatHistories.set(chatId, history);
    }
    return response;
  } catch (e) {
    console.error("Groq API error", e);
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
      const helpText = `🌟 Welcome to Groq Chatbot!\n\nI'm a unique, fast AI powered by Groq for logical and detailed answers, better than ChatGPT in speed and reasoning. 🚀\n\nFeatures:\n- Contextual conversations (remembers recent history)\n- Default mode: General questions with step-by-step logic\n- /code [query]: Coding help and snippets\n- /math [query]: Math solving with explanations\n- /creative [query]: Stories, poems, ideas\n- /clear: Clear conversation history\n\nJust send a message or use a command!`;
      await sendMessage(chatId, helpText);
      return;
    }

    if (text.startsWith("/clear")) {
      chatHistories.delete(chatId);
      await sendMessage(chatId, "Conversation history cleared!");
      return;
    }

    if (!text) return;

    let mode = "default";
    let prompt = text;
    if (text.startsWith("/code ")) {
      mode = "code";
      prompt = text.slice(6).trim();
    } else if (text.startsWith("/math ")) {
      mode = "math";
      prompt = text.slice(6).trim();
    } else if (text.startsWith("/creative ")) {
      mode = "creative";
      prompt = text.slice(10).trim();
    }

    if (!prompt) {
      await sendMessage(chatId, "Please provide a query after the command.");
      return;
    }

    await sendMessage(chatId, "Thinking...");

    let aiResponse: string | undefined;
    try {
      aiResponse = await getAIResponse(chatId, prompt, mode);
    } catch (e) {
      console.error("AI response error", e);
      await sendMessage(chatId, "Failed to get a response. Try again later.");
      return;
    }

    if (!aiResponse) {
      await sendMessage(chatId, "Could not generate a response.");
      return;
    }

    await sendMessage(chatId, aiResponse, { parse_mode: "Markdown" }); // Support Markdown for better formatting
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