// main.ts
// Telegram Tic-Tac-Toe Bot (Deno) - Enhanced Game Design
// Features: matchmaking (/battle), private-game with inline buttons,
// profiles with stats (Deno KV), leaderboard with pagination, admin (/addtouser)
// Match = best of 3 rounds

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const TOKEN = Deno.env.get("BOT_TOKEN")!;
if (!TOKEN) throw new Error("BOT_TOKEN env var is required");
const API = `https://api.telegram.org/bot${TOKEN}`;
const SECRET_PATH = "/masakoffvpnhelper"; // Make sure this matches your webhook URL

// Deno KV
const kv = await Deno.openKv();
const ADMIN_USERNAME = "@amangeldimasakov"; // keep as username check, change to ADMIN_ID if you want id-based admin

let queue: string[] = [];
let trophyQueue: string[] = []; // Queue for trophy battles
const battles: Record<string, any> = {};
const searchTimeouts: Record<string, number> = {}; // Track search timeouts for users

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

// -------------------- Profile Helpers --------------------
type Profile = {
  id: string;
  username?: string;
  displayName: string;
  trophies: number;
  tmt: number; // Add TMT balance
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
      trophies: 1000, // Give new players a starting amount
      tmt: 100, // Give new players starting TMT balance
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
    trophies: Math.max(0, (existing.trophies || 0) + (delta.trophies ?? 0)), // Prevent negative trophies
    tmt: Math.max(0, (existing.tmt || 0) + (delta.tmt ?? 0)), // Prevent negative TMT
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
  if (trophies < 500) return "🌱 Newbie";
  if (trophies < 1000) return "🥉 Bronze";
  if (trophies < 1500) return "🥈 Silver";
  if (trophies < 2000) return "🥇 Gold";
  if (trophies < 2500) return "🏆 Platinum";
  return "💎 Diamond";
}

async function sendProfile(chatId: string) {
  await initProfile(chatId);
  const p = (await getProfile(chatId))!;
  const date = new Date(p.lastActive).toLocaleString();
  const winRate = p.gamesPlayed ? ((p.wins / p.gamesPlayed) * 100).toFixed(1) : "0";
  const msg =
    `🏅 *Profile of ${getDisplayName(p)}*\n\n` +
    `🏆 Trophies: *${p.trophies}*\n` +
    `💰 TMT Balance: *${p.tmt}*\n` +
    `🏅 Rank: *${getRank(p.trophies)}*\n` +
    `🎲 Games Played: *${p.gamesPlayed}*\n` +
    `✅ Wins: *${p.wins}* | ❌ Losses: *${p.losses}* | 🤝 Draws: *${p.draws}*\n` +
    `📈 Win Rate: *${winRate}%*\n` +
    `🕒 Last Active: _${date}_`;
  await sendMessage(chatId, msg, { parse_mode: "Markdown" });
}

// -------------------- Leaderboard Helpers --------------------
async function getLeaderboard(top = 10, offset = 0) {
  const players: Profile[] = [];
  for await (const entry of kv.list({ prefix: ["profiles"] })) {
    players.push(entry.value as Profile);
  }
  players.sort((a, b) => {
    // Sort by trophies descending, then by wins descending
    if (b.trophies !== a.trophies) return b.trophies - a.trophies;
    return b.wins - a.wins;
  });
  return players.slice(offset, offset + top);
}

async function sendLeaderboard(chatId: string, page = 0) {
  const perPage = 10;
  const offset = page * perPage;
  const topPlayers = await getLeaderboard(perPage, offset);

  if (topPlayers.length === 0) {
    await sendMessage(chatId, "No players yet! Start playing to climb the leaderboard!");
    return;
  }

  let msg = `🏆 *Leaderboard* — Page ${page + 1}\n\n`;
  topPlayers.forEach((p, i) => {
    const rankNum = offset + i + 1;
    const name = getDisplayName(p);
    const winRate = p.gamesPlayed ? ((p.wins / p.gamesPlayed) * 100).toFixed(1) : "0";
    msg += `*${rankNum}.* ${name} — 🏆 *${p.trophies}* | 💰 *${p.tmt}* | ✅ *${p.wins}* | ❌ *${p.losses}* | 🤝 *${p.draws}* | 📈 *${winRate}%*\n`;
  });

  const keyboard: any = { inline_keyboard: [] };
  const row: any[] = [];
  if (page > 0) row.push({ text: "⬅️ Prev", callback_data: `leaderboard:${page - 1}` });
  if (topPlayers.length === perPage) row.push({ text: "Next ➡️", callback_data: `leaderboard:${page + 1}` });
  if (row.length) keyboard.inline_keyboard.push(row);

  await sendMessage(chatId, msg, { reply_markup: keyboard, parse_mode: "Markdown" });
}

