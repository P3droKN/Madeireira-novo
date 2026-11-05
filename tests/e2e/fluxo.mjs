import { createRequire } from "node:module";
const require = createRequire("/opt/node-tools/node_modules/");
const { chromium } = require("playwright");
const URL = "http://localhost:4321";
const db = async () => (await fetch(URL + "/__db")).json();
const hashLen = (d) => Object.keys(d.madeireira_lancamentos || {}).length;
const oldLen = (d) => JSON.parse(d.madeireira_finance).length;
const ok = (cond, msg) => { console.log((cond ? "OK   " : "FALHA") + " " + msg); if (!cond) process.exitCode = 1; };

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" }).catch(() => chromium.launch());
const page = await browser.newPage({ acceptDownloads: true });
const dialogos = [];
page.on("dialog", async (d) => { dialogos.push(d.message()); d.type() === "prompt" ? await d.accept("RESTAURAR") : await d.accept(); });
page.on("pageerror", (e) => console.log("ERRO JS:", e.message));
const ultimo = () => dialogos[dialogos.length - 1] || "";

await page.goto(URL);
await page.waitForSelector("#modal-senha", { state: "visible" });
ok(true, "pede a senha ao abrir");
await page.fill("#senha-input", "errada"); await page.click("#senha-form button");
await page.waitForFunction(() => document.getElementById("senha-msg").textContent.includes("incorreta"));
ok(true, "senha errada é recusada");
await page.fill("#senha-input", "pinho123"); await page.click("#senha-form button");
await page.waitForSelector("#modal-senha", { state: "hidden" });

// O sistema abre em Vender
ok(await page.isVisible("#tab-vender") && !(await page.isVisible("#tab-caixa")), "abre em Vender");
const linhas = () => page.locator("#fin-lista-body tr:has(.fin-sel)").count();
const irLista = async () => { await page.click("#btn-tab-caixa"); await page.click('.subtabs[data-grupo="caixa"] .subtab[data-sub="lista"]'); };
const saida = async (valor, desc, pagoCom = "bradesco") => {
  await page.click("#btn-tab-caixa");
  ok(await page.isVisible("#fin-lancar"), "Caixa abre em Lançar");
  await page.locator('label:has(input[name="fin-tipo"][value="saida"])').click();
  await page.fill("#ff-data", "2026-08-24");
  await page.selectOption("#ff-conta", "energia");
  await page.fill("#ff-valor", String(valor));
  if (desc) await page.fill("#ff-desc", desc);
  await page.locator(`label:has(input[name="ff-pagocom"][value="${pagoCom}"])`).click();
  await page.click("#fin-form button[type=submit]");
};

await irLista();
ok(!(await page.isVisible("#aviso-sistema")) && !(await page.locator("#fin-aviso-v2, #import-file, #modal-acumulado").count()), "já começa pronto para lançar: sem aviso de salvamento seguro, sem migrar, sem importar e sem \"Saldos passados\"");
const base = hashLen(await db()); // 10 do sistema antigo de teste + 7 de abertura (convertidos na partida do servidor de teste)
const n0 = await linhas();
ok(base === 17 && n0 > 0, `mostra os lançamentos (${n0} na tela, ${base} no banco)`);
ok((await page.locator("form#finance-form, #fin-category").count()) === 0 && (await page.locator("#fin-form").count()) === 1, "só existe um formulário de lançamento (o antigo saiu)");
for (const rota of ["/api/migrar", "/api/importar", "/api/acumulado"]) {
  const r = await fetch(URL + rota, { method: "POST", headers: { "content-type": "application/json", "x-senha": "pinho123" }, body: "{}" });
  ok(r.status === 404, `${rota} não existe mais (${r.status})`);
}

// Backup (para restaurar no fim)
const [download] = await Promise.all([page.waitForEvent("download"), page.evaluate(() => window.Caixa.baixarBackup())]);
const caminhoBackup = "backup_antes.json"; await download.saveAs(caminhoBackup);
const backup = JSON.parse((await import("node:fs")).readFileSync(caminhoBackup, "utf8"));
ok(Object.keys(backup.chaves.madeireira_lancamentos).length === base, `backup baixado tem os ${base} lançamentos`);
let d = await db();

