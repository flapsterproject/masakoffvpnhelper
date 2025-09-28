/*
Sponsor (Salam VPN) Telegram Bot
- Deno + webhook style (std server)
- Messages in Turkmen
- Admin panel with inline buttons
- Persisted storage in JSON/text files (channels, admins, vpn codes, adlist)

Usage:
- Set env BOT_TOKEN and optionally ADMIN_ID to bootstrap the first admin.
- Set SECRET_PATH to match webhook path.
- Deploy to a server that accepts HTTPS and set Telegram webhook to https://<your-domain><SECRET_PATH>

NOTES:
- This is a single-file example. Adjust file paths and persistence for your deployment.
*/

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const TOKEN = Deno.env.get("BOT_TOKEN");
const ADMIN_BOOTSTRAP = Deno.env.get("ADMIN_ID"); // optional initial admin
const SECRET_PATH = Deno.env.get("SECRET_PATH") || "/masakoffvpnhelper";
if (!TOKEN) throw new Error("BOT_TOKEN env var is required");

const API = `https://api.telegram.org/bot${TOKEN}`;

// --- Simple file persistence helpers ---
const readJson = async (path: string, fallback: any) => {
  try {
    const raw = await Deno.readTextFile(path);
    return JSON.parse(raw);
  } catch (_e) {
    return fallback;
  }
};
const writeJson = async (path: string, data: any) => {
  await Deno.writeTextFile(path, JSON.stringify(data, null, 2));
};

// storage files
const DB_FILE = "db.json"; // { admins: number[], channels: string[], state: {<chatId>: {action, payload}} }
const ADLIST_FILE = "adlist.txt"; // newline separated channels
const VPN_CODES_FILE = "vpn_codes.txt"; // newline separated codes

// initialize db
const initDb = async () => {
  const db = await readJson(DB_FILE, null);
  if (!db) {
    const admins: number[] = ADMIN_BOOTSTRAP ? [Number(ADMIN_BOOTSTRAP)] : [];
    const newDb = { admins, channels: [], state: {} };
    await writeJson(DB_FILE, newDb);
    return newDb;
  }
  // ensure fields
  db.admins = db.admins || [];
  db.channels = db.channels || [];
  db.state = db.state || {};
  await writeJson(DB_FILE, db);
  return db;
};

let DB: any = await initDb();

const saveDb = async () => await writeJson(DB_FILE, DB);

