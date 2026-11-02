// Ensaio da virada ZERADA: banco do v2 com dados de teste → Zerar (backup + ZERAR) → sistema pronto para lançar
// (sem importar histórico, sem migrar) → abertura do dia com cheques um por um e fiado da pasta → V-0001 e ORC-0001.
// Servidor: SEED (dados de teste), BANCO_PRODUCAO_HOST (trava ativa, outro banco) e PERMITIR_ZERAR=sim.
import { createRequire } from "node:module";
const require = createRequire("/opt/node-tools/node_modules/");
const { chromium } = require("playwright");
const URL = "http://localhost:4321";
const H = { "content-type": "application/json", "x-senha": "pinho123" };
const nb = (s) => (s || "").replace(/ /g, " ");
const ok = (cond, msg) => { console.log((cond ? "OK   " : "FALHA") + " " + msg); if (!cond) process.exitCode = 1; };
const db = async () => (await fetch(URL + "/__db")).json();
const fs = await import("node:fs");

// "Dados de teste" no v2: migrado, com orçamento, cliente, preço e configuração
await fetch(URL + "/api/migrar", { method: "POST", headers: H });
await fetch(URL + "/api/migrar?versao=2", { method: "POST", headers: H });
await fetch(URL + "/api/precos", { method: "POST", headers: H, body: JSON.stringify({ alteracoes: { "PINUS|2x4x3.00|BRUTO": 25, "BEIRAL_CEDRO|13cm|UNICO": 16 } }) });
await fetch(URL + "/api/config", { method: "POST", headers: H, body: JSON.stringify({ financeiro: { impressao: { nome: "MERCADO DA MADEIRA", endereco: "Av. Teste, 1", telefone: "41 0000-0000", pix: "Pix CNPJ: 73.871.956/0001-32" } } }) });
// venda e orçamento de teste (contadores andando) e uma cópia automática antiga
await fetch(URL + "/api/lancamento", { method: "POST", headers: H, body: JSON.stringify({ itens: [{ id: "T1", v: 2, conta: "venda_produtos", value: 100, competencia: "2026-10-20", pagamentos: [{ forma: "dinheiro", valor: 100 }] }] }) });
await fetch(URL + "/api/orcamentos", { method: "POST", headers: H, body: JSON.stringify({ orcamento: { cliente: { nome: "Cliente Teste", telefone: "(47) 99999-0000" }, origem: "balcao", itens: [{ itemId: "PINUS|2x4x3.00", acabamento: "BRUTO", quantidade: 2, quantidadeCobrada: 2, unidade: "peça", descricao: "Pinus", vendaTotal: 50, custoTotal: 20 }], total: 50, frete: 0 } }) });
await fetch(URL + "/api/backup", { headers: H });
await fetch(URL + "/api/config", { method: "POST", headers: H, body: JSON.stringify({ financeiro: { fiado: { ligado: true, prazoDias: 20 } } }) });
await fetch(URL + "/api/clientes", { method: "POST", headers: H, body: JSON.stringify({ cliente: { nome: "Cliente Teste" } }) });
await fetch(URL + "/api/config", { method: "POST", headers: H, body: JSON.stringify({ abertura: { data: "2026-10-01", contas: { gaveta: 1, bradesco: 2, picpay: 3, cheques_carteira: 0 } } }) });
const antes = await db();
ok(antes.madeireira_lancamentos && antes.madeireira_clientes && antes.madeireira_saldos, "v2 começa com dados de teste");

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 }, locale: "pt-BR", timezoneId: "America/Sao_Paulo", acceptDownloads: true });
const page = await ctx.newPage();
await page.clock.install({ time: new Date("2026-11-01T07:00:00-03:00") });
const dialogos = [];
const respostas = [];
page.on("dialog", async (d) => { dialogos.push(d.message()); d.type() === "prompt" ? await d.accept(respostas.shift() ?? "") : await d.accept(); });
page.on("pageerror", (e) => console.log("ERRO JS:", e.message));
const sub = (g, s) => page.click(`.subtabs[data-grupo="${g}"] .subtab[data-sub="${s}"]`);
const irDados = async () => { await page.click("#btn-tab-ajustes"); await sub("ajustes", "dados"); };

await page.goto(URL);
await page.fill("#senha-input", "pinho123"); await page.click("#senha-form button");
await page.waitForFunction(() => window.Caixa && window.Caixa.migradoV2);

