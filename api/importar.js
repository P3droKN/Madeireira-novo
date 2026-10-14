import { kv, chaves, autorizar, responderErro } from "./_lib.js";
import { importar } from "./_dados.js";

// Junta os lançamentos do arquivo aos existentes. Não apaga nem altera nada.
export default async function handler(request, response) {
  if (!autorizar(request, response)) return;
  if (request.method !== "POST") return response.status(405).json({ error: "Method not allowed" });
  try {
    response.status(200).json(await importar(kv(), chaves(), request.body));
  } catch (error) {
    responderErro(response, error);
  }
}
