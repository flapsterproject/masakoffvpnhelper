// sponsor_bot_masakoff.ts
// Deno single-file Telegram webhook bot — Turkmen (Salam VPN sponsor bot)
// ENV required: BOT_TOKEN
// Optional ENV: ADMIN_ID (başlangyç admin Telegram numeric ID)
// Webhook path default: /masakoff

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const TOKEN = Deno.env.get("BOT_TOKEN");
if (!TOKEN) throw new Error("BOT_TOKEN çevre üýtgeji gerekli");
const SECRET_PATH = "/masakoffvpnhelper";
const TELEGRAM_API = `https://api.telegram.org/bot${TOKEN}`;

// --- file storage ---
const DB_FILE = "db.json";        // { admins: number[], channels: string[], state: Record<chatId, {action, payload}> }
const ADLIST_FILE = "adlist.txt"; // newline: channel username or chat_id
const VPN_FILE = "vpn_codes.txt"; // newline: one code per line

// --- in-memory DB ---
let DB: { admins: number[]; channels: string[]; state: Record<string, any> } = { admins: [], channels: [], state: {} };

// --- helpers for fs ---
async function safeRead(path: string) {
  try { return await Deno.readTextFile(path); } catch { return ""; }
}
async function safeWrite(path: string, content: string) {
  await Deno.writeTextFile(path, content);
}
async function loadDb() {
  try {
    const raw = await Deno.readTextFile(DB_FILE);
    DB = JSON.parse(raw);
    DB.admins = DB.admins || [];
    DB.channels = DB.channels || [];
    DB.state = DB.state || {};
  } catch {
    const initial = Deno.env.get("ADMIN_ID");
    DB = { admins: initial ? [Number(initial)] : [], channels: [], state: {} };
    await saveDb();
  }
}
async function saveDb() { await Deno.writeTextFile(DB_FILE, JSON.stringify(DB, null, 2)); }

// --- small utils ---
function mkInline(rows: any[][]) { return { reply_markup: { inline_keyboard: rows } }; }
function isAdmin(uid?: number) { if (!uid) return false; return DB.admins.includes(uid); }

// --- Turkmen texts ---
const TXT = {
  start_no_channels: "Salam! Häzir zerur kanallar görkezilmändir. Administrator bilen habarlaşyň.",
  start_needed: (chs: string[]) => `Salam! VPN kody almak üçin aşakdaky kanallara agza bolmaly:\n${chs.length ? chs.map((c,i)=>`${i+1}. ${c}`).join("\n") : "(Hiç biri)"}\n\nAgza bolan soň \"✅ Men ähli kanallara agza boldum\" düwmesine basyň.`,
  not_admin: "Siz admin däl. Admin paneline girmek üçin admin ID-ni /admin ýazyp soňra ID-ni giriziň.",
  admin_panel_title: "<< Admin Panel >>",
  choose_action: "Aşakdaky düwmelerden birini saýlaň:",
  added_channel: (c:string) => `Kanaly goşdum: ${c}`,
  removed_channel: (c:string) => `Kanaly aýyrdym: ${c}`,
  list_channels: (chs:string[]) => `Zerur kanallar:\n${chs.length ? chs.map((c,i)=>`${i+1}. ${c}`).join("\n") : "(Hiç biri)"}`,
  got_vpn_code: "VPN kody üstünlikli goşuldy.",
  uploaded_codes_file: "VPN kodlary faýldan üstünlikli goşuldy.",
  added_admin: (id:number) => `Täze admin goşuldy: ${id}`,
  prompt_forward_for_broadcast: "Ugratmak isleýän habaryňyzy şu chat-a forward ediň.",
  broadcast_sent: "Ugratma üstünlikli edildi.",
  ask_channel_name: "Kanal adyny ýa-da ID-ni ýazyň (meselem: @channel ýa-da -10012345).",
  ask_remove_channel: "Aýyrjak kanalyňyzy ýazyň.",
  ask_admin_id: "Admin ID-ni ýazyň (san).",
  ask_adlist_file: "Adlist faýlyny şu chat-a document görnüşinde ugradyn.",
  ask_vpn_file: "VPN kodlarynyň faýlyny şu chat-a document görnüşinde ugradyn ýa-da /addvpn KOD görnüşinde goşuň.",
  i_joined_ack: "Sag boluň! Agza bolup, kody almak üçin işleşýärin...",
  no_vpn_codes: "Hozir VPN kodlary ýok. Administrator bilen habarlaşyň.",
  vpn_code_sent: (code:string) => `Siziň VPN koduňyz:\n<code>${code}</code>\nUlanmaga taýýar!`,
  file_not_found: "Faýl tapylmady ýa-da okalyp bilmedi.",
  unknown_action: "Näbelli operasiýa. Admin panelinden iş başlaň.",
};

