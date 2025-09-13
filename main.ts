// main.ts
// Telegram Tic-Tac-Toe bot (Deno)
// Features: matchmaking (/battle), private-game with inline buttons, profiles (Deno KV), leaderboard, admin (/addtouser)
// Match = best of 3 rounds, added TMT currency

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

// Telegram setup
const TOKEN = Deno.env.get("BOT_TOKEN")!;
const API = `https://api.telegram.org/bot${TOKEN}`;
const SECRET_PATH = "/masakoffvpnhelper";

// Deno KV
const kv = await Deno.openKv();

// Admin username
const ADMIN_USERNAME = "@amangeldimasakov";

// In-memory matchmaking and battles
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

// -------------------- Deno KV Profile Helpers --------------------
async function initProfile(userId: string) {
  const value = await kv.get(["profiles", userId]);
  if (!value.value) {
    await kv.set(["profiles", userId], { wins: 0, losses: 0, trophies: 0, TMT: 10 }); // start with 10 TMT
  }
}

async function getProfile(userId: string) {
  const res = await kv.get(["profiles", userId]);
  return res.value || { wins: 0, losses: 0, trophies: 0, TMT: 0 };
}

async function updateProfile(userId: string, delta: { wins?: number; losses?: number; trophies?: number; TMT?: number }) {
  const profile = await getProfile(userId);
  const newProfile = {
    wins: profile.wins + (delta.wins || 0),
    losses: profile.losses + (delta.losses || 0),
    trophies: profile.trophies + (delta.trophies || 0),
    TMT: profile.TMT + (delta.TMT || 0),
  };
  await kv.set(["profiles", userId], newProfile);
}

// -------------------- Leaderboard Helpers --------------------
async function getLeaderboard(top = 10) {
  const players: { userId: string; trophies: number; wins: number; losses: number; TMT: number }[] = [];
  for await (const entry of kv.list({ prefix: ["profiles"] })) {
    const userId = entry.key[1] as string;
    const value = entry.value as { trophies: number; wins: number; losses: number; TMT: number };
    players.push({ userId, ...value });
  }
  players.sort((a, b) => b.trophies - a.trophies);
  return players.slice(0, top);
}

async function sendLeaderboard(chatId: string) {
  const topPlayers = await getLeaderboard();
  if (!topPlayers.length) {
    await sendMessage(chatId, "No players yet!");
    return;
  }
  let msg = "🏆 Top Players:\n\n";
  topPlayers.forEach((p, i) => {
    msg += `${i + 1}. ${p.userId} — 🏆 ${p.trophies} | Wins: ${p.wins} | Losses: ${p.losses} | TMT: ${p.TMT}\n`;
  });
  await sendMessage(chatId, msg);
}

// -------------------- Game Logic (Tic-Tac-Toe) --------------------
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
      let text;
      if (cell === "X") text = "❌";
      else if (cell === "O") text = "⭕";
      else text = "▫️";
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
    idleTimerId: 0 as any,
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
  return `Tic-Tac-Toe — Your ID: ${player}\nRound ${battle.round}/3`;
}

async function sendRoundStart(battle: any) {
  for (const player of battle.players) {
    const header = headerForPlayer(battle, player);
    const text = `${header}\nScore: ${battle.roundWins[battle.players[0]]}-${battle.roundWins[battle.players[1]]}\nTurn: ${battle.turn === player ? "Your move" : "Opponent"}${boardToText(battle.board)}`;
    const msgId = await sendMessage(player, text, { reply_markup: makeInlineKeyboard(battle.board) });
    if (msgId) battle.messageIds[player] = msgId;
  }
  battle.idleTimerId = setTimeout(() => endBattleIdle(battle), 5 * 60 * 1000); // 5 minutes idle
}

async function endBattleIdle(battle: any) {
  const [p1, p2] = battle.players;
  await sendMessage(p1, "⚠️ Game ended due to inactivity (5 minutes).");
  await sendMessage(p2, "⚠️ Game ended due to inactivity (5 minutes).");
  delete battles[p1];
  delete battles[p2];
}

// -------------------- Admin Command --------------------
async function handleAddToUser(chatId: string, fromUsername: string, text: string) {
  if (fromUsername !== ADMIN_USERNAME) {
    await sendMessage(chatId, "❌ You are not allowed to use this command.");
    return;
  }

  const parts = text.split(" ");
  if (parts.length !== 4) {
    await sendMessage(chatId, "Usage: /addtouser <userid> <wins> <TMT>");
    return;
  }

  const targetUserId = parts[1];
  const wins = parseInt(parts[2]);
  const tmt = parseFloat(parts[3]);
  if (isNaN(wins) || isNaN(tmt)) {
    await sendMessage(chatId, "❌ Wins and TMT must be numbers.");
    return;
  }

  await initProfile(targetUserId);
  await updateProfile(targetUserId, { wins, TMT: tmt });
  await sendMessage(chatId, `✅ Added ${wins} wins and ${tmt} TMT to user ${targetUserId}`);
}

// -------------------- HTTP Handler --------------------
serve(async (req) => {
  try {
    const update = await req.json();

    if (update.message) {
      const chatId = String(update.message.chat.id);
      const text = update.message.text;
      const fromUsername = update.message.from.username ? `@${update.message.from.username}` : "";

      if (text?.startsWith("/addtouser")) {
        await handleAddToUser(chatId, fromUsername, text);
      }

      if (text === "/profile") {
        await initProfile(chatId);
        const p = await getProfile(chatId);
        await sendMessage(chatId, `📊 Profile:\nWins: ${p.wins}\nLosses: ${p.losses}\nTrophies: ${p.trophies}\nTMT: ${p.TMT}`);
      }

      if (text === "/leaderboard") {
        await sendLeaderboard(chatId);
      }

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
    }

    if (update.callback_query) {
      const fromId = String(update.callback_query.from.id);
      const data = update.callback_query.data;
      await handleMove(fromId, data, update.callback_query.id);
    }
  } catch (err) {
    console.error("Error handling update:", err);
  }

  return new Response("ok");
});


