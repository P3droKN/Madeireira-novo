// Vários aparelhos ao mesmo tempo, no mesmo banco: dono (computador), Ana (celular) e Beto (computador).
// Vendas simultâneas (números seguidos, sem repetir nem pular, todas no Caixa e no Dia), receber fiado do mesmo
// cliente em dois aparelhos (aviso com o saldo novo, nunca abate em dobro sem confirmar), editar o mesmo cliente,
// orçamento virando venda em 3 aparelhos, cliente novo aparecendo nos outros, gaveta fechada enquanto vende,
// internet caindo (avisa "Não foi salvo" e a nova tentativa não duplica).
import { createRequire } from "node:module";
const require = createRequire("/opt/node-tools/node_modules/");
const { chromium, devices } = require("playwright");
import { fecharVias, abrirFicha } from "./janela.mjs";
const URL = "http://localhost:4321";
const H = { "content-type": "application/json", "x-senha": "pinho123" };
const nb = (s) => (s || "").replace(/\u00a0/g, " ");
const ok = (cond, msg) => { console.log((cond ? "OK   " : "FALHA") + " " + msg); if (!cond) process.exitCode = 1; };
const db = async () => (await fetch(URL + "/__db")).json();
const lanc = async () => Object.values((await db()).madeireira_lancamentos || {}).map((x) => JSON.parse(x)).filter((l) => !l.excluido);
const api = async (nome, { m = "GET", b, h = H } = {}) => {
  const r = await fetch(URL + "/api/" + nome, { method: m, headers: { "content-type": "application/json", ...h }, body: b ? JSON.stringify(b) : undefined });
  return { status: r.status, corpo: await r.json().catch(() => null) };
};

await api("precos", { m: "POST", b: { alteracoes: { "PINUS|1x2x2.50|BRUTO": 10 } } });
const ana = (await api("funcionarios", { m: "POST", b: { funcionario: { nome: "Ana Souza", pin: "1234" } } })).corpo.funcionario;
const beto = (await api("funcionarios", { m: "POST", b: { funcionario: { nome: "Beto", pin: "5678" } } })).corpo.funcionario;

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
// Cada aparelho guarda as mensagens e decide se aceita a próxima pergunta (confirm)
async function aparelho(nome, caminho, opcoes) {
  const ctx = await browser.newContext({ locale: "pt-BR", timezoneId: "America/Sao_Paulo", ...opcoes });
  const page = await ctx.newPage();
  const ap = { nome, page, msgs: [], recusar: false };
  page.on("dialog", async (d) => { ap.msgs.push(d.message()); if (d.type() === "confirm" && ap.recusar) { ap.recusar = false; return d.dismiss(); } await d.accept(); });
  page.on("pageerror", (e) => console.log(`ERRO JS (${nome}):`, e.message));
  await page.goto(URL + caminho);
  return ap;
}
const dono = await aparelho("dono", "/", { viewport: { width: 1280, height: 900 } });
await dono.page.fill("#senha-input", "pinho123"); await dono.page.click("#senha-form button");
const A = await aparelho("Ana", "/funcionarios", { ...devices["iPhone 13"] });
const B = await aparelho("Beto", "/funcionarios", { viewport: { width: 1280, height: 900 } });
for (const [ap, f, pin] of [[A, ana, "1234"], [B, beto, "5678"]]) {
  await ap.page.waitForFunction(() => document.querySelectorAll("#pin-nome option").length >= 3);
  await ap.page.selectOption("#pin-nome", f.id); await ap.page.fill("#pin-input", pin); await ap.page.click("#pin-form button");
  await ap.page.waitForSelector("#modal-pin", { state: "hidden" });
}
const todos = [dono, A, B];
for (const ap of todos) await ap.page.waitForFunction(() => window.Caixa && document.getElementById("catalogo-status").textContent.includes("itens"));
const add = async (page, qtd = 1) => {
  await page.selectOption("#material", "PINUS"); await page.selectOption("#dimension", "PINUS|1x2x2.50");
  await page.fill("#quantity-pieces", String(qtd)); await page.click("#btn-adicionar");
};
const vender = async (ap, qtd = 1) => { await ap.page.click("#btn-tab-vender"); await add(ap.page, qtd); await ap.page.click("#btn-registrar-venda"); await fecharVias(ap.page, ap.msgs); };

