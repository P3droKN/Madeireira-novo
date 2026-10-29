// Impressão em vias (seção B): janela com 2 vias / só loja / só cliente (lembrada), prévia, folha A4 no Chrome
// (1 página com 5 itens; página inteira por via com 15), soma das linhas = total, nada de controle interno,
// Baixar PDF, reimpressão marcada, número na lista e na busca, corrigir venda (mesmo número) e estorno.
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
const require = createRequire("/opt/node-tools/node_modules/");
const { chromium } = require("playwright");
import { fecharVias } from "./janela.mjs";
const URL = "http://localhost:4321";
const H = { "content-type": "application/json", "x-senha": "pinho123" };
const nb = (s) => (s || "").replace(/ /g, " ");
const ok = (cond, msg) => { console.log((cond ? "OK   " : "FALHA") + " " + msg); if (!cond) process.exitCode = 1; };
const db = async () => (await fetch(URL + "/__db")).json();
const lanc = async (comExcluidos = false) => Object.values((await db()).madeireira_lancamentos || {}).map((x) => JSON.parse(x)).filter((l) => comExcluidos || !l.excluido);
const centavos = (t) => Math.round(Number(nb(t).replace(/[^\d,−-]/g, "").replace(/\./g, "").replace(",", ".").replace("−", "-")) * 100);

await fetch(URL + "/api/migrar", { method: "POST", headers: H });
await fetch(URL + "/api/migrar?versao=2", { method: "POST", headers: H });
await fetch(URL + "/api/config", { method: "POST", headers: H, body: JSON.stringify({ abertura: { data: "2026-10-01", contas: { gaveta: 300, bradesco: 1000, picpay: 0, cheques_carteira: 0 } } }) });
await fetch(URL + "/api/precos", { method: "POST", headers: H, body: JSON.stringify({ alteracoes: {
  "PINUS|1x2x2.50|BRUTO": 4.5, "PINUS|1x3x2.50|BRUTO": 6.7, "PINUS|1x4x2.50|BRUTO": 8.9, "CEDRO_MESCLADO|1x2|BRUTO": 8.8, "FORRO|CEDRO_MESCLADO_CURTO|UNICO": 34.9,
} }) });

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 }, locale: "pt-BR", timezoneId: "America/Sao_Paulo", acceptDownloads: true });
const page = await ctx.newPage();
await page.clock.install({ time: new Date("2026-10-25T14:32:00-03:00") });
// window.print: guarda o HTML da folha (a PDF de verdade é gerada abaixo, com o mesmo estado da impressão)
await page.addInitScript(() => { window.__impressoes = []; window.print = () => window.__impressoes.push(document.getElementById("impressao-via").innerHTML); });
const dialogos = [];
let recusar = false;
page.on("dialog", async (d) => { dialogos.push(d.message()); if (d.type() === "confirm" && recusar) { recusar = false; return d.dismiss(); } await d.accept(); });
page.on("pageerror", (e) => console.log("ERRO JS:", e.message));
const sub = (g, s) => page.click(`.subtabs[data-grupo="${g}"] .subtab[data-sub="${s}"]`);
const muda = async (loc, v) => { await loc.fill(String(v)); await loc.dispatchEvent("change"); await page.waitForTimeout(80); };
const add = async (mat, dim, qtd, comp) => {
  await page.selectOption("#material", mat); await page.selectOption("#dimension", dim);
  await page.fill("#quantity-pieces", String(qtd)); if (comp) await page.fill("#quantity-length", String(comp));
  await page.click("#btn-adicionar");
};
const impressoes = () => page.evaluate(() => window.__impressoes);
// Gera o PDF no Chrome com a folha impressa por último (mesmo CSS e @page da impressão)
async function pdfDaUltimaImpressao(nome) {
  const html = (await impressoes()).at(-1);
  await page.evaluate((h) => {
    document.getElementById("impressao-via").innerHTML = h;
    const st = document.createElement("style"); st.id = "pdf-teste"; st.textContent = "@page { size: A4; margin: 0; }"; document.head.appendChild(st);
    document.body.classList.add("imprimindo-via");
  }, html);
  await page.emulateMedia({ media: "print" });
  const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true, path: nome });
  await page.emulateMedia({ media: "screen" });
  await page.evaluate(() => { document.body.classList.remove("imprimindo-via"); document.getElementById("pdf-teste").remove(); });
  const paginas = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
  let texto = "";
  try { texto = execFileSync("pdftotext", [nome, "-"], { encoding: "utf8" }); } catch { texto = null; }
  return { paginas, texto };
}

