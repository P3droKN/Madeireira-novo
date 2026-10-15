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

await page.click("#btn-tab-finance");
await page.fill("#filter-date", "2026-08-24"); await page.dispatchEvent("#filter-date", "change");
ok(await page.isVisible("#aviso-sistema"), "aviso de ativar salvamento seguro aparece");
ok(await page.isDisabled("#aviso-sistema .btn-success"), "botão 2 bloqueado antes do backup");
ok((await page.locator("#finance-body tr").count()) === 10, "mostra os 10 lançamentos da lista antiga");

// Tenta lançar antes de migrar
await page.selectOption("#fin-category", "despesa");
await page.fill("#fin-value", "50"); await page.fill("#fin-date", "2026-08-24");
await page.click("#finance-form button[type=submit]");
await page.waitForTimeout(200);
ok(ultimo().includes("Antes de lançar"), "bloqueia lançamento antes da migração");
ok(oldLen(await db()) === 10, "lista antiga intacta");

// Backup + migração
const [download] = await Promise.all([page.waitForEvent("download"), page.click("text=1. 💾 Baixar backup")]);
const caminhoBackup = "backup_antes.json"; await download.saveAs(caminhoBackup);
const backup = JSON.parse((await import("node:fs")).readFileSync(caminhoBackup, "utf8"));
ok(backup.chaves.madeireira_finance.length === 10 && backup.chaves.madeireira_acumulado.venda === 48866, "backup baixado tem os 10 lançamentos e o acumulado");
ok(!(await page.isDisabled("#aviso-sistema .btn-success")), "botão 2 liberado depois do backup");
await page.click("#aviso-sistema .btn-success");
await page.waitForFunction(() => document.getElementById("aviso-sistema").style.display === "none");
ok(ultimo().includes("10 lançamentos copiados"), "migração copia 10 lançamentos");
let d = await db();
ok(hashLen(d) === 10 && oldLen(d) === 10, "hash com 10 e lista antiga ainda com 10");
ok(Object.keys(d).some((k) => k.includes("antes-da-migracao")), "cópia automática antes da migração no KV");

// Lançamento com texto perigoso
await page.selectOption("#fin-category", "despesa");
await page.fill("#fin-value", "50"); await page.fill("#fin-date", "2026-08-24");
await page.fill("#fin-description", '<img src=x onerror="window.__xss=1">Energia');
await page.selectOption("#fin-method", "bradesco");
await page.click("#finance-form button[type=submit]");
await page.waitForFunction(() => document.querySelectorAll("#finance-body tr").length === 11);
d = await db();
ok(hashLen(d) === 11 && oldLen(d) === 10, "novo lançamento vai só para o hash (11), lista antiga não é regravada");
ok(!(await page.evaluate(() => window.__xss)), "descrição com HTML aparece como texto (não executa)");
ok((await page.textContent("#finance-body")).includes("<img src=x"), "texto exibido literalmente");

// Outro aparelho lança ao mesmo tempo (direto na API)
await fetch(URL + "/api/lancamento", { method: "POST", headers: { "content-type": "application/json", "x-senha": "pinho123" },
  body: JSON.stringify({ itens: [{ id: "outroaparelho1", category: "venda", value: 99, date: "2026-08-24", method: "pix", description: "celular 2" }] }) });
await page.selectOption("#fin-category", "venda");
await page.fill("#fin-value", "10"); await page.fill("#fin-date", "2026-08-24"); await page.selectOption("#fin-method", "pix");
await page.click("#finance-form button[type=submit]");
await page.waitForFunction(() => document.querySelectorAll("#finance-body tr").length === 13);
ok(true, "lançamento do outro aparelho aparece e nenhum some (13)");

// Excluir
const antes = dialogos.length;
await page.locator("#finance-body tr", { hasText: "celular 2" }).locator("button").click();
await page.waitForFunction(() => document.querySelectorAll("#finance-body tr").length === 12);
ok(dialogos.slice(antes).some((m) => m.startsWith("Excluir este lançamento?")), "pede confirmação ao excluir");
d = await db();
ok(JSON.parse(d.madeireira_lancamentos.outroaparelho1).excluido === true, "excluído continua guardado com marca");

// Restaurar o backup de antes da migração
await page.setInputFiles("#restore-file", caminhoBackup);
await page.waitForFunction(() => document.getElementById("aviso-sistema").style.display === "block");
d = await db();
ok(!d.madeireira_lancamentos && !d.madeireira_migrado_v1 && oldLen(d) === 10, "restaurar volta exatamente ao estado de antes da migração");
ok((await page.locator("#finance-body tr").count()) === 10, "tela mostra os 10 originais");
ok(Object.keys(d).some((k) => k.includes("antes-de-restaurar")), "estado anterior à restauração guardado no KV");

// Sem conexão
await page.route("**/api/getFinance", (r) => r.abort());
await page.reload();
await page.click("#btn-tab-finance");
await page.waitForSelector(".aviso-erro");
ok((await page.textContent("#aviso-sistema")).includes("Sem conexão"), "sem conexão: aviso de somente leitura");
let chamadasGravacao = 0;
page.on("request", (r) => { if (r.url().includes("/api/lancamento")) chamadasGravacao++; });
await page.fill("#fin-value", "10"); await page.fill("#fin-date", "2026-08-24");
await page.click("#finance-form button[type=submit]");
await page.waitForTimeout(200);
ok(ultimo().includes("Sem conexão") && chamadasGravacao === 0, "sem conexão: não grava nada");
await page.screenshot({ path: "sem-conexao.png", fullPage: false });

await browser.close();
