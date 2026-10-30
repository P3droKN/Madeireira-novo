// Integração entre telas (varredura 1.1): cada fluxo confere o mesmo valor em todos os lugares onde ele aparece
// (Caixa › Lançamentos, Saldos, A receber, Cheques, Relatórios › Dia, DRE, Formas de pagamento), e no fim as regras
// de consistência rodam sobre os dados gravados: soma dos dias = mês; fim de um dia = início do seguinte;
// entradas por forma = vendido + recebimentos; nada contado duas vezes.
import { createRequire } from "node:module";
const require = createRequire("/opt/node-tools/node_modules/");
const { chromium } = require("playwright");
import { fecharVias } from "./janela.mjs";
import { resumoDoDia } from "../../lib/resumoDia.js";
import { montarDRE } from "../../lib/financeiro.js";
import { vendasPorForma } from "../../lib/relatorios.js";
import { movimentos, saldos as saldosAte } from "../../lib/caixa.js";
const URL = "http://localhost:4321";
const H = { "content-type": "application/json", "x-senha": "pinho123" };
const nb = (s) => (s || "").replace(/ /g, " ").replace(/\s+/g, " ");
const brl = (v) => nb(new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v));
const ok = (cond, msg) => { console.log((cond ? "OK   " : "FALHA") + " " + msg); if (!cond) process.exitCode = 1; };
const db = async () => (await fetch(URL + "/__db")).json();
const lanc = async (todos = false) => Object.values((await db()).madeireira_lancamentos || {}).map((x) => JSON.parse(x)).filter((l) => todos || !l.excluido);
const post = (corpo) => fetch(URL + "/api/lancamento", { method: "POST", headers: H, body: JSON.stringify({ itens: [corpo] }) }).then((r) => r.json());
const ABERTURA = { data: "2026-10-01", contas: { gaveta: 300, bradesco: 1000, picpay: 0, cheques_carteira: 0 } };

for (const r of ["/api/migrar", "/api/migrar?versao=2"]) await fetch(URL + r, { method: "POST", headers: H });
await fetch(URL + "/api/config", { method: "POST", headers: H, body: JSON.stringify({ abertura: ABERTURA }) });
await fetch(URL + "/api/config", { method: "POST", headers: H, body: JSON.stringify({ financeiro: { cartao: { debito: { taxaPct: 2, prazoDias: 1 } } } }) });
await fetch(URL + "/api/precos", { method: "POST", headers: H, body: JSON.stringify({ alteracoes: { "PINUS|1x2x2.50|BRUTO": 5 } }) });
await fetch(URL + "/api/clientes", { method: "POST", headers: H, body: JSON.stringify({ cliente: { nome: "Zé da Obra" } }) });
await fetch(URL + "/api/clientes", { method: "POST", headers: H, body: JSON.stringify({ cliente: { nome: "Seu Arlindo", contaCorrente: true } }) });
// Dias anteriores (pela API): débito no dia 20 (cai no 21), cheque emitido que compensa no dia 30, transferência
await post({ id: "D20", v: 2, conta: "venda_produtos", value: 100, competencia: "2026-10-20", pagamentos: [{ forma: "debito", valor: 100 }] });
await post({ id: "E20", v: 2, conta: "compra_material", value: 400, competencia: "2026-10-20", dataPagamento: "2026-10-20", pagoCom: "cheque_emitido", chequeEmitido: { numero: "900", favorecido: "Serraria", compensacao: "2026-10-30", conta: "bradesco" } });
await post({ id: "T21", v: 2, conta: "transferencia", value: 50, competencia: "2026-10-21", de: "gaveta", para: "bradesco" });

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 }, locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
const page = await ctx.newPage();
await page.clock.install({ time: new Date("2026-10-22T10:00:00-03:00") });
const dialogos = [];
page.on("dialog", async (d) => { dialogos.push(d.message()); await d.accept(d.type() === "prompt" ? "" : undefined); });
page.on("pageerror", (e) => console.log("ERRO JS:", e.message));
const sub = (g, s) => page.click(`.subtabs[data-grupo="${g}"] .subtab[data-sub="${s}"]`);
const txt = async (sel) => nb(await page.textContent(sel));
await page.goto(URL);
await page.fill("#senha-input", "pinho123"); await page.click("#senha-form button");
await page.waitForFunction(() => document.getElementById("catalogo-status").textContent.includes("itens"));
await page.waitForFunction(() => window.Caixa && window.Caixa.migradoV2);
const saldoConta = async (nome) => { await page.click("#btn-tab-caixa"); await sub("caixa", "saldos"); await page.waitForSelector(".saldo-conta"); return nb(await page.locator(".saldo-conta", { hasText: nome }).locator("strong").textContent()); };
const dia = async () => { await page.click("#btn-tab-relatorios"); await sub("relatorios", "dia"); await page.waitForSelector("#dia-panorama"); };
const quadro = async (rot) => {
  const num = /^Vendido/.test(rot) ? "vendeu" : /^Entrou/.test(rot) ? "entrou" : /^Saiu/.test(rot) ? "saiu" : null;
  if (num) return nb(await page.locator(`#dia-numeros [data-numero="${num}"] strong`).textContent());
  const linha = nb(await page.textContent("#dia-linha-fiado"));
  const m = linha.match(/^Fiado vendido/.test(rot) ? /Fiado vendido (R\$ [\d.,]+)/ : /Recebido de fiado (R\$ [\d.,]+)/);
  return m && m[1];
};
const abrir = (id) => page.evaluate((i) => { const d = document.getElementById(i); if (d) d.open = true; }, id);
const dre = async (mes = "2026-10") => { await page.click("#btn-tab-relatorios"); await sub("relatorios", "dre"); await page.fill("#rel-mes", mes); await page.dispatchEvent("#rel-mes", "change"); await page.waitForSelector("#fin-dre-conteudo table"); };
const linhaDre = async (t) => nb(await page.locator("#fin-dre-conteudo tbody tr", { hasText: t }).first().textContent());

