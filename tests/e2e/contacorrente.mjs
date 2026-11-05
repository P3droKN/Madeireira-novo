// Conta corrente (clientes antigos e de confiança, a "pasta" de vias): fiado sem vencimento, nunca atrasado,
// "em aberto há X dias", alertas opcionais, A receber separado, 2 vias para a pasta, fiado anterior na abertura
// marcando o cliente e o recebido de fiado anterior como informação no DRE e no fluxo de caixa.
import { createRequire } from "node:module";
import { salvarCadastro, irClientes, abrirFicha } from "./janela.mjs";
const require = createRequire("/opt/node-tools/node_modules/");
const { chromium } = require("playwright");
const URL = "http://localhost:4321";
const H = { "content-type": "application/json", "x-senha": "pinho123" };
const nb = (s) => (s || "").replace(/ /g, " ");
const ok = (cond, msg) => { console.log((cond ? "OK   " : "FALHA") + " " + msg); if (!cond) process.exitCode = 1; };
const db = async () => (await fetch(URL + "/__db")).json();
const lanc = async () => Object.values((await db()).madeireira_lancamentos || {}).map((x) => JSON.parse(x)).filter((l) => !l.excluido);
const clientes = async () => Object.values((await db()).madeireira_clientes || {}).map((x) => JSON.parse(x));

await fetch(URL + "/api/config", { method: "POST", headers: H, body: JSON.stringify({ abertura: { data: "2026-10-01", contas: { gaveta: 300, bradesco: 1000, picpay: 0, cheques_carteira: 0 } } }) });
await fetch(URL + "/api/precos", { method: "POST", headers: H, body: JSON.stringify({ alteracoes: { "PINUS|2x4x3.00|BRUTO": 25 } }) });
// Meses anteriores (para o quadro "quanto preciso vender para empatar"): aluguel em ago e set, uma venda em set
await fetch(URL + "/api/lancamento", { method: "POST", headers: H, body: JSON.stringify({ itens: [
  { id: "SAL08", v: 2, conta: "aluguel", value: 3000, competencia: "2026-08-05", pagoCom: "bradesco" },
  { id: "SAL09", v: 2, conta: "aluguel", value: 3000, competencia: "2026-09-05", pagoCom: "bradesco" },
  { id: "VSET", v: 2, conta: "venda_produtos", value: 10000, cmv: 6000, competencia: "2026-09-15", pagamentos: [{ forma: "pix_bradesco", valor: 10000 }] },
] }) });

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 }, locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
const page = await ctx.newPage();
await page.clock.install({ time: new Date("2026-10-10T10:00:00-03:00") });
// Impressão: guarda o que estava na folha em vez de abrir a janela do navegador
await page.addInitScript(() => { window.__impressoes = []; window.print = () => window.__impressoes.push(document.getElementById("impressao-via")?.innerText || ""); });
const dialogos = [];
const respostas = [];
let recusarProximo = false; // próximo confirm: responder "Cancelar"
page.on("dialog", async (d) => {
  dialogos.push(d.message());
  if (d.type() === "prompt") return d.accept(respostas.shift() ?? "");
  if (d.type() === "confirm" && recusarProximo) { recusarProximo = false; return d.dismiss(); }
  return d.accept();
});
page.on("pageerror", (e) => console.log("ERRO JS:", e.message));
const sub = (g, s) => page.click(`.subtabs[data-grupo="${g}"] .subtab[data-sub="${s}"]`);
const irReceber = async () => { await page.click("#btn-tab-caixa"); await sub("caixa", "receber"); await page.waitForSelector("#fin-receber .receber-cards"); };
const impressoes = () => page.evaluate(() => window.__impressoes);

await page.goto(URL);
await page.fill("#senha-input", "pinho123"); await page.click("#senha-form button");
await page.waitForFunction(() => document.getElementById("catalogo-status").textContent.includes("itens"));
await page.waitForFunction(() => window.Caixa && window.Caixa.migradoV2);

// 1. Cadastro: Seu Arlindo, "sem prazo" com alerta de limite R$ 500 (dias em branco = sem alerta)
await irClientes(page);
await page.click("#cli-novo");
await page.waitForSelector("#modal-cliente", { state: "visible" });
ok(await page.locator("#cli-limite").isHidden() && await page.isChecked('input[name="cli-prazo"][value="padrao"]') && nb(await page.textContent("#cli-prazo")).includes("30 dias (padrão)"),
  "cadastro: prazo padrão (30 dias) marcado; alertas escondidos");
