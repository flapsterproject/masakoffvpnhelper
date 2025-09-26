// main.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const TOKEN = Deno.env.get("BOT_TOKEN")!;
if (!TOKEN) throw new Error("BOT_TOKEN env var is required");

const API = `https://api.telegram.org/bot${TOKEN}`;
const SECRET_PATH = "/masakoffhelper";

// Deno KV
const kv = await Deno.openKv();
const ADMIN_USERNAME = "@amangeldimasakov"; // Change if needed

// External downloader API (for simplicity)
// You can replace with your own service or library
async function fetchDownloadUrl(url: string): Promise<string | null> {
  try {
    // Example free API (may have limits)
    const res = await fetch(`https://save-from.net/api/convert?url=${encodeURIComponent(url)}`);
    const data = await res.json();
    return data?.url || null;
  } catch (e) {
    console.error("Downloader error:", e);
    return null;
  }
}

async function sendMessage(chatId: number, text: string) {
  await fetch(`${API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

async function sendVideo(chatId: number, videoUrl: string) {
  await fetch(`${API}/sendVideo`, {
    method: "POST",
    body: JSON.stringify({
      chat_id: chatId,
      video: videoUrl,
    }),
    headers: { "Content-Type": "application/json" },
  });
}

function extractUrl(text: string): string | null {
  const regex = /(https?:\/\/[^\s]+)/g;
  const match = text.match(regex);
  return match ? match[0] : null;
}

serve(async (req: Request) => {
  const { pathname } = new URL(req.url);

  if (pathname !== SECRET_PATH) {
    return new Response("Not found", { status: 404 });
  }

  const update = await req.json();

  if (update?.message?.text) {
    const chatId = update.message.chat.id;
    const text = update.message.text;
    const url = extractUrl(text);

    if (url && (url.includes("tiktok.com") || url.includes("instagram.com") || url.includes("youtube.com") || url.includes("youtu.be"))) {
      await sendMessage(chatId, "Downloading your video, please wait...");

      const videoUrl = await fetchDownloadUrl(url);
      if (videoUrl) {
        await sendVideo(chatId, videoUrl);
      } else {
        await sendMessage(chatId, "❌ Failed to fetch video. Try another link.");
      }
    } else if (text === "/start") {
      await sendMessage(chatId, "👋 Send me a TikTok, Instagram, or YouTube link and I'll fetch the video for you.");
    }
  }

  return new Response("OK");
});
