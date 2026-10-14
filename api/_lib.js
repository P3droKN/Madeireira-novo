// Arquivos em /api que começam com "_" não viram rota na Vercel: aqui ficam só utilitários.
import { createClient } from "@vercel/kv";
import { createHash, timingSafeEqual } from "node:crypto";

let cliente;
export function kv() {
  if (!cliente) {
    // Suporta tanto Vercel KV oficial quanto Upstash for Redis
    const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
    cliente = createClient({ url, token });
  }
  return cliente;
}

// Produção usa as chaves originais. Preview e desenvolvimento usam o prefixo "preview:",
// para que testes nunca mexam nos dados reais.
// KV_PREFIXO (opcional) força um prefixo em todos os ambientes: usado no projeto de testes,
// para não tocar nos dados reais mesmo se ele for ligado ao banco errado.
export function chaves(ambiente = process.env.VERCEL_ENV, prefixoFixo = process.env.KV_PREFIXO) {
  const p = prefixoFixo || (ambiente === "production" ? "" : "preview:");
  return {
    ambiente: ambiente || "development",
    prefixo: p,
    finance: p + "madeireira_finance",       // lista antiga (não é mais alterada depois da migração)
    acumulado: p + "madeireira_acumulado",
    lancamentos: p + "madeireira_lancamentos", // hash: id -> lançamento
    migrado: p + "madeireira_migrado_v1",
    trava: p + "madeireira_trava_migracao",
    backups: p + "madeireira_backups",       // lista com os nomes das cópias automáticas
  };
}

export function senhaConfere(recebida, esperada) {
  if (typeof recebida !== "string" || typeof esperada !== "string" || !esperada) return false;
  const a = createHash("sha256").update(recebida).digest();
  const b = createHash("sha256").update(esperada).digest();
  return timingSafeEqual(a, b);
}

// Devolve true se pode seguir; senão já respondeu o erro.
export function autorizar(request, response) {
  const esperada = process.env.SENHA_APP;
  if (!esperada) {
    response.status(500).json({ error: "SENHA_APP não configurada na Vercel." });
    return false;
  }
  if (!senhaConfere(request.headers["x-senha"], esperada)) {
    response.status(401).json({ error: "Senha inválida." });
    return false;
  }
  return true;
}

export function responderErro(response, error) {
  const status = error.status || 500;
  response.status(status).json({ error: error.message });
}
