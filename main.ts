// main.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

// ---------------------- CONFIG ----------------------
const TOKEN = Deno.env.get("BOT_TOKEN")!;
const API = `https://api.telegram.org/bot${TOKEN}`;
const SECRET_PATH = "/masakoffvpnhelper";

// Supabase
const SUPABASE_URL = "https://ogaeqaxntvdkzmbjigtq.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9nYWVxYXhudHZka3ptYmppZ3RxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc0OTgyODMsImV4cCI6MjA3MzA3NDI4M30.gfRMqvtWUd-swvYCr0nJOgY2HDLlDLcn2Aet1rEuADs";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ---------------------- BATTLE STATE ----------------------
let queue: string[] = [];
const battles: Record<string, any> = {};

// ---------------------- TELEGRAM HELPERS ----------------------
async function sendMessage(chatId: string, text: string, options: any = {}) {
  try {
    const res = await fetch(`${API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, ...options }),
    });
    const data = await res.json();
    return data.result?.message_id;
  } catch (err) {
    console.error("sendMessage error:", err);
  }
}

async function deleteMessage(chatId: string, messageId: number) {
  try {
    await fetch(`${API}/deleteMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId }),
    });
  } catch (err) {
    console.error("deleteMessage error:", err);
  }
}

async function answerCallbackQuery(id: string, text = "") {
  try {
    await fetch(`${API}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: id, text }),
    });
  } catch (err) {
    console.error("answerCallbackQuery error:", err);
  }
}

// ---------------------- SUPABASE PROFILE HELPERS ----------------------
async function initProfile(userId: string) {
  try {
    const { data } = await supabase.from("profiles").select("*").eq("id", userId).single();
    if (!data) {
      await supabase.from("profiles").insert({ id: userId, wins: 0, losses: 0, trophies: 0 });
      return { wins: 0, losses: 0, trophies: 0 };
    }
    return data;
  } catch (err) {
    console.error("initProfile error:", err);
    return { wins: 0, losses: 0, trophies: 0 };
  }
}

async function getProfile(userId: string) {
  try {
    const { data } = await supabase.from("profiles").select("*").eq("id", userId).single();
    return data;
  } catch (err) {
    console.error("getProfile error:", err);
    return { wins: 0, losses: 0, trophies: 0 };
  }
}

async function updateProfile(userId: string, updates: Partial<{ wins: number; losses: number; trophies: number }>) {
  try {
    await supabase.from("profiles").update(updates).eq("id", userId);
  } catch (err) {
    console.error("updateProfile error:", err);
  }
}

// ---------------------- BATTLE LOGIC ----------------------
function winner(move1: string, move2: string): number {
  if (move1 === move2) return 0;
  if (
    (move1 === "rock" && move2 === "scissors") ||
    (move1 === "scissors" && move2 === "paper") ||
    (move1 === "paper" && move2 === "rock")
  ) return 1;
  return -1;
}

async function startBattle(p1: string, p2: string) {
  try {
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
  } catch (err) {
    console.error("startBattle error:", err);
  }
}

async function nextRound(battle: any) {
  try {
    battle.choices = {};
    battle.choiceMsgs = {};

    for (const player of battle.players) {
      const msgId = await sendMessage(player, "Choose your move (30 sec):", {
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
  } catch (err) {
    console.error("nextRound error:", err);
  }
}

async function resolveRound(battle: any) {
  try {
    clearTimeout(battle.timeoutId);

    for (const p of battle.players) {
      if (!battle.choices[p]) battle.choices[p] = "rock";
      if (battle.choiceMsgs[p]) await deleteMessage(p, battle.choiceMsgs[p]);
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

      await initProfile(winnerId);
      await initProfile(loserId);

      const winnerProfile = await getProfile(winnerId);
      const loserProfile = await getProfile(loserId);

      await updateProfile(winnerId, {
        wins: winnerProfile.wins + 1,
        trophies: winnerProfile.trophies + 1,
      });
      await updateProfile(loserId, { losses: loserProfile.losses + 1 });

      await sendMessage(winnerId, `🎉 You won the battle! 🏆 +1 trophy`);
      await sendMessage(loserId, `😢 You lost the battle.`);

      delete battles[p1];
      delete battles[p2];
    } else {
      nextRound(battle);
    }
  } catch (err) {
    console.error("resolveRound error:", err);
  }
}

async function endBattleIdle(battle: any) {
  try {
    const [p1, p2] = battle.players;
    await sendMessage(p1, "⚠️ Battle ended due to inactivity (5 min).");
    await sendMessage(p2, "⚠️ Battle ended due to inactivity (5 min).");
    delete battles[p1];
    delete battles[p2];
  } catch (err) {
    console.error("endBattleIdle error:", err);
  }
}

// ---------------------- SERVER ----------------------
console.log("Bot started! Waiting for updates...");

serve(async (req) => {
  try {
    const update = await req.json();
    console.log("Received update:", JSON.stringify(update).slice(0, 200)); // log first 200 chars

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
        await initProfile(chatId);
        const p = await getProfile(chatId);
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
  } catch (err) {
    console.error("Server error:", err);
  }

  return new Response("ok");
});
