// main.ts
// Telegram Nakrutka Bot (Deno) - Simple version for boosting likes on posts
// Features: Asks for post link, then number of likes, then simulates nakrutka
// Notes: This is a simulation only; actual multi-like boosting requires multiple accounts or services, which may violate Telegram's terms.
//        Requires BOT_TOKEN env var and Deno KV. Deploy as webhook at SECRET_PATH.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const TOKEN = Deno.env.get("BOT_TOKEN")!;
if (!TOKEN) throw new Error("BOT_TOKEN env var is required");
const API = `https://api.telegram.org/bot${TOKEN}`;
const SECRET_PATH = "/masakoffvpnhelper; // make sure webhook path matches
const BOT_USERNAME = "MasakoffVpnHelper"; // Adjust to your bot's username

// Deno KV
const kv = await Deno.openKv();

// State helpers using KV
type NakrutkaState = {
  step: "link" | "amount";
  link?: string;
};

async function getNakrutkaState(userId: string): Promise<NakrutkaState | null> {
  const res = await kv.get<NakrutkaState>(["states", "nakrutka", userId]);
  return res.value;
}

async function setNakrutkaState(userId: string, state: NakrutkaState | null) {
  if (state) {
    await kv.set(["states", "nakrutka", userId], state);
  } else {
    await kv.delete(["states", "nakrutka", userId]);
  }
}

// -------------------- Telegram helpers --------------------
async function sendMessage(chatId: string | number, text: string, options: any = {}): Promise<number | null> {
  try {
    const body: any = { chat_id: chatId, text, ...options };
    const res = await fetch(`${API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return data.result?.message_id ?? null;
  } catch (e) {
    console.error("sendMessage error", e);
    return null;
  }
}

// -------------------- Profile helpers --------------------
type Profile = {
  id: string;
  username?: string;
  displayName: string;
  lastActive: number;
};

async function initProfile(userId: string, username?: string, displayName?: string): Promise<{ profile: Profile; isNew: boolean }> {
  const key = ["profiles", userId];
  const res = await kv.get(key);
  if (!res.value) {
    const profile: Profile = {
      id: userId,
      username,
      displayName: displayName || `ID:${userId}`,
      lastActive: Date.now(),
    };
    await kv.set(key, profile);
    return { profile, isNew: true };
  } else {
    const existing = res.value as Profile;
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
    await kv.set(key, existing); // Always save to update lastActive
    return { profile: existing, isNew: false };
  }
}

// -------------------- Nakrutka handler --------------------
async function handleNakrutkaInput(fromId: string, text: string) {
  const state = await getNakrutkaState(fromId);
  if (!state) {
    await sendMessage(fromId, "❌ Nakrutka prosesi ýok. /start ulanyň.");
    return;
  }

  if (state.step === "link") {
    const link = text.trim();
    if (!link.startsWith("https://t.me/")) {
      await sendMessage(fromId, "❌ Dogry Telegram post link giriziň (meselem: https://t.me/channel/123).");
      return;
    }
    await setNakrutkaState(fromId, { step: "amount", link });
    await sendMessage(fromId, "Näçe like isleýärsiňiz? San giriziň:");
    return;
  } else if (state.step === "amount") {
    const amount = parseInt(text.trim());
    if (isNaN(amount) || amount <= 0 || amount > 1000) { // Arbitrary limit for simulation
      await sendMessage(fromId, "❌ Dogry san giriziň (1-den 1000-e çenli).");
      return;
    }
    const link = state.link!;
    await sendMessage(fromId, `🔄 ${amount} like goşulýar ${link}... (Simulýasiýa)`);
    // Simulate delay
    await new Promise(resolve => setTimeout(resolve, 2000));
    await sendMessage(fromId, `✅ Tamamlandy! ${amount} like goşuldy ${link}. (Bu simulýasiýa; hakyky ulgamda köp hasap gerek bolup biler.)`);
    await setNakrutkaState(fromId, null);
    return;
  }
}

// -------------------- Commands --------------------
async function handleCommand(fromId: string, username: string | undefined, displayName: string, text: string, isNew: boolean) {
  if (text.startsWith("/start")) {
    await showHelp(fromId);
    return;
  }

  if (text.startsWith("/nakrutka")) {
    if (await getNakrutkaState(fromId)) {
      await sendMessage(fromId, "Siz eýýäm nakrutka prosesinde. Ilki tamamlaň ýa-da /cancel ediň.");
      return;
    }
    await setNakrutkaState(fromId, { step: "link" });
    await sendMessage(fromId, "Telegram post linkini giriziň (meselem: https://t.me/channel/123):");
    return;
  }

  if (text.startsWith("/cancel")) {
    if (await getNakrutkaState(fromId)) {
      await setNakrutkaState(fromId, null);
      await sendMessage(fromId, "✅ Nakrutka prosesi ýatyryldy.");
    } else {
      await sendMessage(fromId, "❌ Ýatyrylýan proses ýok.");
    }
    return;
  }

  await sendMessage(fromId, "❓ Näbelli buýruk. /help gör.");
}

// -------------------- Show help --------------------
async function showHelp(fromId: string) {
  const helpText =
    `🌟 Salam! Nakrutka BOT-a hoş geldiňiz!\n\n` +
    `📈 Telegram postlaryňyza like goşmak üçin ulanyň.\n\n` +
    `/nakrutka - Täze nakrutka başlaň\n` +
    `/cancel - Prosesi ýatyryň\n\n` +
    `Diňe simulýasiýa; hakyky nakrutka üçin has köp hasap ýa-da hyzmat gerek.`;
  await sendMessage(fromId, helpText, { parse_mode: "Markdown" });
}

// -------------------- Server / Webhook --------------------
serve(async (req: Request) => {
  try {
    const url = new URL(req.url);
    if (url.pathname !== SECRET_PATH) return new Response("Not found", { status: 404 });
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

    const update = await req.json();

    // handle normal messages
    if (update.message) {
      const msg = update.message;
      if (msg.chat.type !== "private") return new Response("OK");
      const from = msg.from;
      const text = (msg.text || "").trim();
      const fromId = String(from.id);
      const username = from.username;
      const displayName = from.first_name || from.username || fromId;

      const { profile, isNew } = await initProfile(fromId, username, displayName);

      if (text.startsWith("/")) {
        await handleCommand(fromId, username, displayName, text, isNew);
      } else if (await getNakrutkaState(fromId)) {
        await handleNakrutkaInput(fromId, text);
      } else {
        await sendMessage(fromId, "❓ Näbelli buýruk. /help gör.");
      }
    }

    return new Response("OK");
  } catch (e) {
    console.error("server error", e);
    return new Response("Error", { status: 500 });
  }
});
