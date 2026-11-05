// Custo dos itens de uma venda, calculado no servidor pelo catálogo (data/custos.json), nunca pelo que veio da
// tela: uma tela aberta desde antes de mudar um custo não grava o custo velho. Vale para o dono e para o funcionário.
// Corrigir uma venda mantém o custo gravado dos itens que não mudaram (mesmo item, acabamento e quantidade).
import { lerCustos } from "./_lib.js";
import { montarCatalogo, idAtual, UNIDADES } from "../lib/catalogo.js";

const arred = (v) => Math.round(v * 100) / 100;
const chaveItem = (i) => [idAtual(String(i?.itemId || "")), i?.acabamento || "UNICO", Number(i?.quantidade) || 0, Number(i?.comprimento) || 0].join("|");

export const catalogoDoServidor = (configSalva) => montarCatalogo(lerCustos(), configSalva);

/** Quantidade cobrada (metros, peças, m²…) pela unidade do item, como em lib/calculo.js. */
export function quantidadeCobradaDe(item, i) {
  if (item.unidade === "valor_livre") return 1;
  const q = Number(i.quantidade);
  return UNIDADES[item.unidade]?.pedeComprimento ? q * Number(i.comprimento) : q;
}

/**
 * itens: os itens da venda; antesItens: os itens gravados (correção). Devolve { itens, cmv }.
 * "Outros" (custo digitado na hora): vale o que o dono digitou (o funcionário não digita: fica não informado).
 * Item fora do catálogo (dado antigo): fica o custo que veio.
 */
export function custoDosItens(itens, catalogo, { antesItens = [], custoDigitadoVale = true } = {}) {
  const sobras = new Map();
  for (const a of antesItens || []) {
    const k = chaveItem(a);
    if (!sobras.has(k)) sobras.set(k, []);
    sobras.get(k).push(a);
  }
  let cmv = 0;
  const novos = (itens || []).map((i) => {
    const item = catalogo.itens.get(idAtual(String(i?.itemId || "")));
    let custoTotal;
    const igual = sobras.get(chaveItem(i))?.shift();
    if (!item) custoTotal = i.custoTotal ?? null;
    else if (item.pedeCusto) custoTotal = custoDigitadoVale && i.custoTotal != null && i.custoTotal !== "" ? arred(Number(i.custoTotal)) : null;
    else if (igual && igual.custoTotal !== undefined) custoTotal = igual.custoTotal;
    else {
      const qc = quantidadeCobradaDe(item, i);
      custoTotal = item.custo == null || !(qc > 0) ? null : arred(item.custo * qc);
    }
    if (custoTotal != null) cmv += Math.round(custoTotal * 100);
    return { ...i, custoTotal };
  });
  return { itens: novos, cmv: cmv / 100 };
}
