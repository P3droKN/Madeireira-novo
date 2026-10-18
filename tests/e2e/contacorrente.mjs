// Conta corrente (clientes antigos e de confiança, a "pasta" de vias): fiado sem vencimento, nunca atrasado,
// "em aberto há X dias", alertas opcionais, A receber separado, 2 vias para a pasta, fiado anterior na abertura
// marcando o cliente e o recebido de fiado anterior como informação no DRE e no fluxo de caixa.
import { createRequire } from "node:module";
const require = createRequire("/opt/node-tools/node_modules/");
const { chromium } = require("playwright");
const URL = "http://localhost:4321";
const H = { "content-type": "application/json", "x-senha": "pinho123" };
const nb = (s) => (s || "").replace(/ /g, " ");
const ok = (cond, msg) => { console.log((cond ? "OK   " : "FALHA") + " " + msg); if (!cond) process.exitCode = 1; };
const db = async () => (await fetch(URL + "/__db")).json();
const lanc = async () => Object.values((await db()).madeireira_lancamentos || {}).map((x) => JSON.parse(x)).filter((l) => !l.excluido);
const clientes = async () => Object.values((await db()).madeireira_clientes || {}).map((x) => JSON.parse(x));

await fetch(URL + "/api/migrar", { method: "POST", headers: H });
await fetch(URL + "/api/migrar?versao=2", { method: "POST", headers: H });
await fetch(URL + "/api/config", { method: "POST", headers: H, body: JSON.stringify({ abertura: { data: "2026-10-01", contas: { gaveta: 300, bradesco: 1000, picpay: 0, cheques_carteira: 0 } } }) });
await fetch(URL + "/api/precos", { method: "POST", headers: H, body: JSON.stringify({ alteracoes: { "PINUS|2x4x3.00|BRUTO": 25 } }) });

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 }, locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
const page = await ctx.newPage();
await page.clock.install({ time: new Date("2026-10-10T10:00:00-03:00") });
// Impressão: guarda o que estava na folha em vez de abrir a janela do navegador
await page.addInitScript(() => { window.__impressoes = []; window.print = () => window.__impressoes.push(document.getElementById("impressao-via")?.innerText || ""); });
const dialogos = [];
const respostas = [];
page.on("dialog", async (d) => { dialogos.push(d.message()); d.type() === "prompt" ? await d.accept(respostas.shift() ?? "") : await d.accept(); });
page.on("pageerror", (e) => console.log("ERRO JS:", e.message));
const sub = (g, s) => page.click(`.subtabs[data-grupo="${g}"] .subtab[data-sub="${s}"]`);
const irReceber = async () => { await page.click("#btn-tab-caixa"); await sub("caixa", "receber"); await page.waitForSelector("#fin-receber .receber-cards"); };
const visao = (v) => page.locator(`label:has(input[name="rc-visao"][value="${v}"])`).click();
const impressoes = () => page.evaluate(() => window.__impressoes);

await page.goto(URL);
await page.fill("#senha-input", "pinho123"); await page.click("#senha-form button");
await page.waitForFunction(() => document.getElementById("catalogo-status").textContent.includes("itens"));
await page.waitForFunction(() => window.Caixa && window.Caixa.migradoV2);

// 1. Cadastro: Seu Arlindo, conta corrente com alerta de limite R$ 500 (dias em branco = sem alerta)
await irReceber();
await visao("clientes");
await page.waitForSelector("#rc-cli-cc");
ok(await page.locator("#rc-cli-limite").isHidden(), "alertas só aparecem com Conta corrente marcada");
await page.fill("#rc-cli-nome", "Seu Arlindo");
await page.check("#rc-cli-cc");
ok(await page.locator("#rc-cli-limite").isVisible(), "marcou Conta corrente: aparecem os alertas");
await page.fill("#rc-cli-limite", "500");
await page.click("#rc-cliente-form button[type=submit]");
await page.waitForFunction(() => document.getElementById("fin-receber").textContent.includes("Seu Arlindo"));
let arlindo = (await clientes()).find((c) => c.nome === "Seu Arlindo");
ok(arlindo?.contaCorrente === true && arlindo.alertaLimite === 500 && arlindo.alertaDias === null, "cadastro: conta corrente, limite R$ 500, sem alerta de dias");
ok(nb(await page.textContent("#fin-receber")).includes("Conta corrente") && nb(await page.textContent("#fin-receber")).includes("limite R$ 500,00"), "lista de clientes mostra o tipo e o alerta");

