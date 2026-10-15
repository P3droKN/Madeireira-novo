import { test } from "node:test";
import assert from "node:assert/strict";
import { contasAReceber, chaveCliente, textoCobrancaFiado } from "../lib/receber.js";
import { movimentos, saldos, cheques } from "../lib/caixa.js";
import { montarDRE } from "../lib/financeiro.js";

const venda = (id, data, pagamentos, extra = {}) => ({ id, v: 2, conta: "venda_produtos", value: pagamentos.reduce((s, p) => s + p.valor, 0), date: data, competencia: data, pagamentos, clienteId: "47999991234", cliente: "Carlos Souza", ...extra });
const fiado = (valor, vencimento) => ({ forma: "fiado", conta: null, valor, tPag: "05", ...(vencimento ? { fiado: { vencimento } } : {}) });
const receb = (id, data, pagamentos, extra = {}) => ({ id, v: 2, conta: "recebimento", value: pagamentos.reduce((s, p) => s + p.valor, 0), date: data, competencia: data, pagamentos, clienteId: "47999991234", cliente: "Carlos Souza", ...extra });
const clientes = [{ id: "47999991234", nome: "Carlos Souza", telefone: "(47) 99999-1234" }];

test("venda fiado vira conta a receber com vencimento (combinado ou prazo padrão de 30 dias)", () => {
  const r = contasAReceber([venda("v1", "2026-10-01", [fiado(500, "2026-10-20")]), venda("v2", "2026-10-05", [fiado(300)])], {}, "2026-10-10", clientes);
  const c = r.porCliente[0];
  assert.equal(c.cliente, "Carlos Souza");
  assert.equal(c.aberto, 800);
  assert.deepEqual(c.dividas.map((d) => [d.origemId, d.vencimento, d.situacao]), [["v1", "2026-10-20", "a_vencer"], ["v2", "2026-11-04", "a_vencer"]]);
  assert.equal(c.proximoVencimento, "2026-10-20");
  assert.equal(r.totalAberto, 800);
  assert.equal(r.totalAtrasado, 0);
});

test("pagamento parcial abate a mais antiga primeiro; atraso em dias", () => {
  const l = [
    venda("v1", "2026-09-01", [fiado(500, "2026-09-30")]),
    venda("v2", "2026-10-01", [fiado(300, "2026-10-31")]),
    receb("r1", "2026-10-05", [{ forma: "dinheiro", conta: "gaveta", valor: 200, tPag: "01" }]),
  ];
  const c = contasAReceber(l, {}, "2026-10-10", clientes).porCliente[0];
  assert.deepEqual(c.dividas.map((d) => [d.origemId, d.pago, d.aberto, d.situacao, d.diasAtraso]), [["v1", 200, 300, "atrasado", 10], ["v2", 0, 300, "a_vencer", 0]]);
  assert.equal(c.aberto, 600);
  assert.equal(c.atrasado, 300);
  assert.equal(c.maiorAtraso, 10);
});

test("recebimento pode indicar a venda; excluir o recebimento reabre a dívida", () => {
  const l = [
    venda("v1", "2026-09-01", [fiado(500, "2026-09-30")]),
    venda("v2", "2026-10-01", [fiado(300, "2026-10-31")]),
    receb("r1", "2026-10-05", [{ forma: "pix_bradesco", conta: "bradesco", valor: 300, tPag: "20" }], { vendaIds: ["v2"] }),
  ];
  const c = contasAReceber(l, {}, "2026-10-10", clientes).porCliente[0];
  assert.deepEqual(c.dividas.map((d) => [d.origemId, d.aberto]), [["v1", 500], ["v2", 0]]);
  const sem = contasAReceber([...l.slice(0, 2), { ...l[2], excluido: true }], {}, "2026-10-10", clientes).porCliente[0];
  assert.equal(sem.aberto, 800, "excluído não conta");
});

