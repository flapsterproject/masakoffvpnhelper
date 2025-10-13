// main.ts
// 💥 Masakoff SMS Sender Bot (Deno) - SIMULATED SMS version (no real API calls)
// 🚀 Created by @Masakoff | FlapsterMinerManager (adapted)
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

// --- 💬 Send message helper (Telegram) ---
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

// --- 🎯 Simulated send (no external API) ---
// Returns true on simulated success, false on simulated failure.
// You can adjust successProbability as needed for testing.
function simulateSend(): boolean {
  const successProbability = 0.8; // 80% chance to succeed
  return Math.random() < successProbability;
}

// --- 💣 SMS sending job (SIMULATED) ---
async function runSMS(chatId: string, phoneNumber: string, targetCount: number | null) {
  const key = ["task", chatId];
  // task structure: { phoneNumber, stop, sent, attempts, target }
  await kv.set(key, { phoneNumber, stop: false, sent: 0, attempts: 0, target: targetCount });

  await sendMessage(chatId, `📱 Starting SIMULATED SMS sending to +993${phoneNumber} 🔥` +
    (targetCount ? `\n🎯 Target: ${targetCount} successful sends` : `\n🎯 Target: unlimited (use /stop to halt)`));

  try {
    while (true) {
      const task = await kv.get<{ phoneNumber: string; stop: boolean; sent: number; attempts: number; target: number | null }>(key);
      if (!task.value || task.value.stop) break;

      // Determine how many to send this batch (max 3)
      const remaining = task.value.target ? Math.max(0, task.value.target - (task.value.sent ?? 0)) : null;
      if (remaining === 0) break;
      const batchSize = remaining === null ? 3 : Math.min(3, remaining);

      for (let i = 0; i < batchSize; i++) {
        const check = await kv.get(key);
        if (!check.value || check.value.stop) break;

        // simulate an attempt
        const ok = simulateSend();
        const newAttempts = (check.value.attempts ?? 0) + 1;
        const newSent = (check.value.sent ?? 0) + (ok ? 1 : 0);
        await kv.set(key, { ...check.value, attempts: newAttempts, sent: newSent });

        await sendMessage(chatId, `📤 Attempt #${newAttempts} → sending to +993${phoneNumber}...`);
        if (ok) {
          await sendMessage(chatId, `✅ Sent successfully! (successful: ${newSent})`);
        } else {
          await sendMessage(chatId, `❌ Simulated failure. Will retry in future batches. (successful: ${newSent})`);
        }

        // small interruptible delay between messages (5s)
        const sleepOk = await sleepInterruptible(5000, chatId);
        if (!sleepOk) break;
      }

      const afterBatch = await kv.get(key);
      if (!afterBatch.value || afterBatch.value.stop) break;

      // If target was set and reached -> finish
      if (afterBatch.value.target && (afterBatch.value.sent ?? 0) >= afterBatch.value.target) {
        await sendMessage(chatId, `🎉 Target reached: ${afterBatch.value.sent} successful sends.`);
        break;
      }

      // wait 45 seconds between batches (interruptible)
      await sendMessage(chatId, `⏳ Batch done. Waiting 45 seconds before next batch... (sent: ${afterBatch.value.sent}, attempts: ${afterBatch.value.attempts})`);
      const waitOk = await sleepInterruptible(45_000, chatId); // 45 seconds
      if (!waitOk) break;
    }
  } catch (e) {
    console.error("SMS task error ❌", e);
    await sendMessage(chatId, `⚠️ Task error: ${String(e)}`);
  } finally {
    await kv.delete(key);
    await sendMessage(chatId, "⏹ SIMULATED SMS sending stopped or finished. 🎉");
  }
}

