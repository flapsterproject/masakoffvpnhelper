// main.ts
// Telegram Tic-Tac-Toe Bot (Deno)
// Features: matchmaking (/battle), private-game with inline buttons,
// profiles with stats (Deno KV), leaderboard with pagination, admin (/addtouser)
// Match = best of 3 rounds

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const TOKEN = Deno.env.get("BOT_TOKEN")!;
const API = `https://api.telegram.org/bot${TOKEN}`;
const SECRET_PATH = "/masakoffvpnhelper";

// Deno KV
const kv = await Deno.openKv();
const ADMIN_USERNAME = "@amangeldimasakov";

let queue: string[] = []; // array of userIds (string)
const battles: Record<string, any> = {}; // keyed by userId
const userChatMap: Record<string, string> = {}; // userId -> chatId mapping

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

function getChatIdForUser(userId: string, fallback?: string) {
  // prefer stored mapping, otherwise fallback (maybe the current chat), otherwise userId (works for private chats)
  return userChatMap[userId] || fallback || userId;
}

async function sendToUser(userId: string, text: string, options: any = {}, fallbackChatId?: string) {
  const chatId = getChatIdForUser(userId, fallbackChatId);
  return await sendMessage(chatId, text, options);
}

async function editUserMessage(userId: string, messageId: number, text: string, options: any = {}, fallbackChatId?: string) {
  const chatId = getChatIdForUser(userId, fallbackChatId);
  return await editMessageText(chatId, messageId, text, options);
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
  return p.username || p.displayName || `User${p.id}`;
}

async function initProfile(userId: string, username?: string, displayName?: string) {
  const value = await kv.get(["profiles", userId]);
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
    await kv.set(["profiles", userId], profile);
    return profile;
  }
  return value.value as Profile;
}

async function getProfile(userId: string): Promise<Profile | null> {
  const res = await kv.get(["profiles", userId]);
  return (res.value as Profile) ?? null;
}