// 1. Vendas ao mesmo tempo: 3 rodadas com os 3 aparelhos registrando juntos
for (let rodada = 0; rodada < 3; rodada++) await Promise.all(todos.map((ap, i) => vender(ap, rodada * 3 + i + 1)));
let vendas = (await lanc()).filter((l) => l.conta === "venda_produtos");
const nums = vendas.map((l) => Number(l.numero.slice(2))).sort((a, b) => a - b);
ok(vendas.length === 9 && nums.join(",") === "1,2,3,4,5,6,7,8,9", `vendas ao mesmo tempo: 9 vendas, números ${nums.map((n) => "V-" + String(n).padStart(4, "0")).join(" ")} (sem repetir nem pular)`);
ok(["Dono", "Ana Souza", "Beto"].every((n) => vendas.filter((l) => l.vendedor?.nome === n).length === 3), "3 vendas de cada aparelho, cada uma com o seu vendedor");
await dono.page.evaluate(() => window.Caixa.recarregar());
await dono.page.click("#btn-tab-caixa"); await dono.page.click('.subtabs[data-grupo="caixa"] .subtab[data-sub="lista"]');
await dono.page.waitForSelector("#fin-lista-body tr");
const listaDono = nb(await dono.page.textContent("#fin-lista-body"));
ok(nums.every((n) => listaDono.includes("V-" + String(n).padStart(4, "0"))), "todas aparecem no Caixa › Lançamentos do dono");
await dono.page.click("#btn-tab-relatorios"); await dono.page.click('.subtabs[data-grupo="relatorios"] .subtab[data-sub="dia"]');
await dono.page.waitForSelector("#dia-vendedores", { state: "attached" });
const nDia = await dono.page.evaluate(() => [...document.querySelectorAll("#dia-vendedores tbody tr td:nth-child(2)")].reduce((s, td) => s + Number(td.textContent), 0));
ok(nDia === 9, `Relatórios › Dia do dono: ${nDia} vendas`);
const totalVendas = vendas.reduce((s, l) => s + l.value, 0);
const moedaBR = (v) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v).replace(/\u00a0/g, " ");
const totaisDia = await dono.page.evaluate(() => [...document.querySelectorAll("#dia-vendedores tbody tr td:nth-child(3)")].map((td) => td.textContent));
ok(Math.abs(totaisDia.reduce((s, t) => s + Number(t.replace(/[^\d,]/g, "").replace(",", ".")), 0) - totalVendas) < 0.01, `e o total do Dia bate (${moedaBR(totalVendas)})`);

// 2. Receber fiado do mesmo cliente em dois aparelhos
const cli = (await api("clientes", { m: "POST", b: { cliente: { nome: "Dona Rosa", telefone: "(47) 98888-1111" } } })).corpo.cliente;
const hoje = await dono.page.evaluate(() => window.Caixa.hoje());
await api("lancamento", { m: "POST", b: { itens: [{ id: "FIADO1", v: 2, conta: "venda_produtos", value: 100, competencia: hoje, description: "fiado", clienteId: cli.id, cliente: cli.nome, pagamentos: [{ forma: "fiado", valor: 100 }] }] } });
const abrirReceber = async (ap) => {
  await ap.page.evaluate(() => window.Clientes.carregar());
  await abrirFicha(ap.page, "Dona Rosa");
  await ap.page.click("#cli-receber");
  await ap.page.waitForSelector("#modal-receber", { state: "visible" });
  return nb(await ap.page.textContent("#rc-receber-info"));
};
const receber = async (ap, valor) => { await ap.page.fill("#rc-valor", String(valor)); await ap.page.dispatchEvent("#rc-valor", "input"); await ap.page.click("#rc-receber-form button[type=submit]"); };
const recebido = async () => (await lanc()).filter((l) => l.conta === "recebimento" && l.clienteId === cli.id).reduce((s, l) => s + l.value, 0);
const [infoA, infoB] = await Promise.all([abrirReceber(A), abrirReceber(B)]);
ok(infoA.includes("R$ 100,00") && infoB.includes("R$ 100,00"), "Ana e Beto abrem Receber da Dona Rosa: os dois veem R$ 100,00 em aberto");
await receber(A, 40);
await A.page.waitForSelector("#modal-receber", { state: "hidden" });
B.msgs.length = 0;
await receber(B, 40);
await B.page.waitForSelector("#modal-receber", { state: "hidden" });
const perg = B.msgs.find((m) => m.includes("Confirma outro recebimento")) || "";
ok(/Este cliente recebeu R\$ 40,00 às \d\d:\d\d por Ana Souza\. Confirma outro recebimento\?/.test(nb(perg)) && nb(perg).includes("Em aberto agora: R$ 60,00"),
  `Beto recebe o aviso com o saldo novo: "${nb(perg).split("\n")[0]}" (em aberto agora R$ 60,00)`);
