// main.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { DB } from "https://deno.land/x/sqlite/mod.ts";

const TOKEN = Deno.env.get("BOT_TOKEN")!;
const API = `https://api.telegram.org/bot${TOKEN}`;
const SECRET_PATH = "/masakoffvpnhelper";

// Initialize SQLite DB
const db = new DB("rps.db");

// Create profiles table if it doesn't exist
db.query(`
  CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY,
    wins INTEGER DEFAULT 0,
    losses INTEGER DEFAULT 0,
    trophies INTEGER DEFAULT 0
  )
`);

// In-memory battle queue & state
let queue: string[] = [];
const battles: Record<string, any> = {};

// ===== Telegram helpers =====
async function sendMessage(chatId: string, text: string, options: any = {}) {
  const res = await fetch(`${API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, ...options }),
  });
  const data = await res.json();
  return data.result?.message_id;
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

// ===== SQLite profile helpers =====
function initProfile(id: string) {
  const existing = [...db.query("SELECT id FROM profiles WHERE id = ?", [id])];
  if (existing.length === 0) {
    db.query("INSERT INTO profiles (id, wins, losses, trophies) VALUES (?, 0, 0, 0)", [id]);
  }
}

function getProfile(id: string) {
  const result = [...db.query("SELECT wins, losses, trophies FROM profiles WHERE id = ?", [id])];
  if (result.length === 0) return { wins: 0, losses: 0, trophies: 0 };
  const [wins, losses, trophies] = result[0];
  return { wins, losses, trophies };
}

function updateProfile(id: string, fields: { wins?: number; losses?: number; trophies?: number }) {
  const profile = getProfile(id);
  const wins = fields.wins ?? profile.wins;
  const losses = fields.losses ?? profile.losses;
  const trophies = fields.trophies ?? profile.trophies;
  db.query(
    "UPDATE profiles SET wins = ?, losses = ?, trophies = ? WHERE id = ?",
    [wins, losses, trophies, id]
  );
}

// ===== Rock-paper-scissors logic =====
function winner(move1: string, move2: string): number {
  if (move1 === move2) return 0;
  if (
    (move1 === "rock" && move2 === "scissors") ||
    (move1 === "scissors" && move2 === "paper") ||
    (move1 === "paper" && move2 === "rock")
  ) return 1;
  return -1;
}

// ===== Battle logic (in-memory) =====
async function startBattle(p1: string, p2: string) {
  const battle = {
    players: [p1, p2],
    scores: { [p1]: 0, [p2]: 0 },
    choices: {} as Record<string, string>,
    choiceMsgs: {} as Record<string, number>,
    timeoutId: 0 as any,
    idleTimerId: 0 as any,
  };
  battles[p1] = battle;
  battles[p2] = battle;

  await sendMessage(p1, `Opponent found! Battle vs ${p2}`);
  await sendMessage(p2, `Opponent found! Battle vs ${p1}`);

  battle.idleTimerId = setTimeout(() => endBattleIdle(battle), 300000);
  nextRound(battle);
}

async function nextRound(battle: any) {
  battle.choices = {};
  battle.choiceMsgs = {};

  for (const player of battle.players) {
    const msgId = await sendMessage(player, "Choose your move (you have 30 sec):", {
      reply_markup: {
        inline_keyboard: [[
          { text: "🪨 Rock", callback_data: "rock" },
          { text: "📄 Paper", callback_data: "paper" },
          { text: "✂️ Scissors", callback_data: "scissors" },
        ]],
      },
    });
    if (msgId) battle.choiceMsgs[player] = msgId;
  }

  battle.timeoutId = setTimeout(() => resolveRound(battle), 30000);
}

async function resolveRound(battle: any) {
  clearTimeout(battle.timeoutId);

  for (const p of battle.players) {
    if (!battle.choices[p]) battle.choices[p] = "rock"; // default
    if (battle.choiceMsgs[p]) {
      await deleteMessage(p, battle.choiceMsgs[p]);
    }
  }

  const [p1, p2] = battle.players;
  const r = winner(battle.choices[p1], battle.choices[p2]);

  if (r === 1) battle.scores[p1]++;
  else if (r === -1) battle.scores[p2]++;

  await sendMessage(p1, `You: ${battle.choices[p1]} | Opponent: ${battle.choices[p2]}\nScore: ${battle.scores[p1]} - ${battle.scores[p2]}`);
  await sendMessage(p2, `You: ${battle.choices[p2]} | Opponent: ${battle.choices[p1]}\nScore: ${battle.scores[p2]} - ${battle.scores[p1]}`);

  if (battle.scores[p1] === 3 || battle.scores[p2] === 3) {
    clearTimeout(battle.idleTimerId);
    const winnerId = battle.scores[p1] === 3 ? p1 : p2;
    const loserId = winnerId === p1 ? p2 : p1;

    initProfile(winnerId);
    initProfile(loserId);

    const winnerProfile = getProfile(winnerId);
    const loserProfile = getProfile(loserId);

    updateProfile(winnerId, {
      wins: winnerProfile.wins + 1,
      trophies: winnerProfile.trophies + 1,
    });
    updateProfile(loserId, {
      losses: loserProfile.losses + 1,
    });

    await sendMessage(winnerId, `🎉 You won the battle! 🏆 +1 trophy`);
    await sendMessage(loserId, `😢 You lost the battle.`);

    delete battles[p1];
    delete battles[p2];
  } else {
    nextRound(battle);
  }
}

async function endBattleIdle(battle: any) {
  const [p1, p2] = battle.players;
  await sendMessage(p1, "⚠️ Battle ended due to inactivity (5 minutes, no moves).");
  await sendMessage(p2, "⚠️ Battle ended due to inactivity (5 minutes, no moves).");
  delete battles[p1];
  delete battles[p2];
}

// ===== Serve =====
serve(async (req) => {
  const update = await req.json();

  if (update.message) {
    const chatId = String(update.message.chat.id);
    const text = update.message.text;

    if (text === "/battle") {
      if (battles[chatId]) {
        await sendMessage(chatId, "⚔️ You are already in a battle!");
      } else if (queue.includes(chatId)) {
        await sendMessage(chatId, "⌛ You are already searching for an opponent...");
      } else if (queue.length > 0 && queue[0] !== chatId) {
        const opponent = queue.shift()!;
        startBattle(chatId, opponent);
      } else {
        queue.push(chatId);
        sendMessage(chatId, "Searching opponent...");
      }
    }

    if (text === "/profile") {
      initProfile(chatId);
      const p = getProfile(chatId);
      sendMessage(chatId, `📊 Profile:\nWins: ${p.wins}\nLosses: ${p.losses}\nTrophies: ${p.trophies}`);
    }
  }

  if (update.callback_query) {
    const chatId = String(update.callback_query.message.chat.id);
    const choice = update.callback_query.data;

    const battle = battles[chatId];
    if (battle && !battle.choices[chatId]) {
      battle.choices[chatId] = choice;
      sendMessage(chatId, `You chose ${choice}`);

      clearTimeout(battle.idleTimerId);
      battle.idleTimerId = setTimeout(() => endBattleIdle(battle), 300000);

      if (battle.choices[battle.players[0]] && battle.choices[battle.players[1]]) {
        resolveRound(battle);
      }
    }

    await answerCallbackQuery(update.callback_query.id);
  }

  return new Response("ok");
});