// 2. Abertura: fiado da pasta da Dona Cida (cliente novo), conta corrente já vem marcado
await page.click("#btn-tab-ajustes"); await sub("ajustes", "saldos");
await page.waitForSelector("#cx-ab-fiado");
ok(await page.isChecked("#cx-fa-cc") && await page.locator("#cx-fa-venc").isHidden(), "fiado anterior: Conta corrente vem marcado e o vencimento some");
await page.fill("#cx-fa-cliente", "Dona Cida"); await page.fill("#cx-fa-valor", "600");
respostas.push(""); // WhatsApp em branco
await page.click("#cx-ab-fiado button[type=submit]");
await page.waitForFunction(() => document.getElementById("aj-abertura").textContent.includes("Dona Cida"));
const fa = (await lanc()).find((l) => l.conta === "fiado_anterior");
ok(fa && fa.contaCorrente === true && !fa.vencimento && fa.value === 600, "fiado anterior gravado sem vencimento, como conta corrente");
ok((await clientes()).find((c) => c.nome === "Dona Cida")?.contaCorrente === true, "Dona Cida ficou marcada como conta corrente no cadastro");
ok(nb(await page.textContent("#aj-abertura")).includes("conta corrente"), "lista do fiado anterior mostra \"conta corrente\" no lugar da data");

// 3. Vender: fiado do Seu Arlindo, sem vencimento, com as 2 vias
await page.click("#btn-tab-vender");
await page.selectOption("#material", "PINUS"); await page.selectOption("#dimension", "PINUS|2x4x3.00");
await page.fill("#quantity-pieces", "10"); await page.click("#btn-adicionar");
await page.locator("#calc-pagamentos .pag-forma").first().selectOption("fiado");
await page.fill("#calc-pagamentos .pag-fiado-cliente", "Seu Arlindo"); await page.dispatchEvent("#calc-pagamentos .pag-fiado-cliente", "change");
ok(nb(await page.textContent("#calc-pagamentos")).includes("Conta corrente: sem vencimento") && !(await page.locator("#calc-pagamentos .pag-fiado-venc").count()), "cliente de conta corrente: sem campo de vencimento");
await page.click("#btn-registrar-venda");
await page.waitForFunction(() => document.querySelectorAll("#items-body tr.linha-item").length === 0);
const v1 = (await lanc()).find((l) => l.origem === "calculadora");
ok(v1 && v1.clienteId === arlindo.id && v1.pagamentos[0].fiado.contaCorrente === true && v1.pagamentos[0].fiado.vencimento === "", "venda gravada como conta corrente, sem vencimento");
ok(nb(dialogos.at(-1)).includes("imprimir as 2 vias para a pasta"), "pergunta se quer imprimir as 2 vias");
let imp = nb((await impressoes()).at(-1));
ok(imp.includes("Via da loja (pasta)") && imp.includes("Via do cliente") && imp.includes("Seu Arlindo") && imp.includes("R$ 250,00") && imp.includes("Assinatura"), "2 vias impressas: loja e cliente, com cliente, total e assinatura");
ok(!/custo|margem|CMV/i.test(imp), "a via não mostra custo nem margem");

// 4. Caixa › Lançar: fiado antigo do Seu Arlindo (20/08), passa do limite
await page.click("#btn-tab-caixa"); await sub("caixa", "lancar");
await page.fill("#ff-valor", "400"); await page.dispatchEvent("#ff-valor", "input");
await page.fill("#ff-data", "2026-08-20");
await page.locator("#ff-pagamentos .pag-forma").first().selectOption("fiado");
await page.fill("#ff-cliente", "seu arlindo"); await page.dispatchEvent("#ff-cliente", "change");
ok(nb(await page.textContent("#ff-pagamentos")).includes("Conta corrente: sem vencimento"), "Lançar: digitou cliente de conta corrente, o vencimento some");
await page.click("#fin-form button[type=submit]");
await page.waitForFunction(() => window.__impressoes.length === 2);
const v2 = (await lanc()).find((l) => l.value === 400 && l.conta === "venda_produtos");
ok(v2?.pagamentos[0].fiado.contaCorrente === true, "Lançar: fiado conta corrente gravado");

