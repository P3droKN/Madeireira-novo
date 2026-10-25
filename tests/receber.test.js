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
  assert.equal(d.valores.cmvInformado, -300); // no DRE as deduções vêm negativas (venda sem itens: CMV informado)
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

test("abertura: fiado da pasta vira conta a receber; cheque lançado na abertura não entra duas vezes na carteira", async () => {
  const { chequesNaAbertura } = await import("../lib/caixa.js");
  const ab = { data: "2026-11-02", contas: { gaveta: 100, bradesco: 1000, picpay: 0, cheques_carteira: 700 } };
  const l = [
    { id: "FA1", v: 2, conta: "fiado_anterior", value: 480, competencia: "2026-11-02", clienteId: "C1", cliente: "Zé", vencimento: "2026-11-10", description: "Fiado anterior (pasta)" },
    { id: "CA1", v: 2, conta: "cheque_anterior", value: 300, competencia: "2026-11-02", cliente: "Ana", pagamentos: [{ forma: "cheque", conta: "cheques_carteira", valor: 300, tPag: "02", cheque: { numero: "55", emissor: "Ana", compensacao: "2026-11-05" } }] },
    // do sistema antigo: recebido antes, compensa depois
    { id: "V0", v: 2, conta: "venda_produtos", value: 400, competencia: "2026-10-20", pagamentos: [{ forma: "cheque", conta: "cheques_carteira", valor: 400, tPag: "02", cheque: { numero: "44", compensacao: "2026-11-08" } }] },
  ];
  const ca = chequesNaAbertura(l, {}, "2026-11-02");
  assert.deepEqual([ca.doSistema.length, ca.naAbertura.length, ca.total], [1, 1, 700]);
  const movs = movimentos(l, {});
  const s = (d) => saldos(movs, ab, d).porConta;
  assert.equal(s("2026-11-02").cheques_carteira, 700, "carteira = abertura (sem somar o cheque de novo)");
  assert.deepEqual([s("2026-11-05").cheques_carteira, s("2026-11-05").bradesco], [400, 1300], "cheque da abertura compensa no Bradesco");
  assert.deepEqual([s("2026-11-08").cheques_carteira, s("2026-11-08").bradesco], [0, 1700]);
  const r = contasAReceber(l, {}, "2026-11-12", clientes.concat([{ id: "C1", nome: "Zé" }]));
  const ze = r.porCliente.find((c) => c.clienteId === "C1");
  assert.deepEqual([ze.aberto, ze.atrasado, ze.dividas[0].tipo], [480, 480, "fiado_anterior"]);
  assert.equal(montarDRE(l, {}, "2026-11").valores.receitaBruta, 0, "fiado anterior não é receita");
  // cheque da abertura devolvido: a Ana passa a dever
  const dev = [l[0], { ...l[1], pagamentos: [{ ...l[1].pagamentos[0], cheque: { ...l[1].pagamentos[0].cheque, devolvidoEm: "2026-11-06" } }] }];
  assert.equal(contasAReceber(dev, {}, "2026-11-12").porCliente.find((c) => c.cliente === "Ana").aberto, 300);
});

test("conta corrente: sem vencimento, nunca atrasado; em aberto há X dias; abate a mais antiga; alertas opcionais", async () => {
  const { recebidoDeFiadoAnterior } = await import("../lib/receber.js");
  const cc = [{ id: "C7", nome: "Seu Antônio", telefone: "", contaCorrente: true, alertaLimite: 1000, alertaDias: 60 }];
  const v = (id, data, valor) => ({ id, v: 2, conta: "venda_produtos", value: valor, competencia: data, clienteId: "C7", cliente: "Seu Antônio", pagamentos: [{ forma: "fiado", conta: null, valor, tPag: "05", fiado: { contaCorrente: true, vencimento: "" } }] });
  const l = [
    { id: "FA1", v: 2, conta: "fiado_anterior", value: 700, competencia: "2026-08-01", clienteId: "C7", cliente: "Seu Antônio", vencimento: "", contaCorrente: true },
    v("V1", "2026-09-10", 200),
    v("V2", "2026-10-01", 150),
    { id: "R1", v: 2, conta: "recebimento", value: 800, competencia: "2026-10-05", clienteId: "C7", cliente: "Seu Antônio", pagamentos: [{ forma: "cheque", conta: "cheques_carteira", valor: 800, tPag: "02", cheque: { compensacao: "2026-10-20" } }] },
  ];
  const r = contasAReceber(l, {}, "2026-10-15", cc);
  const c = r.porCliente[0];
  assert.equal(c.contaCorrente, true);
  assert.equal(c.atrasado, 0, "nunca atrasado");
  assert.equal(r.totalAtrasado, 0);
  assert.deepEqual(c.dividas.map((d) => [d.origemId, d.aberto, d.situacao, d.vencimento]), [["FA1", 0, "pago", null], ["V1", 100, "em_aberto", null], ["V2", 150, "em_aberto", null]]);
  assert.equal(c.aberto, 250);
  assert.deepEqual([c.emAbertoDesde, c.diasEmAberto, c.ultimoPagamento, c.diasSemPagar], ["2026-09-10", 35, "2026-10-05", 10]);
  assert.deepEqual(c.alertas, [], "abaixo do limite e com pagamento recente: sem alerta");
  assert.deepEqual([r.totalContaCorrente, r.totalComVencimento], [250, 0]);
  assert.equal(c.recebimentos[0].paraAnterior, 700, "dos 800 recebidos, 700 pagaram a pasta anterior à virada");
  assert.equal(recebidoDeFiadoAnterior(l, {}, "2026-10", "2026-10-15", cc), 700);
  assert.equal(recebidoDeFiadoAnterior(l, {}, "2026-09", "2026-10-15", cc), 0);
  // Alertas: limite e dias sem pagar
  const muito = contasAReceber([...l, v("V3", "2026-10-10", 900)], {}, "2026-12-20", cc).porCliente[0];
  assert.deepEqual(muito.alertas.map((a) => a.tipo), ["limite", "dias"]);
  assert.ok(muito.alertas[0].texto.includes("limite de R$ 1.000,00") && muito.alertas[1].texto.startsWith("76 dias sem pagar"));
  // Em branco = sem alerta
  const semAlerta = contasAReceber([...l, v("V3", "2026-10-10", 900)], {}, "2026-12-20", [{ ...cc[0], alertaLimite: null, alertaDias: null }]).porCliente[0];
  assert.deepEqual(semAlerta.alertas, []);
  // Desmarcar conta corrente: volta a valer o vencimento padrão (data + 30)
  const normal = contasAReceber(l, {}, "2026-10-15", [{ ...cc[0], contaCorrente: false }]).porCliente[0];
  assert.equal(normal.contaCorrente, false);
  assert.ok(normal.dividas.every((d) => d.vencimento));
  assert.ok(textoCobrancaFiado(c, "2026-10-15").includes("• 10/09/2026 – R$ 100,00") && !textoCobrancaFiado(c, "2026-10-15").includes("vence"), "cobrança da conta corrente sem vencimento");
});
