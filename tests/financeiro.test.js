import { test } from "node:test";
import assert from "node:assert/strict";
import { aliquotaEfetivaSimples, montarDRE, montarDREAnual, margemReferencia, normalizar, estoqueEstimado } from "../lib/financeiro.js";
import { converterLancamento, lancamentosDeAbertura, sugestaoCusto, categoriaLegada } from "../lib/migracaoV2.js";
import { CONFIG_FINANCEIRO_PADRAO, mesclarConfigFinanceiro, CONTAS, contaPorId } from "../lib/planoContas.js";

const perto = (a, b, tol = 0.0001) => assert.ok(Math.abs(a - b) < tol, `${a} ≠ ${b}`);
const formas = CONFIG_FINANCEIRO_PADRAO.formas;
let n = 0;
const venda = (valor, extra = {}) => ({ id: `v${n++}`, v: 2, conta: "venda_produtos", value: valor, date: "2026-09-10", competencia: "2026-09-10", pagamentos: [{ forma: "pix_bradesco", conta: "bradesco", valor, tPag: "20" }], ...extra });
const saida = (conta, valor, extra = {}) => ({ id: `s${n++}`, v: 2, conta, value: valor, date: "2026-09-10", competencia: "2026-09-10", pagoCom: "bradesco", ...extra });

test("Simples: RBT12 600.000 → alíquota efetiva 7,19%; DAS de 50.000 ≈ 3.595", () => {
  const aliq = aliquotaEfetivaSimples(600000, CONFIG_FINANCEIRO_PADRAO.impostos.tabelaSimples);
  perto(aliq, 0.0719);
  assert.equal(Math.round(50000 * aliq), 3595);
});

test("DAS: sem guia no mês, estimado pelo Simples (RBT12 de Ajustes); a guia lançada substitui a estimativa", () => {
  const cfg = { impostos: { rbt12: 600000 } };
  const est = montarDRE([venda(50000, { cmv: 30000 })], cfg, "2026-09");
  assert.equal(est.valores.dasEstimado, -3595);
  assert.ok(est.linhas.find((l) => l.id === "dasEstimado").estimado);
  assert.ok(est.provisorio.some((p) => p.tipo === "das" && p.texto.includes("DAS estimado")));
  const guia = montarDRE([venda(50000, { cmv: 30000 }), saida("das", 3200)], cfg, "2026-09");
  assert.equal(guia.valores.dasEstimado, undefined);
  assert.equal(guia.valores.dasReal, -3200);
  assert.ok(!guia.provisorio.some((p) => p.tipo === "das"));
  assert.equal(guia.valores.lucroLiquido - est.valores.lucroLiquido, 3595 - 3200);
  // Sem RBT12: não dá para estimar, vira pendência
  const semRbt = montarDRE([venda(50000, { cmv: 30000 })], {}, "2026-09");
  assert.equal(semRbt.valores.dasEstimado, undefined);
  assert.ok(semRbt.provisorio.some((p) => p.texto.includes("informe o RBT12")));
  // Mês sem receita: sem DAS e sem pendência
  assert.ok(!montarDRE([saida("aluguel", 100)], cfg, "2026-09").provisorio.length);
});

test("DRE completo de um mês: cada linha e o lucro líquido", () => {
  const l = [
    venda(10000, { cmv: 6000, origem: "calculadora" }),
    saida("das", 500),
    saida("salarios", 2000),
    saida("aluguel", 1000),
    saida("combustivel", 300),
    saida("tarifas", 50),
    saida("rendimentos", 20),
    saida("retirada", 700),
    saida("compra_material", 4000),
  ];
  const d = montarDRE(l, {}, "2026-09");
  const v = d.valores;
  assert.equal(v.receitaBruta, 10000);
  assert.equal(v.receitaLiquida, 9500);
  assert.equal(v.lucroBruto, 3500);
  assert.equal(v.fgts, -160); // 8% estimado
  assert.equal(v.provisao, -388.8); // 19,44% de 2.000
  assert.equal(v.ebitda, -348.8);
  assert.equal(v.financeiro, -30);
  assert.equal(v.lucroLiquido, -378.8);
  assert.equal(d.info.retiradas, 700); // abaixo da linha, não é despesa
  assert.equal(d.info.compras, 4000); // compra vira estoque, não entra no DRE
  assert.equal(d.info.lucroRetido, -1078.8);
});

