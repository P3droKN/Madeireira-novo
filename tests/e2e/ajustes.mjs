// Ajustes depois da virada: portas com preço padrão, vistas "jogo completo", item "Outros" com custo digitado
// (Vender e Caixa › Lançar), gaveta sem abertura (Fechar gaveta parte da última contagem) e o Dia sem saldo negativo
// por falta de abertura (Vendeu − Saiu e o cartão a cair).
import { createRequire } from "node:module";
const require = createRequire("/opt/node-tools/node_modules/");
const { chromium } = require("playwright");
import { fecharVias } from "./janela.mjs";
const URL = "http://localhost:4321";
const nb = (s) => (s || "").replace(/ /g, " ");
const ok = (cond, msg) => { console.log((cond ? "OK   " : "FALHA") + " " + msg); if (!cond) process.exitCode = 1; };
const db = async () => (await fetch(URL + "/__db")).json();
const lanc = async () => Object.values((await db()).madeireira_lancamentos || {}).map((x) => JSON.parse(x)).filter((l) => !l.excluido);

const H = { "content-type": "application/json", "x-senha": "pinho123" };
for (const r of ["/api/migrar", "/api/migrar?versao=2"]) await fetch(URL + r, { method: "POST", headers: H }); // banco novo (antes da virada zerada, ainda pede isso)
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 }, locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
const page = await ctx.newPage();
await page.clock.install({ time: new Date("2026-11-04T10:00:00-03:00") });
await page.addInitScript(() => { window.print = () => {}; });
const dialogos = [];
page.on("dialog", async (d) => { dialogos.push(d.message()); await d.accept(); });
page.on("pageerror", (e) => console.log("ERRO JS:", e.message));
const sub = (g, s) => page.click(`.subtabs[data-grupo="${g}"] .subtab[data-sub="${s}"]`);

await page.goto(URL);
await page.fill("#senha-input", "pinho123"); await page.click("#senha-form button");
await page.waitForFunction(() => document.getElementById("catalogo-status").textContent.includes("itens"));
await page.waitForFunction(() => window.Caixa && window.Caixa.migradoV2);

// 1. Portas com preço padrão; vistas "jogo completo"
await page.selectOption("#material", "PORTA_INTERNA");
const portas = await page.$$eval("#dimension option", (o) => o.map((x) => x.textContent.trim()).filter((t) => /cm/.test(t)));
ok(portas.length === 4 && /^60 cm/.test(portas[0]) && /^90 cm/.test(portas[3]), "Porta interna: 60, 70, 80 e 90 cm");
await page.selectOption("#dimension", "PORTA_INTERNA|90cm");
await page.fill("#quantity-pieces", "1"); await page.click("#btn-adicionar");
await page.waitForFunction(() => document.querySelectorAll("#items-body tr.linha-item").length === 1);
ok(nb(await page.inputValue("#total-final")) === "270.00", "porta interna 90 cm: R$ 270 (preço padrão)");
await page.selectOption("#material", "VISTAS_TAUARI");
const vistas = await page.$$eval("#dimension option", (o) => o.map((x) => x.textContent));
ok(vistas.some((t) => t.includes("6,5 cm — jogo completo")) && !vistas.some((t) => /4 peças/.test(t)), "vistas: \"jogo completo\" (sem \"4 peças\")");

// 2. Outros (fora do catálogo) no Vender: descrição, valor e custo
await page.selectOption("#material", "OUTROS");
ok(await page.isVisible("#custo-livre") && await page.isVisible("#descricao-livre") && await page.isVisible("#valor-livre"), "Outros: pede descrição, valor e custo");
await page.fill("#valor-livre", "500");
await page.fill("#custo-livre", "320");
await page.click("#btn-adicionar");
await page.waitForTimeout(200);
ok(dialogos.at(-1).includes("Descreva o item"), "Outros sem descrição: pede para descrever");
await page.fill("#descricao-livre", "Porta de correr");
await page.click("#btn-adicionar");
await page.waitForFunction(() => document.querySelectorAll("#items-body tr.linha-item").length === 2);
await page.click("#btn-registrar-venda");
await page.waitForSelector("#modal-impressao", { state: "visible" });
ok(nb(await page.textContent("#imp-previa-folha")).includes("Porta de correr") && !nb(await page.textContent("#imp-previa-folha")).includes("fora do catálogo"), "a via mostra só \"Porta de correr\"");
await page.click("#imp-fechar");
const v1 = (await lanc()).find((l) => l.conta === "venda_produtos");
const outro = v1.itens.find((i) => i.itemId === "OUTROS|LIVRE");
ok(v1.value === 770 && outro.custoTotal === 320 && v1.cmv === 470, "venda: 270 + 500; custo 150 (porta) + 320 (digitado) = 470");

