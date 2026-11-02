// Clientes e Orçamentos › Clientes: cadastro em 3 blocos com o prazo do fiado ("outro" e "sem prazo"), ficha com
// pedidos e orçamentos, Nova venda pela ficha (cliente na venda e na via), inativar/reativar, excluir para sempre
// (bloqueado com dívida; digitando EXCLUIR), orçamentos: excluir para sempre e esvaziar lixeira. Celular sem rolagem lateral.
import { createRequire } from "node:module";
const require = createRequire("/opt/node-tools/node_modules/");
const { chromium } = require("playwright");
import { fecharVias, salvarCadastro, abrirFicha, irClientes } from "./janela.mjs";
const URL = "http://localhost:4321";
const H = { "content-type": "application/json", "x-senha": "pinho123" };
const nb = (s) => (s || "").replace(/\u00a0/g, " ");
const ok = (cond, msg) => { console.log((cond ? "OK   " : "FALHA") + " " + msg); if (!cond) process.exitCode = 1; };
const db = async () => (await fetch(URL + "/__db")).json();
const lanc = async () => Object.values((await db()).madeireira_lancamentos || {}).map((x) => JSON.parse(x)).filter((l) => !l.excluido);
const clientes = async () => Object.values((await db()).madeireira_clientes || {}).map((x) => JSON.parse(x));
const orcs = async () => Object.values((await db()).madeireira_orcamentos || {}).map((x) => JSON.parse(x));

await fetch(URL + "/api/migrar", { method: "POST", headers: H });
await fetch(URL + "/api/migrar?versao=2", { method: "POST", headers: H });
await fetch(URL + "/api/config", { method: "POST", headers: H, body: JSON.stringify({ abertura: { data: "2026-10-01", contas: { gaveta: 300, bradesco: 1000, picpay: 0, cheques_carteira: 0 } } }) });
await fetch(URL + "/api/precos", { method: "POST", headers: H, body: JSON.stringify({ alteracoes: { "PINUS|2x4x3.00|BRUTO": 25 } }) });

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 }, locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
const page = await ctx.newPage();
await page.clock.install({ time: new Date("2026-10-10T10:00:00-03:00") });
await page.addInitScript(() => { window.__impressoes = []; window.print = () => window.__impressoes.push(document.getElementById("impressao-via")?.innerText || ""); });
const dialogos = [];
page.on("dialog", async (d) => { dialogos.push(d.message()); await d.accept(); });
page.on("pageerror", (e) => console.log("ERRO JS:", e.message));
const pedir = async (qtd = 4) => {
  await page.selectOption("#material", "PINUS"); await page.selectOption("#dimension", "PINUS|2x4x3.00");
  await page.fill("#quantity-pieces", String(qtd)); await page.click("#btn-adicionar");
  await page.waitForFunction(() => document.querySelectorAll("#items-body tr.linha-item").length > 0);
};
const confirmarExcluir = async (texto = "EXCLUIR") => {
  await page.waitForSelector("#modal-pergunta", { state: "visible" });
  const msg = nb(await page.textContent("#perg-texto"));
  await page.fill("#perg-campo", texto); await page.click("#perg-ok");
  return msg;
};

await page.goto(URL);
await page.fill("#senha-input", "pinho123"); await page.click("#senha-form button");
await page.waitForFunction(() => document.getElementById("catalogo-status").textContent.includes("itens"));
await page.waitForFunction(() => window.Caixa && window.Caixa.migradoV2);

// 1. Aba "Clientes e Orçamentos" com as sub-abas; cadastro em 3 blocos
ok(nb(await page.textContent("#btn-tab-orcamentos")).startsWith("Clientes e Orçamentos"), "aba \"Clientes e Orçamentos\"");
await irClientes(page);
ok(await page.isVisible("#co-clientes") && await page.isHidden("#co-orcamentos"), "sub-aba Clientes (Orçamentos fica ao lado)");
await page.click("#cli-novo");
await page.waitForSelector("#modal-cliente", { state: "visible" });
const legendas = await page.$$eval("#cli-form legend", (l) => l.map((x) => x.textContent.trim().split(" ")[0]));
ok(legendas.join("|") === "Contato|Endereço|Fiado", "formulário em 3 blocos: Contato, Endereço e documentos, Fiado");
ok(nb(await page.textContent("#cli-form")).includes("Observação do atendimento") && nb(await page.textContent("#cli-form")).includes("Observação do fiado"), "duas observações: atendimento e fiado");
await page.check('input[name="cli-prazo"][value="outro"]');
await page.fill("#cli-prazo-dias", "15");
await salvarCadastro(page, { nome: "Dona Lu", tel: "(41) 98888-1111", fixo: "(41) 3333-1111", endereco: "Rua das Flores, 10", bairro: "Centro", cidade: "Curitiba", uf: "pr", documento: "12345678900", obs: "prefere de manhã", "obs-fiado": "paga dia 10" });
await page.waitForSelector(".ficha-cliente");
const lu = (await clientes()).find((c) => c.nome === "Dona Lu");
ok(lu?.prazoDias === 15 && lu.uf === "PR" && lu.documento === "123.456.789-00" && lu.obs === "prefere de manhã" && lu.obsFiado === "paga dia 10", "cadastro salvo: prazo 15 dias, UF, CPF formatado e as duas observações");
const ficha = nb(await page.textContent(".ficha-cliente"));
ok(ficha.includes("15 dias") && ficha.includes("Rua das Flores, 10, Centro, Curitiba – PR") && ficha.includes("paga dia 10") && ficha.includes("prefere de manhã"), "ficha: prazo, endereço e observações");

