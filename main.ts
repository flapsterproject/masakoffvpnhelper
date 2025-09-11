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

// --- Copy media with footer ---
async function copyMessageWithFooter(fromChat: string, messageId: number, toChat: string, footer: string) {
  await fetch(`${TELEGRAM_API}/copyMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: toChat,
      from_chat_id: fromChat,
      message_id: messageId,
      caption: footer, // only works for media
      parse_mode: "HTML",
    }),
  });
}

// --- Infinite reply loop ---
async function replyLoop() {
  try {
    // Get last post from target channel
    const resp = await fetch(`${TELEGRAM_API}/getChatHistory`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TARGET_CHANNEL,
        limit: 1, // just the last message
      }),
    });

    const data = await resp.json();
    if (!data.ok || !data.result?.messages?.length) {
      console.error("No messages found in channel:", data);
      return;
    }

    const lastPost = data.result.messages[0];
    const lastPostId = lastPost.message_id;

    // Reply text
    const replyText = "👆Yokarky koda 5je like basyň täze kod goyjak♥️✅️";

    // Send reply
    const replyResp = await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TARGET_CHANNEL,
        text: replyText,
        reply_to_message_id: lastPostId,
      }),
    });

    const replyData = await replyResp.json();
    if (!replyData.ok) {
      console.error("Failed to send reply:", replyData);
      return;
    }

    const replyMsgId = replyData.result.message_id;

    // Delete after 60 seconds
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
    console.error("replyLoop error:", e);
  }
}

// Run infinite loop every ~61s
setInterval(replyLoop, 61_000);

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
      ? `@${msg.forward_from_chat.username}` // if forwarded
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
  }

  // Footer with original channel/username
  const footer = `\n\n📌 Çeşme: ${fromUsername}`;

  // Forward if from source channel or specific users
  if (
    SOURCE_CHANNELS.some(
      (c) => c.toLowerCase() === fromUsername.toLowerCase(),
    ) ||
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
      // Media only
      await copyMessageWithFooter(
        fromChatId.toString(),
        messageId,
        TARGET_CHANNEL,
        footer,
      );
    }
  }

  return new Response("ok");
});








