// main.ts
// Convix Ads Bot (Deno) - Smart Growth & Monetization for Telegram Channels
// Implements core flows based on detailed specification
// Uses Deno KV for storage (simulating DB schema with prefixes)
// Webhook setup, multi-language support, states for multi-step flows
// Simulated AI ad generation (fixed templates)
// Basic admin panel, referral system, anti-fraud placeholders
// Note: For full production, integrate payments, real AI (e.g., OpenAI), and expand verification

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { v4 as uuid } from "https://deno.land/std@0.224.0/uuid/mod.ts";

const TOKEN = Deno.env.get("BOT_TOKEN")!;
if (!TOKEN) throw new Error("BOT_TOKEN env var is required");
const API = `https://api.telegram.org/bot${TOKEN}`;
const SECRET_PATH = "/masakoffvpnhelper"; // webhook path
const BOT_USERNAME = "MasakoffVpnsHelperBot";

const kv = await Deno.openKv();

const ADMIN_USERNAME = "Masakoff"; // replace with actual

const LANGUAGES = ["en", "ru", "tk"] as const;
type Language = typeof LANGUAGES[number];

// Types based on schema
type User = {
  id: string; // UUID
  tg_id: string;
  username?: string;
  full_name: string;
  language: Language;
  balance: number;
  role: "user" | "admin";
  created_at: number;
};

type Channel = {
  id: string; // UUID
  owner_id: string;
  tg_channel_id: string;
  username?: string;
  title: string;
  is_verified: boolean;
  connected_at?: number;
  status: "pending" | "active" | "banned";
  daily_ad_limit: number;
  categories: string[];
  region: string;
  created_at: number;
};

type Campaign = {
  id: string; // UUID
  advertiser_id: string;
  channel_id: string;
  title: string;
  description: string;
  creative: any; // JSON
  target: any; // JSON
  budget: number;
  price_per_join: number;
  status: "active" | "paused" | "finished" | "cancelled";
  start_at?: number;
  end_at?: number;
  daily_limit?: number;
  created_at: number;
};

// ... other types as needed (joins, transactions, etc.)

// State type
type UserState = {
  step: string;
  data: any;
} | null;

