// Pagamento em vários cheques (Receber e Vender): "+ adicionar cheque", "Dividir em cheques" (valores iguais, centavos
// no último, datas a cada X dias), emitente com o nome do cliente, faltam/sobram, sobra vira crédito; cheques na
// carteira; Caixa › Cheques com Depositado (informação) e Compensou; Relatórios › Dia "Cheque (N cheques)".
import { createRequire } from "node:module";
const require = createRequire("/opt/node-tools/node_modules/");
const { chromium } = require("playwright");
import { fecharVias } from "./janela.mjs";
const URL = "http://localhost:4321";
const H = { "content-type": "application/json", "x-senha": "pinho123" };
const nb = (s) => (s || "").replace(/ /g, " ").replace(/\s+/g, " ");
const ok = (cond, msg) => { console.log((cond ? "OK   " : "FALHA") + " " + msg); if (!cond) process.exitCode = 1; };
const lanc = async () => Object.values((await (await fetch(URL + "/__db")).json()).madeireira_lancamentos || {}).map((x) => JSON.parse(x)).filter((l) => !l.excluido);
const api = async (nome, { m = "GET", b } = {}) => (await fetch(URL + "/api/" + nome, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined })).json();

const cli = (await api("clientes", { m: "POST", b: { cliente: { nome: "Construtora Silva", telefone: "(47) 98888-1000" } } })).cliente;
await api("precos", { m: "POST", b: { alteracoes: { "PINUS|2x4x3.00|BRUTO": 100 } } });
await api("lancamento", { m: "POST", b: { itens: [{ id: "S1", v: 2, conta: "venda_produtos", value: 3980, competencia: "2026-11-01", description: "Venda", clienteId: cli.id, cliente: cli.nome, pagamentos: [{ forma: "fiado", valor: 3980 }] }] } });

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 }, locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
const page = await ctx.newPage();
await page.clock.install({ time: new Date("2026-11-12T10:00:00-03:00") });
const dialogos = [];
page.on("dialog", async (d) => { dialogos.push(nb(d.message())); await d.accept(); });
page.on("pageerror", (e) => console.log("ERRO JS:", e.message));
await page.goto(URL);
await page.fill("#senha-input", "pinho123"); await page.click("#senha-form button");
await page.waitForFunction(() => window.Caixa && window.Caixa.itens.length >= 1 && document.getElementById("catalogo-status").textContent.includes("itens"));
await page.evaluate(() => window.Clientes.carregar());
const sub = (g, s) => page.click(`.subtabs[data-grupo="${g}"] .subtab[data-sub="${s}"]`);

// 1. Receber: dívida de R$ 3.980 paga com 4 cheques de R$ 1.000 (sobram R$ 20 → crédito)
await page.click("#btn-tab-caixa"); await sub("caixa", "receber");
await page.locator("#rc-tabela tr[data-chave]", { hasText: "Construtora Silva" }).locator('[data-rc="receber"]').click();
await page.waitForSelector("#modal-receber", { state: "visible" });
const rp = "#rc-pagamentos";
await page.click(`${rp} .pag-dividir`);
ok(await page.inputValue(`${rp} .pag-div[data-campo="total"]`) === "3980.00" && await page.inputValue(`${rp} .pag-div[data-campo="qtd"]`) === "4", "Dividir em cheques: total vem com o valor (R$ 3.980) e 4 cheques");
await page.fill(`${rp} .pag-div[data-campo="primeira"]`, "2026-12-10");
await page.click(`${rp} .pag-div-gerar`);
let linhas = await page.$$eval(`${rp} .pag-linha`, (ls) => ls.map((l) => [l.querySelector(".pag-forma").value, l.querySelector(".pag-valor").value, l.querySelector('[data-campo="compensacao"]')?.value, l.querySelector('[data-campo="emissor"]')?.value]));
ok(linhas.length === 4 && linhas.every((l) => l[0] === "cheque" && l[1] === "995.00" && l[3] === "Construtora Silva") && linhas.map((l) => l[2]).join() === "2026-12-10,2027-01-09,2027-02-08,2027-03-10",
  `gerou 4 cheques de R$ 995 a cada 30 dias, emitente com o nome do cliente (${linhas.map((l) => l[2]).join(" ")})`);
