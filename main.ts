import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const kv = await Deno.openKv();
const TELEGRAM_API = `https://api.telegram.org/bot${Deno.env.get("BOT_TOKEN")}`;
const API_SERVER_URL = "http://213.176.72.67:6000";
const CLIENT_API_KEY = "tmshop-aiapi_250f0b6b206ea27203a6c00ba61039cf60f0a5a788fbf02f700bf80e8c704b78";
const SECRET_PATH = "/masakoffvpnhelper";
const CHANNELS = ["MasakoffVpns", "AMERICAN_VPN", "POLO_SHXP"];
const ADMIN_USERNAME = "Masakoff";

interface UserData {
  api_key: string;
  chat_history: Array<{ role: string; content: string }>;
  image_settings?: { model: string; awaiting_prompt: boolean; has_image?: boolean; file_id?: string };
  video_settings?: { model: string; awaiting_prompt: boolean };
}

const user_data: { [user_id: number]: UserData } = {};

const IMAGE_STATUSES = [
  "🖼️ Generating image... 🎨[▓▓▓▓▓▓░░░░] 50%",
  "🖼️ Generating image... ✨[▓▓▓▓▓▓▓▓░░] 70%",
  "🖼️ Generating image... 🌈[▓▓▓▓▓▓▓▓▓▓] 100%",
  "🎨 Creating masterpiece... 🎭[▓▓▓▓▓░░░░░] 40%",
  "🎨 Creating masterpiece... ✨[▓▓▓▓▓▓▓▓▓▓] 100%",
  "✨ Surrealism forming... 🦄[▓▓▓▓▓▓░░░░] 60%",
  "✨ Surrealism forming... 🌟[▓▓▓▓▓▓▓▓▓▓] 100%",
  "🖌️ Preparing palette... 🎨[▓▓▓▓░░░░░░] 30%",
  "🖌️ Preparing palette... 🌈[▓▓▓▓▓▓▓▓▓▓] 100%",
  "🌟 Collecting stardust... ✨[▓▓▓▓▓▓▓░░░] 70%",
  "🌟 Collecting stardust... 💫[▓▓▓▓▓▓▓▓▓▓] 100%"
];

const VIDEO_STATUSES = [
  "🎬 Generating video... 🎞️[▓▓▓▓░░░░░░] 30%",
  "🎬 Generating video... 🎭[▓▓▓▓▓▓▓░░░] 70%",
  "🎬 Generating video... ✨[▓▓▓▓▓▓▓▓▓▓] 100%",
  "🎞️ Compiling frames... 🎬[▓▓▓▓▓░░░░░] 50%",
  "🎞️ Compiling frames... 🌟[▓▓▓▓▓▓▓▓▓▓] 100%",
  "🎭 Preparing spectacle... 🎪[▓▓▓▓▓▓░░░░] 60%",
  "🎭 Preparing spectacle... ✨[▓▓▓▓▓▓▓▓▓▓] 100%",
  "🌟 Gathering stars... 🌠[▓▓▓▓▓▓▓░░░] 70%",
  "🌟 Gathering stars... 🎥[▓▓▓▓▓▓▓▓▓▓] 100%",
  "🚀 Creating cosmic video... 🌌[▓▓▓▓▓▓▓▓░░] 80%",
  "🚀 Creating cosmic video... ✨[▓▓▓▓▓▓▓▓▓▓] 100%"
];

async function getChannelTitle(channel: string): Promise<string> {
  try {
    const res = await fetch(`${TELEGRAM_API}/getChat?chat_id=@${channel}`);
    const data = await res.json();
    if (data.ok) {
      return data.result.title;
    }
  } catch (e) {
    console.error(e);
  }
  return channel;
}

async function sendMessage(cid: number, msg: string, markup?: any) {
  await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: cid,
      text: msg,
      parse_mode: "HTML",
      reply_markup: markup
    })
  });
}

async function sendPhoto(cid: number, photoUrl: string, caption: string) {
  const response = await fetch(photoUrl);
  const arrayBuffer = await response.arrayBuffer();
  const blob = new Blob([arrayBuffer]);
  const formData = new FormData();
  formData.append("chat_id", cid.toString());
  formData.append("photo", blob, "generated_image.png");
  formData.append("caption", caption);
  formData.append("parse_mode", "HTML");

  await fetch(`${TELEGRAM_API}/sendPhoto`, {
    method: "POST",
    body: formData
  });
}

