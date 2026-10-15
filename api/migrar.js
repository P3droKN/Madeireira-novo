import { kv, chaves, autorizar, responderErro } from "./_lib.js";
import { migrar, migrarV2 } from "./_dados.js";

// POST            -> ativa o salvamento seguro (lista antiga -> lançamento a lançamento)
// POST ?versao=2  -> migra para o financeiro novo (plano de contas, formas, abertura de agosto)
export default async function handler(request, response) {
  if (!autorizar(request, response)) return;
  if (request.method !== "POST") return response.status(405).json({ error: "Method not allowed" });
  try {
    const r = request.query.versao === "2" ? await migrarV2(kv(), chaves()) : await migrar(kv(), chaves());
    response.status(200).json(r);
  } catch (error) {
    responderErro(response, error);
  }
}
