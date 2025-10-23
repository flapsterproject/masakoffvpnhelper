// main.ts
// Telegram TMCELL Search Bot (Deno)
// Features: Search in SQLite DB, user balances (using Deno KV), referrals, promo codes, admin commands
// Admin can change search SQLite file via /setfile

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { DB } from "https://deno.land/x/sqlite@v3.8/mod.ts";

const TOKEN = Deno.env.get("BOT_TOKEN");
const API = `https://api.telegram.org/bot${TOKEN}`;
const SECRET_PATH = "/masakoffvpnhelper"; // Make sure this matches your webhook URL
const SEARCH_DB_PATH = "VL2025.sqlite";
const ADMIN_USER_ID = "7171269159";

// Fetch bot username at start
const botInfoResponse = await fetch(`${API}/getMe`);
const botInfo = await botInfoResponse.json();
const botUsername = botInfo.result.username;

const kv = await Deno.openKv();

let searchDb: DB;
try {
  searchDb = new DB(SEARCH_DB_PATH);
} catch (e) {
  console.error("Failed to open search database:", e);
  Deno.exit(1);
}

// Types
type User = {
  id: string;
  username?: string;
  full_name: string;
  balance: number;
  referrals: number;
};

type PromoCode = {
  code: string;
  value: number;
  max_usage: number;
  current_usage: number;
  used_by: string;
};

// User KV functions
async function initUser(userId: string, username?: string, fullName?: string) {
  const key = ["users", userId];
  const res = await kv.get<User>(key);
  if (!res.value) {
    const user: User = {
      id: userId,
      username,
      full_name: fullName || `ID:${userId}`,
      balance: 1,
      referrals: 0,
    };
    await kv.set(key, user);
    return user;
  } else {
    const existing = res.value;
    let changed = false;
    if (username && username !== existing.username) {
      existing.username = username;
      changed = true;
    }
    if (fullName && fullName !== existing.full_name) {
      existing.full_name = fullName;
      changed = true;
    }
    if (changed) await kv.set(key, existing);
    return existing;
  }
}

async function getUser(userId: string): Promise<User | null> {
  const res = await kv.get<User>(["users", userId]);
  return res.value ?? null;
}

async function updateUser(userId: string, delta: Partial<User>) {
  const existing = await getUser(userId) || await initUser(userId);
  const newUser: User = {
    ...existing,
    username: delta.username ?? existing.username,
    full_name: delta.full_name ?? existing.full_name,
    balance: (existing.balance || 0) + (delta.balance ?? 0),
    referrals: (existing.referrals || 0) + (delta.referrals ?? 0),
    id: existing.id,
  };
  await kv.set(["users", userId], newUser);
  return newUser;
}

async function registerUser(userId: string, username: string | undefined, fullName: string, referrerId: string | null = null) {
  const user = await getUser(userId);
  if (!user) {
    await initUser(userId, username, fullName);
    if (referrerId) {
      await updateUser(referrerId, { balance: 1, referrals: 1 });
    }
  }
}

async function getBalance(userId: string): Promise<number> {
  const user = await getUser(userId);
  return user ? user.balance : 0;
}

async function getReferrals(userId: string): Promise<number> {
  const user = await getUser(userId);
  return user ? user.referrals : 0;
}

// Promo KV functions
async function getPromo(code: string): Promise<PromoCode | null> {
  const res = await kv.get<PromoCode>(["promo_codes", code]);
  return res.value ?? null;
}

async function updatePromo(promo: PromoCode) {
  await kv.set(["promo_codes", promo.code], promo);
}

async function createPromo(code: string, value: number, maxUsage: number, chatId: string) {
  const existing = await getPromo(code);
  if (existing) {
    await sendMessage(chatId, "Bu promokod öňem bar.");
    return;
  }
  const promo: PromoCode = {
    code,
    value,
    max_usage: maxUsage,
    current_usage: 0,
    used_by: "",
  };
  await updatePromo(promo);
  await sendMessage(chatId, `✅ Promokod <code>${code}</code> üstünlikli ýasaldy we ol ${value} bal berer. Maksimum ulanylyş sany: ${maxUsage}.`);
}

