// Correções críticas da varredura: clique duplo não duplica; salvar Ajustes › Financeiro não apaga a impressão;
// cheque sem data de compensação é recusado; transferência sem a carteira; estornar venda de orçamento reabre o
// orçamento; correção feita numa tela desatualizada (outro aparelho) é recusada.
import { createRequire } from "node:module";
const require = createRequire("/opt/node-tools/node_modules/");
const { chromium } = require("playwright");
import { fecharVias } from "./janela.mjs";
const URL = "http://localhost:4321";
const H = { "content-type": "application/json", "x-senha": "pinho123" };
const nb = (s) => (s || "").replace(/ /g, " ");
const ok = (cond, msg) => { console.log((cond ? "OK   " : "FALHA") + " " + msg); if (!cond) process.exitCode = 1; };
const db = async () => (await fetch(URL + "/__db")).json();
const lanc = async (todos = false) => Object.values((await db()).madeireira_lancamentos || {}).map((x) => JSON.parse(x)).filter((l) => todos || !l.excluido);

await fetch(URL + "/api/migrar", { method: "POST", headers: H });
await fetch(URL + "/api/migrar?versao=2", { method: "POST", headers: H });
await fetch(URL + "/api/config", { method: "POST", headers: H, body: JSON.stringify({ abertura: { data: "2026-10-01", contas: { gaveta: 300, bradesco: 1000, picpay: 0, cheques_carteira: 0 } } }) });
await fetch(URL + "/api/precos", { method: "POST", headers: H, body: JSON.stringify({ alteracoes: { "PINUS|1x2x2.50|BRUTO": 4.5 } }) });

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const abrir = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 }, locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
  const page = await ctx.newPage();
  await page.clock.install({ time: new Date("2026-10-20T10:00:00-03:00") });
  page.dialogos = [];
  page.on("dialog", async (d) => { page.dialogos.push(d.message()); await d.accept(); });
  page.on("pageerror", (e) => console.log("ERRO JS:", e.message));
  await page.goto(URL);
  await page.fill("#senha-input", "pinho123"); await page.click("#senha-form button");
  await page.waitForFunction(() => document.getElementById("catalogo-status").textContent.includes("itens"));
  await page.waitForFunction(() => window.Caixa && window.Caixa.migradoV2);
  return page;
};
const page = await abrir();
const sub = (p, g, s) => p.click(`.subtabs[data-grupo="${g}"] .subtab[data-sub="${s}"]`);

// 1. Clique duplo em Registrar venda: uma venda só
await page.selectOption("#material", "PINUS"); await page.selectOption("#dimension", "PINUS|1x2x2.50");
await page.fill("#quantity-pieces", "10"); await page.click("#btn-adicionar");
await page.evaluate(() => { const b = document.getElementById("btn-registrar-venda"); b.click(); b.click(); b.click(); });
await fecharVias(page, page.dialogos);
await page.waitForTimeout(500);
ok((await lanc()).filter((l) => l.conta === "venda_produtos").length === 1, "três cliques em Registrar venda gravam uma venda só (V-0001)");

// 2. Ajustes › Impressão + Ajustes › Financeiro: o cabeçalho continua
await page.click("#btn-tab-ajustes"); await sub(page, "ajustes", "impressao");
await page.fill("#imp-cfg-nome", "Mercado da Madeira");
await page.click("#aj-impressao-form button[type=submit]");
await page.waitForTimeout(300);
await sub(page, "ajustes", "financeiro");
await page.fill("#cfg-deb-taxa", "1.5");
await page.click("#fin-config-form button[type=submit]");
await page.waitForTimeout(400);
const cfg = JSON.parse((await db()).madeireira_config_financeiro);
ok(cfg.impressao.nome === "Mercado da Madeira" && cfg.cartao.debito.taxaPct === 1.5, "salvar Ajustes › Financeiro não apaga o cabeçalho de Ajustes › Impressão");

