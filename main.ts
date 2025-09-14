// main.ts
// Telegram Tic-Tac-Toe Bot (Deno)
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
const ADMIN_USERNAME = "@amangeldimasakov"; // keep as username check, change to ADMIN_ID if you want id-based admin

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
    // It's common for edit to fail (message deleted or too old) — ignore but log
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
  // Return only the Telegram numeric user id as requested
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
    // Update username/displayName if provided and different
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
    const name = getDisplayName(p); // will show ID:xxx
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
function createEmptyBoard(): string[] {
  return Array(9).fill("");
}

function boardToText(board: string[]) {
  const map: any = { "": "▫️", X: "❌", O: "⭕" };
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
      // callback contains move index
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
    idleTimerId: undefined as any,
    round: 1,
    roundWins: { [p1]: 0, [p2]: 0 },
  };
  battles[p1] = battle;
  battles[p2] = battle;

  await initProfile(p1);
  await initProfile(p2);

  // Messages show IDs only (p1 and p2 are strings of the user ids)
  await sendMessage(p1, `Opponent found! You are ❌ (X). Best of 3 rounds vs ${p2}`);
  await sendMessage(p2, `Opponent found! You are ⭕ (O). Best of 3 rounds vs ${p1}`);
  await sendRoundStart(battle);
}

function headerForPlayer(battle: any, player: string) {
  const opponent = battle.players.find((p: string) => p !== player)!;
  return `Tic-Tac-Toe — You vs ${opponent}`; // opponent is id
}

async function sendRoundStart(battle: any) {
  for (const player of battle.players) {
    const header = headerForPlayer(battle, player);
    const text = `${header}\nRound ${battle.round}/3\nScore: ${battle.roundWins[battle.players[0]]}-${battle.roundWins[battle.players[1]]}\nTurn: ${battle.turn === player ? "Your move" : "Opponent"}${boardToText(battle.board)}`;
    const msgId = await sendMessage(player, text, { reply_markup: makeInlineKeyboard(battle.board) });
    if (msgId) battle.messageIds[player] = msgId;
  }
  // idle timeout (5 minutes)
  if (battle.idleTimerId) clearTimeout(battle.idleTimerId);
  battle.idleTimerId = setTimeout(() => endBattleIdle(battle), 5 * 60 * 1000);
}

async function endBattleIdle(battle: any) {
  const [p1, p2] = battle.players;
  await sendMessage(p1, "⚠️ Game ended due to inactivity (5 minutes).");
  await sendMessage(p2, "⚠️ Game ended due to inactivity (5 minutes).");
  delete battles[p1];
  delete battles[p2];
}

async function finishMatch(battle: any, result: { winner?: string; loser?: string; draw?: boolean }) {
  if (battle.idleTimerId) clearTimeout(battle.idleTimerId);
  const [p1, p2] = battle.players;

  for (const player of battle.players) {
    const msgId = battle.messageIds[player];
    const header = headerForPlayer(battle, player);
    let text: string;
    if (result.draw) text = `${header}\nMatch ended in a draw!${boardToText(battle.board)}`;
    else if (result.winner === player) text = `${header}\nYou won the match! 🎉${boardToText(battle.board)}`;
    else text = `${header}\nYou lost the match.${boardToText(battle.board)}`;
    if (msgId) {
      await editMessageText(player, msgId, text, {});
    } else {
      await sendMessage(player, text);
    }
  }

  if (result.draw) {
    await updateProfile(p1, { gamesPlayed: 1, draws: 1 });
    await updateProfile(p2, { gamesPlayed: 1, draws: 1 });
    await sendMessage(p1, "🤝 The match ended in a draw!");
    await sendMessage(p2, "🤝 The match ended in a draw!");
  } else if (result.winner) {
    const winner = result.winner!;
    const loser = result.loser!;
    await initProfile(winner);
    await initProfile(loser);
    await updateProfile(winner, { gamesPlayed: 1, wins: 1, trophies: 10 });
    await updateProfile(loser, { gamesPlayed: 1, losses: 1, trophies: -5 });
    await sendMessage(winner, "🎉 You won the match! +10 trophies");
    await sendMessage(loser, "😢 You lost the match. -5 trophies");
  }

  delete battles[p1];
  delete battles[p2];
}