await page.fill("#cli-nome", "Seu Arlindo");
await page.check('input[name="cli-prazo"][value="sem"]');
ok(await page.locator("#cli-limite").isVisible(), "marcou \"Sem prazo (acerta quando juntar)\": aparecem o limite e os dias do alerta");
await salvarCadastro(page, { limite: 500 });
await page.waitForSelector(".ficha-cliente");
let arlindo = (await clientes()).find((c) => c.nome === "Seu Arlindo");
ok(arlindo?.contaCorrente === true && arlindo.alertaLimite === 500 && arlindo.alertaDias === null && arlindo.prazoDias === null, "cadastro: sem prazo, limite R$ 500, sem alerta de dias");
ok(nb(await page.textContent(".ficha-cliente")).includes("Sem prazo (acerta quando juntar)") && nb(await page.textContent(".ficha-cliente")).includes("limite R$ 500,00"), "ficha mostra o prazo e o alerta");

// 2. Abertura: fiado da pasta da Dona Cida (cliente novo), conta corrente já vem marcado
await page.click("#btn-tab-ajustes"); await sub("ajustes", "saldos");
await page.waitForSelector("#cx-ab-fiado");
ok(await page.isChecked("#cx-fa-cc") && await page.locator("#cx-fa-venc").isHidden() && nb(await page.textContent("#cx-ab-fiado")).includes("Sem prazo (acerta quando juntar)"), "fiado anterior: Sem prazo vem marcado e o vencimento some");
await page.fill("#cx-fa-cliente", "Dona Cida"); await page.fill("#cx-fa-valor", "600");
await page.click("#cx-ab-fiado button[type=submit]");
await salvarCadastro(page); // cliente novo: o cadastro abre com o nome
await page.waitForFunction(() => document.getElementById("aj-abertura").textContent.includes("Dona Cida"));
const fa = (await lanc()).find((l) => l.conta === "fiado_anterior");
ok(fa && fa.contaCorrente === true && !fa.vencimento && fa.value === 600, "fiado anterior gravado sem vencimento (sem prazo)");
ok((await clientes()).find((c) => c.nome === "Dona Cida")?.contaCorrente === true, "Dona Cida ficou marcada como sem prazo no cadastro");
ok(nb(await page.textContent("#aj-abertura")).includes("sem prazo") && !/conta corrente/i.test(await page.textContent("#aj-abertura")), "lista do fiado anterior mostra \"sem prazo\" no lugar da data (nada de \"conta corrente\")");
// Mesmo cliente de novo: avisa antes de somar (aqui, Cancelar)
await page.fill("#cx-fa-cliente", "dona cida"); await page.fill("#cx-fa-valor", "100");
recusarProximo = true;
await page.click("#cx-ab-fiado button[type=submit]");
await page.waitForTimeout(400);
ok(nb(dialogos.at(-1)).includes("Dona Cida já tem um Fiado anterior de R$ 600,00. Somar mesmo assim?"), "aviso de Fiado anterior duplicado para o mesmo cliente");
ok((await lanc()).filter((l) => l.conta === "fiado_anterior").length === 1, "cancelou: o segundo não foi lançado");
// "Desde": não pode ser depois da abertura; com a data da via mais antiga
await page.fill("#cx-fa-cliente", "Seu Bento"); await page.fill("#cx-fa-valor", "200"); await page.fill("#cx-fa-desde", "2026-10-05");
await page.click("#cx-ab-fiado button[type=submit]");
await page.waitForTimeout(300);
ok(await page.$eval("#cx-fa-desde", (e) => e.validity.rangeOverflow) && !(await lanc()).some((l) => l.cliente === "Seu Bento"), "\"desde\" depois da abertura é recusado (o campo não aceita)");
await page.fill("#cx-fa-desde", "2026-07-01");
await page.click("#cx-ab-fiado button[type=submit]");
await salvarCadastro(page);
await page.waitForFunction(() => document.getElementById("aj-abertura").textContent.includes("Seu Bento"));
ok((await lanc()).find((l) => l.conta === "fiado_anterior" && l.cliente === "Seu Bento")?.desde === "2026-07-01", "fiado anterior grava \"desde\" (01/07)");
ok(nb(await page.textContent("#cx-fa-total")).includes("Total do Fiado anterior (2 lançamentos)") && nb(await page.textContent("#cx-fa-total")).includes("R$ 800,00"), "total do Fiado anterior no fim da lista: R$ 800");