// Lançamento com texto perigoso
await saida(50, '<img src=x onerror="window.__xss=1">Energia');
await page.waitForFunction(() => document.querySelectorAll("#fin-lista-body").length && true);
await page.waitForTimeout(400);
d = await db();
ok(hashLen(d) === base + 1 && oldLen(d) === 10, "novo lançamento vai só para o hash, a lista antiga de teste não é regravada");
await irLista();
ok((await linhas()) === n0 + 1, "lista mostra mais um");
ok(!(await page.evaluate(() => window.__xss)), "descrição com HTML aparece como texto (não executa)");
ok((await page.textContent("#fin-lista-body")).includes("<img src=x"), "texto exibido literalmente");

// Outro aparelho lança ao mesmo tempo (direto na API)
await fetch(URL + "/api/lancamento", { method: "POST", headers: { "content-type": "application/json", "x-senha": "pinho123" },
  body: JSON.stringify({ itens: [{ id: "outroaparelho1", category: "venda", value: 99, date: "2026-08-24", method: "pix", description: "celular 2" }] }) });
await saida(10, "energia 2", "gaveta");
await page.waitForTimeout(400);
await irLista();
ok((await linhas()) === n0 + 3, "lançamento do outro aparelho aparece e nenhum some");

// Excluir (estornar) na lista nova
const antes = dialogos.length;
await page.locator("#fin-lista-body tr", { hasText: "celular 2" }).locator("[data-excluir]").click();
await page.waitForFunction((n) => document.querySelectorAll("#fin-lista-body tr .fin-sel").length === n, n0 + 2);
ok(dialogos.slice(antes).some((m) => m.startsWith("Estornar este lançamento?")), "pede confirmação ao estornar");
d = await db();
ok(JSON.parse(d.madeireira_lancamentos.outroaparelho1).excluido === true, "excluído continua guardado com marca");

// Restaurar o backup do começo (Ajustes › Dados)
await page.click("#btn-tab-ajustes"); await page.click('.subtabs[data-grupo="ajustes"] .subtab[data-sub="dados"]');
ok((await page.textContent("#status-banco")).includes("Banco:") && !(await page.textContent("#status-banco")).includes("salvamento seguro"), "Ajustes › Dados mostra a linha do banco (sem \"salvamento seguro\")");
await page.setInputFiles("#restore-file", caminhoBackup);
await page.waitForTimeout(600);
d = await db();
ok(hashLen(d) === base && !Object.keys(d.madeireira_lancamentos).includes("outroaparelho1"), "restaurar volta exatamente ao estado do backup");
await irLista();
ok((await linhas()) === n0, "tela mostra os do backup");
ok(Object.keys(d).some((k) => k.includes("antes-de-restaurar")), "estado anterior à restauração guardado no KV");
// O "Exportar" do sistema antigo não é mais aceito (a virada foi zerada)
const rAntigo = await fetch(URL + "/api/restaurar", { method: "POST", headers: { "content-type": "application/json", "x-senha": "pinho123" }, body: JSON.stringify({ confirmacao: "RESTAURAR", arquivo: { financeItems: [] } }) });
ok(rAntigo.status === 400 && (await rAntigo.json()).error.includes("sistema antigo"), "arquivo do sistema antigo é recusado ao restaurar");

// Sem conexão
await page.route("**/api/getFinance", (r) => r.abort());
await page.reload();
await page.waitForSelector(".aviso-erro");
ok((await page.textContent("#aviso-sistema")).includes("Sem conexão"), "sem conexão: aviso de somente leitura");
let chamadasGravacao = 0;
page.on("request", (r) => { if (r.url().includes("/api/lancamento")) chamadasGravacao++; });
await saida(10);
await page.waitForTimeout(200);
ok(ultimo().includes("Sem conexão") && chamadasGravacao === 0, "sem conexão: não grava nada");
await page.screenshot({ path: "sem-conexao.png", fullPage: false });

await browser.close();