// 5. A receber separado
await irReceber();
await visao("dividas");
await page.waitForSelector("#rc-tabela-cc");
const cc = nb(await page.textContent("#rc-tabela-cc"));
const venc = nb(await page.textContent("#rc-tabela-venc"));
ok(cc.includes("Seu Arlindo") && cc.includes("Dona Cida") && !venc.includes("Arlindo") && !venc.includes("Cida"), "Conta corrente separado de Fiado com vencimento");
ok(nb(await page.locator('#fin-receber .receber-cards .total-bloco:has(> span:text-is("Atrasado"))').locator("strong").textContent()) === "R$ 0,00", "conta corrente nunca fica atrasado (venda de 20/08 sem atraso)");
const linhaA = page.locator("#rc-tabela-cc tr[data-chave]", { hasText: "Seu Arlindo" });
const tA = nb(await linhaA.textContent());
ok(tA.includes("R$ 650,00") && tA.includes("51 dia(s)") && tA.includes("desde 20/08/2026"), "Seu Arlindo: R$ 650 em aberto há 51 dias (desde 20/08)");
ok(tA.includes("passou do limite de R$ 500,00") && (await linhaA.getAttribute("class")).includes("cor-alerta"), "alerta de limite aparece e destaca a linha");
ok(nb(await page.locator("#rc-tabela-cc tr[data-chave]", { hasText: "Dona Cida" }).textContent()).includes("sem alerta"), "Dona Cida: sem alerta configurado");
ok(nb(await page.textContent("#fin-receber .receber-cards")).includes("conta corrente R$ 1.250,00"), "cartão mostra o total de conta corrente");
await linhaA.locator('[data-rc="ver"]').click();
const det = page.locator("#fin-receber tr.linha-detalhe");
ok(nb(await det.textContent()).includes("conta corrente") && nb(await det.textContent()).includes("em aberto há 51 dia(s)"), "detalhe: sem vencimento, \"em aberto há X dias\"");
await det.locator("[data-rc-via]").first().click();
ok((await impressoes()).length === 3, "botão 🖨 Via reimprime as 2 vias de uma venda");

// 6. Recebimento da Dona Cida (fiado anterior): entra no caixa, aparece como informação no DRE e no fluxo
await page.locator("#rc-tabela-cc tr[data-chave]", { hasText: "Dona Cida" }).locator('[data-rc="receber"]').click();
ok(nb(await page.textContent("#rc-receber-info")).includes("conta corrente, em aberto há 9 dia(s)"), "Receber: mostra há quantos dias está em aberto");
await page.fill("#rc-valor", "300"); await page.dispatchEvent("#rc-valor", "input");
await page.click("#rc-receber-form button[type=submit]");
await page.waitForFunction(() => document.getElementById("modal-receber").style.display === "none");
const tC = nb(await page.locator("#rc-tabela-cc tr[data-chave]", { hasText: "Dona Cida" }).textContent());
ok(tC.includes("R$ 300,00") && tC.includes("10/10/2026"), "Dona Cida: resta R$ 300, último pagamento 10/10");
await page.click("#btn-tab-relatorios"); await sub("relatorios", "dre");
await page.waitForSelector("#fin-dre-conteudo .dre-info");
const dre = nb(await page.textContent("#fin-dre-conteudo .dre-info"));
ok(dre.includes("Recebido de fiado anterior à virada") && dre.includes("R$ 300,00"), "DRE: linha informativa \"Recebido de fiado anterior à virada\" R$ 300");
ok(nb(await page.textContent("#fin-dre-conteudo tfoot .dre-info-linha")).includes("Recebido de fiado anterior à virada") && nb(await page.textContent("#fin-dre-conteudo tfoot")).includes("R$ 300,00"),
  "DRE: também como linha informativa no fim da tabela (não soma no lucro)");
await sub("relatorios", "fluxo");
await page.waitForSelector("#rel-fluxo .tabela-dre");
const fl = nb(await page.textContent("#rel-fluxo .tabela-dre"));
ok(fl.includes("Recebido de fiado anterior à virada") && fl.includes("R$ 300,00"), "Fluxo de caixa: mesma linha informativa");

// 7. Relatórios › A receber dividido
await sub("relatorios", "receber");
await page.waitForSelector("#rel-receber h2");
const rel = nb(await page.textContent("#rel-receber"));
ok(rel.includes("Conta corrente") && rel.includes("Fiado com vencimento") && rel.includes("Total conta corrente"), "relatório A receber: Conta corrente e Fiado com vencimento separados");

// 8. Desmarcar conta corrente: volta a ter vencimento (prazo padrão) e atraso
await irReceber();
await visao("clientes");
await page.locator("tr", { hasText: "Seu Arlindo" }).locator("[data-rc-editar]").click();
ok(await page.isChecked("#rc-cli-cc") && await page.inputValue("#rc-cli-limite") === "500", "editar: vem com conta corrente e alerta preenchidos");
await page.uncheck("#rc-cli-cc");
await page.click("#rc-cliente-form button[type=submit]");
await page.waitForFunction(() => !document.getElementById("rc-cli-cancelar"));
arlindo = (await clientes()).find((c) => c.nome === "Seu Arlindo");
ok(arlindo.contaCorrente === false && arlindo.alertaLimite === null, "desmarcado: sem conta corrente e sem alerta");
await visao("dividas");
await page.waitForSelector("#rc-tabela-venc");
ok(nb(await page.textContent("#rc-tabela-venc")).includes("Seu Arlindo") && nb(await page.locator('#fin-receber .receber-cards .total-bloco:has(> span:text-is("Atrasado"))').locator("strong").textContent()) === "R$ 400,00",
  "Seu Arlindo vai para Fiado com vencimento: a venda de 20/08 venceu em 19/09 (atrasado R$ 400)");

await page.screenshot({ path: "contacorrente.png", fullPage: true });
await browser.close();
