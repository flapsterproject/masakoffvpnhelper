// main.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

// Telegram setup
const TOKEN = Deno.env.get("BOT_TOKEN");
const API = `https://api.telegram.org/bot${TOKEN}`;
const SECRET_PATH = "/masakoffvpnhelper";

// Deno KV setup
const kv = await Deno.openKv();

// Instagram constants
const IG_SIG = "4f8732eb9ba7d1c8e8897a75d6474d4eb3f5279137431b2aafb71fafe2abe178";

// -------------------- Telegram Helpers --------------------
async function sendMessage(chatId: string, text: string, options: any = {}) {
  const res = await fetch(`${API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", ...options }),
  });
  const data = await res.json();
  return data.result?.message_id;
}

async function sendPhoto(chatId: string, url: string) {
  await fetch(`${API}/sendPhoto`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, photo: url }),
  });
}

async function sendVideo(chatId: string, url: string) {
  await fetch(`${API}/sendVideo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, video: url }),
  });
}

async function deleteMessage(chatId: string, messageId: number) {
  await fetch(`${API}/deleteMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId }),
  });
}

async function answerCallbackQuery(id: string, text = "") {
  await fetch(`${API}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: id, text }),
  });
}

// -------------------- Instagram Helpers --------------------
function generateString(len: number) {
  const buf = new Uint8Array(len);
  crypto.getRandomValues(buf);
  return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
}

function generateDevice() {
  const string4 = generateString(4);
  const string8 = generateString(8);
  const string12 = generateString(12);
  const string16 = generateString(16);
  const device = `android-${string16}`;
  const uuid = generateString(32);
  const phone = `${string8}-${string4}-${string4}-${string4}-${string12}`;
  const guid = `${string8}-${string4}-${string4}-${string4}-${string12}`;
  return { device, uuid, phone, guid };
}

async function getCsrf(headers: Headers, guid: string) {
  const res = await fetch(`https://i.instagram.com/api/v1/si/fetch_headers/?challenge_type=signup&guid=${guid}`, { headers });
  const setCookies: string[] = [];
  res.headers.forEach((v, k) => {
    if (k.toLowerCase() === 'set-cookie') setCookies.push(v);
  });
  let csrf = "";
  for (const c of setCookies) {
    const match = c.match(/csrftoken=(.*?);/);
    if (match) {
      csrf = match[1];
      break;
    }
  }
  return csrf;
}

async function getUserId(userAccount: string) {
  const res = await fetch(`https://www.instagram.com/${userAccount}`, { redirect: "manual" });
  const text = await res.text();
  const match = text.match(/profilePage_(\d+)./);
  return match ? match[1] : null;
}

async function getHeaders(cookie: string) {
  return new Headers({
    "Connection": "close",
    "Accept": "*/*",
    "Content-type": "application/x-www-form-urlencoded; charset=UTF-8",
    "Cookie2": "$Version=1",
    "Accept-Language": "en-US",
    "User-Agent": "Instagram 10.26.0 Android (18/4.3; 320dpi; 720x1280; Xiaomi; HM 1SW; armani; qcom; en_US)",
    "Cookie": cookie
  });
}

async function login(chatId: string, username: string, password: string) {
  const { device, uuid, phone, guid } = generateDevice();
  let headers = await getHeaders("");
  const csrf = await getCsrf(headers, guid);
  const data = { phone_id: phone, _csrftoken: csrf, username, guid, device_id: device, password, login_attempt_count: 0 };
  const dataStr = JSON.stringify(data);
  const hmacHex = await hmacSign(dataStr);
  const form = new FormData();
  form.append("signed_body", `${hmacHex}.${dataStr}`);
  form.append("ig_sig_key_version", "4");
  headers = new Headers(headers);
  headers.delete("Content-type");
  const res = await fetch("https://i.instagram.com/api/v1/accounts/login/", { method: "POST", headers, body: form });
  const text = await res.text();
  if (text.includes("logged_in_user")) {
    const setCookies: string[] = [];
    res.headers.forEach((v, k) => { if (k.toLowerCase() === 'set-cookie') setCookies.push(v); });
    const cookieParts = setCookies.map(c => c.split(";")[0]);
    const cookieString = cookieParts.join("; ");
    await kv.set(["users", chatId, "ig_username"], username);
    await kv.set(["users", chatId, "ig_cookie"], cookieString);
    return true;
  } else {
    await sendMessage(chatId, text.includes("challenge") ? "[!] Challenge required" : text.includes("Please wait") ? "Please wait" : "Login failed");
    return false;
  }
}

