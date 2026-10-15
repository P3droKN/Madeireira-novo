import { createRequire } from "node:module";
const require = createRequire("/opt/node-tools/node_modules/");
const { chromium } = require("playwright");
const URL = "http://localhost:4321";
const H = { "content-type": "application/json", "x-senha": "pinho123" };
const nb = (s) => (s || "").replace(/ /g, " ");
const ok = (cond, msg) => { console.log((cond ? "OK   " : "FALHA") + " " + msg); if (!cond) process.exitCode = 1; };
const lanc = async () => Object.values((await (await fetch(URL + "/__db")).json()).madeireira_lancamentos || {}).map((x) => JSON.parse(x));
const porId = async (id) => (await lanc()).find((l) => l.id === id);

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await browser.newContext({ viewport: { width: 1200, height: 950 }, acceptDownloads: true });
const page = await ctx.newPage();
const dialogos = [];
page.on("dialog", async (d) => { dialogos.push(d.message()); await d.accept(); });
page.on("pageerror", (e) => console.log("ERRO JS:", e.message));
const fs = await import("node:fs");

await page.goto(URL);
await page.fill("#senha-input", "pinho123"); await page.click("#senha-form button");
// Salvamento seguro (fase 0) e backup do estado antigo para a conferência
await fetch(URL + "/api/migrar", { method: "POST", headers: H });
const backup = await (await fetch(URL + "/api/backup", { headers: H })).json();
fs.writeFileSync("backup-2a.json", JSON.stringify(backup));
await page.reload();

// Tela antiga: total de agosto antes da migração v2
await page.click("#btn-tab-finance");
await page.fill("#filter-date", "2026-08-31"); await page.dispatchEvent("#filter-date", "change");
const totAgoAntes = await page.textContent("#tot-vendas");

// 1. Migração v2
await page.click("#btn-tab-financeiro");
ok(await page.isVisible("#fin-aviso-v2"), "aviso para migrar ao financeiro novo");
const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#fin-v2-backup")]);
await page.click("#fin-v2-migrar");
await page.waitForFunction(() => document.getElementById("fin-aviso-v2").hidden);
console.log("     ", dialogos.at(-1).split("\n").filter(Boolean).slice(0, 3).join(" | "));
const todos = await lanc();
ok(todos.every((l) => l.v === 2), "todos os lançamentos no formato novo");
ok((await porId("1760000000001V")).pagamentos[0].forma === "pix_bradesco", "PIX antigo → PIX Bradesco");
ok((await porId("1003")).pagamentos[0].forma === "transferencia", "método 'bradesco' → Transferência");
ok((await porId("1760000000002C")).chequeEmitido.compensacao === "2026-10-20", "custo em cheque → cheque emitido com compensação");
ok(todos.filter((l) => l.abertura).length === 7, "7 lançamentos de abertura (agosto)");

// Tela antiga não conta agosto em dobro
await page.click("#btn-tab-finance");
await page.fill("#filter-date", "2026-08-31"); await page.dispatchEvent("#filter-date", "change");
ok(await page.textContent("#tot-vendas") === totAgoAntes, "tela antiga: total de agosto igual antes e depois (" + nb(totAgoAntes) + ")");

// Conferência com o backup de antes
await page.setInputFiles("#conferir-file", "backup-2a.json");
await page.waitForSelector("#modal-conferencia", { state: "visible" });
ok((await page.textContent("#conferencia-veredito")).includes("Tudo confere"), "conferência após migração v2: " + (await page.textContent("#conferencia-veredito")).trim());
ok((await page.textContent("#conferencia-body")).includes("Abertura × acumulado"), "conferência compara abertura × acumulado");
await page.click("#modal-conferencia >> text=Fechar");

