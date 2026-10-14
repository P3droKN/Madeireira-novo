import { kv, chaves, autorizar, lerCustos, responderErro } from "./_lib.js";
import { salvarPrecos } from "./_dados.js";
import { montarCatalogo, chavePrecoValida } from "../lib/catalogo.js";

// POST { alteracoes: { "<item>|<acabamento>": preço ou null } }
export default async function handler(request, response) {
  if (!autorizar(request, response)) return;
  if (request.method !== "POST") return response.status(405).json({ error: "Method not allowed" });
  try {
    const catalogo = montarCatalogo(lerCustos());
    const r = await salvarPrecos(kv(), chaves(), request.body?.alteracoes, (c) => chavePrecoValida(catalogo, c));
    response.status(200).json(r);
  } catch (error) {
    responderErro(response, error);
  }
}