// 1. Zerar
await irDados();
await page.waitForSelector("#zerar-bloco:not([hidden])");
ok(nb(await page.textContent("#status-banco")).includes("ZERAR LIGADO") && nb(await page.textContent("#status-banco")).includes("próxima venda: V-0002"), "linha do banco avisa: ZERAR LIGADO (e a próxima venda dos testes seria V-0002)");
ok(await page.isDisabled("#zerar-botao"), "Zerar começa bloqueado");
await page.fill("#zerar-texto", "ZERAR");
ok(await page.isDisabled("#zerar-botao"), "sem baixar o backup, digitar ZERAR não libera");
const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#zerar-backup")]);
await dl.saveAs("backup-antes-de-zerar.json");
ok(JSON.parse(fs.readFileSync("backup-antes-de-zerar.json", "utf8")).chaves.madeireira_clientes, "backup dos testes baixado antes de zerar");
await page.fill("#zerar-texto", "zerar"); await page.dispatchEvent("#zerar-texto", "input");
ok(await page.isDisabled("#zerar-botao"), "'zerar' minúsculo não libera");
await page.fill("#zerar-texto", "ZERAR"); await page.dispatchEvent("#zerar-texto", "input");
const copiasAntes = JSON.parse((await db()).madeireira_backups ? JSON.stringify((await db()).madeireira_backups) : "[]");
await page.click("#zerar-botao");
await page.waitForFunction(() => window.__zerado || document.querySelector("#zerar-texto").value === "");
await page.waitForTimeout(600);
ok(dialogos.at(-1).startsWith("Banco zerado.") && dialogos.at(-1).includes("V-0001") && dialogos.at(-1).includes("abertura do dia"), "aviso: banco zerado, recomeça em V-0001, próximo passo a abertura do dia");
let d = await db();
ok(!d.madeireira_lancamentos && !d.madeireira_finance && !d.madeireira_clientes && !d.madeireira_orcamentos && !d.madeireira_saldos && !d.madeireira_acumulado && !d.madeireira_conferencias && !d.madeireira_venda_seq && !d.madeireira_orc_seq,
  "apagados: lançamentos, lista antiga, acumulado, clientes, orçamentos, abertura, conferências e contadores");
const cfgD = JSON.parse(d.madeireira_config_financeiro);
ok(d.madeireira_precos_venda?.["BEIRAL_CEDRO|13cm|UNICO"] && d.madeireira_precos_venda?.["PINUS|2x4x3.00|BRUTO"] && cfgD.fiado.prazoDias === 20 && cfgD.impressao.nome === "MERCADO DA MADEIRA",
  "mantidos: preços (com o beiral novo), configuração financeira e Ajustes › Impressão");
const copias = d.madeireira_backups || [];
ok(copias.length === 1 && copias[0].includes("antes-de-zerar") && d[copias[0]] && !Object.keys(d).some((k) => k.includes("madeireira_backup_") && !k.includes("antes-de-zerar")) && copiasAntes.length >= 1,
  "cópias automáticas antigas apagadas; fica só a 'antes-de-zerar'");

ok(nb(await page.textContent("#status-banco")).includes("próxima venda: V-0001 · próximo orçamento: ORC-0001"), "Ajustes › Dados mostra: próxima venda V-0001 e próximo orçamento ORC-0001 (sem gastar número com teste)");

// 2. Pronto para lançar: sem salvamento seguro, sem migração, sem aviso
await page.click("#btn-tab-caixa");
await page.waitForTimeout(300);
ok(await page.isHidden("#fin-aviso-v2") && await page.evaluate(() => window.Caixa.migradoV2 && window.Caixa.migrado), "depois de zerar: nada a migrar (sem aviso), pronto para lançar");
ok(await page.evaluate(() => window.Caixa.itens.length) === 0, "nenhum lançamento");

