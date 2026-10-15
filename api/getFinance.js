import { kv, chaves, autorizar, responderErro, statusBanco } from "./_lib.js";
import { lerTudo } from "./_dados.js";

export default async function handler(request, response) {
  if (!autorizar(request, response)) return;
  try {
    const { migrado, migradoV2, financeItems, acumulado, configFinanceiro, saldos } = await lerTudo(kv(), chaves());
    response.status(200).json({
      migrado,
      migradoV2,
      configFinanceiro,
      saldos,
      ambiente: chaves().ambiente,
      status: statusBanco(),
      financeItems,
      acumulado: acumulado || { venda: 0, pix: 0, credito: 0, debito: 0, custo: 0, despesa: 0, func: 0, dinheiroCaixa: 0 },
    });
  } catch (error) {
    responderErro(response, error);
  }
}