// 3. Vender: fiado do Seu Arlindo, sem vencimento, com as 2 vias
await page.click("#btn-tab-vender");
await page.selectOption("#material", "PINUS"); await page.selectOption("#dimension", "PINUS|2x4x3.00");
await page.fill("#quantity-pieces", "10"); await page.click("#btn-adicionar");
await page.locator("#calc-pagamentos .pag-forma").first().selectOption("fiado");
await page.fill("#cp-nome", "Seu Arlindo"); await page.dispatchEvent("#cp-nome", "change"); // escolhido na sugestão: vincula ao cadastro
ok(nb(await page.textContent("#calc-pagamentos")).includes("Sem prazo: acerta quando juntar") && !(await page.locator("#calc-pagamentos .pag-fiado-venc").count()), "cliente sem prazo: sem campo de vencimento");
await page.click("#btn-registrar-venda");
await page.waitForFunction(() => document.querySelectorAll("#items-body tr.linha-item").length === 0);
const v1 = (await lanc()).find((l) => l.origem === "calculadora");
ok(v1 && v1.clienteId === arlindo.id && v1.pagamentos[0].fiado.contaCorrente === true && v1.pagamentos[0].fiado.vencimento === "", "venda gravada sem prazo, sem vencimento");
await page.waitForSelector("#modal-impressao", { state: "visible" });
ok(nb(await page.textContent("#imp-titulo")) === "Venda V-0002 registrada" && await page.isChecked('input[name="imp-modo"][value="duas"]'), "janela \"Venda V-0002 registrada\" com 2 vias marcado");
await page.click("#imp-imprimir");
await page.waitForFunction(() => window.__impressoes.length === 1);
let imp = nb((await impressoes()).at(-1));
ok(imp.includes("VIA DA LOJA") && imp.includes("VIA DO CLIENTE") && imp.includes("Seu Arlindo") && imp.includes("R$ 250,00") && imp.includes("ASSINATURA:") && imp.includes("A prazo"), "2 vias impressas: loja e cliente, com cliente, total, forma (a prazo) e assinatura");
ok(!/custo|margem|CMV|conta corrente|sem prazo|tabela/i.test(imp), "a via não mostra custo, margem nem o prazo do cliente");
ok(imp.includes("PEDIDO Nº V-0002") && !imp.includes(v1.id), "via com número curto e sequencial (V-0002; a V-0001 foi a venda de setembro)");
await page.click("#imp-fechar");

// 4. Caixa › Lançar: fiado antigo do Seu Arlindo (20/08), passa do limite
await page.click("#btn-tab-caixa"); await sub("caixa", "lancar");
await page.fill("#ff-valor", "400"); await page.dispatchEvent("#ff-valor", "input");
await page.fill("#ff-data", "2026-08-20");
await page.locator("#ff-pagamentos .pag-forma").first().selectOption("fiado");
await page.fill("#ff-cliente", "seu arlindo"); await page.dispatchEvent("#ff-cliente", "change");
ok(nb(await page.textContent("#ff-pagamentos")).includes("Sem prazo: acerta quando juntar"), "Lançar: digitou cliente sem prazo, o vencimento some");
await page.click("#fin-form button[type=submit]");
await page.waitForSelector("#modal-impressao", { state: "visible" });
await page.click("#imp-imprimir");
await page.waitForFunction(() => window.__impressoes.length === 2);
await page.click("#imp-fechar");
const v2 = (await lanc()).find((l) => l.value === 400 && l.conta === "venda_produtos");
ok(v2?.pagamentos[0].fiado.contaCorrente === true, "Lançar: fiado sem prazo gravado");