async function sendBanner(chatId: string) {
  const bannerText = `
M""M                   dP                         dP       dP           
M  M                   88                         88       88           
M  M 88d888b. .d8888b. 88d888b. .d8888b. .d8888b. 88  .dP  88 .d8888b.  
M  M 88'  \`88 Y8ooooo. 88'  \`88 88'  \`88 88'  \`"" 88888"   88 88ooood8  
M  M 88    88       88 88    88 88.  .88 88.  ... 88  \`8b. 88 88.  ...  
M  M dP    dP \`88888P' dP    dP \`88888P8 \`88888P' dP   \`YP dP \`88888P'  
MMMM                                                                    

[v1.0] recoded by cyber kallan (thanks to linuxchoice )
  `;
  await sendMessage(chatId, `<pre>${bannerText}</pre>`);
}

async function sendMenu(chatId: string) {
  const text = `
Choose an option:

01 Unfollow Tracker
02 Increase Followers
03 Download Stories
04 Download Saved Content
05 Download Following List
06 Download Followers List
07 Download Profile Info
08 Activate Unfollower
  `;
  const options = {
    reply_markup: {
      inline_keyboard: [
        [{ text: "01 Unfollow Tracker", callback_data: "1" }],
        [{ text: "02 Increase Followers", callback_data: "2" }],
        [{ text: "03 Download Stories", callback_data: "3" }],
        [{ text: "04 Download Saved Content", callback_data: "4" }],
        [{ text: "05 Download Following List", callback_data: "5" }],
        [{ text: "06 Download Followers List", callback_data: "6" }],
        [{ text: "07 Download Profile Info", callback_data: "7" }],
        [{ text: "08 Activate Unfollower", callback_data: "8" }],
      ]
    }
  };
  await sendMessage(chatId, text, options);
}

async function getFollowers(cookie: string, userAccount: string) {
  const userId = await getUserId(userAccount);
  if (!userId) return [];
  const headers = await getHeaders(cookie);
  let url = `https://i.instagram.com/api/v1/friendships/${userId}/followers/`;
  let maxId = "";
  const followers: string[] = [];
  while (true) {
    let fullUrl = url + (maxId ? `?max_id=${maxId}` : "");
    const res = await fetch(fullUrl, { headers });
    const json = await res.json();
    if (json.users) {
      json.users.forEach((u: any) => followers.push(u.username));
    }
    if (json.big_list) {
      maxId = json.next_max_id || "";
    } else {
      break;
    }
  }
  return followers.sort();
}

async function getFollowing(cookie: string, userAccount: string) {
  const userId = await getUserId(userAccount);
  if (!userId) return [];
  const headers = await getHeaders(cookie);
  let url = `https://i.instagram.com/api/v1/friendships/${userId}/following/`;
  let maxId = "";
  const following: string[] = [];
  while (true) {
    let fullUrl = url + (maxId ? `?max_id=${maxId}` : "");
    const res = await fetch(fullUrl, { headers });
    const json = await res.json();
    if (json.users) {
      json.users.forEach((u: any) => following.push(u.username));
    }
    if (json.big_list) {
      maxId = json.next_max_id || "";
    } else {
      break;
    }
  }
  return following.sort();
}

async function trackUnfollowers(chatId: string, loggedUser: string, cookie: string, userAccount: string) {
  await sendMessage(chatId, `Creating followers list for user ${userAccount}`);
  const current = await getFollowers(cookie, userAccount);
  const key = ["followers", chatId, userAccount];
  const prevRes = await kv.get(key);
  if (prevRes.value) {
    const previous = prevRes.value as string[];
    const unfollowers = previous.filter(u => !current.includes(u));
    if (unfollowers.length === 0) {
      await sendMessage(chatId, "No Unfollower");
    } else {
      const msg = "Unfollowers:\n" + unfollowers.join("\n");
      await sendMessage(chatId, msg);
      await sendMessage(chatId, `Saved unfollowers for ${userAccount}`);
    }
  } else {
    await sendMessage(chatId, "No previous list found. Saved current as previous.");
  }
  await kv.set(key, current);
}