async function sendVideo(cid: number, videoUrl: string, caption: string) {
  const response = await fetch(videoUrl);
  const arrayBuffer = await response.arrayBuffer();
  const blob = new Blob([arrayBuffer]);
  const formData = new FormData();
  formData.append("chat_id", cid.toString());
  formData.append("video", blob, "generated_video.mp4");
  formData.append("caption", caption);
  formData.append("parse_mode", "HTML");

  await fetch(`${TELEGRAM_API}/sendVideo`, {
    method: "POST",
    body: formData
  });
}

async function isSubscribed(uid: number): Promise<boolean> {
  for (const channel of CHANNELS) {
    try {
      const res = await fetch(`${TELEGRAM_API}/getChatMember?chat_id=@${channel}&user_id=${uid}`);
      const data = await res.json();
      if (!data.ok) return false;
      const status = data.result.status;
      if (status === "left" || status === "kicked") return false;
    } catch (e) {
      console.error(e);
      return false;
    }
  }
  return true;
}

async function verifyApiKey(apiKey: string): Promise<any> {
  try {
    const res = await fetch(`${API_SERVER_URL}/api/v1/verify`, {
      headers: { "Authorization": `Bearer ${apiKey}` }
    });
    return await res.json();
  } catch (e) {
    console.error(e);
    return { ok: false, error: String(e) };
  }
}