// 5. A receber separado
await irReceber();
await page.waitForSelector("#rc-tabela-cc");
ok(!(await page.locator('input[name="rc-visao"]').count()) && !/conta corrente/i.test(await page.textContent("#fin-receber")), "A receber: sem o cadastro de clientes (fica na aba Clientes) e sem \"conta corrente\"");
const cc = nb(await page.textContent("#rc-tabela-cc"));
const venc = nb(await page.textContent("#rc-tabela-venc"));
ok(nb(await page.locator("#rc-tabela-cc tr[data-chave]", { hasText: "Seu Bento" }).textContent()).includes("101 dia(s)"), "Seu Bento: em aberto há 101 dias, contados do \"desde\" (01/07)");
ok(cc.includes("Seu Arlindo") && cc.includes("Dona Cida") && !venc.includes("Arlindo") && !venc.includes("Cida"), "Sem prazo separado de Fiado com prazo");
ok(nb(await page.locator('#fin-receber .receber-cards .total-bloco:has(> span:text-is("Atrasado"))').locator("strong").textContent()) === "R$ 0,00", "sem prazo nunca fica atrasado (venda de 20/08 sem atraso)");
const linhaA = page.locator("#rc-tabela-cc tr[data-chave]", { hasText: "Seu Arlindo" });
const tA = nb(await linhaA.textContent());
ok(tA.includes("R$ 650,00") && tA.includes("51 dia(s)") && tA.includes("desde 20/08/2026"), "Seu Arlindo: R$ 650 em aberto há 51 dias (desde 20/08)");
ok(tA.includes("passou do limite de R$ 500,00") && (await linhaA.getAttribute("class")).includes("cor-alerta"), "alerta de limite aparece e destaca a linha");
ok(nb(await page.locator("#rc-tabela-cc tr[data-chave]", { hasText: "Dona Cida" }).textContent()).includes("sem alerta"), "Dona Cida: sem alerta configurado");
ok(nb(await page.textContent("#fin-receber .receber-cards")).includes("sem prazo R$ 1.450,00"), "cartão mostra o total sem prazo");
await linhaA.locator('[data-rc="ver"]').click();
const det = page.locator("#fin-receber tr.linha-detalhe");
ok(nb(await det.textContent()).includes("sem prazo") && nb(await det.textContent()).includes("em aberto há 51 dia(s)"), "detalhe: sem vencimento, \"em aberto há X dias\"");
await det.locator("[data-rc-via]").first().click();
await page.waitForSelector("#modal-impressao", { state: "visible" });
await page.click("#imp-imprimir");
await page.waitForFunction(() => window.__impressoes.length === 3);
ok(nb((await impressoes()).at(-1)).includes("2ª impressão em 10/10/2026"), "botão 🖨 Vias reimprime, marcada \"2ª impressão em DD/MM\"");
await page.click("#imp-fechar");
// Editar o alerta pela ficha (link "Abrir ficha do cliente" no detalhe): limite R$ 1.000 e 30 dias sem pagar
await det.locator("[data-rc-ficha]").click();
await page.waitForSelector(".ficha-cliente");
await page.click("#cli-editar");
await page.waitForSelector("#modal-cliente", { state: "visible" });
ok(await page.isChecked('input[name="cli-prazo"][value="sem"]') && await page.inputValue("#cli-limite") === "500", "Editar: o prazo e o alerta atuais vêm preenchidos");
await salvarCadastro(page, { limite: 1000, dias: 30 });
arlindo = (await clientes()).find((c) => c.nome === "Seu Arlindo");
ok(arlindo.alertaLimite === 1000 && arlindo.alertaDias === 30 && arlindo.contaCorrente === true, "alerta salvo pela ficha (limite R$ 1.000, 30 dias)");
await irReceber();
await page.waitForFunction(() => document.querySelector("#rc-tabela-cc")?.textContent.includes("alerta: 30"));
const tA2 = nb(await linhaA.textContent());
ok(!tA2.includes("passou do limite") && tA2.includes("51 dias sem pagar (alerta: 30)"), "alertas recalculados: sem o de limite, com o de dias sem pagar");

