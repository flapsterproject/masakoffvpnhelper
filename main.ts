// main.ts
// Telegram Checkers Bot (Deno)
// Features: matchmaking (/battle), private-game with inline buttons,
// profiles with stats (Deno KV), leaderboard with pagination, admin (/addtouser)
// Match = best of 3 rounds

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const TOKEN = Deno.env.get("BOT_TOKEN")!;
if (!TOKEN) throw new Error("BOT_TOKEN env var is required");
const API = `https://api.telegram.org/bot${TOKEN}`;
const SECRET_PATH = "/masakoffvpnhelper";

// Deno KV
const kv = await Deno.openKv();
const ADMIN_USERNAME = "@amangeldimasakov";

let queue: string[] = [];
const battles: Record<string, any> = {};

// -------------------- Telegram Helpers --------------------
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

// -------------------- Profile Helpers --------------------
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
    let changed = false;
    if (username && username !== existing.username) {
      existing.username = username;
      changed = true;
    }
    if (displayName && displayName !== existing.displayName) {
      existing.displayName = displayName;
      changed = true;
    }
    existing.lastActive = Date.now();
    if (changed) await kv.set(key, existing);
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

function getRank(trophies: number) {
  if (trophies < 1000) return "🥉 Bronze";
  if (trophies < 1500) return "🥈 Silver";
  if (trophies < 2000) return "🥇 Gold";
  return "💎 Diamond";
}

async function sendProfile(chatId: string) {
  await initProfile(chatId);
  const p = (await getProfile(chatId))!;
  const date = new Date(p.lastActive).toLocaleString();
  const winRate = p.gamesPlayed ? ((p.wins / p.gamesPlayed) * 100).toFixed(1) : "0";
  const msg =
    `🏅 Profile of ${getDisplayName(p)}\n` +
    `Trophies: ${p.trophies} 🏆\n` +
    `Rank: ${getRank(p.trophies)}\n` +
    `Games: ${p.gamesPlayed}\n` +
    `Wins: ${p.wins} | Losses: ${p.losses} | Draws: ${p.draws}\n` +
    `Win Rate: ${winRate}%\n` +
    `Last active: ${date}`;
  await sendMessage(chatId, msg);
}

// -------------------- Leaderboard Helpers --------------------
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

  if (topPlayers.length === 0) {
    await sendMessage(chatId, "No players yet!");
    return;
  }

  let msg = `🏆 Leaderboard — Page ${page + 1}\n\n`;
  topPlayers.forEach((p, i) => {
    const rankNum = offset + i + 1;
    const name = getDisplayName(p);
    const winRate = p.gamesPlayed ? ((p.wins / p.gamesPlayed) * 100).toFixed(1) : "0";
    msg += `${rankNum}. ${name} — 🏆 ${p.trophies} | Wins: ${p.wins}, Losses: ${p.losses}, Draws: ${p.draws} | WinRate: ${winRate}%\n`;
  });

  const keyboard: any = { inline_keyboard: [] };
  const row: any[] = [];
  if (page > 0) row.push({ text: "⬅️ Prev", callback_data: `leaderboard:${page - 1}` });
  if (topPlayers.length === perPage) row.push({ text: "Next ➡️", callback_data: `leaderboard:${page + 1}` });
  if (row.length) keyboard.inline_keyboard.push(row);

  await sendMessage(chatId, msg, { reply_markup: keyboard });
}

// -------------------- Checkers Game Logic --------------------
const EMPTY = "⬛";
const RED = "🔴";
const BLUE = "🔵";
const RED_KING = "👑"; // you can color for kings differently if you like
const BLUE_KING = "👑";

function createStartingBoard(): string[][] {
  const board: string[][] = Array.from({ length: 8 }, () => Array(8).fill("⬜"));
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 8; c++) {
      if ((r + c) % 2 === 1) board[r][c] = BLUE;
    }
  }
  for (let r = 5; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if ((r + c) % 2 === 1) board[r][c] = RED;
    }
  }
  return board;
}

function boardToText(board: string[][]) {
  return board.map((row) => row.join("")).join("\n");
}

// TODO: implement valid moves, captures, king promotion logic, inline buttons generation for moves
// The rest of battle flow (startBattle, handleCallback, rounds, turn switching) is similar to Tic-Tac-Toe bot,
// just adapted to 8x8 checkers board and RED/BLUE pieces

// -------------------- HTTP Handler --------------------
serve(async (req) => {
  try {
    const url = new URL(req.url);
    if (!url.pathname.endsWith(SECRET_PATH)) return new Response("Forbidden", { status: 403 });
    const update = await req.json();

    if (update.message) {
      const chatId = String(update.message.chat.id);
      const text = update.message.text ?? "";
      const from = update.message.from;
      const username = from.username ? `@${from.username}` : undefined;
      const displayName = from.first_name ?? from.username ?? String(from.id);

      await initProfile(String(from.id), username, displayName);

      // Commands
      if (text === "/battle") {
        const userKey = String(update.message.from.id);
        if (battles[userKey]) {
          await sendMessage(chatId, "⚔️ You are already in a game!");
        } else if (queue.includes(userKey)) {
          await sendMessage(chatId, "⌛ Searching for opponent...");
        } else if (queue.length > 0 && queue[0] !== userKey) {
          const opponent = queue.shift()!;
          // startBattleCheckers(userKey, opponent) <-- implement similar to Tic-Tac-Toe startBattle
        } else {
          queue.push(userKey);
          await sendMessage(chatId, "🔎 Searching opponent...");
        }
      }

      if (text === "/profile") await sendProfile(String(update.message.from.id));
      if (text === "/leaderboard") await sendLeaderboard(String(update.message.from.id), 0);
    }

    if (update.callback_query) {
      const fromId = String(update.callback_query.from.id);
      const data = update.callback_query.data;
      await answerCallbackQuery(update.callback_query.id, "Move received");
      // TODO: handle callback: piece selection, move execution, turn switching, victory check
    }
  } catch (e) {
    console.error("Error handling update", e);
  }
  return new Response("ok");
});








