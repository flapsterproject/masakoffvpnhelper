// main.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const kv = await Deno.openKv();

const TOKEN = Deno.env.get("BOT_TOKEN");
if (!TOKEN) {
  console.error("BOT_TOKEN ýok. Öňünden gurun.");
  Deno.exit(1);
}
const SECRET_PATH = "/masakoffvpnhelper"; // üýtgetseňiz ýazyň
const TELEGRAM_API = `https://api.telegram.org/bot${TOKEN}`;

// default başlangyç — ýöne admin panelinden dolandyrmak mümkin
async function getChannels(): Promise<string[]> {
  const res = await kv.get<string[]>("channels");
  return res.value ?? [];
}
async function setChannels(channels: string[]) {
  await kv.set("channels", channels);
}

async function getAdmins(): Promise<number[]> {
  const res = await kv.get<number[]>("admins");
  return res.value ?? [];
}
async function setAdmins(admins: number[]) {
  await kv.set("admins", admins);
}

async function getAdList(): Promise<string[]> {
  const res = await kv.get<string[]>("adlist");
  return res.value ?? [];
}
async function setAdList(list: string[]) {
  await kv.set("adlist", list);
}

async function getVpnCodes(): Promise<string[]> {
  const res = await kv.get<string[]>("vpn_codes");
  return res.value ?? [];
}
async function setVpnCodes(codes: string[]) {
  await kv.set("vpn_codes", codes);
}

// Telegram helpers
async function api(method: string, body: any) {
  const res = await fetch(`${TELEGRAM_API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function sendMessage(chat_id: number | string, text: string, reply_markup?: any) {
  return api("sendMessage", { chat_id, text, parse_mode: "HTML", reply_markup });
}

async function editMessageText(chat_id: number | string, message_id: number, text: string, reply_markup?: any) {
  return api("editMessageText", { chat_id, message_id, text, parse_mode: "HTML", reply_markup });
}

async function answerCallback(callback_query_id: string, text?: string, show_alert = false) {
  return api("answerCallbackQuery", { callback_query_id, text, show_alert });
}

// subscription kontrol
async function isSubscribed(userId: number) {
  const channels = await getChannels();
  for (const channel of channels) {
    try {
      const res = await fetch(`${TELEGRAM_API}/getChatMember?chat_id=${encodeURIComponent(channel)}&user_id=${userId}`);
      const data = await res.json();
      if (!data.ok) return false;
      const status = data.result.status;
      if (status === "left" || status === "kicked") return false;
    } catch (e) {
      console.error("getChatMember xəta:", e);
      return false;
    }
  }
  return true;
}

// inline keyboards builders (Türkmençe)
function startKeyboard(channels: string[]) {
  const rows: any[] = [
    [{ text: "Abunalyk barla 📌", callback_data: "check_sub" }],
  ];
  for (const c of channels) {
    const name = c.startsWith("@") ? c : `@${c}`;
    rows.push([{ text: `Gatnaş ${name}`, url: `https://t.me/${name.replace("@", "")}` }]);
  }
  return { inline_keyboard: rows };
}

function adminPanelKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "Kanal goş", callback_data: "admin_add_channel" }, { text: "Kanal aýyr", callback_data: "admin_remove_channel" }],
      [{ text: "Kanal sanawy", callback_data: "admin_list_channels" }],
      [{ text: "Adlist goş (faýl)", callback_data: "admin_upload_adlist" }, { text: "Adlist gör", callback_data: "admin_show_adlist" }],
      [{ text: "VPN kod goş (tekil)", callback_data: "admin_add_vpn" }, { text: "VPN faýl bilen", callback_data: "admin_upload_vpn_file" }],
      [{ text: "Habar iber (tekil)", callback_data: "admin_send_single" }, { text: "Habar iber (toplu)", callback_data: "admin_send_bulk" }],
      [{ text: "Admin goş", callback_data: "admin_add_admin" }, { text: "Admin aýyr", callback_data: "admin_remove_admin" }],
      [{ text: "Çykyş", callback_data: "admin_exit" }]
    ]
  };
}

// admin barlag
async function ensureAdmin(userId: number) {
  const admins = await getAdmins();
  return admins.includes(userId);
}