await page.goto(URL);
await page.fill("#senha-input", "pinho123"); await page.click("#senha-form button");
await page.waitForFunction(() => document.getElementById("catalogo-status").textContent.includes("itens"));
await page.waitForFunction(() => window.Caixa && window.Caixa.migradoV2);

// 1. Ajustes › Impressão: cabeçalho da loja
await page.click("#btn-tab-ajustes"); await sub("ajustes", "impressao");
await page.fill("#imp-cfg-nome", "Madeireira Teste"); await page.fill("#imp-cfg-telefone", "WhatsApp (47) 0000-0000"); await page.fill("#imp-cfg-endereco", "Rua Exemplo, 123");
await page.click("#aj-impressao-form button[type=submit]");
await page.waitForTimeout(400);
const cfg = JSON.parse((await db()).madeireira_config_financeiro);
ok(cfg.impressao.nome === "Madeireira Teste" && cfg.impressao.cnpj === "" && cfg.cartao, "Ajustes › Impressão salva o cabeçalho (sem mexer no resto da configuração)");

// 2. Pedido de 5 itens com −3% (centavos quebrados), registrado: janela "Venda V-0001 registrada"
await page.click("#btn-tab-vender");
await add("PINUS", "PINUS|1x2x2.50", 10); await add("PINUS", "PINUS|1x3x2.50", 7); await add("PINUS", "PINUS|1x4x2.50", 3);
await add("CEDRO_MESCLADO", "CEDRO_MESCLADO|1x2", 6, 2.5); await add("FORRO", "FORRO|CEDRO_MESCLADO_CURTO", 12.5);
await page.waitForFunction(() => document.querySelectorAll("#items-body tr.linha-item").length === 5);
await muda(page.locator("#pct-geral"), -3);
const totalTela = nb(await page.inputValue("#total-final"));
ok(await page.isVisible("#btn-imprimir-vias") && nb(await page.textContent("#btn-imprimir-vias")).includes("Imprimir 2 vias"), "Vender: botão 🖨 Imprimir 2 vias ao lado de Registrar e Salvar orçamento");
await page.click("#btn-imprimir-vias");
await page.waitForSelector("#modal-impressao", { state: "visible" });
ok(nb(await page.textContent("#imp-previa-folha")).includes("PEDIDO (rascunho, ainda não registrado)"), "antes de registrar: prévia como rascunho, sem número");
await page.click("#imp-fechar");
await page.click("#btn-registrar-venda");
await page.waitForSelector("#modal-impressao", { state: "visible" });
ok(nb(await page.textContent("#imp-titulo")) === "Venda V-0001 registrada", "janela \"Venda V-0001 registrada\" (qualquer forma de pagamento)");
ok(await page.isChecked('input[name="imp-modo"][value="duas"]'), "2 vias: loja + cliente vem marcado");
const previa = nb(await page.textContent("#imp-previa-folha"));
ok(previa.includes("Madeireira Teste") && previa.includes("VIA DA LOJA") && previa.includes("VIA DO CLIENTE") && previa.includes("PEDIDO Nº V-0001") && previa.includes("25/10/2026 às 14:32") && previa.includes("Consumidor"), "prévia: cabeçalho da loja, as 2 vias, número, data e hora, cliente \"Consumidor\"");
// a soma das linhas de uma via fecha com o total
const linhas = await page.$$eval("#imp-previa-folha .pv-via:first-child tbody tr td:last-child", (tds) => tds.map((t) => t.textContent));
const totalVia = await page.textContent("#imp-previa-folha .pv-via:first-child tr.pv-total td:last-child");
ok(linhas.length === 5 && linhas.reduce((s, t) => s + centavos(t), 0) === centavos(totalVia) && centavos(totalVia) === Math.round(Number(totalTela) * 100),
  `soma das 5 linhas impressas = total (${nb(totalVia)})`);
