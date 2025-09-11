// main.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const TOKEN = Deno.env.get("BOT_TOKEN")!;
const TELEGRAM_API = `https://api.telegram.org/bot${TOKEN}`;
const SECRET_PATH = "/masakoffvpnhelper";

// Source channels
const SOURCE_CHANNELS = ["@TkmRace", "@SERWERSTM1"];
// Target channel
const TARGET_CHANNEL = "@MasakoffVpns";
// Specific users to forward
const SPECIFIC_USERS = ["@amangeldimasakov", "@Tm_happ_kripto"];

const LOOP_TEXT = "👆Yokarky koda 5je like basyň täze kod goyjak♥️✅️";

// Track last bot reply
let lastReplyId: number | null = null;
// Track current post bot replies to
let currentPostId: number | null = null;

// --- Copy media with footer ---
async function copyMessageWithFooter(fromChat: string, messageId: number, toChat: string, footer: string) {
  await fetch(`${TELEGRAM_API}/copyMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: toChat,
      from_chat_id: fromChat,
      message_id: messageId,
      caption: footer,
      parse_mode: "HTML",
    }),
  });
}

// --- Reply to a post ---
async function replyToPost(postId: number) {
  try {
    // Delete previous bot reply if exists
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

    // Send new reply under the post
    const resp = await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TARGET_CHANNEL,
        text: LOOP_TEXT,
        reply_to_message_id: postId,
      }),
    });

    const data = await resp.json();
    if (data.ok) {
      lastReplyId = data.result.message_id;
      currentPostId = postId;
    } else {
      console.error("Failed to send reply:", data);
    }
  } catch (e) {
    console.error("Error replying to post:", e);
  }
}

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

    // --- Handle /bot command in the channel ---
    if (text?.trim() === "/bot" && msg.reply_to_message) {
      // Delete the /bot message from the same chat (could be channel)
      await fetch(`${TELEGRAM_API}/deleteMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: msg.chat.id, // correct chat (channel)
          message_id: messageId,
        }),
      });

      // Reply to the post user replied to
      const repliedPostId = msg.reply_to_message.message_id;
      replyToPost(repliedPostId);
    }

  } else if (update.channel_post) {
    const post = update.channel_post;
    fromUsername = `@${post.chat?.username}`;
    messageId = post.message_id;
    fromChatId = post.chat.id;
    text = post.text ?? post.caption ?? "";

    // If new post in target channel and no manual /bot assigned, start replying
    if (fromUsername.toLowerCase() === TARGET_CHANNEL.toLowerCase() && currentPostId === null) {
      replyToPost(messageId);
    }
  }

  const footer = `\n\n📌 Çeşme: ${fromUsername}`;

  // Forward messages from source channels or specific users
  if (
    SOURCE_CHANNELS.some((c) => c.toLowerCase() === fromUsername.toLowerCase()) ||
    SPECIFIC_USERS.some(
      (u) =>
        update.message?.from?.username?.toLowerCase() ===
        u.replace("@", "").toLowerCase(),
    )
  ) {
    if (text) {
      await fetch(`${TELEGRAM_API}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: TARGET_CHANNEL,
          text: text + footer,
          parse_mode: "HTML",
        }),
      });
    } else {
      await copyMessageWithFooter(fromChatId.toString(), messageId, TARGET_CHANNEL, footer);
    }
  }

  return new Response("ok");
});
