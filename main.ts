// main.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const kv = await Deno.openKv();

const initialChannels = ["@FlapsterMiner"];
const ch = await kv.get(["channels"]);
if (!ch.value) {
  await kv.set(["channels"], initialChannels);
}

const TOKEN = Deno.env.get("BOT_TOKEN");
const SECRET_PATH = "/masakoffvpnhelper"; // change this
const TELEGRAM_API = `https://api.telegram.org/bot${TOKEN}`;
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

  // Function to get channels from KV
  async function getChannels(): Promise<string[]> {
    const res = await kv.get(["channels"]);
    return res.value as string[] || [];
  }

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
    const channels = await getChannels();
    if (channels.length === 0) return true; // If no channels, consider subscribed
    for (const channel of channels) {
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

  // Handle admin /addchannel command
  if (text?.startsWith("/addchannel")) {
    if (username !== ADMIN_USERNAME) {
      await sendMessage(chatId, "⚠️ Bu buýruga rugsadyňyz ýok! 🚫");
      return new Response("OK", { status: 200 });
    }
    const parts = text.split(" ");
    if (parts.length < 2) {
      await sendMessage(chatId, "Kanallary goşmak üçin /addchannel @channel_name ýaly iberiň. 📢");
      return new Response("OK", { status: 200 });
    }
    const newChannel = parts[1];
    if (!newChannel.startsWith("@")) {
      await sendMessage(chatId, "Kanal ady @ bilen başlamaly. 📢");
      return new Response("OK", { status: 200 });
    }
    let channels = await getChannels();
    if (channels.includes(newChannel)) {
      await sendMessage(chatId, "Bu kanal eýýäm goşuldy! 📢");
      return new Response("OK", { status: 200 });
    }
    channels.push(newChannel);
    await kv.set(["channels"], channels);
    await sendMessage(chatId, `Kanal ${newChannel} üstünlikli goşuldy! ✅📢`);
    return new Response("OK", { status: 200 });
  }

  // Handle admin /changefile command
  if (text === "/changefile") {
    if (username !== ADMIN_USERNAME) {
      await sendMessage(chatId, "⚠️ Bu buýruga rugsadyňyz ýok! 🚫");
      return new Response("OK", { status: 200 });
    }
    await kv.set(["admin_state", chatId], "waiting_for_file");
    await sendMessage(chatId, "Maňa faýly iberiň. 📁");
    return new Response("OK", { status: 200 });
  }

  // Handle file upload from admin
  if (document) {
    const state = await kv.get(["admin_state", chatId]);
    if (state.value === "waiting_for_file" && username === ADMIN_USERNAME) {
      const fileId = document.file_id;
      await kv.set(["current_file_id"], fileId);
      await kv.delete(["admin_state", chatId]);
      await sendMessage(chatId, "Faýl üstünlikli täzelendi! ✅📄");
      return new Response("OK", { status: 200 });
    }
  }

  // Handle /start command
  if (text?.startsWith("/start")) {
    const subscribed = await isSubscribed(userId);
    const channels = await getChannels();

    if (subscribed) {
      await sendMessage(chatId, "🎉 Ähli kanallara agza bolanyňyz üçin sag boluň! Vpnden Lezzet alyň. 🤖👍");
      const file = await kv.get(["current_file_id"]);
      if (file.value) {
        await sendDocument(chatId, file.value as string);
      }
    } else {
      await sendMessage(chatId, "⚠️ Ilki ähli kanallara agza bolmaly! Agza bolanyňyzdan soň aşakdaky düwmä basyň. 📢", {
        inline_keyboard: [
          [{ text: "AGZA BOLDUM✅", callback_data: "check_sub" }],
          ...channels.map(channel => [{ text: ` ${channel} 🚀`, url: `https://t.me/${channel.replace("@","")}` }])
        ]
      });
    }
  }

  // Handle inline button click
  if (data === "check_sub" && messageId) {
    const subscribed = await isSubscribed(userId);
    const channels = await getChannels();
    const textToSend = subscribed
      ? "🎉 Siz ähli kanallara agza bolduňyz! Vpnden Lezzet alyň. 🤖👍"
      : "⚠️ Siz ähli kanallara agza däl. Ilki olara goşulyň! 📢";

    await fetch(`${TELEGRAM_API}/editMessageText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text: textToSend,
        reply_markup: subscribed ? undefined : {
          inline_keyboard: [
            [{ text: "AGZA BOLDUM✅", callback_data: "check_sub" }],
            ...channels.map(channel => [{ text: ` ${channel} 🚀`, url: `https://t.me/${channel.replace("@","")}` }])
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