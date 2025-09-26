// main.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";


// -------------------- Config --------------------
const TOKEN = Deno.env.get("BOT_TOKEN");
if (!TOKEN) throw new Error("BOT_TOKEN env var is required");

const API = `https://api.telegram.org/bot${TOKEN}`;
const SECRET_PATH = "/masakoffvpnhelper";
const TELEGRAM_MAX_FILE_SIZE = 50_000_000; // 50 MB

// -------------------- Telegram Helpers --------------------
async function sendMessage(chatId: string, text: string) {
  try {
    await fetch(`${API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  } catch (e) {
    console.error("sendMessage error:", e);
  }
}

async function sendVideo(chatId: string, videoUrl: string, caption = "") {
  try {
    await fetch(`${API}/sendVideo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        video: videoUrl,
        caption,
      }),
    });
  } catch (e) {
    console.error("sendVideo error:", e);
  }
}

// -------------------- Video Download Helpers --------------------
function extractYouTubeID(url: string): string | null {
  const regExp =
    /^.*(?:youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
  const match = url.match(regExp);
  return match && match[1].length === 11 ? match[1] : null;
}

async function getYouTubeLink(url: string): Promise<string | null> {
  const videoId = extractYouTubeID(url);
  if (!videoId) return null;

  try {
    const info = await ytdl.getInfo(`https://www.youtube.com/watch?v=${videoId}`);
    // Choose highest quality mp4 format
    const format = info.formats
      .filter(f => f.mimeType?.includes("video/mp4"))
      .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0];

    return format?.url || null;
  } catch (e) {
    console.error("YouTube download error:", e);
    return null;
  }
}

async function getDownloadLink(url: string): Promise<string | null> {
  try {
    // TikTok & Instagram via SnapSave
    if (url.includes("tiktok.com") || url.includes("instagram.com")) {
      const res = await fetch("https://api.snapsave.app/v1/info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      return data?.data?.[0]?.url || null;
    }

    // YouTube
    if (url.includes("youtube.com") || url.includes("youtu.be")) {
      return await getYouTubeLink(url);
    }

    return null;
  } catch (e) {
    console.error("getDownloadLink error:", e);
    return null;
  }
}

// -------------------- HTTP Handler --------------------
console.log("Telegram bot is running...");

serve(async (req) => {
  const urlPath = new URL(req.url).pathname;
  if (urlPath !== SECRET_PATH) {
    return new Response("Not Found", { status: 404 });
  }

  try {
    const update = await req.json();

    if (update.message?.text) {
      const chatId = String(update.message.chat.id);
      const text = update.message.text.trim();

      if (
        text.includes("tiktok.com") ||
        text.includes("instagram.com") ||
        text.includes("youtube.com") ||
        text.includes("youtu.be")
      ) {
        await sendMessage(chatId, "⏳ Downloading your video...");

        const videoUrl = await getDownloadLink(text);

        if (videoUrl) {
          if (videoUrl.length > TELEGRAM_MAX_FILE_SIZE) {
            await sendMessage(
              chatId,
              `⚠️ Video is too large for Telegram. Download directly here: ${videoUrl}`,
            );
          } else {
            await sendVideo(chatId, videoUrl, "Here is your video 🎥");
          }
        } else {
          await sendMessage(chatId, "❌ Failed to download this video.");
        }
      }
    }
  } catch (err) {
    console.error("Update handling error:", err);
  }

  return new Response("ok");
});



