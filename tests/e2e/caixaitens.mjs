// Caixa › Lançar › Venda com itens: mesmo catálogo e mesmo cálculo do Vender (CMV igual), sem itens o CMV
// é estimado (margem padrão 50%) e o DRE separa o calculado pelos itens do estimado.
import { createRequire } from "node:module";
const require = createRequire("/opt/node-tools/node_modules/");
const { chromium } = require("playwright");
import { fecharVias } from "./janela.mjs";
const URL = "http://localhost:4321";
const H = { "content-type": "application/json", "x-senha": "pinho123" };
const nb = (s) => (s || "").replace(/ /g, " ");
const ok = (cond, msg) => { console.log((cond ? "OK   " : "FALHA") + " " + msg); if (!cond) process.exitCode = 1; };
const lanc = async () => Object.values((await (await fetch(URL + "/__db")).json()).madeireira_lancamentos || {}).map((x) => JSON.parse(x)).filter((l) => !l.excluido);

await fetch(URL + "/api/migrar", { method: "POST", headers: H });
await fetch(URL + "/api/migrar?versao=2", { method: "POST", headers: H });
await fetch(URL + "/api/config", { method: "POST", headers: H, body: JSON.stringify({ abertura: { data: "2026-10-01", contas: { gaveta: 300, bradesco: 1000, picpay: 0, cheques_carteira: 0 } } }) });
await fetch(URL + "/api/precos", { method: "POST", headers: H, body: JSON.stringify({ alteracoes: { "PINUS|2x4x3.00|BRUTO": 25, "CEDRO_MESCLADO|1x2|BRUTO": 8 } }) });

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 }, locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
const page = await ctx.newPage();
await page.clock.install({ time: new Date("2026-10-10T10:00:00-03:00") });
const dialogos = [];
page.on("dialog", async (d) => { dialogos.push(d.message()); await d.accept(); });
page.on("pageerror", (e) => console.log("ERRO JS:", e.message));
const sub = (g, s) => page.click(`.subtabs[data-grupo="${g}"] .subtab[data-sub="${s}"]`);

await page.goto(URL);
await page.fill("#senha-input", "pinho123"); await page.click("#senha-form button");
await page.waitForFunction(() => document.getElementById("catalogo-status").textContent.includes("itens"));
await page.waitForFunction(() => window.Caixa && window.Caixa.migradoV2);

// 1. O pedido no Vender: 10 peças de Pinus 2x4x3,00 + 6 peças de Cedro 1x2 × 2,50 m
await page.selectOption("#material", "PINUS"); await page.selectOption("#dimension", "PINUS|2x4x3.00");
await page.fill("#quantity-pieces", "10"); await page.click("#btn-adicionar");
await page.selectOption("#material", "CEDRO_MESCLADO"); await page.selectOption("#dimension", "CEDRO_MESCLADO|1x2");
await page.fill("#quantity-pieces", "6"); await page.fill("#quantity-length", "2.5"); await page.click("#btn-adicionar");
await page.click("#btn-registrar-venda");
await fecharVias(page, dialogos);
await page.waitForFunction(() => document.querySelectorAll("#items-body tr.linha-item").length === 0);
const v1 = (await lanc()).find((l) => l.origem === "calculadora");
ok(v1 && v1.itens.length === 2 && v1.value === 370 && v1.cmv > 0, `Vender: pedido de 2 itens, R$ 370 (250 + 120), CMV R$ ${v1?.cmv}`);

