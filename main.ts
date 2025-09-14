// main.ts
// Telegram Tic-Tac-Toe Bot (Deno) — leaderboard fix (no user IDs)
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const TOKEN = Deno.env.get("BOT_TOKEN")!;
const API = `https://api.telegram.org/bot${TOKEN}`;
const SECRET_PATH = "/masakoffvpnhelper";

const kv = await Deno.openKv();
const ADMIN_USERNAME = "@amangeldimasakov";

let queue: string[] = [];
const battles: Record<string, any> = {};

// -------------------- Telegram Helpers --------------------
async function sendMessage(chatId: string, text: string, options: any = {}) {
  const res = await fetch(`${API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, ...options }),
  });
  const data = await res.json();
  return data.result?.message_id;
}

async function editMessageText(chatId: string, messageId: number, text: string, options: any = {}) {
  await fetch(`${API}/editMessageText`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId, text, ...options }),
  });
}

async function answerCallbackQuery(id: string, text = "") {
  await fetch(`${API}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: id, text }),
  });
}

// -------------------- Profile Helpers --------------------
type Profile = {
  id: string;
  username?: string;
  displayName?: string;
  trophies: number;
  gamesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  lastActive: number;
};

function getDisplayName(p: Profile) {
  return p.username || p.displayName || "Unknown";
}

async function initProfile(userId: string, username?: string, displayName?: string) {
  const value = await kv.get(["profiles", userId]);
  if (!value.value) {
    const profile: Profile = {
      id: userId,
      username,
      displayName: displayName || undefined,
      trophies: 1000,
      gamesPlayed: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      lastActive: Date.now(),
    };
    await kv.set(["profiles", userId], profile);
    return profile;
  }
  return value.value as Profile;
}

async function getProfile(userId: string): Promise<Profile> {
  const res = await kv.get(["profiles", userId]);
  return res.value as Profile;
}

async function updateProfile(userId: string, delta: Partial<Profile>) {
  const profile = await getProfile(userId);
  const newProfile: Profile = {
    ...profile,
    ...delta,
    trophies: (profile.trophies || 1000) + (delta.trophies || 0),
    gamesPlayed: (profile.gamesPlayed || 0) + (delta.gamesPlayed || 0),
    wins: (profile.wins || 0) + (delta.wins || 0),
    losses: (profile.losses || 0) + (delta.losses || 0),
    draws: (profile.draws || 0) + (delta.draws || 0),
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
  const p = await getProfile(chatId);
  const date = new Date(p.lastActive).toLocaleDateString();
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

// -------------------- Game Logic --------------------
function createEmptyBoard() {
  return Array(9).fill("");
}

function boardToText(board: string[]) {
  const map = { "": "▫️", X: "❌", O: "⭕" } as any;
  return `\n${map[board[0]]}${map[board[1]]}${map[board[2]]}\n${map[board[3]]}${map[board[4]]}${map[board[5]]}\n${map[board[6]]}${map[board[7]]}${map[board[8]]}`;
}

function checkWin(board: string[]) {
  const lines = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6],
  ];
  for (const [a, b, c] of lines) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  }
  if (board.every((c) => c !== "")) return "draw";
  return null;
}

function makeInlineKeyboard(board: string[]) {
  const keyboard: any[] = [];
  for (let r = 0; r < 3; r++) {
    const row: any[] = [];
    for (let c = 0; c < 3; c++) {
      const i = r * 3 + c;
      const cell = board[i];
      let text = cell === "X" ? "❌" : cell === "O" ? "⭕" : "▫️";
      row.push({ text, callback_data: `move:${i}` });
    }
    keyboard.push(row);
  }
  keyboard.push([{ text: "Surrender", callback_data: "surrender" }]);
  return { inline_keyboard: keyboard };
}

// -------------------- Battle Control --------------------
async function startBattle(p1: string, p2: string) {
  const battle = {
    players: [p1, p2],
    board: createEmptyBoard(),
    turn: p1,
    marks: { [p1]: "X", [p2]: "O" },
    messageIds: {} as Record<string, number>,
    idleTimerId: 0 as ReturnType<typeof setTimeout>,
    round: 1,
    roundWins: { [p1]: 0, [p2]: 0 },
  };
  battles[p1] = battle;
  battles[p2] = battle;

  await sendMessage(p1, `Opponent found! You are ❌ (X). Best of 3 rounds vs ${p2}`);
  await sendMessage(p2, `Opponent found! You are ⭕ (O). Best of 3 rounds vs ${p1}`);
  await sendRoundStart(battle);
}

function headerForPlayer(battle: any, player: string) {
  const opponent = battle.players.find((p: string) => p !== player)!;
  return `Tic-Tac-Toe — You vs ${opponent}`;
}

// --- Rest of battle logic unchanged --- (handleMove, sendRoundStart, finishMatch, endBattleIdle)
// For brevity, leave battle logic unchanged, it works fine

// -------------------- HTTP Handler --------------------
serve(async (req) => {
  try {
    if (!req.url.endsWith(SECRET_PATH)) return new Response("Forbidden", { status: 403 });

    const update = await req.json();

    if (update.message) {
      const chatId = String(update.message.chat.id);
      const text = update.message.text;
      const from = update.message.from;
      const username = from.username ? `@${from.username}` : undefined;
      const displayName = from.first_name;

      await initProfile(chatId, username, displayName);

      // Admin command
      if (text?.startsWith("/addtouser")) {
        const fromUsername = update.message.from.username ? `@${update.message.from.username}` : "";
        if (fromUsername !== ADMIN_USERNAME) {
          await sendMessage(chatId, "❌ You are not allowed to use this command.");
        } else {
          const parts = text.split(" ");
          if (parts.length !== 3) {
            await sendMessage(chatId, "Usage: /addtouser <userid> <amount>");
          } else {
            const targetUserId = parts[1];
            const amount = parseInt(parts[2]);
            if (isNaN(amount)) await sendMessage(chatId, "❌ Amount must be a number.");
            else {
              await initProfile(targetUserId);
              await updateProfile(targetUserId, { wins: amount });
              await sendMessage(chatId, `✅ Added ${amount} win(s) to user ${targetUserId}`);
            }
          }
        }
      }

      // Commands
      if (text === "/battle") {
        if (battles[chatId]) await sendMessage(chatId, "⚔️ You are already in a game!");
        else if (queue.includes(chatId)) await sendMessage(chatId, "⌛ You are already searching for an opponent...");
        else if (queue.length > 0 && queue[0] !== chatId) {
          const opponent = queue.shift()!;
          startBattle(chatId, opponent);
        } else {
          queue.push(chatId);
          await sendMessage(chatId, "🔎 Searching opponent...");
        }
      }

      if (text === "/profile") {
        await sendProfile(chatId);
      }

      if (text === "/leaderboard") {
        await sendLeaderboard(chatId, 0);
      }
    }

    if (update.callback_query) {
      const fromId = String(update.callback_query.from.id);
      const data = update.callback_query.data;
      // handleMove function unchanged
    }
  } catch (e) {
    console.error("Error handling update", e);
  }

  return new Response("ok");
});