test("recebimento em cheque vai para a carteira; cheque devolvido reabre o valor para o cliente", () => {
  const ch = { forma: "cheque", conta: "cheques_carteira", valor: 500, tPag: "02", cheque: { numero: "77", emissor: "Carlos", compensacao: "2026-11-05" } };
  const l = [venda("v1", "2026-09-01", [fiado(500, "2026-09-30")]), receb("r1", "2026-10-05", [ch])];
  let c = contasAReceber(l, {}, "2026-10-10", clientes).porCliente[0];
  assert.equal(c.aberto, 0, "pago com cheque");
  const movs = movimentos(l, {});
  assert.equal(saldos(movs, { data: "2026-10-01", contas: {} }, "2026-10-10").porConta.cheques_carteira, 500, "cheque na carteira");
  assert.equal(cheques(l, {}, "2026-10-10").recebidos[0].cliente, "Carlos Souza");
  const devolvido = [l[0], receb("r1", "2026-10-05", [{ ...ch, cheque: { ...ch.cheque, devolvidoEm: "2026-11-06" } }])];
  c = contasAReceber(devolvido, {}, "2026-11-10", clientes).porCliente[0];
  assert.equal(c.aberto, 500, "cheque devolvido: volta a dever");
  assert.equal(c.dividas.find((d) => d.tipo === "cheque_devolvido").descricao, "Cheque devolvido nº 77 (Carlos)");
});

test("cheque devolvido de venda à vista também vira conta a receber (pelo cliente ou pelo emissor)", () => {
  const l = [venda("v9", "2026-10-01", [{ forma: "cheque", conta: "cheques_carteira", valor: 250, tPag: "02", cheque: { numero: "5", emissor: "Ana Lima", compensacao: "2026-10-03", devolvidoEm: "2026-10-04" } }], { clienteId: undefined, cliente: "" })];
  const r = contasAReceber(l, {}, "2026-10-10");
  assert.equal(r.porCliente[0].cliente, "Ana Lima");
  assert.equal(r.porCliente[0].chave, chaveCliente(null, "ana  LIMA"));
  assert.equal(r.porCliente[0].atrasado, 250);
});

test("fiado: receita e CMV na data da venda; não entra no caixa; recebimento entra no caixa e fica fora do DRE", () => {
  const l = [
    venda("v1", "2026-10-01", [fiado(400, "2026-10-31"), { forma: "dinheiro", conta: "gaveta", valor: 100, tPag: "01" }], { cmv: 300 }),
    receb("r1", "2026-10-20", [{ forma: "dinheiro", conta: "gaveta", valor: 400, tPag: "01" }]),
  ];
  const d = montarDRE(l, {}, "2026-10");
  assert.equal(d.valores.receitaBruta, 500);
  assert.equal(d.valores.cmvCalculadora, -300); // no DRE as deduções vêm negativas
  const movs = movimentos(l, {});
  assert.deepEqual(movs.map((m) => [m.data, m.conta, m.valor, m.tipo]), [["2026-10-01", "gaveta", 100, "venda"], ["2026-10-20", "gaveta", 400, "recebimento"]]);
});

test("pagou a mais: fica de crédito", () => {
  const l = [venda("v1", "2026-10-01", [fiado(100)]), receb("r1", "2026-10-02", [{ forma: "dinheiro", conta: "gaveta", valor: 150, tPag: "01" }])];
  const c = contasAReceber(l, {}, "2026-10-10", clientes).porCliente[0];
  assert.equal(c.aberto, 0);
  assert.equal(c.credito, 50);
});

test("compra nova não reabre a que já foi paga (recebimento só abate o que existia); crédito abate a próxima", () => {
  const l = [
    venda("v1", "2026-10-01", [fiado(250, "2026-11-01")]),
    receb("r1", "2026-10-10", [{ forma: "dinheiro", conta: "gaveta", valor: 300, tPag: "01" }]),
    venda("v2", "2026-10-15", [fiado(80, "2026-10-20")]), // vence antes da v1, mas é posterior ao pagamento
  ];
  const c = contasAReceber(l, {}, "2026-10-16", clientes).porCliente[0];
  assert.deepEqual(c.dividas.map((d) => [d.origemId, d.pago, d.aberto]), [["v2", 50, 30], ["v1", 250, 0]]);
  assert.equal(c.aberto, 30, "os R$ 50 de crédito abatem a compra nova");
  assert.equal(c.credito, 0);
});

test("texto de cobrança no WhatsApp", () => {
  const c = contasAReceber([venda("v1", "2026-09-01", [fiado(500, "2026-09-30")])], {}, "2026-10-10", clientes).porCliente[0];
  const t = textoCobrancaFiado(c, "2026-10-10");
  assert.ok(t.startsWith("Olá Carlos") && t.includes("Consta em aberto R$ 500,00") && t.includes("01/09/2026 – R$ 500,00 (venceu 30/09/2026)"));
});