// --- admin inline keyboard ---
function adminKeyboard() {
  return mkInline([
    [{ text: "📣 Ryssylka (Forward)", callback_data: "forward_broadcast" }, { text: "✉️ Ryssylka (Text)", callback_data: "text_broadcast" }],
    [{ text: "➕ Kanal goş", callback_data: "add_channel" }, { text: "➖ Kanal aýyr", callback_data: "remove_channel" }],
    [{ text: "📜 Kanal sanawy", callback_data: "list_channels" }],
    [{ text: "🗂 Adlist (faýl)", callback_data: "manage_adlist" }, { text: "🔐 VPN kodlaryny faýl bilen goş", callback_data: "add_vpn_file" }],
    [{ text: "➕ Admin goş", callback_data: "add_admin" }]
  ]);
}

// --- Telegram helpers ---
async function api(method: string, body: any) {
  await fetch(`${TELEGRAM_API}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}
async function sendMessage(chat_id:number|string, text:string, extra: any = {}) { await api("sendMessage", { chat_id, text, parse_mode: "HTML", ...extra }); }
async function editMessageText(chat_id:number|string, message_id:number, text:string, extra: any = {}) { await api("editMessageText", { chat_id, message_id, text, parse_mode: "HTML", ...extra }); }
async function answerCallbackQuery(callback_query_id:string, text?:string) { const body:any = { callback_query_id }; if (text) body.text = text; await api("answerCallbackQuery", body); }
async function forwardMessage(toChat:number|string, fromChat:number|string, messageId:number) { await api("forwardMessage", { chat_id: toChat, from_chat_id: fromChat, message_id: messageId }); }
async function getFilePath(file_id:string) { try { const r = await (await fetch(`${TELEGRAM_API}/getFile?file_id=${file_id}`)).json(); if (!r.ok) return null; return r.result.file_path as string; } catch { return null; } }
async function downloadFile(filePath:string) { try { const url = `https://api.telegram.org/file/bot${TOKEN}/${filePath}`; const r = await fetch(url); if (!r.ok) return null; return await r.text(); } catch { return null; } }

// --- VPN code helpers ---
async function popVpnCode(): Promise<string|null> {
  const raw = await safeRead(VPN_FILE);
  const lines = raw.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  if (!lines.length) return null;
  const code = lines.shift()!;
  await safeWrite(VPN_FILE, lines.join("\n"));
  return code;
}
async function appendVpnText(text:string) {
  const cur = await safeRead(VPN_FILE);
  const merged = (cur && !cur.endsWith("\n") ? cur + "\n" : cur) + text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean).join("\n") + "\n";
  await safeWrite(VPN_FILE, merged);
}

// --- Adlist helpers ---
async function getAdlist() { const raw = await safeRead(ADLIST_FILE); return raw.split(/\r?\n/).map(s=>s.trim()).filter(Boolean); }
async function setAdlistFromText(text:string) { await safeWrite(ADLIST_FILE, text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean).join("\n") + "\n"); }

// --- start up load DB ---
await loadDb();