// util: send message
async function sendMessage(chat_id: number | string, text: string, extra: any = {}) {
  const body = { chat_id, text, parse_mode: "HTML", ...extra };
  return fetch(`${API}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

async function editMessage(chat_id: number | string, message_id: number, text: string, extra: any = {}) {
  const body = { chat_id, message_id, text, parse_mode: "HTML", ...extra };
  return fetch(`${API}/editMessageText`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

async function answerCallback(callback_query_id: string, text?: string) {
  const body: any = { callback_query_id };
  if (text) body.text = text;
  await fetch(`${API}/answerCallbackQuery`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

// Inline keyboard builders
const mkInline = (rows: any[][]) => ({ reply_markup: { inline_keyboard: rows } });

// Turkmen text helpers
const TXT = {
  start_needed: (channels: string[]) => `Salam! VPN kody almak üçin aşakdaky kanallara <b>agza bolmaly</b>:
${channels.length ? channels.map((c,i)=>`${i+1}. ${c}`).join("\n") : "(Ýok)"}

Kanallaryň ählisine agza bolan ýagdaýda size VPN kody berleris.`,
  start_no_channels: `Salam! Hozirde zerur kanallar görkezilmändir. Administrator bilen habarlaşyň.`,
  not_admin: `Siz admin değilsiniz.`,
  admin_panel_title: `<< Admin Panel >>\nBu panel arkaly kanallary, adminleri we reklam ýazylyşlaryny dolandyrmak mümkin.`,
  choose_action: `Aşakdaky düwmelerden birini saýlaň:`,
  added_channel: (c: string) => `Kanaly goşdum: ${c}`,
  removed_channel: (c: string) => `Kanaly aýrydym: ${c}`,
  list_channels: (channels: string[]) => `Zerur kanallar:
${channels.length ? channels.map((c,i)=>`${i+1}. ${c}`).join("\n") : "(Hiç biri)"}`,
  got_vpn_code: `VPN kody üstünlikli goşuldy.`,
  uploaded_codes_file: `VPN kodlary faýldan üstünlikli goşuldy.`,
  added_admin: (id:number) => `Täze admin goşuldy: <code>${id}</code>`,
  prompt_forward_for_broadcast: `Ugratmak isleýän habaryňyzy şu chat-a <b>forward</b> ediň. Admin paneliňizde "Forward edin" düwmesine basyp bu jogap ýatda saklar.`,
  broadcast_sent: `Ugratma üstünlikli edildi.`
};

// Admin inline keyboard layout
const adminKeyboard = (adminId: number) => mkInline([
  [{ text: "📣 Ryssylka (Forward)", callback_data: `forward_broadcast` }, { text: "✉️ Ryssylka (Text)", callback_data: `text_broadcast` }],
  [{ text: "➕ Kanal goş", callback_data: `add_channel` }, { text: "➖ Kanal aýyr", callback_data: `remove_channel` }],
  [{ text: "📜 Kanal sanawy", callback_data: `list_channels` }],
  [{ text: "🗂️ Adlist (faýl) goş/öwür", callback_data: `manage_adlist` }, { text: "🔐 VPN kodlaryny faýl bilen goş", callback_data: `add_vpn_file` }],
  [{ text: "➕ Admin goş", callback_data: `add_admin` }]
]);

// Webhook server
serve(async (req) => {
  const url = new URL(req.url);
  if (url.pathname !== SECRET_PATH) return new Response("Not found", { status: 404 });

  const body = await req.json().catch(() => null);
  if (!body) return new Response("ok");

  // handle update
  handleUpdate(body).catch(err => console.error("handleUpdate:", err));
  return new Response("ok");
});

async function handleUpdate(update: any) {
  if (update.message) await handleMessage(update.message);
  else if (update.callback_query) await handleCallback(update.callback_query);
  else if (update.edited_message) await handleMessage(update.edited_message);
}

function isAdmin(userId: number) {
  return DB.admins.includes(userId);
}

async function handleMessage(msg: any) {
  const text = msg.text || msg.caption || "";
  const chatId = msg.chat.id;
  const fromId = msg.from?.id;

  // check pending admin state
  const pending = DB.state[chatId];
  if (pending && isAdmin(fromId)) {
    await handlePendingAdminAction(chatId, fromId, pending, msg);
    return;
  }

  if (text && text.startsWith("/start")) {
    if (DB.channels.length === 0) {
      await sendMessage(chatId, TXT.start_no_channels);
    } else {
      const kb = mkInline(DB.channels.map(c => [{ text: c, url: `https://t.me/${c.replace(/^@/,"")}` }]).concat([[{ text: "✅ Men ähli kanallara agza boldum", callback_data: `i_joined` }]]));
      await sendMessage(chatId, TXT.start_needed(DB.channels), kb);
    }
    return;
  }

  if (text && text.startsWith("/admin")) {
    // boot admin panel if user is admin or if admin password present? We'll restrict to configured admins
    if (!isAdmin(fromId)) {
      await sendMessage(chatId, TXT.not_admin);
      return;
    }
    await sendMessage(chatId, `${TXT.admin_panel_title}\n\n${TXT.choose_action}`, adminKeyboard(fromId));
    return;
  }

  // Admin commands as plain text
  if (isAdmin(fromId)) {
    // /addchannel <username>
    if (text && text.startsWith("/addchannel")) {
      const parts = text.split(/\s+/);
      if (parts[1]) {
        const ch = parts[1].trim();
        if (!DB.channels.includes(ch)) DB.channels.push(ch);
        await saveDb();
        await sendMessage(chatId, TXT.added_channel(ch));
      } else {
        await sendMessage(chatId, "Iltimos kanaly belirt: /addchannel @channelname ýa-da channelid");
      }
      return;
    }
    if (text && text.startsWith("/removechannel")) {
      const parts = text.split(/\s+/);
      if (parts[1]) {
        const ch = parts[1].trim();
        DB.channels = DB.channels.filter((c:string)=>c!==ch);
        await saveDb();
        await sendMessage(chatId, TXT.removed_channel(ch));
      } else {
        await sendMessage(chatId, "Iltimos kanaly belirt: /removechannel @channelname ýa-da channelid");
      }
      return;
    }

    // broadcast text
    if (text && text.startsWith("/broadcast_text")) {
      const payload = text.replace(/\/broadcast_text\s*/,'');
      const users = await getAllKnownUsers(); // placeholder for expansion
      for (const user of users) {
        await sendMessage(user, payload).catch(()=>{});
      }
      await sendMessage(chatId, TXT.broadcast_sent);
      return;
    }

    // add vpn code single
    if (text && text.startsWith("/addvpn")) {
      const code = text.replace(/\/addvpn\s*/,'').trim();
      if (code) {
        await Deno.writeTextFile(VPN_CODES_FILE, (await safeReadFile(VPN_CODES_FILE)) + code + "\n");
        await sendMessage(chatId, TXT.got_vpn_code);
      } else {
        await sendMessage(chatId, "Iltimos VPN kodyny yazyň: /addvpn CODE123");
      }
      return;
    }
  }

  // file uploads for admins: adlist or vpn codes
  if (msg.document && isAdmin(fromId)) {
    const fileId = msg.document.file_id;
    const filePath = await getFilePath(fileId);
    if (!filePath) {
      await sendMessage(chatId, "Faýl tapylmady.");
      return;
    }
    const content = await downloadFileContent(filePath);
    if (!content) {
      await sendMessage(chatId, "Faýl içerigi okalyp bolmady.");
      return;
    }
    // guess by filename or pending action
    const pendingAction = DB.state[chatId]?.action;
    if (pendingAction === 'awaiting_adlist') {
      await Deno.writeTextFile(ADLIST_FILE, content);
      await sendMessage(chatId, `Adlist faýly üstünlikli ýüklenildi.`);
      DB.state[chatId] = null;
      await saveDb();
      return;
    }
    if (pendingAction === 'awaiting_vpn_file') {
      // append to vpn codes
      await Deno.writeTextFile(VPN_CODES_FILE, (await safeReadFile(VPN_CODES_FILE)) + '\n' + content);
      await sendMessage(chatId, TXT.uploaded_codes_file);
      DB.state[chatId] = null;
      await saveDb();
      return;
    }

    // fallback: if filename contains 'adlist' or 'vpn'
    const fname = msg.document.file_name || '';
    if (fname.toLowerCase().includes('adlist')) {
      await Deno.writeTextFile(ADLIST_FILE, content);
      await sendMessage(chatId, `Adlist faýly üstünlikli ýüklenildi.`);
      return;
    }
    if (fname.toLowerCase().includes('vpn')) {
      await Deno.writeTextFile(VPN_CODES_FILE, (await safeReadFile(VPN_CODES_FILE)) + '\n' + content);
      await sendMessage(chatId, TXT.uploaded_codes_file);
      return;
    }

    await sendMessage(chatId, `Faýl alndy, ýöne nädip işlejekdigi belli däl. Administrator panelinden işlemi saýlaň.`);
    return;
  }
}

