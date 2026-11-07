// Madeira por metro linear vendida em peças: vias, pedido do Vender, Caixa › Lançar e WhatsApp mostram a QUANTIDADE
// DE PEÇAS, a unidade "pç" e o valor da PEÇA (o preço de tabela continua por metro). Pinus (por peça) e m² não mudam.
import { createRequire } from "node:module";
const require = createRequire("/opt/node-tools/node_modules/");
const { chromium } = require("playwright");
import { fecharVias } from "./janela.mjs";
const URL = "http://localhost:4321";
const H = { "content-type": "application/json", "x-senha": "pinho123" };
const nb = (s) => (s || "").replace(/ /g, " ");
const ok = (cond, msg) => { console.log((cond ? "OK   " : "FALHA") + " " + msg); if (!cond) process.exitCode = 1; };
const db = async () => (await fetch(URL + "/__db")).json();
const lanc = async () => Object.values((await db()).madeireira_lancamentos || {}).map((x) => JSON.parse(x)).filter((l) => !l.excluido);
await fetch(URL + "/api/precos", { method: "POST", headers: H, body: JSON.stringify({ alteracoes: { "EUCALIPTO|1x3|BRUTO": 5.5, "PINUS|2x4x3.00|BRUTO": 25, "FORRO|CEDRO_MESCLADO_CURTO|UNICO": 34.9 } }) });

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 950 }, locale: "pt-BR", timezoneId: "America/Sao_Paulo" })).newPage();
const dialogos = [];
page.on("dialog", async (d) => { dialogos.push(d.message()); await d.accept(); });
page.on("pageerror", (e) => console.log("ERRO JS:", e.message));
await page.goto(URL);
await page.fill("#senha-input", "pinho123"); await page.click("#senha-form button");
await page.waitForFunction(() => document.getElementById("catalogo-status").textContent.includes("itens"));
const add = async (mat, dim, qtd, comp) => {
  await page.selectOption("#material", mat); await page.selectOption("#dimension", dim);
  await page.fill("#quantity-pieces", String(qtd)); if (comp) await page.fill("#quantity-length", String(comp));
  await page.click("#btn-adicionar");
};

// 1. Pedido: Eucalipto 1x3, 9 peças de 4 m (36 m a R$ 5,50/m = R$ 198,00) → R$ 22,00 a peça
await add("EUCALIPTO", "EUCALIPTO|1x3", 9, 4);
await add("PINUS", "PINUS|2x4x3.00", 2);
await add("FORRO", "FORRO|CEDRO_MESCLADO_CURTO", 3.5);
await page.waitForFunction(() => document.querySelectorAll("#items-body tr.linha-item").length === 3);
const linha = (i) => page.locator("#items-body tr.linha-item").nth(i);
ok(await linha(0).locator(".preco-input").inputValue() === "22.00" && nb(await linha(0).textContent()).includes("/pç"), "pedido: madeira por metro mostra o valor da peça (R$ 22,00/pç)");
ok(nb(await page.locator("#items-body tr.linha-ajuste").first().textContent()).includes("Tabela R$ 22,00/pç (R$ 5,50/m) · R$ 198,00"), "a linha da tabela mostra a peça e o metro");
ok(await linha(1).locator(".preco-input").inputValue() === "25.00" && await linha(2).locator(".preco-input").inputValue() === "34.90", "Pinus (peça) e Forro (m²) continuam como estavam");
// digitar o valor da peça: 9 × R$ 20,00 = R$ 180,00
await linha(0).locator(".preco-input").fill("20"); await linha(0).locator(".preco-input").dispatchEvent("change");
await page.waitForTimeout(150);
ok(await linha(0).locator(".preco-input").inputValue() === "20.00" && nb(await linha(0).textContent()).includes("R$ 180,00"), "digitar R$ 20,00 a peça: 9 peças = R$ 180,00");

// 2. Vias: Quant. = 9, Unid. = pç, unitário R$ 20,00, total R$ 180,00
await page.click("#btn-registrar-imprimir");
await page.waitForSelector("#modal-impressao", { state: "visible" });
const linhasVia = await page.$$eval("#imp-previa-folha .pv-via:first-child tbody tr", (trs) => trs.map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent.trim())).filter((t) => t.join("").trim()));
const euc = linhasVia.find((t) => t.some((c) => c.includes("Eucalipto")));
const pin = linhasVia.find((t) => t.some((c) => c.includes("Pinus")));
const forro = linhasVia.find((t) => t.some((c) => c.includes("Forro")));
ok(euc && euc[1] === "9" && euc[2] === "pç" && nb(euc.join("|")).includes("peça de 4,00 m") && nb(euc.join("|")).includes("20,00") && nb(euc.join("|")).includes("180,00"),
  `via: Eucalipto em 9 pç, valor da peça R$ 20,00, total R$ 180,00 (${nb(euc?.join(" | "))})`);
ok(pin && pin[1] === "2" && pin[2] === "pç" && forro && forro[1] === "3,50" && forro[2] === "m²", "via: Pinus e Forro (m²) sem mudança");
await page.click("#imp-fechar");
const v = (await lanc()).find((l) => l.conta === "venda_produtos");
ok(v && v.value === 352.15 && v.itens[0].vendaTotal === 180 && v.itens[0].quantidadeCobrada === 36, "gravado: total R$ 352,15 (180 + 50 + 122,15); o item continua com 36 m (custo e relatórios por metro)");

// 3. Caixa › Lançar › Venda com itens: a linha mostra e aceita o valor da peça
await page.click("#btn-tab-caixa"); await page.click('.subtabs[data-grupo="caixa"] .subtab[data-sub="lancar"]');
await page.waitForSelector("#ic-material");
await page.selectOption("#ic-material", "EUCALIPTO"); await page.selectOption("#ic-medida", "EUCALIPTO|1x3");
ok(nb(await page.textContent("#ic-preco-rotulo")).includes("Preço do metro") && await page.inputValue("#ic-preco") === "5.50", "Caixa: ao escolher, o preço é o do metro (R$ 5,50)");
await page.fill("#ic-qtd", "9"); await page.fill("#ic-comp", "4"); await page.click("#ic-adicionar");
await page.waitForSelector("#ic-tabela tbody tr");
ok(await page.inputValue(".ic-preco-linha") === "22.00", "Caixa: a linha mostra o valor da peça (R$ 22,00)");
await page.fill(".ic-preco-linha", "21"); await page.dispatchEvent(".ic-preco-linha", "change");
await page.waitForTimeout(150);
ok(nb(await page.textContent("#ic-total")).includes("189,00"), "Caixa: R$ 21,00 a peça × 9 = R$ 189,00");

// 4. WhatsApp do orçamento: valor da peça
const { textoParaCliente } = await import("../../lib/orcamentos.js");
const t = textoParaCliente({ id: "ORC-0001", data: "2026-11-07", validoAte: "2026-11-14", total: 198, itens: [{ descricao: "Eucalipto 1x3", quantidade: 9, comprimento: 4, quantidadeTexto: "9 pç × 4,00 m = 36,00 m", unidade: "m", precoUnitario: 5.5, vendaTotal: 198 }] });
ok(nb(t).includes("R$ 22,00/pç → *R$ 198,00*"), "WhatsApp do orçamento: R$ 22,00/pç");

await browser.close();
