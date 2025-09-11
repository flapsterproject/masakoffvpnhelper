// main.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const TOKEN = Deno.env.get("BOT_TOKEN")!;
const TELEGRAM_API = `https://api.telegram.org/bot${TOKEN}`;
const SECRET_PATH = "/masakoffvpnhelper";

// Source channels
const SOURCE_CHANNELS = ["@TkmRace", "@SERWERSTM1"];
// Target channel
const TARGET_CHANNEL = "@MasakoffVpns";
// Specific users
const SPECIFIC_USERS = ["@amangeldimasakov", "@Tm_happ_kripto"];

// Your private chat ID (replace with your Telegram user ID)
const PRIVATE_CHAT_ID = 123456789; 

const LOOP_TEXT = "👆Yokarky koda 5je like basyň täze kod goyjak♥️✅️";

// Track last reply in channel
let lastReplyId: number | null = null;
// Track current post ID to reply under
let currentPostId: number | null = null;

// --- Loop to reply every 1 minute ---
function startReplyLoop() {
  setInterval(async () => {
    if (!currentPostId) return;

    try {
      // Delete previous bot reply
      if (lastReplyId) {
        await fetch(`${TELEGRAM_API}/deleteMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: TARGET_CHANNEL,
            message_id: lastReplyId,
          }),
        });
      }

      // Send new reply under the current post
      const resp = await fetch(`${TELEGRAM_API}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: TARGET_CHANNEL,
          text: LOOP_TEXT,
          reply_to_message_id: currentPostId,
        }),
      });

      const data = await resp.json();
      if (data.ok) {
        lastReplyId = data.result.message_id;
      }
    } catch (e) {
      console.error("Reply loop error:", e);
    }
  }, 60_000);
}

// Start loop immediately
startReplyLoop();

// --- Webhook server ---
serve(async (req: Request) => {
  if (new URL(req.url).pathname !== SECRET_PATH) {
    return new Response("Not Found", { status: 404 });
  }

  const update = await req.json();

  let fromUsername = "";
  let messageId = 0;
  let fromChatId = 0;
  let text = "";

  if (update.message) {
    const msg = update.message;
    fromUsername = msg.forward_from_chat?.username
      ? `@${msg.forward_from_chat.username}`
      : `@${msg.from?.username}`;
    messageId = msg.message_id;
    fromChatId = msg.chat.id;
    text = msg.text ?? "";

    // --- Forwarded messages to private chat ---
    if (
      msg.forward_from_chat &&
      (SOURCE_CHANNELS.some(c => c.toLowerCase() === msg.forward_from_chat.username?.toLowerCase()) ||
      SPECIFIC_USERS.some(u => u.replace("@", "").toLowerCase() === msg.forward_from_chat.username?.toLowerCase()))
    ) {
      // Send forwarded content to you privately
      let content = text ?? "";
      if (msg.caption) content = msg.caption;

      await fetch(`${TELEGRAM_API}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: PRIVATE_CHAT_ID,
          text: content,
          parse_mode: "HTML",
        }),
      });
    }

  } else if (update.channel_post) {
    const post = update.channel_post;
    fromUsername = `@${post.chat?.username}`;
    messageId = post.message_id;
    fromChatId = post.chat.id;
    text = post.text ?? post.caption ?? "";

    // --- New post in target channel: update currentPostId ---
    if (fromUsername.toLowerCase() === TARGET_CHANNEL.toLowerCase()) {
      currentPostId = messageId;
    }
  }

  return new Response("ok");
});

