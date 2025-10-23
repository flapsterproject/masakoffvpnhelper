// main.ts
// Telegram TMCELL Search Bot (Deno)
// Features: Search in SQLite DB, user balances, referrals, promo codes, admin commands
// Admin can change search SQLite file via /setfile

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";


const TOKEN = Deno.env.get("BOT_TOKEN");
const API = `https://api.telegram.org/bot${TOKEN}`;
const SECRET_PATH = "/masakoffvpnhelper"; // Make sure this matches your webhook URL
const SEARCH_DB_PATH = "VL2025.sqlite";
const USER_DB_PATH = "users.db";
const ADMIN_USER_ID = "7171269159";

let searchDb: DB;
let userDb: DB;

try {
  searchDb = new DB(SEARCH_DB_PATH);
  userDb = new DB(USER_DB_PATH);
} catch (e) {
  console.error("Failed to open databases:", e);
  Deno.exit(1);
}

// Create tables in user DB
userDb.query(`
  CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    username TEXT,
    full_name TEXT,
    balance INTEGER DEFAULT 0,
    referrals INTEGER DEFAULT 0
  )
`);
userDb.query(`
  CREATE TABLE IF NOT EXISTS promo_codes (
    code TEXT PRIMARY KEY,
    value INTEGER,
    max_usage INTEGER,
    current_usage INTEGER,
    used_by TEXT DEFAULT ''
  )
`);

// Symbols for encoding
const ENCODE_CHARS = "1234567890-=\\\\@$^&()+| ;'',./{}:\"<>abcdefghijklmnopqrstuvwxyzабвгдеёжзийклмнопрстуфхцчшщъыьэюяABCDEFGHIJKLMNOPQRSTUVWXYZАБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ";
const DECODE_CHARS = ")|;/4&.$2:''=,+^>9-0<3178(@\"{ 65}\\\\rёмlйnfфvчежbыoитлрhюузбmцxоkiдdьgwхщzэqпtpuвaшъeyяcгаjнсsкRЁМLЙNFФVЧЕЖBЫOИТЛРHЮУЗБMЦXОKIДDЬGWХЩZЭQПTPUВAШЪEYЯCГАJНСSК";

// Encoding functions
function encode(text: string): string {
  return [...text].map(c => ENCODE_CHARS.includes(c) ? DECODE_CHARS[ENCODE_CHARS.indexOf(c)] : c).join('');
}

function decode(text: string): string {
  return [...text].map(c => DECODE_CHARS.includes(c) ? ENCODE_CHARS[DECODE_CHARS.indexOf(c)] : c).join('');
}

// User functions
function registerUser(userId: string, username: string | undefined, fullName: string, referrerId: string | null = null) {
  const existing = userDb.query("SELECT * FROM users WHERE user_id = ?", [userId]);
  if (existing.length === 0) {
    userDb.query("INSERT INTO users (user_id, username, full_name, balance) VALUES (?, ?, ?, ?)", [userId, username || null, fullName, 1]);
    if (referrerId) {
      userDb.query("UPDATE users SET balance = balance + 1, referrals = referrals + 1 WHERE user_id = ?", [referrerId]);
    }
  }
}

function getBalance(userId: string): number {
  const res = userDb.query("SELECT balance FROM users WHERE user_id = ?", [userId]);
  return res.length > 0 ? res[0][0] as number : 0;
}

function getReferrals(userId: string): number {
  const res = userDb.query("SELECT referrals FROM users WHERE user_id = ?", [userId]);
  return res.length > 0 ? res[0][0] as number : 0;
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

// Keyboard menus
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

// States for next step handlers
const userStates: Map<string, { action: string, params?: any[] }> = new Map();

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
  registerUser(userId, username, fullName, referrerId);
  const text = "<b>Salam! TMCELL BOT-a hoş geldiňiz!</b>\n\n<b>TMCELL</b> tarapyndan üpjün edilen giňişleýin maglumat bazamyz bilen, islendik nomer hakda maglumatlary aňsatlyk bilen görüp bilersiňiz.\n\n<b>Ilkinji synanyşyk mugt!</b> Başlangyç üçin ýörite hödürlenýän mugt gözlegimiz bilen botumyzy barlap bilersiňiz. Has köp gözlemek isleseňiz, ballarymyzyň birini saýlap, satyn alyp bilersiňiz.\n\n<b>Dostlaryňyzy çagyryň we bal gazanyň!</b> Çagyrýan her bir dostuňyz üçin, gözleg etmek üçin 1 bal gazanyň.\n\n<b>Başlamak üçin aşakdaky wariantlardan birini saýlaň:</b>";
  await sendMessage(chatId, text, { reply_markup: mainMenu() });
}

