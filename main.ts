// main.ts
// 💥 Masakoff SMS Sender Bot — SAFE SIMULATION VERSION (Deno)
// 🚫 This version does NOT contact any real SMS gateway.
// ✅ It simulates sends and only counts "✅ Sent successfully!" as successes.
// 🧠 Uses Deno KV for persistence and resumes unfinished tasks on restart.
// ✨ /stop halts all tasks instantly, even during waits

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { delay } from "https://deno.land/std@0.224.0/async/delay.ts";

// --- 🔐 Telegram setup ---
const TOKEN = Deno.env.get("BOT_TOKEN");
if (!TOKEN) throw new Error("❌ BOT_TOKEN env var is required");
const API = `https://api.telegram.org/bot${TOKEN}`;
const SECRET_PATH = "/masakoffvpnhelper"; // keep your webhook path secret

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

// --- 🔬 Mock send request (simulation only) ---
// Simulates a POST to an SMS gateway. Returns true for success, false for failure.
// Success chance is configurable here (default 75%).
async function mockSendRequest(phoneWithPrefix: string, successChance = 0.75): Promise<boolean> {
  // simulate network latency
  await delay(300 + Math.floor(Math.random() * 400));
  return Math.random() < successChance;
}

// --- 🔁 Interruptible sleep ---
// Splits a long wait into small chunks and checks KV for stop flag between chunks.
// Returns true if completed full wait, false if interrupted (stop requested).
async function sleepInterruptible(totalMs: number, chatId: string, chunkMs = 500): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < totalMs) {
    const task = await kv.get(["task", chatId]);
    if (!task.value || task.value.stop) return false;
    await delay(Math.min(chunkMs, totalMs - (Date.now() - start)));
  }
  return true;
}

// --- 💣 SMS sending job (simulation) ---
// Parameters saved in KV: { phoneNumber, stop, targetSuccesses, successfulCount, totalAttempts }
async function runSMSSimulation(chatId: string, phoneNumber: string) {
  const key = ["task", chatId];
  // read saved task (in case of resume)
  const existing = await kv.get(key);
  const template = {
    phoneNumber,
    stop: false,
    targetSuccesses: existing.value?.targetSuccesses ?? null,
    successfulCount: existing.value?.successfulCount ?? 0,
    totalAttempts: existing.value?.totalAttempts ?? 0,
  };
  await kv.set(key, template);

  const phoneDisplay = `+993${phoneNumber}`; // keep original formatting from your example
  await sendMessage(chatId, `📱 Simulation started for ${phoneDisplay}.`);

  try {
    // If target not set yet, prompt admin (but we won't ask — we rely on /send setting target)
    while (true) {
      const task = await kv.get(key);
      if (!task.value || task.value.stop) break;

      // If targetSuccesses is null -> nothing to do (should not happen if /send provided count)
      const target = task.value.targetSuccesses;
      if (target === null || typeof target !== "number" || target <= 0) {
        await sendMessage(chatId, "⚠️ No target count set. Use `/send <phone> <counts>` to start (counts = how many ✅ successes you want).");
        break;
      }

      // If already reached target, finish
      if ((task.value.successfulCount ?? 0) >= target) {
        await sendMessage(chatId, `✅ Target reached: ${task.value.successfulCount}/${target} successful sends.`);
        break;
      }

      // Send a batch of up to 3 attempts
      for (let i = 0; i < 3; i++) {
        const check = await kv.get(key);
        if (!check.value || check.value.stop) break;

        // If reached target inside the loop, break
        if ((check.value.successfulCount ?? 0) >= target) break;

        // Increment total attempts immediately (attempted)
        const newTotal = (check.value.totalAttempts ?? 0) + 1;
        await kv.set(key, { ...check.value, totalAttempts: newTotal });

        await sendMessage(chatId, `📤 Attempt #${newTotal} to ${phoneDisplay}...`);

        // DO NOT call any real SMS gateway here — use mock
        const ok = await mockSendRequest(phoneDisplay);

        if (ok) {
          // increment successful count
          const now = await kv.get(key);
          const newSuccess = (now.value.successfulCount ?? 0) + 1;
          await kv.set(key, { ...now.value, successfulCount: newSuccess });
          await sendMessage(chatId, `✅ Sent successfully! (${newSuccess}/${target} ✅)`);
        } else {
          await sendMessage(chatId, "❌ Failed to send (simulated). Will continue.");
        }

        // If we reached target, break out early
        const after = await kv.get(key);
        if ((after.value.successfulCount ?? 0) >= target) break;

        // short interruptible pause between attempts (5 seconds)
        const shortWaitOk = await sleepInterruptible(5000, chatId);
        if (!shortWaitOk) break;
      }

      // After a batch, check again
      const batchCheck = await kv.get(key);
      if (!batchCheck.value || batchCheck.value.stop) break;

      if ((batchCheck.value.successfulCount ?? 0) >= batchCheck.value.targetSuccesses) {
        await sendMessage(chatId, `✅ Target reached: ${batchCheck.value.successfulCount}/${batchCheck.value.targetSuccesses} successful sends.`);
        break;
      }

      // Wait 45 seconds before next batch (interruptible)
      await sendMessage(chatId, "⏳ Batch done. Waiting 45 seconds before next batch...");
      const waitOk = await sleepInterruptible(45000, chatId);
      if (!waitOk) break;
    }
  } catch (e) {
    console.error("SMS simulation task error ❌", e);
    await sendMessage(chatId, "⚠️ A simulation error occurred. Check logs.");
  } finally {
    // Clean up only if stopped or completed
    const final = await kv.get(key);
    if (final.value) {
      // Keep record for history but remove active flag by deleting key
      await kv.delete(key);
    }
    await sendMessage(chatId, "⏹ Simulation stopped or finished. 🎉");
  }
}

