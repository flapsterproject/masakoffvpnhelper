// main.ts
// Convix Ads Bot (Deno) - Smart Growth & Monetization for Telegram Channels
// Features: Main menu with inline buttons, grow channel, earn from channel, AI ad generator,
// my account, support, admin panel (hidden), referral system, currency (Convix Credits - CX)
// Multi-language support (English, Russian, Turkmen) - defaults to English
// Anti-fake detection (simulated), auto-notifications (simulated)
// Uses Deno KV for storage, webhook setup
//
// Notes: Requires BOT_TOKEN env var and Deno KV. Deploy as webhook at SECRET_PATH.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const TOKEN = Deno.env.get("BOT_TOKEN")!;
if (!TOKEN) throw new Error("BOT_TOKEN env var is required");
const API = `https://api.telegram.org/bot${TOKEN}`;
const SECRET_PATH = "/masakoffvpnhelper"; // make sure webhook path matches
const BOT_USERNAME = "MasakoffVpnHelperBot"; // Adjust to your bot's username

// Deno KV
const kv = await Deno.openKv();

const ADMIN_USERNAME = "Masakoff"; // without @, replace with actual

// Languages
const LANGUAGES = ["en", "ru", "tk"] as const;
type Language = typeof LANGUAGES[number];

// runtime storages (temporary, for quick access)
const searchTimeouts: Record<string, number> = {};

// State helpers using KV
async function getUserState(userId: string): Promise<{ step: string; data?: any } | null> {
  const res = await kv.get<{ step: string; data?: any }>(["states", "user", userId]);
  return res.value;
}

async function setUserState(userId: string, state: { step: string; data?: any } | null) {
  if (state) {
    await kv.set(["states", "user", userId], state);
  } else {
    await kv.delete(["states", "user", userId]);
  }
}