test("provisão de 13º e férias: 19,44% dos salários; 13º pago não entra no DRE com provisão ligada", () => {
  const l = [saida("salarios", 10000), saida("decimo_ferias_pagos", 5000), saida("fgts", 800)];
  const ligada = montarDRE(l, {}, "2026-09");
  assert.equal(ligada.valores.provisao, -1944);
  assert.equal(ligada.valores.decimoPago, undefined);
  assert.equal(ligada.valores.fgts, -800); // real lançado, sem estimar
  const desligada = montarDRE(l, { pessoal: { provisao13FeriasLigada: false } }, "2026-09");
  assert.equal(desligada.valores.provisao, undefined);
  assert.equal(desligada.valores.decimoPago, -5000);
});

test("CMV estimado: venda sem itens usa margem padrão de 30% e fica marcado", () => {
  const d = montarDRE([venda(1000)], {}, "2026-09");
  assert.equal(d.valores.cmvEstimado, -700);
  assert.equal(d.linhas.find((x) => x.id === "cmvEstimado").estimado, true);
  assert.equal(d.info.margemReferencia.fonte, "padrao");
});

test("CMV estimado passa a usar a média real quando há 3 meses de vendas da calculadora", () => {
  const meses = ["2026-06", "2026-07", "2026-08"].map((m) => venda(1000, { cmv: 600, origem: "calculadora", competencia: `${m}-10`, date: `${m}-10` }));
  const ref = margemReferencia(normalizar(meses, {}), "2026-09", mesclarConfigFinanceiro({}));
  assert.equal(ref.fonte, "media");
  perto(ref.margem, 0.4);
  const d = montarDRE([...meses, venda(1000)], {}, "2026-09");
  assert.equal(d.valores.cmvEstimado, -600);
  const doisMeses = montarDRE([...meses.slice(1), venda(1000)], {}, "2026-09");
  assert.equal(doisMeses.valores.cmvEstimado, -700);
});

test("vendas antigas (migradas) não ganham CMV estimado: o custo vem dos custos classificados", () => {
  const antiga = { id: "1V", category: "venda", type: "income", value: 1000, date: "2026-09-02", method: "pix" };
  const custo = { id: "1C", category: "custo", type: "expense", value: 650, date: "2026-09-02", method: "cheque", description: "Custo Extraído: CAMBARÁ" };
  const d = montarDRE([antiga, custo], {}, "2026-09");
  assert.equal(d.valores.cmvEstimado, 0);
  assert.equal(d.info.custoAClassificar, 650);
  assert.equal(d.valores.custoAClassificar, -650);
  assert.equal(d.valores.lucroBruto, 350);
  assert.ok(d.provisorio.some((p) => p.tipo === "custos" && p.texto.includes("1 custo(s) a classificar")));
  const classificado = montarDRE([antiga, { ...converterLancamento(custo, formas), conta: "cmv", classificar: false }], {}, "2026-09");
  assert.equal(classificado.valores.cmvClassificado, -650);
  assert.equal(classificado.valores.lucroBruto, 350);
});

test("taxa de cartão automática pela config (débito, crédito, parcelado por nº de parcelas)", () => {
  const v = venda(1000, { cmv: 500, pagamentos: [
    { forma: "debito", valor: 200 }, { forma: "credito", valor: 300 }, { forma: "credito_parcelado", valor: 500, parcelas: 3 },
  ] });
  const cfg = { cartao: { debito: { taxaPct: 1 }, credito: { taxaPct: 3 }, parcelado: { taxaPctPorParcelas: { 3: 5 } } } };
  assert.equal(montarDRE([v], cfg, "2026-09").valores.taxaCartao, -(2 + 9 + 25));
  assert.equal(montarDRE([v], {}, "2026-09").valores.taxaCartao, 0);
});

test("depreciação opcional: máquina de 60 mil em 120 meses = 500/mês", () => {
  const maq = saida("investimento", 60000, { vidaUtilMeses: 120, competencia: "2026-08-05", date: "2026-08-05" });
  assert.equal(montarDRE([maq], {}, "2026-09").valores.depreciacao, undefined);
  const lig = montarDRE([maq], { depreciacaoLigada: true }, "2026-09");
  assert.equal(lig.valores.depreciacao, -500);
  assert.equal(lig.valores.lucroLiquido, -500);
});

test("DRE anual: total é a soma dos meses", () => {
  const l = [venda(1000, { cmv: 600 }), venda(500, { cmv: 300, competencia: "2026-10-01", date: "2026-10-01" })];
  const a = montarDREAnual(l, {}, 2026);
  assert.equal(a.total.receitaBruta, 1500);
  assert.equal(a.meses[8].valores.receitaBruta, 1000);
  assert.equal(a.meses[9].valores.receitaBruta, 500);
});