// 3. Outros no Caixa › Lançar › Venda (itens)
await page.click("#btn-tab-caixa"); await sub("caixa", "lancar");
await page.waitForSelector("#ic-material");
await page.selectOption("#ic-material", "OUTROS");
ok(await page.isVisible("#ic-custo-livre") && await page.isVisible("#ic-desc"), "Caixa › Lançar: Outros pede descrição e custo");
await page.fill("#ic-desc", "Telha usada"); await page.fill("#ic-livre", "80"); await page.fill("#ic-custo-livre", "30");
await page.click("#ic-adicionar");
await page.waitForSelector("#ic-tabela");
ok(nb(await page.textContent("#ic-tabela")).includes("Telha usada") && nb(await page.textContent("#ic-custo")).includes("R$ 30,00"), "item Outros na venda do Caixa, com o custo digitado");
await page.click("#fin-form button[type=submit]");
await fecharVias(page, dialogos);
const v2 = (await lanc()).find((l) => l.value === 80);
ok(v2 && v2.cmv === 30, "venda do Caixa gravada com custo R$ 30");

// 4. Gaveta sem abertura: Fechar gaveta e o que entra depois
await sub("caixa", "saldos");
await page.waitForSelector(".saldo-conta");
ok(nb(await page.textContent("#fin-saldos")).includes("sem abertura"), "Caixa › Saldos funciona sem abertura");
await page.locator(".saldo-conta", { hasText: "Gaveta" }).locator("[data-conferir]").click();
await page.waitForSelector("#modal-pergunta", { state: "visible" });
ok(nb(await page.textContent("#perg-texto")).includes("Esperado pelo sistema: R$ 850,00"), "esperado sem abertura: o dinheiro do dia (770 + 80)");
await page.fill("#perg-campo", "900"); await page.click("#perg-ok"); // tinha R$ 50 de troco
await page.waitForTimeout(600);
// nova venda em dinheiro depois da contagem
await page.click("#btn-tab-vender");
await page.selectOption("#material", "PORTA_INTERNA"); await page.selectOption("#dimension", "PORTA_INTERNA|60cm");
await page.fill("#quantity-pieces", "1"); await page.click("#btn-adicionar");
await page.click("#btn-registrar-venda");
await fecharVias(page, dialogos);
await page.click("#btn-tab-caixa"); await sub("caixa", "saldos");
await page.waitForSelector(".saldo-conta");
ok(nb(await page.locator(".saldo-conta", { hasText: "Gaveta" }).locator("strong").textContent()) === "R$ 1.140,00", "gaveta = última contagem (900) + o que entrou depois (240)");

// 5. Dia: sem início/fim; Vendeu − Saiu
await page.click("#btn-tab-relatorios");
await page.waitForSelector("#dia-panorama");
const cab = nb(await page.textContent("#dia-panorama thead"));
ok(!cab.includes("Início") && !cab.includes("Fim") && cab.includes("Movimento") && cab.includes("Cartão a cair"), "Dia: movimento por conta, sem início/fim (não depende da abertura)");
ok(nb(await page.textContent('#dia-numeros [data-numero="sobrou"]')).includes("R$ 1.090,00"), "Vendeu − Saiu: 770 + 80 + 240 = 1.090 (nada saiu)");