// 2. O mesmo pedido pelo Caixa › Lançar › Venda
await page.click("#btn-tab-caixa"); await sub("caixa", "lancar");
await page.waitForSelector("#ic-material");
ok(await page.isVisible("#ff-itens-aviso") && nb(await page.textContent("#ff-itens-aviso")).includes("Sem itens, o custo será estimado"), "sem itens: aviso de custo estimado");
ok(await page.isVisible("#ff-cmv"), "sem itens: campo manual do CMV aparece");
await page.selectOption("#ic-material", "PINUS"); await page.selectOption("#ic-medida", "PINUS|2x4x3.00");
ok(await page.inputValue("#ic-preco") === "25.00", "preço de venda vem da tabela (R$ 25,00), editável");
await page.fill("#ic-qtd", "10"); await page.click("#ic-adicionar");
await page.selectOption("#ic-material", "CEDRO_MESCLADO"); await page.selectOption("#ic-medida", "CEDRO_MESCLADO|1x2");
ok(await page.isVisible("#ic-comp"), "metro linear pede o comprimento");
await page.fill("#ic-qtd", "6"); await page.fill("#ic-comp", "2.5"); await page.click("#ic-adicionar");
await page.waitForFunction(() => document.querySelectorAll("#ic-tabela tbody tr").length === 2);
ok(await page.inputValue("#ff-valor") === "370.00" && await page.getAttribute("#ff-valor", "readonly") !== null, "com itens: total calculado pelos itens (R$ 370,00), só leitura");
ok(await page.isHidden("#ff-cmv-grupo") && await page.isHidden("#ff-itens-aviso"), "com itens: some o CMV manual e o aviso");
ok(nb(await page.textContent("#ff-cmv-calculado")).includes(nb(new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v1.cmv))), "mostra o custo calculado, só para leitura");
await page.click("#fin-form button[type=submit]");
await fecharVias(page, dialogos);
await page.waitForTimeout(600);
const v2 = (await lanc()).find((l) => l.conta === "venda_produtos" && l.id !== v1.id && l.itens?.length);
ok(v2 && v2.cmv === v1.cmv && v2.value === v1.value, `Caixa: CMV igual ao do mesmo pedido no Vender (R$ ${v2?.cmv} = R$ ${v1.cmv})`);
ok(v2.itens.map((i) => [i.itemId, i.quantidadeCobrada, i.vendaTotal, i.custoTotal]).join() === v1.itens.map((i) => [i.itemId, i.quantidadeCobrada, i.vendaTotal, i.custoTotal]).join(), "itens gravados iguais aos do Vender");
ok(v2.numero === "V-0002" && dialogos.at(-1).includes("Venda V-0002 registrada"), "a venda do Caixa também recebe número (V-0002)");

// 3. Preço editado na linha
await page.waitForSelector("#ic-material");
await page.selectOption("#ic-material", "PINUS"); await page.selectOption("#ic-medida", "PINUS|2x4x3.00");
await page.fill("#ic-qtd", "4"); await page.click("#ic-adicionar");
await page.waitForSelector(".ic-preco-linha");
await page.fill(".ic-preco-linha", "22"); await page.dispatchEvent(".ic-preco-linha", "change");
await page.waitForFunction(() => document.getElementById("ff-valor").value === "88.00");
ok(true, "preço unitário editado na linha (4 × R$ 22 = R$ 88)");
await page.click("#ic-tabela .ic-remover");
await page.waitForFunction(() => !document.getElementById("ic-tabela"));
ok(await page.getAttribute("#ff-valor", "readonly") === null && await page.isVisible("#ff-cmv"), "removeu o último item: volta o valor digitado e o CMV manual");

// 4. Venda rápida sem itens: CMV estimado = venda × (1 − 50%)
await page.fill("#ff-valor", "1000"); await page.dispatchEvent("#ff-valor", "input");
await page.click("#fin-form button[type=submit]");
await fecharVias(page, dialogos);
await page.waitForTimeout(600);
const v3 = (await lanc()).find((l) => l.value === 1000 && l.conta === "venda_produtos");
ok(v3 && v3.cmv == null && !v3.itens, "venda sem itens gravada sem custo (o DRE estima)");

// 5. DRE: calculado pelos itens × estimado
await page.click("#btn-tab-relatorios"); await sub("relatorios", "dre");
await page.waitForSelector("#dre-cmv-origem");
const brl = (v) => nb(new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v));
const itensTxt = nb(await page.textContent("#dre-cmv-itens"));
const estTxt = nb(await page.textContent("#dre-cmv-estimado"));
ok(itensTxt.includes(brl(v1.cmv * 2)), `DRE: calculado pelos itens ${brl(v1.cmv * 2)}`);
ok(estTxt.includes("R$ 500,00"), "DRE: estimado R$ 500,00 (R$ 1.000 × 50%)");
const total = v1.cmv * 2 + 500;
ok(estTxt.includes(`(${Math.round(500 / total * 100)}%)`) && itensTxt.includes(`(${Math.round(v1.cmv * 2 / total * 100)}%)`), "DRE: percentuais de cada parte");
ok(nb(await page.textContent("#fin-dre-conteudo")).includes("margem padrão de 50,0%"), "margem padrão inicial de 50%");
ok(nb(await page.textContent("#dre-modo")).includes("Estimativas contábeis desligadas") && !(await page.locator("#fin-dre-conteudo tr", { hasText: "Provisão" }).count()) && !nb(await page.textContent("#fin-dre-conteudo")).includes("RBT12"),
  "padrão: estimativas contábeis desligadas (sem provisão, sem pendência de RBT12) e dito no rodapé");
await page.screenshot({ path: "caixaitens.png", fullPage: true });
await browser.close();
