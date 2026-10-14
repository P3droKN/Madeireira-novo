import { kv, chaves, autorizar, responderErro, statusBanco } from "./_lib.js";
import { lerTudo } from "./_dados.js";
import { resumirLancamentos } from "../lib/resumo.js";

// Resumo do banco (quantidade e totais por mês, acumulado) para conferir com um arquivo de backup.
export default async function handler(request, response) {
  if (!autorizar(request, response)) return;
  try {
    const { migrado, financeItems, acumulado } = await lerTudo(kv(), chaves());
    response.status(200).json({ status: { ...statusBanco(), migrado }, resumo: resumirLancamentos(financeItems, acumulado) });
  } catch (error) {
    responderErro(response, error);
  }
}
