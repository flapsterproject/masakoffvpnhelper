// Sponsor (Salam VPN) Telegram Bot — single-file Deno webhook (style aligned with sample)
// - Set env BOT_TOKEN (required) and optionally ADMIN_ID (initial admin, numeric).
// - Webhook path: SECRET_PATH (default "/masakoff") — set your Telegram webhook to https://<domain><SECRET_PATH>

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const TOKEN = Deno.env.get("BOT_TOKEN");
if (!TOKEN) throw new Error("BOT_TOKEN env var is required");
const SECRET_PATH = "/masakoffvpnhelper";
const TELEGRAM_API = `https://api.telegram.org/bot${TOKEN}`;

// --- Persistent files ---
const DB_FILE = "db.json";           // { admins: number[], channels: string[], state: Record<chatId, {action:string}> }
const ADLIST_FILE = "adlist.txt";    // newline channels or chat ids for broadcasts
const VPN_CODES_FILE = "vpn_codes.txt";

// --- In-memory DB (loaded from DB_FILE) ---
let DB: { admins: number[]; channels: string[]; state: Record<string, any> } = { admins: [], channels: [], state: {} };

// --- Load / Save helpers ---
async function loadDb() {
  try {
    const raw = await Deno.readTextFile(DB_FILE);
    DB = JSON.parse(raw);
    DB.admins = DB.admins || [];
    DB.channels = DB.channels || [];
    DB.state = DB.state || {};
  } catch {
    // bootstrap possible initial admin
    const initialAdmin = Deno.env.get("ADMIN_ID");
    DB = { admins: initialAdmin ? [Number(initialAdmin)] : [], channels: [], state: {} };
    await saveDb();
  }
}
async function saveDb() {
  await Deno.writeTextFile(DB_FILE, JSON.stringify(DB, null, 2));
}
async function safeReadFile(path: string) {
  try { return await Deno.readTextFile(path); } catch { return ""; }
}
async function safeWriteFile(path: string, content: string) {
  await Deno.writeTextFile(path, content);
}

// --- Small util ---
function isAdmin(uid?: number) { if (!uid) return false; return DB.admins.includes(uid); }
function mkInline(rows: any[][]) { return { reply_markup: { inline_keyboard: rows } }; }
function turk(text: string) { return text; } // placeholder if later localization enhancement

// --- Turkmen text constants ---
const TXT = {
  start_no_channels: "Salam! Häzir zerur kanallar görkezilmändir. Administrator bilen habarlaşyň.",
  start_needed: (channels: string[]) => `Salam! VPN kody almak üçin aşakdaky kanallara agza bolmaly:\n${channels.length ? channels.map((c,i)=>`${i+1}. ${c}`).join("\n") : "(Hiç biri)"}\n\nKanallaryň ählisine agza bolan soň \"✅ Men ähli kanallara agza boldum\" düwmesine basyň.`,
  not_admin: "Siz admin däl.",
  admin_panel_title: "<< Admin Panel >>",
  choose_action: "Aşakdaky düwmelerden birini saýlaň:",
  added_channel: (c:string) => `Kanaly goşdum: ${c}`,
  removed_channel: (c:string) => `Kanaly aýyrdym: ${c}`,
  list_channels: (channels:string[]) => `Zerur kanallar:\n${channels.length ? channels.map((c,i)=>`${i+1}. ${c}`).join("\n") : "(Hiç biri)"}`,
  got_vpn_code: "VPN kody üstünlikli goşuldy.",
  uploaded_codes_file: "VPN kodlary faýldan üstünlikli goşuldy.",
  added_admin: (id:number) => `Täze admin goşuldy: ${id}`,
  prompt_forward_for_broadcast: "Ugratmak isleýän habaryňyzy şu chat-a forward ediň.",
  broadcast_sent: "Ugratma üstünlikli edildi.",
  ask_channel_name: "Kanal adyny ýa-da ID-ni ýazyň (meselem: @channel ýa-da -10012345).",
  ask_remove_channel: "Aýyrjak kanalyň adyny ýa-da ID-ni ýazyň.",
  ask_admin_id: "Täze adminiň telegram ID-sini (san) ýazyň.",
  ask_adlist_file: "Adlist faýlyny şu chat-a faýl hökmünde ugradyň.",
  ask_vpn_file: "VPN kodlary bolan faýly şu chat-a faýl hökmünde ugradyň.",
  i_joined_ack: "Sag boluň! Agza bolup, kody almak üçin gözleýärin...",
  no_vpn_codes: "Hozir VPN kodlary ýok. Administrator bilen habarlaşyň.",
  vpn_code_sent: (code:string) => `Siziň VPN koduňyz:\n<code>${code}</code>\nUlanmaga taýýar!`,
  unknown_action: "Näbelli operasiýa. Admin panelinden işe başlamagyňyzy haýyş edýäris.",
  file_not_found: "Faýl tapylmady ýa-da okalyp bilmedi.",
};

