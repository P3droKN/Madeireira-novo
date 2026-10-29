import { test } from "node:test";
import assert from "node:assert/strict";
import { resumoDoDia } from "../lib/resumoDia.js";
import { montarDRE } from "../lib/financeiro.js";
import { movimentos, fluxoMensal } from "../lib/caixa.js";

let n = 0;
const venda = (data, valor, pagamentos, extra = {}) => ({ id: `v${n++}`, v: 2, conta: "venda_produtos", value: valor, competencia: data, criadoEm: `${data}T1${n % 10}:00:00Z`, numero: `V-${String(n).padStart(4, "0")}`, pagamentos, ...extra });
const pg = (forma, valor, extra = {}) => ({ forma, valor, conta: { dinheiro: "gaveta", pix_bradesco: "bradesco", debito: "picpay", credito_parcelado: "picpay", transferencia: "bradesco" }[forma] ?? null, ...extra });
const comItens = (cmv) => ({ cmv, itens: [{ descricao: "Pinus", vendaTotal: 1, custoTotal: cmv }] });
const saldos = { abertura: { data: "2026-10-01", contas: { gaveta: 300, bradesco: 1000, picpay: 0, cheques_carteira: 0 } }, conferencias: [] };
const clientes = [{ id: "C1", nome: "Zé", contaCorrente: true }];

function dia20() {
  return [
    { id: "FA1", v: 2, conta: "fiado_anterior", value: 400, competencia: "2026-10-01", clienteId: "C1", cliente: "Zé", contaCorrente: true },
    venda("2026-10-20", 200, [pg("dinheiro", 200)], comItens(100)),
    venda("2026-10-20", 300, [pg("fiado", 300, { fiado: { contaCorrente: true, vencimento: "" } })], { clienteId: "C1", cliente: "Zé", ...comItens(150) }),
    venda("2026-10-20", 600, [pg("credito_parcelado", 600, { parcelas: 3 })]),
    venda("2026-10-20", 100, [pg("debito", 100)], comItens(60)),
    { id: "R1", v: 2, conta: "recebimento", value: 250, competencia: "2026-10-20", clienteId: "C1", cliente: "Zé", pagamentos: [pg("pix_bradesco", 250)] },
    { id: "S1", v: 2, conta: "aluguel", value: 500, competencia: "2026-10-20", dataPagamento: "2026-10-20", pagoCom: "bradesco", description: "Aluguel" },
    { id: "T1", v: 2, conta: "transferencia", value: 100, competencia: "2026-10-20", de: "gaveta", para: "bradesco" },
  ];
}

test("dia com à vista, fiado, crédito, débito, recebimento de fiado, saída e transferência: quadros e totais", () => {
  const r = resumoDoDia({ lancamentos: dia20(), config: {}, saldos, de: "2026-10-20", clientes });
  assert.deepEqual(r.quadros, { vendido: 1200, pedidos: 4, ticketMedio: 300, entrou: 450, saiu: 500, saldo: -50, fiadoVendido: 300, recebidoFiado: 250, recebidoAnterior: 250 });
  // entradas por forma: o total bate com vendido + recebimentos
  assert.deepEqual(r.entradas.formas.map((f) => [f.nome, f.quantidade, f.valor]), [["Dinheiro", 1, 200], ["Débito", 1, 100], ["Crédito parcelado 3x", 1, 600], ["Fiado / a prazo", 1, 300]]);
  assert.ok(r.entradas.formas.find((f) => f.forma === "fiado").naoEntraNoCaixa);
  assert.deepEqual(r.entradas.recebimentos.map((f) => [f.nome, f.valor, f.anterior]), [["PIX Bradesco", 250, 250]]);
  assert.equal(r.entradas.total, 1450);
  assert.equal(r.entradas.formas.reduce((s, f) => s + f.valor, 0) + r.entradas.recebimentos.reduce((s, f) => s + f.valor, 0), r.entradas.total);
  // saídas por conta
  assert.deepEqual(r.saidas.grupos.map((g) => [g.grupo, g.total, g.itens[0].pagoCom]), [["Despesas fixas", 500, "Bradesco"]]);
  // movimento por conta (o fechamento)
  const c = Object.fromEntries(r.contas.porConta.map((x) => [x.conta, x]));
  assert.deepEqual([c.gaveta.inicio, c.gaveta.entradas, c.gaveta.saidas, c.gaveta.transferencias, c.gaveta.fim], [300, 200, 0, -100, 400]);
  assert.deepEqual([c.bradesco.inicio, c.bradesco.entradas, c.bradesco.saidas, c.bradesco.transferencias, c.bradesco.fim], [1000, 250, 500, 100, 850]);
  assert.equal(c.picpay.fim, 0); // débito cai no dia seguinte
  assert.equal(r.contas.total.fim, 1250);
  // resultado do dia (controle interno): vendas − CMV (com itens + estimado 50% no crédito sem itens)
  assert.deepEqual(r.resultado, { vendas: 1200, cmv: 610, lucroBruto: 590, margemPct: 590 / 1200 });
  // lista detalhada em ordem de hora, com o número da venda
  assert.ok(r.detalhada.some((l) => l.numero && l.venda && l.entrada === 200));
  assert.ok(r.detalhada.find((l) => l.tipo === "Transferência").transferencia === 100);
});