await page.click("#imp-imprimir");
await page.waitForFunction(() => window.__impressoes.length === 1);
const p5 = await pdfDaUltimaImpressao("pedido-5-itens.pdf");
ok(p5.paginas === 1, "Chrome: 2 vias de um pedido de 5 itens numa única folha A4");
if (p5.texto != null) ok(!/custo|margem|tabela|%|selecionada|últimas peças/i.test(p5.texto) && p5.texto.includes("V-0001"), "PDF sem \"custo\", \"margem\", \"tabela\" nem \"%\"");
const v1 = (await lanc()).find((l) => l.numero === "V-0001");
ok(v1?.impressoEm, "primeira impressão fica registrada na venda");
// 1 via: escolha lembrada no aparelho
await page.locator('label:has(input[name="imp-modo"][value="cliente"])').click();
ok(!nb(await page.textContent("#imp-previa-folha")).includes("VIA DA LOJA") && nb(await page.textContent("#imp-previa-folha")).includes("VIA DO CLIENTE"), "1 via: só do cliente, na metade de cima");
await page.click("#imp-fechar");

// 3. Baixar PDF (arquivo de verdade, para mandar no WhatsApp)
await page.click("#btn-tab-caixa"); await sub("caixa", "lista");
await page.waitForSelector("#fin-lista-body [data-vias]");
ok(nb(await page.textContent("#fin-lista-body")).includes("V-0001"), "Caixa › Lançamentos: coluna Nº com V-0001");
await page.locator(`#fin-lista-body [data-vias="${v1.id}"]`).click();
await page.waitForSelector("#modal-impressao", { state: "visible" });
ok(await page.isChecked('input[name="imp-modo"][value="cliente"]'), "a janela lembra a última escolha (só do cliente)");
const [download] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), page.click("#imp-pdf")]);
const arq = await download.path();
ok(download.suggestedFilename() === "Pedido V-0001.pdf" && fs.statSync(arq).size > 10000 && fs.readFileSync(arq).slice(0, 5).toString() === "%PDF-", `Baixar PDF: ${download.suggestedFilename()} (${Math.round(fs.statSync(arq).size / 1024)} KB)`);
await page.locator('label:has(input[name="imp-modo"][value="duas"])').click();
await page.click("#imp-imprimir");
await page.waitForFunction(() => window.__impressoes.length === 2);
ok(nb((await impressoes()).at(-1)).includes("2ª impressão em 25/10/2026"), "reimpressão pelo Caixa marcada \"2ª impressão em DD/MM\"");
await page.click("#imp-fechar");

// 4. Busca pelo número
for (const termo of ["V-0001", "1", "v1"]) {
  await page.fill("#fin-f-busca", termo); await page.dispatchEvent("#fin-f-busca", "input");
  await page.waitForTimeout(150);
  ok((await page.locator("#fin-lista-body [data-vias]").count()) === 1, `busca "${termo}" acha a venda V-0001`);
}
await page.fill("#fin-f-busca", ""); await page.dispatchEvent("#fin-f-busca", "input");

// 5. Pedido de 15 itens: cada via numa página inteira, com aviso
await page.click("#btn-tab-vender");
for (let i = 1; i <= 15; i++) await add("PINUS", ["PINUS|1x2x2.50", "PINUS|1x3x2.50", "PINUS|1x4x2.50"][i % 3], i);
await page.waitForFunction(() => document.querySelectorAll("#items-body tr.linha-item").length === 15);
await page.click("#btn-registrar-venda");
await page.waitForSelector("#modal-impressao", { state: "visible" });
ok(nb(await page.textContent("#imp-titulo")) === "Venda V-0002 registrada" && await page.isVisible("#imp-aviso"), "15 itens: aviso \"cada via vai numa página inteira\"");
await page.click("#imp-imprimir");
await page.waitForFunction(() => window.__impressoes.length === 3);
const p15 = await pdfDaUltimaImpressao("pedido-15-itens.pdf");
ok(p15.paginas === 2, `Chrome: 15 itens = 2 páginas (uma por via): ${p15.paginas}`);
await page.click("#imp-fechar");

