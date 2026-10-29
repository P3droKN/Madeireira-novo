// % geral em itens sem preço de tabela (sobre o preço digitado) e frete à parte no pedido.
import { createRequire } from "node:module";
const require = createRequire("/opt/node-tools/node_modules/");
const { chromium } = require("playwright");
import { fecharVias } from "./janela.mjs";
const URL = "http://localhost:4321";
const H = { "content-type": "application/json", "x-senha": "pinho123" };
const nb = (s) => (s || "").replace(/\u00a0/g, " ");
const ok = (cond, msg) => { console.log((cond ? "OK   " : "FALHA") + " " + msg); if (!cond) process.exitCode = 1; };
const db = async () => (await fetch(URL + "/__db")).json();

await fetch(URL + "/api/migrar", { method: "POST", headers: H });
await fetch(URL + "/api/migrar?versao=2", { method: "POST", headers: H });
await fetch(URL + "/api/precos", { method: "POST", headers: H, body: JSON.stringify({ alteracoes: { "PINUS|2x4x3.00|BRUTO": 25 } }) });

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await browser.newContext({ viewport: { width: 1250, height: 950 }, locale: "pt-BR" });
const page = await ctx.newPage();
const dialogos = [];
page.on("dialog", async (d) => { dialogos.push(d.message()); await d.accept(); });
page.on("pageerror", (e) => console.log("ERRO JS:", e.message));
const total = async () => page.inputValue("#total-final");
const cobrar = async () => nb(await page.textContent("#total-cobrar"));
const add = async (mat, dim, q, c) => {
  await page.selectOption("#material", mat); await page.selectOption("#dimension", dim);
  await page.fill("#quantity-pieces", String(q)); if (c) await page.fill("#quantity-length", String(c));
  await page.click("#btn-adicionar");
};

await page.goto(URL);
await page.fill("#senha-input", "pinho123"); await page.click("#senha-form button");
await page.waitForFunction(() => document.getElementById("catalogo-status").textContent.includes("itens"));

// 1. % geral num item SEM preço de tabela: vale sobre o preço digitado
await add("CAMBARA", "CAMBARA|1x2", 6, 3);
await page.locator("#items-body .preco-input").first().fill("5"); await page.locator("#items-body .preco-input").first().dispatchEvent("change");
await page.waitForTimeout(150);
ok(await total() === "90.00", "sem tabela, preço digitado R$ 5/m × 18 m = R$ 90,00");
await page.click("#pct-geral"); await page.keyboard.type("10");
await page.click('#motivos-geral button:has-text("Cliente antigo")');
await page.waitForTimeout(200);
ok(await total() === "99.00", "% geral 10% sem tabela: R$ 90 → R$ 99 (sobre o preço digitado)");
ok(nb(await page.textContent(".linha-ajuste")).includes("sobre o preço digitado"), "a linha explica: % sobre o preço digitado");
await page.fill("#pct-geral", "10"); await page.dispatchEvent("#pct-geral", "change");
await page.waitForTimeout(150);
ok(await total() === "99.00", "aplicar 10% de novo não acumula (continua R$ 99)");
// item com tabela junto: cada um sobre a sua base
await add("PINUS", "PINUS|2x4x3.00", 10);
await page.fill("#pct-geral", "-10"); await page.dispatchEvent("#pct-geral", "change");
await page.waitForTimeout(150);
ok(await total() === "306.00", "−10% geral: cambará 90 → 81 (digitado) + pinus 250 → 225 (tabela) = R$ 306");
await page.click("#voltar-tabela-geral");
await page.waitForTimeout(150);
ok(await total() === "340.00", "↺ voltar: cambará ao preço digitado (90) e pinus à tabela (250)");
ok((await page.locator("#motivos-geral .chip", { hasText: "Frete" }).count()) === 0, "o chip 'Frete/entrega' saiu dos motivos (o frete tem campo próprio)");