// 3. Abertura do dia com cheques um por um e fiado da pasta
await page.click("#btn-tab-ajustes"); await sub("ajustes", "saldos");
await page.waitForSelector("#cx-abertura");
await page.fill("#cx-ab-gaveta", "300"); await page.fill("#cx-ab-bradesco", "5000"); await page.fill("#cx-ab-picpay", "200");
await page.dispatchEvent("#cx-ab-picpay", "input");
await page.fill("#cx-ch-numero", "901"); await page.fill("#cx-ch-emissor", "Ana Lima"); await page.fill("#cx-ch-valor", "250"); await page.fill("#cx-ch-comp", "2026-11-05");
await page.click("#cx-ab-cheque button[type=submit]");
await page.waitForFunction(() => document.getElementById("aj-abertura").textContent.includes("Lançados na abertura"));
ok(await page.inputValue("#cx-ab-gaveta") === "300" && await page.inputValue("#cx-ab-bradesco") === "5000", "o que já foi digitado na abertura continua depois de lançar o cheque");
ok(nb(await page.textContent("#cx-ab-cheques")) === "R$ 250,00", "cheques em carteira: só o lançado na abertura (R$ 250)");
await page.fill("#cx-fa-cliente", "Zé da Obra"); await page.fill("#cx-fa-valor", "480");
respostas.push("");
await page.click("#cx-ab-fiado button[type=submit]");
await page.waitForFunction(() => document.getElementById("aj-abertura").textContent.includes("Zé da Obra"));
ok(nb(await page.textContent("#aj-abertura")).includes("Fiado anterior (pasta)R$ 480,00"), "fiado anterior lançado: Zé da Obra R$ 480");
await page.click("#cx-abertura button[type=submit]");
await page.waitForSelector("#cx-refazer");
const sal = JSON.parse((await db()).madeireira_saldos).abertura;
ok(sal.data === "2026-11-01" && sal.contas.gaveta === 300 && sal.contas.cheques_carteira === 250, "abertura salva no dia: gaveta 300, cheques em carteira 250");

// 4. Primeira venda V-0001 e primeiro orçamento ORC-0001; o beiral novo está no Vender
await page.click("#btn-tab-vender");
await page.selectOption("#material", "BEIRAL_CEDRO");
const medidas = await page.$$eval("#dimension option", (o) => o.map((x) => x.textContent.trim()).filter((t) => /cm/.test(t)));
ok(medidas.length === 4 && /^13 cm/.test(medidas[0]) && /^29 cm/.test(medidas[3]), "Vender: Beiral cedro com 13, 19, 23 e 29 cm, em ordem");
await page.selectOption("#dimension", "BEIRAL_CEDRO|13cm");
await page.fill("#quantity-pieces", "2"); await page.fill("#quantity-length", "3"); await page.click("#btn-adicionar");
await page.waitForFunction(() => document.querySelectorAll("#items-body tr.linha-item").length === 1);
await page.click("#btn-registrar-venda");
await page.waitForSelector("#modal-impressao", { state: "visible" });
ok(nb(await page.textContent("#imp-titulo")) === "Venda V-0001 registrada", "a primeira venda depois de zerar é V-0001");
await page.click("#imp-fechar");
await page.selectOption("#material", "PINUS"); await page.selectOption("#dimension", "PINUS|2x4x3.00");
await page.fill("#quantity-pieces", "2"); await page.click("#btn-adicionar");
await page.click("#btn-salvar-orcamento");
await page.fill("#orc-nome", "Carlos"); await page.fill("#orc-tel", "(47) 99999-1234");
await page.click("#orc-salvar-botao");
await page.waitForSelector("#modal-impressao", { state: "visible" });
ok(nb(await page.textContent("#imp-titulo")).includes("ORC-0001"), "o primeiro orçamento depois de zerar é ORC-0001");
await page.click("#imp-fechar");

// 5. Saldos e A receber depois da virada
await page.click("#btn-tab-caixa"); await sub("caixa", "saldos");
await page.waitForSelector(".saldo-conta");
ok(nb(await page.locator(".saldo-conta", { hasText: "Cheques em carteira" }).locator("strong").textContent()) === "R$ 250,00", "Caixa › Saldos: cheques em carteira R$ 250");
await sub("caixa", "receber");
await page.waitForSelector("#fin-receber tr[data-chave]");
ok(nb(await page.textContent("#fin-receber")).includes("Zé da Obra"), "A receber: Zé deve R$ 480 (da pasta)");
d = await db();
ok(!Object.values(d.madeireira_clientes || {}).some((c) => JSON.parse(c).nome === "Cliente Teste"), "cliente de teste não voltou");
// DRE: outubro (antes da virada) vazio, sem erro
await page.click("#btn-tab-relatorios"); await sub("relatorios", "dre");
await page.fill("#rel-mes", "2026-10"); await page.dispatchEvent("#rel-mes", "change");
await page.waitForTimeout(300);
ok(nb(await page.textContent("#fin-dre-conteudo")).includes("R$ 0,00"), "DRE do mês anterior à virada aparece vazio, sem erro");
await page.screenshot({ path: "virada.png", fullPage: true });
await browser.close();
