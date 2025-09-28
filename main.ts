// sponsor_bot_main.ts
// Deno Telegram Sponsor Bot (webhook / serve style)
// Türkmençe mesajlar
// Işletmek:
// deno run --allow-net --allow-read --allow-write --allow-env sponsor_bot_main.ts
//
// Webhook oturtmak üçin (mysal):
// https://api.telegram.org/bot<YOUR_TOKEN>/setWebhook?url=https://your.domain.com/masakoffvpnhelper

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const TOKEN = Deno.env.get("BOT_TOKEN")!;
if (!TOKEN) throw new Error("BOT_TOKEN env var is required");
const API = `https://api.telegram.org/bot${TOKEN}`;
const SECRET_PATH = "/masakoffvpnhelper"; // webhook path — set your webhook using this path

// (Mömkün bolsa) admin sekret: /admin <secret> ýazany bilen şol ulanyjyny admin hökmünde goşar.
// Oýlanyşly howpsuzlyk üçin bu ýarym-ýol: ilkinji admin çykarmak üçin peýdaly.
const ADMIN_SECRET = Deno.env.get("ADMIN_SECRET") || "";

// Deno KV
const kv = await Deno.openKv();

// KV kömekçiler
async function kvSet(key: string, value: any) { await kv.set([key], value); }
async function kvGet(key: string) { const r = await kv.get([key]); return r.value; }

// Başlangyç zatlary üpjün ediň
async function ensureDefaults() {
  if ((await kvGet("admins")) == null) await kvSet("admins", []);
  if ((await kvGet("channels")) == null) await kvSet("channels", []);
  if ((await kvGet("users")) == null) await kvSet("users", []);
  if ((await kvGet("codes")) == null) await kvSet("codes", []);
  if ((await kvGet("user_claims")) == null) await kvSet("user_claims", {});
  if ((await kvGet("adlist_path")) == null) await kvSet("adlist_path", "adlist.txt");
}
await ensureDefaults();

// Telegram API çaýyrmak
async function callApi(method: string, body: any) {
  const res = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  try { return await res.json(); } catch { return null; }
}

// Türkmençe tekst wrapper (eger lokalizasiýa üýtgetmek isleseňiz şu funksiýa öwürip bilersiňiz)
function t(s: string) { return s; }

// Inline keyboard helper
function ik(rows: Array<Array<any>>) { return { reply_markup: { inline_keyboard: rows } }; }

// Admin paneli göçürýär
async function sendAdminPanel(chat_id: number) {
  const rows = [
    [{ text: t("Kanal goş"), callback_data: "add_channel" }, { text: t("Kanal aýyr"), callback_data: "remove_channel" }],
    [{ text: t("Adlist goş"), callback_data: "adlist_add" }, { text: t("Adlist görkez"), callback_data: "adlist_show" }],
    [{ text: t("Toplu habar — ulanyjylara"), callback_data: "broadcast_users" }, { text: t("Toplu habar — kanallara"), callback_data: "broadcast_channels" }],
    [{ text: t("Admin goş"), callback_data: "add_admin" }, { text: t("VPN kod goş"), callback_data: "add_code" }],
    [{ text: t("Faýldan kod ýükle"), callback_data: "upload_codes" }],
  ];
  await callApi("sendMessage", { chat_id, text: t("Admin paneli — saýlaň:"), ...ik(rows) });
}

// /start — kanallary görkezer inline düwmeler bilen
async function handleStart(chat_id: number) {
  const channels: string[] = (await kvGet("channels")) || [];
  const text = t("Salam! Salam VPN kody almak üçin aşakdaky kanallara agza bolmaly:");
  if (channels.length === 0) {
    await callApi("sendMessage", { chat_id, text: t("Häzir zerur kanallar ýok. Administrator bilen habarlaşyň.") });
    return;
  }
  const buttons = channels.map(ch => [{ text: `@${ch}`, url: `https://t.me/${ch}` }]);
  buttons.push([{ text: t("Men goşuldym /checksub"), callback_data: "check_sub" }]);
  await callApi("sendMessage", { chat_id, text, reply_markup: { inline_keyboard: buttons } });
}