// 2. Frete à parte, opcional
ok(await page.isVisible("#frete-linha") && (await page.inputValue("#frete-valor")) === "", "campo 🚚 Frete aparece vazio (opcional)");
ok(!(await page.isVisible("#items-frete")), "sem frete: nenhuma linha de frete no pedido");
await page.fill("#frete-valor", "50"); await page.dispatchEvent("#frete-valor", "change");
await page.waitForTimeout(150);
ok(nb(await page.textContent("#items-frete")).includes("Frete / entrega") && nb(await page.textContent("#items-frete")).includes("R$ 390,00"), "pedido mostra a linha 'Frete / entrega' e o total com frete R$ 390,00");
ok(await total() === "340.00", "total dos itens continua R$ 340 (frete fora dos itens)");
ok(await cobrar() === "R$ 390,00" && nb(await page.textContent("#total-cobrar-detalhe")).includes("frete R$ 50,00"), "Fechar o pedido: R$ 390,00 (itens + frete)");
const margemAntes = nb(await page.textContent("#total-margem"));
ok(margemAntes !== "—", "margem só dos produtos: " + margemAntes);
await page.click("text=💬 Texto para WhatsApp");
const zap = nb(await page.inputValue("#whatsapp-texto"));
ok(zap.includes("Frete/entrega: R$ 50,00") && zap.includes("*Total: R$ 390,00*"), "WhatsApp mostra o frete à parte e o total R$ 390,00");
await page.click("#modal-whatsapp >> text=Fechar");
await page.reload();
await page.waitForFunction(() => document.querySelectorAll("#items-body tr.linha-item").length === 2);
ok((await page.inputValue("#frete-valor")) === "50.00", "frete mantido ao recarregar a página");

// 3. Orçamento com frete
await page.click("#btn-salvar-orcamento");
await page.fill("#orc-nome", "Cláudio"); await page.fill("#orc-tel", "(47) 99999-1234");
await page.click("#orc-salvar-botao");
await fecharVias(page, dialogos);
await page.waitForFunction(() => document.getElementById("modal-orc-salvar").style.display === "none");
const o = JSON.parse((await db()).madeireira_orcamentos["ORC-0001"]);
ok(o.frete === 50 && o.total === 390, "orçamento grava frete R$ 50 e total R$ 390");
ok((await page.inputValue("#frete-valor")) === "" || !(await page.isVisible("#frete-linha")), "pedido limpo (frete zerado) depois de salvar");
await page.click("#btn-tab-orcamentos"); await page.waitForSelector("#orc-body tr");
ok(nb(await page.textContent("#orc-body")).includes("com frete R$ 50,00"), "lista de orçamentos indica 'com frete'");
// Converter em venda: o frete vem junto
await page.locator('#orc-body [data-acao="converter"]').click();
await page.click("#orc-converter-orcamento");
await page.waitForSelector("#orc-vinculo:not([hidden])");
ok((await page.inputValue("#frete-valor")) === "50.00" && await cobrar() === "R$ 390,00", "converter traz o frete para o pedido");

// 4. Venda com frete
await page.click("#btn-registrar-venda");
await fecharVias(page, dialogos);
await page.waitForFunction(() => document.querySelectorAll("#items-body tr.linha-item").length === 0);
const v = Object.values((await db()).madeireira_lancamentos).map((x) => JSON.parse(x)).find((l) => l.origem === "calculadora");
ok(v && v.value === 390 && v.frete === 50 && v.pagamentos[0].valor === 390 && v.cmv > 0, `venda gravada: valor R$ ${v?.value} com frete R$ ${v?.frete}; pagamento cobre o total`);
ok(dialogos.at(-1).includes("frete R$ 50,00") || nb(dialogos.at(-1)).includes("frete R$ 50,00"), "aviso da venda mostra itens + frete");
// Lista e DRE
await page.click("#btn-tab-caixa"); await page.click('.subtabs[data-grupo="caixa"] .subtab[data-sub="lista"]');
ok(nb(await page.textContent("#fin-lista-body")).includes("inclui frete R$ 50,00"), "Lançamentos: a venda indica 'inclui frete'");
await page.click("#btn-tab-relatorios"); await page.click('.subtabs[data-grupo="relatorios"] .subtab[data-sub="dre"]');
const dre = nb(await page.textContent("#fin-dre-conteudo"));
ok(dre.includes("Frete cobrado dos clientes (já na receita)R$ 50,00"), "DRE mostra o frete cobrado (R$ 50,00) dentro da receita");
await page.screenshot({ path: "frete.png", fullPage: true });
await browser.close();
