import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { montarCatalogo, chavePrecoValida, rotular } from "../lib/catalogo.js";
import { calcularItem, totalizarPedido, distribuirTotal, arred } from "../lib/calculo.js";

const custos = JSON.parse(readFileSync(new URL("../data/custos.json", import.meta.url), "utf8"));
const cat = montarCatalogo(custos);
const item = (id) => cat.itens.get(id);
const perto = (a, b) => assert.ok(Math.abs(a - b) < 0.0005, `${a} ≠ ${b}`);

test("exemplo 1: Cambará 1x2, 6 peças × 3 m = R$ 61,92", () => {
  const r = calcularItem({ item: item("CAMBARA|1x2"), quantidade: 6, comprimento: 3 });
  assert.equal(r.quantidadeCobrada, 18);
  assert.equal(r.custoTotal, 61.92);
  assert.deepEqual(r.pendencias, ["sem_preco"]);
});

test("exemplo 2: Pinus 2x4x3,00, 10 peças = R$ 183,60", () => {
  const r = calcularItem({ item: item("PINUS|2x4x3.00"), quantidade: 10 });
  assert.equal(r.custoTotal, 183.6);
  assert.equal(r.unidadeCobranca, "peça");
});

test("exemplo 3: venda de R$ 90,00 no cambará acima → margem 31,2%", () => {
  const r = calcularItem({ item: item("CAMBARA|1x2"), quantidade: 6, comprimento: 3, totalManual: 90 });
  assert.equal(r.vendaTotal, 90);
  assert.equal(r.lucro, 28.08);
  perto(r.margem, 0.312);
  assert.equal(r.ajustado, false); // sem preço de tabela não há variação
});

test("cedro mesclado e vermelho usam o mesmo custo, com itens (e preços) separados", () => {
  assert.equal(item("CEDRO_MESCLADO|1x2").custo, 3.62);
  assert.equal(item("CEDRO_VERMELHO|1x2").custo, 3.62);
  assert.notEqual(item("CEDRO_MESCLADO|1x2").id, item("CEDRO_VERMELHO|1x2").id);
});

test("eucalipto roliço é por peça (não multiplica por comprimento)", () => {
  const r = calcularItem({ item: item("EUCALIPTO_ROLICO|11a13x2.50"), quantidade: 3, comprimento: 2.5 });
  assert.equal(r.custoTotal, 104.7);
});

test("vistas: jogo e meio jogo; caixilho por jogo completo", () => {
  assert.equal(calcularItem({ item: item("VISTAS_TAUARI|meio_jogo:6.5cm"), quantidade: 1 }).custoTotal, 22.75);
  assert.equal(calcularItem({ item: item("VISTAS_TAUARI|jogo:6.5cm"), quantidade: 2 }).custoTotal, 91);
  assert.equal(calcularItem({ item: item("CAIXILHO_TAUARI|jogo:10cm"), quantidade: 1 }).custoTotal, 131.5);
});

test("m² aceita fração; peça exige inteiro", () => {
  assert.equal(calcularItem({ item: item("FORRO|PINUS_COMPRIDO"), quantidade: 12.5 }).custoTotal, 200);
  assert.throws(() => calcularItem({ item: item("PINUS|1x2x2.50"), quantidade: 1.5 }), /inteiro/);
  assert.throws(() => calcularItem({ item: item("CAMBARA|1x2"), quantidade: 2 }), /comprimento/);
});

test("preço parte da tabela; % recalcula o preço (1.500 → +10% = 1.650; −5% = 1.425)", () => {
  const base = { item: item("PINUS|1x2x2.50"), quantidade: 1, precoTabela: 1500 };
  const t = calcularItem(base);
  assert.equal(t.vendaTotal, 1500);
  assert.equal(t.ajustado, false);
  const mais = calcularItem({ ...base, variacaoPct: 10 });
  assert.equal(mais.vendaTotal, 1650);
  perto(mais.variacaoPct, 10);
  assert.equal(mais.variacaoValor, 150);
  assert.equal(calcularItem({ ...base, variacaoPct: -5 }).vendaTotal, 1425);
});

test("preço digitado recalcula o %: 2.100 sobre 1.500 = +40%", () => {
  const r = calcularItem({ item: item("PINUS|1x2x2.50"), quantidade: 1, precoTabela: 1500, precoManual: 2100 });
  perto(r.variacaoPct, 40);
  assert.equal(r.ajustado, true);
  assert.deepEqual(r.pendencias, []); // motivo não é obrigatório
});