test("estoque estimado em R$ = inicial + compras − CMV", () => {
  const l = [saida("compra_material", 5000), venda(3000, { cmv: 1800 }), venda(1000)];
  assert.equal(estoqueEstimado(l, { estoque: { inicial: 2000 } }, "2026-09"), 2000 + 5000 - 1800 - 700);
});

test("migração: formas e contas dos lançamentos antigos", () => {
  const ids = new Set(["9V"]);
  const pix = converterLancamento({ id: "1", category: "venda", type: "income", value: 100, date: "2026-09-01", method: "pix" }, formas, ids);
  assert.deepEqual(pix.pagamentos, [{ forma: "pix_bradesco", conta: "bradesco", valor: 100, tPag: "20" }]);
  assert.equal(pix.migrado, true);
  assert.equal(pix.method, "pix"); // campos antigos ficam
  const ted = converterLancamento({ id: "2", category: "venda", value: 50, date: "2026-09-01", method: "bradesco" }, formas, ids);
  assert.equal(ted.pagamentos[0].forma, "transferencia");
  assert.equal(ted.pagamentos[0].tPag, "18");
  const ch = converterLancamento({ id: "3", category: "venda", value: 80, date: "2026-09-01", method: "cheque", checkNumber: "12", checkIssuer: "João", checkDate: "2026-09-30" }, formas, ids);
  assert.equal(ch.pagamentos[0].conta, "cheques_carteira");
  assert.equal(ch.pagamentos[0].cheque.compensacao, "2026-09-30");
  const custo = converterLancamento({ id: "9C", category: "custo", value: 70, date: "2026-09-01", method: "cheque", checkNumber: "77", checkDate: "2026-10-05" }, formas, ids);
  assert.equal(custo.conta, "classificar_custo");
  assert.equal(custo.classificar, true);
  assert.equal(custo.pagoCom, "cheque_emitido");
  assert.deepEqual(custo.chequeEmitido, { numero: "77", favorecido: "", compensacao: "2026-10-05", conta: "bradesco" });
  assert.equal(custo.sugestao.conta, "cmv");
  assert.equal(custo.sugestao.vendaId, "9V");
  const func = converterLancamento({ id: "4", category: "funcionario", value: 1500, date: "2026-09-05", method: "dinheiro" }, formas, ids);
  assert.equal(func.conta, "salarios");
  assert.equal(func.pagoCom, "gaveta");
  const desp = converterLancamento({ id: "5", category: "despesa", value: 99, date: "2026-09-05", method: "bradesco" }, formas, ids);
  assert.equal(desp.conta, "classificar_despesa");
  assert.equal(converterLancamento(pix, formas, ids), pix); // idempotente
});

test("sugestão de custo pela descrição", () => {
  assert.equal(sugestaoCusto({ id: "x", description: "Custo Extraído (Apenas Material): PINUS" }, new Set()).conta, "compra_material");
  assert.equal(sugestaoCusto({ id: "x", description: "Custo Extraído: PINUS" }, new Set()).conta, "cmv");
  assert.equal(sugestaoCusto({ id: "x", description: "Compra de cedro" }, new Set()), null);
});

test("abertura de agosto: valores exatos do acumulado, sem gaveta e fora do caixa", () => {
  const acc = { venda: 48866, pix: 12440, credito: 16565, debito: 5757.5, custo: 23422.5, despesa: 28910.55, func: 16160.28, dinheiroCaixa: 2871.65 };
  const ab = lancamentosDeAbertura(acc);
  const soma = (f) => Math.round(ab.filter(f).reduce((s, l) => s + l.value * 100, 0)) / 100;
  assert.equal(soma((l) => l.conta === "venda_produtos"), 48866);
  assert.equal(ab.find((l) => l.id === "abertura-venda-outras").value, 14103.5);
  assert.equal(soma((l) => l.conta === "classificar_custo"), 23422.5);
  assert.equal(soma((l) => l.conta === "classificar_despesa"), 28910.55);
  assert.equal(soma((l) => l.conta === "salarios"), 16160.28);
  assert.ok(ab.every((l) => l.abertura && l.competencia === "2026-08-23"));
  assert.equal(ab.length, 7);
  const d = montarDRE(ab, {}, "2026-08");
  assert.equal(d.valores.receitaBruta, 48866);
});

