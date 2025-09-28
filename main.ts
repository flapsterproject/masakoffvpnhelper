// main.ts
// Telegram Sponsor Bot (Deno)
// Features:
// - /start shows "join required channels" message in Turkmen with inline buttons
// - admin panel (/admin) protected by ADMIN_ID env var and inline admin controls
// - add/remove/list required channels (saved to KV + adlist.json file)
// - add VPN codes manually (/add_vpn_code <code>) or by uploading a file (one code per line)
// - send bulk messages to all users (admin only)
// - add admin (/add_admin <id>), manage adlist file
// - all user-facing strings are in Turkmen

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const TOKEN = Deno.env.get("BOT_TOKEN")!;
if (!TOKEN) throw new Error("BOT_TOKEN env var is required");
const API = `https://api.telegram.org/bot${TOKEN}`;
const SECRET_PATH = "/masakoffvpnhelper"; // Make sure this matches your webhook URL 

// Deno KV
const kv = await Deno.openKv();
const ADMIN_USERNAME = "@Masakoff"; // keep as username check, change to ADMIN_ID if you want id-based admin

// Deno KV for persistent small storage
const kv = await Deno.openKv();

// Files for adlist and vpn codes (also kept in KV for convenience)
const ADLIST_FILE = "./adlist.json";
const VPN_CODES_FILE = "./vpn_codes.txt";

// In-memory state tracking for admins waiting input
type AdminState =
  | { action: "add_channel" }
  | { action: "remove_channel" }
  | { action: "set_admin_message" }
  | { action: "send_bulk" }
  | { action: "add_vpn_file" }
  | { action: "add_vpn_manual" }
  | null;

const adminStates: Record<string, AdminState> = {};

