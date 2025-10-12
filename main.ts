// main.ts
// Masakoff SMS Sender Bot (Deno)
// Legitimate SMS sender (authorized/testing use only).
// Created by @Masakoff
// 🚀✨ Friendly messages, admin-only access, confirmation required before sending

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { delay } from "https://deno.land/std@0.224.0/async/delay.ts";

// --- Telegram settings ---
const TOKEN = Deno.env.get("BOT_TOKEN");
if (!TOKEN) throw new Error("❌ BOT_TOKEN env var is required");
const API = `https://api.telegram.org/bot${TOKEN}`;
const SECRET_PATH = "/masakoffvpnhelper";

// --- Admin usernames ---
const ADMINS = ["Masakoff", "FlapsterMinerManager"];

// --- Helper to send Telegram messages ---
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

// --- Send POST request function ---
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

// --- Map to track running SMS tasks per chat ---
const activeTasks = new Map<string, { stop: boolean }>();

// --- SMS sending logic ---
// NOTE: This function assumes sending only to numbers with explicit authorization.
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

  while (!task.stop) {
    for (let batch = 0; batch < 3; batch++) {
      if (task.stop) break;
      count++;
      for (const req of requestsData) {
        if (task.stop) break;
        await sendMessage(chatId, `📤 Sending SMS #${count} to +993${phoneNumber} (authorized test)...`);
        const success = await sendPostRequest(req.url, req.headers, req.data);
        await sendMessage(chatId, success ? "✅ Sent successfully (200 OK)" : "⛔ Failed to send (network/error).");
        await delay(5000); // 5s between each SMS
      }
    }
    if (task.stop) break;
    await sendMessage(chatId, "⏳ Batch of 3 SMS completed. Waiting 45 seconds before next authorized batch...");
    await delay(45000); // 45s pause before next batch
  }

  activeTasks.delete(chatId);
  await sendMessage(chatId, "⏹ SMS sending stopped. Bot by @Masakoff — authorized use only. 🎉");
}

// --- Simple state to hold pending confirmation per chat ---
const pendingConfirmations = new Map<string, { phone: string }>();

// --- Webhook server ---
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

  // --- Admin check ---
  if (!ADMINS.includes(username)) {
    await sendMessage(chatId, "❌ Access denied. This bot is for authorized admins only.");
    return new Response("OK");
  }

  // --- Commands ---
  if (text.startsWith("/start")) {
    await sendMessage(
      chatId,
      "👋 Welcome! This is an SMS sender bot created by @Masakoff.\n\n⚠️ IMPORTANT: This bot is for **authorized/testing** use only. Do not use it to send unsolicited messages.\n\n📲 Commands:\n/send <number> — request sending to a number (will require confirmation)\n/confirm — confirm a pending send\n/stop — stop ongoing sending\n/help — list commands"
    );
  } else if (text.startsWith("/help")) {
    await sendMessage(
      chatId,
      "📘 Help — Authorized SMS Sender Bot\n\n/send <number> — Request to send SMS to +993<number> (will ask for confirmation first)\n/confirm — Confirm the pending send (required)\n/stop — Stop any ongoing sending for this chat\n/status — Show active sending status\n\nBot created by @Masakoff — for authorized/testing purposes only."
    );
  } else if (text.startsWith("/send")) {
    const parts = text.split(" ");
    if (parts.length < 2) {
      await sendMessage(chatId, "⚠️ Please provide a phone number. Example:\n/send 12345678");
    } else {
      const phoneNumber = parts[1].replace(/^\+993/, "");
      // Store pending confirmation
      pendingConfirmations.set(chatId.toString(), { phone: phoneNumber });
      await sendMessage(
        chatId,
        `⚠️ Confirmation required.\nYou requested to start sending to +993${phoneNumber}.\nIf this is an authorized test, reply with /confirm to proceed. Otherwise, reply /cancel.`
      );
    }
  } else if (text === "/confirm") {
    const pending = pendingConfirmations.get(chatId.toString());
    if (!pending) {
      await sendMessage(chatId, "ℹ️ No pending send request found. Use /send <number> first.");
    } else {
      pendingConfirmations.delete(chatId.toString());
      await sendMessage(chatId, `🚀 Confirmed. Starting authorized sending to +993${pending.phone}...`);
      // Start sending (non-blocking)
      sendSMS(pending.phone, chatId).catch(console.error);
    }
  } else if (text === "/cancel") {
    if (pendingConfirmations.delete(chatId.toString())) {
      await sendMessage(chatId, "✅ Pending send request canceled.");
    } else {
      await sendMessage(chatId, "ℹ️ No pending request to cancel.");
    }
  } else if (text === "/stop") {
    const task = activeTasks.get(chatId.toString());
    if (task) {
      task.stop = true;
      await sendMessage(chatId, "⏹ Stop signal sent. Stopping authorized sending...");
    } else {
      await sendMessage(chatId, "ℹ️ No active SMS sending found for this chat.");
    }
  } else if (text === "/status") {
    const active = activeTasks.has(chatId.toString());
    await sendMessage(chatId, active ? "🔴 Sending is active for this chat." : "🟢 No active sending for this chat.");
  } else {
    await sendMessage(chatId, "❓ Unknown command. Use /help to see available commands.");
  }

  return new Response("OK");
});