// 1. Venda no Vender, 2 formas (dinheiro 30 + PIX 20): Lançamentos, Saldos, Dia, DRE e Formas
await page.selectOption("#material", "PINUS"); await page.selectOption("#dimension", "PINUS|1x2x2.50");
await page.fill("#quantity-pieces", "10"); await page.click("#btn-adicionar");
await page.locator("#calc-pagamentos .pag-valor").first().fill("30"); await page.dispatchEvent("#calc-pagamentos .pag-valor >> nth=0", "input");
await page.click("#calc-pagamentos .pag-adicionar");
await page.click("#btn-registrar-venda");
await fecharVias(page, dialogos);
const v1 = (await lanc()).find((l) => l.origem === "calculadora");
ok(v1 && v1.numero === "V-0002" && v1.value === 50 && v1.pagamentos.map((p) => `${p.forma}:${p.valor}`).join() === "dinheiro:30,pix_bradesco:20", "Vender: V-0002 de R$ 50 (dinheiro 30 + PIX 20)");
await page.click("#btn-tab-caixa"); await sub("caixa", "lista");
ok((await txt("#fin-lista-body")).includes("V-0002"), "Caixa › Lançamentos mostra V-0002");
ok(await saldoConta("Gaveta") === brl(300 - 50 + 30) && await saldoConta("Bradesco") === brl(1000 + 50 + 20), "Saldos: gaveta 280 (300 − 50 transf + 30), Bradesco 1.070");
await dia();
ok(await quadro("Vendido hoje") === "R$ 50,00" && await quadro("Entrou no caixa hoje") === "R$ 50,00", "Dia: vendido 50, entrou 50");
await dre();
ok((await linhaDre("Receita bruta")).includes("R$ 150,00") && (await linhaDre("CMV calculado pelos itens")).includes(brl(v1.cmv)), `DRE: receita 150 (100 + 50), custo pelos itens ${brl(v1.cmv)}`);
await sub("relatorios", "formas");
const formas = await txt("#rel-formas-conteudo");
ok(formas.includes("Dinheiro") && formas.includes("R$ 30,00") && formas.includes("PIX Bradesco") && formas.includes("R$ 20,00") && formas.includes("Débito") && formas.includes("R$ 100,00"), "Formas de pagamento: dinheiro 30, PIX 20, débito 100");

