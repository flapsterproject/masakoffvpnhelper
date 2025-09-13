// main.ts
// Telegram Tic-Tac-Toe bot (Deno)
// Features: matchmaking (/battle), private-game with inline buttons, profiles (Deno KV), leaderboard, admin (/addtouser)

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

// Telegram setup
const TOKEN = Deno.env.get("BOT_TOKEN")!;
const API = `https://api.telegram.org/bot${TOKEN}`;
const SECRET_PATH = "/masakoffvpnhelper"; // change if needed

// Deno KV
const kv = await Deno.openKv();

// Admin username
const ADMIN_USERNAME = "@amangeldimasakov";

// In-memory matchmaking and battles
let queue: string[] = [];
const battles: Record<string, any> = {}; // playerId -> battle

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

async function deleteMessage(chatId: string, messageId: number) {
  await fetch(`${API}/deleteMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId }),
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
    await kv.set(["profiles", userId], { wins: 0, losses: 0, trophies: 0 });
  }
}

async function getProfile(userId: string) {
  const res = await kv.get(["profiles", userId]);
  return res.value || { wins: 0, losses: 0, trophies: 0 };
}

async function updateProfile(userId: string, delta: { wins?: number; losses?: number; trophies?: number }) {
  const profile = await getProfile(userId);
  const newProfile = {
    wins: profile.wins + (delta.wins || 0),
    losses: profile.losses + (delta.losses || 0),
    trophies: profile.trophies + (delta.trophies || 0),
  };
  await kv.set(["profiles", userId], newProfile);
}

async function getLeaderboard(top = 10) {
  const players: { userId: string; trophies: number; wins: number; losses: number }[] = [];

  for await (const entry of kv.list({ prefix: ["profiles"] })) {
    const userId = entry.key[1] as string;
    const value = entry.value as { trophies: number; wins: number; losses: number };
    players.push({ userId, ...value });
  }

  players.sort((a, b) => b.trophies - a.trophies);

  return players.slice(0, top);
}

async function sendLeaderboard(chatId: string) {
  const topPlayers = await getLeaderboard();
  if (topPlayers.length === 0) {
    await sendMessage(chatId, "No players yet!");
    return;
  }

  let msg = "🏆 Top Players:\n\n";
  topPlayers.forEach((p, i) => {
    msg += `${i + 1}. ${p.userId} — 🏆 ${p.trophies} | Wins: ${p.wins} | Losses: ${p.losses}\n`;
  });

  await sendMessage(chatId, msg);
}

// -------------------- Game Logic (Tic-Tac-Toe) --------------------
function createEmptyBoard() {
  return Array(9).fill("");
}

function boardToText(board: string[]) {
  // Show board as 3x3 with emojis
  const map = { "": "▫️", X: "❌", O: "⭕" } as any;
  return `\n${map[board[0]]}${map[board[1]]}${map[board[2]]}\n${map[board[3]]}${map[board[4]]}${map[board[5]]}\n${map[board[6]]}${map[board[7]]}${map[board[8]]}`;
}

function checkWin(board: string[]) {
  const lines = [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    [0, 4, 8],
    [2, 4, 6],
  ];
  for (const [a, b, c] of lines) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  }
  if (board.every((c) => c !== "")) return "draw";
  return null;
}

function makeInlineKeyboard(board: string[], yourId: string, battle: any) {
  // Create callback_data as `move:<idx>`
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

  // Add a surrender button
  keyboard.push([{ text: "Surrender", callback_data: "surrender" }]);

  return { inline_keyboard: keyboard };
}

async function startBattle(p1: string, p2: string) {
  const battle = {
    players: [p1, p2],
    board: createEmptyBoard(),
    turn: p1, // p1 starts and will be 'X'
    marks: { [p1]: "X", [p2]: "O" },
    messageIds: {} as Record<string, number>,
    idleTimerId: 0 as any,
  };

  battles[p1] = battle;
  battles[p2] = battle;

  await sendMessage(p1, `Opponent found! You are ❌ (X). Playing vs ${p2}`);
  await sendMessage(p2, `Opponent found! You are ⭕ (O). Playing vs ${p1}`);

  // Send initial board to both players
  for (const player of battle.players) {
    const text = `Tic-Tac-Toe — Your ID: ${player}\nTurn: ${battle.turn === player ? "Your move" : "Opponent"}${boardToText(battle.board)}`;
    const msgId = await sendMessage(player, text, {
      reply_markup: makeInlineKeyboard(battle.board, player, battle),
    });
    if (msgId) battle.messageIds[player] = msgId;
  }

  // idle timer: 5 minutes
  battle.idleTimerId = setTimeout(() => endBattleIdle(battle), 5 * 60 * 1000);
}

async function endBattleIdle(battle: any) {
  const [p1, p2] = battle.players;
  await sendMessage(p1, "⚠️ Game ended due to inactivity (5 minutes).");
  await sendMessage(p2, "⚠️ Game ended due to inactivity (5 minutes).");
  delete battles[p1];
  delete battles[p2];
}

async function finishBattle(battle: any, result: { winner?: string; loser?: string; draw?: boolean }) {
  clearTimeout(battle.idleTimerId);
  const [p1, p2] = battle.players;

  if (result.draw) {
    await sendMessage(p1, "It's a draw! 🤝");
    await sendMessage(p2, "It's a draw! 🤝");
  } else if (result.winner) {
    await initProfile(result.winner);
    await initProfile(result.loser);
    await updateProfile(result.winner, { wins: 1, trophies: 1 });
    await updateProfile(result.loser, { losses: 1 });

    await sendMessage(result.winner, "🎉 You won! +1 trophy");
    await sendMessage(result.loser, "😢 You lost.");
  }

  // clean
  delete battles[p1];
  delete battles[p2];
}

async function handleMove(playerId: string, data: string, callbackId: string) {
  const battle = battles[playerId];
  if (!battle) {
    await answerCallbackQuery(callbackId, "You are not in a game.");
    return;
  }

  // reset idle timer
  clearTimeout(battle.idleTimerId);
  battle.idleTimerId = setTimeout(() => endBattleIdle(battle), 5 * 60 * 1000);

  if (data === "surrender") {
    const opponent = battle.players.find((p: string) => p !== playerId);
    await finishBattle(battle, { winner: opponent, loser: playerId });
    await answerCallbackQuery(callbackId, "You surrendered.");
    return;
  }

  if (!data.startsWith("move:")) {
    await answerCallbackQuery(callbackId);
    return;
  }

  const idx = parseInt(data.split(":")[1]);
  if (battle.turn !== playerId) {
    await answerCallbackQuery(callbackId, "Not your turn.");
    return;
  }

  if (battle.board[idx] !== "") {
    await answerCallbackQuery(callbackId, "Cell already taken.");
    return;
  }

  // apply move
  const mark = battle.marks[playerId];
  battle.board[idx] = mark;

  // check win or draw
  const res = checkWin(battle.board);
  if (res === "X" || res === "O") {
    const winner = battle.players.find((p: string) => battle.marks[p] === res);
    const loser = battle.players.find((p: string) => battle.marks[p] !== res);

    // update both boards and finish
    for (const player of battle.players) {
      const text = `Game over! ${winner === player ? "You won! 🎉" : "You lost."}${boardToText(battle.board)}`;
      const msgId = battle.messageIds[player];
      if (msgId) {
        try {
          await editMessageText(player, msgId, text, {});
        } catch (e) {
          // ignore
        }
      } else {
        await sendMessage(player, text);
      }
    }

    await finishBattle(battle, { winner, loser });
    await answerCallbackQuery(callbackId);
    return;
  } else if (res === "draw") {
    for (const player of battle.players) {
      const text = `It's a draw! 🤝${boardToText(battle.board)}`;
      const msgId = battle.messageIds[player];
      if (msgId) {
        try {
          await editMessageText(player, msgId, text, {});
        } catch (e) {}
      } else {
        await sendMessage(player, text);
      }
    }
    await finishBattle(battle, { draw: true });
    await answerCallbackQuery(callbackId);
    return;
  }

  // continue game: switch turn
  battle.turn = battle.players.find((p: string) => p !== playerId);

  // update both players' messages
  for (const player of battle.players) {
    const text = `Tic-Tac-Toe — Your ID: ${player}\nTurn: ${battle.turn === player ? "Your move" : "Opponent"}${boardToText(battle.board)}`;
    const msgId = battle.messageIds[player];
    if (msgId) {
      try {
        await editMessageText(player, msgId, text, { reply_markup: makeInlineKeyboard(battle.board, player, battle) });
      } catch (e) {
        // couldn't edit (maybe message deleted) -> send new
        const newId = await sendMessage(player, text, { reply_markup: makeInlineKeyboard(battle.board, player, battle) });
        if (newId) battle.messageIds[player] = newId;
      }
    } else {
      const newId = await sendMessage(player, text, { reply_markup: makeInlineKeyboard(battle.board, player, battle) });
      if (newId) battle.messageIds[player] = newId;
    }
  }

  await answerCallbackQuery(callbackId);
}