ok(nb(await page.textContent(`${rp} .pag-status`)).includes("Soma confere") && nb(await page.textContent(`${rp} .pag-status`)).includes("4 cheques R$ 3.980,00"), "soma confere · 4 cheques");
// o cliente pagou com 4 cheques de R$ 1.000: valor recebido 4.000
await page.fill("#rc-valor", "4000"); await page.dispatchEvent("#rc-valor", "input");
ok(nb(await page.textContent(`${rp} .pag-status`)).includes("Faltam R$ 20,00"), "valor maior: \"Faltam R$ 20,00\" até fechar");
await page.click(`${rp} .pag-dividir`);
await page.fill(`${rp} .pag-div[data-campo="primeira"]`, "2026-12-10");
await page.click(`${rp} .pag-div-gerar`);
linhas = await page.$$eval(`${rp} .pag-linha`, (ls) => ls.map((l) => l.querySelector(".pag-valor").value));
ok(linhas.join() === "1000.00,1000.00,1000.00,1000.00", "dividir de novo: substitui os cheques (4 × R$ 1.000)");
// números e banco; um cheque de terceiro
const chInput = (i, campo) => page.locator(`${rp} .pag-linha`).nth(i).locator(`.pag-ch[data-campo="${campo}"]`);
for (let i = 0; i < 4; i++) { await chInput(i, "numero").fill(String(101 + i)); await chInput(i, "numero").dispatchEvent("change"); await chInput(i, "banco").fill("Sicoob"); await chInput(i, "banco").dispatchEvent("change"); }
await chInput(3, "emissor").fill("Fulano (terceiro)"); await chInput(3, "emissor").dispatchEvent("change");
// sobra: pergunta crédito
await page.click("#rc-receber-form button[type=submit]");
await page.waitForFunction(() => document.getElementById("modal-receber").style.display === "none");
await page.waitForTimeout(400);
ok(dialogos.some((d) => d.includes("Sobram R$ 20,00") && d.includes("Guardar como crédito")) && dialogos.some((d) => d.includes("Crédito do cliente: R$ 20,00")), "sobram R$ 20: pergunta e guarda como crédito");
const rec = (await lanc()).find((l) => l.conta === "recebimento");
ok(rec && rec.value === 4000 && rec.pagamentos.length === 4 && rec.pagamentos.every((p) => p.forma === "cheque" && p.conta === "cheques_carteira" && p.cheque.banco === "Sicoob")
  && rec.pagamentos[3].cheque.emissor === "Fulano (terceiro)" && rec.pagamentos[1].cheque.compensacao === "2027-01-09", "gravado: 4 cheques na carteira, cada um com bom para, banco, número e emitente");
ok(nb(await page.locator('.receber-cards .total-bloco:has(> span:text-is("Cheques em carteira"))').locator("strong").textContent()) === "R$ 4.000,00", "Cheques em carteira: R$ 4.000 (não entra no Bradesco nem na gaveta)");

// 2. Relatórios › Dia: "Recebimento de fiado · Cheque (4 cheques)"
await page.click("#btn-tab-relatorios"); await sub("relatorios", "dia");
await page.waitForSelector("#dia-lista", { state: "attached" });
ok(nb(await page.textContent("#dia-lista")).includes("Recebimento de fiado") && nb(await page.textContent("#dia-lista")).includes("Cheque (4 cheques)"), "Dia: Recebimento de fiado · Cheque (4 cheques)");

// 3. Caixa › Cheques: Depositado (só informação) e Compensou (entra no Bradesco)
await page.click("#btn-tab-caixa"); await sub("caixa", "cheques");
const linhaCh = (n) => page.locator("#fin-cheques tr", { hasText: String(n) }).first();
await linhaCh(101).locator("[data-ch-depositar]").click();
await page.waitForSelector("#modal-pergunta", { state: "visible" }); await page.click("#perg-ok");
await page.waitForTimeout(500);
ok(nb(await linhaCh(101).textContent()).includes("depositado 12/11/2026"), "Depositado: marca a data (o cheque continua em carteira)");
await sub("caixa", "saldos");
const bradesco = async () => nb(await page.locator(".saldo-conta", { hasText: "Bradesco" }).locator("strong").first().textContent());
const b0 = await bradesco();
await sub("caixa", "cheques");
await linhaCh(102).locator("[data-ch-compensou]").click();
await page.waitForSelector("#modal-pergunta", { state: "visible" }); await page.click("#perg-ok");
await page.waitForTimeout(500);
await page.selectOption("#ch-f-rec", "todos");
ok(nb(await linhaCh(102).textContent()).includes("compensado"), "Compensou: o cheque passa a compensado");
await sub("caixa", "saldos");
const b1 = await bradesco();
const val = (t) => Number(t.replace(/[^\d,-]/g, "").replace(",", "."));
ok(val(b1) - val(b0) === 1000, `Bradesco: +R$ 1.000 com o cheque compensado (${b0} → ${b1})`);
ok(nb(await page.textContent("#fin-saldos")).includes("10/12/2026") || nb(await page.textContent("#fin-saldos")).includes("Cheque"), "projeção de 30 dias mostra os cheques a compensar por data");