// 2. Nova venda pela ficha: fiado com o prazo do cliente (10/10 + 15 = 25/10); o cliente vai na venda e na via
await page.click("#cli-nova-venda");
await page.waitForSelector("#tab-vender.active");
ok(nb(await page.textContent("#calc-cliente")).includes("Cliente: Dona Lu"), "Vender: o cliente da ficha já vem escolhido");
await pedir(4);
await page.locator("#calc-pagamentos .pag-forma").first().selectOption("fiado");
ok(await page.inputValue("#calc-pagamentos .pag-fiado-cliente") === "Dona Lu" && await page.inputValue("#calc-pagamentos .pag-fiado-venc") === "2026-10-25" && nb(await page.textContent("#calc-pagamentos")).includes("prazo do cliente: 15 dias"),
  "fiado: vencimento pelo prazo do cliente (15 dias → 25/10)");
await page.click("#btn-registrar-venda");
await page.waitForSelector("#modal-impressao", { state: "visible" });
ok(nb(await page.textContent("#imp-previa-folha")).includes("ENDEREÇO:Rua das Flores, 10"), "a via sai com o endereço do cliente");
await page.click("#imp-fechar");
const v1 = (await lanc()).find((l) => l.conta === "venda_produtos");
ok(v1.clienteId === lu.id && v1.pagamentos[0].fiado.vencimento === "2026-10-25", "venda gravada com o cliente e o vencimento de 25/10");
// venda em dinheiro também fica no histórico do cliente
await abrirFicha(page, "Dona Lu");
await page.click("#cli-nova-venda");
await pedir(2);
await page.click("#btn-registrar-venda");
await fecharVias(page, dialogos);
await abrirFicha(page, "Dona Lu");
const f2 = nb(await page.textContent(".ficha-cliente"));
ok(f2.includes("V-0001") && f2.includes("V-0002") && f2.includes("R$ 100,00") && f2.includes("Receber"), "ficha: os 2 pedidos (fiado e dinheiro), o em aberto e o botão Receber");

// 3. Inativar: some da busca do Vender; a lista "Ativos" esconde; reativar
await page.click("#cli-inativar");
await page.waitForFunction(() => document.querySelector(".ficha-cliente h2")?.textContent.includes("inativo"));
ok(!(await page.$$eval("#clientes-lista option", (o) => o.map((x) => x.value))).includes("Dona Lu"), "inativo: some da lista de busca do Vender");
await page.click("#cli-voltar");
await page.locator('label:has(input[name="cli-filtro"][value="ativos"])').click();
ok(!nb(await page.textContent("#cli-body")).includes("Dona Lu"), "lista \"Ativos\" não mostra o inativo");
await page.locator('label:has(input[name="cli-filtro"][value="inativos"])').click();
ok(nb(await page.textContent("#cli-body")).includes("Dona Lu"), "filtro \"Inativos\" mostra");
await page.locator("#cli-body tr", { hasText: "Dona Lu" }).click();
await page.click("#cli-inativar");
await page.waitForFunction(() => !document.querySelector(".ficha-cliente h2")?.textContent.includes("inativo"));
ok((await clientes()).find((c) => c.nome === "Dona Lu").inativo === false, "reativar");

