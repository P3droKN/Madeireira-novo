import { kv, chaves, autorizar, responderErro } from "./_lib.js";
import { salvarLancamentos, excluirLancamento } from "./_dados.js";

// POST { itens: [...] } cria/edita lançamentos. DELETE ?id= marca como excluído.
export default async function handler(request, response) {
  if (!autorizar(request, response)) return;
  try {
    if (request.method === "POST") {
      return response.status(200).json(await salvarLancamentos(kv(), chaves(), request.body?.itens));
    }
    if (request.method === "DELETE") {
      return response.status(200).json(await excluirLancamento(kv(), chaves(), request.query.id));
    }
    response.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    responderErro(response, error);
  }
}
