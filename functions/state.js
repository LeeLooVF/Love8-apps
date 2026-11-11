// Cache temps réel en mémoire vive (fonctionne même si le quota KV journalier de 1000 écritures est atteint)
let memoryState = null;
let memoryLiveCanvas = "{}";

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const action = url.searchParams.get("action") || "state";

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // 1. CANAL LIVE DESSIN
    if (action === "live") {
      if (request.method === "GET") {
        if (memoryLiveCanvas && memoryLiveCanvas !== "{}") {
          return new Response(memoryLiveCanvas, {
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
        const liveData = await env.LOVE8_COUPLE_KV.get("live_canvas_sync");
        return new Response(liveData || "{}", {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      if (request.method === "POST") {
        memoryLiveCanvas = await request.text();
        try {
          await env.LOVE8_COUPLE_KV.put("live_canvas_sync", memoryLiveCanvas, { expirationTtl: 60 });
        } catch (kvErr) {}
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    // 2. ARCHIVE CLOUD R2 / KV
    if (action === "archive") {
      if (request.method === "GET") {
        const listRaw = await env.LOVE8_COUPLE_KV.get("archive_index_list");
        return new Response(listRaw || "[]", {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      if (request.method === "POST") {
        const item = await request.json();
        const id = "mem_" + Date.now();
        item.id = id;

        if (env.LOVE8_R2 && item.dataUrl) {
          await env.LOVE8_R2.put(id + ".txt", item.dataUrl);
          item.r2Stored = true;
        }

        try {
          const listRaw = await env.LOVE8_COUPLE_KV.get("archive_index_list");
          const list = listRaw ? JSON.parse(listRaw) : [];
          list.unshift(item);
          await env.LOVE8_COUPLE_KV.put("archive_index_list", JSON.stringify(list.slice(0, 100)));
        } catch (kvErr) {}

        return new Response(JSON.stringify({ ok: true, id }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    // 3. ÉTAT PRINCIPAL DU COUPLE (MÉMOIRE VIVE PRIORITAIRE + FALLBACK KV)
    if (request.method === "GET") {
      if (!memoryState) {
        memoryState = await env.LOVE8_COUPLE_KV.get("state_jordan_lydie");
      }
      return new Response(memoryState || "{}", {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (request.method === "POST") {
      const body = await request.text();
      memoryState = body; // Mise à jour immédiate en RAM (0 latence, 0 blocage quota)

      try {
        await env.LOVE8_COUPLE_KV.put("state_jordan_lydie", body);
      } catch (kvErr) {
        // Si le quota journalier de 1000 PUT KV est atteint, on ne bloque pas la requête !
      }

      return new Response(JSON.stringify({ ok: true, mode: "realtime" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    return new Response("Love8 Couple API Ready", { headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
}
