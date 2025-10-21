// main.ts
// 💬 Masakoff Sarcastic AI Bot
// ⚡ Creates sarcastic images if user says "make" or "create"

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { GoogleGenerativeAI } from "npm:@google/generative-ai@^0.19.0";

// Telegram setup
const TOKEN = Deno.env.get("BOT_TOKEN");
const API = `https://api.telegram.org/bot${TOKEN}`;
const SECRET_PATH = "/masakoffrobot";

// Gemini setup
const GEMINI_API_KEY = "AIzaSyC2tKj3t5oTsrr_a0B1mDxtJcdyeq5uL0U";
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
const imageModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// -------------------- Telegram Helpers --------------------
async function sendMessage(chatId: string | number, text: string, replyToMessageId?: number) {
  const res = await fetch(`${API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      reply_to_message_id: replyToMessageId,
      allow_sending_without_reply: true,
    }),
  });
  const data = await res.json();
  return data.result?.message_id;
}

async function sendPhoto(chatId: string | number, imageUrl: string, caption?: string) {
  await fetch(`${API}/sendPhoto`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      photo: imageUrl,
      caption,
    }),
  });
}

// -------------------- Gemini Response Generator --------------------
async function generateResponse(prompt: string): Promise<string> {
  try {
    const fullPrompt = `Respond as a witty, realistic human — use sarcasm, keep it very short (1–2 sentences), add emojis, and write naturally in Turkmen, as if chatting with a friend online: ${prompt}`;
    const result = await model.generateContent(fullPrompt);
    return result.response.text();
  } catch (error) {
    console.error("Gemini text error:", error);
    return "Hmm... beynim togtady 🤖💤";
  }
}

async function generateSarcasticImage(prompt: string): Promise<string | null> {
  try {
    const imgPrompt = `Create a sarcastic, funny image based on this request: ${prompt}. 
Style: realistic yet ironic, slightly humorous and AI-generated looking.`;
    const result = await imageModel.generateContent([
      { text: imgPrompt },
    ]);
    const image = result.response.candidates?.[0]?.content?.parts?.[0]?.inlineData;
    if (!image) return null;

    const imageBase64 = image.data;
    const blob = Uint8Array.from(atob(imageBase64), (c) => c.charCodeAt(0));
    const file = new Blob([blob], { type: "image/png" });

    // Upload image to Telegram's file API
    const formData = new FormData();
    formData.append("chat_id", "0"); // just dummy
    formData.append("photo", file, "sarcastic.png");

    // We can’t directly host the image — but for demonstration:
    // you could upload it to an external file storage if needed
    // For now, return null (you can replace this with your uploader)
    return null;
  } catch (error) {
    console.error("Gemini image error:", error);
    return null;
  }
}

// -------------------- HTTP Handler --------------------
serve(async (req) => {
  try {
    const update = await req.json();

    if (update.message) {
      const chatId = String(update.message.chat.id);
      const text = update.message.text;
      const messageId = update.message.message_id;

      if (text) {
        const lower = text.toLowerCase();
        if (lower.includes("make") || lower.includes("create")) {
          // Step 1: Generate image
          const imgUrl = await generateSarcasticImage(text);

          if (imgUrl) {
            await sendPhoto(chatId, imgUrl, "Here’s your ‘masterpiece’ 😏🎨");
          } else {
            await sendMessage(chatId, "Şekil döredip bilmedim... AI ýadady 😴", messageId);
          }

          // Step 2: Sarcastic description
          const desc = await generateResponse(
            `Describe the image sarcastically in Turkmen, like a funny friend would: ${text}`,
          );
          await sendMessage(chatId, desc);
        } else {
          // Normal witty chat mode
          const botResponse = await generateResponse(text);
          await sendMessage(chatId, botResponse, messageId);
        }
      }
    }
  } catch (err) {
    console.error("Error handling update:", err);
  }

  return new Response("ok");
});



