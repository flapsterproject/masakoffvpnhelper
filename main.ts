// main.ts
// 💥 Masakoff SMS Sender Bot (Deno) — SAFE SIMULATION VERSION
// 🚫 This simulates requests only — it does NOT send SMS.
// ✅ Supports: /send <number> <counts>  (counts = target successful sends)
// 🛑 /stop halts tasks instantly, even during waits

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

// --- 🔁 Interruptible sleep ---
async function sleepInterruptible(totalMs: number, chatId: string, chunkMs = 500): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < totalMs) {
    const task = await kv.get(["task", chatId]);
    if (!task.value || task.value.stop) return false; // stopped
    const remaining = totalMs - (Date.now() - start);
    await delay(Math.min(chunkMs, Math.max(0, remaining)));
  }
  return true;
}

// --- ⚠️ Simulation of POST request (safe) ---
// Returns true = success, false = failure.
// This replaces any real SMS API call for testing.
async function simulatePostRequest(): Promise<boolean> {
  // small random delay to simulate network
  await delay(200 + Math.floor(Math.random() * 400));
  // 70% chance of success (tweak as needed)
  return Math.random() < 0.7;
}

// --- 💣 SMS sending job (SIMULATED) ---
async function runSMS(chatId: string, phoneNumber: string, targetSuccesses: number) {
  const key = ["task", chatId];
  // initialize task state
  await kv.set(key, { phoneNumber, stop: false, successCount: 0, attempts: 0, target: targetSuccesses });

  await sendMessage(chatId, `📱 Starting SIMULATED SMS sending to +993${phoneNumber} — target: ${targetSuccesses} ✅`);

  const batchSize = 3;        // attempts per batch
  const perAttemptMs = 5000;  // wait between attempts (5s)
  const betweenBatchesMs = 45000; // wait after each batch (45s)

  try {
    while (true) {
      const state = await kv.get(key);
      if (!state.value || state.value.stop) break;
      if ((state.value.successCount ?? 0) >= targetSuccesses) break;

      // send a batch of (up to) batchSize attempts, but stop early if target reached or /stop
      for (let i = 0; i < batchSize; i++) {
        const cur = await kv.get(key);
        if (!cur.value || cur.value.stop) break;
        if ((cur.value.successCount ?? 0) >= targetSuccesses) break;

        // increment attempts
        const attempts = (cur.value.attempts ?? 0) + 1;
        await kv.set(key, { ...cur.value, attempts });

        await sendMessage(chatId, `📤 Attempt #${attempts} → sending simulated request to +993${phoneNumber}...`);
        const ok = await simulatePostRequest();

        const updated = await kv.get(key);
        if (!updated.value) break;

        if (ok) {
          const newSuccess = (updated.value.successCount ?? 0) + 1;
          await kv.set(key, { ...updated.value, successCount: newSuccess });
          await sendMessage(chatId, `✅ Sent successfully! (${newSuccess}/${targetSuccesses})`);
        } else {
          // failure: attempts increased but successCount unchanged
          await sendMessage(chatId, `❌ Simulated failure. Successes: ${updated.value.successCount ?? 0}/${targetSuccesses}`);
        }

        // if reached target, break early
        const after = await kv.get(key);
        if (!after.value || after.value.stop) break;
        if ((after.value.successCount ?? 0) >= targetSuccesses) break;

        // wait between attempts, but allow /stop to interrupt
        const okSleep = await sleepInterruptible(perAttemptMs, chatId);
        if (!okSleep) break;
      }

      // check stop/target again before waiting the between-batches pause
      const afterBatch = await kv.get(key);
      if (!afterBatch.value || afterBatch.value.stop) break;
      if ((afterBatch.value.successCount ?? 0) >= targetSuccesses) break;

      await sendMessage(chatId, `⏳ Batch completed. Waiting ${Math.round(betweenBatchesMs / 1000)}s before next batch...`);
      const okWait = await sleepInterruptible(betweenBatchesMs, chatId);
      if (!okWait) break;
    }
  } catch (e) {
    console.error("SMS task error ❌", e);
  } finally {
    // final state & cleanup
    const final = await kv.get(key);
    if (final.value) {
      const successCount = final.value.successCount ?? 0;
      const attempts = final.value.attempts ?? 0;
      await sendMessage(
        chatId,
        `⏹ SIMULATION finished. Summary:\n• Phone: +993${phoneNumber}\n• Successful sends: ${successCount}/${targetSuccesses}\n• Total attempts: ${attempts}`
      );
    } else {
      await sendMessage(chatId, "⏹ SIMULATION finished. No task state found.");
    }
    await kv.delete(key);
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

  if (text.startsWith("/start")) {
    await sendMessage(chatId,
      "👋 Welcome to 💥 Masakoff SMS Sender Bot (SIMULATION) 💥\n\n" +
      "📲 Commands:\n" +
      "• /send <number> <counts> — start simulated sending; counts = number of successful sends desired\n" +
      "• /stop — stop current job immediately\n\n" +
      "✨ This is a SAFE demo: no real SMS are sent."
    );
  } else if (text.startsWith("/send")) {
    const parts = text.split(/\s+/).filter(Boolean);
    if (parts.length < 3) {
      await sendMessage(chatId, "⚠️ Usage: /send <number> <counts>\nExample: /send 61234567 10");
      return new Response("OK");
    }

    const phoneNumberRaw = parts[1];
    const countsRaw = parts[2];

    const phoneNumber = phoneNumberRaw.replace(/^\+?993/, ""); // strip +993 if given
    const target = parseInt(countsRaw, 10);
    if (Number.isNaN(target) || target <= 0) {
      await sendMessage(chatId, "⚠️ counts must be a positive integer. Example: /send 61234567 10");
      return new Response("OK");
    }

    const existing = await kv.get(["task", chatId]);
    if (existing.value && !existing.value.stop) {
      await sendMessage(chatId, "⚠️ A task is already running. Stop it first with /stop.");
      return new Response("OK");
    }

    // kick off the simulated job (no await so server returns quickly)
    runSMS(chatId, phoneNumber, target).catch(console.error);
    await sendMessage(chatId, `🚀 SIMULATION started for +993${phoneNumber} — target ${target} successes`);
  } else if (text.startsWith("/stop")) {
    const task = await kv.get(["task", chatId]);
    if (!task.value) {
      await sendMessage(chatId, "ℹ️ No active SIMULATION task to stop.");
    } else {
      await kv.set(["task", chatId], { ...task.value, stop: true });
      await sendMessage(chatId, "🛑 Stop signal sent! Task will halt instantly.");
    }
  } else {
    await sendMessage(chatId, "❓ Unknown command. Try /start, /send <number> <counts>, or /stop.");
  }

  return new Response("OK");
});

// --- ♻️ Auto-recover unfinished simulated tasks on startup ---
(async () => {
  console.log("🔄 Checking for unfinished tasks (SIMULATION)...");
  for await (const entry of kv.list<{ phoneNumber: string; stop: boolean; successCount?: number; attempts?: number; target?: number }>({ prefix: ["task"] })) {
    if (entry.value && !entry.value.stop) {
      const chat = entry.key[1] as string;
      const phone = entry.value.phoneNumber;
      const target = entry.value.target ?? 1;
      console.log(`Resuming simulated task for chat ${chat} -> ${phone} (target ${target})`);
      runSMS(chat, phone, target).catch(console.error);
    }
  }
})();
