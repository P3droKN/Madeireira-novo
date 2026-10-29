import { createRequire } from "node:module";
const require = createRequire("/opt/node-tools/node_modules/");
const { chromium } = require("playwright");
import { fecharVias } from "./janela.mjs";
const URL = "http://localhost:4321";
const H = { "content-type": "application/json", "x-senha": "pinho123" };
const nb = (s) => (s || "").replace(/ /g, " ");
const ok = (cond, msg) => { console.log((cond ? "OK   " : "FALHA") + " " + msg); if (!cond) process.exitCode = 1; };
const db = async () => (await fetch(URL + "/__db")).json();
const orc = async (id) => JSON.parse((await db()).madeireira_orcamentos[id]);
const preco = (alteracoes) => fetch(URL + "/api/precos", { method: "POST", headers: H, body: JSON.stringify({ alteracoes }) });

await fetch(URL + "/api/migrar", { method: "POST", headers: H });
await preco({ "PINUS|2x4x3.00|BRUTO": 25 });

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await browser.newContext({ viewport: { width: 1250, height: 950 }, locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
const page = await ctx.newPage();
await page.clock.install({ time: new Date("2026-10-15T10:00:00-03:00") });
const dialogos = [];
page.on("dialog", async (d) => { dialogos.push(d.message()); d.type() === "prompt" ? await d.accept("cliente achou caro") : await d.accept(); });
page.on("pageerror", (e) => console.log("ERRO JS:", e.message));
const irPara = async (data) => { await page.clock.setFixedTime(new Date(`${data}T10:00:00-03:00`)); await page.reload(); await page.click("#btn-tab-orcamentos"); await page.waitForSelector("#orc-body tr"); };
const linhaOrc = (id) => page.locator("#orc-body tr", { has: page.locator(`td strong:text-is("${id}")`) });
const abaOrc = async (g) => { await page.locator(`label:has(input[name="orc-aba"][value="${g}"])`).click(); await page.waitForTimeout(100); };
const menu = async (id, acao) => { await linhaOrc(id).locator("summary").click(); await linhaOrc(id).locator(`[data-acao="${acao}"]`).click(); };

await page.goto(URL);
await page.fill("#senha-input", "pinho123"); await page.click("#senha-form button");
await page.waitForFunction(() => document.getElementById("catalogo-status").textContent.includes("itens"));

// 1. Salvar orçamento
await page.selectOption("#material", "PINUS"); await page.selectOption("#dimension", "PINUS|2x4x3.00");
await page.fill("#quantity-pieces", "10"); await page.click("#btn-adicionar");
await page.locator(".linha-ajuste .pct-input").first().fill("10"); await page.locator(".linha-ajuste .pct-input").first().dispatchEvent("change");
await page.waitForTimeout(150);
await page.click("#btn-salvar-orcamento");
await page.fill("#orc-nome", "Carlos Souza");
await page.fill("#orc-tel", "9999-1234");
ok((await page.textContent("#orc-tel-info")).includes("DDD"), "telefone sem DDD é recusado na hora");
await page.fill("#orc-tel", "(47) 99999-1234");
await page.locator('label:has(input[name="orc-origem"][value="whatsapp"])').click();
await page.fill("#orc-obs", "entrega na obra");
await page.click("#orc-salvar-botao");
await fecharVias(page, dialogos);
await page.waitForFunction(() => document.getElementById("modal-orc-salvar").style.display === "none");
for (let i = 0; i < 50 && !dialogos.some((d) => d.includes("ORC-0001")); i++) await page.waitForTimeout(100); // o aviso vem depois de recarregar a lista
ok(dialogos.at(-1).includes("ORC-0001") && nb(dialogos.at(-1)).includes("R$ 275,00"), "salvo como ORC-0001 de R$ 275,00");
let o1 = await orc("ORC-0001");
ok(o1.validoAte === "2026-10-22" && o1.custo === 183.6 && o1.itens[0].variacaoPct > 9.99 && o1.cliente.telefone === "(47) 99999-1234", "grava itens, % aplicado, custo, validade de 7 dias e cliente");
ok((await page.locator("#items-body tr.linha-item").count()) === 0, "pedido limpo depois de salvar");

// 2. Segundo orçamento, mesmo telefone (cadastro reaproveitado)
await page.selectOption("#material", "CAMBARA"); await page.selectOption("#dimension", "CAMBARA|1x2");
await page.fill("#quantity-pieces", "6"); await page.fill("#quantity-length", "3"); await page.click("#btn-adicionar");
await page.locator("#items-body .preco-input").first().fill("5"); await page.locator("#items-body .preco-input").first().dispatchEvent("change");
await page.waitForTimeout(150);
await page.click("#btn-salvar-orcamento");
await page.fill("#orc-tel", "47999991234"); await page.dispatchEvent("#orc-tel", "input");
ok(await page.inputValue("#orc-nome") === "Carlos Souza", "telefone já cadastrado preenche o nome");
await page.click("#orc-salvar-botao");
await fecharVias(page, dialogos);
await page.waitForFunction(() => document.getElementById("modal-orc-salvar").style.display === "none");
ok(Object.keys((await db()).madeireira_clientes).length === 1, "um cliente só no cadastro");

// 3. Lista e Enviar no WhatsApp
await page.click("#btn-tab-orcamentos");
await page.waitForSelector("#orc-body tr");
ok((await page.locator("#orc-body tr").count()) === 2, "lista com os 2 orçamentos em aberto");
ok(nb(await page.textContent("#orc-indicadores")).includes("R$ 365,00"), "valor em aberto R$ 365,00");
ok((await page.locator("#orc-indicadores > *").count()) === 3, "só 3 indicadores no topo (em aberto, conversão, para cobrar)");
ok((await page.locator("#orc-body select, #orc-f-status").count()) === 0, "sem seletor de status na linha nem no filtro");
ok(await page.isChecked('input[name="orc-aba"][value="aberto"]') && !(await page.isVisible("#orc-f-de")), "abre na aba Em aberto; datas escondidas em Mais filtros");
await linhaOrc("ORC-0001").locator('[data-acao="enviar"]').click();
const textoEnviar = await page.inputValue("#orc-whats-texto");
const href = await page.getAttribute("#orc-whats-abrir", "href");
ok(href.startsWith("https://wa.me/5547999991234?text=") && decodeURIComponent(href.split("text=")[1]) === textoEnviar, "Enviar: wa.me/55 + DDD + número, com o texto do orçamento");
ok(textoEnviar.includes("*Orçamento ORC-0001") && nb(textoEnviar).includes("*Total: R$ 275,00*") && !/custo|margem|tabela/i.test(textoEnviar), "texto sem custo, margem nem tabela");
const [aba] = await Promise.all([ctx.waitForEvent("page"), page.click("#orc-whats-abrir")]);
await aba.close();
await page.waitForTimeout(400);
o1 = await orc("ORC-0001");
ok(o1.status === "aberto" && o1.ultimoContato && o1.contatos[0].tipo === "enviar", "clicar em Enviar registra o último contato (continua Em aberto)");

// 4. Dois dias depois ainda não; três dias depois: 🔔
await irPara("2026-10-17");
ok((await page.locator("#orc-body .sino").count()) === 0 && nb(await page.textContent("#orc-sino")).includes("Para cobrar hoje0"), "2 dias sem contato: ainda sem 🔔");
await irPara("2026-10-18");
ok(nb(await page.textContent("#orc-sino")).includes("Para cobrar hoje2"), "topo: 🔔 2 para cobrar hoje");
ok(await page.textContent("#orc-contador") === "🔔 2", "contador 🔔 na aba Orçamentos");
ok((await linhaOrc("ORC-0002").locator(".sino").count()) === 1, "3 dias sem contato: 🔔 na linha");
await page.click("#orc-sino");
ok(await page.isVisible("#orc-filtro-sino") && (await page.locator("#orc-body tr").count()) === 2, "clicar no 🔔 filtra só os para cobrar");
await page.click("#orc-sino-limpar");
ok(!(await page.isVisible("#orc-filtro-sino")), "Mostrar todos tira o filtro");
await linhaOrc("ORC-0002").locator('[data-acao="cobrar"]').click();
const cobranca = await page.inputValue("#orc-whats-texto");
ok(nb(cobranca) === "Olá Carlos, tudo bem? Aqui é da Madeireira. Passando para saber se conseguiu ver o orçamento ORC-0002 de R$ 90,00. Qualquer dúvida estou à disposição!", "Cobrar: modelo com nome, número e valor");
await page.selectOption("#orc-whats-modelo", "1");
ok(nb(await page.inputValue("#orc-whats-texto")).includes("vale até 22/10/2026"), "segundo modelo com {validade}");
const [aba2] = await Promise.all([ctx.waitForEvent("page"), page.click("#orc-whats-abrir")]);
await aba2.close();
await page.waitForTimeout(400);
ok((await orc("ORC-0002")).contatos[0].tipo === "cobrar", "cobrança registrada");

// 5. Vencido: vermelho e Atualizar preços
await preco({ "PINUS|2x4x3.00|BRUTO": 30 });
await irPara("2026-10-25");
ok((await linhaOrc("ORC-0001").getAttribute("class")).includes("cor-vermelho") && nb(await linhaOrc("ORC-0001").locator(".selo-vencido").textContent()).includes("vencido – preços podem ter mudado"), "vencido: selo vermelho 'vencido – preços podem ter mudado'");
ok(await page.isChecked('input[name="orc-aba"][value="aberto"]') && (await linhaOrc("ORC-0001").count()) === 1 && (await orc("ORC-0001")).status === "aberto", "orçamento vencido continua guardado e Em aberto");
await linhaOrc("ORC-0001").locator('[data-acao="precos"]').first().click();
ok(nb(await page.textContent("#orc-precos-total")).includes("R$ 275,00 → R$ 330,00") && nb(await page.textContent("#orc-precos-total")).includes("+R$ 55,00"), "atualizar preços: tabela nova (30) + 10% = R$ 330,00, diferença +R$ 55,00");
await page.click("#orc-precos-aplicar");
await page.waitForTimeout(400);
o1 = await orc("ORC-0001");
ok(o1.total === 330 && o1.validoAte === "2026-11-01", "preços aplicados e validade renovada");
ok(!(await linhaOrc("ORC-0001").getAttribute("class")).includes("cor-vermelho"), "deixa de ficar vermelho");

// 6. Converter em venda
await linhaOrc("ORC-0001").locator('[data-acao="converter"]').click();
await page.click("#orc-converter-orcamento");
await page.waitForSelector("#orc-vinculo:not([hidden])");
ok(nb(await page.textContent("#orc-vinculo")).includes("Venda do orçamento ORC-0001") && nb(await page.textContent("#total-cobrar")) === "R$ 330,00", "pedido carregado na Calculadora com o vínculo e os preços do orçamento");
await page.click("#btn-registrar-venda");
await fecharVias(page, dialogos);
await page.waitForFunction(() => document.querySelectorAll("#items-body tr.linha-item").length === 0);
o1 = await orc("ORC-0001");
const venda = Object.values((await db()).madeireira_lancamentos).map((x) => JSON.parse(x)).find((l) => l.orcamento === "ORC-0001");
ok(o1.status === "fechado" && venda && o1.vendaId === venda.id && venda.value === 330, "venda registrada e orçamento Fechado com vínculo para a venda");

// 7. Perdido, indicadores
await page.click("#btn-tab-orcamentos"); await page.waitForSelector("#orc-body tr");
await abaOrc("fechado");
ok((await linhaOrc("ORC-0001").count()) === 1, "convertido aparece em Fechados");
await linhaOrc("ORC-0001").locator("summary").click();
ok((await linhaOrc("ORC-0001").locator('[data-acao="excluir"]').count()) === 0 && nb(await linhaOrc("ORC-0001").locator(".menu-nota").textContent()).includes("estorne a venda no Caixa"), "convertido não pode ser excluído (o menu explica: estornar a venda no Caixa)");
ok((await linhaOrc("ORC-0001").locator('[data-acao="reabrir"]').count()) === 0, "convertido com venda ativa não mostra Reabrir");
await linhaOrc("ORC-0001").locator("summary").click();
const recusa = await fetch(URL + "/api/orcamentos", { method: "PATCH", headers: H, body: JSON.stringify({ id: "ORC-0001", acao: "excluir" }) });
ok(recusa.status === 409, "servidor também recusa excluir orçamento convertido (409)");
await abaOrc("aberto");
await menu("ORC-0002", "perdido");
await page.click('#orc-perdido-motivos [data-motivo="Preço"]');
await page.waitForTimeout(400);
ok((await orc("ORC-0002")).motivoPerda === "Preço", "perdido com motivo Preço");
ok((await linhaOrc("ORC-0002").count()) === 0, "perdido sai de Em aberto");
const ind = nb(await page.textContent("#orc-indicadores"));
ok(ind.includes("50%"), "topo: conversão do mês 50%");
// Tempo médio, motivos de perda e origem foram para Relatórios
await page.click("#btn-tab-relatorios"); await page.click('.subtabs[data-grupo="relatorios"] .subtab[data-sub="orcamentos"]');
const rel = nb(await page.textContent("#rel-orcamentos-conteudo"));
ok(rel.includes("10,0 dias") && rel.includes("Preço1") && rel.includes("WhatsApp1"), "Relatórios › Orçamentos: 10 dias até fechar, perda por preço, origem");

// 8. Reabrir, duplicar e editar
await page.click("#btn-tab-orcamentos"); await page.waitForSelector("#orc-body tr");
await abaOrc("perdido");
await menu("ORC-0002", "reabrir");
await page.waitForTimeout(400);
ok((await orc("ORC-0002")).status === "aberto", "Reabrir: perdido volta para Em aberto");
await abaOrc("aberto");
ok((await linhaOrc("ORC-0002").count()) === 1, "reaberto aparece em Em aberto");
await menu("ORC-0002", "perdido");
await page.click('#orc-perdido-motivos [data-motivo="Preço"]');
await page.waitForTimeout(400);
await abaOrc("perdido");
await menu("ORC-0002", "duplicar");
await page.waitForSelector("#orc-vinculo:not([hidden])");
await page.click("#btn-salvar-orcamento");
ok(await page.inputValue("#orc-nome") === "Carlos Souza", "duplicar já traz o cliente");
await page.click("#orc-salvar-botao");
await fecharVias(page, dialogos);
await page.waitForFunction(() => document.getElementById("modal-orc-salvar").style.display === "none");
const o3 = await orc("ORC-0003");
ok(o3.duplicadoDe === "ORC-0002" && o3.total === 90 && o3.status === "aberto", "duplicado como ORC-0003");
await page.click("#btn-tab-orcamentos"); await page.waitForSelector("#orc-body tr");
await abaOrc("aberto");
await menu("ORC-0003", "editar");
await page.waitForSelector("#orc-vinculo:not([hidden])");
ok((await page.textContent("#btn-salvar-orcamento")).includes("Salvar alterações no ORC-0003"), "editar: botão vira 'Salvar alterações no ORC-0003'");
await page.locator("#total-final").fill("100"); await page.locator("#total-final").dispatchEvent("change");
await page.waitForTimeout(150);
await page.click("#btn-salvar-orcamento"); await page.click("#orc-salvar-botao");
await fecharVias(page, dialogos);
await page.waitForFunction(() => document.getElementById("modal-orc-salvar").style.display === "none");
ok((await orc("ORC-0003")).total === 100 && !(await db()).madeireira_orcamentos["ORC-0004"], "edição mantém o número (ORC-0003 com R$ 100,00)");

// 9. Imprimir
await page.click("#btn-tab-orcamentos"); await page.waitForSelector("#orc-body tr");
await abaOrc("aberto");
await menu("ORC-0003", "imprimir");
await page.waitForSelector("#modal-impressao", { state: "visible" });
const imp = nb(await page.textContent("#imp-previa-folha"));
ok(imp.includes("ORÇAMENTO Nº ORC-0003") && imp.includes("R$ 100,00") && imp.includes("Válido até") && !/custo|margem|tabela|assinatura/i.test(imp), "menu ⋯ › 🖨 Imprimir 2 vias: prévia sem custo, margem, tabela nem assinatura");
await page.click("#imp-fechar");
await page.screenshot({ path: "orcamentos.png", fullPage: true });

// 10. Excluir (lixeira) e restaurar
const antesValor = nb(await page.textContent("#orc-indicadores"));
ok(antesValor.includes("R$ 100,00"), "em aberto antes de excluir: R$ 100,00 (ORC-0003)");
const nDialogos = dialogos.length;
await menu("ORC-0003", "excluir");
await page.waitForTimeout(400);
const conf = dialogos.slice(nDialogos).join("|");
ok(conf.includes("Excluir ORC-0003 de Carlos Souza?") && conf.includes("erro ou teste") && conf.includes("Marcar como perdido"), "pede confirmação: 'Excluir ORC-0003 de Carlos Souza?' e explica Perdido × Excluir");
ok((await linhaOrc("ORC-0003").count()) === 0 && (await orc("ORC-0003")).excluidoEm, "excluído some da lista, mas continua guardado (lixeira)");
ok(nb(await page.textContent("#orc-indicadores")).includes("R$ 0,00"), "excluído não conta nos indicadores");
ok((await page.textContent("#orc-lixeira-link")).includes("Lixeira (1)"), "link da Lixeira mostra 1");
ok(nb(await page.textContent(".legenda-cores")).includes("Perdido = o cliente não fechou") && nb(await page.textContent(".legenda-cores")).includes("Excluir = foi erro ou teste"), "a tela explica a diferença entre Perdido e Excluir");
await page.click("#orc-lixeira-link");
ok(await page.isVisible("#orc-lixeira") && (await page.locator("#orc-lixeira-body tr", { hasText: "ORC-0003" }).count()) === 1, "Lixeira lista o ORC-0003");
await page.locator("#orc-lixeira-body tr", { hasText: "ORC-0003" }).locator('[data-acao="restaurar"]').click();
await page.waitForTimeout(400);
ok(!(await orc("ORC-0003")).excluidoEm && (await orc("ORC-0003")).status === "aberto", "restaurar da lixeira: volta Em aberto");
await page.click("#orc-lixeira-voltar");
ok((await linhaOrc("ORC-0003").count()) === 1, "restaurado aparece de novo na lista");
// Exclui de novo e passa 31 dias: some da lixeira, mas o dado continua no banco
await menu("ORC-0003", "excluir");
await page.waitForTimeout(400);
await irPara("2026-11-26");
ok(!(await page.textContent("#orc-lixeira-link")).includes("("), "depois de 30 dias some da Lixeira");
await page.click("#orc-lixeira-link");
ok((await page.locator("#orc-lixeira-body tr td[colspan]").count()) === 1, "Lixeira vazia na tela");
ok((await orc("ORC-0003")).excluidoEm, "mas o orçamento continua guardado no banco");
await browser.close();
