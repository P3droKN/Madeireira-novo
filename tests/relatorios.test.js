import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resumoDoMes, vendasPorForma } from "../lib/relatorios.js";
import { normalizar } from "../lib/financeiro.js";
import { converterLancamento, lancamentosDeAbertura } from "../lib/migracaoV2.js";
import { mesclarConfigFinanceiro } from "../lib/planoContas.js";

const seed = JSON.parse(readFileSync(new URL("./e2e/seed2a.json", import.meta.url), "utf8"));
const cfg = mesclarConfigFinanceiro({});

// Cópia do cálculo da tela antiga do Gestor de Caixa (renderFinance), para provar que o resumo não mudou
function telaAntiga(itens, acumulado, filterDate) {
  const filterMonth = filterDate.substring(0, 7);
  const sys = { venda: 0, pix: 0, cred: 0, deb: 0, custo: 0, func: 0, desp: 0 };
  const past = { ...sys };
  for (const item of itens.filter((i) => !i.abertura && i.conta !== "transferencia" && i.date.startsWith(filterMonth) && i.date <= filterDate)) {
    const isIncome = item.type === "income";
    const cat = item.category || (isIncome ? "venda" : "despesa");
    const a = item.date === filterDate ? sys : past;
    if (cat === "venda") {
      a.venda += item.value;
      if (item.method === "pix" || item.method === "bradesco") a.pix += item.value;
      if (item.method === "credito") a.cred += item.value;
      if (item.method === "debito") a.deb += item.value;
    } else if (cat === "custo") a.custo += item.value;
    else if (cat === "funcionario") a.func += item.value;
    else if (cat === "despesa") a.desp += item.value;
  }
  const ago = filterMonth === "2026-08";
  const acc = {
    venda: past.venda + (ago ? acumulado.venda : 0), pix: past.pix + (ago ? acumulado.pix : 0), cred: past.cred + (ago ? acumulado.credito : 0),
    deb: past.deb + (ago ? acumulado.debito : 0), custo: past.custo + (ago ? acumulado.custo : 0), func: past.func + (ago ? acumulado.func : 0), desp: past.desp + (ago ? acumulado.despesa : 0),
  };
  const tot = Object.fromEntries(Object.keys(sys).map((k) => [k, sys[k] + acc[k]]));
  return { sys, acc, tot, res: tot.venda - tot.custo - tot.desp };
}

const r2 = (v) => Math.round(v * 100) / 100;
function comparar(novo, antigo) {
  const mapa = { vendas: "venda", pix: "pix", cred: "cred", deb: "deb", custos: "custo", funcionarios: "func", despesas: "desp" };
  for (const [n, a] of Object.entries(mapa)) {
    assert.equal(novo.doDia[n], r2(antigo.sys[a]), `dia ${n}`);
    assert.equal(novo.acumulado[n], r2(antigo.acc[a]), `acumulado ${n}`);
    assert.equal(novo.total[n], r2(antigo.tot[a]), `total ${n}`);
  }
  assert.equal(novo.total.resultado, r2(antigo.res));
}

test("resumo do mês: mesmos números da tela antiga (antes e depois da migração v2)", () => {
  const antigos = seed.financeItems;
  const migrados = [...antigos.map((l) => converterLancamento(l, cfg.formas)), ...lancamentosDeAbertura(seed.acumulado)];
  const dias = [...new Set(antigos.map((l) => l.date))];
  for (const dia of [...dias, "2026-08-31", "2026-09-15", "2026-08-01"]) {
    comparar(resumoDoMes(antigos, seed.acumulado, dia), telaAntiga(antigos, seed.acumulado, dia));
    comparar(resumoDoMes(migrados, seed.acumulado, dia), telaAntiga(antigos, seed.acumulado, dia));
  }
});

test("resumo do mês: venda nova (v2) entra pelas formas de pagamento; transferência e excluído ficam de fora", () => {
  const itens = [
    { id: "1V", v: 2, conta: "venda_produtos", category: "venda", type: "income", value: 300, date: "2026-10-05", competencia: "2026-10-05",
      pagamentos: [{ forma: "pix_picpay", valor: 100 }, { forma: "credito_parcelado", valor: 150, parcelas: 3 }, { forma: "dinheiro", valor: 50 }] },
    { id: "2T", v: 2, conta: "transferencia", value: 999, date: "2026-10-05", competencia: "2026-10-05" },
    { id: "3S", v: 2, conta: "energia", category: "despesa", type: "expense", value: 80, date: "2026-10-04", competencia: "2026-10-04", excluido: true },
    { id: "4S", v: 2, conta: "salarios", category: "funcionario", type: "expense", value: 1000, date: "2026-10-04", competencia: "2026-10-04" },
  ];
  const r = resumoDoMes(itens, null, "2026-10-05");
  assert.deepEqual({ v: r.doDia.vendas, pix: r.doDia.pix, cred: r.doDia.cred, deb: r.doDia.deb }, { v: 300, pix: 100, cred: 150, deb: 0 });
  assert.equal(r.acumulado.funcionarios, 1000);
  assert.equal(r.total.despesas, 0);
  assert.equal(r.total.resultado, 300); // como era: vendas − custos − despesas
});

test("vendas por forma de pagamento: soma por forma, com tPag e %", () => {
  const itens = [
    { id: "1V", v: 2, conta: "venda_produtos", value: 300, competencia: "2026-10-05", pagamentos: [{ forma: "pix_bradesco", valor: 100 }, { forma: "dinheiro", valor: 200 }] },
    { id: "2V", v: 2, conta: "venda_produtos", value: 100, competencia: "2026-10-06", pagamentos: [{ forma: "dinheiro", valor: 100 }] },
    { id: "3V", v: 2, conta: "venda_produtos", value: 50, competencia: "2026-09-30", pagamentos: [{ forma: "dinheiro", valor: 50 }] },
    { id: "4S", v: 2, conta: "energia", value: 80, competencia: "2026-10-04" },
  ];
  const r = vendasPorForma(normalizar(itens, cfg), "2026-10", cfg);
  assert.equal(r.total, 400);
  assert.equal(r.vendas, 2);
  assert.deepEqual(r.linhas.map((l) => [l.forma, l.valor, l.quantidade, l.tPag]), [["dinheiro", 300, 2, "01"], ["pix_bradesco", 100, 1, "20"]]);
  assert.equal(r.linhas[0].pct, 0.75);
});
