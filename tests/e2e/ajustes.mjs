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

// 6. Cliente na venda: cadastrado (vincula) ou só o nome; dados de entrega na via, salvos e editáveis
await fetch(URL + "/api/clientes", { method: "POST", headers: H, body: JSON.stringify({ cliente: { nome: "Construtora Silva", telefone: "(41) 99999-0000", endereco: "Rua A, 10", cidade: "Curitiba", uf: "PR" } }) });
await page.evaluate(() => window.Clientes.carregar());
const vender = async (cliente) => {
  await page.click("#btn-tab-vender");
  await page.selectOption("#material", "PORTA_INTERNA"); await page.selectOption("#dimension", "PORTA_INTERNA|70cm");
  await page.fill("#quantity-pieces", "1"); await page.click("#btn-adicionar");
  await page.fill("#calc-cliente-nome", cliente); await page.press("#calc-cliente-nome", "Tab");
  await page.click("#btn-registrar-venda");
  await page.waitForSelector("#modal-impressao", { state: "visible" });
};
await vender("construtora silva");
ok(nb(await page.textContent("#imp-previa-folha")).includes("CLIENTE:Construtora Silva") && nb(await page.textContent("#imp-previa-folha")).includes("ENDEREÇO:Rua A, 10"), "Vender › Cliente cadastrado: a via sai com os dados do cadastro");
await page.click("#imp-fechar");
const vCad = (await lanc()).find((l) => l.cliente === "Construtora Silva");
ok(vCad?.clienteId, "venda vinculada ao cliente cadastrado (aparece na ficha dele)");
// cliente sem cadastro: o nome vai na via; os dados de entrega são preenchidos na janela das vias
await vender("Seu Joaquim");
ok(nb(await page.textContent("#imp-previa-folha")).includes("CLIENTE:Seu Joaquim"), "cliente sem cadastro: o nome sai na via");
await page.click("#imp-cliente-btn");
await page.fill("#imp-cli-telefone", "(41) 98888-7777"); await page.fill("#imp-cli-endereco", "Rua das Palmeiras, 55"); await page.fill("#imp-cli-bairro", "Pilarzinho");
await page.fill("#imp-cli-obs", "entregar sábado de manhã");
await page.click("#imp-cli-salvar");
await page.waitForSelector("#imp-cliente-form", { state: "hidden" });
let via = nb(await page.textContent("#imp-previa-folha"));
ok(via.includes("ENDEREÇO:Rua das Palmeiras, 55") && via.includes("BAIRRO:Pilarzinho") && via.includes("FONE:(41) 98888-7777") && via.includes("entregar sábado de manhã"), "Cliente e entrega: endereço, telefone e observação na via, na hora");
await page.click("#imp-fechar");
const vJ = (await lanc()).find((l) => l.cliente === "Seu Joaquim");
ok(vJ && !vJ.clienteId && vJ.clienteVia?.endereco === "Rua das Palmeiras, 55" && vJ.clienteVia.obs === "entregar sábado de manhã", "os dados ficam salvos na venda (sem cadastro)");
// reabre pela lista e edita; depois cadastra o cliente com esses dados
await page.click("#btn-tab-caixa"); await sub("caixa", "lista");
await page.locator(`#fin-lista-body [data-vias="${vJ.id}"]`).click();
await page.waitForSelector("#modal-impressao", { state: "visible" });
ok(nb(await page.textContent("#imp-previa-folha")).includes("Rua das Palmeiras, 55"), "reimprimir depois: a via já vem pronta com os dados");
await page.click("#imp-cliente-btn");
ok(await page.inputValue("#imp-cli-endereco") === "Rua das Palmeiras, 55", "editar: os dados salvos vêm preenchidos");
await page.fill("#imp-cli-endereco", "Rua das Palmeiras, 57");
await page.check("#imp-cli-cadastrar");
await page.click("#imp-cli-salvar");
await page.waitForSelector("#imp-cliente-form", { state: "hidden" });
await page.click("#imp-fechar");
const joaquim = Object.values((await db()).madeireira_clientes || {}).map((x) => JSON.parse(x)).find((c) => c.nome === "Seu Joaquim");
const vJ2 = (await lanc()).find((l) => l.id === vJ.id);
ok(joaquim?.endereco === "Rua das Palmeiras, 57" && joaquim.telefone === "(41) 98888-7777" && vJ2.clienteId === joaquim.id, "\"Cadastrar como cliente\": cria o cadastro com os dados e vincula a venda");
await browser.close();
