// main.ts
// Telegram View Booster Bot (Deno) - Simulate Real Views for Telegram Posts
// Implements core flows based on the original Python script
// Uses Deno KV for storage (user states, proxies, stats)
// Webhook setup, multi-language support (basic), states for multi-step inputs
// Integrates ModernTelegramViewer for view simulation
// Background task for running views, progress updates via messages
// Note: For production, handle rate limits better, add anti-detection, real proxies management

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { v4 as uuid } from "https://deno.land/std@0.224.0/uuid/mod.ts";
import { delay } from "https://deno.land/std@0.224.0/async/delay.ts";

const TOKEN = Deno.env.get("BOT_TOKEN")!;
if (!TOKEN) throw new Error("BOT_TOKEN env var is required");
const API = `https://api.telegram.org/bot${TOKEN}`;
const SECRET_PATH = "/masakoffvpnshelper"; // webhook path
const BOT_USERNAME = "MasakoffVpnHelperBot";

const kv = await Deno.openKv();

const LANGUAGES = ["en"] as const; // Expand as needed
type Language = typeof LANGUAGES[number];

// Types
type User = {
  id: string; // UUID
  tg_id: string;
  username?: string;
  full_name: string;
  language: Language;
  created_at: number;
};

type ViewTask = {
  id: string; // UUID
  user_id: string;
  channel: string;
  posts: number[];
  tasks: number; // views
  proxies: string[];
  status: "pending" | "running" | "completed" | "failed";
  progress: number;
  stats: { success: number; failed: number; proxy_error: number };
  created_at: number;
};

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

// KV helpers
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

async function getViewTask(id: string): Promise<ViewTask | null> {
  const res = await kv.get<ViewTask>(["view_tasks", id]);
  return res.value;
}

async function createViewTask(userId: string, channel: string, posts: number[], tasks: number, proxies: string[]): Promise<ViewTask> {
  const id = uuid.generate();
  const viewTask: ViewTask = {
    id,
    user_id: userId,
    channel,
    posts,
    tasks,
    proxies,
    status: "pending",
    progress: 0,
    stats: { success: 0, failed: 0, proxy_error: 0 },
    created_at: Date.now(),
  };
  await kv.set(["view_tasks", id], viewTask);
  return viewTask;
}

async function updateViewTask(id: string, updates: Partial<ViewTask>) {
  const task = await getViewTask(id);
  if (task) {
    const updated = { ...task, ...updates };
    await kv.set(["view_tasks", id], updated);
    return updated;
  }
  return null;
}

// Translation function (basic, expand as needed)
function t(lang: Language, key: string, params: Record<string, any> = {}): string {
  const translations: Record<string, Record<Language, string>> = {
    welcome: { en: "Welcome to Telegram View Booster! 🚀\nBoost your post views realistically.\n\nChoose an option below 👇" },
    start_boost: { en: "Start boosting a post." },
    my_tasks: { en: "View my boost tasks." },
    // Add more
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
      [{ text: "🚀 Start Boost", callback_data: "start_boost" }],
      [{ text: "📊 My Tasks", callback_data: "my_tasks" }],
      [{ text: "⚙️ Settings", callback_data: "settings" }],
    ],
  };
}

// Viewer class (adapted from previous)
class ModernTelegramViewer {
    channel: string;
    posts: number[];
    tasks: number;
    proxyList: string[];
    stats: { success: number; failed: number; proxy_error: number };
    onProgress: (progress: number) => void;
    onLog: (stats: { success: number; failed: number; proxy_error: number }) => void;

    constructor(
        channel: string,
        posts: number[],
        tasks: number,
        proxyList: string[] = [],
        onProgress: (progress: number) => void = () => {},
        onLog: (stats: { success: number; failed: number; proxy_error: number }) => void = () => {}
    ) {
        this.channel = channel;
        this.posts = posts;
        this.tasks = tasks;
        this.proxyList = proxyList;
        this.stats = { success: 0, failed: 0, proxy_error: 0 };
        this.onProgress = onProgress;
        this.onLog = onLog;
    }

    async simulateRealView(post: number, proxy?: string): Promise<boolean> {
        try {
            const url = `https://t.me/${this.channel}/${post}`;
            const headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Accept-Encoding': 'gzip, deflate, br',
                'DNT': '1',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Cache-Control': 'max-age=0'
            };

            let client: Deno.HttpClient | undefined;
            if (proxy) {
                const [auth, hostPort] = proxy.split('@');
                let username, password, hostname, port;
                if (hostPort) {
                    [username, password] = auth.split(':');
                    [hostname, port] = hostPort.split(':');
                } else {
                    [hostname, port] = auth.split(':');
                }
                port = parseInt(port, 10);
                client = Deno.createHttpClient({
                    proxy: {
                        protocol: "socks5",
                        hostname,
                        port,
                        ...(username && { username }),
                        ...(password && { password }),
                    },
                });
            }

            const response = await fetch(url, { headers, client });

            if (response.status === 200) {
                const content = await response.text();
                if (content.includes('tgme_page_post') || content.includes(this.channel)) {
                    await delay(Math.random() * 3000 + 2000); // 2-5s
                    return true;
                }
            }
            return false;
        } catch (e) {
            console.error(`View simulation failed: ${e}`);
            return false;
        }
    }

    async processView(post: number): Promise<void> {
        const proxy = this.proxyList.length > 0 ? this.proxyList[Math.floor(Math.random() * this.proxyList.length)] : undefined;

        try {
            const success = await this.simulateRealView(post, proxy);
            if (success) {
                this.stats.success += 1;
            } else {
                this.stats.failed += 1;
            }
        } catch {
            this.stats.proxy_error += 1;
        }
        this.onProgress(1);

        await delay(Math.random() * 5000 + 3000); // 3-8s
    }

    async runViews(): Promise<void> {
        for (const post of this.posts) {
            let batch: Promise<void>[] = [];
            for (let i = 0; i < this.tasks; i++) {
                batch.push(this.processView(post));
                if (batch.length >= 5) {
                    await Promise.all(batch);
                    batch = [];
                    this.onLog(this.stats);
                    await delay(5000); // 5s batch delay
                }
            }
            if (batch.length > 0) {
                await Promise.all(batch);
            }
        }
        this.onLog(this.stats); // Final
    }
}