// -------------------- Telegram helpers --------------------
async function sendMessage(chatId: string | number, text: string, options: any = {}): Promise<number | null> {
  try {
    const body: any = { chat_id: chatId, text, ...options };
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

async function editMessageText(chatId: string | number, messageId: number, text: string, options: any = {}) {
  try {
    const body = { chat_id: chatId, message_id: messageId, text, ...options };
    await fetch(`${API}/editMessageText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    console.warn("editMessageText failed", e?.message ?? e);
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
    console.warn("answerCallbackQuery failed", e?.message ?? e);
  }
}

// -------------------- Profile helpers --------------------
type Profile = {
  id: string;
  username?: string;
  displayName: string;
  language: Language;
  balance: number; // CX credits
  earnings: number;
  channels: string[]; // connected channels
  campaigns: any[]; // active campaigns
  referrals: number;
  referralLink: string;
  lastActive: number;
};

function getDisplayName(p: Profile) {
  if (p.username) return `@${p.username}`;
  return p.displayName && p.displayName !== "" ? p.displayName : `ID:${p.id}`;
}

async function initProfile(userId: string, username?: string, displayName?: string, language: Language = "en"): Promise<{ profile: Profile; isNew: boolean }> {
  const key = ["profiles", userId];
  const res = await kv.get(key);
  if (!res.value) {
    const referralLink = `https://t.me/${BOT_USERNAME}?start=ref_${userId}`;
    const profile: Profile = {
      id: userId,
      username,
      displayName: displayName || `ID:${userId}`,
      language,
      balance: 0,
      earnings: 0,
      channels: [],
      campaigns: [],
      referrals: 0,
      referralLink,
      lastActive: Date.now(),
    };
    await kv.set(key, profile);
    return { profile, isNew: true };
  } else {
    const existing = res.value as Profile;
    let changed = false;
    if (username && username !== existing.username) {
      existing.username = username;
      changed = true;
    }
    if (displayName && displayName !== existing.displayName) {
      existing.displayName = displayName;
      changed = true;
    }
    existing.lastActive = Date.now();
    await kv.set(key, existing);
    return { profile: existing, isNew: false };
  }
}

async function getProfile(userId: string): Promise<Profile | null> {
  const res = await kv.get(["profiles", userId]);
  return (res.value as Profile) ?? null;
}

async function updateProfile(userId: string, delta: Partial<Profile>) {
  const existing = (await getProfile(userId)) || (await initProfile(userId)).profile;
  const newProfile: Profile = {
    ...existing,
    ...delta,
    balance: Math.max(0, (existing.balance || 0) + (delta.balance ?? 0)),
    earnings: Math.max(0, (existing.earnings || 0) + (delta.earnings ?? 0)),
    referrals: (existing.referrals || 0) + (delta.referrals ?? 0),
    lastActive: Date.now(),
  };
  await kv.set(["profiles", userId], newProfile);
  return newProfile;
}

// -------------------- Translation helper --------------------
function t(lang: Language, key: string): string {
  const translations: Record<string, Record<Language, string>> = {
    welcome: { en: "Welcome to Convix Ads! 🚀\nYour intelligent tool for growing and monetizing Telegram channels.\nSelect an option below 👇", ru: "Добро пожаловать в Convix Ads! 🚀\nВаш умный инструмент для роста и монетизации Telegram-каналов.\nВыберите опцию ниже 👇", tk: "Convix Ads-a hoş geldiňiz! 🚀\nTelegram kanallaryny ösdürmek we pul gazanmak üçin akylly guram.\nAşakdaky saýlawyň birini saýlaň 👇" },
    // Add more translations as needed
    back: { en: "🔙 Back to Main", ru: "🔙 Назад в главное", tk: "🔙 Esasy menýu" },
    // ... etc for all texts
  };
  return translations[key]?.[lang] || key;
}

// -------------------- Menu helpers --------------------
function getMainMenu(lang: Language): any {
  return {
    inline_keyboard: [
      [{ text: "📈 Grow My Channel", callback_data: "menu:grow" }],
      [{ text: "💰 Earn From My Channel", callback_data: "menu:earn" }],
      [{ text: "👤 My Account", callback_data: "menu:account" }],
      [{ text: "🧠 AI Ad Generator", callback_data: "menu:ai" }],
      [{ text: "💬 Support", callback_data: "menu:support" }],
    ]
  };
}

function getGrowMenu(lang: Language): any {
  return {
    inline_keyboard: [
      [{ text: "➕ Add Channel", callback_data: "grow:add_channel" }],
      [{ text: "💵 Deposit Balance", callback_data: "grow:deposit" }],
      [{ text: "🎯 Create Promotion", callback_data: "grow:create_promo" }],
      [{ text: "📊 My Campaigns", callback_data: "grow:campaigns" }],
      [{ text: "🧮 Pricing Info", callback_data: "grow:pricing" }],
      [{ text: t(lang, "back"), callback_data: "menu:main" }],
    ]
  };
}

function getEarnMenu(lang: Language): any {
  return {
    inline_keyboard: [
      [{ text: "➕ Connect My Channel", callback_data: "earn:connect" }],
      [{ text: "💸 Withdraw Earnings", callback_data: "earn:withdraw" }],
      [{ text: "📅 Earnings History", callback_data: "earn:history" }],
      [{ text: "⚙️ Ad Settings", callback_data: "earn:settings" }],
      [{ text: t(lang, "back"), callback_data: "menu:main" }],
    ]
  };
}

function getAccountMenu(lang: Language): any {
  return {
    inline_keyboard: [
      [{ text: "💰 My Balance", callback_data: "account:balance" }],
      [{ text: "🎯 Active Campaigns", callback_data: "account:campaigns" }],
      [{ text: "📊 Channel Stats", callback_data: "account:stats" }],
      [{ text: "👥 Referrals", callback_data: "account:referrals" }],
      [{ text: "⚙️ Settings", callback_data: "account:settings" }],
      [{ text: t(lang, "back"), callback_data: "menu:main" }],
    ]
  };
}

function getAIMenu(lang: Language): any {
  return {
    inline_keyboard: [
      [{ text: "📝 Generate Ad Post", callback_data: "ai:generate" }],
      [{ text: "✏️ Rewrite Existing Post", callback_data: "ai:rewrite" }],
      [{ text: "🧩 Add Hashtags", callback_data: "ai:hashtags" }],
      [{ text: "💾 Save Template", callback_data: "ai:save" }],
      [{ text: t(lang, "back"), callback_data: "menu:main" }],
    ]
  };
}

function getSupportMenu(lang: Language): any {
  return {
    inline_keyboard: [
      [{ text: "📚 FAQ", callback_data: "support:faq" }],
      [{ text: "🧑‍💻 Contact Admin", callback_data: "support:contact" }],
      [{ text: "🏦 Payment & Payout Rules", callback_data: "support:rules" }],
      [{ text: "🔒 Privacy Policy", callback_data: "support:privacy" }],
      [{ text: t(lang, "back"), callback_data: "menu:main" }],
    ]
  };
}

function getAdminMenu(lang: Language): any {
  return {
    inline_keyboard: [
      [{ text: "🧾 Manage Channels", callback_data: "admin:channels" }],
      [{ text: "💰 Manage Balances", callback_data: "admin:balances" }],
      [{ text: "📤 Approve Payouts", callback_data: "admin:payouts" }],
      [{ text: "📢 Broadcast Message", callback_data: "admin:broadcast" }],
      [{ text: "🎁 Create Promo Code", callback_data: "admin:promo" }],
      [{ text: "🪙 Manage Coin Prices", callback_data: "admin:prices" }],
      [{ text: "📊 System Stats", callback_data: "admin:stats" }],
    ]
  };
}

// -------------------- Callback handler --------------------
async function handleCallback(cb: any) {
  const fromId = String(cb.from.id);
  const data = cb.data ?? null;
  const callbackId = cb.id;
  const username = cb.from.username;
  const lang = (await getProfile(fromId))?.language || "en";

  if (!data) {
    await answerCallbackQuery(callbackId);
    return;
  }

  if (data.startsWith("menu:")) {
    const menu = data.split(":")[1];
    let text: string;
    let keyboard: any;
    if (menu === "main") {
      text = t(lang, "welcome");
      keyboard = getMainMenu(lang);
    } else if (menu === "grow") {
      text = "Promote your channel to real users who are interested in your content.";
      keyboard = getGrowMenu(lang);
    } else if (menu === "earn") {
      text = "Monetize your channel by allowing Convix Ads to promote other channels automatically.";
      keyboard = getEarnMenu(lang);
    } else if (menu === "account") {
      text = "View your profile, balance, stats, and referral bonuses.";
      keyboard = getAccountMenu(lang);
    } else if (menu === "ai") {
      text = "Create professional, catchy ad posts in one click using AI.";
      keyboard = getAIMenu(lang);
    } else if (menu === "support") {
      text = "Support & Info";
      keyboard = getSupportMenu(lang);
    } else {
      await answerCallbackQuery(callbackId, "Unknown menu.");
      return;
    }
    const msgId = cb.message.message_id;
    await editMessageText(fromId, msgId, text, { reply_markup: keyboard });
    await answerCallbackQuery(callbackId);
    return;
  }

  // Handle sub-actions
  if (data.startsWith("grow:")) {
    const action = data.split(":")[1];
    // Implement actions like add_channel, deposit, etc.
    // For example, set state and prompt user
    if (action === "add_channel") {
      await setUserState(fromId, { step: "add_channel" });
      await sendMessage(fromId, "Please enter your channel username or ID to add.");
    } else if (action === "deposit") {
      await setUserState(fromId, { step: "deposit" });
      await sendMessage(fromId, "Enter amount to deposit (in CX).");
    } // ... add more
    await answerCallbackQuery(callbackId);
    return;
  }

  if (data.startsWith("earn:")) {
    const action = data.split(":")[1];
    if (action === "connect") {
      await setUserState(fromId, { step: "connect_channel" });
      await sendMessage(fromId, "Enter your channel to connect for earning.");
    } else if (action === "withdraw") {
      const profile = await getProfile(fromId);
      if (profile && profile.earnings >= 1) { // min withdrawal example
        await setUserState(fromId, { step: "withdraw" });
        await sendMessage(fromId, "Enter withdrawal amount.");
      } else {
        await answerCallbackQuery(callbackId, "Insufficient earnings.", true);
      }
    } // ... add more
    await answerCallbackQuery(callbackId);
    return;
  }

  if (data.startsWith("account:")) {
    const action = data.split(":")[1];
    const profile = await getProfile(fromId);
    if (!profile) {
      await answerCallbackQuery(callbackId, "Profile not found.", true);
      return;
    }
    if (action === "balance") {
      await sendMessage(fromId, `Your balance: ${profile.balance} CX`);
    } else if (action === "referrals") {
      await sendMessage(fromId, `Referrals: ${profile.referrals}\nLink: ${profile.referralLink}`);
    } // ... add more
    await answerCallbackQuery(callbackId);
    return;
  }

  if (data.startsWith("ai:")) {
    const action = data.split(":")[1];
    if (action === "generate") {
      await setUserState(fromId, { step: "ai_generate" });
      await sendMessage(fromId, "Describe the ad you want to generate.");
    } // ... add more (simulate AI with fixed output)
    await answerCallbackQuery(callbackId);
    return;
  }

  if (data.startsWith("support:")) {
    const action = data.split(":")[1];
    if (action === "faq") {
      await sendMessage(fromId, "FAQ: ..."); // Add content
    } // ... add more
    await answerCallbackQuery(callbackId);
    return;
  }

  if (data.startsWith("admin:")) {
    if (username !== ADMIN_USERNAME) {
      await answerCallbackQuery(callbackId, "Access denied.", true);
      return;
    }
    const action = data.split(":")[1];
    if (action === "stats") {
      // Implement stats
      let userCount = 0;
      for await (const _ of kv.list({ prefix: ["profiles"] })) userCount++;
      await sendMessage(fromId, `Users: ${userCount}`);
    } // ... add more admin actions
    await answerCallbackQuery(callbackId);
    return;
  }

  await answerCallbackQuery(callbackId);
}

// -------------------- Command handler --------------------
async function handleCommand(fromId: string, username: string | undefined, displayName: string, text: string, isNew: boolean, lang: Language) {
  if (text.startsWith("/start")) {
    let referrerId: string | undefined;
    const parts = text.split(" ");
    if (parts.length > 1 && parts[1].startsWith("ref_")) {
      referrerId = parts[1].slice(4);
    }
    if (referrerId && isNew && referrerId !== fromId) {
      const refProfile = await getProfile(referrerId);
      if (refProfile) {
        await updateProfile(referrerId, { balance: refProfile.balance + 0.1, referrals: 1 }); // 10% bonus example
        await sendMessage(referrerId, "New referral! +10% bonus.");
        await sendMessage(fromId, `Referred by ID:${referrerId}.`);
      }
    }
    const welcome = t(lang, "welcome");
    await sendMessage(fromId, welcome, { reply_markup: getMainMenu(lang) });
    return;
  }

  if (text.startsWith("/grow")) {
    await sendMessage(fromId, "Grow My Channel", { reply_markup: getGrowMenu(lang) });
    return;
  }

  if (text.startsWith("/earn")) {
    await sendMessage(fromId, "Earn From My Channel", { reply_markup: getEarnMenu(lang) });
    return;
  }

  if (text.startsWith("/balance")) {
    const profile = await getProfile(fromId);
    await sendMessage(fromId, `Balance: ${profile?.balance ?? 0} CX`);
    return;
  }

  if (text.startsWith("/withdraw")) {
    // Similar to earn:withdraw
    await sendMessage(fromId, "Enter withdrawal amount.");
    await setUserState(fromId, { step: "withdraw" });
    return;
  }

  if (text.startsWith("/help")) {
    await sendMessage(fromId, "Help: Use menus or commands like /grow, /earn.");
    return;
  }

  if (text.startsWith("/admin")) {
    if (username !== ADMIN_USERNAME) {
      await sendMessage(fromId, "Access denied.");
      return;
    }
    await sendMessage(fromId, "Admin Panel", { reply_markup: getAdminMenu(lang) });
    return;
  }

  await sendMessage(fromId, "Unknown command. Use /help.");
}

// -------------------- Text input handler --------------------
async function handleTextInput(fromId: string, text: string, username: string | undefined, displayName: string) {
  const state = await getUserState(fromId);
  if (!state) return;

  // Handle states
  if (state.step === "add_channel") {
    // Simulate adding channel
    const profile = await getProfile(fromId);
    if (profile) {
      profile.channels.push(text);
      await updateProfile(fromId, { channels: profile.channels });
      await sendMessage(fromId, `Channel ${text} added.`);
    }
    await setUserState(fromId, null);
  } else if (state.step === "deposit") {
    // Simulate deposit
    const amount = parseFloat(text);
    if (!isNaN(amount) && amount > 0) {
      await updateProfile(fromId, { balance: amount });
      await sendMessage(fromId, `${amount} CX deposited.`);
    } else {
      await sendMessage(fromId, "Invalid amount.");
    }
    await setUserState(fromId, null);
  } else if (state.step === "withdraw") {
    // Simulate withdrawal
    const amount = parseFloat(text);
    const profile = await getProfile(fromId);
    if (profile && amount > 0 && amount <= profile.earnings) {
      await updateProfile(fromId, { earnings: -amount });
      await sendMessage(fromId, `${amount} withdrawn.`);
      // Notify admin
      const adminProfile = await getProfileByUsername(ADMIN_USERNAME);
      if (adminProfile) await sendMessage(adminProfile.id, `Withdrawal request: ${amount} from ${fromId}`);
    } else {
      await sendMessage(fromId, "Invalid or insufficient amount.");
    }
    await setUserState(fromId, null);
  } else if (state.step === "ai_generate") {
    // Simulate AI
    const example = "🚀 Join TechNow — the #1 place for daily AI news!\n🎯 Learn faster, stay ahead, and connect with innovators.\n🔗 [Join Now]";
    await sendMessage(fromId, `Generated ad:\n${example}`);
    await setUserState(fromId, null);
  } // ... add more states

}

async function getProfileByUsername(username: string): Promise<Profile | null> {
  try {
    for await (const entry of kv.list({ prefix: ["profiles"] })) {
      const profile = entry.value as Profile;
      if (profile?.username === username) return profile;
    }
  } catch (e) {
    console.error("getProfileByUsername error", e);
  }
  return null;
}

// -------------------- Server / Webhook --------------------
serve(async (req: Request) => {
  try {
    const url = new URL(req.url);
    if (url.pathname !== SECRET_PATH) return new Response("Not found", { status: 404 });
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

    const update = await req.json();

    // handle normal messages
    if (update.message) {
      const msg = update.message;
      if (msg.chat.type !== "private") return new Response("OK");
      const from = msg.from;
      const text = (msg.text || "").trim();
      const fromId = String(from.id);
      const username = from.username;
      const displayName = from.first_name || from.username || fromId;
      const lang = from.language_code === "ru" ? "ru" : from.language_code === "tk" ? "tk" : "en";

      const { isNew } = await initProfile(fromId, username, displayName, lang);

      if (text.startsWith("/")) {
        await handleCommand(fromId, username, displayName, text, isNew, lang);
      } else {
        await handleTextInput(fromId, text, username, displayName);
      }
    }
    // handle callback queries
    else if (update.callback_query) {
      await handleCallback(update.callback_query);
    }

    return new Response("OK");
  } catch (e) {
    console.error("server error", e);
    return new Response("Error", { status: 500 });
  }
});