async function hmacSign(data: string) {
  const keyBytes = new TextEncoder().encode(IG_SIG);
  const messageBytes = new TextEncoder().encode(data);
  const cryptoKey = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, messageBytes);
  return Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function increaseFollowers(chatId: string, loggedUser: string, cookie: string) {
  await sendMessage(chatId, "This technique consists of following/unfolling celebgrams");
  await sendMessage(chatId, "It can increase your followers up to about +30 in 1 hour");
  await sendMessage(chatId, "Press Ctrl + C to stop (but since it's a bot, it will run in loop until error)");
  const userId = await getUserId(loggedUser);
  if (!userId) {
    await sendMessage(chatId, "Cannot get user id");
    return;
  }
  const celebIds = ["460563723", "26669533", "7719696", "247944034", "173560420", "18428658", "6380930", "232192182", "12281817", "305701719", "427553890", "12331195", "325734299", "212742998", "407964088", "7555881", "177402262", "19596899", "181306552", "1506607755", "184692323", "11830955", "25025320"];
  const { guid } = generateDevice();
  const headers = await getHeaders(cookie);
  const csrf = await getCsrf(headers, guid); // approximate
  while (true) {
    for (const celeb of celebIds) {
      const data = JSON.stringify({ _uuid: guid, _uid: userId, user_id: celeb, _csrftoken: csrf });
      const hmacHex = await hmacSign(data);
      const form = new FormData();
      form.append("signed_body", `${hmacHex}.${data}`);
      form.append("ig_sig_key_version", "4");
      await fetch(`https://i.instagram.com/api/v1/friendships/create/${celeb}/`, { method: "POST", headers, body: form });
      await sendMessage(chatId, `Followed ${celeb}`);
      await delay(3000);
    }
    await delay(60000);
    for (const celeb of celebIds) {
      const data = JSON.stringify({ _uuid: guid, _uid: userId, user_id: celeb, _csrftoken: csrf });
      const hmacHex = await hmacSign(data);
      const form = new FormData();
      form.append("signed_body", `${hmacHex}.${data}`);
      form.append("ig_sig_key_version", "4");
      await fetch(`https://i.instagram.com/api/v1/friendships/destroy/${celeb}/`, { method: "POST", headers, body: form });
      await sendMessage(chatId, `Unfollowed ${celeb}`);
      await delay(3000);
    }
    await delay(60000);
  }
}

async function getStory(chatId: string, loggedUser: string, cookie: string, userAccount: string) {
  const userId = await getUserId(userAccount);
  if (!userId) {
    await sendMessage(chatId, "Cannot get user id");
    return;
  }
  const headers = await getHeaders(cookie);
  const res = await fetch(`https://i.instagram.com/api/v1/feed/user/${userId}/reel_media/`, { headers });
  const json = await res.json();
  const videos: string[] = [];
  const images: string[] = [];
  if (json.items) {
    json.items.forEach((item: any) => {
      if (item.video_versions) {
        videos.push(item.video_versions[0].url);
      } else if (item.image_versions2) {
        images.push(item.image_versions2.candidates[0].url);
      }
    });
  }
  await sendMessage(chatId, `Total Video Stories: ${videos.length}`);
  let count = 0;
  for (const vid of videos) {
    count++;
    await sendMessage(chatId, `Downloading Story Video ${count}/${videos.length} DONE!`);
    await sendVideo(chatId, vid);
  }
  await sendMessage(chatId, `Total Image Stories: ${images.length}`);
  count = 0;
  for (const img of images) {
    count++;
    await sendMessage(chatId, `Downloading Story Image ${count}/${images.length} DONE!`);
    await sendPhoto(chatId, img);
  }
}

async function getSaved(chatId: string, loggedUser: string, cookie: string) {
  const userId = await getUserId(loggedUser);
  if (!userId) {
    await sendMessage(chatId, "Cannot get user id");
    return;
  }
  const headers = await getHeaders(cookie);
  let url = "https://i.instagram.com/api/v1/feed/saved/";
  let maxId = "";
  const images: string[] = [];
  const videos: string[] = [];
  await sendMessage(chatId, "Generating image list");
  while (true) {
    let fullUrl = url + (maxId ? `?max_id=${maxId}` : "");
    const res = await fetch(fullUrl, { headers });
    const json = await res.json();
    if (json.items) {
      json.items.forEach((item: any) => {
        if (item.media && item.media.image_versions2) {
          images.push(item.media.image_versions2.candidates[0].url);
        } else if (item.media && item.media.video_versions) {
          videos.push(item.media.video_versions[0].url);
        }
      });
    }
    if (json.more_available) {
      maxId = json.next_max_id || "";
    } else {
      break;
    }
  }
  await sendMessage(chatId, `Total images: ${images.length}`);
  let count = 0;
  for (const img of images) {
    count++;
    await sendMessage(chatId, `Downloading image ${count}/${images.length} DONE!`);
    await sendPhoto(chatId, img);
  }
  await sendMessage(chatId, `Total Videos: ${videos.length}`);
  count = 0;
  for (const vid of videos) {
    count++;
    await sendMessage(chatId, `Downloading video ${count}/${videos.length} DONE!`);
    await sendVideo(chatId, vid);
  }
}

