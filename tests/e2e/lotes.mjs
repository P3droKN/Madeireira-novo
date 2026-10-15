import { createRequire } from "node:module";
const require = createRequire("/opt/node-tools/node_modules/");
const { chromium } = require("playwright");
const ARQ = process.argv[2];
const URL = "http://localhost:4321";
const ok = (cond, msg) => { console.log((cond ? "OK   " : "FALHA") + " " + msg); if (!cond) process.exitCode = 1; };
const contar = async () => Object.keys((await (await fetch(URL + "/__db")).json()).madeireira_lancamentos || {}).length;
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
page.on("dialog", (d) => d.accept());
page.on("pageerror", (e) => console.log("ERRO JS:", e.message));
await page.goto(URL);
await page.fill("#senha-input", "pinho123"); await page.click("#senha-form button");
await page.click("#btn-tab-finance");
await page.waitForFunction(() => document.getElementById("status-banco").textContent.includes("Banco:"));

// 1ª tentativa: o lote 3 falha nas 3 tentativas
await page.setInputFiles("#import-file", ARQ);
await page.waitForFunction(() => !document.getElementById("progresso-fechar").hidden, null, { timeout: 60000 });
const titulo1 = await page.textContent("#progresso-titulo");
const erro1 = await page.textContent("#progresso-erro");
console.log("     ", titulo1, "|", await page.textContent("#progresso-texto"));
console.log("      erro:", erro1);
ok(titulo1.includes("parou") && erro1.includes("lote 201 a 300") && erro1.includes("demorou demais"), "parada com erro claro (lote e motivo)");
await page.screenshot({ path: "importacao-parou.png" });
ok(await contar() === 200, "banco ficou com os 200 lançamentos dos lotes que deram certo");
await page.click("#progresso-fechar");

// 2ª tentativa: mesmo arquivo, continua de onde parou
await page.setInputFiles("#import-file", ARQ);
await page.waitForFunction(() => document.getElementById("progresso-titulo").textContent.includes("concluída"), null, { timeout: 60000 });
const texto2 = await page.textContent("#progresso-texto");
console.log("     ", await page.textContent("#progresso-titulo"), "|", texto2);
ok(texto2.includes("Novos: 542") && texto2.includes("Já existiam: 200"), "segunda vez: 542 novos, 200 pulados (sem duplicar)");
ok(await contar() === 742, "banco com 742 lançamentos");
await page.screenshot({ path: "importacao-concluida.png" });
await page.click("#progresso-fechar");

await page.setInputFiles("#conferir-file", ARQ);
await page.waitForSelector("#modal-conferencia", { state: "visible" });
ok((await page.textContent("#conferencia-veredito")).includes("Tudo confere"), "conferência: " + (await page.textContent("#conferencia-veredito")).trim());
await browser.close();
