// Cálculos financeiros (funções puras): DRE, CMV estimado, provisões, Simples, estoque em R$.
// Sistema gerencial: não substitui a contabilidade oficial do escritório.
import { contaPorId, mesclarConfigFinanceiro, taxaCartaoCentavos } from "./planoContas.js";
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

// Lista pronta para os cálculos: sem excluídos e sempre no formato v2. Guardada enquanto a lista e as formas
// não mudam (a tela recalcula muitas vezes com os mesmos dados: busca, filtros, relatórios)
const cacheNormalizar = new WeakMap();
export function normalizar(lancamentos, config) {
  const cfg = mesclarConfigFinanceiro(config);
  const chave = JSON.stringify(cfg.formas);
  const guardado = Array.isArray(lancamentos) ? cacheNormalizar.get(lancamentos) : null;
  if (guardado && guardado.chave === chave && guardado.tamanho === lancamentos.length) return guardado.lista;
  const lista = normalizarAgora(lancamentos, cfg);
  if (Array.isArray(lancamentos)) cacheNormalizar.set(lancamentos, { chave, tamanho: lancamentos.length, lista });
  return lista;
}
function normalizarAgora(lancamentos, cfg) {
  const idsVenda = new Set(lancamentos.filter((l) => l.category === "venda").map((l) => String(l.id)));
  return lancamentos.filter((l) => l && !l.excluido).map((l) => converterLancamento(l, cfg.formas, idsVenda));
}