// Process promo
async function processPromoCode(userId: string, promoCode: string, chatId: string) {
  const promoRes = userDb.query("SELECT * FROM promo_codes WHERE code = ? AND current_usage < max_usage", [promoCode]);
  if (promoRes.length > 0) {
    const promo = promoRes[0];
    const usedBy = promo[4] as string;
    if (usedBy.split(",").includes(userId)) {
      await sendMessage(chatId, "❌ <b>Bu promokody eýýäm ulandyňyz!</b>");
      return;
    }
    const value = promo[1] as number;
    userDb.query("UPDATE users SET balance = balance + ? WHERE user_id = ?", [value, userId]);
    userDb.query("UPDATE promo_codes SET current_usage = current_usage + 1 WHERE code = ?", [promoCode]);
    const newUsedBy = usedBy ? `${usedBy},${userId}` : userId;
    userDb.query("UPDATE promo_codes SET used_by = ? WHERE code = ?", [newUsedBy, promoCode]);
    await sendMessage(chatId, `✅ Üstünlikli! Size ${value} bal goşuldy.`);
  } else {
    await sendMessage(chatId, "❌ <b>Promokod dynny ýa-da ýalňyş!</b>");
  }
}

// Process search
async function processSearch(userId: string, text: string, searchFunc: (q: string) => string[], chatId: string) {
  const currentBalance = getBalance(userId);
  if (currentBalance <= 0) {
    await sendMessage(chatId, "❌ <b>Balyňyz ýeterlik däl. Has köp bal satyn almaly.</b>");
    return;
  }
  const results = searchFunc(text);
  if (results.length > 0) {
    const newBalance = currentBalance - 1;
    userDb.query("UPDATE users SET balance = ? WHERE user_id = ?", [newBalance, userId]);
    for (const result of results) {
      await sendMessage(chatId, result);
    }
    await sendMessage(chatId, "✅ Gözleg üstünlikli boldy! Indi näme etmek isleýärsiňiz?", { reply_markup: muhaMenu() });
  } else {
    await sendMessage(chatId, "⚠️Netije tapylmady! Gözlegiňiz ýalňyş bolup biler.", { reply_markup: backToAmanoff() });
  }
}

// Handle payment callbacks
async function handlePayment(callbackData: string, userId: string, chatId: string) {
  const userBalance = getBalance(userId);
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
  const balance = getBalance(userId);
  const referrals = getReferrals(userId);
  const botUsername = (await (await fetch(`${API}/getMe`)).json()).result.username;
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
  const userId = commandParams[1];
  const amount = parseInt(commandParams[2]);
  if (isNaN(amount)) {
    await sendMessage(chatId, "Ýalňyş ýazdyň. Ine dogrysy: /bal <user_id> <amount>");
    return;
  }
  userDb.query("UPDATE users SET balance = balance + ? WHERE user_id = ?", [amount, userId]);
  await sendMessage(chatId, `✅ ${amount} ullanyja ${userId} bal berildi.`);
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
  const existing = userDb.query("SELECT * FROM promo_codes WHERE code = ?", [promoCode]);
  if (existing.length > 0) {
    await sendMessage(chatId, "Bu promokod öňem bar.");
    return;
  }
  userDb.query("INSERT INTO promo_codes (code, value, max_usage, current_usage) VALUES (?, ?, ?, ?)", [promoCode, value, maxUsage, 0]);
  await sendMessage(chatId, `✅ Promokod <code>${promoCode}</code> üstünlikli ýasaldy we ol ${value} bal berer. Maksimum ulanylyş sany: ${maxUsage}.`);
}

