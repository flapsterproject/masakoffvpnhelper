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

// Keep active loop + replies
let activeLoop: number | null = null;
let activePostId: number | null = null;
let activeReplies: number[] = [];

// --- Copy message (footer only for media) ---
async function copyMessageWithFooter(
  fromChat: string,
  messageId: number,
  toChat: string,
  footer: string,
  isMedia: boolean,
) {
  const body: Record<string, unknown> = {
    chat_id: toChat,
    from_chat_id: fromChat,
    message_id: messageId,
  };

  if (isMedia) {
    body.caption = footer;
    body.parse_mode = "HTML";
  }

  const resp = await fetch(`${TELEGRAM_API}/copyMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await resp.json();
  if (!data.ok) {
    console.error("Failed to copy message:", data);
  }
}

// --- Start infinite reply loop under only the latest post ---
function startReplyingLoop(postId: number) {
  // 🛑 Stop old loop if exists
  if (activeLoop !== null) {
    clearInterval(activeLoop);
    activeLoop = null;
  }

  // 🧹 Delete old replies
  if (activeReplies.length > 0) {
    for (const rId of activeReplies) {
      fetch(`${TELEGRAM_API}/deleteMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: TARGET_CHANNEL,
          message_id: rId,
        }),
      }).catch(() => {});
    }
    activeReplies = [];
  }

  // Set new post ID
  activePostId = postId;
  const replyText = "👆Yokarky koda 5je like basyň täze kod goyjak♥️✅️";

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
      activeReplies.push(replyMsgId);

      // Auto delete reply after 60s
      setTimeout(async () => {
        await fetch(`${TELEGRAM_API}/deleteMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: TARGET_CHANNEL,
            message_id: replyMsgId,
          }),
        });
        activeReplies = activeReplies.filter((id) => id !== replyMsgId);
      }, 60_000);
    } catch (e) {
      console.error("Reply loop error:", e);
    }
  }

  // Run every 61s
  activeLoop = setInterval(loop, 61_000);
  loop(); // run immediately
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

    // 🔥 Only reply loop for latest post in @MasakoffVpns
    if (`@${post.chat.username}`.toLowerCase() === TARGET_CHANNEL.toLowerCase()) {
      setTimeout(() => startReplyingLoop(messageId), 5000);
    }
  }

  // Footer with original channel/username
  const footer = `\n\n📌 Çeşme: ${fromUsername}`;

  // Forward if from source channel or specific users
  if (
    SOURCE_CHANNELS.some((c) => c.toLowerCase() === fromUsername.toLowerCase()) ||
    SPECIFIC_USERS.some(
      (u) =>
        update.message?.from?.username?.toLowerCase() ===
        u.replace("@", "").toLowerCase(),
    )
  ) {
    const isMedia = !!(
      update.message?.photo ||
      update.message?.video ||
      update.message?.document ||
      update.channel_post?.photo ||
      update.channel_post?.video ||
      update.channel_post?.document
    );

    await copyMessageWithFooter(
      fromChatId.toString(),
      messageId,
      TARGET_CHANNEL,
      footer,
      isMedia,
    );
  }

  return new Response("ok");
});












