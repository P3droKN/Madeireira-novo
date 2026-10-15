// Arquivos em /api que começam com "_" não viram rota na Vercel: aqui ficam só utilitários.
import { createClient } from "@vercel/kv";
import { createHash, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

let cliente;

export const hostDe = (u) => {
  if (!u) return "";
  try { return new URL(String(u).includes("://") ? u : "https://" + u).hostname.toLowerCase(); } catch { return ""; }
};

// Qual banco este site usa. Se houver duas configurações apontando para bancos diferentes,
// recusa em vez de adivinhar (uma delas pode ser a da produção).
function configBanco() {
  const kvUrl = process.env.KV_REST_API_URL;
  const upUrl = process.env.UPSTASH_REDIS_REST_URL;
  if (kvUrl && upUrl && hostDe(kvUrl) !== hostDe(upUrl)) {
    throw Object.assign(new Error("Há duas configurações de banco diferentes (KV_REST_API_URL e UPSTASH_REDIS_REST_URL). Remova a que não é deste projeto."), { status: 500 });
  }
  return kvUrl
    ? { url: kvUrl, token: process.env.KV_REST_API_TOKEN }
    : { url: upUrl, token: process.env.UPSTASH_REDIS_REST_TOKEN };
}

export function bancoHost() {
  return hostDe(configBanco().url);
}

// Trava do projeto de testes: BANCO_PRODUCAO_HOST guarda o host do banco de produção.
// Se o banco em uso for esse, nenhuma gravação é feita.
export function gravacaoBloqueada() {
  const prod = hostDe(process.env.BANCO_PRODUCAO_HOST);
  return Boolean(prod) && prod === bancoHost();
}

export function statusBanco() {
  return {
    ambiente: chaves().ambiente,
    prefixo: chaves().prefixo,
    bancoHost: bancoHost(),
    travaConfigurada: Boolean(process.env.BANCO_PRODUCAO_HOST),
    gravacaoBloqueada: gravacaoBloqueada(),
  };
}

export function kv() {
  if (!cliente) cliente = createClient(configBanco());
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
    precos: p + "madeireira_precos_venda",   // hash: "<item>|<acabamento>" -> preço
    config: p + "madeireira_config",
    configFinanceiro: p + "madeireira_config_financeiro",
    migradoV2: p + "madeireira_migrado_v2",
    orcamentos: p + "madeireira_orcamentos", // hash: ORC-0001 -> orçamento
    orcSeq: p + "madeireira_orc_seq",        // contador do número sequencial
    clientes: p + "madeireira_clientes",     // hash: telefone (DDD+número) ou C1, C2… -> cliente
    cliSeq: p + "madeireira_cli_seq",        // contador dos clientes sem WhatsApp (C1, C2…)
    saldos: p + "madeireira_saldos",         // abertura de saldos e conferências
  };
}

// Custos ficam em data/custos.json, incluído nas funções pelo vercel.json (e bloqueado para acesso direto).
let custosCache;
export function lerCustos() {
  if (!custosCache) custosCache = JSON.parse(readFileSync(join(process.cwd(), "data", "custos.json"), "utf8"));
  return custosCache;
}

export function senhaConfere(recebida, esperada) {
  if (typeof recebida !== "string" || typeof esperada !== "string" || !esperada) return false;
  const a = createHash("sha256").update(recebida).digest();
  const b = createHash("sha256").update(esperada).digest();
  return timingSafeEqual(a, b);
}

// Devolve true se pode seguir; senão já respondeu o erro.
export function autorizar(request, response) {
  try {
    configBanco();
  } catch (e) {
    response.status(500).json({ error: e.message });
    return false;
  }
  const esperada = process.env.SENHA_APP;
  if (!esperada) {
    response.status(500).json({ error: "SENHA_APP não configurada na Vercel." });
    return false;
  }
  if (!senhaConfere(request.headers["x-senha"], esperada)) {
    response.status(401).json({ error: "Senha inválida." });
    return false;
  }
  if (request.method !== "GET" && gravacaoBloqueada()) {
    response.status(423).json({ error: `Gravação bloqueada: este site está ligado ao banco de PRODUÇÃO (${bancoHost()}). Confira as variáveis do banco neste projeto.` });
    return false;
  }
  return true;
}

export function responderErro(response, error) {
  const status = error.status || 500;
  response.status(status).json({ error: error.message });
}
