// Fase 2C: venda fiado (Vender e Caixa › Lançar), A receber, recebimento parcial em cheque,
// cheque devolvido reabrindo a dívida, estorno, cadastro de clientes, cobrança no WhatsApp, relatório.
import { createRequire } from "node:module";
const require = createRequire("/opt/node-tools/node_modules/");
const { chromium } = require("playwright");
const URL = "http://localhost:4321";
const H = { "content-type": "application/json", "x-senha": "pinho123" };
const nb = (s) => (s || "").replace(/ /g, " ");
const ok = (cond, msg) => { console.log((cond ? "OK   " : "FALHA") + " " + msg); if (!cond) process.exitCode = 1; };
const lanc = async () => Object.values((await (await fetch(URL + "/__db")).json()).madeireira_lancamentos || {}).map((x) => JSON.parse(x)).filter((l) => !l.excluido);

await fetch(URL + "/api/migrar", { method: "POST", headers: H });
await fetch(URL + "/api/migrar?versao=2", { method: "POST", headers: H });
await fetch(URL + "/api/config", { method: "POST", headers: H, body: JSON.stringify({ abertura: { data: "2026-10-01", contas: { gaveta: 300, bradesco: 1000, picpay: 0, cheques_carteira: 0 } } }) });
await fetch(URL + "/api/precos", { method: "POST", headers: H, body: JSON.stringify({ alteracoes: { "PINUS|2x4x3.00|BRUTO": 25 } }) });

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 }, locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
const page = await ctx.newPage();
await page.clock.install({ time: new Date("2026-10-10T10:00:00-03:00") });
const dialogos = [];
const respostas = [];
page.on("dialog", async (d) => { dialogos.push(d.message()); d.type() === "prompt" ? await d.accept(respostas.shift() ?? "") : await d.accept(); });
page.on("pageerror", (e) => console.log("ERRO JS:", e.message));
const sub = (g, s) => page.click(`.subtabs[data-grupo="${g}"] .subtab[data-sub="${s}"]`);
const irReceber = async () => { await page.click("#btn-tab-caixa"); await sub("caixa", "receber"); await page.waitForSelector("#fin-receber .receber-cards"); };
const card = async (rotulo) => nb(await page.locator(`#fin-receber .receber-cards .total-bloco:has(> span:text-is("${rotulo}"))`).locator("strong").textContent());
const linhaZe = () => page.locator("#fin-receber tr[data-chave]", { hasText: "Zé da Obra" });

await page.goto(URL);
await page.fill("#senha-input", "pinho123"); await page.click("#senha-form button");
await page.waitForFunction(() => document.getElementById("catalogo-status").textContent.includes("itens"));
await page.waitForFunction(() => window.Caixa && window.Caixa.migradoV2);

// 1. Venda fiado pela aba Vender, cliente novo sem WhatsApp
await page.selectOption("#material", "PINUS"); await page.selectOption("#dimension", "PINUS|2x4x3.00");
await page.fill("#quantity-pieces", "10"); await page.click("#btn-adicionar");
await page.locator("#calc-pagamentos .pag-forma").first().selectOption("fiado");
ok(await page.isVisible("#calc-pagamentos .pag-fiado-cliente"), "forma Fiado pede o cliente");
ok(await page.inputValue("#calc-pagamentos .pag-fiado-venc") === "2026-11-09", "vencimento sugerido: data + 30 dias (09/11/2026)");
await page.click("#btn-registrar-venda");
await page.waitForTimeout(200);
ok(dialogos.at(-1).includes("Informe o cliente"), "sem cliente, o fiado não é registrado");
await page.fill("#calc-pagamentos .pag-fiado-cliente", "Zé da Obra");
respostas.push(""); // WhatsApp: em branco
await page.click("#btn-registrar-venda");
await page.waitForFunction(() => document.querySelectorAll("#items-body tr.linha-item").length === 0);
ok(dialogos.some((d) => d.includes('"Zé da Obra" não está no cadastro')), "cliente novo: pergunta se quer cadastrar");
const v1 = (await lanc()).find((l) => l.origem === "calculadora");
ok(v1 && v1.clienteId === "C1" && v1.cliente === "Zé da Obra" && v1.pagamentos[0].forma === "fiado" && v1.pagamentos[0].fiado.vencimento === "2026-11-09" && v1.cmv > 0,
  "venda fiado gravada: cliente C1 (sem WhatsApp), vencimento 09/11, com CMV");
ok(nb(dialogos.at(-1)).includes("Fiado: R$ 250,00 a receber de Zé da Obra"), "aviso da venda diz quanto ficou a receber");

