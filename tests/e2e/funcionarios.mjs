// Acesso dos funcionários (/funcionarios): entrada com PIN, abas e dados limitados, venda conferida no servidor
// (desconto máximo, abaixo do custo, preço digitado, custo calculado aqui), quem vendeu, nada de corrigir/estornar,
// dois vendedores ao mesmo tempo, aviso de orçamento alterado por outro, e o lado do dono (Ajustes, Lançamentos, Dia).
import { createRequire } from "node:module";
const require = createRequire("/opt/node-tools/node_modules/");
const { chromium } = require("playwright");
import { fecharVias } from "./janela.mjs";
const URL = "http://localhost:4321";
const H = { "content-type": "application/json", "x-senha": "pinho123" };
const nb = (s) => (s || "").replace(/\u00a0/g, " ");
const ok = (cond, msg) => { console.log((cond ? "OK   " : "FALHA") + " " + msg); if (!cond) process.exitCode = 1; };
const db = async () => (await fetch(URL + "/__db")).json();
const lanc = async () => Object.values((await db()).madeireira_lancamentos || {}).map((x) => JSON.parse(x)).filter((l) => !l.excluido);
const api = async (nome, { m = "GET", b, h = H } = {}) => {
  const r = await fetch(URL + "/api/" + nome, { method: m, headers: { "content-type": "application/json", ...h }, body: b ? JSON.stringify(b) : undefined });
  return { status: r.status, corpo: await r.json().catch(() => null) };
};