// 4. Ficha: os 4 cheques com a situação de cada um
await sub("caixa", "receber");
await page.locator("#rc-tabela tr[data-chave]", { hasText: "Construtora Silva" }).locator("td").first().click().catch(() => {});
await page.click('#rc-quitados').catch(() => {});
await page.locator("#rc-tabela tr[data-chave]", { hasText: "Construtora Silva" }).locator("td").first().click().catch(() => {});
await page.waitForSelector("#rc-pagamentos-hist");
const hist = nb(await page.textContent("#rc-pagamentos-hist"));
ok(hist.includes("4 cheques R$ 4.000,00") && hist.includes("nº 101") && hist.includes("depositado") && hist.includes("compensado") && hist.includes("em carteira") && hist.includes("Fulano (terceiro)"),
  "ficha: cada cheque com a situação (depositado · compensado · em carteira) e o emitente");

// 5. Vender: venda à vista em 3 cheques (R$ 1.000 → 333,33 + 333,33 + 333,34), emitente do bloco Cliente
await page.click("#btn-tab-vender");
await page.selectOption("#material", "PINUS"); await page.selectOption("#dimension", "PINUS|2x4x3.00");
await page.fill("#quantity-pieces", "10"); await page.click("#btn-adicionar");
await page.fill("#cp-nome", "construtora silva"); await page.dispatchEvent("#cp-nome", "change");
const vp = "#calc-pagamentos";
await page.click(`${vp} .pag-dividir`);
await page.fill(`${vp} .pag-div[data-campo="qtd"]`, "3"); await page.fill(`${vp} .pag-div[data-campo="primeira"]`, "2026-12-01");
await page.click(`${vp} .pag-div-gerar`);
const vl = await page.$$eval(`${vp} .pag-linha`, (ls) => ls.map((l) => [l.querySelector(".pag-valor").value, l.querySelector('[data-campo="emissor"]')?.value]));
ok(vl.map((l) => l[0]).join() === "333.33,333.33,333.34" && vl.every((l) => l[1] === "Construtora Silva"), "Vender: 3 cheques (centavos no último), emitente = cliente do pedido");
await page.click("#btn-registrar-venda");
await fecharVias(page, dialogos);
const venda = (await lanc()).find((l) => l.conta === "venda_produtos" && l.value === 1000);
ok(venda && venda.pagamentos.length === 3 && venda.pagamentos.every((p) => p.forma === "cheque" && p.conta === "cheques_carteira"), "venda à vista em 3 cheques: todos na carteira");
// + adicionar cheque e "bom para" obrigatório
await page.selectOption("#material", "PINUS"); await page.selectOption("#dimension", "PINUS|2x4x3.00");
await page.fill("#quantity-pieces", "1"); await page.click("#btn-adicionar");
await page.locator(`${vp} .pag-forma`).first().selectOption("pix_bradesco");
await page.locator(`${vp} .pag-valor`).first().fill("40"); await page.locator(`${vp} .pag-valor`).first().dispatchEvent("input");
await page.click(`${vp} .pag-add-cheque`);
ok(await page.locator(`${vp} .pag-linha`).nth(1).locator(".pag-valor").inputValue() === "60.00", "+ adicionar cheque: vem com o que falta (R$ 60)");
dialogos.length = 0;
await page.click("#btn-registrar-venda");
await page.waitForTimeout(400);
ok(dialogos.some((d) => d.includes("bom para")), "cheque sem \"bom para\": não registra e avisa");

await browser.close();