// -------------------- Telegram helpers --------------------
async function apiRequest(method: string, body: any) {
  const res = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function sendMessage(chatId: string, text: string, options: any = {}) {
  return apiRequest("sendMessage", { chat_id: chatId, text, ...options });
}

async function editMessageText(chatId: string, messageId: number, text: string, options: any = {}) {
  return apiRequest("editMessageText", { chat_id: chatId, message_id: messageId, text, ...options });
}

async function answerCallbackQuery(callbackId: string, text = "", showAlert = false) {
  return apiRequest("answerCallbackQuery", { callback_query_id: callbackId, text, show_alert: showAlert });
}

async function sendDocument(chatId: string, fileBytes: Uint8Array, filename = "file.txt", caption = "") {
  // For webhook / Deno fetch multipart upload, use FormData
  const form = new FormData();
  form.append("chat_id", chatId);
  form.append("document", new Blob([fileBytes]), filename);
  if (caption) form.append("caption", caption);
  const res = await fetch(`${API}/sendDocument`, { method: "POST", body: form });
  return res.json();
}

// -------------------- Storage helpers --------------------
async function getJSONFromKV(key: string) {
  const r = await kv.get([key]);
  return r.value ?? null;
}
async function setJSONToKV(key: string, val: any) {
  await kv.set([key], val);
}

// Ensure adlist file exists
async function ensureAdlistFile() {
  try {
    await Deno.stat(ADLIST_FILE);
  } catch {
    await Deno.writeTextFile(ADLIST_FILE, JSON.stringify({ channels: [] }, null, 2));
  }
}
async function readAdlistFile() {
  try {
    await ensureAdlistFile();
    const s = await Deno.readTextFile(ADLIST_FILE);
    return JSON.parse(s);
  } catch {
    return { channels: [] as string[] };
  }
}
async function writeAdlistFile(data: any) {
  await Deno.writeTextFile(ADLIST_FILE, JSON.stringify(data, null, 2));
}

// VPN codes file helpers
async function appendVpnCodes(codes: string[]) {
  const toWrite = codes.join("\n") + "\n";
  await Deno.writeTextFile(VPN_CODES_FILE, toWrite, { append: true }).catch(async () => {
    await Deno.writeTextFile(VPN_CODES_FILE, toWrite);
  });
}

// -------------------- Basic app logic --------------------

// Save user to KV (for bulk messaging)
async function addUser(userId: string) {
  const usersRes = await kv.get(["users"]);
  let users: string[] = usersRes.value ?? [];
  if (!users.includes(userId)) {
    users.push(userId);
    await kv.set(["users"], users);
  }
}

// Required channels handling (KV + file)
async function getRequiredChannels(): Promise<string[]> {
  const kvRes = await kv.get(["required_channels"]);
  if (kvRes.value) return kvRes.value as string[];
  const fromFile = (await readAdlistFile()).channels ?? [];
  await kv.set(["required_channels"], fromFile);
  return fromFile;
}
async function setRequiredChannels(chans: string[]) {
  await kv.set(["required_channels"], chans);
  await writeAdlistFile({ channels: chans });
}

// Utility to build inline keyboard for channels (url buttons) + verify button
async function channelsKeyboard() {
  const chans = await getRequiredChannels();
  const buttons: any[] = [];
  for (const ch of chans) {
    // ch can be a username like @channel or t.me link. We'll show as URL button.
    let url = ch;
    if (ch.startsWith("@")) url = `https://t.me/${ch.slice(1)}`;
    buttons.push([{ text: ch, url }]);
  }
  // verify button
  buttons.push([{ text: "✅ Men agza boldum (tassyklamak)", callback_data: "verify_membership" }]);
  return { inline_keyboard: buttons };
}

// Basic membership check: verify user is a member of all channels using getChatMember
async function checkMembership(userId: string): Promise<{ ok: boolean; missing: string[] }> {
  const chans = await getRequiredChannels();
  const missing: string[] = [];
  for (const ch of chans) {
    try {
      // We attempt to check membership; if channel is @username use that, else skip
      let chatId = ch;
      if (ch.startsWith("@")) {
        const resp = await apiRequest("getChatMember", { chat_id: ch, user_id: userId });
        if (!resp.ok || resp.result?.status === "left" || resp.result?.status === "kicked") {
          missing.push(ch);
        }
      } else if (ch.startsWith("https://t.me/")) {
        const uname = ch.split("/").pop()!;
        const resp = await apiRequest("getChatMember", { chat_id: `@${uname}`, user_id: userId });
        if (!resp.ok || resp.result?.status === "left" || resp.result?.status === "kicked") {
          missing.push(ch);
        }
      } else {
        // unknown format - skip checking and assume missing
        missing.push(ch);
      }
    } catch {
      missing.push(ch);
    }
  }
  return { ok: missing.length === 0, missing };
}

// -------------------- Command Handlers --------------------
async function handleCommand(fromId: string, username: string | undefined, displayName: string, text: string, rawMsg: any) {
  // Save user to list
  await addUser(fromId);

  if (text.startsWith("/start") || text.startsWith("/help")) {
    const intro = `🖐️ *Salam!* Salam VPN kody almak üçin aşakdaky kanallara agza bolmaly.\n\n` +
      `📌 Kanallara agza bolan soň "Men agza boldum" düwmesine basyp tassyklap bilersiňiz.\n\n` +
      `📎 Eger kanallara girip bolmasa, admin bilen habarlaşyň.`;
    const keyboard = await channelsKeyboard();
    await sendMessage(fromId, intro, { reply_markup: keyboard, parse_mode: "Markdown" });
    return;
  }

  if (text.startsWith("/admin")) {
    // admin command — check fromId matches ADMIN_ID or additional admin list in KV
    const isAdmin = (fromId === ADMIN_ID) || await isInAdmins(fromId);
    if (!isAdmin) {
      await sendMessage(fromId, "❌ Siz admin däl. /admin ulanyp bilmezsiniz.");
      return;
    }
    // Show admin panel as inline keyboard
    const adminMsg = `🔐 *Admin Paneli*\n\nAşakdaky düwmeler arkaly kanallary dolandyryp, toplu habar iberip, VPN kodlaryny dolandyryp bilersiňiz.`;
    const keyboard = {
      inline_keyboard: [
        [{ text: "➕ Kanal Goş", callback_data: "admin:add_channel" }, { text: "➖ Kanal Aýyr", callback_data: "admin:remove_channel" }],
        [{ text: "📜 Kanal Sanawy", callback_data: "admin:list_channels" }, { text: "🗂️ Adlist (faýl)", callback_data: "admin:adlist" }],
        [{ text: "🔐 VPN Kod goş (El bilen)", callback_data: "admin:add_vpn_manual" }, { text: "📁 VPN Kod import (Faýl)", callback_data: "admin:add_vpn_file" }],
        [{ text: "📣 Toplu Habar Iber", callback_data: "admin:send_bulk" }, { text: "🧑‍💼 Admin goş", callback_data: "admin:add_admin" }],
        [{ text: "✏️ Admin Panel Habar (set)", callback_data: "admin:set_admin_message" }]
      ]
    };
    await sendMessage(fromId, adminMsg, { reply_markup: keyboard, parse_mode: "Markdown" });
    return;
  }

  if (text.startsWith("/add_vpn_code")) {
    // admin-only manual add: /add_vpn_code CODE
    const isAdmin = (fromId === ADMIN_ID) || await isInAdmins(fromId);
    if (!isAdmin) {
      await sendMessage(fromId, "❌ Siz admin däl.");
      return;
    }
    const parts = text.split(" ");
    if (parts.length < 2) {
      await sendMessage(fromId, "Ulanyş: /add_vpn_code <kode>");
      return;
    }
    const code = parts.slice(1).join(" ").trim();
    if (!code) {
      await sendMessage(fromId, "Kod boş bolup bilmez.");
      return;
    }
    await appendVpnCodes([code]);
    await sendMessage(fromId, `✅ VPN kod goşuldy: \`${code}\``, { parse_mode: "Markdown" });
    return;
  }

  if (text.startsWith("/add_admin")) {
    const isAdmin = (fromId === ADMIN_ID) || await isInAdmins(fromId);
    if (!isAdmin) {
      await sendMessage(fromId, "❌ Siz admin däl.");
      return;
    }
    const parts = text.split(" ");
    if (parts.length < 2) {
      await sendMessage(fromId, "Ulanyş: /add_admin <telegram_numeric_id>");
      return;
    }
    const newAdminId = parts[1].trim();
    await addAdmin(newAdminId);
    await sendMessage(fromId, `✅ Admin hökmünde goşuldy: ${newAdminId}`);
    return;
  }

  // If admin is in a state waiting for input
  if (adminStates[fromId]) {
    const state = adminStates[fromId];
    if (!state) return;
    if (state.action === "add_channel") {
      const ch = text.trim();
      if (!ch) { await sendMessage(fromId, "Kanal maglumatyny giriziň (misal @channel ýa-da https://t.me/channel)"); return; }
      const chans = await getRequiredChannels();
      if (!chans.includes(ch)) chans.push(ch);
      await setRequiredChannels(chans);
      adminStates[fromId] = null;
      await sendMessage(fromId, `✅ Kanal goşuldy: ${ch}`);
      return;
    } else if (state.action === "remove_channel") {
      const ch = text.trim();
      if (!ch) { await sendMessage(fromId, "Aýyrmak isleýän kanaly giriziň"); return; }
      let chans = await getRequiredChannels();
      chans = chans.filter(c => c !== ch);
      await setRequiredChannels(chans);
      adminStates[fromId] = null;
      await sendMessage(fromId, `✅ Kanal aýryldy: ${ch}`);
      return;
    } else if (state.action === "set_admin_message") {
      const msg = text.trim();
      await setJSONToKV("admin_message", msg);
      adminStates[fromId] = null;
      await sendMessage(fromId, `✅ Admin panel habary sazlandy.`);
      return;
    } else if (state.action === "send_bulk") {
      const message = text;
      adminStates[fromId] = null;
      // send to all users in KV/users
      const usersRes = await kv.get(["users"]);
      const users: string[] = usersRes.value ?? [];
      await sendMessage(fromId, `📣 Toplu habar iberilýär ${users.length} ulanyja...`);
      for (const uid of users) {
        try {
          await sendMessage(uid, message);
        } catch (e) {
          console.warn("bulk send error to", uid, e);
        }
      }
      await sendMessage(fromId, `✅ Toplu habar iberildi.`);
      return;
    } else if (state.action === "add_vpn_manual") {
      const code = text.trim();
      if (!code) { await sendMessage(fromId, "VPN kod giriziň."); return; }
      await appendVpnCodes([code]);
      adminStates[fromId] = null;
      await sendMessage(fromId, `✅ VPN kod goşuldy: \`${code}\``, { parse_mode: "Markdown" });
      return;
    } else if (state.action === "add_vpn_file") {
      // Admin was instructed to upload a document — handled in document message handler
      await sendMessage(fromId, "📁 Faýly iberiň (har bir setirde bir kod).");
      return;
    }
  }

  // Default fallback
  await sendMessage(fromId, "❓ Näbelli buýruk. Admin komandalary üçin /admin, kömek üçin /help.");
}

// -------------------- Admin helpers --------------------
async function isInAdmins(id: string) {
  const r = await kv.get(["admins"]);
  const list: string[] = r.value ?? [];
  return list.includes(id);
}
async function addAdmin(id: string) {
  const r = await kv.get(["admins"]);
  const list: string[] = r.value ?? [];
  if (!list.includes(id)) {
    list.push(id);
    await kv.set(["admins"], list);
  }
}

// -------------------- Callback Query Handler --------------------
async function handleCallback(fromId: string, data: string, callbackId: string) {
  // verify_membership
  if (data === "verify_membership") {
    const { ok, missing } = await checkMembership(fromId);
    if (ok) {
      // Give user a VPN code if available. We pop one code from file.
      // Read vpn codes file and pop first line
      let code = null;
      try {
        const text = await Deno.readTextFile(VPN_CODES_FILE);
        const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
        if (lines.length > 0) {
          code = lines.shift()!;
          await Deno.writeTextFile(VPN_CODES_FILE, lines.join("\n") + (lines.length ? "\n" : ""));
        }
      } catch {
        // no file or empty
      }
      if (code) {
        await sendMessage(fromId, `✅ Tassykladyňyz! Size VPN kody berildi:\n\n\`${code}\``, { parse_mode: "Markdown" });
      } else {
        await sendMessage(fromId, `✅ Tassykladyňyz! Emma häzir VPN kody ýok. Admin bilen habarlaşyň.`);
      }
      await answerCallbackQuery(callbackId, "Tassyklama üstünlikli!");
    } else {
      const missingText = missing.length ? missing.join(", ") : "Nädogry formatly kanallar";
      await answerCallbackQuery(callbackId, `Kämillik ýok: ${missingText}`, true);
      await sendMessage(fromId, `❌ Aşakdaky kanallara goşulmagyňyz gerek: ${missingText}`);
    }
    return;
  }

  // Admin prefixed callbacks
  if (data.startsWith("admin:")) {
    // Check admin
    const isAdminCaller = (fromId === ADMIN_ID) || await isInAdmins(fromId);
    if (!isAdminCaller) {
      await answerCallbackQuery(callbackId, "❌ Siz admin däl.", true);
      return;
    }
    const cmd = data.split(":")[1];
    if (cmd === "add_channel") {
      adminStates[fromId] = { action: "add_channel" };
      await sendMessage(fromId, "✏️ Goşmak isleýän kanaly giriziň (misal: @channel ýa-da https://t.me/channel):");
      await answerCallbackQuery(callbackId);
      return;
    } else if (cmd === "remove_channel") {
      adminStates[fromId] = { action: "remove_channel" };
      await sendMessage(fromId, "✏️ Aýyrmak isleýän kanaly giriziň (misal: @channel):");
      await answerCallbackQuery(callbackId);
      return;
    } else if (cmd === "list_channels") {
      const chans = await getRequiredChannels();
      const text = chans.length ? `📜 Kanallar:\n` + chans.join("\n") : "📭 Heç bir kanal ýok.";
      await sendMessage(fromId, text);
      await answerCallbackQuery(callbackId);
      return;
    } else if (cmd === "adlist") {
      const adlist = await readAdlistFile();
      await sendMessage(fromId, `📁 Adlist faýly:\n` + JSON.stringify(adlist, null, 2));
      await answerCallbackQuery(callbackId);
      return;
    } else if (cmd === "set_admin_message") {
      adminStates[fromId] = { action: "set_admin_message" };
      await sendMessage(fromId, "✏️ Admin panelde görünejek habary giriziň:");
      await answerCallbackQuery(callbackId);
      return;
    } else if (cmd === "send_bulk") {
      adminStates[fromId] = { action: "send_bulk" };
      await sendMessage(fromId, "✏️ Toplu ibermek isleýän habaryňyzy giriziň:");
      await answerCallbackQuery(callbackId);
      return;
    } else if (cmd === "add_vpn_manual") {
      adminStates[fromId] = { action: "add_vpn_manual" };
      await sendMessage(fromId, "✏️ VPN kod giriziň (bir kod):");
      await answerCallbackQuery(callbackId);
      return;
    } else if (cmd === "add_vpn_file") {
      adminStates[fromId] = { action: "add_vpn_file" };
      await sendMessage(fromId, "📁 Faýly iberiň: her setirde bir VPN kod.");
      await answerCallbackQuery(callbackId);
      return;
    } else if (cmd === "add_admin") {
      // Ask for id via text (or could be a parameter)
      adminStates[fromId] = { action: "add_vpn_manual" }; // reuse generic state: but better to instruct via message
      await sendMessage(fromId, "✏️ Admin ID-ni goşmak üçin /add_admin <id> ulanyň (mysal: /add_admin 123456789)");
      await answerCallbackQuery(callbackId);
      return;
    } else {
      await answerCallbackQuery(callbackId);
      return;
    }
  }

  await answerCallbackQuery(callbackId);
}

// -------------------- Document (file) handling --------------------
// When an admin uploads a document to the bot (webhook update.message.document)
// we will fetch the file from Telegram and parse lines as VPN codes
async function handleDocumentMessage(msg: any) {
  const from = msg.from;
  const fromId = String(from.id);
  const isAdminCaller = (fromId === ADMIN_ID) || await isInAdmins(fromId);
  if (!isAdminCaller) {
    await sendMessage(fromId, "❌ Faýl iberip bilersiňiz, ýöne diňe adminlar işlär.");
    return;
  }
  const document = msg.document;
  if (!document) {
    await sendMessage(fromId, "❌ Faýl tapylmady.");
    return;
  }
  try {
    // Get file path
    const fileRes = await apiRequest("getFile", { file_id: document.file_id });
    if (!fileRes.ok) {
      await sendMessage(fromId, "❌ Faýly alyp bolmady.");
      return;
    }
    const filePath = fileRes.result.file_path as string;
    // Download file
    const fileUrl = `https://api.telegram.org/file/bot${TOKEN}/${filePath}`;
    const resp = await fetch(fileUrl);
    const bytes = new Uint8Array(await resp.arrayBuffer());
    const text = new TextDecoder().decode(bytes);
    const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) {
      await sendMessage(fromId, "❌ Faýlda heç bir kod ýok.");
      return;
    }
    // Append to vpn codes file
    await appendVpnCodes(lines);
    await sendMessage(fromId, `✅ Faýldan ${lines.length} kod import edildi.`);
  } catch (e) {
    console.error("document handling error", e);
    await sendMessage(fromId, "❌ Faýly işlemde säwlik boldy.");
  }
}