const ehVenda = (l) => l.conta === "venda_produtos";
// Valor dos produtos de uma venda: o frete cobrado junto (campo frete) não tem custo de mercadoria
const valorProdutos = (l) => centavos(l.value) - centavos(l.frete || 0);
const temCmv = (l) => l.cmv != null && Number.isFinite(Number(l.cmv));
// Custo calculado pelos itens (Vender ou Caixa › Lançar com itens) × informado à mão (sem itens)
const temItens = (l) => Array.isArray(l.itens) && l.itens.length > 0;
// Vínculo do salário: CLT (padrão, inclusive nos dados antigos), não CLT ou pró-labore.
// FGTS e provisão de 13º/férias só incidem sobre CLT.
export const VINCULOS = [
  { id: "clt", nome: "CLT" },
  { id: "nao_clt", nome: "Não CLT" },
  { id: "pro_labore", nome: "Pró-labore (dono)" },
];
export const vinculoDe = (l) => (VINCULOS.some((v) => v.id === l.vinculo) ? l.vinculo : "clt");
const FORMAS_CARTAO = ["debito", "credito", "credito_parcelado"];

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
    if (!ehVenda(l) || !temCmv(l) || !(l.origem === "calculadora" || temItens(l)) || !meses.includes(mesDe(l))) continue;
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
// deDia/ateDia (opcionais): só os lançamentos desses dias do mês (mês em andamento comparado com o mesmo
// pedaço dos anteriores; Resumo do dia). A regra do CMV estimado continua decidida pelo mês inteiro,
// então a soma dos dias fecha com o mês.
export function montarDRE(lancamentos, configSalva, mes, { jaNormalizado = false, ateDia = null, deDia = null } = {}) {
  const cfg = mesclarConfigFinanceiro(configSalva);
  const lista = jaNormalizado ? lancamentos : normalizar(lancamentos, cfg);
  const dia = (l) => Number(String(l.competencia || l.date || "").slice(8, 10));
  const mesInteiro = lista.filter((l) => mesDe(l) === mes);
  const doMes = mesInteiro.filter((l) => (!ateDia || dia(l) <= ateDia) && (!deDia || dia(l) >= deDia));
  const soma = (filtro) => doMes.filter(filtro).reduce((s, l) => s + centavos(l.value), 0);
  const porConta = (...ids) => soma((l) => ids.includes(l.conta));

  const receitaBruta = porConta("venda_produtos", "frete_cobrado", "servicos");

  // Deduções: DAS é a guia lançada (competência = mês a que a guia se refere). Sem guia no mês,
  // estima pelo Simples (Anexo I, RBT12 de Ajustes › Financeiro); a guia, quando lançada, substitui a estimativa.
  // Estimativas contábeis desligadas (padrão): sem DAS estimado, FGTS estimado e provisão; os lançamentos reais contam sempre
  const estimar = cfg.estimativasContabeis === true;
  const dasReal = porConta("das");
  let dasEstimado = 0, aliquotaDas = null, dasSemEstimativa = false;
  if (estimar && !dasReal && receitaBruta > 0 && cfg.impostos.regime === "simples_nacional") {
    aliquotaDas = aliquotaEfetivaSimples(cfg.impostos.rbt12, cfg.impostos.tabelaSimples);
    if (aliquotaDas != null) dasEstimado = Math.round(receitaBruta * aliquotaDas);
    else dasSemEstimativa = true;
  }
  const descontos = porConta("descontos");
  const devolucoes = porConta("devolucoes");
  const deducoes = dasReal + dasEstimado + descontos + devolucoes;
  const receitaLiquida = receitaBruta - deducoes;

  // CMV: calculadora (gravado na venda) + custos antigos classificados como CMV + estimado
  const cmvCalculadora = doMes.filter((l) => ehVenda(l) && temCmv(l) && temItens(l)).reduce((s, l) => s + centavos(l.cmv), 0);
  const cmvInformado = doMes.filter((l) => ehVenda(l) && temCmv(l) && !temItens(l)).reduce((s, l) => s + centavos(l.cmv), 0);
  const cmvClassificado = porConta("cmv");
  const ref = margemReferencia(lista, mes, cfg);
  // Custos migrados do sistema antigo que ainda não viraram Compra (estoque) ou CMV: entram como custo
  // (linha amarela) até serem classificados. Nunca ficam fora do resultado.
  const custosAClassificar = doMes.filter((l) => l.conta === "classificar_custo");
  const custoAClassificar = custosAClassificar.reduce((s, l) => s + centavos(l.value), 0);
  // CMV estimado (vendas sem custo gravado, novas ou antigas): só quando o mês NÃO tem custo a classificar
  // nem CMV classificado. Se tiver, esse custo já representa o custo das vendas do mês e a estimativa
  // contaria o custo em dobro.
  const vendasSemCusto = doMes.filter((l) => ehVenda(l) && !temCmv(l)).reduce((s, l) => s + valorProdutos(l), 0);
  const custoDoMesJaLancado = mesInteiro.some((l) => (l.conta === "classificar_custo" || l.conta === "cmv") && centavos(l.value) > 0);
  // arredondado por venda: a soma dos dias fecha com o mês, centavo por centavo
  const cmvEstimado = custoDoMesJaLancado ? 0
    : doMes.filter((l) => ehVenda(l) && !temCmv(l)).reduce((s, l) => s + Math.round(valorProdutos(l) * (1 - ref.margem)), 0);
  const cmv = cmvCalculadora + cmvInformado + cmvClassificado + cmvEstimado;
  const lucroBruto = receitaLiquida - cmv - custoAClassificar;

  // Despesas variáveis: taxa de cartão automática (pela config) + lançadas. Vale para todo pagamento em cartão:
  // vendas, serviços, frete cobrado e recebimento de fiado (a mesma conta do caixa)
  let taxaAuto = 0, cartaoSemTaxa = 0;
  for (const l of doMes.filter((x) => Array.isArray(x.pagamentos) && (["venda_produtos", "frete_cobrado", "servicos", "recebimento"].includes(x.conta)))) {
    for (const p of l.pagamentos) {
      taxaAuto += taxaCartaoCentavos(p, cfg);
      if (FORMAS_CARTAO.includes(p.forma) && !(taxaCartao(p, cfg) > 0)) cartaoSemTaxa += centavos(p.valor);
    }
  }
  const taxaLancada = porConta("taxa_cartao");
  const frete = porConta("frete_entrega");
  const comissoes = porConta("comissoes");
  const variaveis = taxaAuto + taxaLancada + frete + comissoes;
  const margemContribuicao = lucroBruto - variaveis;

  // Pessoal: salários + FGTS (real ou estimado) + provisão de 13º e férias
  // FGTS e provisão: só sobre salários CLT (não CLT e pró-labore do dono não geram)
  const salarios = porConta("salarios");
  const salariosClt = soma((l) => l.conta === "salarios" && vinculoDe(l) === "clt");
  const fgtsReal = porConta("fgts");
  const provisaoLigada = estimar && cfg.pessoal.provisao13FeriasLigada;
  const fgtsEstimado = estimar && !fgtsReal && cfg.pessoal.estimarFgts ? Math.round(salariosClt * cfg.pessoal.fgtsPct / 100) : 0;
  const provisao = provisaoLigada ? Math.round(salariosClt * cfg.pessoal.provisaoPct / 100) : 0;
  // Com provisão, o 13º/férias pago já foi provisionado; sem ela, o pago entra no mês em que foi pago
  const decimoPago = provisaoLigada ? 0 : porConta("decimo_ferias_pagos");
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

  const R = reais;
  const linhas = [
    { id: "receitaBruta", rotulo: "(+) Receita bruta", valor: R(receitaBruta), tipo: "total" },
    { id: "dasReal", rotulo: "(−) Impostos (DAS)", valor: -R(dasReal), tipo: "sub" },
    ...(dasEstimado ? [{ id: "dasEstimado", rotulo: `(−) DAS estimado (Simples, ${(aliquotaDas * 100).toFixed(2).replace(".", ",")}% sobre a receita)`, valor: -R(dasEstimado), tipo: "sub", estimado: true }] : []),
    { id: "descontos", rotulo: "(−) Descontos concedidos", valor: -R(descontos), tipo: "sub" },
    { id: "devolucoes", rotulo: "(−) Devoluções", valor: -R(devolucoes), tipo: "sub" },
    { id: "receitaLiquida", rotulo: "(=) Receita líquida", valor: R(receitaLiquida), tipo: "total" },
    { id: "cmvCalculadora", rotulo: "(−) CMV calculado pelos itens", valor: -R(cmvCalculadora), tipo: "sub" },
    ...(cmvInformado ? [{ id: "cmvInformado", rotulo: "(−) CMV informado à mão (vendas sem itens)", valor: -R(cmvInformado), tipo: "sub" }] : []),
    { id: "cmvClassificado", rotulo: "(−) CMV classificado (custos lançados)", valor: -R(cmvClassificado), tipo: "sub" },
    { id: "cmvEstimado", rotulo: `(−) CMV estimado (margem ${ref.fonte === "media" ? "média real" : "padrão"} de ${(ref.margem * 100).toFixed(1).replace(".", ",")}%)`, valor: -R(cmvEstimado), tipo: "sub", estimado: cmvEstimado > 0 },
    ...(custoAClassificar ? [{ id: "custoAClassificar", rotulo: "(−) Custos a classificar (compra ou CMV?)", valor: -R(custoAClassificar), tipo: "sub", alerta: true }] : []),
    { id: "lucroBruto", rotulo: "(=) Lucro bruto", valor: R(lucroBruto), tipo: "total", margem: true },
    { id: "taxaCartao", rotulo: "(−) Taxas de cartão", valor: -R(taxaAuto + taxaLancada), tipo: "sub" },
    { id: "frete", rotulo: "(−) Frete de entrega", valor: -R(frete), tipo: "sub" },
    { id: "comissoes", rotulo: "(−) Comissões", valor: -R(comissoes), tipo: "sub" },
    { id: "margemContribuicao", rotulo: "(=) Margem de contribuição", valor: R(margemContribuicao), tipo: "total", margem: true },
    { id: "salarios", rotulo: "(−) Salários", valor: -R(salarios), tipo: "sub" },
    { id: "fgts", rotulo: fgtsEstimado ? `(−) FGTS estimado (${String(cfg.pessoal.fgtsPct).replace(".", ",")}% dos salários CLT)` : "(−) FGTS", valor: -R(fgtsReal + fgtsEstimado), tipo: "sub", estimado: fgtsEstimado > 0 },
    ...(provisao ? [{ id: "provisao", rotulo: "(−) Provisão de 13º e férias (salários CLT)", valor: -R(provisao), tipo: "sub", estimado: true }] : []),
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

  // O que ainda é provisório no resultado (aviso no topo do DRE)
  const provisorio = [];
  if (custoAClassificar) provisorio.push({ tipo: "custos", texto: `${custosAClassificar.length} custo(s) a classificar (compra ou CMV): R$ ${fmt(R(custoAClassificar))}, descontados como custo até serem classificados` });
  if (dasEstimado) provisorio.push({ tipo: "das", texto: `DAS estimado (R$ ${fmt(R(dasEstimado))}): a guia do mês ainda não foi lançada` });
  if (dasSemEstimativa) provisorio.push({ tipo: "das", texto: "DAS do mês não lançado e sem estimativa: informe o RBT12 em Ajustes › Financeiro" });
  if (cartaoSemTaxa) provisorio.push({ tipo: "taxas", texto: `Taxas de cartão não configuradas: R$ ${fmt(R(cartaoSemTaxa))} em vendas no cartão sem taxa descontada (Ajustes › Financeiro)` });

  const avisos = [];
  if (receitaBruta > 0 && lucroBruto / receitaBruta > 0.7) avisos.push(`Margem bruta de ${(lucroBruto / receitaBruta * 100).toFixed(1).replace(".", ",")}% fora do normal: verifique o CMV.`);
  if (aClassificarDespesa) avisos.push(`R$ ${fmt(R(aClassificarDespesa))} em despesas gerais ainda sem conta definida (já descontadas do resultado).`);
  if (cmvEstimado) avisos.push(`CMV estimado em R$ ${fmt(R(cmvEstimado))} para vendas sem custo gravado.`);
  if (vendasSemCusto && custoDoMesJaLancado) avisos.push(`R$ ${fmt(R(vendasSemCusto))} em vendas sem custo gravado: o CMV estimado não foi aplicado porque o mês já tem ${custoAClassificar ? "custos a classificar" : "CMV classificado"} (para não contar o custo em dobro).`);

  return {
    mes,
    linhas,
    valores: Object.fromEntries(linhas.map((l) => [l.id, l.valor])),
    avisos,
    provisorio,
    estimativasContabeis: estimar,
    info: {
      retiradas: R(retiradas),
      lucroRetido: R(lucroLiquido - retiradas),
      aportes: R(aportes),
      compras: R(compras),
      custoAClassificar: R(custoAClassificar),
      // Frete cobrado do cliente (já dentro da receita bruta): o das vendas + o lançado na conta "Frete cobrado"
      freteCobrado: R(doMes.filter(ehVenda).reduce((s, l) => s + centavos(l.frete || 0), 0) + porConta("frete_cobrado")),
      margemReferencia: ref,
      custosFixos: R(pessoal + fixas + operacionais + aClassificarDespesa),
      // Quanto do custo das vendas é confiável: calculado pelos itens × estimado (e o resto)
      cmvOrigem: (() => {
        const total = cmvCalculadora + cmvInformado + cmvClassificado + cmvEstimado + custoAClassificar;
        const parte = (v) => ({ valor: R(v), pct: total ? v / total : 0 });
        return { total: R(total), itens: parte(cmvCalculadora), informado: parte(cmvInformado), classificado: parte(cmvClassificado), estimado: parte(cmvEstimado), aClassificar: parte(custoAClassificar) };
      })(),
      margemContribuicao: R(margemContribuicao),
      pontoEquilibrio: margemContribuicao > 0 && receitaBruta > 0
        ? R((pessoal + fixas + operacionais + aClassificarDespesa) / (margemContribuicao / receitaBruta))
        : null,
    },
  };
}

const fmt = (v) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * "Quanto preciso vender por mês para empatar": custos fixos médios ÷ margem de contribuição (em % da receita),
 * nos últimos `n` meses completos antes de `mesAtual` que tiveram venda.
 */
export function pontoEquilibrioMedio(lancamentos, configSalva, mesAtual, n = 3) {
  const cfg = mesclarConfigFinanceiro(configSalva);
  const lista = normalizar(lancamentos, cfg);
  const meses = mesesAnteriores(mesAtual, n).reverse()
    .map((mes) => ({ mes, d: montarDRE(lista, cfg, mes, { jaNormalizado: true }) }))
    .filter(({ d }) => d.valores.receitaBruta > 0);
  if (!meses.length) return null;
  const somar = (f) => meses.reduce((s, x) => s + centavos(f(x.d)), 0);
  const receita = somar((d) => d.valores.receitaBruta);
  const margem = somar((d) => d.info.margemContribuicao);
  const fixos = somar((d) => d.info.custosFixos);
  const pct = margem / receita;
  return {
    meses: meses.map((x) => x.mes),
    vendasMedia: reais(receita / meses.length),
    custosFixosMedia: reais(fixos / meses.length),
    margemContribuicaoPct: pct,
    pontoEquilibrio: pct > 0 ? reais(fixos / meses.length / pct) : null,
  };
}

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
    total += centavos(d.info.compras) + centavos(d.valores.cmvCalculadora) + centavos(d.valores.cmvInformado) + centavos(d.valores.cmvClassificado) + centavos(d.valores.cmvEstimado);
    if (++m > 12) { m = 1; a++; }
  }
  return reais(total);
}