// --- Inline keyboards for admin panel ---
function adminKeyboard() {
  return mkInline([
    [{ text: "📣 Ryssylka (Forward)", callback_data: "forward_broadcast" }, { text: "✉️ Ryssylka (Text)", callback_data: "text_broadcast" }],
    [{ text: "➕ Kanal goş", callback_data: "add_channel" }, { text: "➖ Kanal aýyr", callback_data: "remove_channel" }],
    [{ text: "📜 Kanal sanawy", callback_data: "list_channels" }],
    [{ text: "🗂️ Adlist (faýl)", callback_data: "manage_adlist" }, { text: "🔐 VPN kodlaryny faýl bilen goş", callback_data: "add_vpn_file" }],
    [{ text: "➕ Admin goş", callback_data: "add_admin" }]
  ]);
}

// --- Telegram API helpers ---
async function sendMessage(chat_id:number|string, text:string, extra: any = {}) {
  const body = { chat_id, text, parse_mode: "HTML", ...extra };
  await fetch(`${TELEGRAM_API}/sendMessage`, { method: "POST", headers: {"content-type":"application/json"}, body: JSON.stringify(body) });
}
async function editMessageText(chat_id:number|string, message_id:number, text:string, extra: any = {}) {
  const body = { chat_id, message_id, text, parse_mode: "HTML", ...extra };
  await fetch(`${TELEGRAM_API}/editMessageText`, { method: "POST", headers: {"content-type":"application/json"}, body: JSON.stringify(body) });
}
async function answerCallbackQuery(callback_query_id:string, text?:string) {
  const body: any = { callback_query_id };
  if (text) body.text = text;
  await fetch(`${TELEGRAM_API}/answerCallbackQuery`, { method: "POST", headers: {"content-type":"application/json"}, body: JSON.stringify(body) });
}
async function forwardMessage(toChat:number|string, fromChat:number|string, messageId:number) {
  const body = { chat_id: toChat, from_chat_id: fromChat, message_id: messageId };
  await fetch(`${TELEGRAM_API}/forwardMessage`, { method: "POST", headers: {"content-type":"application/json"}, body: JSON.stringify(body) });
}
async function getFilePath(file_id:string) {
  const res = await (await fetch(`${TELEGRAM_API}/getFile?file_id=${file_id}`)).json();
  if (!res || !res.ok) return null;
  return res.result.file_path as string;
}
async function downloadFileContent(filePath:string) {
  const url = `https://api.telegram.org/file/bot${TOKEN}/${filePath}`;
  const r = await fetch(url);
  if (!r.ok) return null;
  return await r.text();
}

// --- VPN code management (pop first code and remove it) ---
async function popVpnCode(): Promise<string|null> {
  const raw = await safeReadFile(VPN_CODES_FILE);
  const lines = raw.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  if (lines.length === 0) return null;
  const code = lines.shift()!;
  await safeWriteFile(VPN_CODES_FILE, lines.join("\n"));
  return code;
}
async function appendVpnCodesFromText(text:string) {
  const existing = await safeReadFile(VPN_CODES_FILE);
  const merged = existing + (existing && !existing.endsWith("\n") ? "\n" : "") + text.trim() + "\n";
  await safeWriteFile(VPN_CODES_FILE, merged);
}

