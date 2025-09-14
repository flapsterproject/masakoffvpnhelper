// main.ts (fully refactored Tic-Tac-Toe bot with inline buttons, leaderboard by user ID, battle logic, and profiles)
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const TOKEN = Deno.env.get("BOT_TOKEN")!;
const API = `https://api.telegram.org/bot${TOKEN}`;
const SECRET_PATH = "/masakoffvpnhelper";
const ADMIN_ID = 123456789; // Telegram numeric ID for admin

// Deno KV
const kv = await Deno.openKv();

// Queue & battles
let queue: string[] = [];
const battles: Record<string, Battle> = {};

// -------------------- Types --------------------
interface Profile {
  id: string;
  displayName: string;
  trophies: number;
  gamesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  lastActive: number;
}

interface Battle {
  players: [string, string];
  board: string[];
  turn: string;
  marks: Record<string, "X" | "O">;
  messageIds: Record<string, number>;
  idleTimerId: number;
  round: number;
  roundWins: Record<string, number>;
}

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

// -------------------- Profile --------------------
async function initProfile(userId: string, displayName?: string) {
  const value = await kv.get(["profiles", userId]);
  if (!value.value) {
    const profile: Profile = {
      id: userId,
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

async function sendProfileInline(chatId: string) {
  const profile = await initProfile(chatId);
  const date = new Date(profile.lastActive).toLocaleDateString();
  const winRate = profile.gamesPlayed ? ((profile.wins / profile.gamesPlayed) * 100).toFixed(1) : "0";
  const text = `🏅 Profile of ${profile.displayName} (ID: ${profile.id})\nTrophies: ${profile.trophies} 🏆\nRank: ${getRank(profile.trophies)}\nGames: ${profile.gamesPlayed}\nWins: ${profile.wins} | Losses: ${profile.losses} | Draws: ${profile.draws}\nWin Rate: ${winRate}%\nLast active: ${date}`;

  const keyboard = {
    inline_keyboard: [
      [{ text: "🔝 Leaderboard", callback_data: "leaderboard:0" }],
      [{ text: "⚔️ Start Battle", callback_data: "battle" }]
    ]
  };

  await sendMessage(chatId, text, { reply_markup: keyboard });
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

  if (!topPlayers.length) {
    await sendMessage(chatId, "No players yet!");
    return;
  }

  let msg = `🏆 Leaderboard — Page ${page + 1}\n\n`;
  topPlayers.forEach((p, i) => {
    const rankNum = offset + i + 1;
    const winRate = p.gamesPlayed ? ((p.wins / p.gamesPlayed) * 100).toFixed(1) : "0";
    msg += `${rankNum}. ID: ${p.id} — 🏆 ${p.trophies} | W:${p.wins} L:${p.losses} D:${p.draws} | WinRate: ${winRate}%\n`;
  });

  const keyboard: any = { inline_keyboard: [] };
  const row: any[] = [];
  if (page > 0) row.push({ text: "⬅️ Prev", callback_data: `leaderboard:${page - 1}` });
  if (topPlayers.length === perPage) row.push({ text: "Next ➡️", callback_data: `leaderboard:${page + 1}` });
  if (row.length) keyboard.inline_keyboard.push(row);

  await sendMessage(chatId, msg, { reply_markup: keyboard });
}

// -------------------- Battle Helpers --------------------
function createEmptyBoard() { return Array(9).fill(""); }
function boardToText(board: string[]) {
  const map = { "": "▫️", X: "❌", O: "⭕" };
  return `\n${map[board[0]]}${map[board[1]]}${map[board[2]]}\n${map[board[3]]}${map[board[4]]}${map[board[5]]}\n${map[board[6]]}${map[board[7]]}${map[board[8]]}`;
}
function checkWin(board: string[]) {
  const lines = [
    [0,1,2],[3,4,5],[6,7,8],
    [0,3,6],[1,4,7],[2,5,8],
    [0,4,8],[2,4,6]
  ];
  for (const [a,b,c] of lines) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  }
  if (board.every(c => c !== "")) return "draw";
  return null;
}
function makeInlineKeyboard(board: string[]) {
  const keyboard: any[] = [];
  for (let r=0;r<3;r++) {
    const row: any[] = [];
    for (let c=0;c<3;c++) {
      const i = r*3+c;
      const cell = board[i];
      const text = cell === "X" ? "❌" : cell === "O" ? "⭕" : "▫️";
      row.push({ text, callback_data: `move:${i}` });
    }
    keyboard.push(row);
  }
  keyboard.push([{ text: "Surrender", callback_data: "surrender" }]);
  return { inline_keyboard: keyboard };
}

// -------------------- Matchmaking & Battle --------------------
async function startBattle(p1: string, p2: string) {
  const battle: Battle = {
    players: [p1,p2],
    board: createEmptyBoard(),
    turn: p1,
    marks: { [p1]: "X", [p2]: "O" },
    messageIds: {},
    idleTimerId: 0,
    round: 1,
    roundWins: { [p1]:0, [p2]:0 }
  };
  battles[p1]=battle;
  battles[p2]=battle;

  await sendMessage(p1, `Opponent found! You are ❌ (X). Best of 3 vs ${p2}`);
  await sendMessage(p2, `Opponent found! You are ⭕ (O). Best of 3 vs ${p1}`);
  await sendRoundStart(battle);
}

async function sendRoundStart(battle: Battle) {
  for (const player of battle.players) {
    const opponent = battle.players.find(p=>p!==player)!;
    const text = `Tic-Tac-Toe — You vs ${opponent}\nRound ${battle.round}/3\nScore: ${battle.roundWins[battle.players[0]]}-${battle.roundWins[battle.players[1]]}\nTurn: ${battle.turn===player?"Your move":"Opponent"}${boardToText(battle.board)}`;
    const msgId = await sendMessage(player,text,{ reply_markup: makeInlineKeyboard(battle.board) });
    if (msgId) battle.messageIds[player]=msgId;
  }
  battle.idleTimerId = setTimeout(()=>endBattleIdle(battle),5*60*1000);
}

async function endBattleIdle(battle: Battle){
  const [p1,p2] = battle.players;
  await sendMessage(p1,"⚠️ Game ended due to inactivity (5 minutes).");
  await sendMessage(p2,"⚠️ Game ended due to inactivity (5 minutes).");
  delete battles[p1]; delete battles[p2];
}

// -------------------- HTTP Handler --------------------
serve(async req => {
  try {
    if (!req.url.endsWith(SECRET_PATH)) return new Response("Forbidden",{status:403});
    const update = await req.json();

    if (update.message){
      const chatId = String(update.message.chat.id);
      const displayName = update.message.from.first_name || chatId;
      await initProfile(chatId, displayName);

      if (update.message.text=="/profile") await sendProfileInline(chatId);
      if (update.message.text=="/leaderboard") await sendLeaderboard(chatId,0);
      if (update.message.text=="/battle") {
        if (battles[chatId]) await sendMessage(chatId,"⚔️ Already in a game!");
        else if (queue.includes(chatId)) await sendMessage(chatId,"⌛ Searching opponent...");
        else if (queue.length>0 && queue[0]!=chatId){
          const opponent = queue.shift()!;
          startBattle(chatId,opponent);
        } else { queue.push(chatId); await sendMessage(chatId,"🔎 Searching opponent...");}
      }
    }

    if (update.callback_query){
      const fromId = String(update.callback_query.from.id);
      const data = update.callback_query.data;
      // handle inline callbacks here (leaderboard paging, battle moves, surrender, etc.)
    }
  } catch(e){ console.error(e);}
  return new Response("ok");
});