// Encoding functions
const ENCODE_CHARS = "1234567890-=\\\\@$^&()+| ;'',./{}:\"<>abcdefghijklmnopqrstuvwxyzабвгдеёжзийклмнопрстуфхцчшщъыьэюяABCDEFGHIJKLMNOPQRSTUVWXYZАБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ";
const DECODE_CHARS = ")|;/4&.$2:''=,+^>9-0<3178(@\"{ 65}\\\\rёмlйnfфvчежbыoитлрhюузбmцxоkiдdьgwхщzэqпtpuвaшъeyяcгаjнсsкRЁМLЙNFФVЧЕЖBЫOИТЛРHЮУЗБMЦXОKIДDЬGWХЩZЭQПTPUВAШЪEYЯCГАJНСSК";

function encode(text: string): string {
  return [...text].map(c => ENCODE_CHARS.includes(c) ? DECODE_CHARS[ENCODE_CHARS.indexOf(c)] : c).join('');
}

function decode(text: string): string {
  return [...text].map(c => DECODE_CHARS.includes(c) ? ENCODE_CHARS[DECODE_CHARS.indexOf(c)] : c).join('');
}

// Search functions
function searchData(query: string, params: any[]): string[] {
  const tables = ["Tel1", "Tel2", "Tel3", "Tel4"];
  const results: string[] = [];
  for (const table of tables) {
    const rows = searchDb.query(`SELECT * FROM ${table} WHERE ${query}`, params);
    for (const row of rows) {
      results.push(formatResult(row));
    }
  }
  return results;
}

function searchNumber(phoneNumber: string): string[] {
  let possibleNumbers = [encode(phoneNumber)];
  if (phoneNumber.startsWith("993")) {
    possibleNumbers.push(encode(phoneNumber.slice(3)));
  } else if (phoneNumber.length <= 9) {
    possibleNumbers.push(encode("993" + phoneNumber));
  }
  const results: string[] = [];
  for (const encrypted of possibleNumbers) {
    const r = searchData("Col001 = ?", [encrypted]);
    results.push(...r);
  }
  return results;
}

function searchName(name: string): string[] {
  return searchData("Col002 LIKE ?", [`%${encode(name)}%`]);
}

function searchAddress(address: string): string[] {
  return searchData("Col003 LIKE ?", [`%${encode(address)}%`]);
}

function searchPassport(passport: string): string[] {
  return searchData("Col004 LIKE ?", [`%${encode(passport)}%`]);
}

function formatResult(row: any[]): string {
  return (
    `📱 <b>Nomeri:</b>\n<code>${decode(row[1])}</code>\n\n` +
    `👤 <b>Ady:</b>\n<code>${decode(row[2])}</code>\n\n` +
    `🏠 <b>Adresi:</b>\n<code>${decode(row[3])}</code>\n\n` +
    `📗 <b>Passport:</b>\n<code>${decode(row[4])}</code>\n\n` +
    `🗓 <b>Doglan ýeri we senesi:</b>\n<code>${decode(row[5])}</code>\n\n` +
    `🆔 <b>SIM ID:</b>\n<code>${decode(row[6])}</code>`
  );
}

// Menus
function searchMenu() {
  return {
    inline_keyboard: [
      [{ text: "📞 Nomury boýunça gözläň", callback_data: "search_number" }],
      [{ text: "👤 Ady boýunça gözläň", callback_data: "search_name" }],
      [{ text: "📜 Passporty boýunça gözläň", callback_data: "search_passport" }],
      [{ text: "🏠 Adres boýunça gözläň", callback_data: "search_address" }],
      [{ text: "🔙 Yza dolan", callback_data: "start" }],
    ]
  };
}

