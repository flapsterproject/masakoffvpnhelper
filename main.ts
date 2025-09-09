// main.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const TOKEN = Deno.env.get("BOT_TOKEN")!;
const TELEGRAM_API = `https://api.telegram.org/bot${TOKEN}`;
const SECRET_PATH = "/masakoffvpnhelper";

// Source channels
const SOURCE_CHANNELS = ["@TkmRace", "@SERWERSTM1"]; 
// Target channel
const TARGET_CHANNEL = "@MasakoffVpn";
// Specific user to forward
const SPECIFIC_USER = "@amangeldimasakov";

// --- Copy media with footer ---
async function copyMessageWithFooter(fromChat: string, messageId: number, toChat: string, footer: string) {
  await fetch(`${TELEGRAM_API}/copyMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: toChat,
      from_chat_id: fromChat,
      message_id: messageId,
      caption: footer,  // only works for media
      parse_mode: "HTML"
    }),
  });
}

// --- Webhook server ---
serve(async (req: Request) => {
  if (new URL(req.url).pathname !== SECRET_PATH) {
    return new Response("Not Found", { status: 404 });
  }

  const update = await req.json();

  let fromUsername = "";
  let messageId = 0;
  let fromChatId = "";
  let text = "";

  if (update.message) {
    const msg = update.message;
    fromUsername = `@${msg.from?.username}`;
    messageId = msg.message_id;
    fromChatId = msg.chat.id;
    text = msg.text ?? "";
  } else if (update.channel_post) {
    const post = update.channel_post;
    fromUsername = `@${post.chat?.username}`;
    messageId = post.message_id;
    fromChatId = post.chat.id;
    text = post.text ?? post.caption ?? "";
  }

  // --- Footer with source channel/user ---
  let footer = `\n\n📌 Source: ${fromUsername}`;

  // If @amangeldimasakov sent the message, include original chat/channel
  if (fromUsername.toLowerCase() === SPECIFIC_USER.toLowerCase()) {
    // Use chat title if available, otherwise username
    const chatName = update.message?.chat.title ?? update.message?.chat.username ?? "Private Chat";
    footer = `\n\n📌 Forwarded from: ${chatName}`;
  }

  // Forward if from source channel or specific user
  if (
    SOURCE_CHANNELS.some(c => c.toLowerCase() === fromUsername.toLowerCase()) ||
    fromUsername.toLowerCase() === SPECIFIC_USER.toLowerCase()
  ) {
    if (text) {
      await fetch(`${TELEGRAM_API}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: TARGET_CHANNEL,
          text: text + footer,
          parse_mode: "HTML"
        }),
      });
    } else {
      // Media only
      await copyMessageWithFooter(fromChatId.toString(), messageId, TARGET_CHANNEL, footer);
    }
  }

  return new Response("ok");
});





