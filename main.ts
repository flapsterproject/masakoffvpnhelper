// main.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const kv = await Deno.openKv();

const TOKEN = Deno.env.get("BOT_TOKEN");
const SECRET_PATH = "/masakoffvpnhelper"; // change this
const TELEGRAM_API = `https://api.telegram.org/bot${TOKEN}`;
const CHANNELS = ["@FlapsterMiner"]; // your channels
const ADMIN_USERNAME = "Masakoff"; // admin username without @

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
  const document = message?.document;

  if (!chatId || !userId) return new Response("No chat ID or user ID", { status: 200 });

  // Function to send message
  async function sendMessage(cid: number, msg: string, markup?: any) {
    await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: cid,
        text: msg,
        reply_markup: markup
      })
    });
  }

  // Function to send document
  async function sendDocument(cid: number, fileId: string) {
    await fetch(`${TELEGRAM_API}/sendDocument`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: cid,
        document: fileId
      })
    });
  }

  // Function to check subscription
  async function isSubscribed(uid: number) {
    for (const channel of CHANNELS) {
      try {
        const res = await fetch(`${TELEGRAM_API}/getChatMember?chat_id=${channel}&user_id=${uid}`);
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

  // Handle admin /changefile command
  if (text === "/changefile") {
    if (username !== ADMIN_USERNAME) {
      await sendMessage(chatId, "⚠️ You are not authorized to use this command.");
      return new Response("OK", { status: 200 });
    }
    await kv.set(["admin_state", chatId], "waiting_for_file");
    await sendMessage(chatId, "Please send me the file.");
    return new Response("OK", { status: 200 });
  }

  // Handle file upload from admin
  if (document) {
    const state = await kv.get(["admin_state", chatId]);
    if (state.value === "waiting_for_file" && username === ADMIN_USERNAME) {
      const fileId = document.file_id;
      await kv.set(["current_file_id"], fileId);
      await kv.delete(["admin_state", chatId]);
      await sendMessage(chatId, "File updated successfully.");
      return new Response("OK", { status: 200 });
    }
  }

  // Handle /start command
  if (text?.startsWith("/start")) {
    const subscribed = await isSubscribed(userId);

    if (subscribed) {
      await sendMessage(chatId, "🎉 Thank you for subscribing to all channels! You can now use the bot.");
      const file = await kv.get(["current_file_id"]);
      if (file.value) {
        await sendDocument(chatId, file.value as string);
      }
    } else {
      await sendMessage(chatId, "⚠️ You need to subscribe to all channels first! Click the button below after subscribing.", {
        inline_keyboard: [
          [{ text: "Check Subscription ✅", callback_data: "check_sub" }],
          ...CHANNELS.map(channel => [{ text: `Join ${channel}`, url: `https://t.me/${channel.replace("@","")}` }])
        ]
      });
    }
  }

  // Handle inline button click
  if (data === "check_sub" && messageId) {
    const subscribed = await isSubscribed(userId);
    const textToSend = subscribed
      ? "🎉 You are subscribed to all channels! You can now use the bot."
      : "⚠️ You are not subscribed to all channels. Please join them first!";

    await fetch(`${TELEGRAM_API}/editMessageText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text: textToSend,
        reply_markup: subscribed ? undefined : {
          inline_keyboard: [
            [{ text: "Check Subscription ✅", callback_data: "check_sub" }],
            ...CHANNELS.map(channel => [{ text: `Join ${channel}`, url: `https://t.me/${channel.replace("@","")}` }])
          ]
        }
      })
    });

    if (subscribed) {
      const file = await kv.get(["current_file_id"]);
      if (file.value) {
        await sendDocument(chatId, file.value as string);
      }
    }

    // Answer callback query to remove loading
    await fetch(`${TELEGRAM_API}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        callback_query_id: callbackQuery.id
      })
    });
  }

  return new Response("OK", { status: 200 });
});