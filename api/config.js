import { kv, chaves, autorizar, responderErro } from "./_lib.js";
import { salvarConfig, salvarConfigFinanceiro } from "./_dados.js";
import { CEPILHADO_PADRAO } from "../lib/catalogo.js";

// POST { config: {...} }      -> ajustes da calculadora (modificadores, cepilhado)
// POST { financeiro: {...} }  -> configuração financeira (formas, cartão, CMV, pessoal, impostos)
export default async function handler(request, response) {
  if (!autorizar(request, response)) return;
  if (request.method !== "POST") return response.status(405).json({ error: "Method not allowed" });
  try {
    if (request.body?.financeiro) {
      return response.status(200).json({ financeiro: await salvarConfigFinanceiro(kv(), chaves(), request.body.financeiro) });
    }
    const config = await salvarConfig(kv(), chaves(), request.body?.config, Object.keys(CEPILHADO_PADRAO));
    response.status(200).json({ config });
  } catch (error) {
    responderErro(response, error);
  }
}
