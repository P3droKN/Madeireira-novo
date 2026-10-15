import { kv, chaves, autorizar, responderErro } from "./_lib.js";
import { listarOrcamentos, salvarOrcamento, atualizarOrcamento, salvarCliente } from "./_dados.js";

// GET                       -> { orcamentos, clientes }
// POST { orcamento }        -> cria (número novo) ou edita (com id)
// POST { cliente }          -> cria/atualiza cliente (chave: telefone)
// PATCH { id, acao, ... }   -> status, contato, perdido, reabrir, fechar, precos
export default async function handler(request, response) {
  if (!autorizar(request, response)) return;
  try {
    const k = chaves();
    if (request.method === "GET") return response.status(200).json(await listarOrcamentos(kv(), k));
    if (request.method === "POST") {
      if (request.body?.cliente && !request.body?.orcamento) return response.status(200).json({ cliente: await salvarCliente(kv(), k, request.body.cliente) });
      const cfg = (await kv().get(k.configFinanceiro)) || {};
      return response.status(200).json({ orcamento: await salvarOrcamento(kv(), k, request.body?.orcamento, cfg) });
    }
    if (request.method === "PATCH") return response.status(200).json({ orcamento: await atualizarOrcamento(kv(), k, request.body) });
    response.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    responderErro(response, error);
  }
}
