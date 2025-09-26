// main.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

// -------------------- Telegram Setup --------------------
const TOKEN = Deno.env.get("BOT_TOKEN");
if (!TOKEN) throw new Error("BOT_TOKEN env var is required");

const API = `https://api.telegram.org/bot${TOKEN}`;
const SECRET_PATH = "/masakoffvideobot";

// -------------------- Telegram Helpers --------------------
async function sendMessage(chatId: string, text: string) {
  await fetch(`${API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

async function sendVideoFile(chatId: string, filePath: string) {
  const file = await Deno.readFile(filePath);
  const formData = new FormData();
  formData.append("chat_id", chatId);
  formData.append("video", new Blob([file]), "video.mp4");

  await fetch(`${API}/sendVideo`, { method: "POST", body: formData });
}

// -------------------- Utils --------------------
function extractUrl(text: string): string | null {
  const regex = /(https?:\/\/[^\s]+)/g;
  const match = text.match(regex);
  return match ? match[0] : null;
}

// -------------------- Video Download --------------------
async function downloadVideo(url: string): Promise<string | null> {
  try {
    const filePath = `video_${Date.now()}.mp4`;

    const cmd = new Deno.Command("yt-dlp", {
      args: ["-f", "mp4", "-o", filePath, url],
      stdout: "piped",
      stderr: "piped",
    });

    const { code, stdout, stderr } = await cmd.output();

    if (code === 0) {
      console.log("yt-dlp success:", new TextDecoder().decode(stdout));
      return filePath;
    } else {
      console.error("yt-dlp failed:", new TextDecoder().decode(stderr));
      return null;
    }
  } catch (err) {
    console.error("yt-dlp execution error:", err);
    return null;
  }
}

// -------------------- HTTP Handler --------------------
serve(async (req) => {
  const { pathname } = new URL(req.url);
  if (pathname !== SECRET_PATH) return new Response("Not found", { status: 404 });

  try {
    const update = await req.json();

    if (update.message?.text) {
      const chatId = String(update.message.chat.id);
      const text = update.message.text;
      const url = extractUrl(text);

      if (
        url &&
        (url.includes("tiktok.com") ||
          url.includes("instagram.com") ||
          url.includes("youtube.com") ||
          url.includes("youtu.be"))
      ) {
        await sendMessage(chatId, "⬇️ Downloading your video...");

        const filePath = await downloadVideo(url);
        if (filePath) {
          await sendVideoFile(chatId, filePath);
          await Deno.remove(filePath); // cleanup
        } else {
          await sendMessage(chatId, "❌ Failed to download this video.");
        }
      } else if (text === "/start") {
        await sendMessage(
          chatId,
          "👋 Send me a TikTok, Instagram, or YouTube link and I'll fetch the video for you."
        );
      }
    }
  } catch (err) {
    console.error("Update handling error:", err);
  }

  return new Response("ok");
});
