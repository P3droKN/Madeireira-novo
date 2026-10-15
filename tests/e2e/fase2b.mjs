import { createRequire } from "node:module";
const require = createRequire("/opt/node-tools/node_modules/");
const { chromium } = require("playwright");
const URL = "http://localhost:4321";
const H = { "content-type": "application/json", "x-senha": "pinho123" };
const nb = (s) => (s || "").replace(/ /g, " ");
const ok = (cond, msg) => { console.log((cond ? "OK   " : "FALHA") + " " + msg); if (!cond) process.exitCode = 1; };
const post = (itens) => fetch(URL + "/api/lancamento", { method: "POST", headers: H, body: JSON.stringify({ itens }) });
const db = async () => (await fetch(URL + "/__db")).json();
const lanc = async (id) => JSON.parse((await db()).madeireira_lancamentos[id]);

await fetch(URL + "/api/migrar", { method: "POST", headers: H });
await fetch(URL + "/api/migrar?versao=2", { method: "POST", headers: H });
const V = (id, data, pagamentos) => ({ id, v: 2, conta: "venda_produtos", competencia: data, value: pagamentos.reduce((s, p) => s + p.valor, 0), pagamentos });
await post([V("chq1", "2026-10-28", [{ forma: "cheque", valor: 400, cheque: { numero: "555", emissor: "José", compensacao: "2026-11-10" } }])]);

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await browser.newContext({ viewport: { width: 1250, height: 950 }, locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
const page = await ctx.newPage();
await page.clock.install({ time: new Date("2026-11-01T09:00:00-03:00") });
const respostas = [];
const dialogos = [];
page.on("dialog", async (d) => { dialogos.push(d.message()); d.type() === "prompt" ? await d.accept(respostas.shift() ?? "") : await d.accept(); });
page.on("pageerror", (e) => console.log("ERRO JS:", e.message));
const sub = (grupo, nome) => page.click(`.subtabs[data-grupo="${grupo}"] .subtab[data-sub="${nome}"]`);
const abrirCaixa = async () => { await page.click("#btn-tab-caixa"); await sub("caixa", "saldos"); };
const abrirAbertura = async () => { await page.click("#btn-tab-ajustes"); await sub("ajustes", "saldos"); };
const card = (nome) => page.locator(".saldo-conta", { hasText: nome });

await page.goto(URL);
await page.fill("#senha-input", "pinho123"); await page.click("#senha-form button");
await page.waitForFunction(() => window.Caixa && window.Caixa.migradoV2);
await abrirCaixa();
ok(nb(await page.textContent("#fin-saldos")).includes("Faça a abertura de saldos"), "sem abertura: Caixa › Saldos pede a abertura de saldos");
await page.click("#fin-saldos [data-ir-abertura]");
ok(await page.isVisible("#aj-abertura #cx-abertura"), "o aviso leva para Ajustes › Saldos (formulário da abertura)");
ok(await page.inputValue("#cx-ab-cheques") === "400", "sugere R$ 400 em cheques em carteira (recebido antes, compensa depois)");
await page.fill("#cx-ab-gaveta", "300"); await page.fill("#cx-ab-bradesco", "5000"); await page.fill("#cx-ab-picpay", "200");
await page.click("#cx-abertura button[type=submit]");
await page.waitForSelector("#cx-refazer");
ok(nb(await page.textContent("#aj-abertura")).includes("Feita em 01/11/2026"), "abertura salva (01/11/2026) e mostrada em Ajustes › Saldos");
await abrirCaixa();
await page.waitForSelector(".saldo-conta");
ok(nb(await page.textContent("#fin-saldos")).includes("abertura em 01/11/2026"), "Caixa › Saldos mostra os saldos a partir da abertura");

// Movimentos depois da abertura
await post([
  V("vdeb", "2026-11-02", [{ forma: "debito", valor: 100 }]),
  V("vparc", "2026-11-02", [{ forma: "credito_parcelado", valor: 300, parcelas: 3 }]),
  V("vpix", "2026-11-02", [{ forma: "pix_bradesco", valor: 150 }]),
  { id: "s-gav", v: 2, conta: "combustivel", value: 50, competencia: "2026-11-02", pagoCom: "gaveta" },
  { id: "s-ch", v: 2, conta: "compra_material", value: 1000, competencia: "2026-11-02", pagoCom: "cheque_emitido", chequeEmitido: { numero: "1001", favorecido: "Serraria", compensacao: "2026-11-20" } },
  { id: "s-pagar", v: 2, conta: "aluguel", value: 800, competencia: "2026-11-02", pagoCom: "bradesco", dataPagamento: "2026-11-25" },
  { id: "t1", v: 2, conta: "transferencia", de: "picpay", para: "bradesco", value: 100, competencia: "2026-11-03" },
]);
await page.clock.setFixedTime(new Date("2026-11-03T18:00:00-03:00"));
await page.reload();
await page.waitForFunction(() => window.Caixa && window.Caixa.migradoV2);
await abrirCaixa();
const saldo = async (nome) => nb(await card(nome).locator("strong").textContent());
ok(await saldo("Gaveta") === "R$ 250,00" && await saldo("Bradesco") === "R$ 5.250,00" && await saldo("PicPay") === "R$ 200,00" && await saldo("Cheques em carteira") === "R$ 400,00", "saldos hoje: gaveta 250, Bradesco 5.250, PicPay 200 (débito D+1 − transferência), carteira 400");
ok(nb(await page.locator(".saldos-grid .destaque").first().textContent()).includes("R$ 6.100,00"), "total R$ 6.100,00");

// Conferir gaveta
respostas.push("240");
await card("Gaveta").locator("button").click();
await page.waitForTimeout(500);
ok(nb(dialogos.at(-2) || "").includes("diferença de -R$ 10,00") || nb(dialogos.join("|")).includes("diferença de -R$ 10,00"), "conferência da gaveta mostra a diferença de −R$ 10,00");
await page.waitForSelector(".saldo-conta");
ok(nb(await card("Gaveta").textContent()).includes("diferença -R$ 10,00"), "cartão da gaveta mostra a última conferência");

// Projeção 30 dias (até 03/12)
const proj = nb(await page.locator("section", { hasText: "Projeção dos próximos 30 dias" }).textContent());
ok(proj.includes("Cartão a receber (PicPay)R$ 1.300,00"), "projeção: cartão a receber R$ 1.300 (crédito antigo de 09/10 em 08/11 + 1ª parcela em 02/12)");
ok(proj.includes("Cheques a compensarR$ 400,00"), "projeção: cheque de R$ 400 compensa em 10/11");
ok(proj.includes("Cheques emitidos (saem)R$ 1.000,00") && proj.includes("Contas a pagar lançadas (saem)R$ 800,00"), "projeção: cheque emitido −1.000 e aluguel −800");
ok(proj.includes("R$ 6.100,00 → R$ 5.600,00"), "saldo hoje R$ 6.100 → em 30 dias R$ 5.600");

// Fluxo de novembro (Relatórios › Fluxo de caixa)
await page.click("#btn-tab-relatorios"); await sub("relatorios", "fluxo");
const fluxo = nb(await page.locator("#rel-fluxo section", { hasText: "Fluxo de caixa" }).textContent());
ok(fluxo.includes("Saldo inicialR$ 5.900,00") && fluxo.includes("Saldo finalR$ 5.500,00") && !fluxo.includes("Cheques compensados"), "fluxo de novembro (consolidado): 5.900 → 5.500, sem a compensação interna do cheque");
await page.selectOption("#cx-fluxo-conta", "bradesco");
const fb = nb(await page.locator("#rel-fluxo section", { hasText: "Fluxo de caixa" }).textContent());
ok(fb.includes("Saldo inicialR$ 5.000,00") && fb.includes("Saldo finalR$ 3.850,00"), "fluxo do Bradesco: 5.000 + 150 + 100 + 400 − 1.000 − 800 = 3.850");
await page.screenshot({ path: "caixa.png", fullPage: true });

// Cheques
await page.click("#btn-tab-caixa"); await sub("caixa", "cheques");
const rec = page.locator("#fin-cheques tr", { hasText: "José" });
ok(nb(await page.textContent("#fin-cheques")).includes("Em carteira (a compensar)R$ 400,00"), "cheques: R$ 400 em carteira");
respostas.push("2026-11-03");
await rec.locator("[data-ch-devolver]").click();
await page.waitForTimeout(500);
ok((await lanc("chq1")).pagamentos[0].cheque.devolvidoEm === "2026-11-03", "marcado como devolvido");
ok(nb(await page.textContent("#fin-cheques")).includes("Devolvidos (cobrar do cliente)R$ 400,00"), "aparece em devolvidos (cobrar do cliente)");
await sub("caixa", "saldos");
ok(nb(await page.locator(".saldos-grid .destaque").first().textContent()).includes("R$ 5.700,00"), "devolvido antes de compensar: sai da carteira (total 5.700)");
await sub("caixa", "cheques");
await page.selectOption("#ch-f-rec", "devolvido");
await page.locator("#fin-cheques tr", { hasText: "José" }).locator("[data-ch-desfazer]").click();
await page.waitForTimeout(500);
ok(!(await lanc("chq1")).pagamentos[0].cheque.devolvidoEm, "desfazer devolução");
await page.selectOption("#ch-f-rec", "a_compensar");
await page.locator("#fin-cheques tr", { hasText: "José" }).locator("[data-ch-dep]").selectOption("picpay");
await page.waitForTimeout(500);
ok((await lanc("chq1")).pagamentos[0].cheque.contaDeposito === "picpay", "conta de depósito trocada para PicPay");
const emi = page.locator("#fin-cheques tr", { hasText: "Serraria" });
await emi.locator("[data-che-comp]").fill("2026-12-15");
await emi.locator("[data-che-comp]").dispatchEvent("change");
await page.waitForTimeout(500);
ok((await lanc("s-ch")).chequeEmitido.compensacao === "2026-12-15", "cheque emitido adiado para 15/12");
await page.screenshot({ path: "cheques.png", fullPage: true });
await sub("caixa", "saldos");
ok(nb(await page.locator("section", { hasText: "Projeção dos próximos 30 dias" }).textContent()).includes("R$ 6.100,00 → R$ 6.600,00"), "projeção sem o cheque adiado: R$ 6.600");

// Refazer abertura (Ajustes › Saldos)
await abrirAbertura();
await page.click("#cx-refazer");
await page.fill("#cx-ab-gaveta", "310");
await page.click("#cx-abertura button[type=submit]");
await page.waitForTimeout(600);
await abrirCaixa();
ok(await saldo("Gaveta") === "R$ 260,00", "refazer abertura: gaveta 310 − 50 = 260");
ok(JSON.parse((await db()).madeireira_saldos).aberturasAnteriores.length === 1, "abertura anterior guardada no histórico");
await browser.close();