// 4. Excluir para sempre: bloqueado com dívida
await page.click("#cli-excluir");
await page.waitForTimeout(400);
ok(nb(dialogos.at(-1)).includes("Receba ou estorne o saldo de R$ 100,00"), "com fiado em aberto: \"Receba ou estorne o saldo de R$ 100,00 antes de excluir\"");
// recebe pela ficha
await page.click("#cli-receber");
await page.waitForSelector("#modal-receber", { state: "visible" });
await page.click("#rc-receber-form button[type=submit]");
await page.waitForFunction(() => document.getElementById("modal-receber").style.display === "none");
await page.waitForTimeout(400);
// orçamento em aberto do cliente (vai junto) e um cliente novo pelo "+ cadastrar novo" do Salvar orçamento
await page.click("#btn-tab-vender");
await pedir(1);
await page.click("#btn-salvar-orcamento");
await page.fill("#orc-nome", "Dona Lu"); await page.press("#orc-nome", "Tab");
ok(await page.inputValue("#orc-tel") === "(41) 98888-1111", "Salvar orçamento: o WhatsApp vem do cadastro pelo nome");
await page.click("#orc-salvar-botao");
await fecharVias(page, dialogos);
await pedir(1);
await page.click("#btn-salvar-orcamento");
await page.fill("#orc-nome", "Seu Zico");
await page.click("#orc-cli-novo");
await salvarCadastro(page, { tel: "(41) 97777-2222" });
ok(await page.inputValue("#orc-tel") === "(41) 97777-2222" && (await clientes()).some((c) => c.nome === "Seu Zico"), "Salvar orçamento › + cadastrar novo: cadastra e preenche o WhatsApp");
await page.click("#orc-salvar-botao");
await fecharVias(page, dialogos);
// agora exclui (digitando EXCLUIR)
await abrirFicha(page, "Dona Lu");
await page.click("#cli-excluir");
let msg = await confirmarExcluir("excluir");
ok(msg.includes("Digite EXCLUIR") && msg.includes("1 orçamento(s) dele") && msg.includes("venda(s) e recebimento(s) continuam"), "aviso: o que acontece com vendas e orçamentos");
await page.waitForTimeout(300);
ok((await clientes()).some((c) => c.nome === "Dona Lu"), "\"excluir\" minúsculo não exclui");
await page.click("#cli-excluir");
await confirmarExcluir();
await page.waitForSelector("#cli-body");
await page.waitForTimeout(400);
ok(!(await clientes()).some((c) => c.nome === "Dona Lu"), "excluído do banco de vez");
ok((await lanc()).filter((l) => l.cliente === "Dona Lu").every((l) => !l.clienteId && l.clienteExcluido), "vendas e recebimento guardam o nome em texto (cliente excluído)");
ok(!(await orcs()).some((o) => o.cliente?.nome === "Dona Lu"), "o orçamento em aberto dela saiu junto");

// 5. Orçamentos: Excluir para sempre (menu ⋯), lixeira com Excluir definitivamente e Esvaziar lixeira
await page.click('#co-subtabs .subtab[data-co="orcamentos"]');
await page.waitForSelector("#orc-body tr");
const zico = (await orcs()).find((o) => o.cliente?.nome === "Seu Zico");
ok(await page.locator(`#orc-body [data-acao="excluir_sempre"][data-id="${zico.id}"]`).count() === 1, "menu ⋯ tem \"Excluir para sempre\"");
await page.locator("#orc-body tr", { hasText: zico.id }).locator(".menu-mais summary").click();
await page.click(`#orc-body [data-acao="excluir"][data-id="${zico.id}"]`);
await page.waitForTimeout(400);
await page.click("#orc-lixeira-link");
await page.waitForSelector(`#orc-lixeira-body [data-acao="excluir_sempre"][data-id="${zico.id}"]`);
ok(nb(await page.textContent("#orc-lixeira-body")).includes("Excluir definitivamente"), "lixeira: Restaurar e Excluir definitivamente");
await page.click("#orc-lixeira-esvaziar");
msg = await confirmarExcluir();
await page.waitForTimeout(400);
ok(msg.includes("1 orçamento(s) da lixeira") && !(await orcs()).some((o) => o.id === zico.id), "Esvaziar lixeira apaga de vez (digitando EXCLUIR)");
await page.click("#orc-lixeira-voltar");

// 6. Celular: lista, ficha e cadastro sem rolagem lateral
await page.setViewportSize({ width: 390, height: 844 });
await irClientes(page);
const larg = async () => page.evaluate(() => document.documentElement.scrollWidth);
const l1 = await larg();
await abrirFicha(page, "Seu Zico");
const l2 = await larg();
await page.click("#cli-editar");
await page.waitForSelector("#modal-cliente", { state: "visible" });
const l3 = await larg();
await page.click("#cli-cancelar");
ok(l1 <= 390 && l2 <= 390 && l3 <= 390, `celular: lista ${l1}, ficha ${l2}, cadastro ${l3} px (sem rolagem lateral)`);
await page.screenshot({ path: "clientes-390.png", fullPage: true });
await browser.close();