async function downloadFollowing(chatId: string, loggedUser: string, cookie: string, userAccount: string) {
  const following = await getFollowing(cookie, userAccount);
  const total = following.length;
  await sendMessage(chatId, `Total Following: ${total}`);
  const msg = following.join("\n");
  await sendMessage(chatId, msg);
  await sendMessage(chatId, `Saved following list for ${userAccount}`);
}

async function downloadFollowers(chatId: string, loggedUser: string, cookie: string, userAccount: string) {
  const followers = await getFollowers(cookie, userAccount);
  const total = followers.length;
  await sendMessage(chatId, `Total Followers: ${total}`);
  const msg = followers.join("\n");
  await sendMessage(chatId, msg);
  await sendMessage(chatId, `Saved followers list for ${userAccount}`);
}

async function getInfo(chatId: string, loggedUser: string, cookie: string, userAccount: string) {
  const userId = await getUserId(userAccount);
  if (!userId) {
    await sendMessage(chatId, "Cannot get user id");
    return;
  }
  const loggedUserId = await getUserId(loggedUser);
  const { guid } = generateDevice();
  const headers = await getHeaders(cookie);
  const csrf = await getCsrf(headers, guid);
  const data = JSON.stringify({ _uuid: guid, _uid: loggedUserId, _csrftoken: csrf });
  const hmacHex = await hmacSign(data);
  const form = new FormData();
  form.append("signed_body", `${hmacHex}.${data}`);
  form.append("ig_sig_key_version", "4");
  const res = await fetch(`https://i.instagram.com/api/v1/users/${userId}/info/`, { method: "POST", headers, body: form });
  const json = await res.json();
  const infoText = JSON.stringify(json, null, 2);
  await sendMessage(chatId, `${userAccount} account info:\n<pre>${infoText}</pre>`);
  if (json.user && json.user.hd_profile_pic_url_info) {
    const picUrl = json.user.hd_profile_pic_url_info.url;
    await sendPhoto(chatId, picUrl);
  } else if (json.user && json.user.profile_pic_url) {
    await sendPhoto(chatId, json.user.profile_pic_url);
  }
  await sendMessage(chatId, `Saved: ${userAccount}`);
}

async function unfollower(chatId: string, loggedUser: string, cookie: string) {
  await sendMessage(chatId, `Preparing to unfollow all followers from ${loggedUser} ...`);
  await sendMessage(chatId, `Press "Ctrl + c" to stop...`);
  await delay(4000);
  const following = await getFollowing(cookie, loggedUser);
  const loggedUserId = await getUserId(loggedUser);
  const { guid } = generateDevice();
  const headers = await getHeaders(cookie);
  const csrf = await getCsrf(headers, guid);
  for (const unfollowName of following) {
    const userId = await getUserId(unfollowName);
    if (!userId) continue;
    const data = JSON.stringify({ _uuid: guid, _uid: loggedUserId, user_id: userId, _csrftoken: csrf });
    const hmacHex = await hmacSign(data);
    const form = new FormData();
    form.append("signed_body", `${hmacHex}.${data}`);
    form.append("ig_sig_key_version", "4");
    await fetch(`https://i.instagram.com/api/v1/friendships/destroy/${userId}/`, { method: "POST", headers, body: form });
    await sendMessage(chatId, `Unfollowed ${unfollowName} OK`);
    await delay(3000);
  }
}

async function performOption(chatId: string, option: number, userAccount: string, loggedUser: string, cookie: string) {
  switch (option) {
    case 1: await trackUnfollowers(chatId, loggedUser, cookie, userAccount); break;
    case 2: await increaseFollowers(chatId, loggedUser, cookie); break;
    case 3: await getStory(chatId, loggedUser, cookie, userAccount); break;
    case 4: await getSaved(chatId, loggedUser, cookie); break;
    case 5: await downloadFollowing(chatId, loggedUser, cookie, userAccount); break;
    case 6: await downloadFollowers(chatId, loggedUser, cookie, userAccount); break;
    case 7: await getInfo(chatId, loggedUser, cookie, userAccount); break;
    case 8: await unfollower(chatId, loggedUser, cookie); break;
  }
}