// --- Adlist helpers ---
async function getAdlistChannels(): Promise<string[]> {
  const raw = await safeReadFile(ADLIST_FILE);
  return raw.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
}
async function setAdlistChannelsFromText(text:string) {
  await safeWriteFile(ADLIST_FILE, text.trim() + "\n");
}

// --- Startup: load DB ---
await loadDb();

// --- Webhook server ---
serve(async (req: Request) => {
  const url = new URL(req.url);
  if (url.pathname !== SECRET_PATH) return new Response("ok");
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  let update: any;
  try { update = await req.json(); } catch { return new Response("ok"); }

  // message or callback_query
  const msg = update.message;
  const cbq = update.callback_query;

  // Handle callback queries (admin inline)
  if (cbq) {
    const fromId = cbq.from?.id;
    const chatId = cbq.message?.chat?.id;
    const messageId = cbq.message?.message_id;
    const data = cbq.data;

    if (!isAdmin(fromId)) {
      await answerCallbackQuery(cbq.id, TXT.not_admin);
      return new Response("ok");
    }

    // admin actions
    if (data === "list_channels") {
      await editMessageText(chatId, messageId, `${TXT.admin_panel_title}\n\n${TXT.list_channels(DB.channels)}`, adminKeyboard());
      await answerCallbackQuery(cbq.id);
      return new Response("ok");
    }
    if (data === "add_channel") {
      DB.state[String(chatId)] = { action: "awaiting_channel_add" };
      await saveDb();
      await answerCallbackQuery(cbq.id, TXT.ask_channel_name);
      return new Response("ok");
    }
    if (data === "remove_channel") {
      DB.state[String(chatId)] = { action: "awaiting_channel_remove" };
      await saveDb();
      await answerCallbackQuery(cbq.id, TXT.ask_remove_channel);
      return new Response("ok");
    }
    if (data === "text_broadcast") {
      DB.state[String(chatId)] = { action: "awaiting_broadcast_text" };
      await saveDb();
      await answerCallbackQuery(cbq.id, "Indi ugradyljak tekstini şu chat-a ýazyň.");
      return new Response("ok");
    }
    if (data === "forward_broadcast") {
      DB.state[String(chatId)] = { action: "awaiting_broadcast_forward" };
      await saveDb();
      await answerCallbackQuery(cbq.id, TXT.prompt_forward_for_broadcast);
      return new Response("ok");
    }
    if (data === "manage_adlist") {
      DB.state[String(chatId)] = { action: "awaiting_adlist_file" };
      await saveDb();
      await answerCallbackQuery(cbq.id, TXT.ask_adlist_file);
      return new Response("ok");
    }
    if (data === "add_vpn_file") {
      DB.state[String(chatId)] = { action: "awaiting_vpn_file" };
      await saveDb();
      await answerCallbackQuery(cbq.id, TXT.ask_vpn_file);
      return new Response("ok");
    }
    if (data === "add_admin") {
      DB.state[String(chatId)] = { action: "awaiting_new_admin" };
      await saveDb();
      await answerCallbackQuery(cbq.id, TXT.ask_admin_id);
      return new Response("ok");
    }

    await answerCallbackQuery(cbq.id);
    return new Response("ok");
  }

  // Handle normal messages
  if (!msg) return new Response("ok");
  const chatId = msg.chat?.id;
  const messageId = msg.message_id;
  const fromId = msg.from?.id;
  const text = (msg.text || msg.caption || "").trim();
  const doc = msg.document;

  if (!chatId) return new Response("ok");

  const state = DB.state[String(chatId)] || null;

  // /start command
  if (text.toLowerCase().startsWith("/start")) {
    if (DB.channels.length === 0) {
      await sendMessage(chatId, TXT.start_no_channels);
      return new Response("ok");
    }
    // build keyboard: links to channels + confirm button
    const kbRows = DB.channels.map(c => [{ text: c, url: `https://t.me/${c.replace(/^@/, "")}` }]);
    kbRows.push([{ text: "✅ Men ähli kanallara agza boldum", callback_data: "i_joined" }]);
    await sendMessage(chatId, TXT.start_needed(DB.channels), mkInline(kbRows));
    return new Response("ok");
  }

  // handle join-confirm callback (user pressed i_joined)
  if (update.callback_query && update.callback_query.data === "i_joined") {
    // this code path will be handled earlier in callback_query block, but keep safe here
  }

  // Admin command: /admin
  if (text.toLowerCase().startsWith("/admin")) {
    if (!isAdmin(fromId)) {
      await sendMessage(chatId, TXT.not_admin, { reply_to_message_id: messageId });
      return new Response("ok");
    }
    await sendMessage(chatId, `${TXT.admin_panel_title}\n\n${TXT.choose_action}`, adminKeyboard());
    return new Response("ok");
  }

  // If there's a pending admin state for this chat and the sender is admin -> handle it
  if (state && isAdmin(fromId)) {
    const action = state.action;
    // awaiting channel add
    if (action === "awaiting_channel_add") {
      if (text) {
        const ch = text.split(/\s+/)[0].trim();
        if (!DB.channels.includes(ch)) DB.channels.push(ch);
        await saveDb();
        DB.state[String(chatId)] = null;
        await saveDb();
        await sendMessage(chatId, TXT.added_channel(ch));
      } else {
        await sendMessage(chatId, TXT.unknown_action);
      }
      return new Response("ok");
    }
    // awaiting channel remove
    if (action === "awaiting_channel_remove") {
      if (text) {
        const ch = text.split(/\s+/)[0].trim();
        DB.channels = DB.channels.filter(c => c !== ch);
        await saveDb();
        DB.state[String(chatId)] = null;
        await saveDb();
        await sendMessage(chatId, TXT.removed_channel(ch));
      } else {
        await sendMessage(chatId, TXT.unknown_action);
      }
      return new Response("ok");
    }
    // awaiting broadcast text
    if (action === "awaiting_broadcast_text") {
      if (!text) { await sendMessage(chatId, "Iltimos tekst ugradyn."); return new Response("ok"); }
      const targets = await getAdlistChannels();
      for (const t of targets) {
        try { await sendMessage(t, text); } catch (_) { /* ignore per-target errors */ }
      }
      DB.state[String(chatId)] = null; await saveDb();
      await sendMessage(chatId, TXT.broadcast_sent);
      return new Response("ok");
    }
    // awaiting broadcast forward (admin must forward an existing message into this chat)
    if (action === "awaiting_broadcast_forward") {
      // check forwarded message presence
      if (msg.forward_from || msg.forward_from_chat) {
        const targets = await getAdlistChannels();
        for (const t of targets) {
          try { await forwardMessage(t, chatId, messageId); } catch (_) {}
        }
        DB.state[String(chatId)] = null; await saveDb();
        await sendMessage(chatId, TXT.broadcast_sent);
      } else {
        await sendMessage(chatId, "Iltimos, habaryny forward edip bu chat-a ugradyn.");
      }
      return new Response("ok");
    }
    // awaiting adlist file (admin should upload document)
    if (action === "awaiting_adlist_file") {
      if (doc) {
        const filePath = await getFilePath(doc.file_id);
        if (!filePath) { await sendMessage(chatId, TXT.file_not_found); return new Response("ok"); }
        const content = await downloadFileContent(filePath);
        if (!content) { await sendMessage(chatId, TXT.file_not_found); return new Response("ok"); }
        await setAdlistChannelsFromText(content);
        DB.state[String(chatId)] = null; await saveDb();
        await sendMessage(chatId, "Adlist üstünlikli ýüklendi.");
      } else {
        await sendMessage(chatId, "Adlist faýlyny faýl görnüşinde ugradyn (document).");
      }
      return new Response("ok");
    }
    // awaiting vpn file
    if (action === "awaiting_vpn_file") {
      if (doc) {
        const filePath = await getFilePath(doc.file_id);
        if (!filePath) { await sendMessage(chatId, TXT.file_not_found); return new Response("ok"); }
        const content = await downloadFileContent(filePath);
        if (!content) { await sendMessage(chatId, TXT.file_not_found); return new Response("ok"); }
        await appendVpnCodesFromText(content);
        DB.state[String(chatId)] = null; await saveDb();
        await sendMessage(chatId, TXT.uploaded_codes_file);
      } else {
        await sendMessage(chatId, "VPN kodlarynyň faýlyny faýl hökmünde ugradyn (document).");
      }
      return new Response("ok");
    }
    // awaiting new admin
    if (action === "awaiting_new_admin") {
      if (text && /^[0-9]+$/.test(text)) {
        const id = Number(text);
        if (!DB.admins.includes(id)) DB.admins.push(id);
        await saveDb();
        DB.state[String(chatId)] = null; await saveDb();
        await sendMessage(chatId, TXT.added_admin(id));
      } else {
        await sendMessage(chatId, "Iltimos diňe san görnüşinde telegram ID-ni ýazyň.");
      }
      return new Response("ok");
    }
  }

  // Admin quick commands available as text
  if (isAdmin(fromId)) {
    if (text.toLowerCase().startsWith("/addchannel")) {
      const parts = text.split(/\s+/);
      const ch = parts[1];
      if (ch) {
        if (!DB.channels.includes(ch)) DB.channels.push(ch);
        await saveDb();
        await sendMessage(chatId, TXT.added_channel(ch));
      } else {
        await sendMessage(chatId, "Ulanyp: /addchannel @channel_name");
      }
      return new Response("ok");
    }
    if (text.toLowerCase().startsWith("/removechannel")) {
      const parts = text.split(/\s+/);
      const ch = parts[1];
      if (ch) {
        DB.channels = DB.channels.filter(c => c !== ch);
        await saveDb();
        await sendMessage(chatId, TXT.removed_channel(ch));
      } else {
        await sendMessage(chatId, "Ulanyp: /removechannel @channel_name");
      }
      return new Response("ok");
    }
    if (text.toLowerCase().startsWith("/addvpn")) {
      const code = text.replace(/\/addvpn\s*/i, "").trim();
      if (code) {
        await appendVpnCodesFromText(code + "\n");
        await sendMessage(chatId, TXT.got_vpn_code);
      } else {
        await sendMessage(chatId, "Ulanyp: /addvpn KOD123");
      }
      return new Response("ok");
    }
  }

  // If user pressed inline "I joined" (callback) -> Telegram will send callback_query (handled above).
  // But we still handle when user sends a plain "✅ Men..." message: provide first VPN code
  if (text === "✅ Men ähli kanallara agza boldum" || text.toLowerCase().includes("men ähli kanallara agza boldum")) {
    const code = await popVpnCode();
    if (!code) {
      await sendMessage(chatId, TXT.no_vpn_codes, { reply_to_message_id: messageId });
      return new Response("ok");
    }
    await sendMessage(chatId, TXT.vpn_code_sent(code), { reply_to_message_id: messageId });
    return new Response("ok");
  }

  // Safety: if user clicked inline button i_joined, Telegram will send callback; but if not, they may DM that text.
  // Default small help responses (Turkmen)
  if (text.toLowerCase() === "/help") {
    await sendMessage(chatId, "Salam! /start bilen başlamagyňyzy haýyş edýärin.\nAdminler üçin /admin.");
    return new Response("ok");
  }

  // If message is a callback forward from admin to bot's chat (admin forwarded message to main admin chat), we may need to detect forwarded and broadcast if state awaiting_broadcast_forward exists for that chat.
  // But forwarding handling for broadcast is implemented above in the pending admin section (it checks msg.forward_from/msg.forward_from_chat).

  return new Response("ok");
});

console.log("Bot running. Webhook path:", SECRET_PATH);