async function updateProfile(userId: string, delta: Partial<Profile>) {
  const profile = (await getProfile(userId)) ?? (await initProfile(userId));
  const newProfile: Profile = {
    ...profile,
    ...delta,
    trophies: (profile.trophies || 1000) + (delta.trophies ?? 0),
    gamesPlayed: (profile.gamesPlayed || 0) + (delta.gamesPlayed ?? 0),
    wins: (profile.wins || 0) + (delta.wins ?? 0),
    losses: (profile.losses || 0) + (delta.losses ?? 0),
    draws: (profile.draws || 0) + (delta.draws ?? 0),
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

async function sendProfile(userId: string, fallbackChatId?: string) {
  await initProfile(userId);
  const p = (await getProfile(userId))!;
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
  await sendToUser(userId, msg, {}, fallbackChatId);
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

async function sendLeaderboard(userId: string, page = 0, fallbackChatId?: string) {
  const perPage = 10;
  const offset = page * perPage;
  const topPlayers = await getLeaderboard(perPage, offset);

  if (topPlayers.length === 0) {
    await sendToUser(userId, "No players yet!", {}, fallbackChatId);
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

  await sendToUser(userId, msg, { reply_markup: keyboard }, fallbackChatId);
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
async function startBattle(p1UserId: string, p2UserId: string) {
  const battle = {
    players: [p1UserId, p2UserId],
    board: createEmptyBoard(),
    turn: p1UserId,
    marks: { [p1UserId]: "X", [p2UserId]: "O" },
    messageIds: {} as Record<string, number>,
    idleTimerId: 0 as any,
    round: 1,
    roundWins: { [p1UserId]: 0, [p2UserId]: 0 },
  };
  battles[p1UserId] = battle;
  battles[p2UserId] = battle;

  // send notifications to each user using stored chat ids (if any)
  await sendToUser(p1UserId, `Opponent found! You are ❌ (X). Best of 3 rounds vs ${p2UserId}`);
  await sendToUser(p2UserId, `Opponent found! You are ⭕ (O). Best of 3 rounds vs ${p1UserId}`);
  await sendRoundStart(battle);
}

function headerForPlayer(battle: any, player: string) {
  const opponent = battle.players.find((p: string) => p !== player)!;
  return `Tic-Tac-Toe — You vs ${opponent}`;
}

async function sendRoundStart(battle: any) {
  for (const player of battle.players) {
    const header = headerForPlayer(battle, player);
    const text = `${header}\nRound ${battle.round}/3\nScore: ${battle.roundWins[battle.players[0]]}-${battle.roundWins[battle.players[1]]}\nTurn: ${battle.turn === player ? "Your move" : "Opponent"}${boardToText(battle.board)}`;
    const chatId = getChatIdForUser(player);
    const msgId = await sendMessage(chatId, text, { reply_markup: makeInlineKeyboard(battle.board) });
    if (msgId) battle.messageIds[player] = msgId;
  }
  battle.idleTimerId = setTimeout(() => endBattleIdle(battle), 5 * 60 * 1000);
}

async function endBattleIdle(battle: any) {
  const [p1, p2] = battle.players;
  await sendToUser(p1, "⚠️ Game ended due to inactivity (5 minutes).");
  await sendToUser(p2, "⚠️ Game ended due to inactivity (5 minutes).");
  delete battles[p1];
  delete battles[p2];
}

async function finishMatch(battle: any, result: { winner?: string; loser?: string; draw?: boolean }) {
  clearTimeout(battle.idleTimerId);
  const [p1, p2] = battle.players;

  for (const player of battle.players) {
    const msgId = battle.messageIds[player];
    const header = headerForPlayer(battle, player);
    let text: string;
    if (result.draw) text = `${header}\nMatch ended in a draw!${boardToText(battle.board)}`;
    else if (result.winner === player) text = `${header}\nYou won the match! 🎉${boardToText(battle.board)}`;
    else text = `${header}\nYou lost the match.${boardToText(battle.board)}`;
    if (msgId) {
      try { await editUserMessage(player, msgId, text); } catch {}
    }
  }

  if (result.draw) {
    await updateProfile(p1, { gamesPlayed: 1, draws: 1 });
    await updateProfile(p2, { gamesPlayed: 1, draws: 1 });
    await sendToUser(p1, "🤝 The match ended in a draw!");
    await sendToUser(p2, "🤝 The match ended in a draw!");
  } else if (result.winner) {
    await initProfile(result.winner);
    await initProfile(result.loser!);
    await updateProfile(result.winner, { gamesPlayed: 1, wins: 1, trophies: 10 });
    await updateProfile(result.loser!, { gamesPlayed: 1, losses: 1, trophies: -5 });
    await sendToUser(result.winner, "🎉 You won the match! +10 trophies");
    await sendToUser(result.loser!, "😢 You lost the match. -5 trophies");
  }

  delete battles[p1];
  delete battles[p2];
}

async function handleMove(playerId: string, data: string, callbackId: string, callbackMessageChatId?: string) {
  const battle = battles[playerId];
  if (!battle) {
    await answerCallbackQuery(callbackId, "You are not in a game.");
    return;
  }

  clearTimeout(battle.idleTimerId);
  battle.idleTimerId = setTimeout(() => endBattleIdle(battle), 5 * 60 * 1000);

  if (data === "surrender") {
    const opponent = battle.players.find((p: string) => p !== playerId)!;
    await finishMatch(battle, { winner: opponent, loser: playerId });
    await answerCallbackQuery(callbackId, "You surrendered.");
    return;
  }

  if (data.startsWith("leaderboard:")) {
    const page = parseInt(data.split(":")[1]) || 0;
    await sendLeaderboard(playerId, page, callbackMessageChatId);
    await answerCallbackQuery(callbackId);
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

  const mark = battle.marks[playerId];
  battle.board[idx] = mark;

  const res = checkWin(battle.board);
  if (res === "X" || res === "O" || res === "draw") {
    let roundWinner: string | undefined;
    if (res !== "draw") {
      roundWinner = battle.players.find((p: string) => battle.marks[p] === res)!;
      battle.roundWins[roundWinner] = (battle.roundWins[roundWinner] || 0) + 1;
    }

    for (const player of battle.players) {
      const msgId = battle.messageIds[player];
      const header = headerForPlayer(battle, player);
      let text = `${header}\nRound ${battle.round} finished!\n`;
      if (res === "draw") text += `🤝 It's a draw!\n`;
      else text += `${roundWinner === player ? "🎉 You won the round!" : "You lost this round."}\n`;
      text += `Score: ${battle.roundWins[battle.players[0]]}-${battle.roundWins[battle.players[1]]}${boardToText(battle.board)}`;
      if (msgId) {
        try { await editUserMessage(player, msgId, text); } catch {}
      } else {
        await sendToUser(player, text);
      }
    }

    if (battle.roundWins[battle.players[0]] === 2 || battle.roundWins[battle.players[1]] === 2 || battle.round === 3) {
      if (battle.roundWins[battle.players[0]] > battle.roundWins[battle.players[1]]) {
        await finishMatch(battle, { winner: battle.players[0], loser: battle.players[1] });
      } else if (battle.roundWins[battle.players[1]] > battle.roundWins[battle.players[0]]) {
        await finishMatch(battle, { winner: battle.players[1], loser: battle.players[0] });
      } else {
        await finishMatch(battle, { draw: true });
      }
      await answerCallbackQuery(callbackId);
      return;
    }

    battle.round++;
    battle.board = createEmptyBoard();
    battle.turn = battle.players[(battle.round - 1) % 2];
    await sendRoundStart(battle);
    await answerCallbackQuery(callbackId);
    return;
  }

  battle.turn = battle.players.find((p: string) => p !== playerId)!;
  for (const player of battle.players) {
    const header = headerForPlayer(battle, player);
    const text = `${header}\nRound ${battle.round}/3\nScore: ${battle.roundWins[battle.players[0]]}-${battle.roundWins[battle.players[1]]}\nTurn: ${battle.turn === player ? "Your move" : "Opponent"}${boardToText(battle.board)}`;
    const msgId = battle.messageIds[player];
    try {
      if (msgId) await editUserMessage(player, msgId, text, { reply_markup: makeInlineKeyboard(battle.board) }, callbackMessageChatId);
      else {
        const newId = await sendToUser(player, text, { reply_markup: makeInlineKeyboard(battle.board) }, callbackMessageChatId);
        if (newId) battle.messageIds[player] = newId;
      }
    } catch {
      const newId = await sendToUser(player, text, { reply_markup: makeInlineKeyboard(battle.board) }, callbackMessageChatId);
      if (newId) battle.messageIds[player] = newId;
    }
  }

  await answerCallbackQuery(callbackId);
}

// -------------------- HTTP Handler --------------------
serve(async (req) => {
  try {
    if (!req.url.endsWith(SECRET_PATH)) return new Response("Forbidden", { status: 403 });

    const update = await req.json();

    if (update.message) {
      const chatId = String(update.message.chat.id);
      const text = update.message.text;
      const from = update.message.from;
      const userId = String(from.id);
      const username = from.username ? `@${from.username}` : undefined;
      const displayName = from.first_name;

      // store mapping so later callback edits/sends can use correct chat id
      userChatMap[userId] = chatId;

      // use userId for profiles/queue/battles, not chatId
      await initProfile(userId, username, displayName);

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

      if (text === "/battle") {
        if (battles[userId]) await sendMessage(chatId, "⚔️ You are already in a game!");
        else if (queue.includes(userId)) await sendMessage(chatId, "⌛ You are already searching for an opponent...");
        else if (queue.length > 0 && queue[0] !== userId) {
          const opponentUserId = queue.shift()!;
          startBattle(userId, opponentUserId);
        } else {
          queue.push(userId);
          await sendMessage(chatId, "🔎 Searching opponent...");
        }
      }

      if (text === "/profile") {
        await sendProfile(userId, chatId);
      }

      if (text === "/leaderboard") {
        await sendLeaderboard(userId, 0, chatId);
      }
    }

    if (update.callback_query) {
      const fromId = String(update.callback_query.from.id);
      const data = update.callback_query.data;
      // callback_query.message.chat.id can act as fallback chat id to send replies if mapping missing
      const callbackMessageChatId = update.callback_query.message?.chat?.id ? String(update.callback_query.message.chat.id) : undefined;
      await handleMove(fromId, data, update.callback_query.id, callbackMessageChatId);
    }
  } catch (e) {
    console.error("Error handling update", e);
  }

  return new Response("ok");
});






