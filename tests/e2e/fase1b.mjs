import { createRequire } from "node:module";
const require = createRequire("/opt/node-tools/node_modules/");
const { chromium } = require("playwright");
const URL = "http://localhost:4321";
const H = { "content-type": "application/json", "x-senha": "pinho123" };
const db = async () => (await fetch(URL + "/__db")).json();
const nb = (s) => (s || "").replace(/\u00a0/g, " ");
const ok = (cond, msg) => { console.log((cond ? "OK   " : "FALHA") + " " + msg); if (!cond) process.exitCode = 1; };

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" }).catch(() => chromium.launch());
const ctx = await browser.newContext({ viewport: { width: 1150, height: 900 }, locale: "pt-BR" });
await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: URL });
const page = await ctx.newPage();
const dialogos = [];
page.on("dialog", async (d) => { dialogos.push(d.message()); d.type() === "prompt" ? await d.accept("pedido grande") : await d.accept(); });
page.on("pageerror", (e) => console.log("ERRO JS:", e.message));
const linha = (i) => page.locator("#items-body tr.linha-item").nth(i);
const ajuste = (i) => page.locator("#items-body tr.linha-ajuste").nth(i);
const muda = async (loc, v) => { await loc.fill(String(v)); await loc.dispatchEvent("change"); await page.waitForTimeout(80); };
const add = async (mat, dim, q, c) => {
  await page.selectOption("#material", mat); await page.selectOption("#dimension", dim);
  await page.fill("#quantity-pieces", String(q)); if (c) await page.fill("#quantity-length", String(c));
  await page.click("#btn-adicionar");
};

await page.goto(URL);
await page.fill("#senha-input", "pinho123"); await page.click("#senha-form button");
await page.waitForFunction(() => document.getElementById("catalogo-status").textContent.includes("itens"));

// Sem tabela: vendedor digita
await add("CAMBARA", "CAMBARA|1x2", 6, 3);
ok((await ajuste(0).textContent()).includes("Sem preço de tabela"), "item sem tabela pede preço");
await muda(linha(0).locator(".preco-input"), 5);
ok((await linha(0).textContent()).includes("31,2%"), "R$ 5/m → R$ 90 → margem 31,2%");

// Preços de tabela e % padrão
await page.click("#btn-tab-prices"); await page.waitForSelector("#precos-body tr");
await page.fill("#cfg-selecionada", "10"); await page.fill("#cfg-ultimas", "20");
await page.click("text=Salvar ajustes"); await page.waitForTimeout(200);
await page.selectOption("#precos-filtro-material", "");
for (const [k, v] of [["CAMBARA|1x2|BRUTO", 5.5], ["PINUS|2x4x3.00|BRUTO", 25]]) {
  const i = page.locator(`input[data-chave="${k}"]`); await i.fill(String(v)); await i.dispatchEvent("change");
}
await page.click("text=Salvar preços"); await page.waitForTimeout(300);
await page.click("#btn-tab-calculator");
ok(nb(await ajuste(0).textContent()).includes("Tabela R$ 5,50/m"), "linha mostra o preço de tabela");
ok(nb(await ajuste(0).locator(".variacao").textContent()).includes("−R$ 9,00 (−9,1%)"), "preço digitado 5,00 vs tabela 5,50 → −9,1% (laranja)");

await add("PINUS", "PINUS|2x4x3.00", 10);
await add("CAMBARA", "CAMBARA|1x2", 1, 10);
ok((await linha(1).textContent()).includes("250,00"), "pinus parte da tabela: 10 × 25 = 250");