async function handleOption(chatId: string, option: number) {
  const usernameRes = await kv.get(["users", chatId, "ig_username"]);
  const cookieRes = await kv.get(["users", chatId, "ig_cookie"]);
  const loggedUser = usernameRes.value as string;
  const cookie = cookieRes.value as string;
  if (!loggedUser || !cookie) {
    await sendMessage(chatId, "Not logged in");
    return;
  }
  const needsAccount = [1, 3, 5, 6, 7].includes(option);
  if (needsAccount) {
    await sendMessage(chatId, "Account (leave it blank to use your account): ");
    await kv.set(["states", chatId], "asking_user_account");
    await kv.set(["temp", chatId, "option"], option);
  } else {
    await performOption(chatId, option, loggedUser, loggedUser, cookie);
  }
}

// -------------------- HTTP Handler --------------------
serve(async (req) => {
  try {
    const update = await req.json();

    if (update.message) {
      const chatId = String(update.message.chat.id);
      const text = update.message.text;

      if (text === "/start") {
        await sendBanner(chatId);
        await sendMessage(chatId, "Login");
        await sendMessage(chatId, "Username: ");
        await kv.set(["states", chatId], "asking_username");
        return new Response("ok");
      }

      if (text.startsWith("/plussubs")) {
        const parts = text.split(" ");
        if (parts.length < 2) {
          await sendMessage(chatId, "Usage: /plussubs <instagram username>");
          return new Response("ok");
        }
        const username = parts[1];
        await kv.set(["temp", chatId, "ig_username"], username);
        await sendMessage(chatId, `Password for ${username}: `);
        await kv.set(["states", chatId], "asking_password_for_plussubs");
        return new Response("ok");
      }

      const stateRes = await kv.get(["states", chatId]);
      const state = stateRes.value as string | null;

      if (state === "asking_username") {
        await kv.set(["temp", chatId, "ig_username"], text);
        await sendMessage(chatId, "Password: ");
        await kv.set(["states", chatId], "asking_password");
        return new Response("ok");
      }

      if (state === "asking_password") {
        const usernameRes = await kv.get(["temp", chatId, "ig_username"]);
        const username = usernameRes.value as string;
        const success = await login(chatId, username, text);
        if (success) {
          await kv.set(["states", chatId], "logged_in");
          await sendMenu(chatId);
        } else {
          await kv.set(["states", chatId], null);
        }
        await kv.delete(["temp", chatId, "ig_username"]);
        return new Response("ok");
      }

      if (state === "asking_password_for_plussubs") {
        const usernameRes = await kv.get(["temp", chatId, "ig_username"]);
        const username = usernameRes.value as string;
        const success = await login(chatId, username, text);
        if (success) {
          await kv.set(["states", chatId], "logged_in");
          const cookieRes = await kv.get(["users", chatId, "ig_cookie"]);
          const cookie = cookieRes.value as string;
          await increaseFollowers(chatId, username, cookie);
        } else {
          await kv.set(["states", chatId], null);
        }
        await kv.delete(["temp", chatId, "ig_username"]);
        return new Response("ok");
      }

      if (state === "asking_user_account") {
        const optionRes = await kv.get(["temp", chatId, "option"]);
        const option = optionRes.value as number;
        const usernameRes = await kv.get(["users", chatId, "ig_username"]);
        const cookieRes = await kv.get(["users", chatId, "ig_cookie"]);
        const loggedUser = usernameRes.value as string;
        const cookie = cookieRes.value as string;
        const userAccount = text || loggedUser;
        await kv.set(["states", chatId], "logged_in");
        await kv.delete(["temp", chatId, "option"]);
        await performOption(chatId, option, userAccount, loggedUser, cookie);
        return new Response("ok");
      }
    }

    if (update.callback_query) {
      const chatId = String(update.callback_query.message.chat.id);
      const data = update.callback_query.data;
      await answerCallbackQuery(update.callback_query.id);
      await handleOption(chatId, parseInt(data));
    }
  } catch (err) {
    console.error("Error handling update:", err);
  }

  return new Response("ok");
});

