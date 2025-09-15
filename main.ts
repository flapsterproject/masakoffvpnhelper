// main.ts
// Telegram Tic-Tac-Toe Bot (Deno) with TMT currency
// Features: matchmaking (/battle), private-game with inline buttons,
// profiles with stats (Deno KV), leaderboard with pagination, admin (/addtouser)
// Match = best of 3 rounds
// TMT system: need ≥1 TMT to battle, Win +0.75 TMT, Lose -1 TMT

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const TOKEN = Deno.env.get("BOT_TOKEN")!;
if (!TOKEN) throw new Error("BOT_TOKEN env var is required");
const API = `https://api.telegram.org/bot${TOKEN}`;
const SECRET_PATH = "/masakoffvpnhelper";

// Deno KV
const kv = await Deno.openKv();
const ADMIN_USERNAME = "@amangeldimasakov"; // check by username

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
  tmt: number;
  gamesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  lastActive: number;
};

async function initProfile(userId: string, username?: string, displayName?: string) {
  const key = ["profiles", userId];
  const value = await kv.get(key);
  if (!value.value) {
    const profile: Profile = {
      id: userId,
      username,
      displayName: displayName || userId,
      tmt: 1, // give default 1 TMT for new user
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
    if (username && username !== existing.username) existing.username = username;
    if (displayName && displayName !== existing.displayName) existing.displayName = displayName;
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
    tmt: (existing.tmt || 0) + (delta.tmt ?? 0),
    gamesPlayed: (existing.gamesPlayed || 0) + (delta.gamesPlayed ?? 0),
    wins: (existing.wins || 0) + (delta.wins ?? 0),
    losses: (existing.losses || 0) + (delta.losses ?? 0),
    draws: (existing.draws || 0) + (delta.draws ?? 0),
    lastActive: Date.now(),
  };
  if (newProfile.tmt < 0) newProfile.tmt = 0;
  await kv.set(["profiles", userId], newProfile);
  return newProfile;
}

async function sendProfile(chatId: string) {
  await initProfile(chatId);
  const p = (await getProfile(chatId))!;
  const date = new Date(p.lastActive).toLocaleString();
  const winRate = p.gamesPlayed ? ((p.wins / p.gamesPlayed) * 100).toFixed(1) : "0";
  const msg =
    `💳 Profile of ID:${p.id}\n` +
    `TMT Balance: ${p.tmt.toFixed(2)} 💰\n` +
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
  players.sort((a, b) => b.tmt - a.tmt);
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

  let msg = `🏆 TMT Leaderboard — Page ${page + 1}\n\n`;
  topPlayers.forEach((p, i) => {
    const rankNum = offset + i + 1;
    const name = `ID:${p.id}`;
    const winRate = p.gamesPlayed ? ((p.wins / p.gamesPlayed) * 100).toFixed(1) : "0";
    msg += `${rankNum}. ${name} — 💰 ${p.tmt.toFixed(2)} TMT | Wins: ${p.wins}, Losses: ${p.losses}, Draws: ${p.draws} | WinRate: ${winRate}%\n`;
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

  await sendMessage(p1, `Opponent found! You are ❌ (X). Best of 3 rounds vs ID:${p2}`);
  await sendMessage(p2, `Opponent found! You are ⭕ (O). Best of 3 rounds vs ID:${p1}`);
  await sendRoundStart(battle);
}

function headerForPlayer(battle: any, player: string) {
  const opponent = battle.players.find((p: string) => p !== player)!;
  return `Tic-Tac-Toe — You vs ID:${opponent}`;
}

async function sendRoundStart(battle: any) {
  for (const player of battle.players) {
    const header = headerForPlayer(battle, player);
    const text = `${header}\nRound ${battle.round}/3\nScore: ${battle.roundWins[battle.players[0]]}-${battle.roundWins[battle.players[1]]}\nTurn: ${battle.turn === player ? "Your move" : "Opponent"}${boardToText(battle.board)}`;
    const msgId = await sendMessage(player, text, { reply_markup: makeInlineKeyboard(battle.board) });
    if (msgId) battle.messageIds[player] = msgId;
  }
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
    await updateProfile(winner, { gamesPlayed: 1, wins: 1, tmt: +0.75 });
    await updateProfile(loser, { gamesPlayed: 1, losses: 1, tmt: -1 });
    await sendMessage(winner, `🎉 You won the match! +0.75 TMT (vs ID:${loser})`);
    await sendMessage(loser, `😢 You lost the match. -1 TMT (vs ID:${winner})`);
  }

  delete battles[p1];
  delete battles[p2];
}

// -------------------- Callback --------------------
async function handleCallback(fromId: string, data: string, callbackId: string) {
  try {
    if (data.startsWith("leaderboard:")) {
      const page = parseInt(data.split(":")[1]) || 0;
      await sendLeaderboard(fromId, page);
      await answerCallbackQuery(callbackId);
      return;
    }

    const battle = battles[fromId];
    if (!battle) {
      if (data === "surrender") {
        await answerCallbackQuery(callbackId, "You are not in a game.");
        return;
      }
      await answerCallbackQuery(callbackId);
      return;
    }

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

    battle.turn = battle.players.find((p: string) => p !== fromId)!;

    for (const player of battle.players) {
      const msgId = battle.messageIds[player];
      const header = headerForPlayer(battle, player);
      const text = `${header}\nRound ${battle.round}/3\nScore: ${battle.roundWins[battle.players[0]]}-${battle.roundWins[battle.players[1]]}\nTurn: ${battle.turn === player ? "Your move" : "Opponent"}${boardToText(battle.board)}`;
      if (msgId) await editMessageText(player, msgId, text, { reply_markup: makeInlineKeyboard(battle.board) });
    }

    await answerCallbackQuery(callbackId);
  } catch (e) {
    console.error("handleCallback error", e);
  }
}

// -------------------- Commands --------------------
async function handleCommand(userId: string, username: string | undefined, firstName: string | undefined, text: string) {
  if (text === "/start") {
    await initProfile(userId, username, firstName);
    await sendMessage(userId, "Welcome to Tic-Tac-Toe! Use /battle to find opponent, /profile to see your stats, /leaderboard to see rankings.");
  } else if (text === "/profile") {
    await sendProfile(userId);
  } else if (text.startsWith("/addtouser")) {
    if ("@" + username !== ADMIN_USERNAME) {
      await sendMessage(userId, "You are not admin.");
      return;
    }
    const parts = text.split(" ");
    if (parts.length < 3) {
      await sendMessage(userId, "Usage: /addtouser <userId> <amount>");
      return;
    }
    const targetId = parts[1];
    const amt = parseFloat(parts[2]);
    if (isNaN(amt)) {
      await sendMessage(userId, "Invalid amount.");
      return;
    }
    await updateProfile(targetId, { tmt: amt });
    await sendMessage(userId, `Added ${amt} TMT to user ${targetId}`);
  } else if (text === "/leaderboard") {
    await sendLeaderboard(userId, 0);
  } else if (text === "/battle") {
    const profile = await getProfile(userId);
    if (!profile || profile.tmt < 1) {
      await sendMessage(userId, "❌ You need at least 1 TMT to start a match.");
      return;
    }
    if (queue.includes(userId)) {
      await sendMessage(userId, "You are already in queue.");
      return;
    }
    if (queue.length > 0) {
      const opponent = queue.shift()!;
      if (opponent === userId) {
        queue.push(userId);
        return;
      }
      await startBattle(userId, opponent);
    } else {
      queue.push(userId);
      await sendMessage(userId, "⏳ Waiting for opponent...");
    }
  }
}

// -------------------- HTTP Handler --------------------
serve(async (req) => {
  const { pathname } = new URL(req.url);

  if (pathname === SECRET_PATH && req.method === "POST") {
    const update = await req.json();
    try {
      if (update.message) {
        const m = update.message;
        const fromId = m.from.id.toString();
        const username = m.from.username;
        const firstName = m.from.first_name;
        const text = m.text;
        if (text) {
          await handleCommand(fromId, username, firstName, text);
        }
      } else if (update.callback_query) {
        const cb = update.callback_query;
        const fromId = cb.from.id.toString();
        const data = cb.data;
        if (data) {
          await handleCallback(fromId, data, cb.id);
        }
      }
    } catch (e) {
      console.error("update handler error", e);
    }
    return new Response("OK");
  }

  return new Response("Not found", { status: 404 });
});







