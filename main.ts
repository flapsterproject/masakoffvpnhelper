// main.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const TOKEN = Deno.env.get("BOT_TOKEN")!;
const TELEGRAM_API = `https://api.telegram.org/bot${TOKEN}`;
const SECRET_PATH = "/masakoffvpnhelper";

// Channels & users
const SOURCE_CHANNELS = ["@TkmRace", "@SERWERSTM1"];
const TARGET_CHANNEL = "@MasakoffVpns";
const SPECIFIC_USERS = ["@amangeldimasakov", "@Tm_happ_kripto"];
const PRIVATE_CHAT_ID = 123456789; // replace with your numeric Telegram ID

const LOOP_TEXT = "👆Yokarky koda 5je like basyň täze kod goyjak♥️✅️";

let lastReplyId: number | null = null;
let latestPostId: number | null = null;

// --- Reply loop every 1 minute under latest post ---
async function replyLoop() {
  if (!latestPostId) return;

  try {
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

    const resp = await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TARGET_CHANNEL,
        text: LOOP_TEXT,
        reply_to_message_id: latestPostId,
      }),
    });

    const data = await resp.json();
    if (data.ok) lastReplyId = data.result.message_id;

  } catch (e) {
    console.error("Reply loop error:", e);
  }
}

// Start repeating loop every 60 seconds
setInterval(replyLoop, 60_000);

// --- Webhook server ---
serve(async (req: Request) => {
  if (new URL(req.url).pathname !== SECRET_PATH) {
    return new Response("Not Found", { status: 404 });
  }

  const update = await req.json();

  // --- Handle private messages / forwarded posts ---
  if (update.message) {
    const msg = update.message;
    const isBot = msg.from?.is_bot;
    if (isBot) return new Response("ok");

    // --- If message is forwarded ---
    if (msg.forward_from_chat || msg.forward_from_message_id) {
      const fwdUsername = msg.forward_from_chat?.username
        ? `@${msg.forward_from_chat.username}`
        : "Unknown";

      const footer = `\n\n📌 Çeşme: ${fwdUsername}`;

      // If text message
      if (msg.text) {
        await fetch(`${TELEGRAM_API}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: PRIVATE_CHAT_ID,
            text: msg.text + footer,
            parse_mode: "HTML",
          }),
        });
      }

      // If media (photo/video/document), copy it with footer
      else if (msg.photo || msg.video || msg.document) {
        await fetch(`${TELEGRAM_API}/copyMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: PRIVATE_CHAT_ID,
            from_chat_id: msg.chat.id,
            message_id: msg.message_id,
            caption: footer,
            parse_mode: "HTML",
          }),
        });
      }
    }
  }

  // --- Handle new channel posts ---
  if (update.channel_post) {
    const post = update.channel_post;
    const username = post.chat?.username ? `@${post.chat.username}` : "";

    if (username.toLowerCase() === TARGET_CHANNEL.toLowerCase()) {
      latestPostId = post.message_id;
      // Immediately reply under the new post
      replyLoop();
    }
  }

  return new Response("ok");
});