function paymentMenu() {
  return {
    inline_keyboard: [
      [
        { text: "💳 Payeer", callback_data: "pay_payeer" },
        { text: "💳 YooMoney", callback_data: "pay_yoomoney" }
      ],
      [
        { text: "💳 Binance", callback_data: "pay_binance" },
        { text: "📱 TMCELL", callback_data: "pay_tmcell" }
      ],
      [{ text: "🔙 Yza dolan", callback_data: "start" }],
    ]
  };
}

function backToAmanoff() {
  return {
    inline_keyboard: [
      [{ text: "🔙 Yza dolan", callback_data: "start" }]
    ]
  };
}

function howToMenu() {
  return {
    inline_keyboard: [
      [{ text: "📩 Kömek alyň", url: "https://t.me/TMCELL_ADMIN" }],
      [{ text: "🔙 Yza dolan", callback_data: "start" }],
    ]
  };
}

function muhaMenu() {
  return {
    inline_keyboard: [
      [{ text: "🔁 Täze gözlege başla", callback_data: "search" }],
      [{ text: "🔙 Esasy menýu dolan", callback_data: "start" }],
    ]
  };
}

function shopMenu() {
  return {
    inline_keyboard: [
      [{ text: "👤 Admin", url: "https://t.me/TMCELL_ADMIN" }],
      [{ text: "🔙 Yza dolan", callback_data: "buy_bal" }],
    ]
  };
}

function mainMenu() {
  return {
    inline_keyboard: [
      [{ text: "👤 Hasabym", callback_data: "account" }],
      [
        { text: "🔍 Gözlemek", callback_data: "search" },
        { text: "🎟 Promokod", callback_data: "promo" }
      ],
      [
        { text: "⚙️ Nähili işleýär", callback_data: "how_it_works" },
        { text: "💰 Bal satyn almak", callback_data: "buy_bal" }
      ],
      [{ text: "📢 Kanala goşul", url: "https://t.me/TKM_TMCELL_CHANNEL" }],
      [{ text: "💬 Çada goşul", url: "https://t.me/Tmcell_Group_Chat" }],
    ]
  };
}

// States
const userStates: Record<string, { action: string; params?: any }> = {};

