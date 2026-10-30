import { test } from "node:test";
import assert from "node:assert/strict";
import { movimentos, saldos, projecao, fluxoMensal, cheques, carteiraNaData, dividirEmParcelas } from "../lib/caixa.js";

let n = 0;
const venda = (pagamentos, extra = {}) => ({ id: `v${n++}`, v: 2, conta: "venda_produtos", value: pagamentos.reduce((s, p) => s + p.valor, 0), competencia: "2026-11-02", date: "2026-11-02", pagamentos, ...extra });
const saida = (valor, pagoCom, extra = {}) => ({ id: `s${n++}`, v: 2, conta: "energia", value: valor, competencia: "2026-11-03", date: "2026-11-03", pagoCom, dataPagamento: "2026-11-03", ...extra });
const soma = (movs, filtro) => Math.round(movs.filter(filtro).reduce((s, m) => s + m.valor * 100, 0)) / 100;
const CONTA = { dinheiro: "gaveta", pix_bradesco: "bradesco", pix_picpay: "picpay", transferencia: "bradesco", debito: "picpay", credito: "picpay", credito_parcelado: "picpay", cheque: "cheques_carteira" };
const pg = (forma, valor, extra = {}) => ({ forma, valor, conta: CONTA[forma], ...extra });

test("PIX e dinheiro entram no dia, na conta da forma", () => {
  const m = movimentos([venda([pg("dinheiro", 100), pg("pix_bradesco", 200), pg("pix_picpay", 50)])], {});
  assert.deepEqual(m.map((x) => [x.conta, x.data, x.valor]), [["gaveta", "2026-11-02", 100], ["bradesco", "2026-11-02", 200], ["picpay", "2026-11-02", 50]]);
});

test("cartão: débito D+1 e crédito D+30 no PicPay, já sem a taxa", () => {
  const cfg = { cartao: { debito: { taxaPct: 1, prazoDias: 1 }, credito: { taxaPct: 3, prazoDias: 30 } } };
  const m = movimentos([venda([pg("debito", 100), pg("credito", 200)])], cfg);
  assert.deepEqual(m.map((x) => [x.conta, x.data, x.valor, x.tipo]), [["picpay", "2026-11-03", 99, "recebivel_cartao"], ["picpay", "2026-12-02", 194, "recebivel_cartao"]]);
});

test("parcelado 3x: uma parcela a cada 30 dias, centavos exatos", () => {
  const m = movimentos([venda([pg("credito_parcelado", 100, { parcelas: 3 })])], {});
  assert.deepEqual(m.map((x) => [x.data, x.valor]), [["2026-12-02", 33.33], ["2027-01-01", 33.33], ["2027-01-31", 33.34]]);
  assert.deepEqual(dividirEmParcelas(1000, 3), [333, 333, 334]);
});

test("cheque recebido: carteira na venda; na compensação sai da carteira e entra no Bradesco", () => {
  const m = movimentos([venda([pg("cheque", 500, { cheque: { numero: "12", compensacao: "2026-11-20" } })])], {});
  assert.deepEqual(m.map((x) => [x.conta, x.data, x.valor]), [["cheques_carteira", "2026-11-02", 500], ["cheques_carteira", "2026-11-20", -500], ["bradesco", "2026-11-20", 500]]);
  const pic = movimentos([venda([pg("cheque", 500, { cheque: { compensacao: "2026-11-20", contaDeposito: "picpay" } })])], {});
  assert.equal(pic[2].conta, "picpay");
});

test("cheque devolvido antes de compensar sai da carteira; depois de compensar, estorna no banco", () => {
  const antes = movimentos([venda([pg("cheque", 300, { cheque: { compensacao: "2026-11-20", devolvidoEm: "2026-11-18" } })])], {});
  assert.deepEqual(antes.map((x) => [x.conta, x.data, x.valor]), [["cheques_carteira", "2026-11-02", 300], ["cheques_carteira", "2026-11-18", -300]]);
  const depois = movimentos([venda([pg("cheque", 300, { cheque: { compensacao: "2026-11-20", devolvidoEm: "2026-11-23" } })])], {});
  assert.equal(soma(depois, (x) => x.conta === "bradesco"), 0);
  assert.equal(soma(depois, (x) => x.conta === "cheques_carteira"), 0);
});

test("saídas: pagas na data do pagamento; cheque emitido sai da conta escolhida na compensação", () => {
  const m = movimentos([saida(80, "gaveta"), saida(1000, "cheque_emitido", { chequeEmitido: { numero: "9", compensacao: "2026-11-25", conta: "picpay" } })], {});
  assert.deepEqual(m.map((x) => [x.conta, x.data, x.valor, x.tipo]), [["gaveta", "2026-11-03", -80, "saida"], ["picpay", "2026-11-25", -1000, "cheque_emitido"]]);
});

test("transferência: sai de uma conta e entra na outra; abertura e forma não informada não mexem no caixa", () => {
  const m = movimentos([
    { id: "t", v: 2, conta: "transferencia", de: "picpay", para: "bradesco", value: 700, competencia: "2026-11-05" },
    { id: "ab", v: 2, abertura: true, conta: "venda_produtos", value: 999, competencia: "2026-08-23", pagamentos: [{ forma: "nao_informada", valor: 999, conta: null }] },
  ], {});
  assert.deepEqual(m.map((x) => [x.conta, x.valor]), [["picpay", -700], ["bradesco", 700]]);
});

test("lançamento antigo (v1) também vira movimento", () => {
  const m = movimentos([{ id: "1", category: "venda", type: "income", value: 50, date: "2026-09-01", method: "pix" }], {});
  assert.deepEqual(m.map((x) => [x.conta, x.valor]), [["bradesco", 50]]);
});