// -------------------- Game Logic --------------------
function createEmptyBoard(): string[] {
  return Array(9).fill("");
}

function boardToText(board: string[]) {
  const map: any = { "": "▫️", X: "❌", O: "⭕" };
  let text = "\n";
  for (let i = 0; i < 9; i += 3) {
    text += `${map[board[i]]}${map[board[i + 1]]}${map[board[i + 2]]}\n`;
  }
  return text;
}

function checkWin(board: string[]) {
  const lines = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
    [0, 3, 6], [1, 4, 7], [2, 5, 8], // columns
    [0, 4, 8], [2, 4, 6]             // diagonals
  ];
  for (const [a, b, c] of lines) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { winner: board[a], line: [a, b, c] };
    }
  }
  if (board.every((c) => c !== "")) return { winner: "draw" };
  return null;
}

function makeInlineKeyboard(board: string[], disabled = false) {
  const keyboard: any[] = [];
  for (let r = 0; r < 3; r++) {
    const row: any[] = [];
    for (let c = 0; c < 3; c++) {
      const i = r * 3 + c;
      const cell = board[i];
      let text = cell === "X" ? "❌" : cell === "O" ? "⭕" : `${i + 1}`; // Show number for empty cells
      const callback_data = disabled ? "noop" : `move:${i}`;
      row.push({ text, callback_data });
    }
    keyboard.push(row);
  }
  keyboard.push([{ text: "🏳️ Surrender", callback_data: "surrender" }]);
  return { inline_keyboard: keyboard };
}

// -------------------- Battle Control --------------------
async function startBattle(p1: string, p2: string, isTrophyBattle: boolean = false) {
  // Clear any existing search timeout for these players
  if (searchTimeouts[p1]) {
    clearTimeout(searchTimeouts[p1]);
    delete searchTimeouts[p1];
  }
  if (searchTimeouts[p2]) {
    clearTimeout(searchTimeouts[p2]);
    delete searchTimeouts[p2];
  }

  const battle = {
    players: [p1, p2],
    board: createEmptyBoard(),
    turn: p1,
    marks: { [p1]: "X", [p2]: "O" },
    messageIds: {} as Record<string, number>,
    idleTimerId: undefined as any,
    moveTimerId: undefined as any, // Timer for 1-minute inactivity per turn
    round: 1,
    roundWins: { [p1]: 0, [p2]: 0 },
    isTrophyBattle: isTrophyBattle // Add flag for trophy battle
  };
  battles[p1] = battle;
  battles[p2] = battle;

  await initProfile(p1);
  await initProfile(p2);

  const battleTypeText = isTrophyBattle ? "🏆 *Trophy Battle*" : "⚔️ *Regular Battle*";
  const stakeText = isTrophyBattle ? "\n\n*Stakes:* Both players risk 1 TMT. Winner gets 0.75 TMT back." : "";

  await sendMessage(p1, `${battleTypeText}\n\nYou are ❌ (X).${stakeText}\n\n*Match Format:* Best of 3 rounds vs ID:${p2}`, { parse_mode: "Markdown" });
  await sendMessage(p2, `${battleTypeText}\n\nYou are ⭕ (O).${stakeText}\n\n*Match Format:* Best of 3 rounds vs ID:${p1}`, { parse_mode: "Markdown" });
  await sendRoundStart(battle);
}

function headerForPlayer(battle: any, player: string) {
  const opponent = battle.players.find((p: string) => p !== player)!;
  const yourMark = battle.marks[player];
  const opponentMark = battle.marks[opponent];
  const battleTypeText = battle.isTrophyBattle ? "🏆 *Trophy Battle*" : "🎯 *Tic-Tac-Toe*";
  return `${battleTypeText} — You (${yourMark}) vs ID:${opponent} (${opponentMark})`;
}

