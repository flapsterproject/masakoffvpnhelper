import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { exec } from "https://deno.land/x/exec/mod.ts";

const TOKEN = Deno.env.get("BOT_TOKEN");
if (!TOKEN) throw new Error("BOT_TOKEN env var is required");

const API = `https://api.telegram.org/bot${TOKEN}`;
const SECRET_PATH = "/masakoffvpnhelper";

// -------------------- Telegram Helpers --------------------
async function sendMessageWithButtons(chatId: string, text: string, buttons: any) {
  await fetch(`${API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      reply_markup: { inline_keyboard: buttons },
    }),
  });
}

async function sendVideoFile(chatId: string, filePath: string, caption = "") {
  const formData = new FormData();
  formData.append("chat_id", chatId);
  formData.append("caption", caption);
  const file = await Deno.readFile(filePath);
  formData.append("video", new Blob([file]), "video.mp4");

  await fetch(`${API}/sendVideo`, {
    method: "POST",
    body: formData,
  });

  // Delete file after sending
  await Deno.remove(filePath);
}

async function sendAudioFile(chatId: string, filePath: string, caption = "") {
  const formData = new FormData();
  formData.append("chat_id", chatId);
  formData.append("caption", caption);
  const file = await Deno.readFile(filePath);
  formData.append("audio", new Blob([file]), "audio.mp3");

  await fetch(`${API}/sendAudio`, {
    method: "POST",
    body: formData,
  });

  // Delete file after sending
  await Deno.remove(filePath);
}

// -------------------- Video Download Helper --------------------
async function downloadVideo(url: string, format: "720p" | "1080p" | "audio") {
  const filename = format === "audio" ? "audio.mp3" : "video.mp4";
  let ytFormat = "";

  if (format === "720p") ytFormat = "best[height<=720]";
  else if (format === "1080p") ytFormat = "best[height<=1080]";
  else if (format === "audio") ytFormat = "bestaudio";

  // Execute yt-dlp
  await exec(`yt-dlp -f "${ytFormat}" -o "${filename}" "${url}"`);
  return filename;
}

// -------------------- HTTP Handler --------------------
serve(async (req) => {
  const urlPath = new URL(req.url).pathname;
  if (urlPath !== SECRET_PATH) return new Response("Not Found", { status: 404 });

  const update = await req.json();

  const chatId = String(update.message?.chat?.id);
  const text = update.message?.text?.trim();

  if (chatId && text) {
    if (text.includes("tiktok.com") || text.includes("instagram.com") || text.includes("youtube.com") || text.includes("youtu.be")) {
      const buttons = [
        [
          { text: "🎬 720p", callback_data: `720p|${text}` },
          { text: "🎬 1080p", callback_data: `1080p|${text}` },
        ],
        [{ text: "🎵 Audio", callback_data: `audio|${text}` }],
      ];

      await sendMessageWithButtons(chatId, "Select your format:", buttons);
    } else {
      await fetch(`${API}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: "Send a TikTok, Instagram, or YouTube link." }),
      });
    }
  }

  // Handle button presses
  if (update.callback_query) {
    const [type, url] = update.callback_query.data.split("|");
    const chatId = update.callback_query.message.chat.id;

    try {
      if (type === "audio") {
        const filePath = await downloadVideo(url, "audio");
        await sendAudioFile(chatId, filePath, "Here is your audio 🎵");
      } else {
        const filePath = await downloadVideo(url, type as "720p" | "1080p");
        await sendVideoFile(chatId, filePath, `Here is your ${type} video 🎬`);
      }
    } catch (err) {
      console.error(err);
      await fetch(`${API}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: "Failed to download the video. ❌" }),
      });
    }
  }

  return new Response("ok");
});
