import { createRequire } from "node:module";
const require = createRequire("/opt/node-tools/node_modules/");
const { chromium } = require("playwright");
const URL = "http://localhost:4321";
const H = { "content-type": "application/json", "x-senha": "pinho123" };
const ok = (cond, msg) => { console.log((cond ? "OK   " : "FALHA") + " " + msg); if (!cond) process.exitCode = 1; };
for (const [rota, corpo] of [["/api/restaurar", { confirmacao: "RESTAURAR", arquivo: { financeItems: [] } }], ["/api/migrar", {}], ["/api/importar", { financeItems: [] }], ["/api/precos", { alteracoes: { "CAMBARA|1x2|BRUTO": 5 } }]]) {
  const r = await fetch(URL + rota, { method: "POST", headers: H, body: JSON.stringify(corpo) });
  ok(r.status === 423, `${rota} bloqueado (${r.status})`);
}
const antes = await (await fetch(URL + "/__db")).json();
const r = await fetch(URL + "/api/backup", { headers: H });
const depois = await (await fetch(URL + "/__db")).json();
ok(r.status === 200 && Object.keys(antes).length === Object.keys(depois).length, "backup (leitura) funciona e não grava cópia no banco de produção");
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const page = await browser.newPage();
await page.goto(URL);
await page.fill("#senha-input", "pinho123"); await page.click("#senha-form button");
await page.click("#btn-tab-finance");
await page.waitForFunction(() => document.getElementById("status-banco").textContent.includes("Banco:"));
const st = await page.textContent("#status-banco");
ok(st.includes("GRAVAÇÃO BLOQUEADA"), "tela mostra: " + st);
await browser.close();
