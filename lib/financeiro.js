// Cálculos financeiros (funções puras): DRE, CMV estimado, provisões, Simples, estoque em R$.
// Sistema gerencial: não substitui a contabilidade oficial do escritório.
import { contaPorId, mesclarConfigFinanceiro } from "./planoContas.js";
import { converterLancamento } from "./migracaoV2.js";

const centavos = (v) => Math.round(Number(v || 0) * 100);
const reais = (c) => Math.round(c) / 100;
export const mesDe = (l) => String(l.competencia || l.date || "").slice(0, 7);

// Simples Nacional, Anexo I: alíquota efetiva = (RBT12 × nominal − parcela a deduzir) ÷ RBT12
export function aliquotaEfetivaSimples(rbt12, tabela) {
  const r = Number(rbt12);
  if (!Number.isFinite(r) || r <= 0) return null;
  const faixa = tabela.find(([ate]) => r <= ate) || tabela[tabela.length - 1];
  const [, nominal, deduzir] = faixa;
  return (r * (nominal / 100) - deduzir) / r;
}

// Lista pronta para os cálculos: sem excluídos e sempre no formato v2
export function normalizar(lancamentos, config) {
  const cfg = mesclarConfigFinanceiro(config);
  const idsVenda = new Set(lancamentos.filter((l) => l.category === "venda").map((l) => String(l.id)));
  return lancamentos.filter((l) => l && !l.excluido).map((l) => converterLancamento(l, cfg.formas, idsVenda));
}

const ehVenda = (l) => l.conta === "venda_produtos";
// Valor dos produtos de uma venda: o frete cobrado junto (campo frete) não tem custo de mercadoria
const valorProdutos = (l) => centavos(l.value) - centavos(l.frete || 0);
const temCmv = (l) => l.cmv != null && Number.isFinite(Number(l.cmv));