test("plano de contas: todas as contas têm grupo válido; categoria antiga equivalente", () => {
  for (const c of CONTAS) assert.ok(c.grupo, c.id);
  assert.equal(contaPorId.das.nome, "Impostos (DAS)");
  assert.equal(categoriaLegada("salarios"), "funcionario");
  assert.equal(categoriaLegada("compra_material"), "custo");
  assert.equal(categoriaLegada("energia"), "despesa");
  assert.equal(categoriaLegada("venda_produtos"), "venda");
});

test("frete cobrado na venda: fica na receita, fora da base do CMV estimado", () => {
  const cfg = { cmv: { margemPadraoPct: 30 } };
  const sem = montarDRE([venda(1000)], cfg, "2026-09");
  const com = montarDRE([venda(1100, { frete: 100 })], cfg, "2026-09");
  assert.equal(com.valores.receitaBruta, 1100);
  assert.equal(com.valores.cmvEstimado, sem.valores.cmvEstimado, "CMV estimado só sobre os R$ 1.000 de produtos");
  assert.equal(com.info.freteCobrado, 100);
  assert.equal(sem.info.freteCobrado, 0);
});

// Setembro como veio do sistema antigo: vendas, custos (a classificar), despesas e funcionários
const setembroAntigo = () => [
  { id: "a1", category: "venda", type: "income", value: 60000, date: "2026-09-05", method: "pix" },
  { id: "a2", category: "venda", type: "income", value: 10000, date: "2026-09-06", method: "debito" },
  { id: "a3", category: "custo", type: "expense", value: 30000, date: "2026-09-05", method: "bradesco", description: "Custo Extraído: PINUS" },
  { id: "a4", category: "custo", type: "expense", value: 5000, date: "2026-09-12", method: "bradesco", description: "NF madeira" },
  { id: "a5", category: "despesa", type: "expense", value: 12000, date: "2026-09-10", method: "bradesco" },
  { id: "a6", category: "funcionario", type: "expense", value: 10000, date: "2026-09-30", method: "bradesco" },
];

test("setembro migrado: custos a classificar descontados uma vez só, sem CMV estimado em dobro", () => {
  const d = montarDRE(setembroAntigo(), {}, "2026-09");
  assert.equal(d.valores.receitaBruta, 70000);
  assert.equal(d.valores.custoAClassificar, -35000);
  assert.equal(d.valores.cmvEstimado, 0); // o mês tem custo a classificar: a estimativa contaria em dobro
  assert.equal(d.valores.lucroBruto, 35000);
  assert.ok(d.avisos.some((a) => a.includes("não foi aplicado")));
  // Coerente com o sistema antigo: vendas − custos − despesas − funcionários = 13.000;
  // o DRE desconta ainda FGTS (8%) e provisão (19,44%) dos salários CLT
  assert.equal(d.valores.lucroLiquido, 70000 - 35000 - 12000 - 10000 - 800 - 1944);
  // margem bruta de 50%: sem aviso de margem fora do normal
  assert.ok(!d.avisos.some((a) => a.includes("fora do normal")));
});

test("custos classificados: CMV fica no lugar; tudo como compra (estoque) libera o CMV estimado", () => {
  const conv = (l, conta) => ({ ...converterLancamento(l, formas), conta, classificar: false });
  const base = setembroAntigo();
  const comoCmv = montarDRE([...base.filter((l) => l.category !== "custo"), conv(base[2], "cmv"), conv(base[3], "compra_material")], {}, "2026-09");
  assert.equal(comoCmv.valores.custoAClassificar, undefined);
  assert.equal(comoCmv.valores.cmvClassificado, -30000);
  assert.equal(comoCmv.valores.cmvEstimado, 0);
  assert.equal(comoCmv.info.compras, 5000);
  const tudoCompra = montarDRE([...base.filter((l) => l.category !== "custo"), conv(base[2], "compra_material"), conv(base[3], "compra_material")], {}, "2026-09");
  assert.equal(tudoCompra.valores.cmvEstimado, -49000); // 70% de 70.000 (margem padrão 30%)
  assert.equal(tudoCompra.provisorio.filter((p) => p.tipo === "custos").length, 0);
});

test("FGTS e provisão só sobre salários CLT; pró-labore e não CLT não geram", () => {
  const l = [
    venda(50000, { cmv: 30000 }),
    saida("salarios", 3000, { vinculo: "clt" }),
    saida("salarios", 2000), // sem campo: CLT (padrão e dados antigos)
    saida("salarios", 1500, { vinculo: "nao_clt" }),
    saida("salarios", 5000, { vinculo: "pro_labore" }),
  ];
  const d = montarDRE(l, {}, "2026-09");
  assert.equal(d.valores.salarios, -11500);
  assert.equal(d.valores.fgts, -400); // 8% de 5.000
  assert.equal(d.valores.provisao, -972); // 19,44% de 5.000
  const soDono = montarDRE([venda(50000, { cmv: 30000 }), saida("salarios", 5000, { vinculo: "pro_labore" })], {}, "2026-09");
  assert.equal(soDono.valores.fgts, 0);
  assert.equal(soDono.valores.provisao, undefined);
});

