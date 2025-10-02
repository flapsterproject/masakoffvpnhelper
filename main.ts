// main.ts
// Telegram Sponsor Bot (Deno)
// Features: VPN code distribution bot with mandatory channel subscriptions.
// Admins can manage channels, add admins, add VPN codes (text or file), broadcast messages.
// Users must join all mandatory channels to get a VPN code.
// All messages in Turkmen.
// Requires Deno 2.0+.
// Notes: Requires BOT_TOKEN env var. Deploy as webhook at SECRET_PATH.
// Bot must be admin in channels to check memberships.
// Channels added as: add_channel Name https://t.me/username
// Stores data in JSON files for persistence.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const TOKEN = Deno.env.get("BOT_TOKEN")!;
if (!TOKEN) throw new Error("BOT_TOKEN env var is required");
const TELEGRAM_API = `https://api.telegram.org/bot${TOKEN}`;
const SECRET_PATH = "/masakoffvpnhelper"; // Change to your webhook path

// Data files
const ADMINS_FILE = "admins.json";
const CHANNELS_FILE = "channels.json";
const CODES_FILE = "codes.json";
const USERS_FILE = "users.json";

// Load/Save functions
async function loadData(file: string, defaultValue: any): Promise<any> {
  try {
    const text = await Deno.readTextFile(file);
    return JSON.parse(text);
  } catch {
    return defaultValue;
  }
}

async function saveData(file: string, data: any): Promise<void> {
  await Deno.writeTextFile(file, JSON.stringify(data));
}

// Initialize data
let admins: number[] = await loadData(ADMINS_FILE, []);
let channels: { name: string; link: string; username: string }[] = await loadData(CHANNELS_FILE, []);
let vpnCodes: string[] = await loadData(CODES_FILE, []);
let users: number[] = await loadData(USERS_FILE, []);

// States for multi-step interactions (per user)
const states: Map<number, string> = new Map();

