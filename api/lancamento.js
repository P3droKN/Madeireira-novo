import { kv, chaves, autorizar, responderErro } from "./_lib.js";
import { salvarLancamentos, excluirLancamento, reclassificar, atualizarCheque } from "./_dados.js";

// POST { itens: [...] } cria/edita lançamentos. DELETE ?id= marca como excluído.
// PATCH { ids, conta?, forma?, aceitarSugestao? } reclassifica em lote.
export default async function handler(request, response) {
  if (!autorizar(request, response)) return;
  try {
    if (request.method === "POST") {
      return response.status(200).json(await salvarLancamentos(kv(), chaves(), request.body?.itens));
    }
    if (request.method === "PATCH") {
      if (request.body?.acao === "cheque") return response.status(200).json({ lancamento: await atualizarCheque(kv(), chaves(), request.body) });
      return response.status(200).json(await reclassificar(kv(), chaves(), request.body));
    }
    if (request.method === "DELETE") {
      return response.status(200).json(await excluirLancamento(kv(), chaves(), request.query.id));
    }
    response.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    responderErro(response, error);
  }
}
