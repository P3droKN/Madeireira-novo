// A receber organizado como a pasta de vias: lista por cliente (maior valor, pedidos, desde, último pagamento,
// etiquetas "sem prazo" / "atrasado N dias"), ficha do fiado (só em aberto e pago em parte; pagos em "Ver pedidos pagos";
// saldo anterior à virada; pagamentos com cheques, quem recebeu e o que quitou). A mesma tela no "Devendo" do funcionário.
import { createRequire } from "node:module";
const require = createRequire("/opt/node-tools/node_modules/");
const { chromium } = require("playwright");
const URL = "http://localhost:4321";
const H = { "content-type": "application/json", "x-senha": "pinho123" };
const nb = (s) => (s || "").replace(/ /g, " ").replace(/\s+/g, " ");
const ok = (cond, msg) => { console.log((cond ? "OK   " : "FALHA") + " " + msg); if (!cond) process.exitCode = 1; };
const api = async (nome, { m = "GET", b, h = H } = {}) => {
  const r = await fetch(URL + "/api/" + nome, { method: m, headers: { "content-type": "application/json", ...h }, body: b ? JSON.stringify(b) : undefined });
  return { status: r.status, corpo: await r.json().catch(() => null) };
};
const lanca = (itens) => api("lancamento", { m: "POST", b: { itens } });

const silva = (await api("clientes", { m: "POST", b: { cliente: { nome: "Construtora Silva", telefone: "(47) 98888-1000" } } })).corpo.cliente;
const rosa = (await api("clientes", { m: "POST", b: { cliente: { nome: "Dona Rosa", telefone: "(47) 98888-2000", contaCorrente: true } } })).corpo.cliente;
const v = (id, data, valor, cli) => ({ id, v: 2, conta: "venda_produtos", value: valor, competencia: data, description: `Venda ${id}`, clienteId: cli.id, cliente: cli.nome, pagamentos: [{ forma: "fiado", valor }] });
await lanca([{ id: "FA1", v: 2, conta: "fiado_anterior", value: 300, competencia: "2026-10-01", desde: "2026-08-15", clienteId: silva.id, cliente: silva.nome }]);
await lanca([v("S1", "2026-10-05", 500, silva)]); await lanca([v("S2", "2026-10-12", 400, silva)]); await lanca([v("S3", "2026-11-02", 700, silva)]);
await lanca([v("R1", "2026-11-03", 250, rosa)]);
// pagamento de R$ 1.000 em 2 cheques: quita o saldo anterior (300), a S1 (500) e R$ 200 da S2
await lanca([{ id: "REC1", v: 2, conta: "recebimento", value: 1000, competencia: "2026-11-05", description: "Recebimento de Construtora Silva", clienteId: silva.id, cliente: silva.nome,
  pagamentos: [{ forma: "cheque", valor: 500, cheque: { numero: "0012", banco: "Sicoob", emissor: "Construtora Silva", compensacao: "2026-12-05" } },
    { forma: "cheque", valor: 500, cheque: { numero: "0013", banco: "Sicoob", emissor: "Construtora Silva", compensacao: "2027-01-05" } }] }]);
const ana = (await api("funcionarios", { m: "POST", b: { funcionario: { nome: "Ana", pin: "1234" } } })).corpo.funcionario;

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
async function pagina(caminho, opcoes = {}, relogio = true) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 }, locale: "pt-BR", timezoneId: "America/Sao_Paulo", ...opcoes });
  const page = await ctx.newPage();
  if (relogio) await page.clock.install({ time: new Date("2026-11-20T10:00:00-03:00") }); // (a sessão do funcionário usa o relógio de verdade)
  page.on("dialog", (d) => d.accept());
  page.on("pageerror", (e) => console.log("ERRO JS:", e.message));
  await page.goto(URL + caminho);
  return page;
}
const page = await pagina("/");
await page.fill("#senha-input", "pinho123"); await page.click("#senha-form button");
await page.waitForFunction(() => window.Caixa && window.Caixa.itens.length >= 6);
await page.evaluate(() => window.Clientes.carregar());
await page.click("#btn-tab-caixa"); await page.click('.subtabs[data-grupo="caixa"] .subtab[data-sub="receber"]');
await page.waitForSelector("#rc-tabela tr[data-chave]");

// 1. Lista
const linhas = await page.$$eval("#rc-tabela tbody tr[data-chave]", (trs) => trs.map((tr) => tr.textContent.replace(/ /g, " ").replace(/\s+/g, " ")));
ok(linhas.length === 2 && linhas[0].includes("Construtora Silva") && linhas[1].includes("Dona Rosa"), "uma linha por cliente, do maior valor em aberto para o menor");
ok(linhas[0].includes("R$ 900,00") && / 2 /.test(linhas[0]) && linhas[0].includes("desde 12/10") && linhas[0].includes("05/11/2026") && linhas[0].includes("R$ 1.000,00"),
  `Silva: R$ 900 em aberto, 2 pedidos, desde 12/10, último pagamento 05/11 de R$ 1.000 (${linhas[0]})`);
