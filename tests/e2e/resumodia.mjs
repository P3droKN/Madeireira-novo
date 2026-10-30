// Relatórios › Resumo do dia: abre hoje; panorama do caixa por conta com a gaveta esperado × contado;
// vendido × entrou no caixa; entradas por forma; saídas por conta; lista com estornada riscada e 🖨 Vias;
// dia anterior / período; resultado some no modo balcão; fechamento impresso em 1 página A4.
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
const require = createRequire("/opt/node-tools/node_modules/");
const { chromium } = require("playwright");
const URL = "http://localhost:4321";
const H = { "content-type": "application/json", "x-senha": "pinho123" };
const nb = (s) => (s || "").replace(/ /g, " ");
const ok = (cond, msg) => { console.log((cond ? "OK   " : "FALHA") + " " + msg); if (!cond) process.exitCode = 1; };
const post = (rota, corpo, metodo = "POST") => fetch(URL + rota, { method: metodo, headers: H, body: JSON.stringify(corpo) }).then((r) => r.json());

await post("/api/migrar", {});
await post("/api/migrar?versao=2", {});
await post("/api/config", { abertura: { data: "2026-10-01", contas: { gaveta: 300, bradesco: 1000, picpay: 0, cheques_carteira: 0 } } });
await post("/api/clientes", { cliente: { nome: "Zé da Obra", contaCorrente: true } });
const v = (id, data, valor, pagamentos, extra = {}) => ({ id, v: 2, conta: "venda_produtos", value: valor, competencia: data, pagamentos, ...extra });
const itens = (cmv) => ({ cmv, itens: [{ itemId: "PINUS|1x2x2.50", descricao: "Pinus 1x2 × 2,50 m", acabamento: "BRUTO", quantidade: 10, quantidadeCobrada: 10, unidade: "peça", vendaTotal: 1, custoTotal: cmv }] });
// a ordem do POST é a ordem da hora (criadoEm)
for (const item of [
  { id: "FA1", v: 2, conta: "fiado_anterior", value: 400, competencia: "2026-10-01", clienteId: "C1", cliente: "Zé da Obra", contaCorrente: true },
  v("D19", "2026-10-19", 100, [{ forma: "debito", valor: 100 }], itens(60)),
  v("A20", "2026-10-20", 200, [{ forma: "dinheiro", valor: 200 }], itens(100)),
  v("F20", "2026-10-20", 300, [{ forma: "fiado", valor: 300, fiado: { contaCorrente: true } }], { clienteId: "C1", cliente: "Zé da Obra", ...itens(150) }),
  v("C20", "2026-10-20", 600, [{ forma: "credito_parcelado", valor: 600, parcelas: 3 }]),
  { id: "R20", v: 2, conta: "recebimento", value: 250, competencia: "2026-10-20", clienteId: "C1", cliente: "Zé da Obra", pagamentos: [{ forma: "pix_bradesco", valor: 250 }] },
  { id: "S20", v: 2, conta: "aluguel", value: 500, competencia: "2026-10-20", dataPagamento: "2026-10-20", pagoCom: "bradesco", description: "Aluguel de outubro" },
  { id: "T20", v: 2, conta: "transferencia", value: 100, competencia: "2026-10-20", de: "gaveta", para: "bradesco" },
  v("X20", "2026-10-20", 999, [{ forma: "dinheiro", valor: 999 }], { description: "Venda lançada por engano" }),
]) await post("/api/lancamento", { itens: [item] });
await fetch(URL + "/api/lancamento?id=X20", { method: "DELETE", headers: H });

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 }, locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
const page = await ctx.newPage();
await page.clock.install({ time: new Date("2026-10-20T19:00:00-03:00") });
await page.addInitScript(() => { window.__impressoes = []; window.print = () => window.__impressoes.push(document.getElementById("impressao-via").innerHTML); });
const respostas = [];
page.on("dialog", async (d) => (d.type() === "prompt" ? d.accept(respostas.shift() ?? "") : d.accept()));
page.on("pageerror", (e) => console.log("ERRO JS:", e.message));
const sub = (g, s) => page.click(`.subtabs[data-grupo="${g}"] .subtab[data-sub="${s}"]`);
const txt = async (sel) => nb(await page.textContent(sel));
const linhaConta = async (c) => (await page.$$eval(`#dia-panorama tr[data-conta="${c}"] td.num`, (tds) => tds.map((t) => t.textContent.replace(/ /g, " "))));
const quadro = async (rot) => {
  const num = /^Vendido/.test(rot) ? "vendeu" : /^Entrou/.test(rot) ? "entrou" : /^Saiu/.test(rot) ? "saiu" : null;
  if (num) return nb(await page.locator(`#dia-numeros [data-numero="${num}"] strong`).textContent());
  const linha = nb(await page.textContent("#dia-linha-fiado"));
  const m = linha.match(/^Fiado vendido/.test(rot) ? /Fiado vendido (R\$ [\d.,]+)/ : /Recebido de fiado (R\$ [\d.,]+)/);
  return m && m[1];
};
const abrir = (id) => page.evaluate((i) => { const d = document.getElementById(i); if (d) d.open = true; }, id);

