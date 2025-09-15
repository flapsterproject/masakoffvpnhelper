```typescript
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

type Profile = {
  id: string;
  username?: string;
  displayName: string;
  trophies: number;
  tmt: number;
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
      trophies: 0,
      tmt: 0,
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

/**
 * delta fields are additive (numbers to add). Example:
 * updateProfile("123", { trophies: 10, wins: 1 })
 */
async function updateProfile(userId: string, delta: Partial<Profile>) {
  const existing = (await getProfile(userId)) || (await initProfile(userId));
  const newProfile: Profile = {
    ...existing,
    ...delta,
    trophies: Math.max(0, (existing.trophies || 0) + (delta.trophies ?? 0)), // never below 0
    tmt: (existing.tmt || 0) + (delta.tmt ?? 0),
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

// -------------------- Profile UI --------------------
async function sendProfile(chatId: string) {
  await initProfile(chatId);
  const p = (await getProfile(chatId))!;
  const date = new Date(p.lastActive).toLocaleString();
  const winRate = p.gamesPlayed ? ((p.wins / p.gamesPlayed) * 100).toFixed(1) : "0";
  const msg =
    `🏅 Profile of ID:${p.id}\n` +
    `Trophies: ${p.trophies} 🏆\n` +
    `TMT: ${p.tmt}\n` +
    `Rank: ${getRank(p.trophies)}\n` +
    `Games: ${p.gamesPlayed}\n` +
    `Wins: ${p.wins} | Losses: ${p.losses} | Draws: ${p.draws}\n` +
    `Win Rate: ${winRate}%\n` +
    `Last active: ${date}`;
  
  // Create inline keyboard for profile commands
  const keyboard = {
    inline_keyboard: [
      [
        { text: "Battle (Trophy)", callback_data: "battle:trophy" },
        { text: "Battle (TMT)", callback_data: "battle:tmt" }
      ],
      [
        { text: "Leaderboard", callback_data: "leaderboard:0" }
      ]
    ]
  };
  
  await sendMessage(chatId, msg, { reply_markup: keyboard });
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
    const name = `ID:${p.id}`;
    const winRate = p.gamesPlayed ? ((p.wins / p.gamesPlayed) * 100).toFixed(1) : "0";
    msg += `${rankNum}. ${name} — 🏆 ${p.trophies} | TMT: ${p.tmt} | Wins: ${p.wins}, Losses: ${p.losses}, Draws: ${p.draws} | WinRate: ${winRate}%\n`;
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

// -------------------- Queue & Battles --------------------
// queue item: { id: string, mode: 'trophy'|'tmt', timerId: number }
let queue: Array<{ id: string; mode: "trophy" | "tmt"; timerId?: number }> = [];
const battles: Record<string, any> = {};

function findQueueIndex(userId: string) {
  return queue.findIndex((q) => q.id === userId);
}

function removeFromQueueByIndex(idx: number) {
  if (idx < 0 || idx >= queue.length) return;
  const item = queue[idx];
  if (item.timerId) clearTimeout(item.timerId);
  queue.splice(idx, 1);
}

// -------------------- Battle Control --------------------
async function startBattle(p1: string, p2: string, mode: "trophy" | "tmt") {
  const battle = {
    players: [p1, p2],
    board: createEmptyBoard(),
    turn: p1,
    marks: { [p1]: "X", [p2]: "O" },
    messageIds: {} as Record<string, number>,
    idleTimerId: undefined as any,
    round: 1,
    roundWins: { [p1]: 0, [p2]: 0 },
    mode,
  };
  battles[p1] = battle;
  battles[p2] = battle;

  await initProfile(p1);
  await initProfile(p2);

  await sendMessage(p1, `Opponent found! You are ❌ (X). Best of 3 rounds vs ID:${p2} [mode: ${mode}]`);
  await sendMessage(p2, `Opponent found! You are ⭕ (O). Best of 3 rounds vs ID:${p1} [mode: ${mode}]`);
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

  // Delete all battle messages
  for (const player of battle.players) {
    const msgId = battle.messageIds[player];
    if (msgId) {
      try {
        await fetch(`${API}/deleteMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: player, message_id: msgId }),
        });
      } catch (e) {
        console.warn("Failed to delete message", e);
      }
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

    if (battle.mode === "trophy") {
      // Trophy mode: winner +10, loser -5 (but trophies never go below 0)
      await updateProfile(winner, { gamesPlayed: 1, wins: 1, trophies: 10 });
      await updateProfile(loser, { gamesPlayed: 1, losses: 1, trophies: -5 });
      const wp = await getProfile(winner);
      const lp = await getProfile(loser);
      await sendMessage(winner, `🎉 You won the match! +10 trophies (vs ID:${loser}) — Total: ${wp?.trophies ?? "?"}`);
      await sendMessage(loser, `😢 You lost the match. -5 trophies (vs ID:${winner}) — Total: ${lp?.trophies ?? "?"}`);
    } else {
      // TMT mode: winner +0.75 TMT, loser -1 TMT
      await updateProfile(winner, { gamesPlayed: 1, wins: 1, tmt: 0.75 });
      await updateProfile(loser, { gamesPlayed: 1, losses: 1, tmt: -1 });
      const wp = await getProfile(winner);
      const lp = await getProfile(loser);
      await sendMessage(winner, `🎉 You won the match! +0.75 TMT (vs ID:${loser}) — TMT: ${wp?.tmt ?? "?"}`);
      await sendMessage(loser, `😢 You lost the match. -1 TMT (vs ID:${winner}) — TMT: ${lp?.tmt ?? "?"}`);
    }
  }

  delete battles[p1];
  delete battles[p2];
  
  // Send profile after match
  await sendProfile(p1);
  await sendProfile(p2);
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
    
    if (data.startsWith("battle:")) {
      const mode = data.split(":")[1] as "trophy" | "tmt";
      await handleBattleCommand(fromId, mode);
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
      const header = headerForPlayer(battle, player);
      const text = `${header}\nRound ${battle.round}/3\nScore: ${battle.roundWins[battle.players[0]]}-${battle.roundWins[battle.players[1]]}\nTurn: ${battle.turn === player ? "Your move" : "Opponent"}${boardToText(battle.board)}`;
      const msgId = battle.messageIds[player];
      if (msgId) await editMessageText(player, msgId, text, { reply_markup: makeInlineKeyboard(battle.board) });
      else await sendMessage(player, text, { reply_markup: makeInlineKeyboard(battle.board) });
    }
    await answerCallbackQuery(callbackId);
  } catch (e) {
    console.error("handleCallback error", e);
  }
}