async function sendChatMessage(userId: number, message: string): Promise<any> {
  try {
    if (!user_data[userId]) {
      user_data[userId] = { api_key: CLIENT_API_KEY, chat_history: [] };
    }
    user_data[userId].chat_history.push({ role: "user", content: message });

    const response = await fetch(`${API_SERVER_URL}/api/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${user_data[userId].api_key}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "anthropic/claude-3-haiku",
        messages: user_data[userId].chat_history,
        temperature: 0.7,
        max_tokens: 1000
      })
    });

    const data = await response.json();
    if (response.status === 200 || response.status === 201) {
      let content = "";
      if (data.choices?.[0]?.message?.content) {
        content = data.choices[0].message.content;
      } else if (data.content) {
        content = data.content;
      }

      if (content) {
        user_data[userId].chat_history.push({ role: "assistant", content });
        if (user_data[userId].chat_history.length > 10) {
          user_data[userId].chat_history = user_data[userId].chat_history.slice(-10);
        }
        return { success: true, response: content };
      }
    }
    return { success: false, error: `API error: ${response.status}` };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

async function generateImage(userId: number, prompt: string, model: string, size: string, imageUrl?: string): Promise<any> {
  try {
    const data: any = { model, prompt, size };
    if (imageUrl) data.filesUrl = [imageUrl];

    const response = await fetch(`${API_SERVER_URL}/api/v1/images/generations`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${user_data[userId].api_key}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(data)
    });

    if (response.status === 200 || response.status === 201) {
      const result = await response.json();
      const requestId = result.requestId || result.id;
      if (requestId) {
        const imageUrl = await checkImageStatus(requestId, userId);
        if (imageUrl) {
          return { success: true, image_url: imageUrl, request_id: requestId };
        }
      }
    }
    return { success: false, error: "Image generation failed" };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

async function generateVideo(userId: number, prompt: string, model: string): Promise<any> {
  try {
    const response = await fetch(`${API_SERVER_URL}/api/v1/videos/generations`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${user_data[userId].api_key}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ model, prompt })
    });

    if (response.status === 200 || response.status === 201) {
      const result = await response.json();
      const requestId = result.requestId || result.id;
      if (requestId) {
        const videoUrl = await checkVideoStatus(requestId, userId);
        if (videoUrl) {
          return { success: true, video_url: videoUrl, request_id: requestId };
        }
      }
    }
    return { success: false, error: "Video generation failed" };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

async function checkImageStatus(requestId: string, userId: number): Promise<string | null> {
  for (let i = 0; i < 30; i++) {
    await new Promise(resolve => setTimeout(resolve, 3000));
    try {
      const response = await fetch(`${API_SERVER_URL}/api/v1/images/${requestId}`, {
        headers: { "Authorization": `Bearer ${user_data[userId].api_key}` }
      });
      if (response.status === 200) {
        const result = await response.json();
        if (result.status === "COMPLETED") return result.url;
        if (result.status === "FAILED") return null;
      }
    } catch (e) {
      console.error(e);
    }
  }
  return null;
}

async function checkVideoStatus(requestId: string, userId: number): Promise<string | null> {
  for (let i = 0; i < 60; i++) {
    await new Promise(resolve => setTimeout(resolve, 5000));
    try {
      const response = await fetch(`${API_SERVER_URL}/api/v1/videos/${requestId}`, {
        headers: { "Authorization": `Bearer ${user_data[userId].api_key}` }
      });
      if (response.status === 200) {
        const result = await response.json();
        if (result.status === "COMPLETED") return result.url;
        if (result.status === "FAILED") return null;
      }
    } catch (e) {
      console.error(e);
    }
  }
  return null;
}

serve(async (req: Request) => {
  const { pathname } = new URL(req.url);
  if (pathname !== SECRET_PATH) {
    return new Response("Bot is running.", { status: 200 });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const update = await req.json();
  const message = update.message;
  const callbackQuery = update.callback_query;
  const chatId = message?.chat?.id || callbackQuery?.message?.chat?.id;
  const userId = message?.from?.id || callbackQuery?.from?.id;
  const text = message?.text;
  const data = callbackQuery?.data;
  const messageId = callbackQuery?.message?.message_id;
  const username = message?.from?.username;
  const photo = message?.photo;

  if (!chatId || !userId) return new Response("No chat ID or user ID", { status: 200 });

  if (text === "/start") {
    const subscribed = await isSubscribed(userId);
    if (subscribed) {
      user_data[userId] = { api_key: CLIENT_API_KEY, chat_history: [] };
      const keyboard = {
        inline_keyboard: [
          [{ text: "🔑 Set API Key", callback_data: "set_api_key" }, { text: "💬 Start Chat", callback_data: "start_chat" }],
          [{ text: "🖼️ Generate Image", callback_data: "image_generation" }, { text: "🎬 Generate Video", callback_data: "video_generation" }],
          [{ text: "💰 Check Balance", callback_data: "check_balance" }]
        ]
      };
      await sendMessage(chatId, 
        "🤖 <b>Welcome to TM Shop AI Bot!</b>\n\n" +
        "• 💬 <b>Smart Chat</b> - Talk with AI\n" +
        "• 🖼️ <b>Image Generation</b> - Create and edit images\n" +
        "• 🎬 <b>Video Generation</b> - Create videos\n" +
        "• 💰 <b>Balance System</b> - Monitor expenses\n\n" +
        "Start by setting your API key or use the default one!",
        keyboard
      );
    } else {
      const channelButtons = [];
      for (const channel of CHANNELS) {
        const title = await getChannelTitle(channel);
        channelButtons.push([{ text: `${title} 🚀`, url: `https://t.me/${channel}` }]);
      }
      await sendMessage(chatId, 
        "⚠️ Please subscribe to all channels first! Click the button below after subscribing. 📢",
        { inline_keyboard: [...channelButtons, [{ text: "SUBSCRIBED✅", callback_data: "check_sub" }]] }
      );
    }
  }

  if (data === "check_sub" && messageId) {
    const subscribed = await isSubscribed(userId);
    if (subscribed) {
      user_data[userId] = { api_key: CLIENT_API_KEY, chat_history: [] };
      const keyboard = {
        inline_keyboard: [
          [{ text: "🔑 Set API Key", callback_data: "set_api_key" }, { text: "💬 Start Chat", callback_data: "start_chat" }],
          [{ text: "🖼️ Generate Image", callback_data: "image_generation" }, { text: "🎬 Generate Video", callback_data: "video_generation" }],
          [{ text: "💰 Check Balance", callback_data: "check_balance" }]
        ]
      };
      await fetch(`${TELEGRAM_API}/editMessageText`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: messageId,
          text: "🎉 You are subscribed to all channels! Enjoy the AI features. 🤖👍",
          parse_mode: "HTML",
          reply_markup: keyboard
        })
      });
    } else {
      const channelButtons = [];
      for (const channel of CHANNELS) {
        const title = await getChannelTitle(channel);
        channelButtons.push([{ text: `${title} 🚀`, url: `https://t.me/${channel}` }]);
      }
      await fetch(`${TELEGRAM_API}/editMessageText`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: messageId,
          text: "⚠️ You are not subscribed to all channels. Please subscribe! 📢",
          parse_mode: "HTML",
          reply_markup: { inline_keyboard: [...channelButtons, [{ text: "SUBSCRIBED✅", callback_data: "check_sub" }]] }
        })
      });
    }
    await fetch(`${TELEGRAM_API}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackQuery.id })
    });
  }

  if (data === "set_api_key") {
    await fetch(`${TELEGRAM_API}/editMessageText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text: "🔑 <b>Set API Key</b>\n\n" +
              "Send your API key in the format:\n" +
              "<code>/setkey your_api_key</code>\n\n" +
              "<b>Example:</b>\n" +
              "<code>/setkey tmshop-aiapi_...</code>",
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [[{ text: "⬅️ Back", callback_data: "back_to_main" }]] }
      })
    });
  }

  if (text?.startsWith("/setkey")) {
    const apiKey = text.split(" ")[1];
    if (!apiKey || !apiKey.startsWith("tmshop-")) {
      await sendMessage(chatId, "❌ <b>Invalid API key format.</b> Key must start with 'tmshop-'.");
      return new Response("OK", { status: 200 });
    }

    const verifyResult = await verifyApiKey(apiKey);
    if (verifyResult.ok) {
      user_data[userId] = { api_key: apiKey, chat_history: [] };
      await kv.set(["user_api_key", userId], apiKey);
      await sendMessage(chatId, 
        `✅ <b>API key set successfully!</b>\n\n` +
        `🔑 Key: <code>${apiKey.slice(0, 20)}...</code>\n` +
        `👤 User ID: ${verifyResult.user_id || 'Unknown'}\n` +
        `💰 Balance: ${verifyResult.balance?.toFixed(3) || 0} TMT\n` +
        `📅 Expires: ${verifyResult.expires_at || 'Unknown'}`,
        {
          inline_keyboard: [
            [{ text: "💬 Start Chat", callback_data: "start_chat" }],
            [{ text: "🖼️ Generate Image", callback_data: "image_generation" }, { text: "🎬 Generate Video", callback_data: "video_generation" }],
            [{ text: "💰 Check Balance", callback_data: "check_balance" }]
          ]
        }
      );
    } else {
      await sendMessage(chatId, `❌ <b>Error:</b> ${verifyResult.error || "Invalid API key"}`);
    }
  }

  if (data === "image_generation") {
    if (!user_data[userId]) {
      await fetch(`${TELEGRAM_API}/editMessageText`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: messageId,
          text: "❌ <b>Please set an API key first!</b>",
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [{ text: "🔑 Set API Key", callback_data: "set_api_key" }, { text: "⬅️ Back", callback_data: "back_to_main" }]
            ]
          }
        })
      });
      return new Response("OK", { status: 200 });
    }

    await fetch(`${TELEGRAM_API}/editMessageText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text: "🖼️ <b>Image Generation</b>\n\n" +
              "Select an image generation model:\n\n" +
              "• <b>🎨 Nano-banana</b> - Edit existing images\n" +
              "• <b>🖼️ GPT-4o Image</b> - Generate images from scratch\n" +
              "• <b>✨ Seedream 4.0</b> - Advanced generation with quality options\n\n" +
              "<i>Select a model, then send the image prompt.</i>",
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: "🎨 Nano-banana", callback_data: "img_model_nano-banana" },
             { text: "🖼️ GPT-4o Image", callback_data: "img_model_gpt4o-image" }],
            [{ text: "✨ Seedream 4.0", callback_data: "img_model_seedream-v4" },
             { text: "⬅️ Back", callback_data: "back_to_main" }]
          ]
        }
      })
    });
  }

  if (data?.startsWith("img_model_")) {
    const modelId = data.replace("img_model_", "");
    user_data[userId].image_settings = { model: modelId, awaiting_prompt: true };
    
    const modelNames: { [key: string]: string } = {
      "nano-banana": "Nano-banana",
      "gpt4o-image": "GPT-4o Image",
      "seedream-v4": "Seedream 4.0"
    };
    
    const modelInfo: { [key: string]: string } = {
      "nano-banana": "Great for editing existing images. Send an image and modification prompt.",
      "gpt4o-image": "Generate images from text descriptions.",
      "seedream-v4": "Advanced generation with adjustable quality (up to 4K)."
    };

    await fetch(`${TELEGRAM_API}/editMessageText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text: `🎨 <b>Selected model: ${modelNames[modelId]}</b>\n\n` +
              `${modelInfo[modelId]}\n\n` +
              "<b>Send the image prompt:</b>\n" +
              "<i>Example: 'A sunset over a desert with a caravan'</i>",
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: "🔄 Choose another model", callback_data: "image_generation" },
             { text: "⬅️ Back", callback_data: "back_to_main" }]
          ]
        }
      })
    });
  }

  if (data === "video_generation") {
    if (!user_data[userId]) {
      await fetch(`${TELEGRAM_API}/editMessageText`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: messageId,
          text: "❌ <b>Please set an API key first!</b>",
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [{ text: "🔑 Set API Key", callback_data: "set_api_key" }, { text: "⬅️ Back", callback_data: "back_to_main" }]
            ]
          }
        })
      });
      return new Response("OK", { status: 200 });
    }

    await fetch(`${TELEGRAM_API}/editMessageText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text: "🎬 <b>Video Generation</b>\n\n" +
              "Select a video generation model:\n\n" +
              "• <b>🎬 Veo 3</b> - High-quality video generation\n" +
              "• <b>⚡ Veo 3 Fast</b> - Quick video generation\n" +
              "• <b>🔥 Kling 2.5</b> - Next-gen video generator\n" +
              "• <b>🎥 Wan 2.5</b> - Advanced text-to-video model\n\n" +
              "<i>Select a model, then send the video prompt.</i>",
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: "🎬 Veo 3", callback_data: "video_model_veo3" },
             { text: "⚡ Veo 3 Fast", callback_data: "video_model_veo3-fast" }],
            [{ text: "🔥 Kling 2.5", callback_data: "video_model_kling2.5-text-to-video" },
             { text: "🎥 Wan 2.5", callback_data: "video_model_wan2.5-text-to-video" }],
            [{ text: "⬅️ Back", callback_data: "back_to_main" }]
          ]
        }
      })
    });
  }

  if (data?.startsWith("video_model_")) {
    const modelId = data.replace("video_model_", "");
    user_data[userId].video_settings = { model: modelId, awaiting_prompt: true };
    
    const modelNames: { [key: string]: string } = {
      "veo3": "Veo 3",
      "veo3-fast": "Veo 3 Fast",
      "kling2.5-text-to-video": "Kling 2.5",
      "wan2.5-text-to-video": "Wan 2.5"
    };
    
    const modelInfo: { [key: string]: string } = {
      "veo3": "High-quality video generation. May take 5-10 minutes.",
      "veo3-fast": "Fast video generation. May take 2-5 minutes.",
      "kling2.5-text-to-video": "Next-gen AI video generator. Realistic videos.",
      "wan2.5-text-to-video": "Advanced text-to-video model. High resolution."
    };

    await fetch(`${TELEGRAM_API}/editMessageText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text: `🎬 <b>Selected model: ${modelNames[modelId]}</b>\n\n` +
              `${modelInfo[modelId]}\n\n` +
              "<b>Send the video prompt:</b>\n" +
              "<i>Example: 'A person walking on the moon, 2D animation'</i>",
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: "🔄 Choose another model", callback_data: "video_generation" },
             { text: "⬅️ Back", callback_data: "back_to_main" }]
          ]
        }
      })
    });
  }

  if (photo && user_data[userId]?.image_settings?.awaiting_prompt) {
    user_data[userId].image_settings.has_image = true;
    user_data[userId].image_settings.file_id = photo[photo.length - 1].file_id;
    await sendMessage(chatId, 
      "📸 <b>Image received!</b>\n\n" +
      "Now send the modification prompt:\n" +
      "<i>Example: 'Make the image black-and-white with a vintage effect'</i>"
    );
  }

  if (text && !text.startsWith("/") && user_data[userId]) {
    if (user_data[userId].image_settings?.awaiting_prompt) {
      const prompt = text;
      const model = user_data[userId].image_settings.model;
      user_data[userId].image_settings.awaiting_prompt = false;

      let statusMessage = await sendMessage(chatId, IMAGE_STATUSES[Math.floor(Math.random() * IMAGE_STATUSES.length)]);
      await new Promise(resolve => setTimeout(resolve, 2000));
      await fetch(`${TELEGRAM_API}/editMessageText`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: statusMessage.message_id,
          text: IMAGE_STATUSES[Math.floor(Math.random() * IMAGE_STATUSES.length)].replace("100%", "70%"),
          parse_mode: "HTML"
        })
      });
      await new Promise(resolve => setTimeout(resolve, 2000));
      await fetch(`${TELEGRAM_API}/editMessageText`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: statusMessage.message_id,
          text: IMAGE_STATUSES.find(s => s.includes("100%")) || "🖼️ Image ready! ✨",
          parse_mode: "HTML"
        })
      });

      let imageUrl: string | undefined;
      if (user_data[userId].image_settings.has_image) {
        const file = await fetch(`${TELEGRAM_API}/getFile?file_id=${user_data[userId].image_settings.file_id}`);
        const fileData = await file.json();
        imageUrl = `https://api.telegram.org/file/bot${Deno.env.get("BOT_TOKEN")}/${fileData.result.file_path}`;
      }

      const result = await generateImage(userId, prompt, model, "1:1", imageUrl);
      await fetch(`${TELEGRAM_API}/deleteMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, message_id: statusMessage.message_id })
      });

      if (result.success && result.image_url) {
        await sendPhoto(chatId, result.image_url, 
          `🎨 <b>Image generated!</b>\n\n` +
          `<b>Model:</b> ${model}\n` +
          `<b>Prompt:</b> ${prompt}\n` +
          `<b>Request ID:</b> <code>${result.request_id}</code>`
        );
      } else {
        await sendMessage(chatId, `❌ <b>Image generation error:</b> ${result.error || "Unknown error"}`);
      }
    } else if (user_data[userId].video_settings?.awaiting_prompt) {
      const prompt = text;
      const model = user_data[userId].video_settings.model;
      user_data[userId].video_settings.awaiting_prompt = false;

      let statusMessage = await sendMessage(chatId, VIDEO_STATUSES[Math.floor(Math.random() * VIDEO_STATUSES.length)]);
      await new Promise(resolve => setTimeout(resolve, 3000));
      await fetch(`${TELEGRAM_API}/editMessageText`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: statusMessage.message_id,
          text: VIDEO_STATUSES[Math.floor(Math.random() * VIDEO_STATUSES.length)].replace("100%", "70%"),
          parse_mode: "HTML"
        })
      });
      await new Promise(resolve => setTimeout(resolve, 3000));
      await fetch(`${TELEGRAM_API}/editMessageText`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: statusMessage.message_id,
          text: VIDEO_STATUSES.find(s => s.includes("100%")) || "🎬 Video ready! ✨",
          parse_mode: "HTML"
        })
      });

      const result = await generateVideo(userId, prompt, model);
      await fetch(`${TELEGRAM_API}/deleteMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, message_id: statusMessage.message_id })
      });

      if (result.success && result.video_url) {
        await sendVideo(chatId, result.video_url,
          `🎬 <b>Video generated!</b>\n\n` +
          `<b>Model:</b> ${model}\n` +
          `<b>Prompt:</b> ${prompt}\n` +
          `<b>Request ID:</b> <code>${result.request_id}</code>`
        );
      } else {
        await sendMessage(chatId, `❌ <b>Video generation error:</b> ${result.error || "Unknown error"}`);
      }
    } else {
      const statusMessage = await sendMessage(chatId, "🤖 <i>AI is thinking...</i>");
      const result = await sendChatMessage(userId, text);
      await fetch(`${TELEGRAM_API}/deleteMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, message_id: statusMessage.message_id })
      });

      if (result.success) {
        await sendMessage(chatId, `🤖 ${result.response}`);
      } else {
        await sendMessage(chatId, `❌ <b>Error:</b> ${result.error}`);
      }
    }
  }

  if (data === "start_chat") {
    if (!user_data[userId]) {
      await fetch(`${TELEGRAM_API}/editMessageText`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: messageId,
          text: "❌ <b>Please set an API key first!</b>",
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [{ text: "🔑 Set API Key", callback_data: "set_api_key" }, { text: "⬅️ Back", callback_data: "back_to_main" }]
            ]
          }
        })
      });
      return new Response("OK", { status: 200 });
    }

    await fetch(`${TELEGRAM_API}/editMessageText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text: "💬 <b>Chat with AI started!</b>\n\n" +
              "<b>Current model:</b> <code>anthropic/claude-3-haiku</code>\n\n" +
              "Send your message to get an AI response.\n\n" +
              "<b>Chat commands:</b>\n" +
              "• /clear - Clear chat history\n" +
              "• /balance - Check balance\n" +
              "• /back - Return to main menu",
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [[{ text: "⬅️ Back", callback_data: "back_to_main" }]]
        }
      })
    });
  }

  if (text === "/clear") {
    if (user_data[userId]) {
      user_data[userId].chat_history = [];
      await sendMessage(chatId, "✅ <b>Chat history cleared!</b>");
    }
  }

  if (text === "/balance") {
    if (!user_data[userId]) {
      await sendMessage(chatId, "❌ <b>Please set an API key first!</b>");
      return new Response("OK", { status: 200 });
    }

    const result = await verifyApiKey(user_data[userId].api_key);
    if (result.ok) {
      await sendMessage(chatId,
        `💰 <b>Your balance:</b> <code>${result.balance?.toFixed(3)} TMT</code>\n\n` +
        `<b>Current model:</b> <code>anthropic/claude-3-haiku</code>\n` +
        `<b>User ID:</b> <code>${result.user_id}</code>\n` +
        `<b>Expires:</b> ${result.expires_at}`,
        {
          inline_keyboard: [
            [{ text: "💬 Start Chat", callback_data: "start_chat" }],
            [{ text: "⬅️ Back", callback_data: "back_to_main" }]
          ]
        }
      );
    } else {
      await sendMessage(chatId, `❌ <b>Could not check balance:</b> ${result.error}`);
    }
  }

  if (data === "check_balance") {
    if (!user_data[userId]) {
      await fetch(`${TELEGRAM_API}/editMessageText`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: messageId,
          text: "❌ <b>Please set an API key first!</b>",
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [{ text: "🔑 Set API Key", callback_data: "set_api_key" }, { text: "⬅️ Back", callback_data: "back_to_main" }]
            ]
          }
        })
      });
      return new Response("OK", { status: 200 });
    }

    const result = await verifyApiKey(user_data[userId].api_key);
    if (result.ok) {
      await fetch(`${TELEGRAM_API}/editMessageText`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: messageId,
          text: `💰 <b>Your balance:</b> <code>${result.balance?.toFixed(3)} TMT</code>\n\n` +
                `<b>Current model:</b> <code>anthropic/claude-3-haiku</code>\n` +
                `<b>User ID:</b> <code>${result.user_id}</code>\n` +
                `<b>Expires:</b> ${result.expires_at}`,
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [{ text: "💬 Start Chat", callback_data: "start_chat" }],
              [{ text: "⬅️ Back", callback_data: "back_to_main" }]
            ]
          }
        })
      });
    } else {
      await fetch(`${TELEGRAM_API}/editMessageText`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: messageId,
          text: `❌ <b>Could not check balance:</b> ${result.error}`,
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [{ text: "🔄 Try Again", callback_data: "check_balance" }, { text: "⬅️ Back", callback_data: "back_to_main" }]
            ]
          }
        })
      });
    }
  }

  if (data === "back_to_main") {
    await fetch(`${TELEGRAM_API}/editMessageText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text: "🤖 <b>TM Shop AI Bot - Main Menu</b>\n\n" +
              "• 💬 <b>Smart Chat</b> - Talk with AI\n" +
              "• 🖼️ <b>Image Generation</b> - Create and edit images\n" +
              "• 🎬 <b>Video Generation</b> - Create videos\n" +
              "• 💰 <b>Balance System</b> - Monitor expenses\n\n" +
              "Choose an action:",
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: "🔑 Set API Key", callback_data: "set_api_key" }, { text: "💬 Start Chat", callback_data: "start_chat" }],
            [{ text: "🖼️ Generate Image", callback_data: "image_generation" }, { text: "🎬 Generate Video", callback_data: "video_generation" }],
            [{ text: "💰 Check Balance", callback_data: "check_balance" }]
          ]
        }
      })
    });
  }

  return new Response("OK", { status: 200 });
});