// Background runner
async function runViewTask(taskId: string, chatId: string) {
  const task = await getViewTask(taskId);
  if (!task || task.status !== "pending") return;

  await updateViewTask(taskId, { status: "running" });

  const viewer = new ModernTelegramViewer(
    task.channel,
    task.posts,
    task.tasks,
    task.proxies,
    async (inc) => {
      task.progress += inc;
      await updateViewTask(taskId, { progress: task.progress });
      // Send progress update every 10%
      if (task.progress % Math.floor(task.tasks / 10) === 0) {
        await sendMessage(chatId, `Progress: ${task.progress}/${task.tasks}`);
      }
    },
    async (stats) => {
      await updateViewTask(taskId, { stats });
      await sendMessage(chatId, `Update: ✅ ${stats.success} ❌ ${stats.failed} 🔌 ${stats.proxy_error}`);
    }
  );

  try {
    await viewer.runViews();
    await updateViewTask(taskId, { status: "completed" });
    await sendMessage(chatId, "Boost completed!");
  } catch (e) {
    await updateViewTask(taskId, { status: "failed" });
    await sendMessage(chatId, `Boost failed: ${e}`);
  }
}

// Callback handler
async function handleCallback(cb: any) {
  const fromId = cb.from.id.toString();
  const data = cb.data;
  const callbackId = cb.id;
  const msgId = cb.message.message_id;
  const user = await getUser(fromId);
  const lang = user?.language || "en";

  if (!data) {
    await answerCallbackQuery(callbackId);
    return;
  }

  switch (data) {
    case "main_menu":
      await editMessageText(fromId, msgId, t(lang, "welcome"), { reply_markup: getMainMenu(lang) });
      break;
    case "start_boost":
      await setUserState(fromId, { step: "input_channel", data: {} });
      await sendMessage(fromId, "Enter channel username (without @):");
      break;
    case "my_tasks":
      // List tasks (query KV by user_id)
      const tasks = []; // Simulate query
      for await (const entry of kv.list<ViewTask>({ prefix: ["view_tasks"] })) {
        if (entry.value.user_id === user!.id) tasks.push(entry.value);
      }
      const taskList = tasks.map(t => `ID: ${t.id} Status: ${t.status} Progress: ${t.progress}/${t.tasks}`).join("\n");
      await sendMessage(fromId, taskList || "No tasks.");
      break;
    // Add more
    default:
      await answerCallbackQuery(callbackId, "Unknown action.");
  }
  await answerCallbackQuery(callbackId);
}

// Text input handler
async function handleText(fromId: string, text: string, user: User) {
  const state = await getUserState(fromId);
  const lang = user.language;

  if (!state) return;

  switch (state.step) {
    case "input_channel":
      state.data.channel = text.trim();
      await setUserState(fromId, state);
      await sendMessage(fromId, "Enter post ID:");
      state.step = "input_post";
      await setUserState(fromId, state);
      break;
    case "input_post":
      state.data.post = parseInt(text.trim(), 10);
      await setUserState(fromId, state);
      await sendMessage(fromId, "Enter number of views:");
      state.step = "input_views";
      await setUserState(fromId, state);
      break;
    case "input_views":
      state.data.views = parseInt(text.trim(), 10);
      await setUserState(fromId, state);
      await sendMessage(fromId, "Enter proxies (comma-separated, optional):");
      state.step = "input_proxies";
      await setUserState(fromId, state);
      break;
    case "input_proxies":
      const proxies = text.trim() ? text.split(',').map(p => p.trim()).filter(p => p) : [];
      const task = await createViewTask(user.id, state.data.channel, [state.data.post], state.data.views, proxies);
      await sendMessage(fromId, `Task created: ID ${task.id}. Starting...`);
      await setUserState(fromId, null);
      // Run in background
      runViewTask(task.id, fromId).catch(console.error);
      break;
  }
}

// Command handler
async function handleCommand(fromId: string, text: string, user: User) {
  const lang = user.language;

  if (text.startsWith("/start")) {
    await sendMessage(fromId, t(lang, "welcome"), { reply_markup: getMainMenu(lang) });
  } else if (text.startsWith("/boost")) {
    await setUserState(fromId, { step: "input_channel", data: {} });
    await sendMessage(fromId, "Enter channel username (without @):");
  } else if (text.startsWith("/tasks")) {
    // Similar to my_tasks callback
    const tasks = [];
    for await (const entry of kv.list<ViewTask>({ prefix: ["view_tasks"] })) {
      if (entry.value.user_id === user.id) tasks.push(entry.value);
    }
    const taskList = tasks.map(t => `ID: ${t.id} Status: ${t.status} Progress: ${t.progress}/${t.tasks}`).join("\n");
    await sendMessage(fromId, taskList || "No tasks.");
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
      await handleCommand(fromId, text, user);
    } else {
      await handleText(fromId, text, user);
    }
  } else if (update.callback_query) {
    await handleCallback(update.callback_query);
  }

  return new Response("OK");
});