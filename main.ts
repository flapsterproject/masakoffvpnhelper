// main.ts
// Telegram Ad Monetization Bot with Deno KV

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const TOKEN = Deno.env.get("BOT_TOKEN")!;
if (!TOKEN) throw new Error("BOT_TOKEN env var is required");
const API = `https://api.telegram.org/bot${TOKEN}`;
const SECRET_PATH = "/masakoffvpnhelper";

// Deno KV (persistent local or cloud if deployed on Deno Deploy)
const kv = await Deno.openKv();

// --- Helpers ---
async function api(method: string, body: any) {
  const res = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

type User = {
  id: number; // Telegram user id
  username?: string;
  role: "advertiser" | "publisher" | "admin";
};

type Campaign = {
  id: string;
  ownerId: number;
  title: string;
  text: string;
  cpc: number;
  budget: number;
  spent: number;
};

async function getUser(id: number): Promise<User | null> {
  const res = await kv.get<User>(["user", id]);
  return res.value ?? null;
}

async function setUser(user: User) {
  await kv.set(["user", user.id], user);
}

async function createCampaign(c: Campaign) {
  await kv.set(["campaign", c.id], c);
}

async function listCampaigns(ownerId: number): Promise<Campaign[]> {
  const iter = kv.list<Campaign>({ prefix: ["campaign"] });
  const arr: Campaign[] = [];
  for await (const { value } of iter) {
    if (value.ownerId === ownerId) arr.push(value);
  }
  return arr;
}

// --- Command handling ---
async function handleCommand(chatId: number, text: string, from: any) {
  const [cmd, ...args] = text.split(" ");
  if (cmd === "/start") {
    await api("sendMessage", {
      chat_id: chatId,
      text: "Welcome! Use /register_advertiser or /register_publisher",
    });
    return;
  }

  if (cmd === "/register_advertiser") {
    const user: User = { id: from.id, username: from.username, role: "advertiser" };
    await setUser(user);
    await api("sendMessage", { chat_id: chatId, text: "Registered as advertiser." });
    return;
  }

  if (cmd === "/register_publisher") {
    const user: User = { id: from.id, username: from.username, role: "publisher" };
    await setUser(user);
    await api("sendMessage", { chat_id: chatId, text: "Registered as publisher." });
    return;
  }

  if (cmd === "/add_campaign") {
    // Format: /add_campaign Title | Text | CPC | Budget
    const joined = args.join(" ");
    const [title, textBody, cpcRaw, budgetRaw] = joined.split("|").map((s) => s.trim());
    if (!title || !textBody) {
      await api("sendMessage", {
        chat_id: chatId,
        text: "Usage: /add_campaign Title | Text | CPC | Budget",
      });
      return;
    }
    const cpc = parseFloat(cpcRaw) || 0;
    const budget = parseFloat(budgetRaw) || 0;
    const user = await getUser(from.id);
    if (!user || user.role !== "advertiser") {
      await api("sendMessage", { chat_id: chatId, text: "You must be an advertiser." });
      return;
    }
    const campaign: Campaign = {
      id: crypto.randomUUID(),
      ownerId: user.id,
      title,
      text: textBody,
      cpc,
      budget,
      spent: 0,
    };
    await createCampaign(campaign);
    await api("sendMessage", { chat_id: chatId, text: `Campaign created: ${title}` });
    return;
  }

  if (cmd === "/list_campaigns") {
    const user = await getUser(from.id);
    if (!user || user.role !== "advertiser") {
      await api("sendMessage", { chat_id: chatId, text: "Only advertisers can list campaigns." });
      return;
    }
    const list = await listCampaigns(user.id);
    if (list.length === 0) {
      await api("sendMessage", { chat_id: chatId, text: "No campaigns found." });
      return;
    }
    let msg = "Your campaigns:\n";
    for (const c of list) {
      msg += `• ${c.title} — spent ${c.spent}/${c.budget}\n`;
    }
    await api("sendMessage", { chat_id: chatId, text: msg });
    return;
  }

  await api("sendMessage", { chat_id: chatId, text: "Unknown command." });
}

// --- Polling for updates (long polling) ---
async function poll() {
  let offset = 0;
  while (true) {
    try {
      const res = await fetch(`${API}/getUpdates?timeout=20&offset=${offset}`);
      const data = await res.json();
      if (data.ok && data.result.length) {
        for (const upd of data.result) {
          offset = upd.update_id + 1;
          if (upd.message?.text) {
            await handleCommand(upd.message.chat.id, upd.message.text, upd.message.from);
          }
        }
      }
    } catch (err) {
      console.error("poll error", err);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

// --- HTTP server for webhook or tracking (future expansion) ---
serve((_req) => new Response("OK"), { port: 8000 });

// Start polling in background
poll();