ok(linhas[0].includes("atrasado 9 dias") && linhas[1].includes("sem prazo") && !linhas[1].includes("atrasado"), "etiquetas: \"atrasado N dias\" e \"sem prazo\"");
ok(nb(await page.textContent(".receber-cards")).includes("R$ 1.150,00"), "total geral a receber no topo (R$ 1.150)");
await page.fill("#rc-busca", "rosa");
ok((await page.locator("#rc-tabela tbody tr[data-chave]").count()) === 1, "busca por nome");
await page.fill("#rc-busca", "");

// 2. Ficha do fiado
await page.locator("#rc-tabela tr[data-chave]", { hasText: "Construtora Silva" }).locator("td").first().click();
await page.waitForSelector("#fin-receber .ficha-fiado #rc-pedidos");
const pedidos = await page.$$eval("#rc-pedidos tbody tr", (trs) => trs.map((tr) => tr.textContent.replace(/ /g, " ").replace(/\s+/g, " ")));
ok(pedidos.length === 2 && pedidos[0].includes("V-0002") && pedidos[0].includes("pago em parte") && pedidos[0].includes("R$ 200,00") && pedidos[0].includes("R$ 200,00")
  && pedidos[1].includes("V-0003") && pedidos[1].includes("em aberto"), `ficha: só o em aberto e o pago em parte, do mais antigo para o mais novo (${pedidos.join(" | ")})`);
const hist = nb(await page.textContent("#rc-pagamentos-hist"));
ok(hist.includes("2 cheques R$ 1.000,00") && hist.includes("Cheque nº 0012 R$ 500,00 · bom para 05/12/2026 · Sicoob · Construtora Silva · em carteira") && hist.includes("Dono"),
  "pagamento: 2 cheques, cada um com valor, bom para, banco, emitente e situação; quem recebeu");
ok(hist.includes("saldo anterior (R$ 300,00)") && hist.includes("V-0001 (R$ 500,00)") && hist.includes("parte da V-0002 (R$ 200,00)"), `o que o pagamento quitou (${hist.slice(hist.indexOf("Dono"), hist.indexOf("Dono") + 120)})`);
await page.click('[data-rc="pagos"]');
const todos = nb(await page.textContent("#rc-pedidos"));
ok(todos.includes("Saldo anterior à virada (desde 15/08)") && todos.includes("V-0001") && todos.includes("pago"), "Ver pedidos pagos: mostra os quitados, inclusive o saldo anterior à virada");
await page.click('[data-rc="voltar"]');
await page.waitForSelector("#rc-tabela");

// 3. Funcionário: Clientes › Devendo usa a mesma lista; clicar abre a ficha do cliente com o mesmo fiado
const f = await pagina("/funcionarios", { viewport: { width: 390, height: 844 } }, false);
await f.waitForFunction(() => document.querySelectorAll("#pin-nome option").length >= 2);
await f.selectOption("#pin-nome", ana.id); await f.fill("#pin-input", "1234"); await f.click("#pin-form button");
await f.waitForSelector("#modal-pin", { state: "hidden" });
await f.waitForFunction(() => window.Caixa && window.Caixa.itens.length >= 5);
await f.evaluate(() => window.Clientes.carregar());
await f.click("#btn-tab-orcamentos"); await f.click('#co-subtabs .subtab[data-co="clientes"]');
await f.locator('label:has(input[name="cli-filtro"][value="devendo"])').click();
await f.waitForSelector("#co-clientes #rc-tabela tr[data-chave]");
const lf = nb(await f.textContent("#co-clientes #rc-tabela"));
ok(lf.includes("Construtora Silva") && lf.includes("R$ 900,00") && lf.includes("desde 12/10") && lf.includes("Dona Rosa"), "funcionário: \"Devendo\" com a mesma lista (em aberto, pedidos, desde, último pagamento)");
await f.locator("#co-clientes #rc-tabela tr[data-chave]", { hasText: "Construtora Silva" }).locator("td").first().click();
await f.waitForSelector(".ficha-cliente #rc-pedidos");
ok(nb(await f.textContent(".ficha-cliente #rc-pedidos")).includes("pago em parte") && nb(await f.textContent(".ficha-cliente #rc-pagamentos-hist")).includes("2 cheques"), "funcionário: a ficha do cliente mostra os mesmos pedidos e pagamentos");
ok(!(await f.locator(".ficha-cliente [data-rc-estornar]").first().isVisible()), "funcionário não vê Estornar");
await f.click('.ficha-cliente [data-rc="pagos"]');
ok(nb(await f.textContent(".ficha-cliente #rc-pedidos")).includes("Saldo anterior à virada"), "funcionário: Ver pedidos pagos também");
ok(await f.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "celular: sem rolagem lateral na ficha");

await browser.close();
