// main.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const TOKEN = Deno.env.get("BOT_TOKEN")!;
const TELEGRAM_API = `https://api.telegram.org/bot${TOKEN}`;
const SECRET_PATH = "/masakoffvpnhelper";

// Çeşme kanallaryň sanawy (isleseň goşup bolýar)
const SOURCE_CHANNELS = ["@TkmRace", "@AnotherChannel"]; 
// Hemme habarlary iberjek maksat kanal
const TARGET_CHANNEL = "@MasakoffVpn";

// --- Köçürmek (aşagyna ýazgy goşmak bilen) ---
async function copyMessageWithFooter(fromChat: string, messageId: number, toChat: string, footer: string) {
  await fetch(`${TELEGRAM_API}/copyMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: toChat,
      from_chat_id: fromChat,
      message_id: messageId,
      caption: footer,  // diňe surat/wideo bolsa aşagyna ýazgy goýýar
      parse_mode: "HTML"
    }),
  });
}

// --- Webhook hyzmatkär ---
serve(async (req: Request) => {
  if (new URL(req.url).pathname !== SECRET_PATH) {
    return new Response("Tapylmady", { status: 404 });
  }

  const update = await req.json();

  // Eger kanal habary bolsa
  if (update.channel_post) {
    const post = update.channel_post;
    const channelUsername = `@${post.chat?.username}`;

    // Eger çeşme kanallaryň birinden bolsa
    if (SOURCE_CHANNELS.some(c => c.toLowerCase() === channelUsername.toLowerCase())) {
      const footer = `\n\n📌 Çeşme: ${channelUsername} `;

      // Tekst ýa-da caption bar bolsa → täzeden iberýär + ýazgy goşýar
      if (post.text || post.caption) {
        const text = (post.text ?? post.caption ?? "") + footer;
        await fetch(`${TELEGRAM_API}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: TARGET_CHANNEL,
            text,
            parse_mode: "HTML"
          }),
        });
      } else {
        // Diňe media (surat/wideo) bolsa → copyMessage ulanyp ýazgy goşýar
        await copyMessageWithFooter(channelUsername, post.message_id, TARGET_CHANNEL, footer);
      }
    }
  }

  return new Response("ok");
});