test("débito do dia anterior entra como recebível de cartão; estornado aparece sem somar", () => {
  const l = dia20();
  const r = resumoDoDia({ lancamentos: l, estornados: [{ ...venda("2026-10-21", 999, [pg("dinheiro", 999)]), excluido: true }], config: {}, saldos, de: "2026-10-21", clientes });
  const pic = r.contas.porConta.find((x) => x.conta === "picpay");
  assert.deepEqual([pic.entradas, pic.recebiveisCartao], [100, 100]);
  assert.equal(r.quadros.vendido, 0);
  assert.equal(r.quadros.entrou, 100);
  assert.deepEqual(r.detalhada.map((x) => [x.estornado, x.entrada]), [[true, 999]]);
});

test("gaveta: esperado × contado (diferença)", () => {
  const conf = { ...saldos, conferencias: [{ conta: "gaveta", data: "2026-10-20", calculado: 400, informado: 395, diferenca: -5, em: "2026-10-20T21:00:00Z" }] };
  const r = resumoDoDia({ lancamentos: dia20(), config: {}, saldos: conf, de: "2026-10-20", clientes });
  assert.deepEqual(r.contas.gaveta, { esperado: 400, contado: 395, diferenca: -5, em: "2026-10-20T21:00:00Z", bateu: false });
  assert.equal(resumoDoDia({ lancamentos: dia20(), config: {}, saldos, de: "2026-10-20" }).contas.gaveta, null);
});

test("soma dos dias = mês (vendas, CMV e movimento de cada conta); período soma igual", () => {
  const l = [
    ...dia20(),
    venda("2026-10-05", 800, [pg("transferencia", 800)]),
    venda("2026-10-31", 120, [pg("dinheiro", 120)], comItens(70)),
    { id: "S2", v: 2, conta: "salarios", value: 1500, competencia: "2026-10-30", dataPagamento: "2026-10-30", pagoCom: "gaveta" },
  ];
  let vendas = 0, cmv = 0;
  const delta = { gaveta: 0, bradesco: 0, picpay: 0, cheques_carteira: 0 };
  for (let d = 1; d <= 31; d++) {
    const r = resumoDoDia({ lancamentos: l, config: {}, saldos, de: `2026-10-${String(d).padStart(2, "0")}`, clientes });
    vendas += Math.round(r.resultado.vendas * 100); cmv += Math.round(r.resultado.cmv * 100);
    for (const c of r.contas.porConta) delta[c.conta] += Math.round((c.fim - c.inicio) * 100);
  }
  const dre = montarDRE(l, {}, "2026-10");
  assert.equal(vendas / 100, dre.valores.receitaBruta);
  assert.equal(cmv / 100, dre.info.cmvOrigem.total);
  const movs = movimentos(l, {});
  for (const c of Object.keys(delta)) {
    const f = fluxoMensal(movs, saldos.abertura, "2026-10", c);
    assert.equal(delta[c] / 100, Math.round((f.saldoFinal - f.saldoInicial) * 100) / 100, c);
  }
  const mes = resumoDoDia({ lancamentos: l, config: {}, saldos, de: "2026-10-01", ate: "2026-10-31", clientes });
  assert.equal(mes.resultado.vendas, dre.valores.receitaBruta);
  assert.equal(mes.quadros.vendido, dre.valores.receitaBruta);
});