// --- webhook server ---
serve(async (req: Request) => {
  const url = new URL(req.url);
  if (url.pathname !== SECRET_PATH) return new Response("ok");
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  let update: any;
  try { update = await req.json(); } catch { return new Response("ok"); }

  const msg = update.message;
  const cbq = update.callback_query;

  // --- callback query handling (admin inline) ---
  if (cbq) {
    const fromId = cbq.from?.id;
    const chatId = cbq.message?.chat?.id;
    const messageId = cbq.message?.message_id;
    const data = cbq.data;

    // only admins can use admin inline buttons — but allow admin login flow via /admin (text)
    if (!isAdmin(fromId)) {
      await answerCallbackQuery(cbq.id, TXT.not_admin);
      return new Response("ok");
    }

    if (data === "list_channels") {
      await editMessageText(chatId, messageId, `${TXT.admin_panel_title}\n\n${TXT.list_channels(DB.channels)}`, adminKeyboard());
      await answerCallbackQuery(cbq.id);
      return new Response("ok");
    }
    if (data === "add_channel") {
      DB.state[String(chatId)] = { action: "awaiting_channel_add" }; await saveDb();
      await answerCallbackQuery(cbq.id, TXT.ask_channel_name);
      return new Response("ok");
    }
    if (data === "remove_channel") {
      DB.state[String(chatId)] = { action: "awaiting_channel_remove" }; await saveDb();
      await answerCallbackQuery(cbq.id, TXT.ask_remove_channel);
      return new Response("ok");
    }
    if (data === "text_broadcast") {
      DB.state[String(chatId)] = { action: "awaiting_broadcast_text" }; await saveDb();
      await answerCallbackQuery(cbq.id, "Indi ugradyljak tekstini şu chat-a ýazyň. (Eger belli ID-lere ugratmak isleseňiz, ID-leri vergül bilen ayyryp ýazyň: -100123,... )");
      return new Response("ok");
    }
    if (data === "forward_broadcast") {
      DB.state[String(chatId)] = { action: "awaiting_broadcast_forward" }; await saveDb();
      await answerCallbackQuery(cbq.id, TXT.prompt_forward_for_broadcast);
      return new Response("ok");
    }
    if (data === "manage_adlist") {
      DB.state[String(chatId)] = { action: "awaiting_adlist_file" }; await saveDb();
      await answerCallbackQuery(cbq.id, TXT.ask_adlist_file);
      return new Response("ok");
    }
    if (data === "add_vpn_file") {
      DB.state[String(chatId)] = { action: "awaiting_vpn_file" }; await saveDb();
      await answerCallbackQuery(cbq.id, TXT.ask_vpn_file);
      return new Response("ok");
    }
    if (data === "add_admin") {
      DB.state[String(chatId)] = { action: "awaiting_new_admin" }; await saveDb();
      await answerCallbackQuery(cbq.id, TXT.ask_admin_id);
      return new Response("ok");
    }

    await answerCallbackQuery(cbq.id);
    return new Response("ok");
  }

  // --- message handling ---
  if (!msg) return new Response("ok");
  const chatId = msg.chat?.id;
  const messageId = msg.message_id;
  const fromId = msg.from?.id;
  const text = (msg.text || msg.caption || "").trim();
  const doc = msg.document;

  if (!chatId) return new Response("ok");

  // /start
  if (text.toLowerCase().startsWith("/start")) {
    if (!DB.channels.length) {
      await sendMessage(chatId, TXT.start_no_channels);
      return new Response("ok");
    }
    const rows = DB.channels.map(c => [{ text: c, url: `https://t.me/${c.replace(/^@/, "")}` }]);
    rows.push([{ text: "✅ Men ähli kanallara agza boldum", callback_data: "i_joined" }]);
    await sendMessage(chatId, TXT.start_needed(DB.channels), mkInline(rows));
    return new Response("ok");
  }

  // /admin flow: if sender already admin -> show panel; if not, set awaiting_admin_login state and ask for ID
  if (text.toLowerCase().startsWith("/admin")) {
    if (isAdmin(fromId)) {
      await sendMessage(chatId, `${TXT.admin_panel_title}\n\n${TXT.choose_action}`, adminKeyboard());
      return new Response("ok");
    } else {
      DB.state[String(chatId)] = { action: "awaiting_admin_login" }; await saveDb();
      await sendMessage(chatId, "Admin ID-ni ýazyň (san)."); // prompt for numeric admin id
      return new Response("ok");
    }
  }

  // --- handle pending states (only admin-related states or login) ---
  const state = DB.state[String(chatId)] || null;

  if (state) {
    const action = state.action;

    // admin login attempt (user provided admin ID)
    if (action === "awaiting_admin_login") {
      if (text && /^[0-9]+$/.test(text)) {
        const id = Number(text);
        if (DB.admins.includes(id)) {
          // mark this chat's user as admin? we must check sender id equals provided id OR we allow if they proved knowledge
          // safer: require that text equals their own Telegram id. But user requested "admin id ile girsin" — allow matching any existing admin id
          DB.state[String(chatId)] = null; await saveDb();
          // if provided id equals their own id, add them to admins (they are owner) - optional: here we allow only if they are the same user
          if (fromId === id && !DB.admins.includes(id)) { DB.admins.push(id); await saveDb(); }
          // show admin panel
          await sendMessage(chatId, `${TXT.admin_panel_title}\n\n${TXT.choose_action}`, adminKeyboard());
        } else {
          await sendMessage(chatId, "Nädogry admin ID ýa-da admin ýok. Administrator bilen habarlaşyň.");
        }
      } else {
        await sendMessage(chatId, "Iltimos san görnüşinde ID yazyn.");
      }
      return new Response("ok");
    }

    // awaiting_channel_add
    if (action === "awaiting_channel_add" && isAdmin(fromId)) {
      if (text) {
        const ch = text.split(/\s+/)[0].trim();
        if (!DB.channels.includes(ch)) DB.channels.push(ch);
        await saveDb();
        DB.state[String(chatId)] = null; await saveDb();
        await sendMessage(chatId, TXT.added_channel(ch));
      } else {
        await sendMessage(chatId, TXT.unknown_action);
      }
      return new Response("ok");
    }

    // awaiting_channel_remove
    if (action === "awaiting_channel_remove" && isAdmin(fromId)) {
      if (text) {
        const ch = text.split(/\s+/)[0].trim();
        DB.channels = DB.channels.filter(c => c !== ch);
        await saveDb();
        DB.state[String(chatId)] = null; await saveDb();
        await sendMessage(chatId, TXT.removed_channel(ch));
      } else {
        await sendMessage(chatId, TXT.unknown_action);
      }
      return new Response("ok");
    }

    // awaiting_broadcast_text
    if (action === "awaiting_broadcast_text" && isAdmin(fromId)) {
      if (!text) { await sendMessage(chatId, "Iltimos tekst ugradyn."); return new Response("ok"); }
      // if admin provides comma-separated IDs at start like: "-100123,-100456|message" or provide only IDs line, we support two modes:
      // Mode A: if text contains '|' we split ids|message -> ids comma separated
      let targets: string[] = [];
      let payload = text;
      if (text.includes("|")) {
        const [idsPart, ...rest] = text.split("|");
        const ids = idsPart.split(",").map(s=>s.trim()).filter(Boolean);
        targets = ids;
        payload = rest.join("|").trim();
      } else {
        // otherwise use adlist
        targets = await getAdlist();
      }
      for (const t of targets) {
        try { await sendMessage(t, payload); } catch (_) {}
      }
      DB.state[String(chatId)] = null; await saveDb();
      await sendMessage(chatId, TXT.broadcast_sent);
      return new Response("ok");
    }

    // awaiting_broadcast_forward
    if (action === "awaiting_broadcast_forward" && isAdmin(fromId)) {
      if (msg.forward_from || msg.forward_from_chat) {
        const targets = await getAdlist();
        for (const t of targets) {
          try { await forwardMessage(t, chatId, messageId); } catch (_) {}
        }
        DB.state[String(chatId)] = null; await saveDb();
        await sendMessage(chatId, TXT.broadcast_sent);
      } else {
        await sendMessage(chatId, "Iltimos forward görnüşinde habar ugradyn.");
      }
      return new Response("ok");
    }

    // awaiting_adlist_file
    if (action === "awaiting_adlist_file" && isAdmin(fromId)) {
      if (doc) {
        const path = await getFilePath(doc.file_id);
        if (!path) { await sendMessage(chatId, TXT.file_not_found); return new Response("ok"); }
        const content = await downloadFile(path);
        if (!content) { await sendMessage(chatId, TXT.file_not_found); return new Response("ok"); }
        await setAdlistFromText(content);
        DB.state[String(chatId)] = null; await saveDb();
        await sendMessage(chatId, "Adlist faýly üstünlikli ýüklendi.");
      } else if (text) {
        // allow admins to send adlist as plain text
        await setAdlistFromText(text);
        DB.state[String(chatId)] = null; await saveDb();
        await sendMessage(chatId, "Adlist tekst görnüşinde goýuldy.");
      } else {
        await sendMessage(chatId, TXT.ask_adlist_file);
      }
      return new Response("ok");
    }

    // awaiting_vpn_file
    if (action === "awaiting_vpn_file" && isAdmin(fromId)) {
      if (doc) {
        const path = await getFilePath(doc.file_id);
        if (!path) { await sendMessage(chatId, TXT.file_not_found); return new Response("ok"); }
        const content = await downloadFile(path);
        if (!content) { await sendMessage(chatId, TXT.file_not_found); return new Response("ok"); }
        await appendVpnText(content);
        DB.state[String(chatId)] = null; await saveDb();
        await sendMessage(chatId, TXT.uploaded_codes_file);
      } else if (text) {
        await appendVpnText(text);
        DB.state[String(chatId)] = null; await saveDb();
        await sendMessage(chatId, TXT.got_vpn_code);
      } else {
        await sendMessage(chatId, TXT.ask_vpn_file);
      }
      return new Response("ok");
    }

    // awaiting_new_admin
    if (action === "awaiting_new_admin" && isAdmin(fromId)) {
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

  // --- admin quick text commands ---
  if (isAdmin(fromId)) {
    if (text.toLowerCase().startsWith("/addchannel")) {
      const parts = text.split(/\s+/);
      const ch = parts[1];
      if (ch) { if (!DB.channels.includes(ch)) DB.channels.push(ch); await saveDb(); await sendMessage(chatId, TXT.added_channel(ch)); } else { await sendMessage(chatId, "Ulanyp: /addchannel @channel_name"); }
      return new Response("ok");
    }
    if (text.toLowerCase().startsWith("/removechannel")) {
      const parts = text.split(/\s+/);
      const ch = parts[1];
      if (ch) { DB.channels = DB.channels.filter(c=>c!==ch); await saveDb(); await sendMessage(chatId, TXT.removed_channel(ch)); } else { await sendMessage(chatId, "Ulanyp: /removechannel @channel_name"); }
      return new Response("ok");
    }
    if (text.toLowerCase().startsWith("/addvpn")) {
      const code = text.replace(/\/addvpn\s*/i, "").trim();
      if (code) { await appendVpnText(code); await sendMessage(chatId, TXT.got_vpn_code); } else { await sendMessage(chatId, "Ulanyp: /addvpn KOD123"); }
      return new Response("ok");
    }
  }

  // --- user confirms joined (inline callback 'i_joined' will normally be sent as callback_query; handle fallback plain text) ---
  if (text === "✅ Men ähli kanallara agza boldum" || /men.+kanallara.+agza/.test(text.toLowerCase())) {
    const code = await popVpnCode();
    if (!code) { await sendMessage(chatId, TXT.no_vpn_codes, { reply_to_message_id: messageId }); return new Response("ok"); }
    await sendMessage(chatId, TXT.vpn_code_sent(code), { reply_to_message_id: messageId });
    return new Response("ok");
  }

  // help
  if (text.toLowerCase() === "/help") {
    await sendMessage(chatId, "Salam! /start bilen başlaň. Adminler üçin /admin.\nAdminler: inline panel üçin /admin ýa-da paneldäki düwmelerden peýdalanyň.");
    return new Response("ok");
  }

  return new Response("ok");
});

console.log("Bot işläp başlady. Webhook path:", SECRET_PATH);