// Ulanyja promocode bermek (bir gezek)
async function handlePromoCodeRequest(chat_id: number, from_id: number) {
  const codes: string[] = (await kvGet("codes")) || [];
  if (codes.length === 0) {
    await callApi("sendMessage", { chat_id, text: t("Häzir kod ýok. Administrator bilen habarlaşyň.") });
    return;
  }
  const user_claims: Record<string, boolean> = (await kvGet("user_claims")) || {};
  if (user_claims[String(from_id)]) {
    await callApi("sendMessage", { chat_id, text: t("Siz eýýäm bir gezek kod aldyňyz.") });
    return;
  }
  const code = codes.shift()!;
  user_claims[String(from_id)] = true;
  await kvSet("codes", codes);
  await kvSet("user_claims", user_claims);
  await callApi("sendMessage", { chat_id, text: t("Siziň VPN kodyňiz: ") + code });
}

// Toplu habar funksiýalary
async function broadcastToUsers(message: string) {
  const users: number[] = (await kvGet("users")) || [];
  for (const u of users) {
    try { await callApi("sendMessage", { chat_id: u, text: message }); } catch (e) { console.warn("broadcastToUsers error", e); }
  }
}
async function broadcastToChannels(message: string) {
  const channels: string[] = (await kvGet("channels")) || [];
  for (const ch of channels) {
    try { await callApi("sendMessage", { chat_id: `@${ch}`, text: message }); } catch (e) { console.warn("broadcastToChannels error", e); }
  }
}

