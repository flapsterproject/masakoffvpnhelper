// main.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const TOKEN = Deno.env.get("BOT_TOKEN")!;
const API = `https://api.telegram.org/bot${TOKEN}`;
const SECRET_PATH = "/masakoffvpnhelper";

// In-memory DB
const profiles: Record<string, { trophies: number; wins: number; losses: number }> = {};

// Battle matchmaking state
let queue: string[] = []; // users waiting
const battles: Record<string, any> = {}; // chatId -> battle state

async function sendMessage(chatId: string, text: string, options: any = {}) {
  await fetch(`${API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, ...options }),
  });
}

function initProfile(userId: string) {
  if (!profiles[userId]) {
    profiles[userId] = { trophies: 0, wins: 0, losses: 0 };
  }
}

function getOpponent(battle: any, userId: string) {
  return battle.players.find((p: string) => p !== userId);
}

async function startBattle(p1: string, p2: string) {
  const battleId = `${p1}_${p2}`;
  const battle = {
    players: [p1, p2],
    scores: { [p1]: 0, [p2]: 0 },
    choices: {} as Record<string, string>,
  };
  battles[p1] = battle;
  battles[p2] = battle;

  await sendMessage(p1, `Opponent found! Battle vs ${p2}`);
  await sendMessage(p2, `Opponent found! Battle vs ${p1}`);

  nextRound(battle);
}

async function nextRound(battle: any) {
  battle.choices = {};
  for (const player of battle.players) {
    await sendMessage(player, "Choose your move (you have 5 sec):", {
      reply_markup: {
        inline_keyboard: [[
          { text: "🪨 Rock", callback_data: "rock" },
          { text: "📄 Paper", callback_data: "paper" },
          { text: "✂️ Scissors", callback_data: "scissors" },
        ]],
      },
    });
  }

  setTimeout(() => resolveRound(battle), 5000);
}

function winner(move1: string, move2: string): number {
  if (move1 === move2) return 0;
  if (
    (move1 === "rock" && move2 === "scissors") ||
    (move1 === "scissors" && move2 === "paper") ||
    (move1 === "paper" && move2 === "rock")
  ) return 1;
  return -1;
}

async function resolveRound(battle: any) {
  for (const p of battle.players) {
    if (!battle.choices[p]) battle.choices[p] = "rock"; // default
  }

  const [p1, p2] = battle.players;
  const r = winner(battle.choices[p1], battle.choices[p2]);

  if (r === 1) battle.scores[p1]++;
  else if (r === -1) battle.scores[p2]++;

  await sendMessage(p1, `You: ${battle.choices[p1]} | Opponent: ${battle.choices[p2]}\nScore: ${battle.scores[p1]} - ${battle.scores[p2]}`);
  await sendMessage(p2, `You: ${battle.choices[p2]} | Opponent: ${battle.choices[p1]}\nScore: ${battle.scores[p2]} - ${battle.scores[p1]}`);

  if (battle.scores[p1] === 3 || battle.scores[p2] === 3) {
    const winnerId = battle.scores[p1] === 3 ? p1 : p2;
    const loserId = winnerId === p1 ? p2 : p1;

    initProfile(winnerId);
    initProfile(loserId);

    profiles[winnerId].wins++;
    profiles[winnerId].trophies++;
    profiles[loserId].losses++;

    await sendMessage(winnerId, `🎉 You won the battle! +1 trophy`);
    await sendMessage(loserId, `😢 You lost the battle.`);

    delete battles[p1];
    delete battles[p2];
  } else {
    nextRound(battle);
  }
}

serve(async (req) => {
  const update = await req.json();

  if (update.message) {
    const chatId = String(update.message.chat.id);
    const text = update.message.text;

    if (text === "/battle") {
      if (queue.length > 0 && queue[0] !== chatId) {
        const opponent = queue.shift()!;
        startBattle(chatId, opponent);
      } else {
        queue.push(chatId);
        sendMessage(chatId, "Searching opponent...");
      }
    }

    if (text === "/profile") {
      initProfile(chatId);
      const p = profiles[chatId];
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
    }
  }

  return new Response("ok");
});