ok(await recebido() === 80, "Beto confirmou: dois recebimentos (R$ 80), saldo R$ 20");
// recusar: nada é abatido
const [, infoDono] = await Promise.all([abrirReceber(A), abrirReceber(dono)]);
ok(infoDono.includes("R$ 20,00"), "o saldo é lido do servidor ao abrir Receber (R$ 20,00)");
await receber(A, 10);
await A.page.waitForSelector("#modal-receber", { state: "hidden" });
dono.recusar = true; dono.msgs.length = 0;
await receber(dono, 10);
await dono.page.waitForSelector("#modal-receber", { state: "hidden" });
ok(dono.msgs.some((m) => m.includes("por Ana Souza")) && await recebido() === 90, "dono recusa o segundo recebimento: nada abatido em dobro (recebido R$ 90, saldo R$ 10)");
// 3 aparelhos recebendo ao mesmo tempo pela API, sem confirmar: só o primeiro passa
const tokens = {};
for (const [ap, f, pin] of [[A, ana, "1234"], [B, beto, "5678"]]) tokens[ap.nome] = (await api("sessao", { m: "POST", h: {}, b: { id: f.id, pin } })).corpo.token;
const visto = (await lanc()).filter((l) => l.conta === "recebimento" && l.clienteId === cli.id).map((l) => l.criadoEm).sort().at(-1);
const rec = (id) => ({ itens: [{ id, v: 2, conta: "recebimento", value: 5, competencia: hoje, description: "r", clienteId: cli.id, cliente: cli.nome, pagamentos: [{ forma: "dinheiro", valor: 5 }], ultimoRecebimentoVisto: visto }] });
const rs = await Promise.all([api("lancamento", { m: "POST", b: rec("RX1") }), api("lancamento", { m: "POST", h: { "x-sessao": tokens.Ana }, b: rec("RX2") }), api("lancamento", { m: "POST", h: { "x-sessao": tokens.Beto }, b: rec("RX3") })]);
ok(rs.filter((r) => r.status === 200).length === 1 && rs.filter((r) => r.status === 409 && r.corpo.recebidoRecente).length === 2 && await recebido() === 95,
  "3 aparelhos recebendo juntos (mesmo saldo lido): só 1 grava; os outros 2 recebem o aviso");

// 3. Editar o mesmo cliente em dois aparelhos
const editar = async (ap) => { await ap.page.evaluate(() => window.Clientes.carregar()); await abrirFicha(ap.page, "Dona Rosa"); await ap.page.click("#cli-editar"); await ap.page.waitForSelector("#modal-cliente", { state: "visible" }); };
await Promise.all([editar(A), editar(dono)]);
await A.page.fill("#cli-endereco", "Rua da Ana, 1"); await A.page.click("#cli-salvar");
await A.page.waitForSelector("#modal-cliente", { state: "hidden" });
dono.msgs.length = 0;
await dono.page.fill("#cli-endereco", "Rua do Dono, 2"); await dono.page.click("#cli-salvar");
await dono.page.waitForTimeout(600);
const cRosa = JSON.parse((await db()).madeireira_clientes[cli.id]);
ok(dono.msgs.some((m) => /alterado por Ana Souza às \d\d:\d\d\. Recarregue/.test(m)) && cRosa.endereco === "Rua da Ana, 1", "editar o mesmo cliente: o segundo recebe \"alterado por Ana Souza às HH:MM. Recarregue\" e não apaga o que ela salvou");
await dono.page.click("#cli-cancelar");

// 4. Orçamento virando venda em 3 aparelhos ao mesmo tempo
const orc = (await api("orcamentos", { m: "POST", b: { orcamento: { cliente: { nome: "Seu Tião", telefone: "47999991234" }, origem: "balcao", itens: [{ itemId: "PINUS|1x2x2.50", acabamento: "BRUTO", quantidade: 2, vendaTotal: 20, precoTabela: 10 }], total: 20 } } })).corpo.orcamento;
const conv = (id) => ({ itens: [{ id, v: 2, conta: "venda_produtos", value: 20, competencia: hoje, description: "conv", orcamento: orc.id, pagamentos: [{ forma: "dinheiro", valor: 20 }], itens: [{ itemId: "PINUS|1x2x2.50", acabamento: "BRUTO", quantidade: 2, vendaTotal: 20 }] }] });
const cs = await Promise.all([api("lancamento", { m: "POST", b: conv("CONV1") }), api("lancamento", { m: "POST", h: { "x-sessao": tokens.Ana }, b: conv("CONV2") }), api("lancamento", { m: "POST", h: { "x-sessao": tokens.Beto }, b: conv("CONV3") })]);
const venceu = cs.find((r) => r.status === 200);
const numConv = venceu && Object.values(venceu.corpo.numeros)[0];
ok(cs.filter((r) => r.status === 200).length === 1 && cs.filter((r) => r.status === 409 && r.corpo.error.includes(`já virou a venda ${numConv}`)).length === 2
  && (await lanc()).filter((l) => l.orcamento === orc.id).length === 1, `orçamento virando venda em 3 aparelhos: só um consegue (${numConv}); os outros: "já virou a venda ${numConv}"`);

