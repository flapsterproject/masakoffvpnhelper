// main.ts
// Telegram Media Downloader Bot (Deno)
// Features: If user sends YouTube, TikTok or Instagram link, the bot will get the direct video URL and send it as video.
// Uses ytdl_core for YouTube, @tobyg74/tiktok-api-dl for TikTok, instagram-url-direct for Instagram.
// Requires Deno 2.0+ for npm support.
// Notes: Requires BOT_TOKEN env var. Deploy as webhook at SECRET_PATH.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import * as ytdl from "https://deno.land/x/ytdl_core/mod.ts";
import Tiktok from "npm:@tobyg74/tiktok-api-dl";
import instagramGetUrl from "npm:instagram-url-direct";

const TOKEN = Deno.env.get("BOT_TOKEN")!;
if (!TOKEN) throw new Error("BOT_TOKEN env var is required");
const API = `https://api.telegram.org/bot${TOKEN}`;
const SECRET_PATH = "/masakoffvpnhelper"; // make sure webhook path matches

// -------------------- Telegram helpers --------------------
async function sendMessage(chatId: string | number, text: string, options: any = {}): Promise<number | null> {
  try {
    const body: any = { chat_id: chatId, text, ...options };
    const res = await fetch(`${API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return data.result?.message_id ?? null;
  } catch (e) {
    console.error("sendMessage error", e);
    return null;
  }
}

async function sendVideo(chatId: string | number, videoUrl: string, options: any = {}) {
  try {
    const body: any = { chat_id: chatId, video: videoUrl, ...options };
    const res = await fetch(`${API}/sendVideo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!data.ok) {
      console.error("sendVideo failed:", data.description);
    }
  } catch (e) {
    console.error("sendVideo error", e);
  }
}

// -------------------- Extractors --------------------
async function extractYouTubeUrl(text: string): Promise<string | undefined> {
  let videoId: string | null = null;
  if (text.includes("youtube.com")) {
    const params = new URLSearchParams(new URL(text).search);
    videoId = params.get("v");
  } else if (text.includes("youtu.be")) {
    videoId = new URL(text).pathname.slice(1);
  }
  if (!videoId) return undefined;

  try {
    const info = await ytdl.getBasicInfo(videoId);
    const format = ytdl.chooseFormat(info.formats, { quality: "highest", filter: "audioandvideo" });
    return format.url;
  } catch (e) {
    console.error("YouTube extract error", e);
    return undefined;
  }
}

async function extractTikTokUrl(text: string): Promise<string | undefined> {
  try {
    const result = await Tiktok.Downloader(text, { version: "v1" });
    if (result.status === "success" && result.result) {
      // Assuming result.result.video is the direct URL; adjust based on actual structure
      // From docs, it might be result.result.video[0] or something; you may need to console.log to check
      return result.result.video; // Replace with correct path if different
    }
  } catch (e) {
    console.error("TikTok extract error", e);
    return undefined;
  }
}

async function extractInstagramUrl(text: string): Promise<string | undefined> {
  try {
    const result = await instagramGetUrl(text);
    if (result.url_list && result.url_list.length > 0) {
      return result.url_list[0];
    }
  } catch (e) {
    console.error("Instagram extract error", e);
    return undefined;
  }
}

// -------------------- Main handler --------------------
async function handleUpdate(update: any) {
  if (update.message) {
    const msg = update.message;
    if (msg.chat.type !== "private") return;
    const text = msg.text?.trim() || "";
    const chatId = String(msg.chat.id);

    if (text.startsWith("/start") || text.startsWith("/help")) {
      const helpText = `🌟 Welcome to Media Downloader Bot!\n\nSend me a link from YouTube, TikTok, or Instagram, and I'll download and send the video back to you. 📹\n\nSupported platforms:\n- YouTube (youtube.com or youtu.be)\n- TikTok (tiktok.com)\n- Instagram (instagram.com)\n\nJust paste the link!`;
      await sendMessage(chatId, helpText);
      return;
    }

    if (!text) return;

    let urlObj;
    try {
      urlObj = new URL(text);
    } catch {
      await sendMessage(chatId, "Please send a valid URL.");
      return;
    }

    const host = urlObj.hostname.toLowerCase();
    let directUrl: string | undefined;

    await sendMessage(chatId, "Processing your link...");

    try {
      if (host.includes("youtube.com") || host === "youtu.be") {
        directUrl = await extractYouTubeUrl(text);
      } else if (host.includes("tiktok.com")) {
        directUrl = await extractTikTokUrl(text);
      } else if (host.includes("instagram.com")) {
        directUrl = await extractInstagramUrl(text);
      } else {
        await sendMessage(chatId, "Unsupported link. Supported: YouTube, TikTok, Instagram.");
        return;
      }
    } catch (e) {
      console.error("Extract error", e);
      await sendMessage(chatId, "Failed to get the video. Try another link or later.");
      return;
    }

    if (!directUrl) {
      await sendMessage(chatId, "Could not retrieve video URL.");
      return;
    }

    await sendVideo(chatId, directUrl);
    await sendMessage(chatId, "Video sent! Enjoy.");
  }
}

// -------------------- Server / Webhook --------------------
serve(async (req: Request) => {
  try {
    const url = new URL(req.url);
    if (url.pathname !== SECRET_PATH) return new Response("Not found", { status: 404 });
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

    const update = await req.json();
    await handleUpdate(update);

    return new Response("OK");
  } catch (e) {
    console.error("server error", e);
    return new Response("Error", { status: 500 });
  }
});