async function endTurnIdle(battle: any) {
  // If the turn timer expires, the current player surrenders
  const loser = battle.turn;
  const winner = battle.players.find((p: string) => p !== loser)!;

  await sendMessage(loser, "⚠️ You took too long to move. You have surrendered.");
  await sendMessage(winner, "⚠️ Your opponent took too long to move. They have surrendered. You win!");

  // Clear the existing 5-minute idle timer
  if (battle.idleTimerId) clearTimeout(battle.idleTimerId);
  // Clear the turn timer
  if (battle.moveTimerId) clearTimeout(battle.moveTimerId);

  // Finish the match with the inactive player as the loser
  await finishMatch(battle, { winner: winner, loser: loser });
}

async function sendRoundStart(battle: any) {
  for (const player of battle.players) {
    const header = headerForPlayer(battle, player);
    const yourTurn = battle.turn === player;
    const text =
      `${header}\n\n` +
      `*Round ${battle.round}/3*\n` +
      `📊 Score: ${battle.roundWins[battle.players[0]]} - ${battle.roundWins[battle.players[1]]}\n` +
      `🎲 Turn: ${yourTurn ? "*Your move* ❌" : "Opponent's move ⭕"}\n` +
      boardToText(battle.board);
    const msgId = await sendMessage(player, text, { reply_markup: makeInlineKeyboard(battle.board), parse_mode: "Markdown" });
    if (msgId) battle.messageIds[player] = msgId;
  }

  // Reset the 5-minute game idle timer
  if (battle.idleTimerId) clearTimeout(battle.idleTimerId);
  battle.idleTimerId = setTimeout(() => endBattleIdle(battle), 5 * 60 * 1000); // 5 minutes

  // Set the 1-minute turn timer for the current player
  if (battle.moveTimerId) clearTimeout(battle.moveTimerId);
  battle.moveTimerId = setTimeout(() => endTurnIdle(battle), 1 * 60 * 1000); // 1 minute
}

async function endBattleIdle(battle: any) {
  const [p1, p2] = battle.players;
  await sendMessage(p1, "⚠️ *Game ended due to inactivity* (5 minutes).", { parse_mode: "Markdown" });
  await sendMessage(p2, "⚠️ *Game ended due to inactivity* (5 minutes).", { parse_mode: "Markdown" });
  
  // If it was a trophy battle, refund the 1 TMT to both players
  if (battle.isTrophyBattle) {
    await updateProfile(p1, { tmt: 1 });
    await updateProfile(p2, { tmt: 1 });
    await sendMessage(p1, "💸 You've been refunded 1 TMT for the idle game.");
    await sendMessage(p2, "💸 You've been refunded 1 TMT for the idle game.");
  }
  
  delete battles[p1];
  delete battles[p2];
}

