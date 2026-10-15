import { kv, chaves, autorizar, responderErro } from "./_lib.js";
import { salvarConfig, salvarConfigFinanceiro, salvarAbertura, registrarConferencia } from "./_dados.js";
import { CEPILHADO_PADRAO } from "../lib/catalogo.js";

// POST { config: {...} }      -> ajustes da calculadora (modificadores, cepilhado)
// POST { financeiro: {...} }  -> configuração financeira (formas, cartão, CMV, pessoal, impostos)
// POST { abertura: {...} }    -> abertura de saldos (dia da troca)
// POST { conferencia: {...} } -> conferência de saldo de uma conta
export default async function handler(request, response) {
  if (!autorizar(request, response)) return;
  if (request.method !== "POST") return response.status(405).json({ error: "Method not allowed" });
  try {
    if (request.body?.abertura) return response.status(200).json({ saldos: await salvarAbertura(kv(), chaves(), request.body.abertura) });
    if (request.body?.conferencia) return response.status(200).json({ conferencia: await registrarConferencia(kv(), chaves(), request.body.conferencia) });
    if (request.body?.financeiro) {
      return response.status(200).json({ financeiro: await salvarConfigFinanceiro(kv(), chaves(), request.body.financeiro) });
    }
    const config = await salvarConfig(kv(), chaves(), request.body?.config, Object.keys(CEPILHADO_PADRAO));
    response.status(200).json({ config });
  } catch (error) {
    responderErro(response, error);
  }
}