test("variação por metro linear: tabela 5,50/m × 18 m, +10% → 6,05/m", () => {
  const r = calcularItem({ item: item("CAMBARA|1x2"), quantidade: 6, comprimento: 3, precoTabela: 5.5, variacaoPct: 10, motivo: "Selecionada" });
  assert.equal(r.tabelaTotal, 99);
  perto(r.precoUnitario, 6.05);
  assert.equal(r.vendaTotal, 108.9);
  assert.equal(r.motivo, "Selecionada");
});

test("% exato no total mesmo quando o preço por metro tem mais de 2 casas: 5,50 × 18 m −5% = 94,05", () => {
  const r = calcularItem({ item: item("CAMBARA|1x2"), quantidade: 6, comprimento: 3, precoTabela: 5.5, variacaoPct: -5 });
  assert.equal(r.vendaTotal, 94.05);
  perto(r.variacaoPct, -5);
});

test("total do pedido: rateio proporcional, soma exata e CMV igual", () => {
  const a = calcularItem({ item: item("PINUS|1x2x2.50"), quantidade: 1, precoTabela: 1000 });
  const b = calcularItem({ item: item("PINUS|2x4x3.00"), quantidade: 1, precoTabela: 500 });
  const totais = distribuirTotal([a, b], 2100);
  assert.deepEqual(totais, [1400, 700]);
  const a2 = calcularItem({ item: a.itemId && item("PINUS|1x2x2.50"), quantidade: 1, precoTabela: 1000, totalManual: totais[0] });
  const b2 = calcularItem({ item: item("PINUS|2x4x3.00"), quantidade: 1, precoTabela: 500, totalManual: totais[1] });
  perto(a2.variacaoPct, 40);
  perto(b2.variacaoPct, 40);
  const t = totalizarPedido([a2, b2]);
  assert.equal(t.venda, 2100);
  assert.equal(t.tabela, 1500);
  assert.equal(t.variacao, 600);
  perto(t.variacaoPct, 40);
  assert.equal(t.custo, a.custoTotal + b.custoTotal);
});

test("rateio com centavos: a sobra vai para o maior item e a soma bate", () => {
  const rs = [10, 10, 10].map((v) => ({ vendaTotal: v }));
  const totais = distribuirTotal(rs, 100);
  assert.equal(arred(totais.reduce((s, v) => s + v, 0)), 100);
  const comSemPreco = distribuirTotal([{ vendaTotal: 50 }, { vendaTotal: null }], 60);
  assert.deepEqual(comSemPreco, [60, null]);
  assert.throws(() => distribuirTotal([{ vendaTotal: null }], 10), /Nenhum item/);
});

test("sem preço de tabela: vendedor digita o preço", () => {
  const r = calcularItem({ item: item("ITAUBA|2x4"), quantidade: 2, comprimento: 3, precoManual: 40 });
  assert.equal(r.vendaTotal, 240);
  assert.equal(r.custoTotal, 168);
  perto(r.margem, 0.3);
});

test("retalho: valor livre, custo 0", () => {
  const r = calcularItem({ item: item("RETALHO|LIVRE"), totalManual: 25 });
  assert.equal(r.custoTotal, 0);
  assert.equal(r.vendaTotal, 25);
  assert.equal(r.margem, 1);
});

test("assoalho emendado sem custo fica marcado, sem inventar valor", () => {
  const r = calcularItem({ item: item("ASSOALHO|CEDRO_EMENDADO_9cm"), quantidade: 10, precoManual: 80 });
  assert.equal(r.custoTotal, null);
  assert.equal(r.margem, null);
  assert.ok(r.pendencias.includes("sem_custo"));
});

test("totais do pedido: custo, venda e margem só com itens completos", () => {
  const a = calcularItem({ item: item("CAMBARA|1x2"), quantidade: 6, comprimento: 3, totalManual: 90 });
  const b = calcularItem({ item: item("PINUS|2x4x3.00"), quantidade: 10 });
  const t = totalizarPedido([a, b]);
  assert.equal(t.custo, 245.52);
  assert.equal(t.venda, 90);
  perto(t.margem, 0.312);
  assert.equal(t.semPreco, 1);
  assert.equal(t.completo, false);
});

test("catálogo: todos os grupos do custos.json, sem preço de venda nenhum", () => {
  const nomes = cat.materiais.map((m) => m.id);
  for (const id of ["CEDRO_MESCLADO", "CEDRO_VERMELHO", "CAMBARA", "ITAUBA", "JEQUITIBA", "EUCALIPTO", "PINUS",
    "EUCALIPTO_ROLICO", "MADEIRITE", "FORRO", "DECK", "ASSOALHO", "MEIA_CANA", "RODAPE", "BEIRAL_CEDRO", "BEIRAL_PINUS",
    "CAIXILHO_TAUARI", "VISTAS_TAUARI", "PREGOS", "RETALHO"]) {
    assert.ok(nomes.includes(id), id);
  }
  const contagem = cat.itens.size;
  assert.ok(contagem > 150, `itens: ${contagem}`);
  for (const it of cat.itens.values()) assert.equal(it.venda, undefined);
});

