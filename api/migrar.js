import { kv, chaves, autorizar, responderErro } from "./_lib.js";
import { migrar } from "./_dados.js";

export default async function handler(request, response) {
  if (!autorizar(request, response)) return;
  if (request.method !== "POST") return response.status(405).json({ error: "Method not allowed" });
  try {
    response.status(200).json(await migrar(kv(), chaves()));
  } catch (error) {
    responderErro(response, error);
  }
}