// 2. Venda fiado pelo Caixa › Lançar, já vencida
await page.click("#btn-tab-caixa");
await page.fill("#ff-valor", "100"); await page.dispatchEvent("#ff-valor", "input");
await page.fill("#ff-data", "2026-09-20");
await page.fill("#ff-cliente", "ze da obra");
await page.locator("#ff-pagamentos .pag-forma").first().selectOption("fiado");
await page.fill("#ff-pagamentos .pag-fiado-venc", "2026-10-05"); await page.dispatchEvent("#ff-pagamentos .pag-fiado-venc", "change");
await page.click("#fin-form button[type=submit]");
await page.waitForTimeout(500);
const v2 = (await lanc()).find((l) => l.value === 100 && l.conta === "venda_produtos");
ok(v2 && v2.clienteId === "C1" && v2.pagamentos[0].fiado.vencimento === "2026-10-05", "Lançar: venda fiado acha o cliente pelo nome (sem acento/maiúsculas) e grava o vencimento combinado");

// 3. A receber
await irReceber();
ok(await card("A receber (fiado)") === "R$ 350,00" && await card("Atrasado") === "R$ 100,00" && await card("Total na rua") === "R$ 350,00", "cartões: a receber R$ 350, atrasado R$ 100, na rua R$ 350");
ok(nb(await linhaZe().textContent()).includes("5 dia(s)"), "Zé: maior atraso 5 dias (venceu 05/10)");
ok((await linhaZe().getAttribute("class")).includes("cor-vermelho"), "cliente com atraso fica em vermelho");
ok(nb(await linhaZe().textContent()).includes("sem WhatsApp"), "sem WhatsApp: não mostra Cobrar");

// 4. Recebimento parcial em cheque
await linhaZe().locator('[data-rc="receber"]').click();
ok(await page.inputValue("#rc-valor") === "350.00", "Receber já vem com o total em aberto");
await page.fill("#rc-valor", "150"); await page.dispatchEvent("#rc-valor", "input");
ok(!(await page.locator("#rc-pagamentos .pag-forma option[value=fiado]").count()), "recebimento não oferece Fiado como forma");
await page.locator("#rc-pagamentos .pag-forma").first().selectOption("cheque");
await page.fill('#rc-pagamentos .pag-ch[data-campo="numero"]', "123"); await page.dispatchEvent('#rc-pagamentos .pag-ch[data-campo="numero"]', "change");
await page.fill('#rc-pagamentos .pag-ch[data-campo="compensacao"]', "2026-10-20"); await page.dispatchEvent('#rc-pagamentos .pag-ch[data-campo="compensacao"]', "change");
await page.click("#rc-receber-form button[type=submit]");
await page.waitForFunction(() => document.getElementById("modal-receber").style.display === "none");
await page.waitForTimeout(300);
ok(nb(dialogos.at(-1)).includes("Recebido R$ 150,00 de Zé da Obra") && nb(dialogos.at(-1)).includes("Ainda em aberto: R$ 200,00"), "recebimento parcial: resta R$ 200");
ok(await card("A receber (fiado)") === "R$ 200,00" && await card("Atrasado") === "R$ 0,00" && await card("Cheques em carteira") === "R$ 150,00" && await card("Total na rua") === "R$ 350,00",
  "abate a mais antiga (a vencida): atrasado zera; cheque de R$ 150 na carteira; na rua continua R$ 350");
const rec = (await lanc()).find((l) => l.conta === "recebimento");
ok(rec && rec.clienteId === "C1" && rec.pagamentos[0].conta === "cheques_carteira", "recebimento gravado (conta recebimento, cheque na carteira)");

// 5. Cheque devolvido reabre a dívida
await sub("caixa", "cheques");
const linhaCh = page.locator("#fin-cheques tr", { hasText: "123" });
ok(nb(await linhaCh.textContent()).includes("Zé da Obra"), "cheque do recebimento aparece em Cheques com o cliente");
respostas.push("2026-10-21");
await linhaCh.locator("[data-ch-devolver]").click();
await page.waitForTimeout(500);
await irReceber();
ok(await card("A receber (fiado)") === "R$ 350,00" && await card("Cheques em carteira") === "R$ 0,00", "cheque devolvido: a dívida volta a R$ 350 e sai da carteira");
await linhaZe().locator('[data-rc="ver"]').click();
ok(nb(await page.textContent("#fin-receber .receber-detalhe")).includes("Cheque devolvido nº 123"), "detalhe mostra o cheque devolvido como dívida");

// 6. Estornar o recebimento
await page.locator("#fin-receber [data-rc-estornar]").first().click();
await page.waitForTimeout(600);
await irReceber();
ok(await card("A receber (fiado)") === "R$ 350,00" && !(await lanc()).some((l) => l.conta === "recebimento"), "estornar recebimento: some e a conta volta a ficar como antes do recebimento (R$ 350)");

// 7. Recebimento total em dinheiro: quita e entra na gaveta
await linhaZe().locator('[data-rc="receber"]').click();
await page.click("#rc-receber-form button[type=submit]");
await page.waitForFunction(() => document.getElementById("modal-receber").style.display === "none");
await page.waitForTimeout(300);
ok(nb(dialogos.at(-1)).includes("Quitado!"), "recebimento total: quitado");
ok((await page.locator("#fin-receber tr[data-chave]").count()) === 0, "quem pagou tudo sai da lista (dá para ver marcando 'quitados')");
await sub("caixa", "saldos");
ok(nb(await page.locator(".saldo-conta", { hasText: "Gaveta" }).locator("strong").textContent()) === "R$ 650,00", "gaveta: 300 da abertura + 350 recebidos (a venda fiado não mexeu no caixa)");

