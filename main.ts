import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

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

async function sendVideo(chatId: string, videoUrl: string, caption = "") {
  await fetch(`${API}/sendVideo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, video: videoUrl, caption }),
  });
}

async function sendAudio(chatId: string, audioUrl: string, caption = "") {
  await fetch(`${API}/sendAudio`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, audio: audioUrl, caption }),
  });
}

// -------------------- Video Download Helper (Example) --------------------
async function getVideoLinks(url: string) {
  // Replace this with real API calls (TikTok/Instagram/Youtube)
  return {
    "720p": url + "?quality=720",
    "1080p": url + "?quality=1080",
    "audio": url + "?format=mp3",
  };
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
      const videoLinks = await getVideoLinks(text);

      const buttons = [
        [
          { text: "🎬 720p", callback_data: `720p|${videoLinks["720p"]}` },
          { text: "🎬 1080p", callback_data: `1080p|${videoLinks["1080p"]}` },
        ],
        [{ text: "🎵 Audio", callback_data: `audio|${videoLinks["audio"]}` }],
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

    if (type === "audio") await sendAudio(chatId, url, "Here is your audio 🎵");
    else await sendVideo(chatId, url, `Here is your ${type} video 🎬`);
  }

  return new Response("ok");
});