async function finishMatch(battle: any, result: { winner?: string; loser?: string; draw?: boolean }) {
  if (battle.idleTimerId) clearTimeout(battle.idleTimerId);
  if (battle.moveTimerId) clearTimeout(battle.moveTimerId); // Clear turn timer
  const [p1, p2] = battle.players;

  for (const player of battle.players) {
    const msgId = battle.messageIds[player];
    const header = headerForPlayer(battle, player);
    let text: string;
    if (result.draw) {
      text = `${header}\n\n*Match Result:* 🤝 *Draw!*\n${boardToText(battle.board)}`;
    } else if (result.winner === player) {
      text = `${header}\n\n*Match Result:* 🎉 *You Won the Match!*\n${boardToText(battle.board)}`;
    } else {
      text = `${header}\n\n*Match Result:* 😢 *You Lost the Match.*\n${boardToText(battle.board)}`;
    }
    if (msgId) {
      await editMessageText(player, msgId, text, { reply_markup: makeInlineKeyboard(battle.board, true), parse_mode: "Markdown" }); // Disable buttons
    } else {
      await sendMessage(player, text, { parse_mode: "Markdown" });
    }
  }

  if (result.draw) {
    await updateProfile(p1, { gamesPlayed: 1, draws: 1 });
    await updateProfile(p2, { gamesPlayed: 1, draws: 1 });
    await sendMessage(p1, "🤝 The match ended in a draw!");
    await sendMessage(p2, "🤝 The match ended in a draw!");
    
    // If it was a trophy battle, refund the 1 TMT to both players
    if (battle.isTrophyBattle) {
      await updateProfile(p1, { tmt: 1 });
      await updateProfile(p2, { tmt: 1 });
      await sendMessage(p1, "💸 You've been refunded 1 TMT for the draw.");
      await sendMessage(p2, "💸 You've been refunded 1 TMT for the draw.");
    }
  } else if (result.winner) {
    const winner = result.winner!;
    const loser = result.loser!;
    await initProfile(winner);
    await initProfile(loser);
    
    // FIXED: Simple +1/-1 trophy system
    await updateProfile(winner, { gamesPlayed: 1, wins: 1, trophies: 1 });
    await updateProfile(loser, { gamesPlayed: 1, losses: 1, trophies: -1 });
    await sendMessage(winner, `🎉 You won the match!\n🏆 *+1 trophy* (vs ID:${loser})`, { parse_mode: "Markdown" });
    await sendMessage(loser, `😢 You lost the match.\n🏆 *-1 trophy* (vs ID:${winner})`, { parse_mode: "Markdown" });
    
    // Handle trophy battle rewards/penalties
    if (battle.isTrophyBattle) {
      // Winner gets 0.75 TMT, loser loses 1 TMT (net -0.25 TMT)
      await updateProfile(winner, { tmt: 0.75 }); // Winner gets 0.75 TMT
      await updateProfile(loser, { tmt: -1 }); // Loser loses 1 TMT
      await sendMessage(winner, "🏆 You received 0.75 TMT for winning the Trophy Battle!");
      await sendMessage(loser, "💔 You lost 1 TMT for losing the Trophy Battle.");
    }
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

    if (data === "noop") {
        await answerCallbackQuery(callbackId);
        return;
    }

    const battle = battles[fromId];
    if (!battle) {
      if (data === "surrender") {
        await answerCallbackQuery(callbackId, "You are not in a game.", true);
        return;
      }
      // If it's a move callback but no battle, just acknowledge silently or ignore
      await answerCallbackQuery(callbackId);
      return;
    }

    // Reset idle timer on any valid interaction
    if (battle.idleTimerId) clearTimeout(battle.idleTimerId);
    battle.idleTimerId = setTimeout(() => endBattleIdle(battle), 5 * 60 * 1000);

    // Reset the 1-minute turn timer when a move is made or surrender is clicked
    if (battle.moveTimerId) clearTimeout(battle.moveTimerId);
    battle.moveTimerId = setTimeout(() => endTurnIdle(battle), 1 * 60 * 1000);

    if (data === "surrender") {
      const opponent = battle.players.find((p: string) => p !== fromId)!;
      await sendMessage(fromId, "🏳️ You surrendered the match.");
      await sendMessage(opponent, "🏳️ Your opponent surrendered. You win the match!");
      await finishMatch(battle, { winner: opponent, loser: fromId });
      await answerCallbackQuery(callbackId, "You surrendered.");
      return;
    }

    if (!data.startsWith("move:")) {
      await answerCallbackQuery(callbackId);
      return;
    }

    const idx = parseInt(data.split(":")[1]);
    if (isNaN(idx) || idx < 0 || idx > 8) { // Validate index
         await answerCallbackQuery(callbackId, "Invalid move.", true);
         return;
    }
    if (battle.turn !== fromId) {
      await answerCallbackQuery(callbackId, "Not your turn.", true);
      return;
    }
    if (battle.board[idx] !== "") {
      await answerCallbackQuery(callbackId, "Cell already taken.", true);
      return;
    }

    const mark = battle.marks[fromId];
    battle.board[idx] = mark;

    const winResult = checkWin(battle.board);
    if (winResult) {
      const { winner, line } = winResult; // Destructure to get winner and winning line
      let roundWinner: string | undefined;
      if (winner !== "draw") {
        roundWinner = battle.players.find((p: string) => battle.marks[p] === winner)!;
        battle.roundWins[roundWinner] = (battle.roundWins[roundWinner] || 0) + 1;
      }

      // Highlight winning line or indicate draw
      let boardText = boardToText(battle.board);
      if (line) {
          // Simple highlight: just add a note. For advanced highlighting, you'd need to change the emoji or use HTML/MarkdownV2 with nested formatting.
          boardText += `\n🎉 *Line:* ${line.map(i => i+1).join('-')}`; // Show 1-based indices of the winning line
      } else if (winner === "draw") {
          boardText += `\n🤝 *It's a Draw!*`;
      }

      for (const player of battle.players) {
        const msgId = battle.messageIds[player];
        const header = headerForPlayer(battle, player);
        let text = `${header}\n\n*Round ${battle.round} Result!*\n`;
        if (winner === "draw") text += `🤝 It's a draw!\n`;
        else text += `${roundWinner === player ? "🎉 You won the round!" : "😢 You lost this round."}\n`;
        text += `📊 Score: ${battle.roundWins[battle.players[0]]} - ${battle.roundWins[battle.players[1]]}\n${boardText}`;
        // Disable buttons on round end
        if (msgId) await editMessageText(player, msgId, text, { reply_markup: makeInlineKeyboard(battle.board, true), parse_mode: "Markdown" });
        else await sendMessage(player, text, { parse_mode: "Markdown" });
      }

      // Check if match is over (best of 3)
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

      // Start next round
      battle.round++;
      battle.board = createEmptyBoard();
      battle.turn = battle.players[(battle.round - 1) % 2]; // Alternate who starts

      // Reset turn timer for the new round
      if (battle.moveTimerId) clearTimeout(battle.moveTimerId);
      battle.moveTimerId = setTimeout(() => endTurnIdle(battle), 1 * 60 * 1000);

      await sendRoundStart(battle);
      await answerCallbackQuery(callbackId, "Move played!");
      return;
    }

    // Continue game if no win/draw yet
    battle.turn = battle.players.find((p: string) => p !== fromId)!;
    for (const player of battle.players) {
      const header = headerForPlayer(battle, player);
      const yourTurn = battle.turn === player;
      const text =
        `${header}\n\n` +
        `*Round ${battle.round}/3*\n` +
        `📊 Score: ${battle.roundWins[battle.players[0]]} - ${battle.roundWins[battle.players[1]]}\n` +
        `🎲 Turn: ${yourTurn ? "*Your move* ❌" : "Opponent's move ⭕"}\n` +
        boardToText(battle.board);
      const msgId = battle.messageIds[player];
      if (msgId) await editMessageText(player, msgId, text, { reply_markup: makeInlineKeyboard(battle.board), parse_mode: "Markdown" });
      else await sendMessage(player, text, { reply_markup: makeInlineKeyboard(battle.board), parse_mode: "Markdown" });
    }
    await answerCallbackQuery(callbackId, "Move played!");
  } catch (e) {
    console.error("handleCallback error", e);
    // Optionally notify the user of an internal error
    // await answerCallbackQuery(callbackId, "An error occurred. Please try again.", true);
  }
}