// 2. Reclassificação em lote
await page.click("#btn-tab-financeiro");
await page.click('.subtab[data-sub="lista"]');
await page.selectOption("#fin-f-tipo", "sugestao");
const comSug = await page.locator("#fin-lista-body tr").count();
ok(comSug === 2, `2 custos com sugestão (par venda/custo e "apenas custo"): ${comSug}`);
await page.check("#fin-sel-todos");
await page.click("#fin-lote-sugestao");
await page.waitForFunction(() => document.querySelectorAll("#fin-lista-body tr td[colspan]").length === 1);
ok((await porId("1760000000001C")).conta === "cmv" && (await porId("1760000000002C")).conta === "compra_material", "sugestões aceitas: CMV e compra");
await page.selectOption("#fin-f-tipo", "classificar");
await page.fill("#fin-f-busca", "luz");
await page.locator("#fin-lista-body .fin-sel").first().check();
await page.selectOption("#fin-lote-conta", "energia");
await page.click("#fin-lote-aplicar");
await page.waitForTimeout(400);
ok((await porId("1760000000003")).conta === "energia", "despesa reclassificada para Energia");
await page.fill("#fin-f-busca", "");
await page.selectOption("#fin-f-tipo", "entradas");
await page.fill("#fin-f-mes", ""); await page.dispatchEvent("#fin-f-mes", "change");
await page.locator("#fin-lista-body tr", { hasText: "Venda Direta: CAMBARÁ" }).locator(".fin-sel").check();
await page.selectOption("#fin-lote-forma", "pix_picpay");
await page.click("#fin-lote-forma-aplicar");
await page.waitForTimeout(400);
const trocada = await porId("1760000000001V");
ok(trocada.pagamentos[0].forma === "pix_picpay" && trocada.pagamentos[0].tPag === "17" && trocada.formaOriginal === "pix_bradesco", "forma trocada em lote: PIX Bradesco → PIX PicPay (tPag 17)");

// 3. Lançar: venda com duas formas, NF-e
await page.click('.subtab[data-sub="lancar"]');
await page.fill("#ff-data", "2026-10-12");
await page.fill("#ff-valor", "300");
await page.fill("#ff-desc", "venda balcão");
await page.fill("#ff-nfe", "4321");
await page.locator("#ff-pagamentos .pag-valor").first().fill("100");
await page.locator("#ff-pagamentos .pag-valor").first().dispatchEvent("input");
await page.click("#ff-pagamentos .pag-adicionar");
await page.locator("#ff-pagamentos .pag-forma").nth(1).selectOption("pix_picpay");
ok(nb(await page.textContent("#ff-pagamentos .pag-status")).includes("Soma confere"), "duas formas somam o total");
await page.click("#fin-form button[type=submit]");
await page.waitForTimeout(500);
const vendaManual = (await lanc()).find((l) => l.nfe === "4321");
ok(vendaManual && vendaManual.pagamentos.length === 2 && vendaManual.pagamentos[1].valor === 200 && vendaManual.pagamentos[1].tPag === "17", "venda manual gravada com 2 formas e NF-e");

// Saída com fornecedor e sugestão de "Pago com"
await page.locator('label:has(input[name="fin-tipo"][value="saida"])').click();
await page.fill("#ff-data", "2026-10-13");
await page.selectOption("#ff-conta", "energia");
await page.fill("#ff-valor", "180");
await page.fill("#ff-fornecedor", "Celesc"); await page.dispatchEvent("#ff-fornecedor", "change");
await page.locator('label:has(input[name="ff-pagocom"][value="picpay"])').click();
await page.click("#fin-form button[type=submit]");
await page.waitForTimeout(500);
await page.locator('label:has(input[name="fin-tipo"][value="saida"])').click();
await page.selectOption("#ff-conta", "aluguel");
await page.fill("#ff-fornecedor", "Celesc"); await page.dispatchEvent("#ff-fornecedor", "change");
ok(await page.isChecked('input[name="ff-pagocom"][value="picpay"]'), "sugere 'Pago com' pela última usada com o fornecedor (PicPay)");
// Cheque emitido pelo PicPay
await page.selectOption("#ff-conta", "compra_material");
await page.fill("#ff-valor", "2500");
await page.fill("#ff-fornecedor", "Madeiras do Sul"); await page.dispatchEvent("#ff-fornecedor", "change");
await page.locator('label:has(input[name="ff-pagocom"][value="cheque_emitido"])').click();
ok(await page.isVisible("#ff-cheque"), "campos do cheque emitido aparecem");
await page.fill("#ff-ch-numero", "1002"); await page.fill("#ff-ch-comp", "2026-11-05"); await page.selectOption("#ff-ch-conta", "picpay");
await page.click("#fin-form button[type=submit]");
await page.waitForTimeout(500);
const ch = (await lanc()).find((l) => l.chequeEmitido?.numero === "1002");
ok(ch && ch.chequeEmitido.conta === "picpay" && ch.chequeEmitido.favorecido === "Madeiras do Sul" && ch.conta === "compra_material", "cheque emitido gravado (conta PicPay, favorecido)");
// Saída sem "Pago com" é recusada
await page.locator('label:has(input[name="fin-tipo"][value="saida"])').click();
await page.selectOption("#ff-conta", "agua"); await page.fill("#ff-valor", "40"); await page.fill("#ff-fornecedor", "Fornecedor Novo"); await page.dispatchEvent("#ff-fornecedor", "change");
await page.click("#fin-form button[type=submit]");
ok(dialogos.at(-1).includes("Pago com"), "saída sem 'Pago com' é recusada");
// Transferência
await page.locator('label:has(input[name="fin-tipo"][value="transferencia"])').click();
await page.fill("#ff-valor", "1000");
await page.click("#fin-form button[type=submit]");
await page.waitForTimeout(400);
ok((await lanc()).some((l) => l.conta === "transferencia" && l.de === "picpay" && l.para === "bradesco"), "transferência PicPay → Bradesco");