test("acabamento: madeiras com cepilhado têm bruto e cepilhado; eucalipto só bruto; outros único", () => {
  const m = (id) => cat.materiais.find((x) => x.id === id);
  assert.deepEqual(m("CAMBARA").acabamentos, ["BRUTO", "CEPILHADO"]);
  assert.deepEqual(m("PINUS").acabamentos, ["BRUTO", "CEPILHADO"]);
  assert.deepEqual(m("EUCALIPTO").acabamentos, ["BRUTO"]);
  assert.deepEqual(m("FORRO").acabamentos, ["UNICO"]);
  const ligado = montarCatalogo(custos, { temCepilhado: { EUCALIPTO: true, CAMBARA: false } });
  assert.deepEqual(ligado.materiais.find((x) => x.id === "EUCALIPTO").acabamentos, ["BRUTO", "CEPILHADO"]);
  assert.deepEqual(ligado.materiais.find((x) => x.id === "CAMBARA").acabamentos, ["BRUTO"]);
});

test("chave de preço: valida item e acabamento", () => {
  assert.equal(chavePrecoValida(cat, "CAMBARA|1x2|BRUTO"), true);
  assert.equal(chavePrecoValida(cat, "CAMBARA|1x2|CEPILHADO"), true);
  assert.equal(chavePrecoValida(cat, "CAMBARA|1x2|UNICO"), false);
  assert.equal(chavePrecoValida(cat, "FORRO|PINUS_COMPRIDO|UNICO"), true);
  assert.equal(chavePrecoValida(cat, "VISTAS_TAUARI|meio_jogo:10cm|UNICO"), true);
  assert.equal(chavePrecoValida(cat, "NAOEXISTE|1x2|BRUTO"), false);
  assert.equal(chavePrecoValida(cat, "RETALHO|LIVRE|UNICO"), false);
});

test("rótulos legíveis", () => {
  assert.equal(rotular("CEDRO_MESCLADO_CURTO"), "Cedro mesclado curto");
  assert.equal(rotular("CEDRO_1.5pol_4.0cm"), 'Cedro 1,5" 4,0 cm');
  assert.equal(rotular("ITAUBA_10cm"), "Itaúba 10 cm");
});

import { textoWhatsApp, MOTIVOS_AJUSTE } from "../lib/calculo.js";

test("WhatsApp: itens e total, sem custo nem margem", () => {
  const t = textoWhatsApp({
    data: "14/10/2026",
    itens: [
      { descricao: "Cambará 1x2 (bruto)", quantidade: "6 pç × 3,00 m = 18,00 m", precoUnitario: 5, unidade: "m", vendaTotal: 90 },
      { descricao: "Retalho - sobras", quantidade: "", precoUnitario: 25, unidade: "un", vendaTotal: 25 },
    ],
    totalItens: 115,
  });
  assert.ok(t.includes("R$ 5,00/m → *R$ 90,00*"));
  assert.ok(t.includes("*R$ 25,00*"));
  assert.ok(t.includes("*Total: R$ 115,00*"));
  assert.ok(!/custo|margem/i.test(t));
});

test("WhatsApp: desconto no total e item a combinar", () => {
  const comDesconto = textoWhatsApp({ itens: [{ descricao: "A", quantidade: "1", precoUnitario: 1200, unidade: "peça", vendaTotal: 1200 }], totalItens: 1200, valorCobrado: 1150 });
  assert.ok(comDesconto.includes("Subtotal: R$ 1.200,00"));
  assert.ok(comDesconto.includes("Desconto: R$ 50,00"));
  assert.ok(comDesconto.includes("*Total: R$ 1.150,00*"));
  const aCombinar = textoWhatsApp({ itens: [{ descricao: "B", quantidade: "2", precoUnitario: null, unidade: "peça", vendaTotal: null }], totalItens: 0 });
  assert.ok(aCombinar.includes("preço a combinar"));
  assert.ok(aCombinar.includes("+ 1 item a combinar"));
});

test("motivos rápidos e opcionais", () => {
  assert.deepEqual(MOTIVOS_AJUSTE, ["Selecionada", "Últimas peças", "Cliente antigo", "Urgência", "Outro"]); // frete virou campo próprio
});