// 2. Fiado com vencimento (Zé) e conta corrente (Arlindo), pelo Caixa › Lançar
const fiado = async (cliente, valor, venc) => {
  await page.click("#btn-tab-caixa"); await sub("caixa", "lancar");
  await page.fill("#ff-valor", String(valor)); await page.dispatchEvent("#ff-valor", "input");
  await page.fill("#ff-cliente", cliente); await page.dispatchEvent("#ff-cliente", "change");
  await page.locator("#ff-pagamentos .pag-forma").first().selectOption("fiado");
  if (venc) { await page.fill("#ff-pagamentos .pag-fiado-venc", venc); await page.dispatchEvent("#ff-pagamentos .pag-fiado-venc", "change"); }
  await page.click("#fin-form button[type=submit]");
  await fecharVias(page, dialogos);
};
await fiado("Zé da Obra", 300, "2026-11-21");
await fiado("Seu Arlindo", 200);
await page.click("#btn-tab-caixa"); await sub("caixa", "receber");
await page.waitForSelector("#fin-receber .receber-cards");
const cards = await txt("#fin-receber .receber-cards");
ok(cards.includes("R$ 500,00") && nb(await page.textContent("#rc-tabela-cc")).includes("Seu Arlindo") && nb(await page.textContent("#rc-tabela-venc")).includes("Zé da Obra"), "A receber: 500 (Zé com vencimento + Arlindo conta corrente)");
await dia();
ok(await quadro("Vendido hoje") === "R$ 550,00" && await quadro("Entrou no caixa hoje") === "R$ 50,00" && await quadro("Fiado vendido hoje") === "R$ 500,00", "Dia: vendido 550, entrou 50 (fiado não entra no caixa), fiado 500");
await dre();
ok((await linhaDre("Receita bruta")).includes("R$ 650,00"), "DRE: o fiado é receita (650)");

// 3. Recebimento parcial do Zé em cheque: A receber, Cheques em carteira, Saldos, Dia; DRE não muda
await page.click("#btn-tab-caixa"); await sub("caixa", "receber");
await page.locator("#rc-tabela-venc tr[data-chave]", { hasText: "Zé da Obra" }).locator('[data-rc="receber"]').click();
await page.fill("#rc-valor", "120"); await page.dispatchEvent("#rc-valor", "input");
await page.locator("#rc-pagamentos .pag-forma").first().selectOption("cheque");
await page.fill('#rc-pagamentos .pag-ch[data-campo="numero"]', "55"); await page.dispatchEvent('#rc-pagamentos .pag-ch[data-campo="numero"]', "change");
await page.fill('#rc-pagamentos .pag-ch[data-campo="compensacao"]', "2026-10-24"); await page.dispatchEvent('#rc-pagamentos .pag-ch[data-campo="compensacao"]', "change");
await page.click("#rc-receber-form button[type=submit]");
await page.waitForFunction(() => document.getElementById("modal-receber").style.display === "none");
ok(nb(await page.locator("#rc-tabela-venc tr[data-chave]", { hasText: "Zé da Obra" }).textContent()).includes("R$ 180,00"), "A receber: Zé passa a dever 180");
ok(await saldoConta("Cheques em carteira") === "R$ 120,00", "Saldos: cheque de 120 na carteira");
await dia();
ok(await quadro("Recebido de fiado hoje") === "R$ 120,00" && await quadro("Vendido hoje") === "R$ 550,00", "Dia: recebido de fiado 120; vendido continua 550");
await dre();
ok((await linhaDre("Receita bruta")).includes("R$ 650,00"), "DRE: recebimento não é venda (receita continua 650)");

// 4. Corrigir a V-0002 (tira 5 peças): mesmo número, caixa, DRE e Dia recalculados, histórico
await page.click("#btn-tab-caixa"); await sub("caixa", "lista");
await page.locator(`#fin-lista-body [data-corrigir="${v1.id}"]`).click();
await page.waitForFunction(() => document.querySelectorAll("#items-body tr.linha-item").length === 1);
// preço de 5 para 4 por peça (total 40), pago todo em dinheiro
await page.locator("#items-body tr.linha-item .preco-input").first().fill("4");
await page.locator("#items-body tr.linha-item .preco-input").first().dispatchEvent("change");
await page.waitForTimeout(300);
await page.locator("#calc-pagamentos .pag-remover").nth(1).click();
await page.locator("#calc-pagamentos .pag-valor").first().fill("40");
await page.locator("#calc-pagamentos .pag-valor").first().dispatchEvent("input");
await page.click("#btn-registrar-venda");
await fecharVias(page, dialogos);
const v1c = (await lanc()).find((l) => l.id === v1.id);
ok(v1c.numero === "V-0002" && v1c.historico?.length === 1 && v1c.historico[0].valorAntes === 50, `corrigida: mesmo V-0002, histórico "antes R$ 50" (agora ${brl(v1c.value)})`);
await dia();
ok(await quadro("Vendido hoje") === brl(500 + v1c.value), `Dia recalculado: vendido ${brl(500 + v1c.value)}`);

