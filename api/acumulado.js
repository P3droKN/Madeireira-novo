import { kv, chaves, autorizar, responderErro } from "./_lib.js";
import { salvarAcumulado } from "./_dados.js";

export default async function handler(request, response) {
  if (!autorizar(request, response)) return;
  if (request.method !== "POST") return response.status(405).json({ error: "Method not allowed" });
  try {
    response.status(200).json({ acumulado: await salvarAcumulado(kv(), chaves(), request.body?.acumulado) });
  } catch (error) {
    responderErro(response, error);
  }
}
