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

  // --- Handle private messages ---
  if (update.message) {
    const msg = update.message;
    const isBot = msg.from?.is_bot;
    if (isBot) return new Response("ok");

    // --- Forwarded messages from channels/users ---
    if (msg.forward_from_chat) {
      const fwdUsername = msg.forward_from_chat.username
        ? `@${msg.forward_from_chat.username}`
        : "";

      if (
        SOURCE_CHANNELS.map(c => c.toLowerCase()).includes(fwdUsername.toLowerCase()) ||
        SPECIFIC_USERS.map(u => u.replace("@", "").toLowerCase()).includes(fwdUsername.toLowerCase())
      ) {
        const content = msg.text ?? msg.caption ?? "";
        if (content) {
          // Add footer
          const footer = `\n\n📌 Çeşme: ${fwdUsername}`;
          await fetch(`${TELEGRAM_API}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: PRIVATE_CHAT_ID,
              text: content + footer,
              parse_mode: "HTML",
            }),
          });
        }
      }
    } else {
      // If you just send a normal message to bot, also echo with footer
      const content = msg.text ?? "";
      if (content) {
        await fetch(`${TELEGRAM_API}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: PRIVATE_CHAT_ID,
            text: content,
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