// % → preço
await muda(ajuste(1).locator(".pct-input"), 10);
ok((await linha(1).textContent()).includes("275,00"), "+10% → 275,00");
ok(await ajuste(1).locator(".variacao.acima").isVisible(), "variação acima em verde");
// preço → %
await muda(linha(1).locator(".preco-input"), 22.5);
ok((await ajuste(1).locator(".pct-input").inputValue()) === "-10.0", "preço 22,50 → % recalculado −10,0");
ok(await ajuste(1).locator(".variacao.abaixo").isVisible(), "variação abaixo em laranja");
await ajuste(1).locator("text=↺ Voltar ao preço de tabela").click();
ok((await linha(1).textContent()).includes("250,00"), "voltar ao preço de tabela");

// Atalho Selecionada aplica +10% e grava o motivo
await ajuste(2).locator(".chip", { hasText: "Selecionada" }).click();
ok((await linha(2).textContent()).includes("60,50"), "Selecionada → +10% → 6,05/m → 60,50");
ok(await ajuste(2).locator(".chip.ativo", { hasText: "Selecionada" }).isVisible(), "motivo marcado (opcional)");

// Total editável: rateio proporcional, custo não muda
const custoAntes = await page.textContent("#total-custo");
await muda(page.locator("#total-final"), 500);
const somaItens = await page.$$eval("#items-body tr.linha-item td:nth-child(5)", (tds) =>
  tds.reduce((s, td) => s + Number(td.textContent.replace(/[^\d,]/g, "").replace(",", ".")), 0));
ok(Math.abs(somaItens - 500) < 0.001, "total 500 distribuído: soma dos itens = " + somaItens.toFixed(2));
ok((await page.textContent("#total-custo")) === custoAntes, "CMV não muda com o total: " + custoAntes);

// % geral e motivo geral
await muda(page.locator("#pct-geral"), -5);
ok((await page.inputValue("#total-final")) === "383.80", "% geral −5% sobre a tabela (404,00) → 383,80");
ok(nb(await page.textContent("#total-variacao")).includes("−R$ 20,20 (−5,0%)"), "variação total −R$ 20,20 (−5,0%)");
await page.locator("#motivos-geral .chip", { hasText: "Cliente antigo" }).click();
await page.screenshot({ path: "pedido-novo.png", fullPage: true });

// WhatsApp
await page.click("text=💬 Texto para WhatsApp");
const zap = await page.inputValue("#whatsapp-texto");
ok(!/custo|margem|tabela/i.test(zap) && zap.includes("*Total: R$ 383,80*"), "WhatsApp: itens e total, sem custo, margem ou tabela");
await page.click("text=Copiar texto");
await page.waitForTimeout(200);
ok((await page.textContent("#whatsapp-copiado")).includes("Copiado"), "copiar texto");
ok((await page.evaluate(() => navigator.clipboard.readText())) === zap, "texto foi para a área de transferência");
await page.click("#modal-whatsapp >> text=Fechar");

// Registrar (depois da migração)
await fetch(URL + "/api/migrar", { method: "POST", headers: H });
await page.reload();
await page.waitForFunction(() => document.querySelectorAll("#items-body tr.linha-item").length === 3);
ok((await page.inputValue("#total-final")) === "383.80", "pedido e ajustes mantidos ao recarregar");
// forma padrão (dinheiro) no editor de pagamentos
await page.click("#btn-registrar-venda");
await page.waitForFunction(() => document.querySelectorAll("#items-body tr.linha-item").length === 0);
const d = await db();
const v = Object.values(d.madeireira_lancamentos).map((x) => JSON.parse(x)).find((l) => l.origem === "calculadora");
ok(v.value === 383.8 && v.cmv === 279.92 && v.tabelaTotal === 404 && v.variacao === -20.2 && v.motivo === "Cliente antigo",
  `venda gravada: valor ${v.value}, CMV ${v.cmv}, tabela ${v.tabelaTotal}, variação ${v.variacao}, motivo "${v.motivo}"`);
ok(v.itens.every((i) => Math.abs(i.variacaoPct + 5) < 0.01) && v.itens[2].motivo === "Selecionada",
  "itens gravam preço de tabela, final, variação −5% e motivo");
await browser.close();