// --- 🖥️ Webhook Server ---
serve(async (req) => {
  const url = new URL(req.url);
  if (req.method !== "POST" || url.pathname !== SECRET_PATH) {
    return new Response("Invalid request ❌", { status: 400 });
  }

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
      "• /send <number> <counts> — start simulation and stop when <counts> successful sends achieved\n" +
      "• /stop — stop all sending ⛔\n\n" +
      "✨ This is a SAFE simulation — it does NOT contact real SMS services."
    );
  } else if (text.startsWith("/send")) {
    // expects: /send 61234567 100
    const parts = text.split(/\s+/).filter(Boolean);
    if (parts.length < 3) {
      await sendMessage(chatId, "⚠️ Usage: /send <number> <counts>\nExample: /send 61234567 50");
      return new Response("OK");
    }

    const phoneNumberRaw = parts[1];
    const countRaw = parts[2];

    // sanitize phone: remove +993 if present, keep digits only
    const phoneNumber = phoneNumberRaw.replace(/^\+?/, "").replace(/^993/, "").replace(/\D/g, "");
    const targetCount = parseInt(countRaw, 10);

    if (!/^\d+$/.test(phoneNumber) || phoneNumber.length < 5) {
      await sendMessage(chatId, "⚠️ Phone number looks invalid after sanitization. Provide digits only. Example: /send 61234567 50");
      return new Response("OK");
    }
    if (isNaN(targetCount) || targetCount <= 0) {
      await sendMessage(chatId, "⚠️ Counts must be a positive integer. Example: /send 61234567 50");
      return new Response("OK");
    }

    const existing = await kv.get(["task", chatId]);
    if (existing.value && !existing.value.stop) {
      await sendMessage(chatId, "⚠️ A task is already running. Stop it first with /stop.");
      return new Response("OK");
    }

    // Initialize task state and start simulation
    await kv.set(["task", chatId], {
      phoneNumber,
      stop: false,
      targetSuccesses: targetCount,
      successfulCount: 0,
      totalAttempts: 0,
    });

    runSMSSimulation(chatId, phoneNumber).catch(console.error);
    await sendMessage(chatId, `🚀 Simulation started for +993${phoneNumber}. Target: ${targetCount} ✅ successes.`);
  } else if (text.startsWith("/stop")) {
    const task = await kv.get(["task", chatId]);
    if (!task.value) {
      await sendMessage(chatId, "ℹ️ No active simulation task to stop.");
    } else {
      await kv.set(["task", chatId], { ...task.value, stop: true });
      await sendMessage(chatId, "🛑 Stop signal sent! Tasks will halt instantly.");
    }
  } else if (text.startsWith("/status")) {
    const task = await kv.get(["task", chatId]);
    if (!task.value) {
      await sendMessage(chatId, "ℹ️ No active task.");
    } else {
      await sendMessage(chatId, `📊 Status:\n• Phone: +993${task.value.phoneNumber}\n• Target ✅: ${task.value.targetSuccesses}\n• Successful ✅: ${task.value.successfulCount}\n• Attempts: ${task.value.totalAttempts}\n• Stop flag: ${task.value.stop ? "true" : "false"}`);
    }
  } else {
    await sendMessage(chatId, "❓ Unknown command. Try /start, /send <number> <counts>, /stop, or /status.");
  }

  return new Response("OK");
});

// --- ♻️ Auto-recover unfinished tasks on startup ---
(async () => {
  console.log("🔄 Checking for unfinished simulation tasks...");
  for await (const entry of kv.list<{ phoneNumber: string; stop: boolean; targetSuccesses?: number }>({ prefix: ["task"] })) {
    if (entry.value && !entry.value.stop) {
      console.log(`Resuming simulation for chat ${entry.key[1]} -> ${entry.value.phoneNumber} (target ${entry.value.targetSuccesses})`);
      runSMSSimulation(entry.key[1] as string, entry.value.phoneNumber).catch(console.error);
    }
  }
})();
