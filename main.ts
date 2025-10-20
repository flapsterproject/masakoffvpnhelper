// main.ts
// Telegram AI Chat Bot (Deno) - Integrated with Puter for storage and Gemini AI
// Features: AI chat, profiles with stats (Puter KV), leaderboard with pagination, admin (/addtouser)
// Notes: Requires BOT_TOKEN and PUTER_TOKEN env vars. Deploy as webhook at SECRET_PATH.
// Uses Puter API for KV storage and Gemini for AI responses.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const TOKEN = Deno.env.get("BOT_TOKEN")!;
if (!TOKEN) throw new Error("BOT_TOKEN env var is required");
const API = `https://api.telegram.org/bot${TOKEN}`;
const PUTER_API = `https://api.puter.com`;
const SECRET_PATH = "/masakoffvpnhelper"; // make sure webhook path matches

const ADMIN_USERNAME = "@Masakoff"; // keep as username check; can be changed to ID if desired

// runtime storages
const globalMessageStates: Record<string, boolean> = {};

// -------------------- Puter helpers --------------------
async function callPuterAPI(body: any) {
  try {
    const res = await fetch(`${PUTER_API}/drivers/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${PUTER_TOKEN}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Puter API error: ${res.status}`);
    return await res.json();
  } catch (e) {
    console.error("callPuterAPI error", e);
    return null;
  }
}

// Puter KV wrapper
const puterKV = {
  async get(key: string[]): Promise<any> {
    const path = key.join("/");
    const data = await callPuterAPI({
      interface: "puter-kv",
      driver: "local",
      method: "get",
      args: { key: path },
    });
    return data ?? null;
  },
  async set(key: string[], value: any): Promise<void> {
    const path = key.join("/");
    await callPuterAPI({
      interface: "puter-kv",
      driver: "local",
      method: "set",
      args: { key: path, value },
    });
  },
  async list({ prefix }: { prefix: string[] }): Promise<{ key: string[]; value: any }[]> {
    const data = await callPuterAPI({
      interface: "puter-kv",
      driver: "local",
      method: "list",
      args: { prefix: prefix.join("/") },
    });
    return data?.map((item: any) => ({ key: item.key.split("/"), value: item.value })) ?? [];
  },
};

// AI chat using Gemini via Puter
async function aiChat(prompt: string): Promise<string> {
  const data = await callPuterAPI({
    interface: "puter-chat-completion",
    driver: "google-gemini",
    method: "complete",
    args: {
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: prompt },
      ],
      model: "google/gemini-2.5-pro-exp-03-25:free",
    },
  });
  return data?.text ?? "Sorry, I couldn't generate a response.";
}