// Telegram helpers
async function sendMessage(chatId: string, text: string, options: any = {}): Promise<number | null> {
  try {
    const body = { chat_id: chatId, text, ...options };
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

async function editMessageText(chatId: string, messageId: number, text: string, options: any = {}) {
  try {
    const body = { chat_id: chatId, message_id: messageId, text, ...options };
    await fetch(`${API}/editMessageText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    console.warn("editMessageText failed", e);
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
    console.warn("answerCallbackQuery failed", e);
  }
}

async function getChatMember(chatId: string, userId: string) {
  try {
    const res = await fetch(`${API}/getChatMember?chat_id=${chatId}&user_id=${userId}`);
    const data = await res.json();
    if (data.ok) return data.result;
    return null;
  } catch (e) {
    console.error("getChatMember error", e);
    return null;
  }
}

// KV helpers for states
async function getUserState(userId: string): Promise<UserState> {
  const res = await kv.get<UserState>(["states", userId]);
  return res.value;
}

async function setUserState(userId: string, state: UserState) {
  if (state) {
    await kv.set(["states", userId], state);
  } else {
    await kv.delete(["states", userId]);
  }
}

// Profile/User helpers
async function getUser(tgId: string): Promise<User | null> {
  const res = await kv.get<User>(["users", tgId]);
  return res.value;
}

async function createOrUpdateUser(tgId: string, username: string | undefined, fullName: string, language: Language): Promise<User> {
  let user = await getUser(tgId);
  if (!user) {
    user = {
      id: uuid.generate(),
      tg_id: tgId,
      username,
      full_name: fullName,
      language,
      balance: 0,
      role: username === ADMIN_USERNAME ? "admin" : "user",
      created_at: Date.now(),
    };
    await kv.set(["users", tgId], user);
  } else {
    user.username = username ?? user.username;
    user.full_name = fullName;
    user.language = language;
    await kv.set(["users", tgId], user);
  }
  return user;
}

// Channel helpers
async function getChannel(id: string): Promise<Channel | null> {
  const res = await kv.get<Channel>(["channels", id]);
  return res.value;
}

async function createChannel(ownerId: string, tgChannelId: string, username: string | undefined, title: string): Promise<Channel> {
  const id = uuid.generate();
  const channel: Channel = {
    id,
    owner_id: ownerId,
    tg_channel_id: tgChannelId,
    username,
    title,
    is_verified: false,
    status: "pending",
    daily_ad_limit: 10,
    categories: [],
    region: "",
    created_at: Date.now(),
  };
  await kv.set(["channels", id], channel);
  // Add to user's channels list if needed (optional, can query by owner_id)
  return channel;
}

async function updateChannel(id: string, updates: Partial<Channel>) {
  const channel = await getChannel(id);
  if (channel) {
    const updated = { ...channel, ...updates };
    await kv.set(["channels", id], updated);
    return updated;
  }
  return null;
}

// Campaign helpers
async function getCampaign(id: string): Promise<Campaign | null> {
  const res = await kv.get<Campaign>(["campaigns", id]);
  return res.value;
}

async function createCampaign(advertiserId: string, channelId: string, data: Partial<Campaign>): Promise<Campaign> {
  const id = uuid.generate();
  const campaign: Campaign = {
    id,
    advertiser_id: advertiserId,
    channel_id: channelId,
    title: data.title ?? "",
    description: data.description ?? "",
    creative: data.creative ?? {},
    target: data.target ?? {},
    budget: data.budget ?? 0,
    price_per_join: data.price_per_join ?? 0.2,
    status: "active",
    created_at: Date.now(),
  };
  await kv.set(["campaigns", id], campaign);
  return campaign;
}

// Translation function (add more as needed)
function t(lang: Language, key: string, params: Record<string, any> = {}): string {
  const translations: Record<string, Record<Language, string>> = {
    welcome: { en: "Welcome to Convix Ads! 🚀\nGrow faster. Earn smarter.\n\nChoose an option below 👇", ru: "Добро пожаловать в Convix Ads! 🚀\nРастите быстрее. Зарабатывайте умнее.\n\nВыберите опцию ниже 👇", tk: "Convix Ads-a hoş geldiňiz! 🚀\nHas çalt ösüň. Akylly gazanyň.\n\nAşakdaky saýlawy saýlaň 👇" },
    grow_desc: { en: "Create a promotion to get real subscribers. Select:", ru: "Создайте продвижение для реальных подписчиков. Выберите:", tk: "Hakykat abunaçylar almak üçin reklama dörediň. Saýlaň:" },
    earn_desc: { en: "Monetize your channel by allowing Convix to post promos automatically.", ru: "Монетизируйте канал, разрешив Convix автоматически публиковать промо.", tk: "Convix-e awtomatik reklama ýerleşdirmäge rugsat berip, kanalyňyzy monetizasiýa ediň." },
    ai_desc: { en: "Generate catchy ad posts in one tap. Choose style:", ru: "Генерируйте привлекательные рекламные посты в один клик. Выберите стиль:", tk: "Bir dokunmak bilen gyzykly reklama ýazgylaryny dörediň. Stil saýlaň:" },
    account_desc: { en: "Account Summary", ru: "Сводка аккаунта", tk: "Hasap jemi" },
    support_desc: { en: "Support Menu", ru: "Меню поддержки", tk: "Goldaw menýu" },
    // Add more keys for all texts in spec
  };
  let text = translations[key]?.[lang] || key;
  for (const [k, v] of Object.entries(params)) {
    text = text.replace(`{${k}}`, v);
  }
  return text;
}

// Menu keyboards
function getMainMenu(lang: Language): any {
  return {
    inline_keyboard: [
      [{ text: "📈 Grow My Channel", callback_data: "grow_menu" }],
      [{ text: "💰 Earn From My Channel", callback_data: "earn_menu" }],
      [{ text: "🧠 AI Ad Generator", callback_data: "ai_generator" }],
      [{ text: "👤 My Account", callback_data: "account_menu" }],
      [{ text: "💬 Support", callback_data: "support_menu" }],
    ],
  };
}

function getGrowMenu(lang: Language): any {
  return {
    inline_keyboard: [
      [{ text: "➕ Add Channel", callback_data: "add_channel" }],
      [{ text: "🎯 Create Promotion", callback_data: "create_campaign" }],
      [{ text: "📊 My Campaigns", callback_data: "my_campaigns" }],
      [{ text: "💵 Deposit Balance", callback_data: "deposit" }],
      [{ text: "🔙 Back", callback_data: "main_menu" }],
    ],
  };
}

function getEarnMenu(lang: Language): any {
  return {
    inline_keyboard: [
      [{ text: "➕ Connect My Channel", callback_data: "connect_channel" }],
      [{ text: "⚙️ Ad Settings", callback_data: "publisher_settings" }],
      [{ text: "💸 Withdraw Earnings", callback_data: "withdraw" }],
      [{ text: "📅 Earnings History", callback_data: "earnings_history" }],
      [{ text: "🔙 Back", callback_data: "main_menu" }],
    ],
  };
}

function getAIMenu(lang: Language): any {
  return {
    inline_keyboard: [
      [{ text: "📝 Short Promo (1-2 lines)", callback_data: "ai_short" }],
      [{ text: "🧾 Detailed Post (with CTA)", callback_data: "ai_long" }],
      [{ text: "✏️ Rewrite Existing", callback_data: "ai_rewrite" }],
      [{ text: "💾 Save Template", callback_data: "ai_save_template" }],
      [{ text: "🔙 Back", callback_data: "main_menu" }],
    ],
  };
}

function getAccountMenu(lang: Language): any {
  return {
    inline_keyboard: [
      [{ text: "💰 My Balance", callback_data: "balance" }],
      [{ text: "📊 Channel Stats", callback_data: "channel_stats" }],
      [{ text: "👥 Referrals", callback_data: "referrals" }],
      [{ text: "⚙️ Settings", callback_data: "user_settings" }],
      [{ text: "🔙 Back", callback_data: "main_menu" }],
    ],
  };
}

function getSupportMenu(lang: Language): any {
  return {
    inline_keyboard: [
      [{ text: "📚 FAQ", callback_data: "faq" }],
      [{ text: "🧑‍💻 Contact Admin", callback_data: "contact_admin" }],
      [{ text: "📝 Report a Problem", callback_data: "report_problem" }],
      [{ text: "🔙 Back", callback_data: "main_menu" }],
    ],
  };
}

function getAdminMenu(lang: Language): any {
  return {
    inline_keyboard: [
      [{ text: "🧾 Manage Channels", callback_data: "admin_channels" }],
      [{ text: "💸 Manage Balances", callback_data: "admin_balances" }],
      [{ text: "📤 Approve Payouts", callback_data: "admin_payouts" }],
      [{ text: "📢 Broadcast", callback_data: "admin_broadcast" }],
      [{ text: "🎁 Create Promo Code", callback_data: "admin_promo" }],
      [{ text: "📊 System Stats", callback_data: "admin_stats" }],
    ],
  };
}

// Callback handler
async function handleCallback(cb: any) {
  const fromId = cb.from.id.toString();
  const data = cb.data;
  const callbackId = cb.id;
  const username = cb.from.username;
  const user = await getUser(fromId);
  const lang = user?.language || "en";
  const msgId = cb.message.message_id;

  if (!data) {
    await answerCallbackQuery(callbackId);
    return;
  }

  switch (data) {
    case "main_menu":
      await editMessageText(fromId, msgId, t(lang, "welcome"), { reply_markup: getMainMenu(lang) });
      break;
    case "grow_menu":
      await editMessageText(fromId, msgId, t(lang, "grow_desc"), { reply_markup: getGrowMenu(lang) });
      break;
    case "earn_menu":
      await editMessageText(fromId, msgId, t(lang, "earn_desc"), { reply_markup: getEarnMenu(lang) });
      break;
    case "ai_generator":
      await editMessageText(fromId, msgId, t(lang, "ai_desc"), { reply_markup: getAIMenu(lang) });
      break;
    case "account_menu":
      await editMessageText(fromId, msgId, t(lang, "account_desc"), { reply_markup: getAccountMenu(lang) });
      break;
    case "support_menu":
      await editMessageText(fromId, msgId, t(lang, "support_desc"), { reply_markup: getSupportMenu(lang) });
      break;
    case "add_channel":
      await setUserState(fromId, { step: "add_channel", data: {} });
      await sendMessage(fromId, "Enter your channel username (e.g., @mychannel) or ID.");
      break;
    case "create_campaign":
      await setUserState(fromId, { step: "create_campaign_title", data: {} });
      await sendMessage(fromId, "Enter campaign title.");
      break;
    case "my_campaigns":
      // List campaigns (simulate)
      await sendMessage(fromId, "Your campaigns: (list here)");
      break;
    case "deposit":
      await setUserState(fromId, { step: "deposit", data: {} });
      await sendMessage(fromId, "Enter deposit amount.");
      break;
    case "connect_channel":
      await setUserState(fromId, { step: "connect_channel", data: {} });
      await sendMessage(fromId, "Enter your channel to connect.");
      break;
    case "withdraw":
      await setUserState(fromId, { step: "withdraw", data: {} });
      await sendMessage(fromId, "Enter withdrawal amount.");
      break;
    case "ai_short":
      await setUserState(fromId, { step: "ai_short", data: {} });
      await sendMessage(fromId, "Enter topic for short promo.");
      break;
    // Add cases for other callbacks
    case "verify_channel":
      const state = await getUserState(fromId);
      if (state && state.step === "verify_channel") {
        const channelUsername = state.data.channel;
        const member = await getChatMember(`@${channelUsername}`, fromId);
        if (member && ['creator', 'administrator'].includes(member.status)) {
          const channel = await getChannel(state.data.channelId); // assume stored
          if (channel) {
            await updateChannel(channel.id, { is_verified: true, status: "active" });
            await sendMessage(fromId, "Channel verified!");
          }
        } else {
          await sendMessage(fromId, "Verification failed. Make sure bot is admin and try again.");
        }
        await setUserState(fromId, null);
      }
      break;
    default:
      if (data.startsWith("admin_") && user?.role === "admin") {
        // Handle admin actions
        await answerCallbackQuery(callbackId, "Admin action: " + data);
      } else {
        await answerCallbackQuery(callbackId, "Unknown action.");
      }
  }
  await answerCallbackQuery(callbackId);
}

// Text input handler
async function handleText(fromId: string, text: string, user: User) {
  const state = await getUserState(fromId);
  const lang = user.language;

  if (!state) return;

  switch (state.step) {
    case "add_channel":
    case "connect_channel":
      const channelUsername = text.startsWith("@") ? text.slice(1) : text;
      const channel = await createChannel(user.id, channelUsername, channelUsername, "Title"); // title to fetch later
      await sendMessage(fromId, `Add the bot as admin to @${channelUsername}, then press Verify.`, {
        reply_markup: { inline_keyboard: [[{ text: "Verify", callback_data: "verify_channel" }]] },
      });
      await setUserState(fromId, { step: "verify_channel", data: { channel: channelUsername, channelId: channel.id } });
      break;
    case "create_campaign_title":
      state.data.title = text;
      await setUserState(fromId, state);
      await sendMessage(fromId, "Enter description.");
      state.step = "create_campaign_description";
      await setUserState(fromId, state);
      break;
    case "create_campaign_description":
      state.data.description = text;
      // ... continue with other steps (target, budget, etc.)
      // For brevity, create campaign
      const campaign = await createCampaign(user.id, "channel_id_placeholder", state.data); // replace channel_id
      await sendMessage(fromId, "Campaign created!");
      await setUserState(fromId, null);
      break;
    case "deposit":
      const amount = parseFloat(text);
      if (!isNaN(amount)) {
        user.balance += amount;
        await kv.set(["users", fromId], user);
        await sendMessage(fromId, "Deposited!");
      }
      await setUserState(fromId, null);
      break;
    case "withdraw":
      // Similar
      await sendMessage(fromId, "Withdrawal requested.");
      await setUserState(fromId, null);
      break;
    case "ai_short":
      const example = `🚀 Join ${text} — the #1 place!`;
      await sendMessage(fromId, example, {
        reply_markup: { inline_keyboard: [
          [{ text: "✅ Use This Ad", callback_data: "use_ad" }],
          [{ text: "✍️ Edit", callback_data: "edit_ad" }],
        ] },
      });
      await setUserState(fromId, null);
      break;
    // Add more
  }
}

// Command handler
async function handleCommand(fromId: string, text: string, user: User, isNew: boolean) {
  const lang = user.language;
  const parts = text.split(" ");

  if (text.startsWith("/start")) {
    if (parts.length > 1 && parts[1].startsWith("ref_")) {
      const referrerTgId = parts[1].slice(4);
      if (isNew && referrerTgId !== fromId) {
        const referrer = await getUser(referrerTgId);
        if (referrer) {
          referrer.balance += 1; // bonus
          await kv.set(["users", referrerTgId], referrer);
          await sendMessage(referrerTgId, "New referral bonus!");
        }
      }
    }
    await sendMessage(fromId, t(lang, "welcome"), { reply_markup: getMainMenu(lang) });
  } else if (text.startsWith("/grow")) {
    await sendMessage(fromId, t(lang, "grow_desc"), { reply_markup: getGrowMenu(lang) });
  } else if (text.startsWith("/earn")) {
    await sendMessage(fromId, t(lang, "earn_desc"), { reply_markup: getEarnMenu(lang) });
  } else if (text.startsWith("/balance")) {
    await sendMessage(fromId, `Balance: ${user.balance}`);
  } else if (text.startsWith("/withdraw")) {
    await setUserState(fromId, { step: "withdraw", data: {} });
    await sendMessage(fromId, "Enter amount.");
  } else if (text.startsWith("/support")) {
    await sendMessage(fromId, t(lang, "support_desc"), { reply_markup: getSupportMenu(lang) });
  } else if (text.startsWith("/admin")) {
    if (user.role === "admin") {
      await sendMessage(fromId, "Admin Panel", { reply_markup: getAdminMenu(lang) });
    } else {
      await sendMessage(fromId, "Access denied.");
    }
  } else if (text.startsWith("/invite")) {
    await sendMessage(fromId, `Referral link: https://t.me/${BOT_USERNAME}?start=ref_${fromId}`);
  } else {
    await sendMessage(fromId, "Unknown command.");
  }
}

// Server
serve(async (req) => {
  if (req.method !== "POST" || new URL(req.url).pathname !== SECRET_PATH) {
    return new Response("Invalid", { status: 400 });
  }

  const update = await req.json();

  if (update.message) {
    const msg = update.message;
    if (msg.chat.type !== "private") return new Response("OK");
    const from = msg.from;
    const text = msg.text?.trim() ?? "";
    const fromId = from.id.toString();
    const username = from.username;
    const fullName = from.first_name || username || fromId;
    const langCode = from.language_code || "en";
    const lang: Language = LANGUAGES.includes(langCode as Language) ? langCode as Language : "en";

    const user = await createOrUpdateUser(fromId, username, fullName, lang);

    if (text.startsWith("/")) {
      await handleCommand(fromId, text, user, !(await getUser(fromId))); // isNew if no user before
    } else {
      await handleText(fromId, text, user);
    }
  } else if (update.callback_query) {
    await handleCallback(update.callback_query);
  }

  return new Response("OK");
});