// main.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

// Telegram setup
const TOKEN = Deno.env.get("BOT_TOKEN");
if (!TOKEN) throw new Error("BOT_TOKEN env var is required");
const API = `https://api.telegram.org/bot${TOKEN}`;
const SECRET_PATH = "/masakoffvpnhelper";

// -------------------- Telegram Helpers --------------------
async function sendMessage(chatId: string, text: string) {
  await fetch(`${API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

async function sendVideo(chatId: string, videoUrl: string, caption = "") {
  await fetch(`${API}/sendVideo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      video: videoUrl,
      caption,
    }),
  });
}

// -------------------- Video Download Helpers --------------------
async function getDownloadLink(url: string): Promise<string | null> {
  try {
    // TikTok & Instagram (using SnapSave API)
    if (url.includes("tiktok.com") || url.includes("instagram.com")) {
      const res = await fetch("https://api.snapsave.app/v1/info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      return data?.data?.[0]?.url || null;
    }

    // YouTube (example via RapidAPI – replace with your own key)
    if (url.includes("youtube.com") || url.includes("youtu.be")) {
      const res = await fetch(
        "https://youtube-mp36.p.rapidapi.com/dl?id=" + url.split("v=")[1],
        {
          method: "GET",
          headers: {
            "X-RapidAPI-Key": Deno.env.get("RAPIDAPI_KEY")!,
            "X-RapidAPI-Host": "youtube-mp36.p.rapidapi.com",
          },
        },
      );
      const data = await res.json();
      return data?.link || null;
    }

    return null;
  } catch (e) {
    console.error("Downloader error:", e);
    return null;
  }
}

// -------------------- HTTP Handler --------------------
serve(async (req) => {
  if (new URL(req.url).pathname !== SECRET_PATH) {
    return new Response("Not Found", { status: 404 });
  }

  try {
    const update = await req.json();

    if (update.message?.text) {
      const chatId = String(update.message.chat.id);
      const text = update.message.text;

      if (
        text.includes("tiktok.com") ||
        text.includes("instagram.com") ||
        text.includes("youtube.com") ||
        text.includes("youtu.be")
      ) {
        await sendMessage(chatId, "⏳ Downloading your video...");

        const videoUrl = await getDownloadLink(text);

        if (videoUrl) {
          await sendVideo(chatId, videoUrl, "Here is your video 🎥");
        } else {
          await sendMessage(chatId, "❌ Failed to download this video.");
        }
      }
    }
  } catch (err) {
    console.error("Update error:", err);
  }

  return new Response("ok");
});

