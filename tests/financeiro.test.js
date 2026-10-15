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

test("DAS: estimativa desligada por padrão; valor real lançado sempre vale", () => {
  const sem = montarDRE([venda(50000, { cmv: 30000, origem: "calculadora" })], {}, "2026-09");
  assert.equal(sem.valores.dasEstimado, undefined);
  const ligada = montarDRE([venda(50000, { cmv: 30000 })], { impostos: { estimarSimples: true, rbt12: 600000 } }, "2026-09");
  assert.equal(ligada.valores.dasEstimado, -3595);
  const real = montarDRE([venda(50000, { cmv: 30000 }), saida("das", 3200)], { impostos: { estimarSimples: true, rbt12: 600000 } }, "2026-09");
  assert.equal(real.valores.dasEstimado, undefined);
  assert.equal(real.valores.dasReal, -3200);
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
  assert.ok(d.avisos.some((a) => a.includes("não classificados")));
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