test("avisos: taxas de cartão não configuradas, margem bruta acima de 70% e resultado provisório", () => {
  const cartao = venda(1000, { cmv: 100, pagamentos: [{ forma: "debito", valor: 600 }, { forma: "pix_bradesco", valor: 400 }] });
  const d = montarDRE([cartao], {}, "2026-09");
  assert.ok(d.provisorio.some((p) => p.tipo === "taxas" && p.texto.includes("R$ 600,00")));
  assert.ok(d.avisos.some((a) => a.includes("Margem bruta de 90,0% fora do normal")));
  const configurada = montarDRE([cartao], { cartao: { debito: { taxaPct: 1.5 } } }, "2026-09");
  assert.ok(!configurada.provisorio.some((p) => p.tipo === "taxas"));
  assert.equal(configurada.valores.taxaCartao, -9);
  const normal = montarDRE([venda(1000, { cmv: 650 })], {}, "2026-09");
  assert.ok(!normal.avisos.some((a) => a.includes("fora do normal")));
});

test("guia de DAS/FGTS aceita pela sugestão: substitui a estimativa do mês da guia, sem somar", () => {
  const cfg = { impostos: { rbt12: 600000 } };
  const l = [
    venda(50000, { cmv: 30000, competencia: "2026-08-10", date: "2026-08-10" }),
    saida("salarios", 3000, { competencia: "2026-08-30", date: "2026-08-30" }),
    saida("das", 3500, { competencia: "2026-08-31", dataPagamento: "2026-09-20" }),
    saida("fgts", 240, { competencia: "2026-08-31", dataPagamento: "2026-09-07" }),
  ];
  const ago = montarDRE(l, cfg, "2026-08");
  assert.equal(ago.valores.dasReal, -3500);
  assert.equal(ago.valores.dasEstimado, undefined);
  assert.equal(ago.valores.fgts, -240); // a guia, não 8% estimado
  assert.ok(!ago.linhas.find((x) => x.id === "fgts").estimado);
});

test("mês em andamento: ateDia compara só o mesmo pedaço do mês", () => {
  const l = [venda(1000, { cmv: 600, competencia: "2026-09-05" }), venda(5000, { cmv: 3000, competencia: "2026-09-25" })];
  assert.equal(montarDRE(l, {}, "2026-09").valores.receitaBruta, 6000);
  assert.equal(montarDRE(l, {}, "2026-09", { ateDia: 21 }).valores.receitaBruta, 1000);
  assert.equal(montarDRE(l, {}, "2026-09", { ateDia: 31 }).valores.receitaBruta, 6000);
});

test("quanto vender para empatar: custos fixos médios ÷ margem de contribuição dos últimos 3 meses com venda", async () => {
  const { pontoEquilibrioMedio } = await import("../lib/financeiro.js");
  const mes = (m, receita, cmv, aluguel) => [
    venda(receita, { cmv, competencia: `2026-${m}-10`, date: `2026-${m}-10` }),
    saida("aluguel", aluguel, { competencia: `2026-${m}-05`, date: `2026-${m}-05` }),
  ];
  const l = [...mes("07", 20000, 12000, 4000), ...mes("08", 30000, 18000, 4000), ...mes("09", 10000, 6000, 4000), ...mes("10", 99999, 0, 0)];
  const pe = pontoEquilibrioMedio(l, {}, "2026-10");
  assert.deepEqual(pe.meses, ["2026-07", "2026-08", "2026-09"]); // outubro (em andamento) fica fora
  assert.equal(pe.vendasMedia, 20000);
  assert.equal(pe.custosFixosMedia, 4000);
  perto(pe.margemContribuicaoPct, 0.4);
  assert.equal(pe.pontoEquilibrio, 10000);
  // meses sem venda não entram na média; margem negativa = sem ponto de equilíbrio
  assert.deepEqual(pontoEquilibrioMedio(mes("09", 10000, 6000, 4000), {}, "2026-10").meses, ["2026-09"]);
  assert.equal(pontoEquilibrioMedio(mes("09", 10000, 12000, 4000), {}, "2026-10").pontoEquilibrio, null);
  assert.equal(pontoEquilibrioMedio([], {}, "2026-10"), null);
});