// 3. Cheque sem data de compensação é recusado na tela
await page.click("#btn-tab-caixa"); await sub(page, "caixa", "lancar");
await page.fill("#ff-valor", "200"); await page.dispatchEvent("#ff-valor", "input");
await page.locator("#ff-pagamentos .pag-forma").first().selectOption("cheque");
await page.click("#fin-form button[type=submit]");
await page.waitForTimeout(300);
ok(page.dialogos.at(-1).includes("data de compensação") && !(await lanc()).some((l) => l.value === 200), "cheque sem \"Compensa em\" não é gravado");

// 4. Transferência: Cheques em carteira não aparece; o servidor também recusa
await page.locator('label:has(input[name="fin-tipo"][value="transferencia"])').click();
ok(!(await page.locator('#ff-de option[value="cheques_carteira"]').count()) && !(await page.locator('#ff-para option[value="cheques_carteira"]').count()), "transferência sem Cheques em carteira (de e para)");
const r = await fetch(URL + "/api/lancamento", { method: "POST", headers: H, body: JSON.stringify({ itens: [{ id: "T9", v: 2, conta: "transferencia", value: 500, competencia: "2026-10-20", de: "cheques_carteira", para: "bradesco" }] }) });
ok(r.status === 400, "servidor recusa transferência saindo da carteira");

// 5. Correção numa tela desatualizada (outro aparelho estornou) é recusada
const v1 = (await lanc()).find((l) => l.numero === "V-0001");
const outro = await abrir();
await page.click("#btn-tab-caixa"); await sub(page, "caixa", "lista");
await page.locator(`#fin-lista-body [data-corrigir="${v1.id}"]`).click(); // abre a correção (versão da tela)
await page.waitForFunction(() => document.querySelectorAll("#items-body tr.linha-item").length === 1);
await outro.click("#btn-tab-caixa"); await sub(outro, "caixa", "lista");
await outro.locator(`#fin-lista-body [data-excluir="${v1.id}"]`).click(); // o outro aparelho estorna
await outro.waitForTimeout(500);
await page.click("#btn-registrar-venda");
await page.waitForTimeout(600);
ok(nb(page.dialogos.at(-1)).includes("foi estornada") && (await lanc(true)).find((l) => l.id === v1.id).excluido === true, "corrigir venda estornada em outro aparelho é recusado (o estorno vale)");

// 6. Estornar a venda de um orçamento reabre o orçamento
await page.click("#btn-tab-vender"); await page.click("#limpar-pedido").catch(() => {});
await page.evaluate(() => window.Calculadora.limpar(false));
await page.selectOption("#material", "PINUS"); await page.selectOption("#dimension", "PINUS|1x2x2.50");
await page.fill("#quantity-pieces", "4"); await page.click("#btn-adicionar");
await page.click("#btn-salvar-orcamento");
await page.fill("#orc-nome", "Carlos"); await page.fill("#orc-tel", "(47) 99999-1234");
await page.click("#orc-salvar-botao");
await fecharVias(page, page.dialogos);
await page.click("#btn-tab-orcamentos"); await page.waitForSelector("#orc-body tr");
await page.locator("#orc-body tr", { hasText: "ORC-0001" }).locator('[data-acao="converter"]').click();
await page.click("#orc-converter-orcamento");
await page.waitForSelector("#orc-vinculo:not([hidden])");
await page.click("#btn-registrar-venda");
await fecharVias(page, page.dialogos);
await page.waitForTimeout(400);
let o = JSON.parse((await db()).madeireira_orcamentos["ORC-0001"]);
const vOrc = (await lanc()).find((l) => l.orcamento === "ORC-0001");
ok(o.status === "fechado" && o.vendaId === vOrc.id, "venda do orçamento: o orçamento fecha na mesma gravação");
await page.click("#btn-tab-caixa"); await sub(page, "caixa", "lista");
await page.locator(`#fin-lista-body [data-excluir="${vOrc.id}"]`).click();
await page.waitForTimeout(600);
o = JSON.parse((await db()).madeireira_orcamentos["ORC-0001"]);
ok(o.status === "aberto" && page.dialogos.some((d) => d.includes('ORC-0001 voltou para "Em aberto"')), "estornar a venda reabre o orçamento (e avisa)");
await browser.close();
