// main.ts
// Telegram Checkers Bot (Deno)
// Features: matchmaking (/battle), private-game with inline buttons,
// profiles with stats (Deno KV), leaderboard with pagination, admin (/addtouser)
// Match = best of 3 rounds

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const TOKEN = Deno.env.get("BOT_TOKEN")!;
if (!TOKEN) throw new Error("BOT_TOKEN env var is required");
const API = `https://api.telegram.org/bot${TOKEN}`;
const SECRET_PATH = "/checkersbot";

// -------------------- Deno KV --------------------
const kv = await Deno.openKv();
const ADMIN_USERNAME = "@amangeldimasakov";

// -------------------- Helpers --------------------
async function sendMessage(chatId: string, text: string, options: any = {}): Promise<number | null> {
  try {
    const res = await fetch(`${API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, ...options }),
    });
    const data = await res.json();
    return data.result?.message_id ?? null;
  } catch (e) {
    console.error("sendMessage error", e);
    return null;
  }
}

async function editMessageText(chatId: string, messageId: number, text: string, options: any = {}) {
  try {
    await fetch(`${API}/editMessageText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId, text, ...options }),
    });
  } catch (e) {
    console.warn("editMessageText failed", e?.message ?? e);
  }
}

async function answerCallbackQuery(id: string, text = "") {
  try {
    await fetch(`${API}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: id, text }),
    });
  } catch (e) {
    console.warn("answerCallbackQuery failed", e?.message ?? e);
  }
}

// -------------------- Profiles --------------------
type Profile = {
  id: string;
  username?: string;
  displayName: string;
  trophies: number;
  gamesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  lastActive: number;
};

function getDisplayName(p: Profile) {
  return `ID:${p.id}`;
}

async function initProfile(userId: string, username?: string, displayName?: string) {
  const key = ["profiles", userId];
  const value = await kv.get(key);
  if (!value.value) {
    const profile: Profile = {
      id: userId,
      username,
      displayName: displayName || userId,
      trophies: 1000,
      gamesPlayed: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      lastActive: Date.now(),
    };
    await kv.set(key, profile);
    return profile;
  } else {
    const existing = value.value as Profile;
    existing.lastActive = Date.now();
    if (username) existing.username = username;
    if (displayName) existing.displayName = displayName;
    await kv.set(key, existing);
    return existing;
  }
}

async function getProfile(userId: string): Promise<Profile | null> {
  const res = await kv.get(["profiles", userId]);
  return (res.value as Profile) ?? null;
}

async function updateProfile(userId: string, delta: Partial<Profile>) {
  const existing = (await getProfile(userId)) || (await initProfile(userId));
  const newProfile: Profile = {
    ...existing,
    ...delta,
    trophies: (existing.trophies || 1000) + (delta.trophies ?? 0),
    gamesPlayed: (existing.gamesPlayed || 0) + (delta.gamesPlayed ?? 0),
    wins: (existing.wins || 0) + (delta.wins ?? 0),
    losses: (existing.losses || 0) + (delta.losses ?? 0),
    draws: (existing.draws || 0) + (delta.draws ?? 0),
    lastActive: Date.now(),
  };
  await kv.set(["profiles", userId], newProfile);
  return newProfile;
}

// -------------------- Leaderboard --------------------
async function getLeaderboard(top = 10, offset = 0) {
  const players: Profile[] = [];
  for await (const entry of kv.list({ prefix: ["profiles"] })) {
    players.push(entry.value as Profile);
  }
  players.sort((a, b) => b.trophies - a.trophies);
  return players.slice(offset, offset + top);
}

async function sendLeaderboard(chatId: string, page = 0) {
  const perPage = 10;
  const offset = page * perPage;
  const topPlayers = await getLeaderboard(perPage, offset);

  if (!topPlayers.length) return await sendMessage(chatId, "No players yet!");

  let msg = `🏆 Leaderboard — Page ${page + 1}\n\n`;
  topPlayers.forEach((p, i) => {
    const rankNum = offset + i + 1;
    const winRate = p.gamesPlayed ? ((p.wins / p.gamesPlayed) * 100).toFixed(1) : "0";
    msg += `${rankNum}. ${getDisplayName(p)} — 🏆 ${p.trophies} | W:${p.wins} L:${p.losses} D:${p.draws} | WinRate:${winRate}%\n`;
  });

  const keyboard: any = { inline_keyboard: [] };
  const row: any[] = [];
  if (page > 0) row.push({ text: "⬅️ Prev", callback_data: `leaderboard:${page - 1}` });
  if (topPlayers.length === perPage) row.push({ text: "Next ➡️", callback_data: `leaderboard:${page + 1}` });
  if (row.length) keyboard.inline_keyboard.push(row);

  await sendMessage(chatId, msg, { reply_markup: keyboard });
}

// -------------------- Checkers Board --------------------
type BoardCell = "RED" | "BLUE" | "RED_KING" | "BLUE_KING" | "EMPTY" | "LIGHT";

function createBoard(): BoardCell[][] {
  const board: BoardCell[][] = [];
  for (let r = 0; r < 8; r++) {
    const row: BoardCell[] = [];
    for (let c = 0; c < 8; c++) {
      if ((r + c) % 2 === 0) row.push("LIGHT");
      else if (r < 3) row.push("BLUE");
      else if (r > 4) row.push("RED");
      else row.push("EMPTY");
    }
    board.push(row);
  }
  return board;
}

function boardToText(board: BoardCell[][]) {
  const map = {
    RED: "🔴",
    BLUE: "🔵",
    RED_KING: "👑",
    BLUE_KING: "👑",
    EMPTY: "⬛",
    LIGHT: "⬜",
  };
  return board.map((row) => row.map((c) => map[c]).join("")).join("\n");
}

// -------------------- Game State --------------------
let queue: string[] = [];
const battles: Record<string, any> = {}; // battle keyed by userId

// -------------------- Helper for Inline Buttons --------------------
function generateBoardKeyboard(board: BoardCell[][], selected: { r: number; c: number } | null = null) {
  const keyboard: any[] = [];
  for (let r = 0; r < 8; r++) {
    const row: any[] = [];
    for (let c = 0; c < 8; c++) {
      const cell = board[r][c];
      let text = "";
      switch (cell) {
        case "RED": text = "🔴"; break;
        case "BLUE": text = "🔵"; break;
        case "RED_KING": text = "👑"; break;
        case "BLUE_KING": text = "👑"; break;
        case "EMPTY": text = "⬛"; break;
        case "LIGHT": text = "⬜"; break;
      }
      row.push({ text, callback_data: `cell:${r}:${c}` });
    }
    keyboard.push(row);
  }
  if (selected) keyboard.push([{ text: "Cancel", callback_data: "cancel" }]);
  return { inline_keyboard: keyboard };
}

// -------------------- TODO --------------------
// 1. Implement piece selection and valid moves highlighting
// 2. Implement move execution, captures, multi-jumps
// 3. Implement king promotion
// 4. Implement victory detection
// 5. Implement best-of-3 rounds
// 6. Handle callback_query for cell selection and moves

// -------------------- HTTP Handler --------------------
serve(async (req) => {
  const url = new URL(req.url);
  if (!url.pathname.endsWith(SECRET_PATH)) return new Response("Forbidden", { status: 403 });
  const update = await req.json();

  try {
    if (update.message) {
      const chatId = String(update.message.chat.id);
      const text = update.message.text ?? "";
      const from = update.message.from;
      const username = from.username ? `@${from.username}` : undefined;
      const displayName = from.first_name ?? from.username ?? String(from.id);

      await initProfile(String(from.id), username, displayName);

      if (text === "/profile") await sendProfile(String(from.id));
      if (text === "/leaderboard") await sendLeaderboard(String(from.id), 0);
      if (text === "/battle") {
        const userKey = String(from.id);
        if (battles[userKey]) return await sendMessage(chatId, "⚔️ Already in a game!");
        if (queue.includes(userKey)) return await sendMessage(chatId, "⌛ Searching opponent...");
        if (queue.length > 0 && queue[0] !== userKey) {
          const opponent = queue.shift()!;
          // TODO: startBattle(userKey, opponent) with createBoard()
        } else queue.push(userKey), await sendMessage(chatId, "🔎 Searching opponent...");
      }
    }

    if (update.callback_query) {
      const fromId = String(update.callback_query.from.id);
      const data = update.callback_query.data;
      await answerCallbackQuery(update.callback_query.id, "Move received");
      // TODO: handle selection, move execution, captures, king promotion
    }
  } catch (e) {
    console.error("Error handling update", e);
  }

  return new Response("ok");
});
