// sponsor_bot_deno_webhook.ts
// Deno + Telegram Bot (Webhook görnüşinde)
// Features: /start, admin panel, kanallary dolandyrmak, admin goşmak, VPN kodlaryny goşmak (tekst/faýl), türkmençe habarlar

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const TOKEN = Deno.env.get("BOT_TOKEN");
if (!TOKEN) throw new Error("BOT_TOKEN env var is required");

const API = `https://api.telegram.org/bot${TOKEN}`;
const SECRET_PATH = "/masakoffvpnhelper"; // webhook path

// JSON storage helpers
async function ensureFile(path: string, def: any) {
  try { await Deno.stat(path); } catch { await Deno.writeTextFile(path, JSON.stringify(def, null, 2)); }
}
await Deno.mkdir("data").catch(()=>{});
await ensureFile("data/channels.json", []);
await ensureFile("data/admins.json", []);
await ensureFile("data/codes.json", []);
await ensureFile("data/pending.json", {});

async function read(path: string) { return JSON.parse(await Deno.readTextFile(path)); }
async function write(path: string, obj: any) { await Deno.writeTextFile(path, JSON.stringify(obj, null, 2)); }

// Messages (Türkmençe)
const MSG = {
  START: `Salam! Salam VPN kody almak üçin aşakdaky kanallara agza bolmaly:\n\nAgza bolansoň "Barla" düwmesine basyň.`,
  ALL_OK: `Siz ähli talap edilen kanallara agza! Ine VPN kodyňyz:`,
  NOT_MEMBER: `Siz käbir kanallara entek agza däl.`,
  ADMIN_ONLY: `Bu buýrugy diňe admin ýerine ýetirip biler.`,
};

// HTTP request helper
aSync function api(method: string, body: any) {
  return await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// Process updates
async function handleUpdate(update: any) {
  if (update.message) {
    const msg = update.message;
    const chatId = msg.chat.id;
    const text = msg.text || "";

    if (text === "/start") {
      const channels = await read("data/channels.json");
      const buttons = channels.map((c: string) => [{ text: "@"+c, url: `https://t.me/${c}` }]);
      buttons.push([{ text: "Barla", callback_data: "check_join" }]);
      await api("sendMessage", { chat_id: chatId, text: MSG.START, reply_markup: { inline_keyboard: buttons } });
    }

    if (text === "/admin") {
      const admins = await read("data/admins.json");
      if (!admins.includes(msg.from.id)) {
        await api("sendMessage", { chat_id: chatId, text: MSG.ADMIN_ONLY });
        return;
      }
      const kb = [
        [{ text: "Kanal goş", callback_data: "admin_add_channel" }, { text: "Kanal poz", callback_data: "admin_remove_channel" }],
        [{ text: "Kanallar", callback_data: "admin_list_channels" }],
        [{ text: "Admin goş", callback_data: "admin_add_admin" }],
        [{ text: "Kod goş", callback_data: "admin_add_codes" }],
      ];
      await api("sendMessage", { chat_id: chatId, text: "Admin paneli", reply_markup: { inline_keyboard: kb } });
    }
  }

  if (update.callback_query) {
    const cq = update.callback_query;
    const data = cq.data;
    const chatId = cq.message.chat.id;
    const userId = cq.from.id;

    if (data === "check_join") {
      const channels = await read("data/channels.json");
      const notMember: string[] = [];
      for (const c of channels) {
        try {
          const res = await fetch(`${API}/getChatMember`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ chat_id: "@"+c, user_id: userId }),
          });
          const js = await res.json();
          const st = js.result?.status;
          if (!st || st === "left" || st === "kicked") notMember.push(c);
        } catch { notMember.push(c); }
      }
      if (notMember.length === 0) {
        const codes = await read("data/codes.json");
        if (codes.length === 0) {
          await api("sendMessage", { chat_id: chatId, text: "Kod ýok" });
        } else {
          const code = codes.shift();
          await write("data/codes.json", codes);
          await api("sendMessage", { chat_id: chatId, text: `${MSG.ALL_OK}\n${code}` });
        }
      } else {
        await api("sendMessage", { chat_id: chatId, text: `${MSG.NOT_MEMBER}\n${notMember.join("\n")}` });
      }
    }
  }
}

// Start server
console.log("Bot webhook mode başlady...");
serve(async (req) => {
  const url = new URL(req.url);
  if (url.pathname === SECRET_PATH && req.method === "POST") {
    const update = await req.json();
    handleUpdate(update);
    return new Response("OK");
  }
  return new Response("Not found", { status: 404 });
});