// -------------------- Command Handlers --------------------
async function handleBattleCommand(fromId: string, mode: "trophy" | "tmt") {
  // check if already in queue or in battle
  if (findQueueIndex(fromId) !== -1) {
    await sendMessage(fromId, "You are already in the queue.");
    return;
  }
  if (battles[fromId]) {
    await sendMessage(fromId, "You are already in a battle.");
    return;
  }

  // init profile
  await initProfile(fromId);

  if (mode === "tmt") {
    const p = await getProfile(fromId);
    if (!p || (p.tmt ?? 0) < 1) {
      await sendMessage(fromId, "You need at least 1 TMT to join TMT matches.");
      return;
    }
  }

  const item = { id: fromId, mode: mode === "tmt" ? "tmt" : "trophy", timerId: undefined as any };
  queue.push(item);
  await sendMessage(fromId, `Searching for opponent... [mode: ${item.mode}]`);

  // start a 30s search timeout — if not paired, remove and notify
  item.timerId = setTimeout(async () => {
    const idx = findQueueIndex(fromId);
    if (idx !== -1) {
      removeFromQueueByIndex(idx);
      await sendMessage(fromId, "Opponent not found — try again.");
    }
  }, 30 * 1000);

  // try to find opponent: match earliest other queue item with same mode
  if (queue.length >= 2) {
    // find first other item in queue with same mode
    const idx = findQueueIndex(fromId);
    if (idx !== -1) {
      let foundIdx = -1;
      for (let i = 0; i < queue.length; i++) {
        if (i === idx) continue;
        if (queue[i].mode === queue[idx].mode) {
          foundIdx = i;
          break;
        }
      }
      if (foundIdx !== -1) {
        // pick p1 = queue[idx], p2 = queue[foundIdx], remove them (ensure idx<foundIdx ordering)
        const firstIndex = Math.min(idx, foundIdx);
        const secondIndex = Math.max(idx, foundIdx);
        const p1item = queue[firstIndex];
        const p2item = queue[secondIndex];
        removeFromQueueByIndex(secondIndex); // remove higher index first
        removeFromQueueByIndex(firstIndex);

        // clear timers if any
        if (p1item.timerId) clearTimeout(p1item.timerId);
        if (p2item.timerId) clearTimeout(p2item.timerId);

        // For TMT mode double-check both still have >=1 TMT
        if (p1item.mode === "tmt") {
          const p1prof = await getProfile(p1item.id);
          const p2prof = await getProfile(p2item.id);
          if ((p1prof?.tmt ?? 0) < 1) {
            await sendMessage(p1item.id, "You no longer have 1 TMT — cannot start TMT match.");
            // return the other to queue? let's notify the other to requeue
            await sendMessage(p2item.id, "Opponent didn't have enough TMT. Re-queue if you want.");
            return;
          }
          if ((p2prof?.tmt ?? 0) < 1) {
            await sendMessage(p2item.id, "You no longer have 1 TMT — cannot start TMT match.");
            await sendMessage(p1item.id, "Opponent didn't have enough TMT. Re-queue if you want.");
            return;
          }
        }

        await startBattle(p1item.id, p2item.id, p1item.mode === "tmt" ? "tmt" : "trophy");
      }
    }
  }
  return;
}

