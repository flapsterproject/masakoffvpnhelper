// main.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

// Telegram setup
const TOKEN = Deno.env.get("BOT_TOKEN")!;
const TELEGRAM_API = `https://api.telegram.org/bot${TOKEN}`;
const TARGET_CHANNEL = "@MasakoffVpns";
const MESSAGE_TEXT = "👆Ýokarky koda 2je like basyň♥️✅️";

// Deno KV (persistent storage)
const kv = await Deno.openKv();

// Save last message info
async function saveLastMessage(messageId: number) {
  await kv.set(["lastMessage"], { messageId, timestamp: Date.now() });
}

// Get last message info
async function getLastMessage(): Promise<{ messageId: number; timestamp: number } | null> {
  const res = await kv.get(["lastMessage"]);
  return res.value ?? null;
}

// Send message
async function sendMessage(): Promise<number | null> {
  try {
    const resp = await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TARGET_CHANNEL,
        text: MESSAGE_TEXT,
        parse_mode: "HTML",
      }),
    });
    const data = await resp.json();
    if (!data.ok) {
      console.error("Failed to send message:", data);
      return null;
    }
    await saveLastMessage(data.result.message_id);
    return data.result.message_id;
  } catch (e) {
    console.error("Error sending message:", e);
    return null;
  }
}

// Delete message
async function deleteMessage(messageId: number) {
  try {
    await fetch(`${TELEGRAM_API}/deleteMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TARGET_CHANNEL, message_id: messageId }),
    });
  } catch (e) {
    console.error("Error deleting message:", e);
  }
}

// Main loop function (check every minute)
async function loop() {
  const last = await getLastMessage();
  const now = Date.now();

  if (!last) {
    // First time: send message
    await sendMessage();
  } else {
    // Check if 5 minutes passed
    if (now - last.timestamp >= 5 * 60 * 1000) {
      // Delete old message
      await deleteMessage(last.messageId);
      // Send new message
      await sendMessage();
    }
  }
}

// Run loop every 1 minute
setInterval(loop, 60 * 1000);

// HTTP server for health check
serve((_req: Request) => new Response("Bot is running"));