// improved handleCallback to allow non-battle callbacks (leaderboard) and battle moves
async function handleCallback(fromId: string, data: string, callbackId: string) {
  try {
    // Leaderboard navigation — works even if user not in a battle
    if (data.startsWith("leaderboard:")) {
      const page = parseInt(data.split(":")[1]) || 0;
      await sendLeaderboard(fromId, page);
      await answerCallbackQuery(callbackId);
      return;
    }

    // Not a battle specific action? surrender/move require a battle
    const battle = battles[fromId];
    if (!battle) {
      // If user clicks 'Surrender' but isn't in a game, inform them
      if (data === "surrender") {
        await answerCallbackQuery(callbackId, "You are not in a game.");
        return;
      }
      // other unknown callback — just acknowledge
      await answerCallbackQuery(callbackId);
      return;
    }

    // reset idle timer
    if (battle.idleTimerId) clearTimeout(battle.idleTimerId);
    battle.idleTimerId = setTimeout(() => endBattleIdle(battle), 5 * 60 * 1000);

    if (data === "surrender") {
      const opponent = battle.players.find((p: string) => p !== fromId)!;
      await finishMatch(battle, { winner: opponent, loser: fromId });
      await answerCallbackQuery(callbackId, "You surrendered.");
      return;
    }

    if (!data.startsWith("move:")) {
      await answerCallbackQuery(callbackId);
      return;
    }

    const idx = parseInt(data.split(":")[1]);
    if (battle.turn !== fromId) {
      await answerCallbackQuery(callbackId, "Not your turn.");
      return;
    }
    if (battle.board[idx] !== "") {
      await answerCallbackQuery(callbackId, "Cell already taken.");
      return;
    }

    const mark = battle.marks[fromId];
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
        if (msgId) await editMessageText(player, msgId, text, {});
        else await sendMessage(player, text);
      }

      // Check match end (first to 2 or after 3 rounds)
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

      // Next round
      battle.round++;
      battle.board = createEmptyBoard();
      // alternate who starts each round: round 1 -> players[0], round 2 -> players[1], round 3 -> players[0]
      battle.turn = battle.players[(battle.round - 1) % 2];
      await sendRoundStart(battle);
      await answerCallbackQuery(callbackId);
      return;
    }

    // normal move, switch turn
    battle.turn = battle.players.find((p: string) => p !== fromId)!;
    for (const player of battle.players) {
      const header = headerForPlayer(battle, player);
      const text = `${header}\nRound ${battle.round}/3\nScore: ${battle.roundWins[battle.players[0]]}-${battle.roundWins[battle.players[1]]}\nTurn: ${battle.turn === player ? "Your move" : "Opponent"}${boardToText(battle.board)}`;
      const msgId = battle.messageIds[player];
      try {
        if (msgId) {
          await editMessageText(player, msgId, text, { reply_markup: makeInlineKeyboard(battle.board) });
        } else {
          const newId = await sendMessage(player, text, { reply_markup: makeInlineKeyboard(battle.board) });
          if (newId) battle.messageIds[player] = newId;
        }
      } catch {
        // ignore per-user errors
      }
    }

    await answerCallbackQuery(callbackId);
  } catch (e) {
    console.error("handleCallback error", e);
    await answerCallbackQuery(callbackId, "Error processing action.");
  }
}

// -------------------- HTTP Handler --------------------
serve(async (req) => {
  try {
    // ensure correct webhook path
    const url = new URL(req.url);
    if (!url.pathname.endsWith(SECRET_PATH)) return new Response("Forbidden", { status: 403 });

    const update = await req.json();

    // handle a normal message
    if (update.message) {
      const chatId = String(update.message.chat.id);
      const text = update.message.text ?? "";
      const from = update.message.from;
      const username = from.username ? `@${from.username}` : undefined;
      const displayName = from.first_name ?? from.username ?? String(from.id);

      await initProfile(String(from.id), username, displayName);
      // NOTE: we store profiles keyed by Telegram user id (not chat id), so pass String(from.id)
      // For commands used in private chats, chatId == from.id; for groups they'd differ.

      // Admin command: /addtouser <userid> <amount> (admin ONLY)
      if (text.startsWith("/addtouser")) {
        const fromUsername = update.message.from.username ? `@${update.message.from.username}` : "";
        if (fromUsername !== ADMIN_USERNAME) {
          await sendMessage(chatId, "❌ You are not allowed to use this command.");
        } else {
          const parts = text.split(" ").filter(Boolean);
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

      // Battle matchmaking
      if (text === "/battle") {
        const userKey = String(update.message.from.id);
        if (battles[userKey]) {
          await sendMessage(chatId, "⚔️ You are already in a game!");
        } else if (queue.includes(userKey)) {
          await sendMessage(chatId, "⌛ You are already searching for an opponent...");
        } else if (queue.length > 0 && queue[0] !== userKey) {
          const opponent = queue.shift()!;
          startBattle(userKey, opponent);
        } else {
          queue.push(userKey);
          await sendMessage(chatId, "🔎 Searching opponent...");
        }
      }

      if (text === "/profile") {
        const userKey = String(update.message.from.id);
        await sendProfile(String(userKey));
      }

      if (text === "/leaderboard") {
        await sendLeaderboard(String(update.message.from.id), 0);
      }
    }

    // handle callback_query
    if (update.callback_query) {
      const fromId = String(update.callback_query.from.id);
      const data = update.callback_query.data;
      await handleCallback(fromId, data, update.callback_query.id);
    }
  } catch (e) {
    console.error("Error handling update", e);
  }

  return new Response("ok");
});







