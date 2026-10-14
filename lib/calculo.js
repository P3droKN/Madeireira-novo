// Cálculo de preço de um item do pedido. Função pura: usada pela calculadora,
// pelos testes e, no futuro, pelo agente de orçamento de WhatsApp.
import { UNIDADES } from "./catalogo.js";

export const arred = (v) => Math.round((v + Number.EPSILON) * 100) / 100;

function erro(msg) {
  return Object.assign(new Error(msg), { status: 400 });
}

/**
 * @param {object} e
 * @param {object} e.item          item do catálogo (custo, unidade)
 * @param {string} [e.acabamento]  BRUTO | CEPILHADO | UNICO
 * @param {number} [e.quantidade]  peças, m², jogos ou sacos
 * @param {number} [e.comprimento] metros por peça (só metro linear)
 * @param {number|null} [e.precoTabela] preço de venda cadastrado (por unidade de cobrança)
 * @param {{selecionada?: boolean, ultimasPecas?: boolean}} [e.modificadores]
 * @param {number|null} [e.precoManual] preço unitário digitado (substitui o sugerido)
 * @param {number|null} [e.totalManual] total digitado para o item (retalho, ou ajuste pelo total)
 * @param {string} [e.motivoAjuste] obrigatório quando o preço digitado difere do sugerido
 * @param {{modificadores: {selecionadaPct: number, ultimasPecasPct: number}}} config
 */
export function calcularItem(e, config) {
  const { item } = e;
  if (!item) throw erro("Item não encontrado no catálogo.");
  const unidade = UNIDADES[item.unidade];
  if (!unidade) throw erro(`Unidade desconhecida: ${item.unidade}`);
  const mods = e.modificadores || {};
  const pct = config?.modificadores || { selecionadaPct: 0, ultimasPecasPct: 0 };

  // Quantidade cobrada (metros, peças, m², jogos, sacos)
  let quantidadeCobrada;
  if (item.unidade === "valor_livre") {
    quantidadeCobrada = 1;
  } else {
    const q = Number(e.quantidade);
    if (!Number.isFinite(q) || q <= 0) throw erro("Informe a quantidade.");
    if (unidade.inteiro && !Number.isInteger(q)) throw erro("A quantidade deve ser um número inteiro.");
    if (unidade.pedeComprimento) {
      const c = Number(e.comprimento);
      if (!Number.isFinite(c) || c <= 0) throw erro("Informe o comprimento em metros.");
      quantidadeCobrada = q * c;
    } else {
      quantidadeCobrada = q;
    }
  }

  // Preço sugerido = tabela com os modificadores
  const precoTabela = e.precoTabela == null ? null : Number(e.precoTabela);
  let precoSugerido = null;
  if (precoTabela != null && item.unidade !== "valor_livre") {
    let p = precoTabela;
    if (mods.selecionada) p *= 1 + (Number(pct.selecionadaPct) || 0) / 100;
    if (mods.ultimasPecas) p *= 1 - (Number(pct.ultimasPecasPct) || 0) / 100;
    precoSugerido = arred(p);
  }

  // Preço digitado: unitário ou total
  let precoUnitario = precoSugerido;
  let vendaTotal = null;
  const totalManual = e.totalManual == null || e.totalManual === "" ? null : Number(e.totalManual);
  const precoManual = e.precoManual == null || e.precoManual === "" ? null : Number(e.precoManual);
  if (totalManual != null) {
    if (!Number.isFinite(totalManual) || totalManual < 0) throw erro("Valor de venda inválido.");
    vendaTotal = arred(totalManual);
    precoUnitario = totalManual / quantidadeCobrada;
  } else if (precoManual != null) {
    if (!Number.isFinite(precoManual) || precoManual < 0) throw erro("Preço de venda inválido.");
    precoUnitario = precoManual;
  }
  if (vendaTotal == null && precoUnitario != null) vendaTotal = arred(precoUnitario * quantidadeCobrada);

  const ajusteManual = item.unidade !== "valor_livre" && precoSugerido != null && vendaTotal != null
    && Math.abs(vendaTotal - arred(precoSugerido * quantidadeCobrada)) >= 0.005;

  const custoUnitario = item.custo;
  const custoTotal = custoUnitario == null ? null : arred(custoUnitario * quantidadeCobrada);
  const lucro = custoTotal != null && vendaTotal != null ? arred(vendaTotal - custoTotal) : null;
  const margem = lucro != null && vendaTotal > 0 ? lucro / vendaTotal : null;

  const pendencias = [];
  if (vendaTotal == null) pendencias.push("sem_preco");
  if (custoTotal == null) pendencias.push("sem_custo");
  if (ajusteManual && !String(e.motivoAjuste || "").trim()) pendencias.push("ajuste_sem_motivo");

  return {
    itemId: item.id,
    acabamento: e.acabamento || "UNICO",
    unidadeCobranca: unidade.cobranca,
    quantidadeCobrada: Math.round(quantidadeCobrada * 1000) / 1000,
    custoUnitario,
    custoTotal,
    precoTabela,
    precoSugerido,
    precoUnitario,
    vendaTotal,
    lucro,
    margem,
    ajusteManual,
    motivoAjuste: ajusteManual ? String(e.motivoAjuste || "").trim() : "",
    pendencias,
  };
}

// Totais do pedido. A margem só considera itens com custo e venda conhecidos.
export function totalizarPedido(resultados) {
  let custo = 0, venda = 0, vendaComCusto = 0, custoComVenda = 0;
  let semPreco = 0, semCusto = 0;
  for (const r of resultados) {
    if (r.custoTotal != null) custo += r.custoTotal; else semCusto++;
    if (r.vendaTotal != null) venda += r.vendaTotal; else semPreco++;
    if (r.custoTotal != null && r.vendaTotal != null) {
      vendaComCusto += r.vendaTotal;
      custoComVenda += r.custoTotal;
    }
  }
  return {
    custo: arred(custo),
    venda: arred(venda),
    margem: vendaComCusto > 0 ? (vendaComCusto - custoComVenda) / vendaComCusto : null,
    semPreco,
    semCusto,
    completo: semPreco === 0,
  };
}
