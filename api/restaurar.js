import { kv, chaves, autorizar, responderErro } from "./_lib.js";
import { restaurar } from "./_dados.js";

// POST { confirmacao: "RESTAURAR", arquivo: <conteúdo do backup> }
export default async function handler(request, response) {
  if (!autorizar(request, response)) return;
  if (request.method !== "POST") return response.status(405).json({ error: "Method not allowed" });
  if (request.body?.confirmacao !== "RESTAURAR") {
    return response.status(400).json({ error: 'Envie confirmacao: "RESTAURAR".' });
  }
  try {
    response.status(200).json(await restaurar(kv(), chaves(), request.body.arquivo));
  } catch (error) {
    responderErro(response, error);
  }
}