async function handleCommand(fromId: string, username: string | undefined, displayName: string, text: string) {
  if (text.startsWith("/battle")) {
    // modes: "/battle" (trophy) or "/battle tmt"
    const parts = text.split(" ").filter(Boolean);
    const mode = parts[1] === "tmt" ? "tmt" : "trophy";
    await handleBattleCommand(fromId, mode);
    return;
  }

  if (text.startsWith("/profile")) {
    await sendProfile(fromId);
    return;
  }

  if (text.startsWith("/leaderboard")) {
    await sendLeaderboard(fromId, 0);
    return;
  }

  if (text.startsWith("/addtouser")) {
    // supports:
    // /addtouser <userId> <trophies>   (backwards-compatible — treats second arg as userId)
    // /addtouser tmt <userId> <amount>
    // /addtouser trophies <userId> <amount>
    if (username !== ADMIN_USERNAME.replace("@", "")) {
      await sendMessage(fromId, "Unauthorized.");
      return;
    }
    const parts = text.split(" ").filter(Boolean);
    if (parts.length < 3) {
      await sendMessage(fromId, "Usage:\n/addtouser <userId> <trophies>\n/addtouser tmt <userId> <amount>");
      return;
    }

    if (parts[1] === "tmt") {
      if (parts.length < 4) {
        await sendMessage(fromId, "Usage: /addtouser tmt <userId> <amount>");
        return;
      }
      const userId = parts[2];
      const amt = parseFloat(parts[3]);
      if (isNaN(amt)) {
        await sendMessage(fromId, "Invalid amount.");
        return;
      }
      await updateProfile(userId, { tmt: amt });
      const p = await getProfile(userId);
      await sendMessage(fromId, `Added ${amt} TMT to ID:${userId}. New TMT: ${p?.tmt ?? "?"}`);
      return;
    }

    if (parts[1] === "trophies" || parts[1] === "trophy") {
      if (parts.length < 4) {
        await sendMessage(fromId, "Usage: /addtouser trophies <userId> <amount>");
        return;
      }
      const userId = parts[2];
      const amt = parseInt(parts[3]);
      if (isNaN(amt)) {
        await sendMessage(fromId, "Invalid trophies value.");
        return;
      }
      await updateProfile(userId, { trophies: amt });
      const p = await getProfile(userId);
      await sendMessage(fromId, `Added ${amt} trophies to ID:${userId}. New trophies: ${p?.trophies ?? "?"}`);
      return;
    }

    // backward-compatible: /addtouser <userId> <trophies>
    if (parts.length >= 3) {
      const userId = parts[1];
      const trophies = parseInt(parts[2]);
      if (isNaN(trophies)) {
        await sendMessage(fromId, "Invalid trophies value.");
        return;
      }
      await updateProfile(userId, { trophies });
      const p = await getProfile(userId);
      await sendMessage(fromId, `Added ${trophies} trophies to ID:${userId}. New trophies: ${p?.trophies ?? "?"}`);
      return;
    }

    return;
  }

  await sendMessage(fromId, "Unknown command.");
}

// -------------------- Server --------------------
serve(async (req: Request) => {
  try {
    const url = new URL(req.url);
    if (url.pathname !== SECRET_PATH) return new Response("Not found", { status: 404 });
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

    const update = await req.json();
    if (update.message) {
      const msg = update.message;
      const from = msg.from;
      const text = msg.text || "";
      const fromId = String(from.id);
      const username = from.username;
      const displayName = from.first_name || fromId;

      await initProfile(fromId, username, displayName);

      if (text.startsWith("/")) {
        await handleCommand(fromId, username, displayName, text);
      } else {
        // If it's not a command, show profile
        await sendProfile(fromId);
      }
    } else if (update.callback_query) {
      const cb = update.callback_query;
      const fromId = String(cb.from.id);
      await handleCallback(fromId, cb.data, cb.id);
    }

    return new Response("OK");
  } catch (e) {
    console.error("server error", e);
    return new Response("Error", { status: 500 });
  }
});