// 6. Recebimento da Dona Cida (fiado anterior): entra no caixa, aparece como informação no DRE e no fluxo
await page.locator("#rc-tabela-cc tr[data-chave]", { hasText: "Dona Cida" }).locator('[data-rc="receber"]').click();
await page.waitForSelector("#modal-receber", { state: "visible" });
ok(nb(await page.textContent("#rc-receber-info")).includes("sem prazo, em aberto há 9 dia(s)"), "Receber: mostra há quantos dias está em aberto");
await page.fill("#rc-valor", "300"); await page.dispatchEvent("#rc-valor", "input");
await page.click("#rc-receber-form button[type=submit]");
await page.waitForFunction(() => document.getElementById("modal-receber").style.display === "none");
const tC = nb(await page.locator("#rc-tabela-cc tr[data-chave]", { hasText: "Dona Cida" }).textContent());
ok(tC.includes("R$ 300,00") && tC.includes("10/10/2026"), "Dona Cida: resta R$ 300, último pagamento 10/10");
await page.click("#btn-tab-relatorios"); await sub("relatorios", "dre");
await page.waitForSelector("#fin-dre-conteudo .dre-info");
ok(nb(await page.textContent("#fin-dre-conteudo .dre-andamento")).includes("Mês em andamento (até 10/10)") && nb(await page.textContent("#fin-dre-conteudo thead")).includes("Mês anterior (até 10/09)"),
  "DRE de outubro: mês em andamento, comparado com 1 a 10/09");
const dre = nb(await page.textContent("#fin-dre-conteudo"));
ok(dre.includes("Recebido de fiado anterior à virada") && dre.includes("R$ 300,00"), "DRE: linha informativa \"Recebido de fiado anterior à virada\" R$ 300");
ok(nb(await page.textContent("#fin-dre-conteudo tfoot .dre-info-linha")).includes("Recebido de fiado anterior à virada") && nb(await page.textContent("#fin-dre-conteudo tfoot")).includes("R$ 300,00"),
  "DRE: também como linha informativa no fim da tabela (não soma no lucro)");
// Quanto preciso vender para empatar: agora no topo de Relatórios › Mês (média de ago e set; outubro em andamento fica fora)
const { pontoEquilibrioMedio } = await import("../../lib/financeiro.js");
const peEsperado = pontoEquilibrioMedio(await lanc(), {}, "2026-10");
const brl = (v) => nb(new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v));
await sub("relatorios", "mes");
await page.waitForSelector("#rel-equilibrio");
const eq = nb(await page.textContent("#rel-equilibrio"));
ok(eq.includes("Quanto preciso vender por mês para empatar") && nb(await page.textContent("#rel-equilibrio-valor")) === brl(peEsperado.pontoEquilibrio) && eq.includes("média de ago/26, set/26"),
  `Mês: quadro do ponto de equilíbrio ${brl(peEsperado.pontoEquilibrio)} (média de ago e set)`);
ok(eq.includes("Este mês até 10/10: R$ 250,00"), "quadro mostra quanto já vendeu no mês");
const linhaMes = nb(await page.textContent("#dia-linha-fiado"));
ok(linhaMes.includes("R$ 300,00 da pasta, anterior à virada"), "Mês: recebido de fiado anterior à virada (R$ 300) na linha do fiado");

// 7. Relatórios › A receber dividido
await sub("relatorios", "receber");
await page.waitForSelector("#rel-receber h2");
const rel = nb(await page.textContent("#rel-receber"));
ok(rel.includes("Sem prazo") && rel.includes("Fiado com prazo") && rel.includes("Total sem prazo") && !/conta corrente/i.test(rel), "relatório A receber: Sem prazo e Fiado com prazo separados");

// 8. Voltar para o prazo padrão: volta a ter vencimento e atraso
await abrirFicha(page, "Seu Arlindo");
await page.click("#cli-editar");
await page.waitForSelector("#modal-cliente", { state: "visible" });
await page.check('input[name="cli-prazo"][value="padrao"]');
ok(await page.locator("#cli-limite").isHidden(), "prazo padrão: o alerta some");
await salvarCadastro(page);
arlindo = (await clientes()).find((c) => c.nome === "Seu Arlindo");
ok(arlindo.contaCorrente === false && arlindo.alertaLimite === null, "prazo padrão: sem \"sem prazo\" e sem alerta");
await irReceber();
await page.waitForSelector("#rc-tabela-venc");
ok(nb(await page.textContent("#rc-tabela-venc")).includes("Seu Arlindo") && nb(await page.locator('#fin-receber .receber-cards .total-bloco:has(> span:text-is("Atrasado"))').locator("strong").textContent()) === "R$ 400,00",
  "Seu Arlindo vai para Fiado com prazo: a venda de 20/08 venceu em 19/09 (atrasado R$ 400)");

await page.screenshot({ path: "contacorrente.png", fullPage: true });
await browser.close();
