// main.ts
// Telegram YouTube Downloader Bot (Deno)
// Features: If user sends YouTube link, the bot will use RapidAPI to download the video and send it.
// Uses yt-video-audio-downloader-api.p.rapidapi.com for YouTube downloads.
// Requires Deno 2.0+ for npm support.
// Notes: Requires BOT_TOKEN and RAPIDAPI_KEY env vars. Deploy as webhook at SECRET_PATH.
// The RapidAPI key from the photo should be set as RAPIDAPI_KEY env var.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const TOKEN = Deno.env.get("BOT_TOKEN")!;
if (!TOKEN) throw new Error("BOT_TOKEN env var is required");
const RAPIDAPI_KEY = Deno.env.get("RAPIDAPI_KEY")!; // Use the key from the photo: e9cc022650msh59ce424efce38cbp118626jsn2e5efa086...
if (!RAPIDAPI_KEY) throw new Error("RAPIDAPI_KEY env var is required");
const API = `https://api.telegram.org/bot${TOKEN}`;
const SECRET_PATH = "/masakoffvpnhelper"; // make sure webhook path matches
const RAPIDAPI_HOST = "yt-video-audio-downloader-api.p.rapidapi.com";

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
async function getYouTubeDirectUrl(text: string): Promise<string | undefined> {
  try {
    // Initiate download
    const initRes = await fetch(`https://${RAPIDAPI_HOST}/v1/download`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-RapidAPI-Key": RAPIDAPI_KEY,
        "X-RapidAPI-Host": RAPIDAPI_HOST,
      },
      body: JSON.stringify({ url: text, format: "mp4", quality: 720 }),
    });
    if (!initRes.ok) {
      console.error("Init response not ok:", await initRes.text());
      return undefined;
    }
    const initData = await initRes.json();
    const jobId = initData.jobId;
    if (!jobId) return undefined;

    // Poll status until completed
    while (true) {
      await new Promise((r) => setTimeout(r, 5000)); // Wait 5 seconds
      const statusRes = await fetch(`https://${RAPIDAPI_HOST}/status/${jobId}`, {
        method: "GET",
        headers: {
          "X-RapidAPI-Key": RAPIDAPI_KEY,
          "X-RapidAPI-Host": RAPIDAPI_HOST,
        },
      });
      if (!statusRes.ok) {
        console.error("Status response not ok:", await statusRes.text());
        return undefined;
      }
      const statusData = await statusRes.json();
      if (statusData.status === "completed" && statusData.filename) {
        return `https://${RAPIDAPI_HOST}/file/${jobId}/${statusData.filename}`;
      }
      if (statusData.status === "error") return undefined;
    }
  } catch (e) {
    console.error("YouTube extract error", e);
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
      const helpText = `🌟 Welcome to YouTube Downloader Bot!\n\nSend me a YouTube link, and I'll download and send the video back to you. 📹\n\nSupported platform:\n- YouTube (youtube.com or youtu.be)\n\nJust paste the link!`;
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
        directUrl = await getYouTubeDirectUrl(text);
      } else {
        await sendMessage(chatId, "Unsupported link. Supported: YouTube.");
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