await api("precos", { m: "POST", b: { alteracoes: { "PINUS|1x2x2.50|BRUTO": 10, "CAMBARA|1x2|BRUTO": 20 } } });

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const dialogos = [];
async function abrirPagina(caminho, largura = 1280) {
  const ctx = await browser.newContext({ viewport: { width: largura, height: 900 }, locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
  const page = await ctx.newPage();
  page.on("dialog", async (d) => { dialogos.push(d.message()); await d.accept(); });
  page.on("pageerror", (e) => console.log("ERRO JS:", e.message));
  await page.goto(URL + caminho);
  return page;
}
const add = async (page, mat, dim, qtd, comp) => {
  await page.selectOption("#material", mat); await page.selectOption("#dimension", dim);
  await page.fill("#quantity-pieces", String(qtd)); if (comp) await page.fill("#quantity-length", String(comp));
  await page.click("#btn-adicionar");
};

// 1. Dono cadastra dois funcionários em Ajustes › Funcionários
const dono = await abrirPagina("/");
await dono.fill("#senha-input", "pinho123"); await dono.click("#senha-form button");
await dono.waitForFunction(() => window.Caixa && window.Caixa.migradoV2);
await dono.click("#btn-tab-ajustes"); await dono.click('.subtabs[data-grupo="ajustes"] .subtab[data-sub="funcionarios"]');
await dono.fill("#aj-func-nome", "Ana Souza"); await dono.fill("#aj-func-pin", "1234"); await dono.click("#aj-func-salvar");
await dono.waitForSelector("#aj-func-lista tr:has-text('Ana Souza')");
await dono.fill("#aj-func-nome", "Beto"); await dono.fill("#aj-func-pin", "5678"); await dono.click("#aj-func-salvar");
await dono.waitForSelector("#aj-func-lista tr:has-text('Beto')");
const funcs = (await api("funcionarios")).corpo.funcionarios;
ok(funcs.length === 2 && funcs.every((f) => f.ativo && !f.pin), "Ajustes › Funcionários: cadastra Ana e Beto (o PIN não volta na lista)");
const banco = await db();
ok(!JSON.stringify(banco.madeireira_funcionarios).includes("1234"), "o PIN fica guardado só como resumo (nunca o número)");

// 2. Entrada em /funcionarios: PIN errado, PIN certo, senha do dono não vale, PIN não vale na entrada do dono
const ana = await abrirPagina("/funcionarios");
await ana.waitForSelector("#modal-pin", { state: "visible" });
await ana.waitForFunction(() => document.querySelectorAll("#pin-nome option").length === 3);
await ana.selectOption("#pin-nome", { label: "Ana Souza" });
await ana.fill("#pin-input", "pinho123"); await ana.click("#pin-form button");
await ana.waitForFunction(() => document.getElementById("pin-msg").textContent.includes("PIN errado"));
ok(true, "a senha do dono não entra em /funcionarios (PIN errado)");
await ana.fill("#pin-input", "1234"); await ana.click("#pin-form button");
await ana.waitForSelector("#modal-pin", { state: "hidden" });
await ana.waitForFunction(() => document.getElementById("catalogo-status").textContent.includes("itens"));
ok(nb(await ana.textContent("#func-nome")).includes("Ana Souza") && await ana.isVisible("#btn-sair"), "cabeçalho com o nome do funcionário e Sair");
ok(!(await ana.isVisible("#btn-tab-caixa")) && !(await ana.isVisible("#btn-tab-relatorios")) && !(await ana.isVisible("#btn-tab-ajustes")) && await ana.isVisible("#btn-tab-orcamentos"),
  "só Vender e Clientes e Orçamentos (Caixa, Relatórios e Ajustes não aparecem)");
ok(!(await ana.isVisible("#btn-balcao")) && await ana.evaluate(() => document.body.classList.contains("modo-balcao")), "sempre sem custo e margem (modo balcão travado)");
ok(!(await ana.evaluate(() => JSON.stringify(localStorage))).includes("1234"), "o PIN não fica guardado no aparelho");
const r401 = await fetch(URL + "/api/getFinance", { headers: { "x-senha": "1234" } });
ok(r401.status === 401, "o PIN não vale na entrada do dono");

// 3. O que o funcionário recebe da API: sem custos, sem saldos, sem rotas do dono
const sessao = await ana.evaluate(() => JSON.parse(localStorage.getItem("madeireira_sessao_func")).token);
const F = { "x-sessao": sessao };
const cat = (await api("catalogo", { h: F })).corpo;
ok(cat.custos.pinus_por_peca.dimensoes["1x2x2.50"] === null && Object.entries(cat.custos.portas || {}).filter(([k]) => !k.startsWith("_")).every(([, m]) => Object.values(m).every((v) => v.custo === null && v.venda > 0)), "catálogo do funcionário vem sem custo nenhum");
const gf = (await api("getFinance", { h: F })).corpo;
ok(gf.saldos === null && gf.acumulado === null && !gf.configFinanceiro.cartao && !gf.configFinanceiro.impostos, "getFinance do funcionário: sem saldos, acumulado, taxas e impostos");
const bloqueadas = [["backup"], ["config", "POST"], ["zerar", "POST"], ["precos", "POST"], ["resumo"], ["funcionarios"], ["importar", "POST"], ["restaurar", "POST"], ["acumulado", "POST"], ["clientes?impacto=x"]];
const st = [];
for (const [r, m] of bloqueadas) st.push((await api(r, { m: m || "GET", h: F, b: m ? {} : undefined })).status);
ok(st.every((s) => s === 403 || s === 404), `rotas do dono recusadas para o funcionário (${st.join(",")})`);

// 4. Venda pela tela: Pinus 10 pç (tabela R$ 10): sai com o vendedor e o custo calculado no servidor
await add(ana, "PINUS", "PINUS|1x2x2.50", 10);
await ana.click("#btn-registrar-venda");
await fecharVias(ana, dialogos);
let v = (await lanc()).find((l) => l.numero === "V-0001");
ok(v && v.vendedor?.nome === "Ana Souza" && v.vendedor.tipo === "funcionario" && v.cmv > 0 && v.itens[0].custoTotal > 0, `venda V-0001 com vendedor Ana e custo calculado no servidor (CMV ${v?.cmv})`);
await ana.waitForSelector("#pedidos-hoje tr:has-text('V-0001')");
ok(nb(await ana.textContent("#pedidos-hoje")).includes("Ana Souza"), "Pedidos de hoje: V-0001 com o vendedor");

// 5. Desconto acima do máximo (5%) recusado no servidor; 5% passa
await add(ana, "PINUS", "PINUS|1x2x2.50", 10);
dialogos.length = 0;
await ana.evaluate(() => { const i = document.querySelector("#pct-geral"); i.value = "-10"; i.dispatchEvent(new Event("change", { bubbles: true })); });
await ana.waitForTimeout(150);
await ana.click("#btn-registrar-venda");
await ana.waitForTimeout(800);
ok(dialogos.some((d) => d.includes("Desconto acima do permitido") && d.includes("chame o responsável")), "desconto de 10% recusado: \"chame o responsável\"");
ok((await lanc()).length === 1, "nada foi gravado");
await ana.evaluate(() => { const i = document.querySelector("#pct-geral"); i.value = "-5"; i.dispatchEvent(new Event("change", { bubbles: true })); });
await ana.waitForTimeout(150);
await ana.click("#btn-registrar-venda");
await fecharVias(ana, dialogos);
ok((await lanc()).some((l) => l.numero === "V-0002" && l.value === 95), "desconto de 5% (o máximo padrão) passa: V-0002 de R$ 95");

// 6. Pela API: abaixo do custo, preço digitado, corrigir, estornar e lançar despesa são recusados
const hoje = gf.proximos && (await ana.evaluate(() => window.Caixa.hoje()));
const venda = (id, itens, valor) => ({ id, v: 2, conta: "venda_produtos", value: valor, competencia: hoje, description: "api", pagamentos: [{ forma: "dinheiro", valor }], itens });
let r = await api("lancamento", { m: "POST", h: F, b: { itens: [venda("1790000000001", [{ itemId: "CEDRO_MESCLADO|1x2", acabamento: "BRUTO", quantidade: 1, comprimento: 10, vendaTotal: 1 }], 1)] } });
ok(r.status === 400 && r.corpo.error.includes("Preço abaixo do permitido") && !/\d+,\d\d/.test(r.corpo.error), "item sem preço na tabela abaixo do custo: recusado sem mostrar o custo");
r = await api("lancamento", { m: "POST", h: F, b: { itens: [venda("1790000000002", [{ itemId: "CEDRO_MESCLADO|1x2", acabamento: "BRUTO", quantidade: 1, comprimento: 10, vendaTotal: 200 }], 200)] } });
v = (await lanc()).find((l) => l.id === "1790000000002");
ok(r.status === 200 && v.precoDigitado === true && v.itens[0].precoDigitado === true, "item sem preço na tabela: aceita e marca \"preço digitado\"");
r = await api("lancamento", { m: "POST", h: F, b: { itens: [venda("1790000000003", [{ itemId: "OUTROS|LIVRE", descricao: "Porta usada", quantidade: 1, vendaTotal: 50, custoTotal: 0 }], 50)] } });
v = (await lanc()).find((l) => l.id === "1790000000003");
ok(r.status === 200 && v.precoDigitado && v.itens[0].custoTotal == null, "\"Outros\" do funcionário: custo não informado + preço digitado");
r = await api("lancamento", { m: "POST", h: F, b: { itens: [{ ...venda("1790000000002", [{ itemId: "CEDRO_MESCLADO|1x2", acabamento: "BRUTO", quantidade: 1, comprimento: 10, vendaTotal: 300 }], 300), versaoBase: 1 }] } });
ok(r.status === 403, "corrigir venda: só o dono");
ok((await api("lancamento?id=1790000000002", { m: "DELETE", h: F })).status === 403, "estornar venda: só o dono");
r = await api("lancamento", { m: "POST", h: F, b: { itens: [{ id: "1790000000009", v: 2, conta: "outras_despesas", value: 10, competencia: hoje, description: "x", pagoCom: "gaveta" }] } });
ok(r.status === 403, "funcionário não lança despesa");
r = await api("lancamento", { m: "PATCH", h: F, b: { ids: ["1790000000002"], conta: "servicos" } });
ok(r.status === 403, "reclassificar: só o dono");

// 7. Dois funcionários vendendo ao mesmo tempo: números diferentes
const beto = await api("sessao", { m: "POST", h: {}, b: { id: funcs.find((f) => f.nome === "Beto").id, pin: "5678" } });
const B = { "x-sessao": beto.corpo.token };
const item = [{ itemId: "PINUS|1x2x2.50", acabamento: "BRUTO", quantidade: 1, vendaTotal: 10 }];
const [ra, rb] = await Promise.all([api("lancamento", { m: "POST", h: F, b: { itens: [venda("1790000000011", item, 10)] } }), api("lancamento", { m: "POST", h: B, b: { itens: [venda("1790000000012", item, 10)] } })]);
const nums = [Object.values(ra.corpo.numeros)[0], Object.values(rb.corpo.numeros)[0]];
ok(nums[0] && nums[1] && nums[0] !== nums[1], `dois vendedores ao mesmo tempo: ${nums.join(" e ")}`);
ok((await lanc()).find((l) => l.id === "1790000000012").vendedor.nome === "Beto", "cada venda com o seu vendedor");

// 8. Orçamento editado por dois: o segundo recebe o aviso
const orcBase = { cliente: { nome: "Carlos", telefone: "47999990000" }, origem: "balcao", itens: [{ itemId: "PINUS|1x2x2.50", acabamento: "BRUTO", quantidade: 2, vendaTotal: 20, precoTabela: 10 }], total: 20 };
const o1 = (await api("orcamentos", { m: "POST", h: F, b: { orcamento: orcBase } })).corpo.orcamento;
ok(o1 && o1.criadoPor?.nome === "Ana Souza" && o1.custo === undefined && o1.itens[0].custoTotal === undefined, `orçamento do funcionário: ${o1?.id}, criado por Ana, sem custo na resposta`);
const salvo = JSON.parse((await db()).madeireira_orcamentos[o1.id]);
ok(salvo.custo > 0, "o custo do orçamento é calculado e guardado no servidor");
r = await api("orcamentos", { m: "POST", h: B, b: { orcamento: { ...orcBase, id: o1.id, versaoBase: 1, total: 19, itens: [{ ...orcBase.itens[0], vendaTotal: 19 }] } } });
ok(r.status === 200, "Beto edita o orçamento");
r = await api("orcamentos", { m: "POST", h: F, b: { orcamento: { ...orcBase, id: o1.id, versaoBase: 1 } } });
ok(r.status === 409 && /alterado por Beto às \d\d:\d\d\. Recarregue para ver\./.test(r.corpo.error), `Ana (versão velha) recebe: "${r.corpo?.error}"`);
ok((await api("orcamentos", { m: "PATCH", h: F, b: { acao: "esvaziar_lixeira", confirmacao: "EXCLUIR" } })).status === 403, "esvaziar lixeira: só o dono");
const lista = (await api("orcamentos", { h: F })).corpo.orcamentos;
ok(lista.every((o) => o.custo === undefined && o.margem === undefined), "lista de orçamentos do funcionário sem custo e margem");

// 8b. Fiado: funcionário cadastra o cliente, vende fiado e recebe em cheque; não vê despesas nem vendas antigas
const cli = (await api("clientes", { m: "POST", h: F, b: { cliente: { nome: "Dona Maria", telefone: "(47) 98888-7777", obsFiado: "paga dia 10" } } })).corpo.cliente;
ok(cli?.id, "funcionário cadastra cliente");
r = await api("lancamento", { m: "POST", h: F, b: { itens: [{ ...venda("1790000000021", item, 10), clienteId: cli.id, cliente: cli.nome, pagamentos: [{ forma: "fiado", valor: 10 }] }] } });
ok(r.status === 200, "venda fiado pelo funcionário");
r = await api("lancamento", { m: "POST", h: F, b: { itens: [{ id: "1790000000022", v: 2, conta: "recebimento", value: 10, competencia: hoje, description: "Recebimento", clienteId: cli.id, cliente: cli.nome,
  pagamentos: [{ forma: "cheque", valor: 10, cheque: { numero: "123", emissor: "Maria", compensacao: hoje } }] }] } });
const rec = (await lanc()).find((l) => l.id === "1790000000022");
ok(r.status === 200 && rec?.vendedor?.nome === "Ana Souza", "recebe fiado em cheque (recebimento com quem recebeu)");
await api("lancamento", { b: { itens: [{ id: "1790000000031", v: 2, conta: "outras_despesas", value: 33, competencia: hoje, description: "conserto", pagoCom: "gaveta" },
  { id: "1790000000032", v: 2, conta: "venda_produtos", value: 77, competencia: "2026-01-10", description: "antiga", pagamentos: [{ forma: "pix", valor: 77 }] }] }, m: "POST" });
const gf2 = (await api("getFinance", { h: F })).corpo.financeItems;
ok(gf2.some((l) => l.id === "1790000000021") && gf2.some((l) => l.id === "1790000000022") && !gf2.some((l) => l.id === "1790000000031" || l.id === "1790000000032"),
  "funcionário vê vendas de hoje e o fiado; não vê despesa nem venda antiga");
ok(gf2.every((l) => l.cmv === undefined && (l.itens || []).every((i) => i.custoTotal === undefined)), "nenhum lançamento do funcionário vem com custo");

// 8c. Lado do dono: Lançamentos com Vendedor (coluna e filtro), Dia com Vendas por vendedor, via com o nome se ligado
await dono.reload();
await dono.waitForSelector("#senha-input", { state: "hidden" }).catch(() => {});
await dono.waitForFunction(() => window.Caixa && window.Caixa.itens.length > 5);
await dono.click("#btn-tab-caixa"); await dono.click('.subtabs[data-grupo="caixa"] .subtab[data-sub="lista"]');
await dono.waitForSelector("#fin-lista-body tr");
ok(nb(await dono.textContent("#fin-lista-body")).includes("Ana Souza") && nb(await dono.textContent("#fin-lista-body")).includes("Beto"), "Lançamentos: coluna Vendedor");
await dono.selectOption("#fin-f-vendedor", { label: "Beto" });
const linhasBeto = await dono.locator("#fin-lista-body tr").count();
ok(linhasBeto === 1, `filtro Vendedor = Beto: ${linhasBeto} lançamento`);
await dono.selectOption("#fin-f-vendedor", "");
await dono.click("#btn-tab-relatorios"); await dono.click('.subtabs[data-grupo="relatorios"] .subtab[data-sub="dia"]');
await dono.waitForSelector("#dia-vendedores", { state: "attached" });
const tv = nb(await dono.textContent("#dia-vendedores"));
ok(tv.includes("Vendas por vendedor") && tv.includes("Ana Souza") && tv.includes("Beto") && tv.includes("Lucro bruto"), "Dia › Mais detalhes: Vendas por vendedor (nº, total e lucro)");
await dono.click("#btn-tab-orcamentos");
await dono.waitForFunction(() => document.querySelectorAll("#orc-f-vendedor option").length >= 2);
ok((await dono.locator("#orc-f-vendedor option").allTextContents()).some((t) => t.includes("Ana Souza")), "Orçamentos: filtro Feito por");
const via = await dono.evaluate(async () => {
  const m = await import("/lib/impressao.js");
  const doc = m.documentoDaVenda(window.Caixa.itens.find((x) => x.numero === "V-0001"));
  const loja = m.lojaDaConfig({ impressao: { nome: "Loja" } });
  return { sem: m.folhaHtml(doc, loja).includes("pv-vendedor"), com: m.folhaHtml(doc, { ...loja, mostrarVendedor: true }).match(/pv-vendedor">([^<]*)/)?.[1] };
});
ok(!via.sem && via.com === "Ana", "via: sem o vendedor (padrão); ligado em Ajustes › Impressão, sai o primeiro nome (Ana)");

// 8d. Funcionário com o bloco Cliente do pedido (mesmo do dono): vincular, avulso, salvar como cliente, duplicado, fiado
await ana.click("#btn-tab-vender");
await ana.evaluate(() => window.Clientes.carregar());
const blocoAna = () => ana.textContent("#cp-status").then(nb);
await add(ana, "PINUS", "PINUS|1x2x2.50", 1);
await ana.fill("#cp-nome", "dona maria"); await ana.dispatchEvent("#cp-nome", "change");
ok((await blocoAna()).includes("Cliente cadastrado"), "funcionário: escolher o cadastrado vincula a venda");
await ana.click("#btn-registrar-venda"); await fecharVias(ana, dialogos);
let ult = (await lanc()).sort((a, b) => b.criadoEm.localeCompare(a.criadoEm))[0];
ok(ult.clienteId === cli.id && ult.vendedor.nome === "Ana Souza", `venda ${ult.numero} vinculada à Dona Maria`);
// avulso: os dados saem na via, sem cadastro
await add(ana, "PINUS", "PINUS|1x2x2.50", 1);
await ana.fill("#cp-nome", "Seu Avulso"); await ana.fill("#cp-endereco", "Rua Avulsa, 5"); await ana.fill("#cp-obs", "deixar no portão");
await ana.click("#btn-registrar-venda"); await fecharVias(ana, dialogos);
ult = (await lanc()).sort((a, b) => b.criadoEm.localeCompare(a.criadoEm))[0];
const nClientes = async () => Object.keys((await db()).madeireira_clientes || {}).length;
const nAntes = await nClientes();
ok(!ult.clienteId && ult.clienteVia?.endereco === "Rua Avulsa, 5" && ult.clienteVia.obs === "deixar no portão", "cliente avulso: dados só na venda (saem na via)");
// duplicado: WhatsApp de cadastrado → "É a Dona Maria? Vincular"
await add(ana, "PINUS", "PINUS|1x2x2.50", 1);
await ana.fill("#cp-nome", "Maria"); await ana.fill("#cp-tel", "47988887777"); await ana.dispatchEvent("#cp-tel", "change");
ok((await blocoAna()).includes("Dona Maria") && await ana.isVisible('#cp-status [data-cp="vincular"]'), "funcionário: WhatsApp igual ao de um cadastrado → \"É a Dona Maria? Vincular\"");
await ana.click("#cp-limpar");
// salvar como cliente + fiado com cliente novo
await ana.fill("#cp-nome", "Zé Novo"); await ana.fill("#cp-tel", "(47) 97777-1234"); await ana.check("#cp-salvar");
await ana.locator("#calc-pagamentos .pag-forma").first().selectOption("fiado");
await ana.click("#btn-registrar-venda"); await fecharVias(ana, dialogos);
const ze = Object.values((await db()).madeireira_clientes).map((x) => JSON.parse(x)).find((c) => c.nome === "Zé Novo");
ult = (await lanc()).sort((a, b) => b.criadoEm.localeCompare(a.criadoEm))[0];
ok(ze && ult.clienteId === ze.id && ult.pagamentos[0].forma === "fiado" && (await nClientes()) === nAntes + 1, "fiado com cliente novo: cadastrado pelo funcionário e a venda fica na ficha");
// Pedidos de hoje › Vias › "✎ Cliente e entrega": corrige endereço e entrega; no fiado, o cliente não muda
await ana.click(`#pedidos-hoje [data-ph-vias="${ult.id}"]`);
await ana.waitForSelector("#modal-impressao", { state: "visible" });
await ana.click("#imp-cliente-btn");
ok(await ana.evaluate(() => document.getElementById("imp-cli-nome").readOnly) && nb(await ana.textContent("#imp-cli-vinculo")).includes("Corrigir venda"), "venda fiado: o nome (quem deve) fica travado");
await ana.fill("#imp-cli-endereco", "Rua Nova, 77"); await ana.fill("#imp-cli-obs", "ligar antes");
await ana.click("#imp-cli-salvar");
await ana.waitForSelector("#imp-cliente-form", { state: "hidden" });
await ana.click("#imp-fechar");
const corr = (await lanc()).find((l) => l.id === ult.id);
ok(corr.clienteId === ze.id && corr.clienteVia.endereco === "Rua Nova, 77" && corr.clienteVia.obs === "ligar antes" && corr.alteracoesCliente?.at(-1)?.por === "Ana Souza",
  "funcionário corrige endereço e entrega da venda de hoje; grava quem fez e quando");
r = await api("lancamento", { m: "PATCH", h: F, b: { acao: "cliente", id: ult.id, clienteId: cli.id, clienteVia: { nome: "Dona Maria" } } });
ok(r.status === 409, "trocar o cliente de uma venda fiado: recusado (só o dono, em Corrigir venda)");
r = await api("lancamento", { m: "PATCH", h: F, b: { acao: "cliente", id: "1790000000032", clienteVia: { nome: "x", endereco: "y" } } });
ok(r.status === 403, "venda de outro dia: o funcionário não altera o cliente");

// 9. Sessão: Sair encerra; funcionário desativado não entra mais
await ana.click("#btn-sair");
await ana.waitForSelector("#modal-pin", { state: "visible" });
ok((await api("getFinance", { h: F })).status === 401, "Sair: a sessão deixa de valer no servidor");
await api("funcionarios", { m: "POST", b: { funcionario: { id: funcs.find((f) => f.nome === "Beto").id, ativo: false } } });
ok((await api("getFinance", { h: B })).status === 401, "funcionário desativado: a sessão aberta para de valer");
ok((await api("sessao", { m: "POST", h: {}, b: { id: funcs.find((f) => f.nome === "Beto").id, pin: "5678" } })).status === 401, "funcionário desativado não entra");

// 10. Celular: sem rolagem lateral
const cel = await abrirPagina("/funcionarios", 375);
await cel.waitForSelector("#modal-pin", { state: "visible" });
await cel.waitForFunction(() => document.querySelectorAll("#pin-nome option").length >= 2);
await cel.selectOption("#pin-nome", { label: "Ana Souza" }); await cel.fill("#pin-input", "1234"); await cel.click("#pin-form button");
await cel.waitForSelector("#modal-pin", { state: "hidden" });
await cel.waitForSelector("#pedidos-hoje tr");
ok(await cel.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "celular (375 px): sem rolagem lateral");

await browser.close();