// --- 🖥️ Webhook Server ---
serve(async (req) => {
  const url = new URL(req.url);
  if (req.method !== "POST" || url.pathname !== SECRET_PATH) return new Response("Invalid request ❌", { status: 400 });

  const update = await req.json().catch(() => null);
  if (!update || !update.message || update.message.chat.type !== "private") return new Response("OK");

  const chatId = String(update.message.chat.id);
  const text = (update.message.text ?? "").trim();
  const username = update.message.from?.username ?? "";

  if (username !== ADMIN_USERNAME) {
    await sendMessage(chatId, "🚫 Access denied! This bot is for @Masakoff only 👑");
    return new Response("OK");
  }

  if (text.startsWith("/start")) {
    await sendMessage(chatId,
      "👋 Welcome to 💥 Masakoff SMS Sender Bot (SIMULATED) 💥\n\n" +
      "📲 Commands:\n" +
      "• /send <number> <count> — start simulated sends (count = number of successful SMS to perform)\n" +
      "    Example: /send 61234567 10\n" +
      "• /send <number> 0 — start simulated unlimited sends (use /stop to halt)\n" +
      "• /stop — stop all sending ⛔\n\n" +
      "✨ This is a SIMULATED mode — no real SMS will be sent."
    );
  } else if (text.startsWith("/send")) {
    const parts = text.split(/\s+/);
    if (parts.length < 2) {
      await sendMessage(chatId, "⚠️ Please provide phone number. Example: /send 61234567 10");
      return new Response("OK");
    }

    const phoneNumber = parts[1].replace(/^\+993/, "");
    let countParam = parts[2] ?? null;

    // if count omitted treat as 0 (unlimited) — but we require explicit count for safety
    if (countParam === null) {
      await sendMessage(chatId, "⚠️ Please provide count. Example: /send 61234567 10. Use 0 for unlimited (not recommended).");
      return new Response("OK");
    }

    const parsed = Number(countParam);
    if (!Number.isInteger(parsed) || parsed < 0) {
      await sendMessage(chatId, "⚠️ Count must be an integer >= 0. Example: /send 61234567 10");
      return new Response("OK");
    }

    // Safety cap to avoid huge simulations (adjust as you like)
    const SAFETY_CAP = 10000;
    if (parsed > SAFETY_CAP) {
      await sendMessage(chatId, `⚠️ Count too large. Max allowed is ${SAFETY_CAP}.`);
      return new Response("OK");
    }

    const existing = await kv.get(["task", chatId]);
    if (existing.value && !existing.value.stop) {
      await sendMessage(chatId, "⚠️ A task is already running. Stop it first with /stop.");
      return new Response("OK");
    }

    const target = parsed === 0 ? null : parsed;
    runSMS(chatId, phoneNumber, target).catch(console.error);
    await sendMessage(chatId, `🚀 SIMULATED SMS sending started for +993${phoneNumber}` + (target ? ` (target ${target} successful sends)` : " (unlimited)"));
  } else if (text.startsWith("/stop")) {
    const task = await kv.get(["task", chatId]);
    if (!task.value) {
      await sendMessage(chatId, "ℹ️ No active SMS task to stop.");
    } else {
      await kv.set(["task", chatId], { ...task.value, stop: true });
      await sendMessage(chatId, "🛑 Stop signal sent! Tasks will halt instantly.");
    }
  } else if (text.startsWith("/status")) {
    const task = await kv.get(["task", chatId]);
    if (!task.value) {
      await sendMessage(chatId, "ℹ️ No active task.");
    } else {
      const v = task.value as { phoneNumber: string; stop: boolean; sent: number; attempts: number; target: number | null };
      await sendMessage(chatId, `🔎 Task status:\n• Phone: +993${v.phoneNumber}\n• Successful sent: ${v.sent}\n• Attempts: ${v.attempts}\n• Target: ${v.target ?? "unlimited"}\n• Stop flag: ${v.stop ? "yes" : "no"}`);
    }
  } else {
    await sendMessage(chatId, "❓ Unknown command. Try /start, /send <number> <count>, /status, or /stop.");
  }

  return new Response("OK");
});

// --- ♻️ Auto-recover unfinished tasks on startup ---
(async () => {
  console.log("🔄 Checking for unfinished tasks...");
  for await (const entry of kv.list<{ phoneNumber: string; stop: boolean; sent?: number; attempts?: number; target?: number | null }>({ prefix: ["task"] })) {
    if (entry.value && !entry.value.stop) {
      console.log(`Resuming simulated task for chat ${entry.key[1]} -> ${entry.value.phoneNumber} (sent: ${entry.value.sent ?? 0}, attempts: ${entry.value.attempts ?? 0})`);
      runSMS(entry.key[1] as string, entry.value.phoneNumber, entry.value.target ?? null).catch(console.error);
    }
  }
})();