// 5. Estornar o fiado do Arlindo: some dos totais, riscado na lista do dia, número mantido
const fa = (await lanc()).find((l) => l.cliente === "Seu Arlindo" && l.conta === "venda_produtos");
await page.click("#btn-tab-caixa"); await sub("caixa", "lista");
await page.locator(`#fin-lista-body [data-excluir="${fa.id}"]`).click();
await page.waitForTimeout(600);
await page.click("#btn-tab-caixa"); await sub("caixa", "receber"); await page.waitForSelector("#fin-receber .receber-cards");
ok(!nb(await page.textContent("#rc-tabela-cc")).includes("Seu Arlindo"), "estorno: Arlindo sai do A receber");
await dia();
ok(await quadro("Fiado vendido hoje") === "R$ 300,00" && (await page.locator("#dia-lista tbody tr.estornado").count()) === 1, "estorno: sai do fiado do dia e aparece riscado na lista");
ok((await lanc(true)).find((l) => l.id === fa.id).numero === fa.numero, "estorno mantém o número");

// 6. Fechar gaveta: esperado × contado em Saldos e no Dia
await page.click("#btn-tab-caixa"); await sub("caixa", "saldos"); await page.waitForSelector(".saldo-conta");
const esperado = nb(await page.locator(".saldo-conta", { hasText: "Gaveta" }).locator("strong").textContent());
await page.locator(".saldo-conta", { hasText: "Gaveta" }).locator("[data-conferir]").click();
await page.waitForSelector("#modal-pergunta", { state: "visible" });
ok((await txt("#perg-texto")).includes(esperado), `fechar gaveta: esperado ${esperado} (o mesmo do Saldos)`);
await page.fill("#perg-campo", "270"); await page.click("#perg-ok");
await page.waitForTimeout(600);
await dia();
ok((await txt("#dia-gaveta")).includes("contado R$ 270,00") && (await txt("#dia-gaveta")).includes(`esperado ${esperado}`), "Dia: gaveta esperado × contado igual ao Saldos");

// 7. Cheque recebido compensa no dia 24 (carteira → Bradesco); cheque emitido sai do banco só no dia 30 (projeção)
await page.clock.setFixedTime(new Date("2026-10-24T10:00:00-03:00")); await page.reload(); await page.waitForFunction(() => window.Caixa && window.Caixa.migradoV2);
const bradesco24 = await saldoConta("Bradesco");
ok(await saldoConta("Cheques em carteira") === "R$ 0,00", "dia 24: o cheque saiu da carteira…");
await page.clock.setFixedTime(new Date("2026-10-23T10:00:00-03:00")); await page.reload(); await page.waitForFunction(() => window.Caixa && window.Caixa.migradoV2);
ok(nb(bradesco24) === brl(Number((await saldoConta("Bradesco")).replace(/[^\d,]/g, "").replace(",", ".")) + 120), "…e entrou no Bradesco (+120)");
const projecao = await txt("#fin-saldos");
ok(projecao.includes("Cheques emitidos (saem)") && projecao.includes("R$ 400,00"), "cheque emitido de 400 aparece na projeção de 30 dias (sai só na compensação, dia 30)");
// devolvido: a dívida do Zé volta
await page.click("#btn-tab-caixa"); await sub("caixa", "cheques");
await page.locator("#fin-cheques tr", { hasText: "55" }).locator("[data-ch-devolver]").click();
await page.waitForSelector("#modal-pergunta", { state: "visible" }); await page.fill("#perg-campo", "2026-10-23"); await page.click("#perg-ok");
await page.waitForTimeout(600);
await page.click("#btn-tab-caixa"); await sub("caixa", "receber"); await page.waitForSelector("#rc-tabela-venc");
ok(nb(await page.locator("#rc-tabela-venc tr[data-chave]", { hasText: "Zé da Obra" }).textContent()).includes("R$ 300,00"), "cheque devolvido: a dívida do Zé volta para 300");

