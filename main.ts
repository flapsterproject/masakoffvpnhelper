// main.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const TOKEN = Deno.env.get("BOT_TOKEN")!;
const TELEGRAM_API = `https://api.telegram.org/bot${TOKEN}`;
const SECRET_PATH = "/masakoffvpnhelper";

// Public channels (without @ in URL)
const SOURCE_CHANNELS = ["TkmRace", "SERWERSTM1"];
const TARGET_CHANNEL = "@MasakoffVpn";

// Keep track of last forwarded posts to avoid duplicates
const lastMessages: Record<string, string> = {};

// Helper: strip HTML tags
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

// Fetch last post from public channel
async function fetchLastPost(channel: string): Promise<{ id: string; text: string } | null> {
  try {
    const res = await fetch(`https://t.me/s/${channel}`);
    const html = await res.text();

    const matches = [...html.matchAll(/<div class="tgme_widget_message"[^>]*data-post="([^"]+)"[^>]*>([\s\S]*?)<\/div>/g)];
    if (matches.length === 0) return null;

    const last = matches[matches.length - 1];
    const postId = last[1];
    const textMatch = last[2].match(/<div class="tgme_widget_message_text js-message_text"[^>]*>([\s\S]*?)<\/div>/);

    const text = textMatch ? stripHtml(textMatch[1]) : null;
    if (!text) return null; // skip media-only posts

    return { id: postId, text };
  } catch (e) {
    console.error("Fetch error:", e);
    return null;
  }
}

// Send message to target channel with footer
async function sendToTargetChannel(text: string, source: string) {
  const footer = `\n\n📌 Çeşme: @${source}`;
  await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: TARGET_CHANNEL,
      text: text + footer,
      parse_mode: "HTML",
    }),
  });
}

// Webhook handler
serve(async (req: Request) => {
  if (new URL(req.url).pathname !== SECRET_PATH) {
    return new Response("Not Found", { status: 404 });
  }

  for (const ch of SOURCE_CHANNELS) {
    const post = await fetchLastPost(ch);
    if (post && lastMessages[ch] !== post.id) {
      lastMessages[ch] = post.id; // mark as forwarded
      await sendToTargetChannel(post.text, ch);
      console.log(`Forwarded post from @${ch}`);
    }
  }

  return new Response("ok");
});



