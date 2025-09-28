import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const TOKEN = Deno.env.get("BOT_TOKEN")!;
if (!TOKEN) throw new Error("BOT_TOKEN env var is required");
const API = `https://api.telegram.org/bot${TOKEN}`;
const SECRET_PATH = "/masakoffvpnhelper"; // webhook URL'in path'i ile aynı olmalı

// Deno KV
const kv = await Deno.openKv();

// Admin (şimdilik username ile kontrol, istersen ID de yapabiliriz)
const ADMIN_USERNAME = "@Masakoff";

// Yardımcı API çağrısı
async function callApi(method: string, body: any) {
  const res = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

// Inline klavye helper
function ik(rows: Array<Array<any>>) {
  return { reply_markup: { inline_keyboard: rows } };
}

// Start komutu
async function handleStart(chat_id: number) {
  const channels: string[] = (await kv.get(["channels"])).value || [];
  const text =
    "Salam! Salam VPN kody almak üçin aşakdaky kanallara agza bolmaly:";
  const buttons = channels.map((ch) => [{ text: ch, url: `https://t.me/${ch}` }]);

  await callApi("sendMessage", {
    chat_id,
    text,
    reply_markup: { inline_keyboard: buttons },
  });
}

// Admin panel
async function sendAdminPanel(chat_id: number) {
  const rows = [
    [
      { text: "Kanal goş", callback_data: "add_channel" },
      { text: "Kanal aýyr", callback_data: "remove_channel" },
    ],
    [
      { text: "Adlist goş", callback_data: "adlist" },
      { text: "Adlist görkez", callback_data: "adlist_show" },
    ],
    [
      { text: "Toplu habar", callback_data: "broadcast" },
      { text: "Admin goş", callback_data: "add_admin" },
    ],
    [
      { text: "VPN kod goş", callback_data: "add_code" },
      { text: "Kod faýl ýükle", callback_data: "upload_codes" },
    ],
  ];

  await callApi("sendMessage", {
    chat_id,
    text: "Admin paneli — aşakdaky düwmelerden saýlaň:",
    ...ik(rows),
  });
}

// Requestleri kabul et
serve(async (req) => {
  const url = new URL(req.url);
  if (url.pathname !== SECRET_PATH) {
    return new Response("Not Found", { status: 404 });
  }

  const update = await req.json();

  if (update.message) {
    const msg = update.message;
    const text = msg.text || "";
    const chat_id = msg.chat.id;

    // /start
    if (text.startsWith("/start")) {
      await handleStart(chat_id);
    }

    // /admin
    if (text.startsWith("/admin")) {
      if (msg.from.username === ADMIN_USERNAME.replace("@", "")) {
        await sendAdminPanel(chat_id);
      } else {
        await callApi("sendMessage", {
          chat_id,
          text: "Siz admin däl.",
        });
      }
    }
  }

  if (update.callback_query) {
    const cb = update.callback_query;
    const data = cb.data;
    const chat_id = cb.message.chat.id;

    // örnek: callback handler
    if (data === "add_channel") {
      await callApi("sendMessage", {
        chat_id,
        text: "Kanal goşmak üçin: /addchannel <kanal>",
      });
    }
  }

  return new Response("OK");
});

