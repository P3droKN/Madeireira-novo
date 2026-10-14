import { kv, chaves, autorizar, lerCustos, responderErro } from "./_lib.js";
import { lerPrecosEConfig } from "./_dados.js";

// Custos (data/custos.json) + preços de venda e config (KV).
// Sem banco, devolve só os custos: a calculadora funciona e o vendedor digita os preços.
export default async function handler(request, response) {
  if (!autorizar(request, response)) return;
  try {
    const custos = lerCustos();
    let precos = {}, config = {}, kvDisponivel = true;
    try {
      ({ precos, config } = await lerPrecosEConfig(kv(), chaves()));
    } catch (e) {
      console.warn("KV indisponível para preços:", e.message);
      kvDisponivel = false;
    }
    response.status(200).json({ custos, precos, config, kvDisponivel });
  } catch (error) {
    responderErro(response, error);
  }
}
