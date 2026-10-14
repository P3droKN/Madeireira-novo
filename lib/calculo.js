// Cálculo de preço de um item do pedido. Função pura: usada pela calculadora,
// pelos testes e, no futuro, pelo agente de orçamento de WhatsApp.
import { UNIDADES } from "./catalogo.js";

export const arred = (v) => Math.round((v + Number.EPSILON) * 100) / 100;

function erro(msg) {
  return Object.assign(new Error(msg), { status: 400 });
}

/**
 * O preço sempre parte da tabela; o vendedor ajusta livremente por % ou pelo preço.
 * @param {object} e
 * @param {object} e.item          item do catálogo (custo, unidade)
 * @param {string} [e.acabamento]  BRUTO | CEPILHADO | UNICO
 * @param {number} [e.quantidade]  peças, m², jogos ou sacos
 * @param {number} [e.comprimento] metros por peça (só metro linear)
 * @param {number|null} [e.precoTabela] preço de venda cadastrado (por unidade de cobrança)
 * @param {number|null} [e.variacaoPct] % sobre a tabela (ex.: 10 ou -5)
 * @param {number|null} [e.precoManual] preço unitário digitado
 * @param {number|null} [e.totalManual] total do item (retalho, ou rateio do total do pedido)
 * @param {string} [e.motivo] motivo opcional da variação
 */