// -------------------- Utilities --------------------
function getTextFromMessage(msg: any) {
  return msg.text ?? msg.caption ?? "";
}

// -------------------- Server (webhook) --------------------
serve(async (req: Request) => {
  try {
    const url = new URL(req.url);
    // If you run as webhook, set SECRET_PATH to your path
    if (url.pathname !== SECRET_PATH) return new Response("Not found", { status: 404 });
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

    const update = await req.json();
    // Handle messages
    if (update.message) {
      const msg = update.message;
      const from = msg.from;
      const fromId = String(from.id);
      const username = from.username;
      const displayName = (from.first_name ?? "") + (from.last_name ? " " + from.last_name : "");
      const text = getTextFromMessage(msg) ?? "";

      // Save user to KV list for bulk
      await addUser(fromId);

      if (msg.document) {
        await handleDocumentMessage(msg);
        return new Response("OK");
      }

      if (text && text.startsWith("/")) {
        await handleCommand(fromId, username, displayName || fromId, text, msg);
        return new Response("OK");
      } else if (msg.reply_to_message && msg.reply_to_message.from && msg.reply_to_message.from.is_bot) {
        // possibility: admin replying to bot prompt — treat as admin input
        if (adminStates[fromId]) {
          await handleCommand(fromId, username, displayName || fromId, text, msg);
          return new Response("OK");
        }
      } else if (text) {
        // general text — maybe admin state or normal user
        if (adminStates[fromId]) {
          await handleCommand(fromId, username, displayName || fromId, text, msg);
        } else {
          await sendMessage(fromId, "Habar alyndy. Başga sorag üçin /help ýazyň.");
        }
        return new Response("OK");
      }
    } else if (update.callback_query) {
      const cb = update.callback_query;
      const fromId = String(cb.from.id);
      const data = cb.data;
      await handleCallback(fromId, data, cb.id);
      return new Response("OK");
    }

    return new Response("OK");
  } catch (e) {
    console.error("server error", e);
    return new Response("Error", { status: 500 });
  }
});
