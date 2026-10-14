import { createClient } from "@vercel/kv";

// Suporta tanto Vercel KV oficial quanto Upstash for Redis
const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const kv = createClient({ url, token });

export default async function handler(request, response) {
  if (request.method !== "POST") {
    return response.status(405).json({ error: "Method not allowed" });
  }
  
  try {
    const { financeItems, acumulado } = request.body;
    
    // Salva os dois no Vercel KV / Upstash
    if (financeItems) {
      await kv.set("madeireira_finance", financeItems);
    }
    if (acumulado) {
      await kv.set("madeireira_acumulado", acumulado);
    }
    
    response.status(200).json({ success: true });
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
}