// 6. Bloco Cliente do pedido: cadastrado (vincula), avulso (dados só na venda), duplicado, inativo, salvar como cliente
await fetch(URL + "/api/clientes", { method: "POST", headers: H, body: JSON.stringify({ cliente: { nome: "Construtora Silva", telefone: "(41) 99999-0000", endereco: "Rua A, 10", cidade: "Curitiba", documento: "11222333000181" } }) });
const rIn = await (await fetch(URL + "/api/clientes", { method: "POST", headers: H, body: JSON.stringify({ cliente: { nome: "Dona Velha", telefone: "(41) 96666-0000" } }) })).json();
await fetch(URL + "/api/clientes", { method: "PATCH", headers: H, body: JSON.stringify({ id: rIn.cliente.id, acao: "inativar" }) });
await page.evaluate(() => window.Clientes.carregar());
const pedido = async () => {
  await page.click("#btn-tab-vender");
  await page.selectOption("#material", "PORTA_INTERNA"); await page.selectOption("#dimension", "PORTA_INTERNA|70cm");
  await page.fill("#quantity-pieces", "1"); await page.click("#btn-adicionar");
};
const registrar = async () => { await page.click("#btn-registrar-venda"); await page.waitForSelector("#modal-impressao", { state: "visible" }); };
const bloco = () => page.textContent("#cp-status").then(nb);
await pedido();
ok(await page.isVisible("#cp-bloco") && !(await page.locator("#cp-uf").count()) && await page.isHidden("#cp-ie"), "bloco Cliente no pedido: nome, WhatsApp, CPF/CNPJ, endereço, bairro, cidade, entrega; IE em \"+ mais dados\"; sem UF");
await page.fill("#cp-nome", "construtora silva"); await page.dispatchEvent("#cp-nome", "change");
ok(await page.inputValue("#cp-endereco") === "Rua A, 10" && (await bloco()).includes("Cliente cadastrado"), "escolher o cadastrado: o bloco se preenche e a venda fica vinculada");
await page.fill("#cp-endereco", "Obra: Rua B, 99"); // outro endereço de entrega: só nesta via
await page.fill("#cp-obs", "entregar sábado de manhã");
await registrar();
let via = nb(await page.textContent("#imp-previa-folha"));
ok(via.includes("CLIENTE:Construtora Silva") && via.includes("ENDEREÇO:Obra: Rua B, 99") && via.includes("ESTADO:PR") && via.includes("Entrega: entregar sábado de manhã"), "via: dados do cadastro com o endereço desta entrega, UF PR e a linha \"Entrega\"");
await page.click("#imp-fechar");
const vCad = (await lanc()).find((l) => l.cliente === "Construtora Silva");
const silva = Object.values((await db()).madeireira_clientes).map((x) => JSON.parse(x)).find((c) => c.nome === "Construtora Silva");
ok(vCad?.clienteId === silva.id && silva.endereco === "Rua A, 10", "venda vinculada; o cadastro não mudou");
// telefone igual ao de um cadastrado: "É o …? Vincular"
await pedido();
await page.fill("#cp-nome", "Silva"); await page.fill("#cp-tel", "41999990000"); await page.dispatchEvent("#cp-tel", "change");
ok((await bloco()).includes("É o Construtora Silva (mesmo WhatsApp)? Vincular"), "WhatsApp igual ao de um cadastrado: mostra \"É o …? Vincular\"");
await page.fill("#cp-tel", ""); await page.fill("#cp-doc", "11.222.333/0001-81"); await page.dispatchEvent("#cp-doc", "change");
ok((await bloco()).includes("mesmo CPF/CNPJ"), "CPF/CNPJ igual: também oferece vincular");
await page.click('#cp-status [data-cp="vincular"]');
ok((await bloco()).includes("Cliente cadastrado") && await page.inputValue("#cp-nome") === "Construtora Silva", "Vincular: passa a ser o cliente cadastrado");
await page.click("#cp-limpar");
// inativo: não aparece na sugestão; se bater, oferece reativar
ok(!(await page.$$eval("#clientes-lista option", (o) => o.map((x) => x.value))).includes("Dona Velha"), "cliente inativo não aparece na sugestão");
await page.fill("#cp-tel", "(41) 96666-0000"); await page.dispatchEvent("#cp-tel", "change");
ok((await bloco()).includes("inativo") && (await bloco()).includes("Reativar e vincular"), "bateu com um inativo: \"cliente inativo, reativar?\"");
await page.click("#cp-limpar");
// "Salvar como cliente" com WhatsApp de outro: oferece vincular (não duplica)
await page.fill("#cp-nome", "Silva Construções"); await page.fill("#cp-tel", "(41) 99999-0000");
await page.check("#cp-salvar");
await registrar();
await page.click("#imp-fechar");
ok(dialogos.some((d) => d.includes("Já existe Construtora Silva com esse WhatsApp")) && !Object.values((await db()).madeireira_clientes).map((x) => JSON.parse(x)).some((c) => c.nome === "Silva Construções"), "Salvar como cliente com WhatsApp repetido: oferece vincular e não cria outro cadastro");
// avulso: dados só na venda
await pedido();
await page.fill("#cp-nome", "Seu Joaquim"); await page.fill("#cp-tel", "(41) 3333-4444"); await page.fill("#cp-endereco", "Rua das Palmeiras, 55");
await registrar();
via = nb(await page.textContent("#imp-previa-folha"));
const vJ = (await lanc()).find((l) => l.cliente === "Seu Joaquim");
ok(via.includes("CLIENTE:Seu Joaquim") && via.includes("Rua das Palmeiras, 55") && vJ && !vJ.clienteId && vJ.clienteVia.endereco === "Rua das Palmeiras, 55" && !Object.values((await db()).madeireira_clientes).map((x) => JSON.parse(x)).some((c) => c.nome === "Seu Joaquim"),
  "compra de uma vez: dados na via e na venda, sem cadastro");
