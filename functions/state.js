export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const action = url.searchParams.get("action") || "state";

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store, no-cache, must-revalidate"
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // 1. CANAL ULTRA-RAPIDE : DESSIN LIVE À DEUX & TOUCHER SYNCHRONISÉ HAPTIQUE
    if (action === "live") {
      if (request.method === "GET") {
        const liveData = await env.LOVE8_COUPLE_KV.get("live_canvas_sync");
        return new Response(liveData || "{}", {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      if (request.method === "POST") {
        const body = await request.text();
        await env.LOVE8_COUPLE_KV.put("live_canvas_sync", body);
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    // 2. STOCKAGE CLOUD ILLIMITÉ (CLOUDFLARE R2 OU KV ARCHIVE) POUR ANCIENS DESSINS & PHOTOS
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

        // Si un bucket Cloudflare R2 (LOVE8_R2) est lié, on stocke l'image haute définition dans R2
        if (env.LOVE8_R2 && item.dataUrl) {
          await env.LOVE8_R2.put(id + ".txt", item.dataUrl);
          item.r2Stored = true;
        }

        const listRaw = await env.LOVE8_COUPLE_KV.get("archive_index_list");
        const list = listRaw ? JSON.parse(listRaw) : [];
        list.unshift(item);
        // Garde jusqu'à 200 souvenirs classés chronologiquement
        await env.LOVE8_COUPLE_KV.put("archive_index_list", JSON.stringify(list.slice(0, 200)));

        return new Response(JSON.stringify({ ok: true, id }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    // 3. ÉTAT PRINCIPAL DU COUPLE (JORDAN, LYDIE, DOUGLASSE, QUIZ, BONS, CAPSULES)
    if (request.method === "GET") {
      const data = await env.LOVE8_COUPLE_KV.get("state_jordan_lydie");
      return new Response(data || "{}", {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (request.method === "POST") {
      const body = await request.text();
      await env.LOVE8_COUPLE_KV.put("state_jordan_lydie", body);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    return new Response("Love8 Couple API + R2 Ready", { headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
}