async function handleCallback(q: any) {
  const data = q.data;
  const fromId = q.from.id;
  const chatId = q.message.chat.id;
  const messageId = q.message.message_id;

  if (!isAdmin(fromId)) {
    await answerCallback(q.id, TXT.not_admin);
    return;
  }

  if (data === 'list_channels') {
    await editMessage(chatId, messageId, TXT.list_channels(DB.channels), adminKeyboard(fromId));
    await answerCallback(q.id);
    return;
  }

  if (data === 'add_channel') {
    DB.state[chatId] = { action: 'awaiting_channel_add' };
    await saveDb();
    await answerCallback(q.id, 'Iltimos kanal adyny ýazyň (meselem: @salomchannel ýa-da channelusername).');
    return;
  }

  if (data === 'remove_channel') {
    DB.state[chatId] = { action: 'awaiting_channel_remove' };
    await saveDb();
    await answerCallback(q.id, 'Iltimos aýyrjak kanalyňyzy ýazyň.');
    return;
  }

  if (data === 'text_broadcast') {
    DB.state[chatId] = { action: 'awaiting_broadcast_text' };
    await saveDb();
    await answerCallback(q.id, 'Indi ugradyljak tekstini şu chat-a ýazyň.');
    return;
  }

  if (data === 'forward_broadcast') {
    DB.state[chatId] = { action: 'awaiting_broadcast_forward' };
    await saveDb();
    await answerCallback(q.id, TXT.prompt_forward_for_broadcast);
    return;
  }

  if (data === 'manage_adlist') {
    DB.state[chatId] = { action: 'awaiting_adlist_file' };
    await saveDb();
    await answerCallback(q.id, 'Adlist faýlyny şu chat-a faýl hökmünde uçuryň.');
    return;
  }

  if (data === 'add_vpn_file') {
    DB.state[chatId] = { action: 'awaiting_vpn_file' };
    await saveDb();
    await answerCallback(q.id, 'VPN kodlary bolan faýly şu chat-a faýl hökmünde uçuryň.');
    return;
  }

  if (data === 'add_admin') {
    DB.state[chatId] = { action: 'awaiting_new_admin' };
    await saveDb();
    await answerCallback(q.id, 'Täze adminiň telegram ID-sini ýazyň (san görnüşinde).');
    return;
  }

  await answerCallback(q.id);
}