// -------------------- Telegram helpers --------------------
async function sendMessage(chatId: number, text: string, options: any = {}): Promise<number | null> {
  try {
    const body: any = { chat_id: chatId, text, ...options };
    const res = await fetch(`${TELEGRAM_API}/sendMessage`, {
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

async function checkMembership(userId: number, channelUsername: string): Promise<boolean> {
  try {
    const res = await fetch(`${TELEGRAM_API}/getChatMember?chat_id=@${channelUsername}&user_id=${userId}`);
    const data = await res.json();
    if (!data.ok) return false;
    const status = data.result.status;
    return ["creator", "administrator", "member"].includes(status);
  } catch (e) {
    console.error("checkMembership error", e);
    return false;
  }
}

// -------------------- Handlers --------------------
async function handleMessage(msg: any) {
  const text = msg.text?.trim() || "";
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  // Add user if new
  if (!users.includes(userId)) {
    users.push(userId);
    await saveData(USERS_FILE, users);
  }

  // Check for states first
  if (states.has(userId)) {
    const state = states.get(userId)!;
    states.delete(userId);

    if (state === "broadcast_type") {
      const input = text;
      if (input === "toplu") {
        await sendMessage(chatId, "Toplu ryssylka tekstini ýazyň:");
        states.set(userId, "broadcast_all_text");
      } else {
        try {
          const targetId = parseInt(input);
          await sendMessage(chatId, "Ryssylka tekstini ýazyň:");
          states.set(userId, `broadcast_single_text_${targetId}`);
        } catch {
          await sendMessage(chatId, "Nädogry ID!");
        }
      }
      return;
    } else if (state === "broadcast_all_text") {
      const msgText = text;
      for (const u of users) {
        await sendMessage(u, msgText);
      }
      await sendMessage(chatId, "Toplu ryssylka ugradyldy.");
      return;
    } else if (state.startsWith("broadcast_single_text_")) {
      const targetId = parseInt(state.split("_")[3]);
      await sendMessage(targetId, text);
      await sendMessage(chatId, "Ryssylka ugradyldy.");
      return;
    } else if (state === "add_admin") {
      try {
        const newAdmin = parseInt(text);
        if (!admins.includes(newAdmin)) {
          admins.push(newAdmin);
          await saveData(ADMINS_FILE, admins);
          await sendMessage(chatId, "Täze admin goşuldy.");
        } else {
          await sendMessage(chatId, "Bu admin eýýäm bar.");
        }
      } catch {
        await sendMessage(chatId, "Nädogry ID!");
      }
      return;
    } else if (state === "add_vpn_code") {
      if (msg.document) {
        try {
          const fileId = msg.document.file_id;
          const fileRes = await fetch(`${TELEGRAM_API}/getFile?file_id=${fileId}`);
          const fileData = await fileRes.json();
          if (!fileData.ok) throw new Error();
          const filePath = fileData.result.file_path;
          const downloadRes = await fetch(`https://api.telegram.org/file/bot${TOKEN}/${filePath}`);
          const fileText = await downloadRes.text();
          const codes = fileText.split("\n").map((c: string) => c.trim()).filter((c: string) => c);
          vpnCodes.push(...codes);
          await saveData(CODES_FILE, vpnCodes);
          await sendMessage(chatId, "Faýldan kodlar goşuldy.");
        } catch (e) {
          console.error("File download error", e);
          await sendMessage(chatId, "Faýly ýüklemekde ýalňyşlyk.");
        }
      } else {
        vpnCodes.push(text);
        await saveData(CODES_FILE, vpnCodes);
        await sendMessage(chatId, "Kod goşuldy.");
      }
      return;
    }
  }

  // Admin-only commands (not using / for flexibility)
  if (admins.includes(userId)) {
    if (text.startsWith("add_channel ")) {
      try {
        const parts = text.slice(11).trim().split(" ");
        if (parts.length < 2) throw new Error();
        const name = parts[0];
        const link = parts[1];
        const username = link.split("/").pop()!;
        channels.push({ name, link, username });
        await saveData(CHANNELS_FILE, channels);
        await sendMessage(chatId, "Kanal goşuldy.");
        return;
      } catch {
        await sendMessage(chatId, "Format: add_channel Name https://t.me/username");
      }
    } else if (text.startsWith("remove_channel ")) {
      try {
        const name = text.slice(14).trim();
        channels = channels.filter((ch) => ch.name !== name);
        await saveData(CHANNELS_FILE, channels);
        await sendMessage(chatId, "Kanal aýyryldy.");
        return;
      } catch {
        await sendMessage(chatId, "Format: remove_channel Name");
      }
    }
  }

  // Regular commands
  if (text === "/start") {
    const msgText = "Salam! VPN kody almak üçin aşakdaky kanallara agza bolmaly.";
    const inlineKeyboard = channels.map((ch) => [{ text: ch.name, url: ch.link }]);
    inlineKeyboard.push([{ text: "Agzalygymy barla", callback_data: "check_join" }]);
    await sendMessage(chatId, msgText, { reply_markup: { inline_keyboard: inlineKeyboard } });
    return;
  }

  if (text === "/admin") {
    if (!admins.includes(userId)) {
      await sendMessage(chatId, "Siz admin däl!");
      return;
    }
    const msgText = "Admin paneline hoş geldiňiz!";
    const inlineKeyboard = [
      [{ text: "Ryssylka", callback_data: "broadcast" }],
      [{ text: "Kanallar dolandyryş", callback_data: "manage_channels" }],
      [{ text: "Admin goş", callback_data: "add_admin" }],
      [{ text: "VPN kody goş", callback_data: "add_vpn_code" }],
    ];
    await sendMessage(chatId, msgText, { reply_markup: { inline_keyboard: inlineKeyboard } });
    return;
  }
}

async function handleCallbackQuery(callback: any) {
  const userId = callback.from.id;
  const data = callback.data;
  const chatId = callback.message.chat.id;
  const messageId = callback.message.message_id;

  // Answer the callback to remove loading
  await fetch(`${TELEGRAM_API}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callback.id }),
  });

  if (!admins.includes(userId)) return; // Most callbacks are admin-only, but check_join is for users

  if (data === "check_join") {
    let joinedAll = true;
    const notJoined: string[] = [];
    for (const ch of channels) {
      const joined = await checkMembership(userId, ch.username);
      if (!joined) {
        joinedAll = false;
        notJoined.push(ch.name);
      }
    }
    if (joinedAll) {
      if (vpnCodes.length > 0) {
        const code = vpnCodes.shift()!;
        await saveData(CODES_FILE, vpnCodes);
        await sendMessage(chatId, `VPN kodyňyz: ${code}`);
      } else {
        await sendMessage(chatId, "Häzirlikde VPN kody ýok.");
      }
    } else {
      await sendMessage(chatId, `Siz henüz agza bolmadyňyz kanallara: ${notJoined.join(", ")}`);
    }
    return;
  }

  // Admin callbacks
  if (data === "broadcast") {
    await sendMessage(chatId, "Ryssylka üçin ID ýa-da 'toplu' ýazyň:");
    states.set(userId, "broadcast_type");
  } else if (data === "manage_channels") {
    const instr = "Kanal goşmak üçin: add_channel Name https://t.me/username\nKanal aýyrmak üçin: remove_channel Name";
    await sendMessage(chatId, instr);
  } else if (data === "add_admin") {
    await sendMessage(chatId, "Täze admin ID-sini ýazyň:");
    states.set(userId, "add_admin");
  } else if (data === "add_vpn_code") {
    await sendMessage(chatId, "VPN kody goşmak üçin kod ýazyň ýa-da faýl ugrat:");
    states.set(userId, "add_vpn_code");
  }
}

// -------------------- Main update handler --------------------
async function handleUpdate(update: any) {
  if (update.message) {
    await handleMessage(update.message);
  } else if (update.callback_query) {
    await handleCallbackQuery(update.callback_query);
  }
}

// -------------------- Server / Webhook --------------------
serve(async (req: Request) => {
  try {
    const url = new URL(req.url);
    if (url.pathname !== SECRET_PATH) return new Response("Not found", { status: 404 });
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

    const update = await req.json();
    await handleUpdate(update);

    return new Response("OK");
  } catch (e) {
    console.error("server error", e);
    return new Response("Error", { status: 500 });
  }
});