// -------------------- HTTP Handler --------------------
serve(async (req) => {
  try {
    const update = await req.json();

    // messages (commands)
    if (update.message) {
      const chatId = String(update.message.chat.id);
      const text = update.message.text;

      // Admin add wins
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
            if (isNaN(amount)) {
              await sendMessage(chatId, "❌ Amount must be a number.");
            } else {
              await initProfile(targetUserId);
              await updateProfile(targetUserId, { wins: amount });
              await sendMessage(chatId, `✅ Added ${amount} win(s) to user ${targetUserId}`);
            }
          }
        }
      }

      // Player commands
      if (text === "/battle") {
        if (battles[chatId]) {
          await sendMessage(chatId, "⚔️ You are already in a game!");
        } else if (queue.includes(chatId)) {
          await sendMessage(chatId, "⌛ You are already searching for an opponent...");
        } else if (queue.length > 0 && queue[0] !== chatId) {
          const opponent = queue.shift()!;
          startBattle(chatId, opponent);
        } else {
          queue.push(chatId);
          await sendMessage(chatId, "🔎 Searching opponent...");
        }
      }

      if (text === "/profile") {
        await initProfile(chatId);
        const p = await getProfile(chatId);
        await sendMessage(chatId, `📊 Profile:\nWins: ${p.wins}\nLosses: ${p.losses}\nTrophies: ${p.trophies}`);
      }

      if (text === "/leaderboard") {
        await sendLeaderboard(chatId);
      }
    }

    // Callback queries for moves
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

