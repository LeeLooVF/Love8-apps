let memoryState = null;
let memoryMedia = {};
let cachedAccessToken = null;
let tokenExpiration = 0;

function pemToArrayBuffer(pem) {
  const b64Lines = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\\n/g, '')
    .replace(/\r?\n|\r/g, '')
    .trim();
  const str = atob(b64Lines);
  const buf = new ArrayBuffer(str.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < str.length; i++) {
    view[i] = str.charCodeAt(i);
  }
  return buf;
}

function base64UrlEncode(str) {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function arrayBufferToBase64Url(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return base64UrlEncode(binary);
}

async function getGoogleAccessToken(env) {
  if (cachedAccessToken && Date.now() < tokenExpiration - 60000) {
    return cachedAccessToken;
  }

  const rawKey = env.FCM_ACCESS_TOKEN || env.FCM_PRIVATE_KEY || "";
  if (!rawKey) return null;

  let privateKeyPem = rawKey;
  let clientEmail = env.FCM_CLIENT_EMAIL || "firebase-adminsdk-fbsvc@love8-mabite.iam.gserviceaccount.com";

  if (rawKey.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(rawKey);
      privateKeyPem = parsed.private_key;
      if (parsed.client_email) clientEmail = parsed.client_email;
    } catch (e) {}
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedClaim = base64UrlEncode(JSON.stringify(claim));
  const signatureInput = `${encodedHeader}.${encodedClaim}`;

  const keyBuffer = pemToArrayBuffer(privateKeyPem);
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    keyBuffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signatureBuffer = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(signatureInput)
  );

  const jwt = `${signatureInput}.${arrayBufferToBase64Url(signatureBuffer)}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
  });

  if (!res.ok) return null;

  const data = await res.json();
  cachedAccessToken = data.access_token;
  tokenExpiration = Date.now() + (data.expires_in * 1000);
  return cachedAccessToken;
}

async function sendFcmPush(env, recipientToken, eventObj) {
  if (!recipientToken) return;
  try {
    const accessToken = await getGoogleAccessToken(env);
    if (!accessToken) return;

    const projectId = (env.FCM_PROJECT_ID || "love8-mabite").trim();
    const payload = {
      message: {
        token: recipientToken,
        data: {
          eventId: String(eventObj.id || Date.now()),
          title: String(eventObj.title || "Love8 ❤️"),
          body: String(eventObj.message || "Nouvelle vibration reçue !"),
          sound: String(eventObj.sound || "love"),
          emoji: String(eventObj.emoji || "❤️"),
          evType: String(eventObj.type || "vibration"),
          type: String(eventObj.type || "vibration")
        },
        android: {
          priority: 'HIGH',
          ttl: '60s'
        }
      }
    };

    await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
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
    "Content-Type": "application/json",
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Diagnostic complet de tous les services (Cloudflare, KV, Firebase OAuth2, Tokens Jordan & Lydie)
    if (action === "status" && request.method === "GET") {
      let kvOk = false;
      let tokenJordan = false;
      let tokenLydie = false;
      let stateUpdatedAt = 0;

      if (env.LOVE8_COUPLE_KV) {
        kvOk = true;
        const tj = await env.LOVE8_COUPLE_KV.get("fcm_token_Jordan");
        const tl = await env.LOVE8_COUPLE_KV.get("fcm_token_Lydie");
        const rawState = await env.LOVE8_COUPLE_KV.get("state_jordan_lydie");
        tokenJordan = Boolean(tj && tj.length > 20);
        tokenLydie = Boolean(tl && tl.length > 20);
        if (rawState) {
          try { stateUpdatedAt = JSON.parse(rawState).updatedAt || 0; } catch (e) {}
        }
      }

      let fcmAuthOk = false;
      try {
        const tok = await getGoogleAccessToken(env);
        fcmAuthOk = Boolean(tok);
      } catch (e) {}

      return new Response(JSON.stringify({
        ok: true,
        cloudflareWorker: true,
        kvBound: kvOk,
        fcmAuthOk,
        tokenJordan,
        tokenLydie,
        stateUpdatedAt,
        serverTime: Date.now()
      }), { headers: corsHeaders });
    }

    if (action === "register_fcm" && request.method === "POST") {
      const data = await request.json();
      if (data.user && data.token && env.LOVE8_COUPLE_KV) {
        await env.LOVE8_COUPLE_KV.put("fcm_token_" + data.user, data.token);
      }
      return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
    }

    if (action === "ack" && request.method === "POST") {
      const ackData = await request.json();
      if (env.LOVE8_COUPLE_KV) {
        const raw = await env.LOVE8_COUPLE_KV.get("state_jordan_lydie");
        if (raw) { try { memoryState = JSON.parse(raw); } catch (e) {} }
      }
      if (memoryState && memoryState.lastEvent && Number(memoryState.lastEvent.id) === Number(ackData.id)) {
        memoryState.lastEvent.ack = ackData.id;
        memoryState.lastEvent.ackBy = ackData.by;
        memoryState.lastEvent.ackAt = ackData.at;
        memoryState.updatedAt = Date.now();
        if (env.LOVE8_COUPLE_KV) {
          await env.LOVE8_COUPLE_KV.put("state_jordan_lydie", JSON.stringify(memoryState));
        }
      }
      return new Response(JSON.stringify({ ok: true, updatedAt: memoryState?.updatedAt || Date.now() }), { headers: corsHeaders });
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

    if (action === "archive") {
      if (request.method === "GET") {
        if (env.LOVE8_COUPLE_KV) {
          const listRaw = await env.LOVE8_COUPLE_KV.get("archive_index_list");
          return new Response(listRaw || "[]", { headers: corsHeaders });
        }
        return new Response("[]", { headers: corsHeaders });
      }
      if (request.method === "POST") {
        const item = await request.json();
        const id = item.id || ("mem_" + Date.now());
        if (env.LOVE8_COUPLE_KV) {
          if (item.dataUrl) {
            memoryMedia["latest_drawing"] = item.dataUrl;
            await env.LOVE8_COUPLE_KV.put("media_latest_drawing", item.dataUrl);
          }
          const listRaw = await env.LOVE8_COUPLE_KV.get("archive_index_list");
          const list = listRaw ? JSON.parse(listRaw) : [];
          list.unshift(item);
          await env.LOVE8_COUPLE_KV.put("archive_index_list", JSON.stringify(list.slice(0, 40)));
        }
        return new Response(JSON.stringify({ ok: true, id }), { headers: corsHeaders });
      }
    }

    // Lecture directe dans KV à chaque GET pour éviter tout cache obsolète entre Workers Cloudflare
    if (request.method === "GET") {
      if (env.LOVE8_COUPLE_KV) {
        const raw = await env.LOVE8_COUPLE_KV.get("state_jordan_lydie");
        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            if (parsed && parsed.jordan && parsed.lydie) {
              memoryState = parsed;
            }
          } catch (e) {}
        }
      }
      return new Response(memoryState ? JSON.stringify(memoryState) : "{}", { headers: corsHeaders });
    }

    if (request.method === "POST") {
      const incoming = await request.json();

      if (!incoming || !incoming.jordan || !incoming.lydie) {
        return new Response(JSON.stringify({ ok: false, ignored: true }), { headers: corsHeaders });
      }

      if (env.LOVE8_COUPLE_KV) {
        const raw = await env.LOVE8_COUPLE_KV.get("state_jordan_lydie");
        if (raw) { try { memoryState = JSON.parse(raw); } catch (e) {} }
      }

      const prevEventId = (memoryState && memoryState.lastEvent && memoryState.lastEvent.id) ? Number(memoryState.lastEvent.id) : 0;
      const newEventId = (incoming.lastEvent && incoming.lastEvent.id) ? Number(incoming.lastEvent.id) : 0;

      memoryState = incoming;
      memoryState.updatedAt = Date.now();

      if (env.LOVE8_COUPLE_KV) {
        await env.LOVE8_COUPLE_KV.put("state_jordan_lydie", JSON.stringify(memoryState));
      }

      // Envoie le push FCM uniquement pour les vibrations, coeurs, dessins et bons (pas pour les étapes silencieuses)
      if (newEventId > prevEventId && incoming.lastEvent && incoming.lastEvent.sender && incoming.lastEvent.type !== "silent") {
        const recipient = incoming.lastEvent.sender === "Jordan" ? "Lydie" : "Jordan";
        if (env.LOVE8_COUPLE_KV) {
          const recipientToken = await env.LOVE8_COUPLE_KV.get("fcm_token_" + recipient);
          if (recipientToken) {
            await sendFcmPush(env, recipientToken, incoming.lastEvent);
          }
        }
      }

      return new Response(JSON.stringify({ ok: true, updatedAt: memoryState.updatedAt }), { headers: corsHeaders });
    }

    return new Response(JSON.stringify({ status: "Love8 FCM API Ready" }), { headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 200, headers: corsHeaders });
  }
}