test("WhatsApp com frete: linha própria e soma no total", () => {
  const t = textoWhatsApp({ itens: [{ descricao: "Pinus", quantidade: "10 peças", precoUnitario: 25, unidade: "peça", vendaTotal: 250 }], totalItens: 250, frete: 50 });
  assert.ok(t.includes("Itens: R$ 250,00"));
  assert.ok(t.includes("Frete/entrega: R$ 50,00"));
  assert.ok(t.includes("*Total: R$ 300,00*"));
  const sem = textoWhatsApp({ itens: [{ descricao: "Pinus", quantidade: "10 peças", precoUnitario: 25, unidade: "peça", vendaTotal: 250 }], totalItens: 250, frete: 0 });
  assert.ok(!/frete/i.test(sem) && sem.includes("*Total: R$ 250,00*"), "sem frete, nada muda");
});

test("beiral: cedro 13/19/23/29 cm e pinus 14/19 cm em ordem crescente, custo subindo com a medida; ids antigos (A, B…) viram os novos", async () => {
  const { idAtual, precosComIdsAtuais } = await import("../lib/catalogo.js");
  const m = (id) => cat.materiais.find((x) => x.id === id);
  assert.equal(m("BEIRAL_CEDRO").nome, "Beiral cedro");
  assert.deepEqual(m("BEIRAL_CEDRO").itens.map((i) => [i.rotuloDimensao, i.custo]), [["13 cm", 10.53], ["19 cm", 15], ["23 cm", 17.5], ["29 cm", 21.05]]);
  assert.deepEqual(m("BEIRAL_PINUS").itens.map((i) => [i.rotuloDimensao, i.custo]), [["14 cm", 5], ["19 cm", 7.5]]);
  assert.ok(!cat.materiais.some((x) => x.id === "BEIRAL"));
  assert.equal(idAtual("BEIRAL|CEDRO_C"), "BEIRAL_CEDRO|23cm");
  assert.equal(idAtual("PINUS|1x2x2.50"), "PINUS|1x2x2.50");
  // preço gravado com o nome antigo continua valendo; se o item novo já tem preço próprio, vale o novo
  assert.deepEqual(precosComIdsAtuais({ "BEIRAL|CEDRO_A|UNICO": 20, "BEIRAL|PINUS_B|UNICO": 12, "BEIRAL_PINUS|19cm|UNICO": 13 }),
    { "BEIRAL_CEDRO|13cm|UNICO": 20, "BEIRAL_PINUS|19cm|UNICO": 13 });
  assert.ok(!JSON.stringify(custos.duvidas).includes("BEIRAL"));
});

test("portas (internas 60/70/80 a R$ 240, 90 a R$ 270; externa 80 a R$ 1.800) com preço padrão; vistas: \"jogo completo\"", async () => {
  const { precosComPadrao } = await import("../lib/catalogo.js");
  const m = (id) => cat.materiais.find((x) => x.id === id);
  assert.deepEqual(m("PORTA_INTERNA").itens.map((i) => [i.rotuloDimensao, i.custo, i.vendaPadrao]), [["60 cm", 120, 240], ["70 cm", 120, 240], ["80 cm", 120, 240], ["90 cm", 150, 270]]);
  assert.deepEqual(m("PORTA_EXTERNA").itens.map((i) => [i.rotuloDimensao, i.custo, i.vendaPadrao]), [["80 cm", 800, 1800]]);
  const p = precosComPadrao({ "PORTA_INTERNA|60cm|UNICO": 250 }, cat);
  assert.equal(p["PORTA_INTERNA|60cm|UNICO"], 250, "preço gravado em Ajustes › Preços vale mais que o padrão");
  assert.equal(p["PORTA_EXTERNA|80cm|UNICO"], 1800);
  assert.ok(m("VISTAS_TAUARI").itens.filter((i) => i.dimensao.startsWith("jogo:")).every((i) => i.rotuloDimensao.endsWith("— jogo completo")));
  assert.ok(!m("VISTAS_TAUARI").itens.some((i) => /4 peças/.test(i.rotuloDimensao)));
});

test("Outros (fora do catálogo): valor e custo digitados; sem custo é recusado", () => {
  const item = cat.itens.get("OUTROS|LIVRE");
  assert.equal(item.pedeCusto, true);
  const r = calcularItem({ item, totalManual: 500, custoManual: 320 });
  assert.deepEqual([r.vendaTotal, r.custoTotal, r.lucro], [500, 320, 180]);
  assert.throws(() => calcularItem({ item, totalManual: 500 }), /Informe o custo/);
  assert.equal(calcularItem({ item, totalManual: 50, custoManual: 0 }).custoTotal, 0);
});
