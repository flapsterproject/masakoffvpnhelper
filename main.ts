// main.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

// Telegram setup
const TOKEN = Deno.env.get("BOT_TOKEN")!;
const API = `https://api.telegram.org/bot${TOKEN}`;
const kv = await Deno.openKv();

// Admin IDs (ilk başta sadece seni ekliyorum)
let ADMINS: number[] = [7171269159]; // buraya kendi Telegram ID-ni yaz

// Helper: sendMessage
async function sendMessage(chat_id: number | string, text: string, buttons: any = null) {
  const body: any = { chat_id, text, parse_mode: "HTML" };
  if (buttons) body.reply_markup = { inline_keyboard: buttons };
  await fetch(`${API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// Handle updates
async function handleUpdate(update: any) {
  if (!update.message) return;
  const msg = update.message;
  const chatId = msg.chat.id;
  const text = msg.text;

  // /start
  if (text === "/start") {
    const channels = (await kv.get(["channels"])).value ?? [];
    const buttons = channels.map((c: string) => [{ text: c, url: `https://t.me/${c.replace("@", "")}` }]);
    await sendMessage(
      chatId,
      "👋 Salam! VPN kody almak üçin aşakdaky kanallara goşulmagyňyz gerek:",
      buttons
    );
  }

  // /admin
  if (text === "/admin") {
    if (!ADMINS.includes(chatId)) {
      await sendMessage(chatId, "❌ Admin paneline rugsat ýok!");
      return;
    }
    await sendMessage(chatId, "👮 Admin paneli", [
      [{ text: "📢 Ryssylka", callback_data: "ryssylka" }],
      [{ text: "➕ Kanal goş", callback_data: "add_channel" }],
      [{ text: "📋 Kanal listi", callback_data: "list_channels" }],
      [{ text: "👑 Admin goş", callback_data: "add_admin" }],
      [{ text: "🔑 VPN kod goş", callback_data: "add_vpn" }],
    ]);
  }
}

// Long polling
async function poll() {
  let offset = 0;
  while (true) {
    const res = await fetch(`${API}/getUpdates?timeout=30&offset=${offset}`);
    const data = await res.json();
    for (const update of data.result) {
      offset = update.update_id + 1;
      try {
        await handleUpdate(update);
      } catch (e) {
        console.error("Update error:", e);
      }
    }
  }
}

poll();

// HTTP server for health check
serve(() => new Response("Bot işläp dur")) 