// get file from Telegram and return text content (assumes small text files like .txt)
async function fetchTelegramFile(file_id: string): Promise<Uint8Array | null> {
  const fileRes = await api("getFile", { file_id });
  if (!fileRes.ok) return null;
  const path = fileRes.result.file_path;
  const url = `https://api.telegram.org/file/bot${TOKEN}/${path}`;
  const r = await fetch(url);
  const data = new Uint8Array(await r.arrayBuffer());
  return data;
}

// parse simple newline separated text into array trimming empties
function parseLines(buf: Uint8Array) {
  const text = new TextDecoder().decode(buf);
  return text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
}

// primary server
serve(async (req: Request) => {
  try {
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
    const text = message?.text;
    const data = callbackQuery?.data;
    const messageId = callbackQuery?.message?.message_id;
    const from = message?.from ?? callbackQuery?.from;
    const userId = from?.id;

    if (!chatId || !userId) return new Response("No chat ID or user", { status: 200 });

    // Handle /start
    if (text?.startsWith("/start")) {
      const channels = await getChannels();
      const subscribed = await isSubscribed(userId);
      if (subscribed) {
        await sendMessage(chatId, "🎉 Siz zerur kanallara agza bolduňyz! Botdan ulanyp bilersiňiz.");
      } else {
        await sendMessage(chatId, "⚠️ VPN kody almak üçin aşakdaky kanallara agza bolmaly. Agza bolan soň 'Abunalyk barla' düwmesine basyň.",
          startKeyboard(channels));
      }
      return new Response("OK", { status: 200 });
    }

    // Handle /admin <admin_secret_id> — ýa-da diňe /admin ulanyň we admin bilen deňleşdiriň
    if (text?.startsWith("/admin")) {
      // `/admin` ýa-da `/admin 12345` ýaly
      const parts = text.split(" ").filter(Boolean);
      const admins = await getAdmins();

      // If no admins yet, första admin = sender
      if (admins.length === 0) {
        await setAdmins([userId]);
        await sendMessage(chatId, "✅ Siz ilkinji admin hökmünde belleňiz. Admin panel açyldy.", adminPanelKeyboard());
        return new Response("OK", { status: 200 });
      }

      // check sender is admin
      if (!(await ensureAdmin(userId))) {
        await sendMessage(chatId, "❌ Bu funksiýany ulanmak üçin admin bolmaly. Admin bolmasaňyz, adminiňiz bilen habarlaşyň.");
        return new Response("OK", { status: 200 });
      }

      // show admin panel
      await sendMessage(chatId, "🛠️ Admin panel\nAşakdaky düwmeler arkaly kanallary, adlistleri we VPN kodlaryny dolandyrmak bolýar.", adminPanelKeyboard());
      return new Response("OK", { status: 200 });
    }

    // Handle callback queries (admin panel actions or subscription check)
    if (data) {
      // subscription check (from /start)
      if (data === "check_sub" && messageId) {
        const subscribed = await isSubscribed(userId);
        const textToSend = subscribed
          ? "🎉 Siz ähli zerur kanallara abunasyňiz! VPN kody üçin admin bilen habarlaşyň ýa-da botdan kody talap ediň."
          : "⚠️ Siz ähli zerur kanallara abuna däl. Haýyş edýäris kanallara goşulyň we soň 'Abunalyk barla' düwmesine basyň.";
        await editMessageText(chatId, messageId, textToSend, subscribed ? undefined : startKeyboard(await getChannels()));
        await answerCallback(callbackQuery.id);
        return new Response("OK", { status: 200 });
      }

      // Admin actions
      if (data.startsWith("admin_")) {
        if (!(await ensureAdmin(userId))) {
          await answerCallback(callbackQuery.id, "Siz admin däl", true);
          return new Response("OK", { status: 200 });
        }

        switch (data) {
          case "admin_add_channel":
            await answerCallback(callbackQuery.id);
            await sendMessage(chatId, "Kanaladyň adyny ýazyň (meselem: @MyChannel ýa-da MyChannel).");
            // We expect next message from admin to contain channel name — store state
            await kv.set(`state:${userId}`, { action: "add_channel" });
            break;

          case "admin_remove_channel":
            await answerCallback(callbackQuery.id);
            await sendMessage(chatId, "Aýrylýan kanalyň adyny ýazyň (meselem: @MyChannel).");
            await kv.set(`state:${userId}`, { action: "remove_channel" });
            break;

          case "admin_list_channels":
            await answerCallback(callbackQuery.id);
            const chs = await getChannels();
            if (chs.length === 0) {
              await sendMessage(chatId, "Kanal sanawy boş.");
            } else {
              await sendMessage(chatId, "Kanalar:\n" + chs.map(c => `• ${c.startsWith("@") ? c : "@" + c}`).join("\n"));
            }
            break;

          case "admin_upload_adlist":
            await answerCallback(callbackQuery.id);
            await sendMessage(chatId, "Adlist faýlyny (.txt) iberiň. Her setirde bir kanal ýa-da ulanyjy ýerleşsin.");
            await kv.set(`state:${userId}`, { action: "upload_adlist" });
            break;

          case "admin_show_adlist":
            await answerCallback(callbackQuery.id);
            const adlist = await getAdList();
            if (adlist.length === 0) {
              await sendMessage(chatId, "Adlist boş.");
            } else {
              await sendMessage(chatId, "Adlist:\n" + adlist.join("\n"));
            }
            break;

          case "admin_add_vpn":
            await answerCallback(callbackQuery.id);
            await sendMessage(chatId, "VPN kodyňy tekst görnüşinde ýazyň (her bir kody täze setirde).");
            await kv.set(`state:${userId}`, { action: "add_vpn_text" });
            break;

          case "admin_upload_vpn_file":
            await answerCallback(callbackQuery.id);
            await sendMessage(chatId, "VPN kody bolan faýly (.txt) iberiň. Her setirde bir kod bolsun.");
            await kv.set(`state:${userId}`, { action: "add_vpn_file" });
            break;

          case "admin_send_single":
            await answerCallback(callbackQuery.id);
            await sendMessage(chatId, "Ibersiňiz gelýän habaryň tekstini ýazyň. (Ulanyja ýa-da kanala ibermek üçin: chat_id ýa-da @username bilen birlikde iberip bilersiňiz.)");
            await kv.set(`state:${userId}`, { action: "send_single" });
            break;

          case "admin_send_bulk":
            await answerCallback(callbackQuery.id);
            await sendMessage(chatId, "Toplu habar ibermek üçin faýl iberiň (.txt) ýa-da adlist-ä degişli sanawy ulanyň. Her setirde bir chat_id ýa-da @username.");
            await kv.set(`state:${userId}`, { action: "send_bulk" });
            break;

          case "admin_add_admin":
            await answerCallback(callbackQuery.id);
            await sendMessage(chatId, "Täze adminiň Telegram ID-sini ýazyň (saniýa görnüşinde).");
            await kv.set(`state:${userId}`, { action: "add_admin" });
            break;

          case "admin_remove_admin":
            await answerCallback(callbackQuery.id);
            await sendMessage(chatId, "Aýrylýan adminiň Telegram ID-sini ýazyň.");
            await kv.set(`state:${userId}`, { action: "remove_admin" });
            break;

          case "admin_exit":
            await answerCallback(callbackQuery.id);
            await sendMessage(chatId, "Admin panelinden çykdyňyz.");
            await kv.delete(`state:${userId}`);
            break;

          default:
            await answerCallback(callbackQuery.id, "Näbelli admin operasiýasy", true);
        }

        return new Response("OK", { status: 200 });
      }

      // unknown callback
      await answerCallback(callbackQuery.id);
      return new Response("OK", { status: 200 });
    }

    // If message is file (document) or text and we have pending state for this admin
    const stateRes = await kv.get<{ action: string }>(`state:${userId}`);
    const state = stateRes.value?.action;

    if (state) {
      switch (state) {
        case "add_channel": {
          const channelName = text?.trim();
          if (!channelName) {
            await sendMessage(chatId, "Kanal adyny yazmadyň. Haýsy kanaly goşmak isleýändigiňizi ýazyň.");
            break;
          }
          const channels = await getChannels();
          const normalized = channelName.startsWith("@") ? channelName : `@${channelName}`;
          if (!channels.includes(normalized)) {
            channels.push(normalized);
            await setChannels(channels);
            await sendMessage(chatId, `✅ ${normalized} kanaly sanawa goşuldy.`);
          } else {
            await sendMessage(chatId, `${normalized} öň goşulan.`);
          }
          await kv.delete(`state:${userId}`);
          break;
        }

        case "remove_channel": {
          const channelName = text?.trim();
          if (!channelName) {
            await sendMessage(chatId, "Aýrylýan kanalyň adyny ýazyň.");
            break;
          }
          const channels = await getChannels();
          const normalized = channelName.startsWith("@") ? channelName : `@${channelName}`;
          const idx = channels.indexOf(normalized);
          if (idx >= 0) {
            channels.splice(idx, 1);
            await setChannels(channels);
            await sendMessage(chatId, `✅ ${normalized} kanaly sanawdan aýryldy.`);
          } else {
            await sendMessage(chatId, `${normalized} sanawda ýok.`);
          }
          await kv.delete(`state:${userId}`);
          break;
        }

        case "upload_adlist": {
          // expect document
          const doc = message?.document;
          if (!doc) {
            await sendMessage(chatId, "Faýl ibermediňiz. .txt görnüşindäki faýly iberiň.");
            break;
          }
          const file_id = doc.file_id;
          const buf = await fetchTelegramFile(file_id);
          if (!buf) {
            await sendMessage(chatId, "Faýly alyp bolmady.");
            break;
          }
          const lines = parseLines(buf);
          const existing = await getAdList();
          const merged = Array.from(new Set([...existing, ...lines]));
          await setAdList(merged);
          await sendMessage(chatId, `✅ Adlist faýly üstünlikli ýüklendi. Toplam: ${merged.length}`);
          await kv.delete(`state:${userId}`);
          break;
        }

        case "add_vpn_text": {
          // Accept text with one or many lines of codes
          if (!text) {
            await sendMessage(chatId, "VPN kodlary ýazylmady. Her setire bir kod goýuň.");
            break;
          }
          const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
          const existing = await getVpnCodes();
          const merged = Array.from(new Set([...existing, ...lines]));
          await setVpnCodes(merged);
          await sendMessage(chatId, `✅ ${lines.length} VPN kod goşuldy. Jemi: ${merged.length}`);
          await kv.delete(`state:${userId}`);
          break;
        }

        case "add_vpn_file": {
          const doc = message?.document;
          if (!doc) {
            await sendMessage(chatId, "Faýl ibermediňiz. .txt faýl iberiň.");
            break;
          }
          const buf = await fetchTelegramFile(doc.file_id);
          if (!buf) {
            await sendMessage(chatId, "Faýly alyp bolmady.");
            break;
          }
          const lines = parseLines(buf);
          const existing = await getVpnCodes();
          const merged = Array.from(new Set([...existing, ...lines]));
          await setVpnCodes(merged);
          await sendMessage(chatId, `✅ Faýldan ${lines.length} kod goşuldy. Jemi: ${merged.length}`);
          await kv.delete(`state:${userId}`);
          break;
        }

        case "send_single": {
          if (!text) {
            await sendMessage(chatId, "Habar teksti ýok. Teksti ýazyň we ýene /admin bilen gaýtadan paneli çagyruň.");
            break;
          }
          // format: optional target on first line, then message; or if no target, broadcast to adlist
          const lines = text.split(/\r?\n/);
          let target = "";
          let messageText = text;
          if (lines[0].startsWith("@") || /^\-?\d+$/.test(lines[0])) {
            target = lines[0].trim();
            messageText = lines.slice(1).join("\n").trim();
          }
          if (!messageText) {
            await sendMessage(chatId, "Habar tekstini ýazmadyň.");
            break;
          }
          if (target) {
            await sendMessage(target, messageText);
            await sendMessage(chatId, `✅ Habar ${target} adresine iberildi.`);
          } else {
            // send to adlist if exists
            const adlist = await getAdList();
            if (adlist.length === 0) {
              await sendMessage(chatId, "Adlist boş. Target görkezmediňiz we adlist ýok.");
            } else {
              for (const t of adlist) {
                try {
                  await sendMessage(t, messageText);
                } catch (e) {
                  console.error("send to", t, e);
                }
                // we do not throttle here; for production add delays
              }
              await sendMessage(chatId, `✅ Toplu habar ${adlist.length} adresine iberildi.`);
            }
          }
          await kv.delete(`state:${userId}`);
          break;
        }

        case "send_bulk": {
          // expect document or use adlist
          const doc = message?.document;
          if (doc) {
            const buf = await fetchTelegramFile(doc.file_id);
            if (!buf) {
              await sendMessage(chatId, "Faýly alyp bolmady.");
              break;
            }
            const targets = parseLines(buf);
            await sendMessage(chatId, "Habar tekstini iberiň (ikitara: adamyňiz / kanaly we habar).");
            await kv.set(`state:${userId}`, { action: "send_bulk_targets", targets });
            break;
          } else {
            // if no file, use adlist by default
            const adlist = await getAdList();
            if (adlist.length === 0) {
              await sendMessage(chatId, "Adlist boş we faýl hem bermediňiz.");
              await kv.delete(`state:${userId}`);
              break;
            }
            await sendMessage(chatId, "Toplu habar tekstini ýazyň; adlistdäki hemme adreslere iberiler.");
            await kv.set(`state:${userId}`, { action: "send_bulk_confirm", targets: adlist });
            break;
          }
        }

        case "send_bulk_targets": {
          // state has targets list
          const s = await kv.get<{ action: string, targets: string[] }>(`state:${userId}`);
          const targets = s.value?.targets ?? [];
          if (!text) {
            await sendMessage(chatId, "Habar tekstini ýazmadyň.");
            break;
          }
          for (const t of targets) {
            try {
              await sendMessage(t, text);
            } catch (e) {
              console.error("bulk send err", e);
            }
          }
          await sendMessage(chatId, `✅ Toplu habar ${targets.length} adresine iberildi.`);
          await kv.delete(`state:${userId}`);
          break;
        }

        case "send_bulk_confirm": {
          const s = await kv.get<{ action: string, targets: string[] }>(`state:${userId}`);
          const targets = s.value?.targets ?? [];
          if (!text) {
            await sendMessage(chatId, "Habar tekstini ýazmadyň.");
            break;
          }
          for (const t of targets) {
            try {
              await sendMessage(t, text);
            } catch (e) {
              console.error("bulk send err", e);
            }
          }
          await sendMessage(chatId, `✅ Toplu habar ${targets.length} adresine iberildi.`);
          await kv.delete(`state:${userId}`);
          break;
        }

        case "add_admin": {
          const idText = text?.trim();
          if (!idText || !/^\-?\d+$/.test(idText)) {
            await sendMessage(chatId, "Dogry Telegram ID-si ýazmadyň. San görnüşinde ID iberiň.");
            break;
          }
          const idn = parseInt(idText, 10);
          const admins = await getAdmins();
          if (!admins.includes(idn)) {
            admins.push(idn);
            await setAdmins(admins);
            await sendMessage(chatId, `✅ ${idn} admin boldy.`);
          } else {
            await sendMessage(chatId, "Bu adam öňden admin.");
          }
          await kv.delete(`state:${userId}`);
          break;
        }

        case "remove_admin": {
          const idText = text?.trim();
          if (!idText || !/^\-?\d+$/.test(idText)) {
            await sendMessage(chatId, "Dogry Telegram ID-si ýazmadyň.");
            break;
          }
          const idn = parseInt(idText, 10);
          let admins = await getAdmins();
          if (admins.includes(idn)) {
            admins = admins.filter(a => a !== idn);
            await setAdmins(admins);
            await sendMessage(chatId, `✅ ${idn} adminlykda aýryldy.`);
          } else {
            await sendMessage(chatId, "Bu ID admin sanawynda ýok.");
          }
          await kv.delete(`state:${userId}`);
          break;
        }

        default:
          // unknown state — clear
          await kv.delete(`state:${userId}`);
          await sendMessage(chatId, "Ýatda saklanan rejesi tapylmady ýa-da ýalňyşlyk boldy. /admin bilen gaýtadan girip görüň.");
      }

      return new Response("OK", { status: 200 });
    }

    // If no state and incoming document but not admin flow - maybe user wants VPN code file? handle as needed
    // Additionally, allow user to request a VPN kod: "/getvpn" command returns one code (pop)
    if (text?.startsWith("/getvpn")) {
      // Check subscription
      const subscribed = await isSubscribed(userId);
      if (!subscribed) {
        await sendMessage(chatId, "Kody almak üçin ilki başda talap edilen kanallara agza boluň. /start bilen barlaň.");
        return new Response("OK", { status: 200 });
      }
      const codes = await getVpnCodes();
      if (codes.length === 0) {
        await sendMessage(chatId, "Häzir VPN kodlary tapylmady. Admin bilen habarlaşyň.");
      } else {
        // pop one code and return
        const code = codes.shift()!;
        await setVpnCodes(codes);
        await sendMessage(chatId, `🎟️ Siziň VPN kodyňyz: <code>${code}</code>\nHaýyş: kody kimse bilen paýlaşmaň.`);
      }
      return new Response("OK", { status: 200 });
    }

    return new Response("OK", { status: 200 });
  } catch (e) {
    console.error("Update handling error:", e);
    return new Response("Xeta", { status: 200 });
  }
});