// 6. Corrigir venda: volta ao Vender, mantém o número, guarda o histórico
await page.click("#btn-tab-caixa"); await sub("caixa", "lista");
await page.waitForSelector(`#fin-lista-body [data-corrigir="${v1.id}"]`);
await page.locator(`#fin-lista-body [data-corrigir="${v1.id}"]`).click();
await page.waitForFunction(() => document.querySelectorAll("#items-body tr.linha-item").length === 5);
ok(nb(await page.textContent("#orc-vinculo")).includes("Corrigindo a venda V-0001") && nb(await page.textContent("#btn-registrar-venda")).includes("Salvar correção da V-0001"), "Corrigir: a venda volta para o Vender com os itens");
ok(nb(await page.inputValue("#total-final")) === totalTela, `os preços vendidos voltam iguais (total ${totalTela})`);
await page.locator("#items-body tr.linha-item").last().locator(".delete-btn").click(); // tira o forro
await page.waitForFunction(() => document.querySelectorAll("#items-body tr.linha-item").length === 4);
await page.click("#btn-registrar-venda");
await page.waitForSelector("#modal-impressao", { state: "visible" });
ok(nb(await page.textContent("#imp-titulo")) === "Venda V-0001 corrigida", "depois de corrigir, a janela das vias na hora");
await page.click("#imp-fechar");
const v1c = (await lanc()).find((l) => l.id === v1.id);
ok(v1c.numero === "V-0001" && v1c.value < v1.value && v1c.cmv < v1.cmv && v1c.itens.length === 4 && v1c.historico?.[0]?.valorAntes === v1.value && (await lanc()).filter((l) => l.conta === "venda_produtos").length === 2,
  `corrigida: mesmo número, valor ${v1.value} → ${v1c.value}, custo recalculado, histórico "antes R$ ${v1.value}"`);
ok(nb(await page.inputValue("#direct-sale-date")) === "2026-10-25", "depois de corrigir, o Vender volta para a data de hoje");

// 7. Venda sem itens (Caixa): corrigir no próprio Caixa › Lançar
await page.click("#btn-tab-caixa"); await sub("caixa", "lancar");
await page.fill("#ff-valor", "150"); await page.dispatchEvent("#ff-valor", "input");
await page.click("#fin-form button[type=submit]");
const t3 = await fecharVias(page, dialogos);
ok(t3.includes("Venda V-0003 registrada"), "venda do Caixa: janela \"Venda V-0003 registrada\"");
const v3 = (await lanc()).find((l) => l.numero === "V-0003");
await sub("caixa", "lista");
await page.locator(`#fin-lista-body [data-corrigir="${v3.id}"]`).click();
await page.waitForSelector("#ff-corrigindo");
ok(await page.inputValue("#ff-valor") === "150.00" && nb(await page.textContent("#ff-corrigindo")).includes("V-0003"), "sem itens: o Caixa › Lançar volta preenchido para corrigir");
await page.fill("#ff-valor", "180"); await page.dispatchEvent("#ff-valor", "input");
await page.click("#fin-form button[type=submit]");
const t3c = await fecharVias(page, dialogos);
const v3c = (await lanc()).find((l) => l.id === v3.id);
ok(t3c.includes("Venda V-0003 corrigida") && v3c.value === 180 && v3c.numero === "V-0003" && v3c.historico[0].valorAntes === 150, "corrigida no Caixa: mesmo número, R$ 150 → R$ 180");

// 8. Estornar: mantém o número; a próxima venda não reaproveita
await sub("caixa", "lista");
await page.locator(`#fin-lista-body [data-excluir="${v3.id}"]`).click();
await page.waitForTimeout(500);
const est = (await lanc(true)).find((l) => l.id === v3.id);
ok(est.excluido && est.numero === "V-0003", "estornada: o número V-0003 continua na venda, marcada como estornada");
await sub("caixa", "lancar");
await page.fill("#ff-valor", "50"); await page.dispatchEvent("#ff-valor", "input");
await page.click("#fin-form button[type=submit]");
ok((await fecharVias(page, dialogos)).includes("V-0004"), "a venda seguinte é V-0004 (número estornado não é reaproveitado)");

// 9. Orçamento salvo: janela com as vias do orçamento
await page.click("#btn-tab-vender");
await add("PINUS", "PINUS|1x2x2.50", 10);
await page.click("#btn-salvar-orcamento");
await page.fill("#orc-nome", "Carlos"); await page.fill("#orc-tel", "(47) 99999-1234");
await page.click("#orc-salvar-botao");
await page.waitForSelector("#modal-impressao", { state: "visible" });
const po = nb(await page.textContent("#imp-previa-folha"));
ok(nb(await page.textContent("#imp-titulo")).includes("Orçamento ORC-0001 salvo") && po.includes("ORÇAMENTO Nº ORC-0001") && po.includes("Válido até") && !po.includes("Assinatura") && !po.includes("Forma de pagamento"),
  "orçamento: janela \"Orçamento ORC-0001 salvo\", com Válido até, sem assinatura e sem forma de pagamento");
await page.screenshot({ path: "impressao.png" });
await page.click("#imp-fechar");
await browser.close();
