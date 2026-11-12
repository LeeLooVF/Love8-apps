let memoryState = null;
let memoryMedia = {};

async function sendFcmPush(env, recipientToken, title, body, sound) {
  if (!env.FCM_ACCESS_TOKEN || !env.FCM_PROJECT_ID || !recipientToken) return;
  try {
    await fetch(`https://fcm.googleapis.com/v1/projects/${env.FCM_PROJECT_ID}/messages:send`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.FCM_ACCESS_TOKEN.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          token: recipientToken,
          notification: {
            title: title || "⚡ Vibration d'amour",
            body: body || "Ton amour t'envoie une vibration"
          },
          data: {
            sound: sound || "love",
            type: 'vibration'
          },
          android: {
            priority: 'HIGH',
            notification: {
              sound: 'default',
              default_sound: true,
              default_vibrate_timings: true
            }
          }
        }
      })
    });
  } catch (e) {}
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const action = url.searchParams.get("action") || "state";

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (action === "register_fcm" && request.method === "POST") {
      const data = await request.json();
      if (data.user && data.token && env.LOVE8_COUPLE_KV) {
        await env.LOVE8_COUPLE_KV.put("fcm_token_" + data.user, data.token);
      }
      return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
    }

    if (action === "media") {
      const key = url.searchParams.get("key") || "latest_drawing";
      if (request.method === "GET") {
        let dataUrl = memoryMedia[key];
        if (!dataUrl && env.LOVE8_COUPLE_KV) {
          dataUrl = await env.LOVE8_COUPLE_KV.get("media_" + key);
        }
        return new Response(JSON.stringify({ key, dataUrl: dataUrl || "" }), { headers: corsHeaders });
      }
      if (request.method === "POST") {
        const body = await request.json();
        if (body.key && body.dataUrl) {
          memoryMedia[body.key] = body.dataUrl;
          if (env.LOVE8_COUPLE_KV) {
            await env.LOVE8_COUPLE_KV.put("media_" + body.key, body.dataUrl);
          }
        }
        return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
      }
    }

    if (action === "archive" && request.method === "POST") {
      const item = await request.json();
      const id = item.id || ("mem_" + Date.now());
      if (env.LOVE8_COUPLE_KV) {
        const listRaw = await env.LOVE8_COUPLE_KV.get("archive_index_list");
        const list = listRaw ? JSON.parse(listRaw) : [];
        list.unshift(item);
        await env.LOVE8_COUPLE_KV.put("archive_index_list", JSON.stringify(list.slice(0, 40)));
      }
      return new Response(JSON.stringify({ ok: true, id }), { headers: corsHeaders });
    }

    if (request.method === "GET") {
      if (!memoryState && env.LOVE8_COUPLE_KV) {
        const raw = await env.LOVE8_COUPLE_KV.get("state_jordan_lydie");
        if (raw) { try { memoryState = JSON.parse(raw); } catch (e) {} }
      }
      return new Response(memoryState ? JSON.stringify(memoryState) : "{}", { headers: corsHeaders });
    }

    if (request.method === "POST") {
      const incoming = await request.json();
      memoryState = incoming;
      memoryState.updatedAt = Date.now();

      if (env.LOVE8_COUPLE_KV) {
        await env.LOVE8_COUPLE_KV.put("state_jordan_lydie", JSON.stringify(memoryState));
      }

      if (incoming.lastEvent && incoming.lastEvent.sender) {
        const recipient = incoming.lastEvent.sender === "Jordan" ? "Lydie" : "Jordan";
        if (env.LOVE8_COUPLE_KV) {
          const recipientToken = await env.LOVE8_COUPLE_KV.get("fcm_token_" + recipient);
          if (recipientToken) {
            await sendFcmPush(env, recipientToken, incoming.lastEvent.title, incoming.lastEvent.message, incoming.lastEvent.sound);
          }
        }
      }

      return new Response(JSON.stringify({ ok: true, updatedAt: memoryState.updatedAt }), { headers: corsHeaders });
    }

    return new Response("Love8 FCM API Ready", { headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 200, headers: corsHeaders });
  }
}