// Handle setfile
async function handleSetFile(fromId: string, chatId: string) {
  if (fromId !== ADMIN_USER_ID) {
    await sendMessage(chatId, "Unauthorized.");
    return;
  }
  await sendMessage(chatId, "Send me the new SQLite file.");
  userStates.set(fromId, { action: "waiting_sqlite" });
}

// Process uploaded file
async function processFileUpload(fromId: string, document: any, chatId: string) {
  if (fromId !== ADMIN_USER_ID || !userStates.has(fromId) || userStates.get(fromId)!.action !== "waiting_sqlite") {
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
    userStates.delete(fromId);
    await sendMessage(chatId, "✅ Search DB successfully updated!");
  } catch (e) {
    console.error("File upload error:", e);
    await sendMessage(chatId, "Error updating DB.");
    searchDb = new DB(SEARCH_DB_PATH); // Reopen old if failed
  }
}

// Callback handler
async function handleCallbackQuery(callbackQuery: any) {
  const { from, message, data, id } = callbackQuery;
  const userId = String(from.id);
  const chatId = String(message.chat.id);

  if (data === "start") {
    await handleStart(userId, from.username, from.first_name || "", null, chatId);
  } else if (data === "buy_bal") {
    await sendMessage(chatId, "💱 <b>Töleg ulgamyny saýlaň:</b>", { reply_markup: paymentMenu() });
  } else if (["pay_payeer", "pay_yoomoney", "pay_binance", "pay_tmcell"].includes(data)) {
    await handlePayment(data, userId, chatId);
  } else if (data === "account") {
    await handleAccount(userId, from.username, from.first_name || "", chatId);
  } else if (data === "how_it_works") {
    await handleHowItWorks(chatId);
  } else if (data === "promo") {
    await sendMessage(chatId, "💡 <b>Promokod giriziň:</b>", { reply_markup: backToAmanoff() });
    userStates.set(userId, { action: "process_promo" });
  } else if (data === "search") {
    await sendMessage(chatId, "🔍 Gözleg üçin haýsy maglumatlary ulanmak isleýärsiňiz?", { reply_markup: searchMenu() });
  } else if (data === "search_number") {
    await sendMessage(chatId, "<b>Nomer saýlandy</b>.\n\n<b>Üns bilen okaň‼</b>\nNomeri +99361xxxxxx, 99361xxxxxx ýada 61xxxxxx görnüşinde ýazyň! 71-den başlaýan nomerlar kabul edilýär.\n\nNomer iberiň:");
    userStates.set(userId, { action: "process_search", params: [searchNumber] });
  } else if (data === "search_name") {
    await sendMessage(chatId, "<b>Ady giriziň:</b>");
    userStates.set(userId, { action: "process_search", params: [searchName] });
  } else if (data === "search_passport") {
    await sendMessage(chatId, "<b>Passport nomerini giriziň:</b>");
    userStates.set(userId, { action: "process_search", params: [searchPassport] });
  } else if (data === "search_address") {
    await sendMessage(chatId, "<b>Adres giriziň:</b>");
    userStates.set(userId, { action: "process_search", params: [searchAddress] });
  }
  await answerCallbackQuery(id);
}

// Message handler
async function handleMessage(message: any) {
  const { from, chat, text, document } = message;
  const userId = String(from.id);
  const chatId = String(chat.id);
  const username = from.username;
  const fullName = from.first_name || username || userId;

  if (document) {
    await processFileUpload(userId, document, chatId);
    return;
  }

  if (!text) return;

  if (userStates.has(userId)) {
    const state = userStates.get(userId)!;
    if (state.action === "process_promo") {
      await processPromoCode(userId, text.trim(), chatId);
    } else if (state.action === "process_search") {
      const searchFunc = state.params![0] as (q: string) => string[];
      await processSearch(userId, text, searchFunc, chatId);
    }
    userStates.delete(userId);
    return;
  }

  const command = text.trim().split(" ");
  if (command[0].startsWith("/")) {
    const cmd = command[0].slice(1);
    if (cmd === "start") {
      const referrerId = command[1] ? command[1] : null;
      await handleStart(userId, username, fullName, referrerId, chatId);
    } else if (cmd === "bal") {
      await handleBal(command, userId, chatId);
    } else if (cmd === "create_promo") {
      await handleCreatePromo(command, userId, chatId);
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