async function handlePendingAdminAction(chatId: number, fromId: number, pending: any, msg: any) {
  const action = pending.action;
  const text = msg.text || '';

  if (action === 'awaiting_channel_add') {
    if (text) {
      const ch = text.trim();
      if (!DB.channels.includes(ch)) DB.channels.push(ch);
      await saveDb();
      DB.state[chatId] = null;
      await sendMessage(chatId, TXT.added_channel(ch));
    }
    return;
  }
  if (action === 'awaiting_channel_remove') {
    if (text) {
      const ch = text.trim();
      DB.channels = DB.channels.filter((c:string)=>c!==ch);
      await saveDb();
      DB.state[chatId] = null;
      await sendMessage(chatId, TXT.removed_channel(ch));
    }
    return;
  }
  if (action === 'awaiting_broadcast_text') {
    const payload = text;
    // naive: broadcast to channels in adlist or to known users - here we forward to adlist channels
    const channels = await safeReadFile(ADLIST_FILE).then(s=>s.split(/\r?\n/).filter(Boolean)).catch(()=>[]);
    for (const ch of channels) {
      try { await sendMessage(ch, payload); } catch(_e) {}
    }
    DB.state[chatId] = null; await saveDb();
    await sendMessage(chatId, TXT.broadcast_sent);
    return;
  }
  if (action === 'awaiting_broadcast_forward') {
    // admin must forward a message into this chat. We'll detect forwarded message content and resend to adlist
    if (msg.forward_from_chat || msg.forward_from) {
      // attempt to forward the message to channels from adlist
      const channels = (await safeReadFile(ADLIST_FILE)).split(/\r?\n/).filter(Boolean);
      for (const ch of channels) {
        try {
          await forwardMessage(ch, chatId, msg.message_id);
        } catch(_e) {}
      }
      DB.state[chatId] = null; await saveDb();
      await sendMessage(chatId, TXT.broadcast_sent);
    } else {
      await sendMessage(chatId, 'Iltimos forward görnüşinde habar ugradyň.');
    }
    return;
  }
  if (action === 'awaiting_adlist_file') {
    // handled in message when document is present
    // keep waiting
    return;
  }
  if (action === 'awaiting_vpn_file') {
    // handled in message when document is present
    return;
  }
  if (action === 'awaiting_new_admin') {
    if (text && /^[0-9]+$/.test(text.trim())) {
      const id = Number(text.trim());
      if (!DB.admins.includes(id)) DB.admins.push(id);
      await saveDb();
      DB.state[chatId] = null;
      await sendMessage(chatId, TXT.added_admin(id));
    } else {
      await sendMessage(chatId, 'Iltimos diňe san görnüşinde telegram ID-ni ýazyň.');
    }
    return;
  }
}

// helper: forward message
async function forwardMessage(toChat: string | number, fromChat: number | string, messageId: number) {
  const body = { chat_id: toChat, from_chat_id: fromChat, message_id: messageId };
  return fetch(`${API}/forwardMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

// helper: getFilePath & download content
async function getFilePath(file_id: string) {
  const res = await fetch(`${API}/getFile?file_id=${file_id}`);
  const j = await res.json();
  if (!j.ok) return null;
  return j.result.file_path;
}
async function downloadFileContent(filePath: string) {
  const url = `https://api.telegram.org/file/bot${TOKEN}/${filePath}`;
  const r = await fetch(url);
  if (!r.ok) return null;
  return await r.text();
}

async function safeReadFile(path: string) {
  try { return await Deno.readTextFile(path); } catch (_e) { return ''; }
}

async function getAllKnownUsers(): Promise<number[]> {
  // placeholder: you need to persist users when they /start; for now return ADLIST channels as "users"
  return [];
}

console.log("Bot is running. Webhook path:", SECRET_PATH);



