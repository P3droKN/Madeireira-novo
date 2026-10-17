// Ensaio da virada: banco do v2 com dados de teste → Zerar (backup + ZERAR) → importar o export do sistema antigo
// → Conferir "Tudo confere" → migrar → Conferir de novo → abertura com cheques um por um e fiado da pasta.
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
const EXPORT_ANTIGO = new globalThis.URL("./export-antigo.json", import.meta.url).pathname; // sintético, no formato do "Exportar" do sistema antigo (com uma venda em cheque que compensa depois da virada)

// "Dados de teste" no v2: migrado, com orçamento, cliente, preço e configuração
await fetch(URL + "/api/migrar", { method: "POST", headers: H });
await fetch(URL + "/api/migrar?versao=2", { method: "POST", headers: H });
await fetch(URL + "/api/precos", { method: "POST", headers: H, body: JSON.stringify({ alteracoes: { "PINUS|2x4x3.00|BRUTO": 25 } }) });
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
const conferir = async () => {
  await page.setInputFiles("#conferir-file", EXPORT_ANTIGO);
  await page.waitForSelector("#modal-conferencia", { state: "visible" });
  const v = nb(await page.textContent("#conferencia-veredito")).trim();
  await page.click("#modal-conferencia >> text=Fechar");
  return v;
};

await page.goto(URL);
await page.fill("#senha-input", "pinho123"); await page.click("#senha-form button");
await page.waitForFunction(() => window.Caixa && window.Caixa.migradoV2);

// 1. Zerar
await irDados();
await page.waitForSelector("#zerar-bloco:not([hidden])");
ok(nb(await page.textContent("#status-banco")).includes("ZERAR LIGADO"), "linha do banco avisa: ZERAR LIGADO");
ok(await page.isDisabled("#zerar-botao"), "Zerar começa bloqueado");
await page.fill("#zerar-texto", "ZERAR");
ok(await page.isDisabled("#zerar-botao"), "sem baixar o backup, digitar ZERAR não libera");
const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#zerar-backup")]);
await dl.saveAs("backup-antes-de-zerar.json");
ok(JSON.parse(fs.readFileSync("backup-antes-de-zerar.json", "utf8")).chaves.madeireira_clientes, "backup dos testes baixado antes de zerar");
await page.fill("#zerar-texto", "zerar"); await page.dispatchEvent("#zerar-texto", "input");
ok(await page.isDisabled("#zerar-botao"), "'zerar' minúsculo não libera");
await page.fill("#zerar-texto", "ZERAR"); await page.dispatchEvent("#zerar-texto", "input");
await page.click("#zerar-botao");
await page.waitForFunction(() => document.getElementById("aviso-sistema").style.display === "block");
ok(dialogos.at(-1).startsWith("Banco zerado."), "aviso: banco zerado, próximo passo importar");
let d = await db();
ok(!d.madeireira_lancamentos && !d.madeireira_finance && !d.madeireira_clientes && !d.madeireira_orcamentos && !d.madeireira_saldos && !d.madeireira_migrado_v1 && !d.madeireira_migrado_v2 && !d.madeireira_acumulado,
  "apagados: lançamentos, lista antiga, acumulado, clientes, orçamentos, abertura e marcas de migração");
ok(d.madeireira_precos_venda && JSON.parse(d.madeireira_config_financeiro).fiado.prazoDias === 20, "mantidos: preços de venda e configuração financeira (prazo do fiado 20)");
ok(Object.keys(d).some((k) => k.includes("antes-de-zerar")), "cópia 'antes-de-zerar' guardada no banco");

// 2. Importar o export do antigo e conferir
await page.setInputFiles("#import-file", EXPORT_ANTIGO);
await page.waitForFunction(() => !document.getElementById("progresso-fechar").hidden, null, { timeout: 60000 });
ok(nb(await page.textContent("#progresso-texto")).length > 0, "importação: " + nb(await page.textContent("#progresso-texto")).trim().slice(0, 90));
await page.click("#progresso-fechar");
d = await db();
const nArquivo = JSON.parse(fs.readFileSync(EXPORT_ANTIGO, "utf8")).financeItems.length;
ok(Object.keys(d.madeireira_lancamentos || {}).length === new Set(JSON.parse(fs.readFileSync(EXPORT_ANTIGO, "utf8")).financeItems.map((l) => String(l.id))).size && d.madeireira_migrado_v1, `importados os lançamentos do arquivo (${nArquivo} no arquivo) e salvamento seguro ativo`);
ok(JSON.parse(d.madeireira_acumulado).venda === 48866, "acumulado do arquivo importado");
ok((await conferir()).includes("Tudo confere"), "Conferir com arquivo depois de importar: Tudo confere");