// 8. Cadastro: dar WhatsApp ao Zé e cobrar
// Compra nova depois de quitar (12/10, vence 31/10); hoje passa a ser 05/11
const venda3 = { id: "F3V", v: 2, conta: "venda_produtos", value: 80, competencia: "2026-10-12", clienteId: "C1", cliente: "Zé da Obra", pagamentos: [{ forma: "fiado", valor: 80, fiado: { vencimento: "2026-10-31" } }] };
await fetch(URL + "/api/lancamento", { method: "POST", headers: H, body: JSON.stringify({ itens: [venda3] }) });
await page.clock.setFixedTime(new Date("2026-11-05T10:00:00-03:00"));
await page.reload();
await page.waitForFunction(() => window.Caixa && window.Caixa.migradoV2);
await irReceber();
ok(await card("A receber (fiado)") === "R$ 80,00" && await card("Atrasado") === "R$ 80,00", "compra nova depois de quitar: só ela fica em aberto (a paga não reabre)");
await page.locator('label:has(input[name="rc-visao"][value="clientes"])').click();
await page.locator("#fin-receber tr", { hasText: "Zé da Obra" }).locator("[data-rc-editar]").click();
await page.fill("#rc-cli-tel", "(47) 98888-7777");
await page.click("#rc-cliente-form button[type=submit]");
await page.waitForTimeout(500);
const cli = JSON.parse((await (await fetch(URL + "/__db")).json()).madeireira_clientes.C1);
ok(cli.telefone === "(47) 98888-7777" && cli.id === "C1", "editar cliente: ganhou WhatsApp e manteve o código C1");
await page.locator('label:has(input[name="rc-visao"][value="dividas"])').click();
await ctx.route("https://wa.me/**", (r) => r.fulfill({ contentType: "text/html", body: "<p>WhatsApp (simulado)</p>" })); // sem internet no ensaio
const [aba] = await Promise.all([ctx.waitForEvent("page"), linhaZe().locator('[data-rc="cobrar"]').click()]);
await aba.waitForLoadState("domcontentloaded").catch(() => {});
const url = decodeURIComponent(aba.url());
ok(url.startsWith("https://wa.me/5547988887777") && url.includes("Consta em aberto R$ 80,00") && url.includes("12/10/2026 – R$ 80,00 (venceu 31/10/2026)"), "Cobrar 💬 abre o WhatsApp com o que está em aberto");
await aba.close();

// 9. Novo cliente pelo cadastro (com WhatsApp)
await page.locator('label:has(input[name="rc-visao"][value="clientes"])').click();
await page.fill("#rc-cli-nome", "Ana Lima"); await page.fill("#rc-cli-tel", "47999990000");
await page.click("#rc-cliente-form button[type=submit]");
await page.waitForTimeout(400);
ok(nb(await page.textContent("#rc-conteudo")).includes("Ana Lima"), "cadastrar cliente novo pela tela de clientes");

// 10. Relatórios › A receber, DRE e Lançamentos
await page.click("#btn-tab-relatorios"); await sub("relatorios", "receber");
const rel = nb(await page.textContent("#rel-receber"));
ok(rel.includes("Zé da Obra") && rel.includes("Total na ruaR$ 80,00"), "Relatórios › A receber: por cliente e total na rua");
await sub("relatorios", "dre");
await page.fill("#rel-mes", "2026-10"); await page.dispatchEvent("#rel-mes", "change");
ok(nb(await page.textContent("#fin-dre-conteudo")).includes("R$ 330,00"), "DRE de outubro: as vendas fiado entram na receita (250 + 80 = R$ 330); o recebimento não conta de novo");
await page.click("#btn-tab-caixa"); await sub("caixa", "lista");
await page.selectOption("#fin-f-tipo", "fiado");
const lista = nb(await page.textContent("#fin-lista-body"));
ok(lista.includes("Recebimento de fiado") && lista.includes("Fiado (a receber)"), "Lançamentos › 'Fiado e recebimentos' mostra vendas fiado e recebimentos");

// 11. Desligar o fiado nos Ajustes
await page.click("#btn-tab-ajustes"); await sub("ajustes", "financeiro");
await page.uncheck("#cfg-fiado-ligado");
await page.click("#fin-config-form button[type=submit]");
await page.waitForTimeout(400);
await page.click("#btn-tab-vender");
await page.selectOption("#material", "PINUS"); await page.selectOption("#dimension", "PINUS|2x4x3.00");
await page.fill("#quantity-pieces", "1"); await page.click("#btn-adicionar");
ok(!(await page.locator("#calc-pagamentos .pag-forma option[value=fiado]").count()), "fiado desligado: a forma some das vendas");
await page.screenshot({ path: "fiado.png", fullPage: true });
await browser.close();
