// Vender com Enter: passa de campo em campo (Material → Medida → Acabamento → Quantidade → Comprimento) e, no
// último, adiciona o item e volta para Material. O Enter nunca registra a venda, nem salva orçamento, nem imprime.
// Roda no computador e num celular (tela de toque, teclado com "Próximo"/"Ir").
import { createRequire } from "node:module";
const require = createRequire("/opt/node-tools/node_modules/");
const { chromium, devices } = require("playwright");
const URL = "http://localhost:4321";
const H = { "content-type": "application/json", "x-senha": "pinho123" };
const ok = (cond, msg) => { console.log((cond ? "OK   " : "FALHA") + " " + msg); if (!cond) process.exitCode = 1; };
const db = async () => (await fetch(URL + "/__db")).json();
const quantos = async () => Object.keys((await db()).madeireira_lancamentos || {}).length + Object.keys((await db()).madeireira_orcamentos || {}).length;

await fetch(URL + "/api/migrar", { method: "POST", headers: H });
await fetch(URL + "/api/migrar?versao=2", { method: "POST", headers: H });
await fetch(URL + "/api/precos", { method: "POST", headers: H, body: JSON.stringify({ alteracoes: { "PINUS|1x2x2.50|BRUTO": 4.5, "CAMBARA|1x2|BRUTO": 30 } }) });

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
for (const [nome, opcoes] of [["computador", { viewport: { width: 1280, height: 950 } }], ["celular", { ...devices["Pixel 7"] }]]) {
  const ctx = await browser.newContext({ ...opcoes, locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.accept());
  page.on("pageerror", (e) => console.log("ERRO JS:", e.message));
  await page.goto(URL);
  await page.fill("#senha-input", "pinho123"); await page.click("#senha-form button");
  await page.waitForFunction(() => document.getElementById("catalogo-status").textContent.includes("itens"));
  const foco = () => page.evaluate(() => document.activeElement?.id || document.activeElement?.name || document.activeElement?.tagName);
  const linhas = () => page.locator("#items-body tr.linha-item").count();
  const antes = await quantos();

  // Pinus: Material → Medida → Acabamento → Peças → (Enter) adiciona e volta para Material
  await page.focus("#material");
  await page.selectOption("#material", "PINUS");
  await page.keyboard.press("Enter");
  ok(await foco() === "dimension", `${nome}: Enter em Material vai para Medida`);
  await page.selectOption("#dimension", "PINUS|1x2x2.50");
  await page.keyboard.press("Enter");
  ok(await foco() === "acabamento", `${nome}: Enter em Medida vai para Acabamento`);
  await page.keyboard.press("Enter");
  ok(await foco() === "quantity-pieces" && await page.getAttribute("#quantity-pieces", "enterkeyhint") === "done", `${nome}: Enter no Acabamento vai para Peças (o último campo, tecla "concluir" no celular)`);
  await page.keyboard.type("6");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelectorAll("#items-body tr.linha-item").length === 1);
  ok(await linhas() === 1 && await foco() === "material", `${nome}: Enter no último campo adiciona o item e volta para Material`);

  // Cambará (metro linear): Peças → Comprimento → adiciona
  await page.selectOption("#material", "CAMBARA");
  await page.keyboard.press("Enter");
  await page.selectOption("#dimension", "CAMBARA|1x2");
  await page.keyboard.press("Enter"); // acabamento
  await page.keyboard.press("Enter");
  ok(await foco() === "quantity-pieces" && await page.getAttribute("#quantity-pieces", "enterkeyhint") === "next", `${nome}: com comprimento, Peças tem a tecla "próximo"`);
  await page.keyboard.type("4");
  await page.keyboard.press("Enter");
  ok(await foco() === "quantity-length", `${nome}: Enter em Peças vai para o Comprimento`);
  await page.keyboard.type("3");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelectorAll("#items-body tr.linha-item").length === 2);
  ok(await linhas() === 2 && await foco() === "material", `${nome}: Enter no Comprimento adiciona (4 pç × 3 m) e volta para Material`);

  // Medida sem escolha: o Enter fica na lista
  await page.selectOption("#material", "PINUS");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  ok(await foco() === "dimension", `${nome}: Medida sem escolha, o Enter não avança`);

  // Enter em qualquer lugar do pedido não registra, não salva orçamento, não imprime
  for (const sel of ["#material", "#quantity-pieces", "#pct-geral", "#frete-valor", "#calc-nfe"]) {
    if (await page.locator(sel).count() && await page.locator(sel).isVisible() && await page.locator(sel).isEnabled()) { await page.focus(sel); await page.keyboard.press("Enter"); }
  }
  await page.waitForTimeout(400);
  ok(await quantos() === antes && await page.isHidden("#modal-impressao"), `${nome}: Enter nunca registra a venda nem abre a impressão`);

  // Salvar orçamento: o Enter passa de campo; salvar só pelo botão
  await page.click("#btn-salvar-orcamento");
  await page.waitForSelector("#modal-orc-salvar", { state: "visible" });
  await page.fill("#orc-nome", "Carlos");
  await page.keyboard.press("Enter");
  ok(await foco() === "orc-tel", `${nome}: Salvar orçamento, Enter no nome vai para o WhatsApp`);
  await page.keyboard.type("(47) 99999-1234");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);
  ok(await quantos() === antes && await page.isVisible("#modal-orc-salvar"), `${nome}: Enter não salva o orçamento`);
  await page.click("#modal-orc-salvar .btn-icon");

  // Modo balcão: o nome é só "Modo balcão", ligado ou desligado, sem falar de custo
  await page.click("#btn-balcao");
  const b1 = [await page.textContent("#btn-balcao"), await page.getAttribute("#btn-balcao", "title"), await page.getAttribute("#btn-balcao", "aria-pressed")];
  await page.click("#btn-balcao");
  const b2 = [await page.textContent("#btn-balcao"), await page.getAttribute("#btn-balcao", "title")];
  ok(b1[0].trim() === "👁 Modo balcão" && b2[0].trim() === "👁 Modo balcão" && b1[2] === "true" && !/custo|margem/i.test(b1.join(" ") + b2.join(" ")), `${nome}: botão "Modo balcão" sem menção a custo`);
  await ctx.close();
}
await browser.close();