// -------------------- Command Handlers --------------------
async function handleCommand(fromId: string, username: string | undefined, displayName: string, text: string) {
  if (text.startsWith("/battle")) {
    if (queue.includes(fromId)) {
      await sendMessage(fromId, "You are already in the queue. Please wait for an opponent.");
      return;
    }
    if (battles[fromId]) {
      await sendMessage(fromId, "You are already in a battle. Finish your current game first.");
      return;
    }
    queue.push(fromId);
    await sendMessage(fromId, "🔍 Searching for opponent...");

    // Set a 30-second timeout for this search
    searchTimeouts[fromId] = setTimeout(async () => {
      // Check if user is still in queue and hasn't been matched
      const index = queue.indexOf(fromId);
      if (index !== -1) {
        queue.splice(index, 1); // Remove from queue
        delete searchTimeouts[fromId]; // Clean up timeout reference
        await sendMessage(fromId, "⏱️ Search stopped after 30 seconds. No opponent found.");
      }
    }, 30000); // 30 seconds

    // Try to match immediately if possible
    if (queue.length >= 2) {
      const [p1, p2] = queue.splice(0, 2);
      // Clear timeouts for both players since they are matched
      if (searchTimeouts[p1]) {
        clearTimeout(searchTimeouts[p1]);
        delete searchTimeouts[p1];
      }
      if (searchTimeouts[p2]) {
        clearTimeout(searchTimeouts[p2]);
        delete searchTimeouts[p2];
      }
      await startBattle(p1, p2);
    }
    return;
  }

  if (text.startsWith("/trophy")) {
    // Check if player has enough TMT (at least 1 TMT)
    const profile = await getProfile(fromId);
    if (!profile || profile.tmt < 1) {
      await sendMessage(fromId, "❌ You need at least 1 TMT to enter a Trophy Battle.");
      return;
    }

    if (trophyQueue.includes(fromId)) {
      await sendMessage(fromId, "You are already in the Trophy Battle queue. Please wait for an opponent.");
      return;
    }
    if (battles[fromId]) {
      await sendMessage(fromId, "You are already in a battle. Finish your current game first.");
      return;
    }
    
    // Deduct 1 TMT from both players when they join the queue
    await updateProfile(fromId, { tmt: -1 });
    trophyQueue.push(fromId);
    await sendMessage(fromId, "🔍 Searching for opponent for Trophy Battle...\n(1 TMT has been reserved for this match)");
    
    // Set a 30-second timeout for this search
    searchTimeouts[fromId] = setTimeout(async () => {
      // Check if user is still in trophy queue and hasn't been matched
      const index = trophyQueue.indexOf(fromId);
      if (index !== -1) {
        trophyQueue.splice(index, 1); // Remove from queue
        delete searchTimeouts[fromId]; // Clean up timeout reference
        // Refund the 1 TMT since search was cancelled
        await updateProfile(fromId, { tmt: 1 });
        await sendMessage(fromId, "⏱️ Search stopped after 30 seconds. No opponent found. 1 TMT has been refunded.");
      }
    }, 30000); // 30 seconds

    // Try to match immediately if possible
    if (trophyQueue.length >= 2) {
      const [p1, p2] = trophyQueue.splice(0, 2);
      // Clear timeouts for both players since they are matched
      if (searchTimeouts[p1]) {
        clearTimeout(searchTimeouts[p1]);
        delete searchTimeouts[p1];
      }
      if (searchTimeouts[p2]) {
        clearTimeout(searchTimeouts[p2]);
        delete searchTimeouts[p2];
      }
      // Deduct 1 TMT from the second player as well
      await updateProfile(p2, { tmt: -1 });
      await startBattle(p1, p2, true); // true indicates it's a trophy battle
    }
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
    if (username !== ADMIN_USERNAME.replace("@", "")) {
      await sendMessage(fromId, "❌ Unauthorized.");
      return;
    }
    const parts = text.split(" ");
    if (parts.length < 4) {
      await sendMessage(fromId, "Usage: `/addtouser tmt <userId> <amount>` or `/addtouser trophies <userId> <amount>`", { parse_mode: "Markdown" });
      return;
    }
    
    const type = parts[1]; // "tmt" or "trophies"
    const userId = parts[2];
    const amount = parseFloat(parts[3]);
    
    if (isNaN(amount)) {
      await sendMessage(fromId, "Invalid amount value. Please provide a number.");
      return;
    }
    
    if (type === "tmt") {
      await updateProfile(userId, { tmt: amount });
      await sendMessage(fromId, `✅ Added ${amount} TMT to ID:${userId}`);
    } else if (type === "trophies") {
      await updateProfile(userId, { trophies: amount });
      await sendMessage(fromId, `✅ Added ${amount} trophies to ID:${userId}`);
    } else {
      await sendMessage(fromId, "Invalid type. Use 'tmt' or 'trophies'.");
    }
    return;
  }

  if (text.startsWith("/start") || text.startsWith("/help")) {
      const helpText = `🎮 *Welcome to Tic-Tac-Toe Bot!*\n\n` +
          `Use the following commands:\n` +
          `🔹 /battle - Find an opponent for a regular match.\n` +
          `🔹 /trophy - Find an opponent for a Trophy Battle (requires 1 TMT stake).\n` +
          `🔹 /profile - View your stats and rank.\n` +
          `🔹 /leaderboard - See the top players.\n\n` +
          `Good luck and have fun!`;
       await sendMessage(fromId, helpText, { parse_mode: "Markdown" });
       return;
  }

  await sendMessage(fromId, "❓ Unknown command. Type /help for a list of commands.");
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
          // Handle non-command messages, e.g., send help
          await sendMessage(fromId, "Type /help to see available commands.");
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











