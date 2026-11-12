let memoryState = null;
let memoryMedia = {};
let lastKvWriteTime = 0;

function extractAndStripBase64(obj) {
  if (!obj || typeof obj !== "object") return;
  if (obj.cat && obj.cat.photo) delete obj.cat.photo;
  if (obj.wishes) delete obj.wishes;
  if (obj.latestDrawing && obj.latestDrawing.dataUrl) {
    const drawId = obj.latestDrawing.id || ("mem_" + Date.now());
    obj.latestDrawing.id = drawId;
    memoryMedia["draw_" + drawId] = obj.latestDrawing.dataUrl;
    memoryMedia["latest_drawing"] = obj.latestDrawing.dataUrl;
    delete obj.latestDrawing.dataUrl;
  }
  ["jordan", "lydie"].forEach(person => {
    if (obj[person]) {
      delete obj[person].bat;
      delete obj[person].lat;
      delete obj[person].lng;
      delete obj[person].loc;
      if (obj[person].avatar && obj[person].avatar.startsWith("data:")) {
        const avId = obj[person].avatarId || Date.now();
        obj[person].avatarId = avId;
        memoryMedia["avatar_" + person] = obj[person].avatar;
        delete obj[person].avatar;
      }
    }
  });
}

function mergeCoupleState(currentRaw, incomingObj) {
  if (!currentRaw) return incomingObj;
  let cur;
  try {
    cur = typeof currentRaw === "string" ? JSON.parse(currentRaw) : currentRaw;
  } catch (e) {
    return incomingObj;
  }

  const activeUser = incomingObj.activeUser;
  if (activeUser === "Jordan" && cur.lydie && incomingObj.lydie) {
    incomingObj.lydie = cur.lydie;
  } else if (activeUser === "Lydie" && cur.jordan && incomingObj.jordan) {
    incomingObj.jordan = cur.jordan;
  }

  incomingObj.pingsToday = Math.max(cur.pingsToday || 0, incomingObj.pingsToday || 0);

  if (cur.vibCounts && incomingObj.vibCounts) {
    Object.keys(cur.vibCounts).forEach(k => {
      incomingObj.vibCounts[k] = Math.max(cur.vibCounts[k] || 0, incomingObj.vibCounts[k] || 0);
    });
  }

  if (cur.lastEvent && incomingObj.lastEvent) {
    if ((cur.lastEvent.id || 0) > (incomingObj.lastEvent.id || 0)) {
      incomingObj.lastEvent = cur.lastEvent;
    } else if (cur.lastEvent.id === incomingObj.lastEvent.id && cur.lastEvent.ack) {
      incomingObj.lastEvent.ack = cur.lastEvent.ack;
      incomingObj.lastEvent.ackBy = cur.lastEvent.ackBy;
      incomingObj.lastEvent.ackAt = cur.lastEvent.ackAt;
    }
  }

  return incomingObj;
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
    // 1. MICRO-ENDPOINT (< 120 OCTETS) POUR LE SERVICE ANDROID EN VEILLE
    if (action === "ping") {
      if (!memoryState && env.LOVE8_COUPLE_KV) {
        const raw = await env.LOVE8_COUPLE_KV.get("state_jordan_lydie");
        if (raw) {
          try { memoryState = JSON.parse(raw); } catch (e) {}
        }
      }
      const ev = (memoryState && memoryState.lastEvent) ? memoryState.lastEvent : {};
      return new Response(JSON.stringify({
        id: ev.id || 0,
        s: ev.sender || "",
        t: ev.type || "vibration",
        ti: ev.title || "Love8 ❤️",
        m: ev.message || "Vibration reçue !",
        e: ev.emoji || "❤️",
        snd: ev.sound || "love",
        ack: ev.ack || 0,
        ackBy: ev.ackBy || "",
        ackAt: ev.ackAt || ""
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // 2. ACCUSÉ DE RÉCEPTION RÉEL (« VU / VIBRÉ ✓✓ »)
    if (action === "ack" && request.method === "POST") {
      const ackData = await request.json();
      if (!memoryState && env.LOVE8_COUPLE_KV) {
        const raw = await env.LOVE8_COUPLE_KV.get("state_jordan_lydie");
        if (raw) {
          try { memoryState = JSON.parse(raw); } catch (e) {}
        }
      }
      if (memoryState && memoryState.lastEvent && Number(memoryState.lastEvent.id) === Number(ackData.id)) {
        memoryState.lastEvent.ack = Number(ackData.id);
        memoryState.lastEvent.ackBy = ackData.by || "";
        memoryState.lastEvent.ackAt = ackData.at || "";
        memoryState.updatedAt = Date.now();
        try {
          if (env.LOVE8_COUPLE_KV) {
            await env.LOVE8_COUPLE_KV.put("state_jordan_lydie", JSON.stringify(memoryState));
          }
        } catch (e) {}
      }
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // 3. STOCKAGE DÉDIÉ DES MÉDIAS WEBP (AVATARS, CAPSULES & DERNIER DESSIN)
    if (action === "media") {
      const key = url.searchParams.get("key") || "latest_drawing";
      if (request.method === "GET") {
        let dataUrl = memoryMedia[key];
        if (!dataUrl && env.LOVE8_COUPLE_KV) {
          dataUrl = await env.LOVE8_COUPLE_KV.get("media_" + key);
          if (dataUrl) memoryMedia[key] = dataUrl;
        }
        return new Response(JSON.stringify({ key, dataUrl: dataUrl || "" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      if (request.method === "POST") {
        const body = await request.json();
        const k = body.key || key;
        if (body.dataUrl) {
          memoryMedia[k] = body.dataUrl;
          try {
            if (env.LOVE8_COUPLE_KV) {
              await env.LOVE8_COUPLE_KV.put("media_" + k, body.dataUrl);
            }
          } catch (e) {}
        }
        return new Response(JSON.stringify({ ok: true, key: k }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    // 4. ARCHIVE CLOUD R2 / KV POUR LES DESSINS
    if (action === "archive") {
      if (request.method === "GET") {
        const listRaw = env.LOVE8_COUPLE_KV ? await env.LOVE8_COUPLE_KV.get("archive_index_list") : "[]";
        return new Response(listRaw || "[]", {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      if (request.method === "POST") {
        const item = await request.json();
        const id = item.id || ("mem_" + Date.now());
        item.id = id;

        if (item.dataUrl) {
          memoryMedia["latest_drawing"] = item.dataUrl;
          memoryMedia["draw_" + id] = item.dataUrl;
          try {
            if (env.LOVE8_COUPLE_KV) {
              await env.LOVE8_COUPLE_KV.put("media_latest_drawing", item.dataUrl);
            }
          } catch (e) {}
        }

        if (env.LOVE8_R2 && item.dataUrl) {
          try {
            await env.LOVE8_R2.put(id + ".txt", item.dataUrl);
            item.r2Stored = true;
          } catch (e) {}
        }

        try {
          if (env.LOVE8_COUPLE_KV) {
            const listRaw = await env.LOVE8_COUPLE_KV.get("archive_index_list");
            const list = listRaw ? JSON.parse(listRaw) : [];
            list.unshift(item);
            await env.LOVE8_COUPLE_KV.put("archive_index_list", JSON.stringify(list.slice(0, 40)));
          }
        } catch (kvErr) {}

        return new Response(JSON.stringify({ ok: true, id }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    // 5. ÉTAT PRINCIPAL ULTRA-LÉGER (< 1 KO)
    if (request.method === "GET") {
      if (!memoryState && env.LOVE8_COUPLE_KV) {
        const raw = await env.LOVE8_COUPLE_KV.get("state_jordan_lydie");
        if (raw) {
          try {
            memoryState = JSON.parse(raw);
            extractAndStripBase64(memoryState);
          } catch (e) {}
        }
      }
      return new Response(memoryState ? JSON.stringify(memoryState) : "{}", {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (request.method === "POST") {
      const incoming = await request.json();
      extractAndStripBase64(incoming);
      memoryState = mergeCoupleState(memoryState, incoming);
      memoryState.updatedAt = Date.now();

      const now = Date.now();
      if (now - lastKvWriteTime > 10000) {
        lastKvWriteTime = now;
        try {
          if (env.LOVE8_COUPLE_KV) {
            await env.LOVE8_COUPLE_KV.put("state_jordan_lydie", JSON.stringify(memoryState));
          }
        } catch (kvErr) {}
      }

      return new Response(JSON.stringify({
        ok: true,
        updatedAt: memoryState.updatedAt,
        lastEvent: memoryState.lastEvent
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    return new Response("Love8 Light API Ready", { headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
}