// Telegram helpers
async function sendMessage(chatId: string, text: string, options: any = {}): Promise<number | null> {
  try {
    const body = { chat_id: chatId, text, parse_mode: "HTML", ...options };
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

async function answerCallbackQuery(id: string, text = "", showAlert = false) {
  try {
    await fetch(`${API}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: id, text, show_alert: showAlert }),
    });
  } catch (e) {
    console.error("answerCallbackQuery failed", e);
  }
}

// Handle start
async function handleStart(userId: string, username: string | undefined, fullName: string, referrerId: string | null, chatId: string) {
  await registerUser(userId, username, fullName, referrerId);
  const text = "<b>Salam! TMCELL BOT-a hoş geldiňiz!</b>\n\n<b>TMCELL</b> tarapyndan üpjün edilen giňişleýin maglumat bazamyz bilen, islendik nomer hakda maglumatlary aňsatlyk bilen görüp bilersiňiz.\n\n<b>Ilkinji synanyşyk mugt!</b> Başlangyç üçin ýörite hödürlenýän mugt gözlegimiz bilen botumyzy barlap bilersiňiz. Has köp gözlemek isleseňiz, ballarymyzyň birini saýlap, satyn alyp bilersiňiz.\n\n<b>Dostlaryňyzy çagyryň we bal gazanyň!</b> Çagyrýan her bir dostuňyz üçin, gözleg etmek üçin 1 bal gazanyň.\n\n<b>Başlamak üçin aşakdaky wariantlardan birini saýlaň:</b>";
  await sendMessage(chatId, text, { reply_markup: mainMenu() });
}

// Process promo
async function processPromoCode(userId: string, promoCode: string, chatId: string) {
  const promo = await getPromo(promoCode);
  if (promo && promo.current_usage < promo.max_usage) {
    const usedByList = promo.used_by ? promo.used_by.split(",") : [];
    if (usedByList.includes(userId)) {
      await sendMessage(chatId, "❌ <b>Bu promokody eýýäm ulandyňyz!</b>");
      return;
    }
    await updateUser(userId, { balance: promo.value });
    promo.current_usage += 1;
    promo.used_by = [...usedByList, userId].join(",");
    await updatePromo(promo);
    await sendMessage(chatId, `✅ Üstünlikli! Size ${promo.value} bal goşuldy.`);
  } else {
    await sendMessage(chatId, "❌ <b>Promokod dynny ýa-da ýalňyş!</b>");
  }
}

// Process search
async function processSearch(userId: string, text: string, searchFunc: (q: string) => string[], chatId: string) {
  const currentBalance = await getBalance(userId);
  if (currentBalance <= 0) {
    await sendMessage(chatId, "❌ <b>Balyňyz ýeterlik däl. Has köp bal satyn almaly.</b>");
    return;
  }
  const results = searchFunc(text);
  if (results.length > 0) {
    await updateUser(userId, { balance: -1 });
    for (const result of results) {
      await sendMessage(chatId, result);
    }
    await sendMessage(chatId, "✅ Gözleg üstünlikli boldy! Indi näme etmek isleýärsiňiz?", { reply_markup: muhaMenu() });
  } else {
    await sendMessage(chatId, "⚠️Netije tapylmady! Gözlegiňiz ýalňyş bolup biler.", { reply_markup: backToAmanoff() });
  }
}

// Handle payment
async function handlePayment(callbackData: string, userId: string, chatId: string) {
  const userBalance = await getBalance(userId);
  let text = "";
  if (callbackData === "pay_payeer") {
    text = `🔹 Töleg ulgamy - Payeer 🔹\nHäzirki Balyňyz: ${userBalance}\n\n` +
           "```Ballar:\n10 bal = 103.50 Rubl\n50 bal = 310.50 Rubl\n100 bal = 517.50 Rubl```\n\n" +
           "Satyn almak üçin administrator bilen habarlaşyň.\n";
  } else if (callbackData === "pay_yoomoney") {
    text = `🔹 Töleg ulgamy - YooMoney 🔹\nHäzirki Balyňyz: ${userBalance}\n\n` +
           "```Ballar:\n10 bal = 90 Rubl\n50 bal = 270 Rubl\n100 bal = 450 Rubl```\n\n" +
           "Satyn almak üçin administrator bilen habarlaşyň.\n";
  } else if (callbackData === "pay_binance") {
    text = `🔹 Töleg ulgamy - Binance 🔹\nHäzirki Balyňyz: ${userBalance}\n\n` +
           "```Ballar:\n10 bal = 1 USD\n50 bal = 3 USD\n100 bal = 5 USD```\n\n" +
           "Satyn almak üçin administrator bilen habarlaşyň.\n";
  } else if (callbackData === "pay_tmcell") {
    text = `🔹 Töleg ulgamy - TMCELL 🔹\nHäzirki Balyňyz: ${userBalance}\n\n` +
           "```Ballar:\n10 bal = 23 TMT\n50 bal = 69 TMT\n100 bal = 115 TMT```\n\n" +
           "Satyn almak üçin administrator bilen habarlaşyň.";
  }
  await sendMessage(chatId, text, { reply_markup: shopMenu(), parse_mode: "Markdown" });
}

// Handle account
async function handleAccount(userId: string, username: string | undefined, fullName: string, chatId: string) {
  const balance = await getBalance(userId);
  const referrals = await getReferrals(userId);
  const text = `🔹 <b>Ulanyjy maglumatlary</b> 🔹\n\n` +
               `<b>ID:</b> <code>${userId}</code>\n` +
               `<b>Ulanyjy ady:</b> <code>@${username || ''}</code>\n` +
               `<b>Ady:</b> <code>${fullName}</code>\n` +
               `<b>Bot-my?:</b> <code>Ýok</code>\n` +
               `<b>Bal(lar):</b> <code>${balance}</code>\n\n` +
               `<b>Referal sanyňyz:</b> <code>${referrals}</code>\n` +
               `<b>Referal adresiňiz:</b> <code>https://t.me/${botUsername}?start=${userId}</code>`;
  await sendMessage(chatId, text, { reply_markup: backToAmanoff() });
}

// Handle how it works
async function handleHowItWorks(chatId: string) {
  const text = "Gözläp başlamak üçin gözlemek düwmesine basyň.\nBirnäçe gözleg wariantyndan saýlap bilersiňiz we girişiňize laýyk gelýän ähli netijeler sanawda görkeziler.\n«👤 Hasabym» düwmesine basyp hasabyňyz barada ähli maglumatlary görüp bilersiňiz.\nIslendik mesele üçin kömek alyň düwmesine basyň we admin bilen habarlaşyň.";
  await sendMessage(chatId, text, { reply_markup: howToMenu() });
}

// Admin commands
async function handleBal(commandParams: string[], fromId: string, chatId: string) {
  if (fromId !== ADMIN_USER_ID) {
    await sendMessage(chatId, "Işledip nm etjek.");
    return;
  }
  if (commandParams.length !== 3) {
    await sendMessage(chatId, "Şeýle ýazt: /bal <user_id> <amount>");
    return;
  }
  const targetUserId = commandParams[1];
  const amount = parseInt(commandParams[2]);
  if (isNaN(amount)) {
    await sendMessage(chatId, "Ýalňyş ýazdyň. Ine dogrysy: /bal <user_id> <amount>");
    return;
  }
  await updateUser(targetUserId, { balance: amount });
  await sendMessage(chatId, `✅ ${amount} ullanyja ${targetUserId} bal berildi.`);
}

async function handleCreatePromo(commandParams: string[], fromId: string, chatId: string) {
  if (fromId !== ADMIN_USER_ID) {
    await sendMessage(chatId, "Ìşledip nm etjek.");
    return;
  }
  if (commandParams.length !== 4) {
    await sendMessage(chatId, "Şeýle ýazmalyt: /create_promo <promokod> <bal> <näçe adam>");
    return;
  }
  const promoCode = commandParams[1];
  const value = parseInt(commandParams[2]);
  const maxUsage = parseInt(commandParams[3]);
  if (isNaN(value) || isNaN(maxUsage)) {
    await sendMessage(chatId, "Ýalňyş ýazdyň. Ine dogrysy: /create_promo <promokod> <bal> <näçe adam>");
    return;
  }
  await createPromo(promoCode, value, maxUsage, chatId);
}

// Handle setfile
async function handleSetFile(fromId: string, chatId: string) {
  if (fromId !== ADMIN_USER_ID) {
    await sendMessage(chatId, "Unauthorized.");
    return;
  }
  await sendMessage(chatId, "Send me the new SQLite file.");
  userStates[fromId] = { action: "waiting_sqlite" };
}

// Process file upload
async function processFileUpload(fromId: string, document: any, chatId: string) {
  if (fromId !== ADMIN_USER_ID || !userStates[fromId] || userStates[fromId].action !== "waiting_sqlite") {
    return;
  }
  const fileName = document.file_name;
  if (!fileName.endsWith(".sqlite")) {
    await sendMessage(chatId, "This is not a .sqlite file.");
    return;
  }
  try {
    const fileId = document.file_id;
    const fileRes = await (await fetch(`${API}/getFile?file_id=${fileId}`)).json();
    const filePath = fileRes.result.file_path;
    const fileUrl = `https://api.telegram.org/file/bot${TOKEN}/${filePath}`;
    const fileData = await (await fetch(fileUrl)).arrayBuffer();
    searchDb.close();
    await Deno.writeFile(SEARCH_DB_PATH, new Uint8Array(fileData));
    searchDb = new DB(SEARCH_DB_PATH);
    delete userStates[fromId];
    await sendMessage(chatId, "✅ Search DB successfully updated!");
  } catch (e) {
    console.error("File upload error:", e);
    await sendMessage(chatId, "Error updating DB.");
    searchDb = new DB(SEARCH_DB_PATH); // Reopen old DB if failed
  }
}

// Callback handler
async function handleCallbackQuery(callbackQuery: any) {
  const { from, message, data, id } = callbackQuery;
  const userId = from.id.toString();
  const chatId = message.chat.id.toString();
  const username = from.username;
  const fullName = from.first_name || username || userId;

  if (data === "start") {
    await handleStart(userId, username, fullName, null, chatId);
  } else if (data === "buy_bal") {
    await sendMessage(chatId, "💱 <b>Töleg ulgamyny saýlaň:</b>", { reply_markup: paymentMenu() });
  } else if (["pay_payeer", "pay_yoomoney", "pay_binance", "pay_tmcell"].includes(data)) {
    await handlePayment(data, userId, chatId);
  } else if (data === "account") {
    await handleAccount(userId, username, fullName, chatId);
  } else if (data === "how_it_works") {
    await handleHowItWorks(chatId);
  } else if (data === "promo") {
    await sendMessage(chatId, "💡 <b>Promokod giriziň:</b>", { reply_markup: backToAmanoff() });
    userStates[userId] = { action: "process_promo" };
  } else if (data === "search") {
    await sendMessage(chatId, "🔍 Gözleg üçin haýsy maglumatlary ulanmak isleýärsiňiz?", { reply_markup: searchMenu() });
  } else if (data === "search_number") {
    await sendMessage(chatId, "<b>Nomer saýlandy</b>.\n\n<b>Üns bilen okaň‼</b>\nNomeri +99361xxxxxx, 99361xxxxxx ýada 61xxxxxx görnüşinde ýazyň! 71-den başlaýan nomerlar kabul edilýär.\n\nNomer iberiň:");
    userStates[userId] = { action: "process_search", params: searchNumber };
  } else if (data === "search_name") {
    await sendMessage(chatId, "<b>Ady giriziň:</b>");
    userStates[userId] = { action: "process_search", params: searchName };
  } else if (data === "search_passport") {
    await sendMessage(chatId, "<b>Passport nomerini giriziň:</b>");
    userStates[userId] = { action: "process_search", params: searchPassport };
  } else if (data === "search_address") {
    await sendMessage(chatId, "<b>Adres giriziň:</b>");
    userStates[userId] = { action: "process_search", params: searchAddress };
  }
  await answerCallbackQuery(id);
}

// Message handler
async function handleMessage(message: any) {
  const { from, chat, text, document } = message;
  const userId = from.id.toString();
  const chatId = chat.id.toString();
  const username = from.username;
  const fullName = from.first_name || username || userId;

  if (document) {
    await processFileUpload(userId, document, chatId);
    return;
  }

  if (!text) return;

  if (userStates[userId]) {
    const state = userStates[userId];
    if (state.action === "process_promo") {
      await processPromoCode(userId, text.trim(), chatId);
    } else if (state.action === "process_search") {
      const searchFunc = state.params as (q: string) => string[];
      await processSearch(userId, text, searchFunc, chatId);
    }
    delete userStates[userId];
    return;
  }

  const parts = text.trim().split(/\s+/);
  const cmd = parts[0].startsWith("/") ? parts[0].slice(1) : "";
  if (cmd) {
    if (cmd === "start") {
      const referrerId = parts.length > 1 ? parts[1] : null;
      await handleStart(userId, username, fullName, referrerId, chatId);
    } else if (cmd === "bal") {
      await handleBal(parts, userId, chatId);
    } else if (cmd === "create_promo") {
      await handleCreatePromo(parts, userId, chatId);
    } else if (cmd === "setfile") {
      await handleSetFile(userId, chatId);
    }
  }
}

// Server
serve(async (req: Request) => {
  try {
    const url = new URL(req.url);
    if (url.pathname !== SECRET_PATH) return new Response("Not found", { status: 404 });
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

    const update = await req.json();
    if (update.message) {
      await handleMessage(update.message);
    } else if (update.callback_query) {
      await handleCallbackQuery(update.callback_query);
    }

    return new Response("OK");
  } catch (e) {
    console.error("server error", e);
    return new Response("Error", { status: 500 });
  }
});
