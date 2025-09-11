// main.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const TOKEN = Deno.env.get("BOT_TOKEN")!;
const TELEGRAM_API = `https://api.telegram.org/bot${TOKEN}`;
const SECRET_PATH = "/masakoffvpnhelper";

const TARGET_CHANNEL = "@MasakoffVpns";
const LOOP_TEXT = "👆Yokarky koda 5je like basyň täze kod goyjak♥️✅️";

// Track last channel post and last reply
let lastPostId: number | null = null;
let lastReplyId: number | null = null;

// --- Send reply under the last post ---
async function sendReply() {
  if (!lastPostId) return;

  try {
    // Delete previous reply if exists
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

    // Send new reply
    const resp = await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TARGET_CHANNEL,
        text: LOOP_TEXT,
        reply_to_message_id: lastPostId,
      }),
    });

    const data = await resp.json();
    if (data.ok) {
      lastReplyId = data.result.message_id;
    } else {
      console.error("Failed to send reply:", data);
    }
  } catch (e) {
    console.error("Error sending reply:", e);
  }
}

// --- Loop every 1 minute ---
setInterval(sendReply, 60_000);
sendReply(); // run immediately

// --- Webhook server ---
serve(async (req: Request) => {
  if (new URL(req.url).pathname !== SECRET_PATH) {
    return new Response("Not Found", { status: 404 });
  }

  const update = await req.json();

  // Update last post ID if new post appears in channel
  if (update.channel_post) {
    const post = update.channel_post;
    const fromUsername = `@${post.chat?.username}`;
    if (fromUsername.toLowerCase() === TARGET_CHANNEL.toLowerCase()) {
      lastPostId = post.message_id;

      // Delete old reply immediately if exists
      if (lastReplyId) {
        await fetch(`${TELEGRAM_API}/deleteMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: TARGET_CHANNEL,
            message_id: lastReplyId,
          }),
        });
        lastReplyId = null;
      }

      // Optional: send reply immediately to new post
      sendReply();
    }
  }

  return new Response("ok");
});

