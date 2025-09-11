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

// Keep active loop
let activeLoop: number | null = null;
let activePostId: number | null = null;

// --- Copy media with footer ---
async function copyMessageWithFooter(
  fromChat: string,
  messageId: number,
  toChat: string,
  footer: string,
) {
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

// --- Forward logic ---
async function forwardToTarget(
  fromUsername: string,
  text: string,
  fromChatId: string,
  messageId: number,
) {
  const footer = `\n\n📌 Çeşme: ${fromUsername}`;

  if (text) {
    // Text messages: send as new message so they stay copyable
    const resp = await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TARGET_CHANNEL,
        text: text + footer,
        parse_mode: "HTML",
      }),
    });

    const data = await resp.json();
    if (data.ok) {
      // After sending, start reply loop on this post
      const postId = data.result.message_id;
      setTimeout(() => startReplyingLoop(postId), 5000);
    }
  } else {
    // Media messages: copy with footer caption
    const resp = await fetch(`${TELEGRAM_API}/copyMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TARGET_CHANNEL,
        from_chat_id: fromChatId,
        message_id: messageId,
        caption: footer,
        parse_mode: "HTML",
      }),
    });

    const data = await resp.json();
    if (data.ok) {
      // After sending, start reply loop on this post
      const postId = data.result.message_id;
      setTimeout(() => startReplyingLoop(postId), 5000);
    }
  }
}

// --- Start infinite reply loop under latest post ---
function startReplyingLoop(postId: number) {
  // Stop old loop if exists
  if (activeLoop !== null) {
    clearInterval(activeLoop);
    activeLoop = null;
  }

  activePostId = postId;
  const replyText =
    "👆Yokarky koda 10 like basyň täze kod goyjak♥️✅️";

  async function loop() {
    try {
      if (!activePostId) return;

      // Send reply
      const replyResp = await fetch(`${TELEGRAM_API}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: TARGET_CHANNEL,
          text: replyText,
          reply_to_message_id: activePostId,
        }),
      });

      const replyData = await replyResp.json();
      if (!replyData.ok) {
        console.error("Failed to send reply:", replyData);
        return;
      }

      const replyMsgId = replyData.result.message_id;

      // Delete after 60s
      setTimeout(async () => {
        await fetch(`${TELEGRAM_API}/deleteMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: TARGET_CHANNEL,
            message_id: replyMsgId,
          }),
        });
      }, 60_000);
    } catch (e) {
      console.error("Reply loop error:", e);
    }
  }

  // Run loop every 10 minutes
  activeLoop = setInterval(loop, 300_000);
  setTimeout(loop, 5000); // first reply after 5 seconds
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
    fromUsername = msg.forward_from_chat?.username
      ? `@${msg.forward_from_chat.username}`
      : `@${msg.from?.username}`;
    messageId = msg.message_id;
    fromChatId = msg.chat.id;
    text = msg.text ?? "";
  } else if (update.channel_post) {
    const post = update.channel_post;
    fromUsername = `@${post.chat?.username}`;
    messageId = post.message_id;
    fromChatId = post.chat.id;
    text = post.text ?? post.caption ?? "";

    // 🔥 If new post in @MasakoffVpns, restart reply loop after 5s
    if (`@${post.chat.username}`.toLowerCase() === TARGET_CHANNEL.toLowerCase()) {
      setTimeout(() => startReplyingLoop(messageId), 5000);
    }
  }

  // Forward if from source channel or specific users
  if (
    SOURCE_CHANNELS.some((c) => c.toLowerCase() === fromUsername.toLowerCase()) ||
    SPECIFIC_USERS.some(
      (u) =>
        update.message?.from?.username?.toLowerCase() ===
        u.replace("@", "").toLowerCase(),
    )
  ) {
    await forwardToTarget(
      fromUsername,
      text,
      fromChatId.toString(),
      messageId,
    );
  }

  return new Response("ok");
});














