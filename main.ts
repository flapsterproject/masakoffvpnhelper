// main.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const TOKEN = Deno.env.get("BOT_TOKEN")!;
const TELEGRAM_API = `https://api.telegram.org/bot${TOKEN}`;
const TARGET_CHANNEL = "@MasakoffVpns";
const MESSAGE_TEXT = "👆Yokarky koda 2je like basyň ♥️✅️";

// Keep track of last message
let lastMessageId: number | null = null;

// Function to send message
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
    return data.result.message_id;
  } catch (e) {
    console.error("Error sending message:", e);
    return null;
  }
}

// Function to delete message
async function deleteMessage(messageId: number) {
  try {
    await fetch(`${TELEGRAM_API}/deleteMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TARGET_CHANNEL,
        message_id: messageId,
      }),
    });
  } catch (e) {
    console.error("Error deleting message:", e);
  }
}

// Loop forever: send -> wait 5 min -> delete -> repeat
async function startLoop() {
  while (true) {
    const msgId = await sendMessage();
    if (msgId) lastMessageId = msgId;

    // Wait 5 minutes
    await new Promise((res) => setTimeout(res, 5 * 60 * 1000));

    if (lastMessageId) await deleteMessage(lastMessageId);
  }
}

// Start the loop immediately
startLoop();

// Optional: basic HTTP server for health check
serve((_req: Request) => new Response("Bot is running"));


