import { createClient } from "@vercel/kv";

// Suporta tanto Vercel KV oficial quanto Upstash for Redis
const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const kv = createClient({ url, token });

export default async function handler(request, response) {
  try {
    const financeItems = await kv.get("madeireira_finance") || [];
    const acumulado = await kv.get("madeireira_acumulado") || { venda: 0, pix: 0, credito: 0, debito: 0, custo: 0, despesa: 0, func: 0, dinheiroCaixa: 0 };
    response.status(200).json({ financeItems, acumulado });
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
}