// WhatsApp na janela das vias: número fixo avisa; o clique grava "WhatsApp aberto em"
ok(await page.isVisible("#imp-whats") && nb(await page.textContent("#imp-whats-info")).includes("parece telefone fixo"), "número fixo: aviso no WhatsApp");
await page.click("#imp-cliente-btn");
await page.fill("#imp-cli-telefone", "(41) 98888-7777");
await page.click("#imp-cli-salvar");
await page.waitForSelector("#imp-cliente-form", { state: "hidden" });
ok((await page.getAttribute("#imp-whats", "href")).startsWith("https://wa.me/5541988887777?text=") && decodeURIComponent(await page.getAttribute("#imp-whats", "href")).includes(`Pedido ${vJ.numero}`), "💬 Enviar no WhatsApp: número do cliente com 55 e o pedido na mensagem");
await ctx.route("https://wa.me/**", (r) => r.fulfill({ contentType: "text/html", body: "<p>WhatsApp (simulado)</p>" }));
const [aba] = await Promise.all([ctx.waitForEvent("page"), page.click("#imp-whats")]);
await aba.close();
await page.waitForFunction(() => document.getElementById("imp-whats-info").textContent.includes("WhatsApp aberto em"));
ok((await lanc()).find((l) => l.id === vJ.id).whatsappAbertoEm?.length === 1, "grava \"WhatsApp aberto em DD/MM HH:MM\"");
await page.click("#imp-fechar");

// 7. Corrigir venda fiado trocando o cliente: a dívida vai para a ficha certa
await pedido();
await page.fill("#cp-nome", "construtora silva"); await page.dispatchEvent("#cp-nome", "change");
await page.locator("#calc-pagamentos .pag-forma").first().selectOption("fiado");
await registrar(); await page.click("#imp-fechar");
const vF = (await lanc()).find((l) => (l.pagamentos || []).some((p) => p.forma === "fiado"));
await page.click("#btn-tab-caixa"); await sub("caixa", "lista");
await page.locator(`#fin-lista-body [data-corrigir="${vF.id}"]`).click();
await page.waitForFunction(() => document.querySelectorAll("#items-body tr.linha-item").length === 1);
ok(await page.inputValue("#cp-nome") === "Construtora Silva", "corrigir: o cliente volta para o bloco");
await page.click("#cp-limpar");
await page.fill("#cp-nome", "Seu Joaquim"); await page.fill("#cp-tel", "(41) 98888-7777");
await page.click("#btn-registrar-venda");
await page.waitForSelector("#modal-impressao", { state: "visible" }); await page.click("#imp-fechar");
const joaquim = Object.values((await db()).madeireira_clientes).map((x) => JSON.parse(x)).find((c) => c.nome === "Seu Joaquim");
ok(joaquim && (await lanc()).find((l) => l.id === vF.id).clienteId === joaquim.id, "corrigir trocando o cliente do fiado: a venda passa para o Seu Joaquim (cadastrado na hora)");
await page.click("#btn-tab-caixa"); await sub("caixa", "receber");
await page.waitForSelector("#fin-receber .receber-cards");
ok(nb(await page.textContent("#fin-receber")).includes("Seu Joaquim") && !nb(await page.locator("#fin-receber tr[data-chave]", { hasText: "Construtora Silva" }).count().then(String)).match(/^[1-9]/), "A receber: a dívida está com o Seu Joaquim, não com a Construtora Silva");