// 8. Débito do dia 20 cai no PicPay no dia 21 (líquido da taxa de 2%) e aparece no Dia 21
await dia();
await page.fill("#dia-data", "2026-10-21"); await page.dispatchEvent("#dia-data", "change");
await page.waitForTimeout(300);
const pic21 = await page.$$eval('#dia-panorama tr[data-conta="picpay"] td.num', (t) => t.map((x) => x.textContent.replace(/ /g, " ")));
ok(pic21[1] === "R$ 98,00", `Dia 21: débito de 100 do dia 20 entra no PicPay líquido (R$ 98,00): ${pic21[1]}`);

// 9. Modo balcão: o resultado some no Dia; estimativas desligadas no rodapé do DRE
await page.click("#btn-tab-vender"); await page.click("#btn-balcao"); await dia(); await abrir("dia-detalhes");
ok(await page.isHidden("#dia-resultado"), "modo balcão: resultado do dia escondido");
await page.click("#btn-tab-vender"); await page.click("#btn-balcao");
await dre();
ok((await txt("#dre-modo")).includes("Estimativas contábeis desligadas"), "DRE diz que as estimativas estão desligadas");
await browser.close();

// 10. Regras de consistência sobre os dados gravados
const d = await db();
const itens = Object.values(d.madeireira_lancamentos).map((x) => JSON.parse(x)).filter((l) => !l.excluido);
const estornados = Object.values(d.madeireira_lancamentos).map((x) => JSON.parse(x)).filter((l) => l.excluido);
const config = JSON.parse(d.madeireira_config_financeiro);
const sal = { abertura: ABERTURA, conferencias: Object.values(d.madeireira_conferencias || {}).map((x) => JSON.parse(x)) };
const diasMes = Array.from({ length: 31 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`);
const rs = diasMes.map((de) => resumoDoDia({ lancamentos: itens, estornados, config, saldos: sal, de }));
const dreMes = montarDRE(itens, config, "2026-10");
const soma = (f) => Math.round(rs.reduce((s, r) => s + Math.round(f(r) * 100), 0)) / 100;
ok(soma((r) => r.quadros.vendido) === dreMes.valores.receitaBruta, `soma dos dias = mês: vendido ${soma((r) => r.quadros.vendido)} = receita do DRE ${dreMes.valores.receitaBruta}`);
ok(soma((r) => r.resultado.cmv) === dreMes.info.cmvOrigem.total, "soma dos dias = mês: custo das vendas");
ok(rs.every((r, i) => i === 0 || r.contas.porConta.every((c, k) => c.inicio === rs[i - 1].contas.porConta[k].fim)), "fim de cada dia = início do dia seguinte (todas as contas, o mês inteiro)");
const fimMes = saldosAte(movimentos(itens, config), ABERTURA, "2026-10-31");
ok(rs.at(-1).contas.porConta.every((c) => Math.abs(c.fim - fimMes.porConta[c.conta]) < 0.005), "fim do dia 31 = saldo do Caixa em 31/10");
ok(rs.every((r) => Math.round((r.entradas.formas.reduce((s, f) => s + f.valor, 0) + r.entradas.recebimentos.reduce((s, f) => s + f.valor, 0)) * 100) === Math.round(r.entradas.total * 100) && r.entradas.total === Math.round((r.quadros.vendido + r.quadros.recebidoFiado) * 100) / 100), "todo dia: entradas por forma = vendido + recebimentos");
const vpf = vendasPorForma(itens, "2026-10", config);
ok(Math.abs(vpf.linhas.reduce((s, l) => s + l.valor, 0) - dreMes.valores.receitaBruta) < 0.005, "Formas de pagamento do mês = receita do DRE (nada contado duas vezes)");
const ids = rs.flatMap((r) => r.detalhada.map((l) => l.id));
ok(ids.length === new Set(ids).size, "nenhum lançamento aparece em dois dias");