// -------------------- Telegram helpers --------------------
async function sendMessage(chatId: string | number, text: string, options: any = {}): Promise<number | null> {
  try {
    const body: any = { chat_id: chatId, text, ...options };
    const res = await fetch(`${API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return data.result?.message_id ?? null;
  } catch (e) {
    console.error("sendMessage error", e);
    return null;
  }
}

// -------------------- Profile helpers --------------------
type Profile = {
  id: string;
  username?: string;
  displayName: string;
  messagesSent: number;
  lastActive: number;
};

function getDisplayName(p: Profile) {
  return p.displayName && p.displayName !== "" ? p.displayName : `ID:${p.id}`;
}

async function initProfile(userId: string, username?: string, displayName?: string) {
  const key = ["profiles", userId];
  let profile = await puterKV.get(key);
  if (!profile) {
    profile = {
      id: userId,
      username,
      displayName: displayName || `ID:${userId}`,
      messagesSent: 0,
      lastActive: Date.now(),
    };
    await puterKV.set(key, profile);
  } else {
    let changed = false;
    if (username && username !== profile.username) {
      profile.username = username;
      changed = true;
    }
    if (displayName && displayName !== profile.displayName) {
      profile.displayName = displayName;
      changed = true;
    }
    profile.lastActive = Date.now();
    if (changed) await puterKV.set(key, profile);
  }
  return profile;
}

async function getProfile(userId: string): Promise<Profile | null> {
  return await puterKV.get(["profiles", userId]);
}

async function updateProfile(userId: string, delta: Partial<Profile>) {
  const existing = await getProfile(userId) || await initProfile(userId);
  const newProfile: Profile = {
    ...existing,
    username: delta.username ?? existing.username,
    displayName: delta.displayName ?? existing.displayName,
    messagesSent: (existing.messagesSent || 0) + (delta.messagesSent ?? 0),
    lastActive: Date.now(),
    id: existing.id,
  };
  await puterKV.set(["profiles", userId], newProfile);
  return newProfile;
}

async function sendProfile(chatId: string) {
  await initProfile(chatId);
  const p = (await getProfile(chatId))!;
  const msg = `🏅 *Profile: ${getDisplayName(p)}*\n\n` +
    `🆔 ID: \`${p.id}\`\n\n` +
    `💬 Messages Sent: *${p.messagesSent}*\n` +
    `📅 Last Active: *${new Date(p.lastActive).toLocaleString()}*`;
  await sendMessage(chatId, msg, { parse_mode: "Markdown" });
}

// -------------------- Leaderboard helpers --------------------
async function getLeaderboard(top = 10, offset = 0) {
  const entries = await puterKV.list({ prefix: ["profiles"] });
  const players: Profile[] = entries.map(e => e.value);
  players.sort((a, b) => b.messagesSent - a.messagesSent);
  return players.slice(offset, offset + top);
}

async function sendLeaderboard(chatId: string, page = 0) {
  const perPage = 10;
  const offset = page * perPage;
  const topPlayers = await getLeaderboard(perPage, offset);

  if (topPlayers.length === 0) {
    await sendMessage(chatId, "No users yet! Start chatting to climb the leaderboard!");
    return;
  }

  let msg = `🏆 *Leaderboard* — Page ${page + 1}\n\n`;
  topPlayers.forEach((p, i) => {
    const rankNum = offset + i + 1;
    const name = getDisplayName(p);
    msg += `*${rankNum}.* ${name} — 💬 *${p.messagesSent}*\n`;
  });

  const keyboard: any = { inline_keyboard: [] };
  const row: any[] = [];
  if (page > 0) row.push({ text: "⬅️ Previous", callback_data: `leaderboard:${page - 1}` });
  if (topPlayers.length === perPage) row.push({ text: "Next ➡️", callback_data: `leaderboard:${page + 1}` });
  if (row.length) keyboard.inline_keyboard.push(row);

  await sendMessage(chatId, msg, { reply_markup: keyboard, parse_mode: "Markdown" });
}

// -------------------- Callback handler --------------------
async function handleCallback(fromId: string, data: string | null, callbackId: string) {
  if (!data) {
    await answerCallbackQuery(callbackId);
    return;
  }
  try {
    if (data.startsWith("leaderboard:")) {
      const page = parseInt(data.split(":")[1]) || 0;
      await sendLeaderboard(fromId, page);
      await answerCallbackQuery(callbackId);
      return;
    }

    await answerCallbackQuery(callbackId);
  } catch (e) {
    console.error("handleCallback error", e);
  }
}

async function answerCallbackQuery(id: string, text = "", showAlert = false) {
  try {
    await fetch(`${API}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: id, text, show_alert: showAlert }),
    });
  } catch (e) {
    console.warn("answerCallbackQuery failed", e?.message ?? e);
  }
}

// -------------------- Commands --------------------
async function handleCommand(fromId: string, username: string | undefined, displayName: string, text: string) {
  if (text.startsWith("/profile")) {
    await sendProfile(fromId);
    return;
  }

  if (text.startsWith("/leaderboard")) {
    await sendLeaderboard(fromId, 0);
    return;
  }

  if (text.startsWith("/addtouser")) {
    if (username !== ADMIN_USERNAME.replace("@", "")) {
      await sendMessage(fromId, "❌ Unauthorized.");
      return;
    }
    const parts = text.trim().split(/\s+/);
    if (parts.length < 3) {
      await sendMessage(fromId, "Usage: `/addtouser <userId> <messages>`", { parse_mode: "Markdown" });
      return;
    }

    const userId = parts[1];
    const messages = parseInt(parts[2]);

    if (isNaN(messages)) {
      await sendMessage(fromId, "Invalid messages value. Please provide a number.");
      return;
    }

    await updateProfile(userId, { messagesSent: messages });
    await sendMessage(fromId, `✅ Added ${messages} messages to ID:${userId}`);
    return;
  }

  if (text.startsWith("/globalmessage")) {
    if (username !== ADMIN_USERNAME.replace("@", "")) {
      await sendMessage(fromId, "❌ Unauthorized.");
      return;
    }
    globalMessageStates[fromId] = true;
    await sendMessage(fromId, "✏️ Write your global message:");
    return;
  }

  if (text.startsWith("/start") || text.startsWith("/help")) {
    const helpText =
      `🎮 *AI Chat Bot-a hoş geldiňiz!*\n\n` +
      `Bot bilen söhbetdeş boluň, ýa-da buýruklary ulanyň:\n` +
      `🔹 /profile - Statistikalaryňyzy gör.\n` +
      `🔹 /leaderboard - Iň aktiw ulanyjylary gör.\n\n` +
      `Söhbetdeşlige başlaň we AI bilen gürleşiň!`;
    await sendMessage(fromId, helpText, { parse_mode: "Markdown" });
    return;
  }

  await sendMessage(fromId, "❓ Unknown command. Use /help for commands.");
}

// -------------------- Server / Webhook --------------------
serve(async (req: Request) => {
  try {
    const url = new URL(req.url);
    if (url.pathname !== SECRET_PATH) return new Response("Not found", { status: 404 });
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

    const update = await req.json();

    // handle normal messages
    if (update.message) {
      const msg = update.message;
      const from = msg.from;
      const text = (msg.text || "").trim();
      const fromId = String(from.id);
      const username = from.username;
      const displayName = from.first_name || from.username || fromId;

      // Ensure profile exists
      await initProfile(fromId, username, displayName);

      if (text.startsWith("/")) {
        await handleCommand(fromId, username, displayName, text);
      } else if (globalMessageStates[fromId]) {
        // Admin is writing the global message
        globalMessageStates[fromId] = false;

        // Broadcast to all users
        const entries = await puterKV.list({ prefix: ["profiles"] });
        for (const entry of entries) {
          const profile = entry.value as Profile;
          if (profile) await sendMessage(profile.id, `📢 *Global Message:*\n\n${text}`, { parse_mode: "Markdown" });
        }

        await sendMessage(fromId, "✅ Global message sent!");
      } else {
        // Handle AI chat response
        const response = await aiChat(text);
        await sendMessage(fromId, response);
        await updateProfile(fromId, { messagesSent: 1 });
      }
    }
    // handle callback queries
    else if (update.callback_query) {
      const cb = update.callback_query;
      const fromId = String(cb.from.id);
      const data = cb.data ?? null;
      await handleCallback(fromId, data, cb.id);
    }

    return new Response("OK");
  } catch (e) {
    console.error("server error", e);
    return new Response("Error", { status: 500 });
  }
});

