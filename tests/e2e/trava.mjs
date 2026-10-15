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
await page.click("#btn-tab-ajustes"); await page.click('.subtabs[data-grupo="ajustes"] .subtab[data-sub="dados"]');
await page.waitForFunction(() => document.getElementById("status-banco").textContent.includes("Banco:"));
const st = await page.textContent("#status-banco");
ok(st.includes("GRAVAÇÃO BLOQUEADA"), "tela mostra: " + st);
// Mesmo com PERMITIR_ZERAR=sim, o banco de produção nunca pode ser zerado
ok(await page.isHidden("#zerar-bloco") && !st.includes("ZERAR"), "banco de produção: o botão Zerar não aparece");
const z = await fetch(URL + "/api/zerar", { method: "POST", headers: H, body: JSON.stringify({ confirmacao: "ZERAR" }) });
ok(z.status === 423 && Object.keys(await (await fetch(URL + "/__db")).json()).length > 0, "banco de produção: /api/zerar recusado (423) e nada apagado");
await browser.close();