// 4. Calculadora com duas formas
await page.click("#btn-tab-calculator");
await page.waitForFunction(() => document.getElementById("catalogo-status").textContent.includes("itens"));
await page.selectOption("#material", "CAMBARA"); await page.selectOption("#dimension", "CAMBARA|1x2");
await page.fill("#quantity-pieces", "6"); await page.fill("#quantity-length", "3"); await page.click("#btn-adicionar");
await page.locator("#items-body .preco-input").first().fill("5"); await page.locator("#items-body .preco-input").first().dispatchEvent("change");
await page.waitForTimeout(150);
await page.fill("#direct-sale-date", "2026-10-14");
await page.locator("#calc-pagamentos .pag-valor").first().fill("40"); await page.locator("#calc-pagamentos .pag-valor").first().dispatchEvent("input");
await page.click("#calc-pagamentos .pag-adicionar");
await page.locator("#calc-pagamentos .pag-forma").nth(1).selectOption("debito");
await page.fill("#calc-nfe", "999");
await page.click("#btn-registrar-venda");
await page.waitForFunction(() => document.querySelectorAll("#items-body tr.linha-item").length === 0);
const vc = (await lanc()).find((l) => l.nfe === "999");
ok(vc && vc.v === 2 && vc.cmv === 61.92 && vc.pagamentos.map((p) => `${p.forma}:${p.valor}`).join(",") === "dinheiro:40,debito:50", "calculadora grava venda v2 com 2 formas, NF-e e CMV");

// 5. Config + DRE
await page.click("#btn-tab-financeiro");
await page.click('.subtab[data-sub="config"]');
await page.fill("#cfg-deb-taxa", "2");
await page.click("#fin-config-form button[type=submit]");
await page.waitForTimeout(300);
await page.click('.subtab[data-sub="dre"]');
await page.fill("#fin-dre-mes", "2026-10"); await page.dispatchEvent("#fin-dre-mes", "change");
const dre = nb(await page.textContent("#fin-dre-conteudo"));
// receita de outubro: 500 + 1200 + 300 (manual) + 90 (calculadora)
ok(dre.includes("R$ 2.090,00"), "DRE outubro: receita bruta R$ 2.090,00");
ok(dre.includes("−R$ 1,00") || dre.includes("-R$ 1,00"), "taxa de débito 2% sobre R$ 50 = R$ 1,00");
ok(dre.includes("CMV estimado") && dre.includes("estimado"), "venda manual sem custo: CMV estimado e marcado");
ok(dre.includes("Compras do mês") && dre.includes("R$ 3.400,00"), "compras (900 + 2.500) aparecem como estoque, fora do resultado");
await page.screenshot({ path: "dre-mes.png", fullPage: true });
await page.locator('label:has(input[name="fin-dre-visao"][value="ano"])').click();
ok((await page.locator(".tabela-dre.anual tbody tr").count()) > 15, "DRE anual com 12 meses + total");
await page.screenshot({ path: "dre-ano.png", fullPage: false });
await page.locator('label:has(input[name="fin-dre-visao"][value="mes"])').click();
await page.fill("#fin-dre-mes", "2026-08"); await page.dispatchEvent("#fin-dre-mes", "change");
const ago = nb(await page.textContent("#fin-dre-conteudo"));
ok(ago.includes("não classificados"), "agosto avisa custos não classificados (abertura)");
await page.click('.subtab[data-sub="lista"]');
await page.selectOption("#fin-f-tipo", "todos");
await page.screenshot({ path: "lancamentos.png", fullPage: false });
await browser.close();
