// Ensaio: banco vazio → (Restaurar + Ativar) ou (Importar) → Conferir com arquivo
import { createRequire } from "node:module";
const require = createRequire("/opt/node-tools/node_modules/");
const { chromium } = require("playwright");
const [ARQUIVO, MODO] = process.argv.slice(2);
const URL = "http://localhost:4321";
const ok = (cond, msg) => { console.log((cond ? "OK   " : "FALHA") + " " + msg); if (!cond) process.exitCode = 1; };
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
const dialogos = [];
page.on("dialog", async (d) => { dialogos.push(d.message()); d.type() === "prompt" ? await d.accept("RESTAURAR") : await d.accept(); });
page.on("pageerror", (e) => console.log("ERRO JS:", e.message));
await page.goto(URL);
await page.fill("#senha-input", "pinho123"); await page.click("#senha-form button");
await page.click("#btn-tab-finance");
await page.waitForFunction(() => document.getElementById("status-banco").textContent.includes("Banco:"));
console.log("     status:", await page.textContent("#status-banco"));
if (MODO === "restaurar") {
  await page.setInputFiles("#restore-file", ARQUIVO);
  await page.waitForFunction(() => document.getElementById("aviso-sistema").textContent.includes("salvamento seguro"));
  console.log("     ", dialogos.at(-1).split("\n").filter(Boolean).join(" | "));
  await page.click("text=1. 💾 Baixar backup");
  await page.click("#aviso-sistema .btn-success");
  await page.waitForFunction(() => document.getElementById("aviso-sistema").style.display === "none");
  console.log("     ", dialogos.at(-1).split("\n").filter(Boolean).join(" | "));
} else {
  await page.setInputFiles("#import-file", ARQUIVO);
  await page.waitForFunction(() => document.getElementById("status-banco").textContent.includes("ativo"));
  console.log("     ", dialogos.at(-1).split("\n").filter(Boolean).join(" | "));
}
await page.setInputFiles("#conferir-file", ARQUIVO);
await page.waitForSelector("#modal-conferencia", { state: "visible" });
const veredito = await page.textContent("#conferencia-veredito");
ok(veredito.includes("Tudo confere"), "conferência: " + veredito.trim());
const linhas = await page.$$eval("#conferencia-body tr", (trs) => trs.map((tr) => [...tr.children].slice(0, 4).map((td) => td.textContent.trim()).join(" | ")));
console.log(linhas.map((l) => "      " + l).join("\n"));
await page.screenshot({ path: `conferencia-${MODO}.png`, fullPage: true });
await browser.close();