export function calcularItem(e) {
  const { item } = e;
  if (!item) throw erro("Item não encontrado no catálogo.");
  const unidade = UNIDADES[item.unidade];
  if (!unidade) throw erro(`Unidade desconhecida: ${item.unidade}`);
  const livre = item.unidade === "valor_livre";

  // Quantidade cobrada (metros, peças, m², jogos, sacos)
  let quantidadeCobrada;
  if (livre) {
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

  const vazio = (v) => v == null || v === "";
  const precoTabela = livre || vazio(e.precoTabela) ? null : Number(e.precoTabela);
  const tabelaTotal = precoTabela == null ? null : arred(precoTabela * quantidadeCobrada);

  // Preço final: total do item > preço digitado > % sobre a tabela > tabela
  let vendaTotal = null;
  let precoUnitario = null;
  if (!vazio(e.totalManual)) {
    const t = Number(e.totalManual);
    if (!Number.isFinite(t) || t < 0) throw erro("Valor de venda inválido.");
    vendaTotal = arred(t);
    precoUnitario = vendaTotal / quantidadeCobrada;
  } else if (!vazio(e.precoManual)) {
    const p = Number(e.precoManual);
    if (!Number.isFinite(p) || p < 0) throw erro("Preço de venda inválido.");
    precoUnitario = p;
  } else if (precoTabela != null && !vazio(e.variacaoPct)) {
    // O % vale sobre o total de tabela do item (exato nos centavos); o preço unitário sai dele
    const pct = Number(e.variacaoPct);
    if (!Number.isFinite(pct) || pct <= -100) throw erro("Percentual inválido.");
    vendaTotal = arred(tabelaTotal * (1 + pct / 100));
    precoUnitario = vendaTotal / quantidadeCobrada;
  } else {
    precoUnitario = precoTabela;
  }
  if (vendaTotal == null && precoUnitario != null) vendaTotal = arred(precoUnitario * quantidadeCobrada);

  // Variação sobre a tabela, sempre recalculada a partir do preço final
  const variacaoValor = tabelaTotal != null && vendaTotal != null ? arred(vendaTotal - tabelaTotal) : null;
  const variacaoPct = variacaoValor != null && tabelaTotal > 0 ? (vendaTotal / tabelaTotal - 1) * 100 : null;

  const custoUnitario = item.custo;
  const custoTotal = custoUnitario == null ? null : arred(custoUnitario * quantidadeCobrada);
  const lucro = custoTotal != null && vendaTotal != null ? arred(vendaTotal - custoTotal) : null;
  const margem = lucro != null && vendaTotal > 0 ? lucro / vendaTotal : null;

  const pendencias = [];
  if (vendaTotal == null) pendencias.push("sem_preco");
  if (custoTotal == null) pendencias.push("sem_custo");

  return {
    itemId: item.id,
    acabamento: e.acabamento || "UNICO",
    unidadeCobranca: unidade.cobranca,
    quantidadeCobrada: Math.round(quantidadeCobrada * 1000) / 1000,
    custoUnitario,
    custoTotal,
    precoTabela,
    tabelaTotal,
    precoUnitario,
    vendaTotal,
    variacaoValor,
    variacaoPct,
    ajustado: variacaoValor != null && Math.abs(variacaoValor) >= 0.01,
    motivo: String(e.motivo || "").trim(),
    lucro,
    margem,
    pendencias,
  };
}

// Totais do pedido. Variação compara só os itens que têm preço de tabela;
// a margem só considera itens com custo e venda conhecidos.
export function totalizarPedido(resultados) {
  let custo = 0, venda = 0, tabela = 0, vendaComTabela = 0, vendaComCusto = 0, custoComVenda = 0;
  let semPreco = 0, semCusto = 0, semTabela = 0;
  for (const r of resultados) {
    if (r.custoTotal != null) custo += r.custoTotal; else semCusto++;
    if (r.vendaTotal != null) venda += r.vendaTotal; else semPreco++;
    if (r.tabelaTotal != null && r.vendaTotal != null) {
      tabela += r.tabelaTotal;
      vendaComTabela += r.vendaTotal;
    } else if (r.tabelaTotal == null) {
      semTabela++;
    }
    if (r.custoTotal != null && r.vendaTotal != null) {
      vendaComCusto += r.vendaTotal;
      custoComVenda += r.custoTotal;
    }
  }
  const variacao = arred(vendaComTabela - tabela);
  return {
    custo: arred(custo),
    venda: arred(venda),
    tabela: arred(tabela),
    variacao,
    variacaoPct: tabela > 0 ? (vendaComTabela / tabela - 1) * 100 : null,
    margem: vendaComCusto > 0 ? (vendaComCusto - custoComVenda) / vendaComCusto : null,
    semPreco,
    semCusto,
    semTabela,
    completo: semPreco === 0,
  };
}

/**
 * Novo total do pedido distribuído entre os itens, proporcional ao valor de cada um.
 * Devolve o total de cada item (centavos exatos; a sobra do arredondamento vai para o maior item).
 * Itens sem preço não entram no rateio (ficam null).
 */
export function distribuirTotal(resultados, novoTotal) {
  const alvo = arred(Number(novoTotal));
  if (!Number.isFinite(alvo) || alvo < 0) throw erro("Total inválido.");
  const base = resultados.reduce((s, r) => s + (r.vendaTotal || 0), 0);
  if (base <= 0) throw erro("Nenhum item com preço para distribuir o total.");
  const fator = alvo / base;
  const totais = resultados.map((r) => (r.vendaTotal == null ? null : arred(r.vendaTotal * fator)));
  const soma = totais.reduce((s, t) => s + (t || 0), 0);
  const sobra = arred(alvo - soma);
  if (sobra !== 0) {
    let maior = -1;
    totais.forEach((t, i) => { if (t != null && (maior < 0 || t > totais[maior])) maior = i; });
    totais[maior] = arred(totais[maior] + sobra);
  }
  return totais;
}

// Motivos rápidos e opcionais para a variação. "Selecionada" e "Últimas peças"
// também aplicam o % padrão da config; "Outro" pede texto.
export const MOTIVOS_AJUSTE = ["Selecionada", "Últimas peças", "Cliente antigo", "Frete/entrega", "Urgência", "Outro"];

const brl = (v) => "R$ " + v.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");

/**
 * Texto de orçamento para colar no WhatsApp. Nunca recebe custo nem margem.
 * @param {{itens: {descricao: string, quantidade: string, precoUnitario: number|null, unidade: string, vendaTotal: number|null}[],
 *          totalItens: number, valorCobrado?: number|null, data?: string}} o
 */
export function textoWhatsApp(o) {
  const linhas = [`*Orçamento${o.data ? " - " + o.data : ""}*`, ""];
  let aCombinar = 0;
  for (const it of o.itens) {
    linhas.push(`• ${it.descricao}${it.quantidade ? " - " + it.quantidade : ""}`);
    if (it.vendaTotal == null) {
      aCombinar++;
      linhas.push("  _preço a combinar_");
    } else if (it.precoUnitario != null && it.unidade && it.unidade !== "un") {
      linhas.push(`  ${brl(it.precoUnitario)}/${it.unidade} → *${brl(it.vendaTotal)}*`);
    } else {
      linhas.push(`  *${brl(it.vendaTotal)}*`);
    }
  }
  linhas.push("");
  const cobrado = o.valorCobrado != null && o.valorCobrado > 0 ? o.valorCobrado : null;
  if (cobrado != null && Math.abs(cobrado - o.totalItens) >= 0.01 && o.totalItens > 0 && aCombinar === 0) {
    linhas.push(`Subtotal: ${brl(o.totalItens)}`);
    const dif = cobrado - o.totalItens;
    linhas.push(`${dif < 0 ? "Desconto" : "Acréscimo"}: ${brl(Math.abs(dif))}`);
    linhas.push(`*Total: ${brl(cobrado)}*`);
  } else if (cobrado != null && aCombinar > 0) {
    linhas.push(`*Total: ${brl(cobrado)}*`);
  } else {
    linhas.push(`*Total: ${brl(o.totalItens)}*${aCombinar ? ` + ${aCombinar} ${aCombinar > 1 ? "itens" : "item"} a combinar` : ""}`);
  }
  return linhas.join("\n");
}
