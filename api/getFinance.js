import { kv, chaves, autorizar, responderErro } from "./_lib.js";
import { lerTudo } from "./_dados.js";

export default async function handler(request, response) {
  if (!autorizar(request, response)) return;
  try {
    const { migrado, financeItems, acumulado } = await lerTudo(kv(), chaves());
    response.status(200).json({
      migrado,
      ambiente: chaves().ambiente,
      financeItems,
      acumulado: acumulado || { venda: 0, pix: 0, credito: 0, debito: 0, custo: 0, despesa: 0, func: 0, dinheiroCaixa: 0 },
    });
  } catch (error) {
    responderErro(response, error);
  }
}