await page.goto(URL);
await page.fill("#senha-input", "pinho123"); await page.click("#senha-form button");
await page.waitForFunction(() => window.Caixa && window.Caixa.migradoV2);

// 1. Fechar gaveta (contou R$ 395, o sistema esperava R$ 400) e o atalho para o resumo
await page.click("#btn-tab-caixa"); await sub("caixa", "saldos");
await page.waitForSelector(".saldo-conta");
await page.locator(".saldo-conta", { hasText: "Gaveta" }).locator("[data-conferir]").click();
await page.waitForSelector("#modal-pergunta", { state: "visible" });
ok(nb(await page.textContent("#perg-texto")).includes("Esperado pelo sistema: R$ 400,00"), "Fechar gaveta: janela própria com o esperado (dados recarregados)");
await page.fill("#perg-campo", "395"); await page.click("#perg-ok");
await page.waitForTimeout(600);
await page.click("#cx-ver-resumo-dia");
await page.waitForSelector("#dia-panorama");
ok(await page.isVisible("#rel-dia-sec") && (await page.getAttribute('.subtabs[data-grupo="relatorios"] .subtab[data-sub="dia"]', "class")).includes("ativo"), "Caixa › Saldos › \"Ver resumo do dia\" abre o Resumo do dia");

// 2. Relatórios abre no dia de hoje
await page.click("#btn-tab-vender"); await page.click("#btn-tab-relatorios");
await page.waitForSelector("#dia-panorama");
ok(await page.inputValue("#dia-data") === "2026-10-20" && (await txt("#dia-numeros h2")).includes("hoje, 20/10/2026"), "Relatórios abre no Resumo do dia, hoje (20/10/2026)");
ok(nb((await page.locator('.subtabs[data-grupo="relatorios"] .subtab').first().textContent())) === "Dia" && nb(await page.locator('.subtabs[data-grupo="relatorios"]').textContent()).includes("Mês"), "\"Dia\" é a primeira sub-aba; \"Mês\" fica ao lado");

// 3. Panorama do caixa por conta
ok((await linhaConta("gaveta")).join("|") === "R$ 300,00|R$ 200,00|—|-R$ 100,00|R$ 400,00", "Gaveta: início 300 + 200 − 0 − 100 (transferência) = 400");
ok((await linhaConta("bradesco")).join("|") === "R$ 1.000,00|R$ 250,00|R$ 500,00|R$ 100,00|R$ 850,00", "Bradesco: 1.000 + 250 (PIX do fiado) − 500 (aluguel) + 100 = 850");
ok((await linhaConta("picpay")).join("|") === "R$ 0,00|R$ 100,00|—|—|R$ 100,00" && (await txt('#dia-panorama tr[data-conta="picpay"]')).includes("de cartão de vendas anteriores"), "PicPay: débito de ontem cai hoje (cartão de vendas anteriores)");
ok((await txt("#dia-total-contas")).includes("R$ 1.350,00"), "total no fim do dia: R$ 1.350,00");
ok((await txt("#dia-gaveta")).includes("contado R$ 395,00 · faltou R$ 5,00 (esperado R$ 400,00)") && (await page.getAttribute("#dia-gaveta", "class")).includes("texto-ruim"), "gaveta: esperado × contado × diferença, em vermelho");

// 4. Quadros, entradas por forma, saídas por conta
ok(await quadro("Vendido hoje") === "R$ 1.100,00" && (await txt("#dia-numeros")).includes("3 pedidos"), "vendido hoje R$ 1.100 em 3 pedidos (o estorno não conta)");
ok(await quadro("Entrou no caixa hoje") === "R$ 550,00" && await quadro("Saiu do caixa hoje") === "R$ 500,00", "entrou R$ 550 (200 + 250 + 100 do débito), saiu R$ 500");
ok(await quadro("Fiado vendido hoje") === "R$ 300,00" && await quadro("Recebido de fiado hoje") === "R$ 250,00" && (await txt("#dia-linha-fiado")).includes("anterior à virada"), "fiado vendido R$ 300; recebido de fiado R$ 250 (fiado anterior à virada)");
ok((await txt("#dia-entradas-total")) === "R$ 1.350,00" && (await txt("#dia-entradas")).includes("Crédito parcelado 3x") && (await txt("#dia-entradas")).includes("não entra no caixa"), "entradas por forma: total = vendido + recebimentos (R$ 1.350)");
ok((await txt("#dia-saidas")).includes("Despesas fixas") && (await txt("#dia-saidas")).includes("Bradesco"), "saídas por conta, com o \"Pago com\"");

