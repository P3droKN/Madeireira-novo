import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { montarCatalogo, chavePrecoValida, rotular } from "../lib/catalogo.js";
import { calcularItem, totalizarPedido } from "../lib/calculo.js";

const custos = JSON.parse(readFileSync(new URL("../data/custos.json", import.meta.url), "utf8"));
const cat = montarCatalogo(custos);
const CONFIG = { modificadores: { selecionadaPct: 10, ultimasPecasPct: 20 } };
const item = (id) => cat.itens.get(id);
const perto = (a, b) => assert.ok(Math.abs(a - b) < 0.0005, `${a} ≠ ${b}`);

test("exemplo 1: Cambará 1x2, 6 peças × 3 m = R$ 61,92", () => {
  const r = calcularItem({ item: item("CAMBARA|1x2"), quantidade: 6, comprimento: 3 }, CONFIG);
  assert.equal(r.quantidadeCobrada, 18);
  assert.equal(r.custoTotal, 61.92);
  assert.deepEqual(r.pendencias, ["sem_preco"]);
});

test("exemplo 2: Pinus 2x4x3,00, 10 peças = R$ 183,60", () => {
  const r = calcularItem({ item: item("PINUS|2x4x3.00"), quantidade: 10 }, CONFIG);
  assert.equal(r.custoTotal, 183.6);
  assert.equal(r.unidadeCobranca, "peça");
});

test("exemplo 3: venda de R$ 90,00 no cambará acima → margem 31,2%", () => {
  const r = calcularItem({ item: item("CAMBARA|1x2"), quantidade: 6, comprimento: 3, totalManual: 90 }, CONFIG);
  assert.equal(r.vendaTotal, 90);
  assert.equal(r.lucro, 28.08);
  perto(r.margem, 0.312);
  assert.equal(r.ajusteManual, false); // sem preço de tabela não é "ajuste"
});

test("cedro mesclado e vermelho usam o mesmo custo, com itens (e preços) separados", () => {
  assert.equal(item("CEDRO_MESCLADO|1x2").custo, 3.62);
  assert.equal(item("CEDRO_VERMELHO|1x2").custo, 3.62);
  assert.notEqual(item("CEDRO_MESCLADO|1x2").id, item("CEDRO_VERMELHO|1x2").id);
});

test("eucalipto roliço é por peça (não multiplica por comprimento)", () => {
  const r = calcularItem({ item: item("EUCALIPTO_ROLICO|11a13x2.50"), quantidade: 3, comprimento: 2.5 }, CONFIG);
  assert.equal(r.custoTotal, 104.7);
});

test("vistas: jogo e meio jogo; caixilho por jogo completo", () => {
  assert.equal(calcularItem({ item: item("VISTAS_TAUARI|meio_jogo:6.5cm"), quantidade: 1 }, CONFIG).custoTotal, 22.75);
  assert.equal(calcularItem({ item: item("VISTAS_TAUARI|jogo:6.5cm"), quantidade: 2 }, CONFIG).custoTotal, 91);
  assert.equal(calcularItem({ item: item("CAIXILHO_TAUARI|jogo:10cm"), quantidade: 1 }, CONFIG).custoTotal, 131.5);
});

test("m² aceita fração; peça exige inteiro", () => {
  assert.equal(calcularItem({ item: item("FORRO|PINUS_COMPRIDO"), quantidade: 12.5 }, CONFIG).custoTotal, 200);
  assert.throws(() => calcularItem({ item: item("PINUS|1x2x2.50"), quantidade: 1.5 }, CONFIG), /inteiro/);
  assert.throws(() => calcularItem({ item: item("CAMBARA|1x2"), quantidade: 2 }, CONFIG), /comprimento/);
});

test("modificadores: selecionada +10% e últimas peças −20% sobre o preço de tabela", () => {
  const base = { item: item("CAMBARA|1x2"), quantidade: 1, comprimento: 10, precoTabela: 5 };
  assert.equal(calcularItem(base, CONFIG).vendaTotal, 50);
  assert.equal(calcularItem({ ...base, modificadores: { selecionada: true } }, CONFIG).precoUnitario, 5.5);
  assert.equal(calcularItem({ ...base, modificadores: { ultimasPecas: true } }, CONFIG).precoUnitario, 4);
  assert.equal(calcularItem({ ...base, modificadores: { selecionada: true, ultimasPecas: true } }, CONFIG).precoUnitario, 4.4);
});

test("ajuste manual: diferente do sugerido exige motivo", () => {
  const base = { item: item("CAMBARA|1x2"), quantidade: 1, comprimento: 10, precoTabela: 5 };
  const sem = calcularItem({ ...base, precoManual: 4.5 }, CONFIG);
  assert.equal(sem.ajusteManual, true);
  assert.ok(sem.pendencias.includes("ajuste_sem_motivo"));
  const com = calcularItem({ ...base, precoManual: 4.5, motivoAjuste: "cliente antigo" }, CONFIG);
  assert.deepEqual(com.pendencias, []);
  assert.equal(com.vendaTotal, 45);
  assert.equal(calcularItem({ ...base, precoManual: 5 }, CONFIG).ajusteManual, false);
});

test("sem preço de tabela: vendedor digita o preço", () => {
  const r = calcularItem({ item: item("ITAUBA|2x4"), quantidade: 2, comprimento: 3, precoManual: 40 }, CONFIG);
  assert.equal(r.vendaTotal, 240);
  assert.equal(r.custoTotal, 168);
  perto(r.margem, 0.3);
});

test("retalho: valor livre, custo 0", () => {
  const r = calcularItem({ item: item("RETALHO|LIVRE"), totalManual: 25 }, CONFIG);
  assert.equal(r.custoTotal, 0);
  assert.equal(r.vendaTotal, 25);
  assert.equal(r.margem, 1);
});

test("assoalho emendado sem custo fica marcado, sem inventar valor", () => {
  const r = calcularItem({ item: item("ASSOALHO|CEDRO_EMENDADO_9cm"), quantidade: 10, precoManual: 80 }, CONFIG);
  assert.equal(r.custoTotal, null);
  assert.equal(r.margem, null);
  assert.ok(r.pendencias.includes("sem_custo"));
});

test("totais do pedido: custo, venda e margem só com itens completos", () => {
  const a = calcularItem({ item: item("CAMBARA|1x2"), quantidade: 6, comprimento: 3, totalManual: 90 }, CONFIG);
  const b = calcularItem({ item: item("PINUS|2x4x3.00"), quantidade: 10 }, CONFIG);
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
    "EUCALIPTO_ROLICO", "MADEIRITE", "FORRO", "DECK", "ASSOALHO", "MEIA_CANA", "RODAPE", "BEIRAL",
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