// 5. Cliente novo num aparelho aparece na busca dos outros na hora
await B.page.evaluate(() => window.Clientes.salvar({ nome: "Cliente do Beto", telefone: "(47) 97777-0001" }));
await A.page.click("#btn-tab-vender");
await add(A.page, 1); // o bloco Cliente aparece com o pedido
await A.page.focus("#cp-nome");
await A.page.waitForFunction(() => [...document.querySelectorAll("#clientes-lista option")].some((o) => o.value === "Cliente do Beto"), null, { timeout: 5000 }).catch(() => {});
ok(await A.page.evaluate(() => [...document.querySelectorAll("#clientes-lista option")].some((o) => o.value === "Cliente do Beto")), "cliente cadastrado pelo Beto aparece na busca da Ana ao começar a digitar");
await A.page.fill("#cp-nome", "Cliente do Beto"); await A.page.dispatchEvent("#cp-nome", "change");
ok(nb(await A.page.textContent("#cp-status")).includes("Cliente cadastrado"), "e a Ana já consegue vincular");
await A.page.click("#cp-limpar");
await A.page.evaluate(() => window.Calculadora.limpar(false));

// 6. Dono fechando a gaveta enquanto um funcionário vende
await dono.page.click("#btn-tab-caixa"); await dono.page.click('.subtabs[data-grupo="caixa"] .subtab[data-sub="saldos"]');
await dono.page.click('[data-conferir="gaveta"]');
await dono.page.waitForSelector("#modal-pergunta", { state: "visible" });
const esperado1 = Number(nb(await dono.page.textContent("#perg-texto")).replace(/[^\d,]/g, "").replace(",", "."));
await vender(B, 5); // R$ 50 em dinheiro enquanto o dono conta
dono.msgs.length = 0;
await dono.page.fill("#perg-campo", String(esperado1 + 50).replace(".", ","));
await dono.page.click("#perg-ok");
await dono.page.waitForTimeout(800);
const conf = Object.values((await db()).madeireira_conferencias || {}).map((x) => typeof x === "string" ? JSON.parse(x) : x).at(-1);
ok(dono.msgs.some((m) => nb(m).includes("Enquanto você contava") && nb(m).includes("R$ 50,00")) && Math.abs(conf.calculado - (esperado1 + 50)) < 0.01 && Math.abs(conf.diferenca) < 0.01,
  "fechar gaveta: a venda do Beto durante a contagem entra no esperado (aviso), e a contagem bate");
await dono.page.click('.subtabs[data-grupo="caixa"] .subtab[data-sub="lista"]');
const vBeto = (await lanc()).filter((l) => l.vendedor?.nome === "Beto").sort((a, b) => b.criadoEm.localeCompare(a.criadoEm))[0];
ok(nb(await dono.page.textContent("#fin-lista-body")).includes(vBeto.numero), `a venda ${vBeto.numero} do Beto continua no Caixa do dono`);

// 7. Internet caindo num aparelho
const antesQueda = (await lanc()).length;
// 7a. sem conexão: nada chega ao servidor
await A.page.route("**/api/lancamento", (r) => r.abort("internetdisconnected"));
A.msgs.length = 0;
await add(A.page, 2); await A.page.click("#btn-registrar-venda");
await A.page.waitForTimeout(500);
ok(A.msgs.some((m) => m.startsWith("Não foi salvo")) && (await lanc()).length === antesQueda, "sem internet: \"Não foi salvo\" e nada gravado");
await vender(B, 1); // Beto segue vendendo normalmente
ok((await lanc()).length === antesQueda + 1, "o Beto segue vendendo normalmente");
// 7b. a venda chega ao servidor mas a resposta se perde; nova tentativa não duplica
await A.page.unroute("**/api/lancamento");
await A.page.route("**/api/lancamento", async (r) => { if (r.request().method() === "POST") { await r.fetch(); return r.abort("connectionreset"); } return r.continue(); });
A.msgs.length = 0;
await A.page.click("#btn-registrar-venda");
await A.page.waitForTimeout(500);
const depoisQueda = (await lanc()).filter((l) => l.conta === "venda_produtos");
ok(A.msgs.some((m) => m.startsWith("Não foi salvo")) && depoisQueda.length === vendas.length + 1 + 2 + 1 + 1, "resposta perdida: aviso \"Não foi salvo\" (a venda chegou ao servidor)");
await A.page.unroute("**/api/lancamento");
await A.page.click("#btn-registrar-venda");
await fecharVias(A.page, A.msgs);
const final = (await lanc()).filter((l) => l.conta === "venda_produtos");
const nFinal = final.map((l) => Number(l.numero.slice(2))).sort((a, b) => a - b);
ok(final.length === depoisQueda.length && nFinal.every((n, i) => n === i + 1), `nova tentativa: não duplica (${final.length} vendas, V-0001 a V-${String(nFinal.at(-1)).padStart(4, "0")} sem repetir nem pular)`);

await browser.close();