// 3. Migrar e conferir de novo
await page.click("#btn-tab-caixa");
await page.waitForSelector("#fin-aviso-v2:not([hidden])");
await Promise.all([page.waitForEvent("download"), page.click("#fin-v2-backup")]);
await page.click("#fin-v2-migrar");
await page.waitForFunction(() => document.getElementById("fin-aviso-v2").hidden);
await irDados();
ok((await conferir()).includes("Tudo confere"), "Conferir depois de migrar: Tudo confere (abertura × acumulado)");

// 4. Abertura com cheques um por um e fiado da pasta
await sub("ajustes", "saldos");
await page.waitForSelector("#cx-abertura");
ok(nb(await page.textContent("#aj-abertura")).includes("Vieram do sistema antigo"), "lista os cheques que vieram do sistema antigo");
const cheq0 = nb(await page.textContent("#cx-ab-cheques"));
await page.fill("#cx-ab-gaveta", "300"); await page.fill("#cx-ab-bradesco", "5000"); await page.fill("#cx-ab-picpay", "200");
await page.dispatchEvent("#cx-ab-picpay", "input");
// cheque que está na gaveta e não veio do antigo
await page.fill("#cx-ch-numero", "901"); await page.fill("#cx-ch-emissor", "Ana Lima"); await page.fill("#cx-ch-valor", "250"); await page.fill("#cx-ch-comp", "2026-11-05");
await page.click("#cx-ab-cheque button[type=submit]");
await page.waitForFunction(() => document.getElementById("aj-abertura").textContent.includes("Lançados na abertura"));
ok(await page.inputValue("#cx-ab-gaveta") === "300" && await page.inputValue("#cx-ab-bradesco") === "5000", "o que já foi digitado na abertura continua depois de lançar o cheque");
const cheq1 = nb(await page.textContent("#cx-ab-cheques"));
ok(cheq0 === "R$ 400,00" && cheq1 === "R$ 650,00", `cheques em carteira: ${cheq0} do antigo + R$ 250 lançado = ${cheq1}`);
// fiado da pasta, cliente novo
await page.fill("#cx-fa-cliente", "Zé da Obra"); await page.fill("#cx-fa-valor", "480");
ok(await page.inputValue("#cx-fa-venc") === "2026-11-21", "vencimento sugerido: data da abertura + prazo (20 dias, da configuração mantida)");
respostas.push("");
await page.click("#cx-ab-fiado button[type=submit]");
await page.waitForFunction(() => document.getElementById("aj-abertura").textContent.includes("Zé da Obra"));
ok(nb(await page.textContent("#aj-abertura")).includes("Fiado anterior (pasta)R$ 480,00"), "fiado anterior lançado: Zé da Obra R$ 480");
ok((await db()).madeireira_lancamentos && Object.values((await db()).madeireira_lancamentos).map((x) => JSON.parse(x)).some((l) => l.conta === "fiado_anterior" && l.contaCorrente === true && !l.vencimento),
  "fiado da pasta entra como conta corrente (sem vencimento), que vem marcado");
await page.click("#cx-abertura button[type=submit]");
await page.waitForSelector("#cx-refazer");
const sal = JSON.parse((await db()).madeireira_saldos).abertura;
ok(sal.data === "2026-11-01" && sal.contas.gaveta === 300 && sal.contas.cheques_carteira === 650, "abertura salva: gaveta 300, cheques em carteira 650 (soma da lista)");

// 5. Saldos e A receber depois da virada
await page.click("#btn-tab-caixa"); await sub("caixa", "saldos");
await page.waitForSelector(".saldo-conta");
const carteira = nb(await page.locator(".saldo-conta", { hasText: "Cheques em carteira" }).locator("strong").textContent());
ok(carteira === "R$ 650,00", "Caixa › Saldos: cheques em carteira R$ 650 (o cheque da abertura não conta duas vezes)");
await sub("caixa", "receber");
await page.waitForSelector("#fin-receber tr[data-chave]");
ok(nb(await page.textContent("#fin-receber")).includes("Zé da Obra") && nb(await page.textContent("#fin-receber .receber-cards")).includes("R$ 480,00"), "A receber: Zé deve R$ 480 (da pasta)");
await sub("caixa", "cheques");
ok(nb(await page.textContent("#fin-cheques")).includes("901"), "o cheque da abertura aparece em Caixa › Cheques (pode compensar ou voltar)");
d = await db();
ok(!Object.keys(d.madeireira_clientes || {}).some((k) => JSON.parse(d.madeireira_clientes[k]).nome === "Cliente Teste"), "cliente de teste não voltou");
await page.screenshot({ path: "virada.png", fullPage: true });
await browser.close();