// 5. Lista detalhada: ordem de hora, número, estornada riscada, filtros, 🖨 Vias
ok(!(await page.getAttribute("#dia-movimentos", "open")) && (await txt("#dia-movimentos summary")).includes("movimentos"), "movimentos começam recolhidos (\"Ver os N movimentos\")");
await abrir("dia-movimentos");
ok((await page.locator("#dia-lista tbody tr.estornado").count()) === 1 && (await txt("#dia-lista tbody tr.estornado")).includes("estornada"), "estornada aparece riscada, sem somar");
ok((await txt("#dia-lista tbody")).includes("V-0002"), "vendas com o número V-000X");
await page.locator('label:has(input[name="dia-filtro"][value="vendas"])').click();
ok((await page.locator("#dia-lista tbody tr").count()) === 4, "filtro Vendas (3 + a estornada)");
await page.locator('label:has(input[name="dia-filtro"][value="fiado"])').click();
ok((await page.locator("#dia-lista tbody tr").count()) === 2, "filtro Fiado: a venda fiado e o recebimento");
await page.locator('label:has(input[name="dia-filtro"][value="todos"])').click();
await page.locator("#dia-lista [data-dia-vias]").first().click();
await page.waitForSelector("#modal-impressao", { state: "visible" });
ok((await txt("#imp-previa-folha")).includes("PEDIDO Nº V-0002"), "🖨 Vias na lista abre o pedido para (re)imprimir");
await page.click("#imp-fechar");

// 6. Resultado do dia (controle interno) e modo balcão
await abrir("dia-detalhes");
ok(await page.isVisible("#dia-resultado") && (await txt("#dia-resultado")).includes("R$ 1.100,00") && (await txt("#dia-resultado")).includes("R$ 550,00"), "resultado: vendas R$ 1.100 − CMV R$ 550 (itens 250 + estimado 300)");
await page.click("#btn-tab-vender"); await page.click("#btn-balcao"); await page.click("#btn-tab-relatorios");
await page.waitForSelector("#dia-panorama");
ok(await page.isHidden("#dia-resultado"), "o resultado some no modo balcão");
await page.click("#btn-tab-vender"); await page.click("#btn-balcao"); await page.click("#btn-tab-relatorios");
await page.waitForSelector("#dia-panorama");

// 7. Dia anterior e período
await page.click("#dia-ant");
ok(await page.inputValue("#dia-data") === "2026-10-19" && await quadro("Vendido no dia") === "R$ 100,00", "◀ dia anterior: 19/10, vendido R$ 100");
await page.click("#dia-periodo");
await page.fill("#dia-ate", "2026-10-20"); await page.dispatchEvent("#dia-ate", "change");
ok(await quadro("Vendido no período") === "R$ 1.200,00" && (await txt("#dia-numeros h2")).includes("de 19/10/2026 a 20/10/2026"), "período 19 a 20/10: vendido R$ 1.200");
await page.click("#dia-hoje");

// 8. Imprimir fechamento: 1 página A4, com conferido por; sem custo quando pedido
await page.click("#dia-imprimir");
await page.waitForFunction(() => window.__impressoes.length === 1);
const fech = (await page.evaluate(() => window.__impressoes))[0];
await page.evaluate((h) => {
  document.getElementById("impressao-via").innerHTML = h;
  const st = document.createElement("style"); st.textContent = "@page { size: A4; margin: 0; }"; document.head.appendChild(st);
  document.body.classList.add("imprimindo-via");
}, fech);
await page.emulateMedia({ media: "print" });
const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true, path: "fechamento.pdf" });
await page.emulateMedia({ media: "screen" });
await page.evaluate(() => document.body.classList.remove("imprimindo-via"));
const paginas = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
let texto = "";
try { texto = nb(execFileSync("pdftotext", ["fechamento.pdf", "-"], { encoding: "utf8" })); } catch { texto = nb(fech.replace(/<[^>]+>/g, " ")); }
ok(paginas === 1, `fechamento do dia em 1 página A4 (${paginas})`);
ok(texto.includes("Conferido por") && texto.includes("faltou R$ 5,00") && texto.includes("Caixa por conta") && /lucro bruto/i.test(texto), "fechamento: quadros, movimento por conta, gaveta, resultado e \"Conferido por\"");
await page.click("#dia-sem-custo");
await page.click("#dia-imprimir");
await page.waitForFunction(() => window.__impressoes.length === 2);
ok(!/lucro bruto|custo das vendas/i.test((await page.evaluate(() => window.__impressoes))[1]), "\"imprimir sem custo e margem\" tira o resultado");
await page.screenshot({ path: "resumodia.png", fullPage: true });
await browser.close();
