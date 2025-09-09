// main.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const TOKEN = Deno.env.get("BOT_TOKEN")!;
const TELEGRAM_API = `https://api.telegram.org/bot${TOKEN}`;
const SECRET_PATH = "/masakoffvpnhelper";

// Çeşme kanallaryň sanawy (isleseň goşup bolýar)
const SOURCE_CHANNELS = ["@TkmRace", "@SERWERSTM1"]; 
// Hemme habarlary iberjek maksat kanal
const TARGET_CHANNEL = "@MasakoffVpn";

// Ýatda saklanan soňky habarlaryň ID-si (duplikatyň öňüni almak üçin)
const lastMessages: Record<string, string> = {};

// HTML-dan taglary aýyrmak üçin kömekçi funksiýa
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

// Public kanaldan iň soňky habary almak
async function fetchLastPost(channel: string): Promise<{ id: string; text: string } | null> {
  try {
    const res = await fetch(`https://t.me/s/${channel}`);
    const html = await res.text();

    // Telegram postlarynyň HTML bloklaryny tap
    const matches = [...html.matchAll(/<div class="tgme_widget_message"[^>]*data-post="([^"]+)"[^>]*>([\s\S]*?)<\/div>/g)];
    if (matches.length === 0) return null;

    // Iň soňky post
    const last = matches[matches.length - 1];
    const postId = last[1];
    const textMatch = last[2].match(/<div class="tgme_widget_message_text js-message_text"[^>]*>([\s\S]*?)<\/div>/);

    const text = textMatch ? stripHtml(textMatch[1]) : "(media post)";

    return { id: postId, text };
  } catch (e) {
    console.error("Fetch error:", e);
    return null;
  }
}

// Habary maksat kanala ibermek
async function sendToTargetChannel(text: string, source: string) {
  const footer = `\n\n🔄 Bu habar @${source} kanalynyň paýlaşan habary`;
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

// Webhook hyzmatkär
serve(async (req: Request) => {
  if (new URL(req.url).pathname !== SECRET_PATH) {
    return new Response("Tapylmady", { status: 404 });
  }

  // Her kanaldan iň soňky habary barla
  for (const ch of SOURCE_CHANNELS) {
    const post = await fetchLastPost(ch.replace("@", ""));
    if (post && lastMessages[ch] !== post.id) {
      lastMessages[ch] = post.id; // täze ID ýatla
      await sendToTargetChannel(post.text, ch.replace("@", ""));
    }
  }

  return new Response("ok");
});