test("saldos: abertura no início do dia + movimentos a partir dela", () => {
  const movs = movimentos([
    venda([pg("dinheiro", 100)], { competencia: "2026-10-31" }), // antes da abertura: fica de fora
    venda([pg("dinheiro", 40), pg("pix_bradesco", 60)]),
    saida(30, "bradesco"),
  ], {});
  const abertura = { data: "2026-11-01", contas: { gaveta: 200, bradesco: 1000, picpay: 0, cheques_carteira: 0 } };
  const s = saldos(movs, abertura, "2026-11-30");
  assert.deepEqual(s.porConta, { gaveta: 240, bradesco: 1030, picpay: 0, cheques_carteira: 0 });
  assert.equal(s.total, 1270);
  assert.equal(saldos(movs, abertura, "2026-11-02").porConta.bradesco, 1060);
});

test("projeção de 30 dias: recebíveis, cheques e contas a pagar depois de hoje", () => {
  const movs = movimentos([
    venda([pg("credito", 300), pg("cheque", 200, { cheque: { compensacao: "2026-11-15" } })]),
    saida(500, "bradesco", { dataPagamento: "2026-11-20" }),
    saida(100, "cheque_emitido", { chequeEmitido: { compensacao: "2026-11-10", conta: "bradesco" } }),
  ], {});
  const abertura = { data: "2026-11-01", contas: { gaveta: 0, bradesco: 1000, picpay: 0, cheques_carteira: 0 } };
  const p = projecao(movs, abertura, "2026-11-05", 30);
  assert.equal(p.saldoHoje.total, 1200); // 1000 + cheque em carteira 200
  assert.equal(p.porTipo.recebivel_cartao, 300);
  assert.equal(p.porTipo.cheque_emitido, -100);
  assert.equal(p.porTipo.saida, -500);
  assert.equal(p.saldoFinal, 1200 + 300 - 100 - 500);
  assert.equal(p.porContaFinal.cheques_carteira, 0);
  assert.equal(p.porContaFinal.bradesco, 1000 + 200 - 100 - 500);
});

test("fluxo mensal: saldo inicial, entradas por tipo, saídas por grupo e dia a dia", () => {
  const movs = movimentos([venda([pg("dinheiro", 100)]), saida(30, "gaveta"), saida(20, "gaveta", { conta: "combustivel" })], {});
  const f = fluxoMensal(movs, { data: "2026-11-01", contas: { gaveta: 50 } }, "2026-11", "gaveta");
  assert.equal(f.saldoInicial, 50);
  assert.deepEqual(f.entradas, { venda: 100 });
  assert.deepEqual(f.saidas, { fixas: 30, operacionais: 20 });
  assert.equal(f.saldoFinal, 100);
  assert.deepEqual(f.dias.map((d) => [d.data, d.saldo]), [["2026-11-02", 150], ["2026-11-03", 100]]);
});

test("lista de cheques e carteira sugerida para a abertura", () => {
  const l = [
    venda([pg("cheque", 300, { cheque: { numero: "1", compensacao: "2026-11-10" } })], { competencia: "2026-10-20" }),
    venda([pg("cheque", 200, { cheque: { numero: "2", compensacao: "2026-10-25" } })], { competencia: "2026-10-20" }),
    saida(900, "cheque_emitido", { chequeEmitido: { numero: "77", compensacao: "2026-11-12", favorecido: "Serraria" } }),
  ];
  const c = cheques(l, {}, "2026-11-01");
  assert.deepEqual(c.recebidos.map((x) => [x.numero, x.situacao]), [["2", "compensado"], ["1", "a_compensar"]]);
  assert.deepEqual(c.emitidos.map((x) => [x.numero, x.situacao, x.favorecido]), [["77", "a_compensar", "Serraria"]]);
  assert.deepEqual(carteiraNaData(l, {}, "2026-11-01"), { valor: 300, quantidade: 1 });
});

test("fluxo consolidado: compensação de cheque e transferência não aparecem como entrada e saída", () => {
  const movs = movimentos([
    venda([pg("cheque", 400, { cheque: { compensacao: "2026-11-10" } })]),
    { id: "t9", v: 2, conta: "transferencia", de: "picpay", para: "bradesco", value: 100, competencia: "2026-11-05" },
  ], {});
  const f = fluxoMensal(movs, { data: "2026-11-01", contas: { picpay: 100 } }, "2026-11");
  assert.deepEqual(f.entradas, { cheque_recebido: 400 });
  assert.deepEqual(f.saidas, {});
  assert.equal(f.saldoFinal, 500);
  const banco = fluxoMensal(movs, { data: "2026-11-01", contas: { picpay: 100 } }, "2026-11", "bradesco");
  assert.deepEqual(banco.entradas, { transferencia: 100, cheque_compensado: 400 });
});

test("abertura refeita depois: cheques da abertura já compensados ou devolvidos não contam na carteira", async () => {
  const { chequesNaAbertura } = await import("../lib/caixa.js");
  const ch = (id, comp, dev) => ({ id, v: 2, conta: "cheque_anterior", value: 300, competencia: "2026-10-01", pagamentos: [{ forma: "cheque", valor: 300, cheque: { numero: id, compensacao: comp, ...(dev ? { devolvidoEm: dev } : {}) } }] });
  const l = [ch("A", "2026-10-05"), ch("B", "2026-10-20"), ch("C", "2026-10-25", "2026-10-08")];
  assert.equal(chequesNaAbertura(l, {}, "2026-10-01").totalAbertura, 900);
  assert.equal(chequesNaAbertura(l, {}, "2026-10-10").totalAbertura, 300); // só o B ainda está na gaveta
});