// 8. "Outros" sem custo: fica "a classificar"
await pedido();
await page.selectOption("#material", "OUTROS");
await page.fill("#descricao-livre", "Serviço de corte"); await page.fill("#valor-livre", "60");
await page.click("#btn-adicionar");
await page.waitForFunction(() => document.querySelectorAll("#items-body tr.linha-item").length === 2);
await registrar(); await page.click("#imp-fechar");
const vO = (await lanc()).find((l) => (l.itens || []).some((i) => i.descricao === "Serviço de corte"));
ok(vO.itens.find((i) => i.descricao === "Serviço de corte").custoTotal == null, "Outros com custo em branco: \"custo não informado\"");
await page.click("#btn-tab-caixa"); await sub("caixa", "lista");
await page.selectOption("#fin-f-tipo", "classificar");
await page.waitForTimeout(300);
ok(nb(await page.textContent("#fin-lista-body")).includes("custo não informado"), "a venda aparece em Lançamentos › A classificar, com \"custo não informado\"");
await page.selectOption("#fin-f-tipo", "todos");

// 9. Despesa "Outros": descrição obrigatória, aviso de Compras, DRE, Dia, Mês e reclassificação
await sub("caixa", "lancar");
await page.locator('label:has(input[name="fin-tipo"][value="saida"])').click();
await page.selectOption("#ff-conta", "outras_despesas"); await page.dispatchEvent("#ff-conta", "change");
ok(await page.isVisible("#ff-outros-aviso") && nb(await page.textContent("#ff-outros-aviso")).includes("use Compras"), "despesa Outros: aviso \"Compra de madeira… use Compras\"");
await page.fill("#ff-valor", "45");
await page.locator('label:has(input[name="ff-pagocom"][value="gaveta"])').click();
await page.click("#fin-form button[type=submit]");
await page.waitForTimeout(300);
ok(dialogos.at(-1).includes("descreva o que foi"), "sem descrição: recusa");
await page.fill("#ff-desc", "conserto do portão");
await page.click("#fin-form button[type=submit]");
await page.waitForTimeout(600);
const dOut = (await lanc()).find((l) => l.conta === "outras_despesas");
ok(dOut?.description === "conserto do portão" && dOut.value === 45, "despesa Outros gravada com a descrição");
await page.click("#btn-tab-relatorios"); await sub("relatorios", "dia");
await page.waitForSelector("#dia-saidas");
ok(nb(await page.textContent("#dia-saidas")).includes("Outras despesas") && nb(await page.textContent("#dia-saidas")).includes("conserto do portão"), "Dia › Saídas por conta: Outras despesas, com a descrição");
await sub("relatorios", "mes");
await page.waitForSelector("#dia-detalhes");
await page.evaluate(() => { document.getElementById("dia-detalhes").open = true; });
ok(nb(await page.textContent("#dia-outras-despesas")).includes("conserto do portão") && nb(await page.textContent("#dia-outras-despesas")).includes("R$ 45,00"), "Mês › Mais detalhes: a lista das despesas \"Outros\"");
await sub("relatorios", "dre");
await page.fill("#rel-mes", "2026-11"); await page.dispatchEvent("#rel-mes", "change");
await page.waitForTimeout(300);
ok(nb(await page.textContent("#fin-dre-conteudo")).includes("Outras despesas") && nb(await page.locator("#fin-dre-conteudo tr", { hasText: "Outras despesas" }).first().textContent()).includes("R$ 45,00"), "DRE: R$ 45 em \"Outras despesas\"");
// reclassifica: conserto do portão → manutenção de máquinas
await page.click("#btn-tab-caixa"); await sub("caixa", "lista");
await page.fill("#fin-f-busca", "portão"); await page.dispatchEvent("#fin-f-busca", "input");
await page.waitForTimeout(400);
await page.locator("#fin-lista-body tr", { hasText: "conserto do portão" }).locator(".fin-sel").check();
await page.selectOption("#fin-lote-conta", "manut_maquinas");
await page.click("#fin-lote-aplicar");
await page.waitForTimeout(500);
ok((await lanc()).find((l) => l.id === dOut.id).conta === "manut_maquinas", "reclassificada para Manutenção");
await page.click("#btn-tab-relatorios"); await sub("relatorios", "dre");
await page.waitForTimeout(300);
ok(nb(await page.locator("#fin-dre-conteudo tr", { hasText: "Operacionais" }).first().textContent()).includes("R$ 45,00"), "DRE: o valor foi para Operacionais");
await browser.close();