// Esasy update işleýji
async function processUpdate(update: any) {
  if (update.message) {
    const msg = update.message;
    const text: string = msg.text || "";
    const chat_id = msg.chat.id;
    const from_id = msg.from.id;

    // her gezek ulanyjyny ýazga alyň (global message üçin)
    const users: number[] = (await kvGet("users")) || [];
    if (!users.includes(from_id)) { users.push(from_id); await kvSet("users", users); }

    if (text.startsWith("/start")) { await handleStart(chat_id); return; }

    // /admin <secret> — eger ADMIN_SECRET setlense we jübüt bolsa, şu ulanyjyny admins listine goşýar we admin panel görkezýär
    if (text.startsWith("/admin")) {
      const parts = text.split(/\s+/).filter(Boolean);
      if (parts.length < 2) {
        await callApi("sendMessage", { chat_id, text: t("Admin bolmak üçin: /admin <admin_id_secret>") });
        return;
      }
      const secret = parts[1];
      if (ADMIN_SECRET && secret === ADMIN_SECRET) {
        const admins: number[] = (await kvGet("admins")) || [];
        if (!admins.includes(from_id)) { admins.push(from_id); await kvSet("admins", admins); }
        await callApi("sendMessage", { chat_id, text: t("Admin hökmünde kabul edildi — admin paneliňizi görýärsiňiz.") });
        await sendAdminPanel(chat_id);
      } else {
        await callApi("sendMessage", { chat_id, text: t("Ýalňyş admin id ýa-da admin sekret. Administrator bilen habarlaşyň.") });
      }
      return;
    }

    // admin komandalary (eger ulanyjy admins listinde bolsa)
    const admins: number[] = (await kvGet("admins")) || [];
    if (admins.includes(from_id)) {
      // /addchannel kanal_adi
      if (text.startsWith("/addchannel")) {
        const parts = text.split(/\s+/).filter(Boolean);
        if (parts.length < 2) { await callApi("sendMessage", { chat_id, text: t("Ulanylan görnüş: /addchannel kanal_adi") }); return; }
        const ch = parts[1].replace(/^@/, "");
        const channels: string[] = (await kvGet("channels")) || [];
        if (!channels.includes(ch)) { channels.push(ch); await kvSet("channels", channels); await callApi("sendMessage", { chat_id, text: t("Kanal goşuldy: @") + ch }); }
        else { await callApi("sendMessage", { chat_id, text: t("Kanal eýýäm bar: @") + ch }); }
        return;
      }

      // /removechannel kanal_adi
      if (text.startsWith("/removechannel")) {
        const parts = text.split(/\s+/).filter(Boolean);
        if (parts.length < 2) { await callApi("sendMessage", { chat_id, text: t("Ulanylan görnüş: /removechannel kanal_adi") }); return; }
        const ch = parts[1].replace(/^@/, "");
        let channels: string[] = (await kvGet("channels")) || [];
        channels = channels.filter(c => c !== ch);
        await kvSet("channels", channels);
        await callApi("sendMessage", { chat_id, text: t("Kanal aýryldy: @") + ch });
        return;
      }

      // /adlist_add <setir>
      if (text.startsWith("/adlist_add")) {
        const payload = text.replace(/\/adlist_add\s*/i, "").trim();
        if (!payload) { await callApi("sendMessage", { chat_id, text: t("Ulanylan görnüş: /adlist_add <setir>") }); return; }
        const path = (await kvGet("adlist_path")) || "adlist.txt";
        await Deno.writeTextFile(path, payload + "\n", { append: true });
        await callApi("sendMessage", { chat_id, text: t("Adlist faýlyna setir goşuldy.") });
        return;
      }

      // /adlist_show
      if (text.startsWith("/adlist_show")) {
        const path = (await kvGet("adlist_path")) || "adlist.txt";
        try {
          const txt = await Deno.readTextFile(path);
          await callApi("sendMessage", { chat_id, text: t("Adlist mazmuny:\n") + txt });
        } catch (e) { await callApi("sendMessage", { chat_id, text: t("Adlist faýly tapylmady.") }); }
        return;
      }

      // /broadcast_users <habar>
      if (text.startsWith("/broadcast_users")) {
        const msg = text.replace(/\/broadcast_users\s*/i, "").trim();
        if (!msg) { await callApi("sendMessage", { chat_id, text: t("Ulanylan görnüş: /broadcast_users <habar>") }); return; }
        await callApi("sendMessage", { chat_id, text: t("Toplu habar başlandy — ulanyjylara") });
        await broadcastToUsers(msg);
        await callApi("sendMessage", { chat_id, text: t("Toplu habar tamamlandy.") });
        return;
      }

      // /broadcast_channels <habar>
      if (text.startsWith("/broadcast_channels")) {
        const msg = text.replace(/\/broadcast_channels\s*/i, "").trim();
        if (!msg) { await callApi("sendMessage", { chat_id, text: t("Ulanylan görnüş: /broadcast_channels <habar>") }); return; }
        await callApi("sendMessage", { chat_id, text: t("Toplu habar başlandy — kanallara") });
        await broadcastToChannels(msg);
        await callApi("sendMessage", { chat_id, text: t("Toplu habar tamamlandy.") });
        return;
      }

      // /addadmin <telegram_id>
      if (text.startsWith("/addadmin")) {
        const parts = text.split(/\s+/).filter(Boolean);
        if (parts.length < 2) { await callApi("sendMessage", { chat_id, text: t("Ulanylan görnüş: /addadmin <telegram_id>") }); return; }
        const id = Number(parts[1]); if (isNaN(id)) { await callApi("sendMessage", { chat_id, text: t("Admin id sany bolmaly.") }); return; }
        const admins: number[] = (await kvGet("admins")) || [];
        if (!admins.includes(id)) { admins.push(id); await kvSet("admins", admins); await callApi("sendMessage", { chat_id, text: t("Admin üstünlikli goşuldy: ") + String(id) }); }
        else { await callApi("sendMessage", { chat_id, text: t("Bu ID eýýäm admin.") }); }
        return;
      }

      // /addcode <kod>
      if (text.startsWith("/addcode")) {
        const code = text.replace(/\/addcode\s*/i, "").trim();
        if (!code) { await callApi("sendMessage", { chat_id, text: t("Ulanylan görnüş: /addcode <kod>") }); return; }
        const codes: string[] = (await kvGet("codes")) || [];
        codes.push(code); await kvSet("codes", codes);
        await callApi("sendMessage", { chat_id, text: t("Kod üstünlikli goşuldy: ") + code });
        return;
      }

      // /upload_codes <path> (serverde ýerleşýän faýl)
      if (text.startsWith("/upload_codes")) {
        const path = text.replace(/\/upload_codes\s*/i, "").trim() || "codes.txt";
        try {
          const txt = await Deno.readTextFile(path);
          const lines = txt.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
          const codes: string[] = (await kvGet("codes")) || [];
          for (const l of lines) codes.push(l);
          await kvSet("codes", codes);
          await callApi("sendMessage", { chat_id, text: t("Faýldan kodlar goşuldy: ") + String(lines.length) });
        } catch (e) { await callApi("sendMessage", { chat_id, text: t("Faýl okaýlmady: ") + path }); }
        return;
      }
    }

    // /promocode — ulanyjy bir gezek kod alyp biler
    if (text.startsWith("/promocode")) {
      await handlePromoCodeRequest(chat_id, from_id);
      return;
    }

    if (text.startsWith("/help")) {
      await callApi("sendMessage", { chat_id, text: t("Bu bot administrator tarapyndan dolandyrylýar.\n/start — başlamaga\n/promocode — VPN kody almak\nAdmin üçin: /admin <secret>") });
      return;
    }
  }

  // callback_query (inline düwmeler)
  if (update.callback_query) {
    const cb = update.callback_query;
    const data = cb.data;
    const from = cb.from;
    const chat_id = cb.message ? cb.message.chat.id : from.id;
    const admins: number[] = (await kvGet("admins")) || [];
    if (!admins.includes(from.id)) {
      await callApi("answerCallbackQuery", { callback_query_id: cb.id, text: t("Siz admin däl.") });
      return;
    }

    // admin panel düwmeleri üçin ýönekeý maglumat jogaplary
    if (data === "add_channel") {
      await callApi("answerCallbackQuery", { callback_query_id: cb.id, text: t("Kanaly goşmak üçin: /addchannel kanal_adi") });
      return;
    }
    if (data === "remove_channel") {
      await callApi("answerCallbackQuery", { callback_query_id: cb.id, text: t("Kanaly aýyrmak üçin: /removechannel kanal_adi") });
      return;
    }
    if (data === "adlist_add") {
      await callApi("answerCallbackQuery", { callback_query_id: cb.id, text: t("Adlist faýlyna setir goşmak üçin: /adlist_add <setir>") });
      return;
    }
    if (data === "adlist_show") {
      const path = (await kvGet("adlist_path")) || "adlist.txt";
      try { const txt = await Deno.readTextFile(path); await callApi("sendMessage", { chat_id, text: t("Adlist:\n") + txt }); }
      catch (e) { await callApi("sendMessage", { chat_id, text: t("Adlist faýly tapylmady.") }); }
      await callApi("answerCallbackQuery", { callback_query_id: cb.id, text: t("Adlist görkezildi.") });
      return;
    }
    if (data === "broadcast_users") {
      await callApi("answerCallbackQuery", { callback_query_id: cb.id, text: t("Toplu habar: /broadcast_users <habar>") });
      return;
    }
    if (data === "broadcast_channels") {
      await callApi("answerCallbackQuery", { callback_query_id: cb.id, text: t("Toplu habar: /broadcast_channels <habar>") });
      return;
    }
    if (data === "add_admin") {
      await callApi("answerCallbackQuery", { callback_query_id: cb.id, text: t("Admin goşmak üçin: /addadmin <tg_id>") });
      return;
    }
    if (data === "add_code") {
      await callApi("answerCallbackQuery", { callback_query_id: cb.id, text: t("Kod goşmak üçin: /addcode <kod>") });
      return;
    }
    if (data === "upload_codes") {
      await callApi("answerCallbackQuery", { callback_query_id: cb.id, text: t("Faýldan kod ýüklemek üçin: /upload_codes <path>") });
      return;
    }
    if (data === "check_sub") {
      await callApi("answerCallbackQuery", { callback_query_id: cb.id, text: t("Alynşygy doly barlamak üçin botyň admin bolmagy we Telegram API-de aýratyn metodlary ulanmak gerek.") });
      return;
    }
  }
}

// Webhook server
console.log("Bot webhook server ready at path:", SECRET_PATH);
serve(async (req) => {
  try {
    const url = new URL(req.url);
    if (url.pathname !== SECRET_PATH) return new Response("Not Found", { status: 404 });
    const update = await req.json();
    // asynchrons işle - kömegi konsola ýaz, jogapy çalt ber
    processUpdate(update).catch(e => console.error("processUpdate error", e));
    return new Response("OK");
  } catch (e) {
    console.error("serve error", e);
    return new Response("Bad Request", { status: 400 });
  }
});