function mesesAnteriores(mes, n) {
  const [a, m] = mes.split("-").map(Number);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(a, m - 2 - i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

/**
 * Margem bruta usada para estimar o CMV das vendas lançadas sem itens:
 * média real das vendas da calculadora nos últimos N meses (se houver vendas em todos eles),
 * senão a margem padrão da config. Sempre marcada como "estimado".
 */
export function margemReferencia(lista, mes, cfg) {
  const meses = mesesAnteriores(mes, cfg.cmv.mesesMedia);
  let venda = 0, cmv = 0;
  const comVenda = new Set();
  for (const l of lista) {
    if (!ehVenda(l) || !temCmv(l) || l.origem !== "calculadora" || !meses.includes(mesDe(l))) continue;
    venda += valorProdutos(l);
    cmv += centavos(l.cmv);
    comVenda.add(mesDe(l));
  }
  if (comVenda.size === meses.length && venda > 0) return { margem: (venda - cmv) / venda, fonte: "media" };
  return { margem: cfg.cmv.margemPadraoPct / 100, fonte: "padrao" };
}

function taxaCartao(pag, cfg) {
  const forma = pag.forma;
  if (forma === "debito") return cfg.cartao.debito.taxaPct;
  if (forma === "credito") return cfg.cartao.credito.taxaPct;
  if (forma === "credito_parcelado") return cfg.cartao.parcelado.taxaPctPorParcelas[pag.parcelas] ?? 0;
  return 0;
}

/**
 * DRE gerencial de um mês (regime de competência).
 * @returns {{ mes, linhas: {id, rotulo, valor, tipo, estimado?, nota?}[], valores, avisos, info }}
 */
export function montarDRE(lancamentos, configSalva, mes, { jaNormalizado = false } = {}) {
  const cfg = mesclarConfigFinanceiro(configSalva);
  const lista = jaNormalizado ? lancamentos : normalizar(lancamentos, cfg);
  const doMes = lista.filter((l) => mesDe(l) === mes);
  const soma = (filtro) => doMes.filter(filtro).reduce((s, l) => s + centavos(l.value), 0);
  const porConta = (...ids) => soma((l) => ids.includes(l.conta));

  const receitaBruta = porConta("venda_produtos", "frete_cobrado", "servicos");

  // Deduções: DAS é o valor real lançado; estimativa só se ligada e se não houver guia no mês
  const dasReal = porConta("das");
  let dasEstimado = 0;
  if (!dasReal && cfg.impostos.estimarSimples) {
    const aliq = aliquotaEfetivaSimples(cfg.impostos.rbt12, cfg.impostos.tabelaSimples);
    if (aliq != null) dasEstimado = Math.round(receitaBruta * aliq);
  }
  const descontos = porConta("descontos");
  const devolucoes = porConta("devolucoes");
  const deducoes = dasReal + dasEstimado + descontos + devolucoes;
  const receitaLiquida = receitaBruta - deducoes;

  // CMV: calculadora (gravado na venda) + custos antigos classificados como CMV + estimado
  const cmvCalculadora = doMes.filter((l) => ehVenda(l) && temCmv(l)).reduce((s, l) => s + centavos(l.cmv), 0);
  const cmvClassificado = porConta("cmv");
  const ref = margemReferencia(lista, mes, cfg);
  // Vendas antigas (migradas) não recebem estimativa: o CMV delas vem dos custos classificados
  const semCmvNovas = doMes.filter((l) => ehVenda(l) && !temCmv(l) && !l.migrado);
  const cmvEstimado = Math.round(semCmvNovas.reduce((s, l) => s + valorProdutos(l), 0) * (1 - ref.margem));
  const vendasAntigasSemCmv = doMes.filter((l) => ehVenda(l) && !temCmv(l) && l.migrado).reduce((s, l) => s + centavos(l.value), 0);
  const cmv = cmvCalculadora + cmvClassificado + cmvEstimado;
  const lucroBruto = receitaLiquida - cmv;

  // Despesas variáveis: taxa de cartão automática (pela config) + lançadas
  let taxaAuto = 0;
  for (const l of doMes.filter(ehVenda)) {
    for (const p of l.pagamentos || []) taxaAuto += centavos(p.valor) * (taxaCartao(p, cfg) / 100);
  }
  taxaAuto = Math.round(taxaAuto);
  const taxaLancada = porConta("taxa_cartao");
  const frete = porConta("frete_entrega");
  const comissoes = porConta("comissoes");
  const variaveis = taxaAuto + taxaLancada + frete + comissoes;
  const margemContribuicao = lucroBruto - variaveis;

  // Pessoal: salários + FGTS (real ou estimado) + provisão de 13º e férias
  const salarios = porConta("salarios");
  const fgtsReal = porConta("fgts");
  const fgtsEstimado = !fgtsReal && cfg.pessoal.estimarFgts ? Math.round(salarios * cfg.pessoal.fgtsPct / 100) : 0;
  const provisao = cfg.pessoal.provisao13FeriasLigada ? Math.round(salarios * cfg.pessoal.provisaoPct / 100) : 0;
  const decimoPago = cfg.pessoal.provisao13FeriasLigada ? 0 : porConta("decimo_ferias_pagos");
  const outrosPessoal = porConta("vale", "rescisoes");
  const pessoal = salarios + fgtsReal + fgtsEstimado + provisao + decimoPago + outrosPessoal;

  const fixas = soma((l) => contaPorId[l.conta]?.grupo === "fixas");
  const operacionais = soma((l) => contaPorId[l.conta]?.grupo === "operacionais");
  const aClassificarDespesa = porConta("classificar_despesa");
  const ebitda = margemContribuicao - pessoal - fixas - operacionais - aClassificarDespesa;

  const financeiro = porConta("rendimentos") - porConta("tarifas", "juros", "antecipacao");

  // Depreciação (opcional): investimentos com vida útil em meses, a partir do mês da compra
  let depreciacao = 0;
  if (cfg.depreciacaoLigada) {
    for (const l of lista.filter((x) => x.conta === "investimento" && Number(x.vidaUtilMeses) > 0)) {
      const inicio = mesDe(l);
      const n = Number(l.vidaUtilMeses);
      const [ai, mi] = inicio.split("-").map(Number);
      const [a, m] = mes.split("-").map(Number);
      const idx = (a - ai) * 12 + (m - mi);
      if (idx >= 0 && idx < n) depreciacao += Math.round(centavos(l.value) / n);
    }
  }
  const lucroLiquido = ebitda + financeiro - depreciacao;

  const retiradas = porConta("retirada");
  const aportes = porConta("aporte");
  const compras = porConta("compra_material", "frete_compras");
  const custoAClassificar = porConta("classificar_custo");

  const R = reais;
  const linhas = [
    { id: "receitaBruta", rotulo: "(+) Receita bruta", valor: R(receitaBruta), tipo: "total" },
    { id: "dasReal", rotulo: "(−) Impostos (DAS)", valor: -R(dasReal), tipo: "sub" },
    ...(dasEstimado ? [{ id: "dasEstimado", rotulo: "(−) DAS estimado (Simples)", valor: -R(dasEstimado), tipo: "sub", estimado: true }] : []),
    { id: "descontos", rotulo: "(−) Descontos concedidos", valor: -R(descontos), tipo: "sub" },
    { id: "devolucoes", rotulo: "(−) Devoluções", valor: -R(devolucoes), tipo: "sub" },
    { id: "receitaLiquida", rotulo: "(=) Receita líquida", valor: R(receitaLiquida), tipo: "total" },
    { id: "cmvCalculadora", rotulo: "(−) CMV das vendas da calculadora", valor: -R(cmvCalculadora), tipo: "sub" },
    { id: "cmvClassificado", rotulo: "(−) CMV classificado (custos lançados)", valor: -R(cmvClassificado), tipo: "sub" },
    { id: "cmvEstimado", rotulo: `(−) CMV estimado (margem ${ref.fonte === "media" ? "média real" : "padrão"} de ${(ref.margem * 100).toFixed(1).replace(".", ",")}%)`, valor: -R(cmvEstimado), tipo: "sub", estimado: cmvEstimado > 0 },
    { id: "lucroBruto", rotulo: "(=) Lucro bruto", valor: R(lucroBruto), tipo: "total", margem: true },
    { id: "taxaCartao", rotulo: "(−) Taxas de cartão", valor: -R(taxaAuto + taxaLancada), tipo: "sub" },
    { id: "frete", rotulo: "(−) Frete de entrega", valor: -R(frete), tipo: "sub" },
    { id: "comissoes", rotulo: "(−) Comissões", valor: -R(comissoes), tipo: "sub" },
    { id: "margemContribuicao", rotulo: "(=) Margem de contribuição", valor: R(margemContribuicao), tipo: "total", margem: true },
    { id: "salarios", rotulo: "(−) Salários", valor: -R(salarios), tipo: "sub" },
    { id: "fgts", rotulo: fgtsEstimado ? "(−) FGTS estimado (8%)" : "(−) FGTS", valor: -R(fgtsReal + fgtsEstimado), tipo: "sub", estimado: fgtsEstimado > 0 },
    ...(provisao ? [{ id: "provisao", rotulo: "(−) Provisão de 13º e férias", valor: -R(provisao), tipo: "sub", estimado: true }] : []),
    ...(decimoPago ? [{ id: "decimoPago", rotulo: "(−) 13º e férias pagos", valor: -R(decimoPago), tipo: "sub" }] : []),
    { id: "outrosPessoal", rotulo: "(−) Vale e rescisões", valor: -R(outrosPessoal), tipo: "sub" },
    { id: "fixas", rotulo: "(−) Despesas fixas / administrativas", valor: -R(fixas), tipo: "grupo" },
    { id: "operacionais", rotulo: "(−) Operacionais", valor: -R(operacionais), tipo: "grupo" },
    { id: "aClassificarDespesa", rotulo: "(−) Despesas gerais (a classificar)", valor: -R(aClassificarDespesa), tipo: "grupo", alerta: aClassificarDespesa > 0 },
    { id: "ebitda", rotulo: "(=) Resultado operacional (EBITDA)", valor: R(ebitda), tipo: "total" },
    { id: "financeiro", rotulo: "(±) Resultado financeiro", valor: R(financeiro), tipo: "grupo" },
    ...(cfg.depreciacaoLigada ? [{ id: "depreciacao", rotulo: "(−) Depreciação", valor: -R(depreciacao), tipo: "grupo" }] : []),
    { id: "lucroLiquido", rotulo: "(=) Lucro líquido", valor: R(lucroLiquido), tipo: "total", margem: true, destaque: true },
  ];

  for (const l of linhas) l.valor = l.valor || 0; // evita "-0"

  const avisos = [];
  if (custoAClassificar) avisos.push(`R$ ${fmt(R(custoAClassificar))} em custos ainda não classificados (compra ou CMV) estão fora do resultado: o lucro pode estar maior do que o real.`);
  if (aClassificarDespesa) avisos.push(`R$ ${fmt(R(aClassificarDespesa))} em despesas gerais ainda sem conta definida (já descontadas do resultado).`);
  if (cmvEstimado) avisos.push(`CMV estimado em R$ ${fmt(R(cmvEstimado))} para vendas lançadas sem itens.`);
  if (vendasAntigasSemCmv && !cmvClassificado && custoAClassificar) avisos.push("As vendas antigas não têm custo gravado: classifique os custos do mês como compra ou CMV.");

  return {
    mes,
    linhas,
    valores: Object.fromEntries(linhas.map((l) => [l.id, l.valor])),
    avisos,
    info: {
      retiradas: R(retiradas),
      lucroRetido: R(lucroLiquido - retiradas),
      aportes: R(aportes),
      compras: R(compras),
      custoAClassificar: R(custoAClassificar),
      // Frete cobrado do cliente (já dentro da receita bruta): o das vendas + o lançado na conta "Frete cobrado"
      freteCobrado: R(doMes.filter(ehVenda).reduce((s, l) => s + centavos(l.frete || 0), 0) + porConta("frete_cobrado")),
      margemReferencia: ref,
      pontoEquilibrio: margemContribuicao > 0 && receitaBruta > 0
        ? R((pessoal + fixas + operacionais + aClassificarDespesa) / (margemContribuicao / receitaBruta))
        : null,
    },
  };
}

const fmt = (v) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// DRE anual: 12 meses + total
export function montarDREAnual(lancamentos, configSalva, ano) {
  const cfg = mesclarConfigFinanceiro(configSalva);
  const lista = normalizar(lancamentos, cfg);
  const meses = Array.from({ length: 12 }, (_, i) => montarDRE(lista, cfg, `${ano}-${String(i + 1).padStart(2, "0")}`, { jaNormalizado: true }));
  const ids = [...new Set(meses.flatMap((d) => d.linhas.map((l) => l.id)))];
  const modelo = Object.fromEntries(meses.flatMap((d) => d.linhas.map((l) => [l.id, l])));
  const total = Object.fromEntries(ids.map((id) => [id, reais(meses.reduce((s, d) => s + centavos(d.valores[id] || 0), 0))]));
  return { ano, ids, modelo, meses, total };
}

// Estoque estimado em R$ (compras − CMV), desde a data inicial da config
export function estoqueEstimado(lancamentos, configSalva, ateMes) {
  const cfg = mesclarConfigFinanceiro(configSalva);
  const lista = normalizar(lancamentos, cfg);
  const inicio = cfg.estoque.dataInicial ? cfg.estoque.dataInicial.slice(0, 7) : lista.map(mesDe).filter(Boolean).sort()[0];
  if (!inicio) return reais(centavos(cfg.estoque.inicial));
  let total = centavos(cfg.estoque.inicial);
  let [a, m] = inicio.split("-").map(Number);
  for (;;) {
    const mes = `${a}-${String(m).padStart(2, "0")}`;
    if (mes > ateMes) break;
    const d = montarDRE(lista, cfg, mes, { jaNormalizado: true });
    total += centavos(d.info.compras) + centavos(d.valores.cmvCalculadora) + centavos(d.valores.cmvClassificado) + centavos(d.valores.cmvEstimado);
    if (++m > 12) { m = 1; a++; }
  }
  return reais(total);
}
