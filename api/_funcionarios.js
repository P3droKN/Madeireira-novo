// Acesso dos funcionários (/funcionarios): cadastro com PIN, entrada e saída (sessão até a meia-noite), o que o
// servidor tira dos dados que manda para o funcionário e a conferência das vendas e orçamentos feitos por ele
// (custo calculado aqui pelo catálogo, desconto máximo por item, preço abaixo do custo).
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { erro, desembrulhar, lerPrecosEConfig } from "./_dados.js";
import { lerCustos, resumoSessao, errosDeSenha, anotarErroDeSenha, LIMITE_TENTATIVAS } from "./_lib.js";
import { montarCatalogo, precosComIdsAtuais, precosComPadrao, idAtual } from "../lib/catalogo.js";
import { mesclarConfigFinanceiro } from "../lib/planoContas.js";
import { contasAReceber } from "../lib/receber.js";
import { hojeSP } from "../lib/datas.js";
import { somarDias } from "../lib/orcamentos.js";
import { quantidadeCobradaDe } from "./_custos.js";

const texto = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
const centavos = (v) => Math.round(Number(v || 0) * 100);
const reais = (c) => Math.round(c) / 100;

// ---------- PIN ----------
const PIN = /^\d{4,6}$/;
function resumoPin(pin, sal = randomBytes(16).toString("hex")) {
  return { sal, resumo: scryptSync(String(pin), sal, 32).toString("hex") };
}
function pinConfere(pin, f) {
  if (!f?.pin?.sal || !PIN.test(String(pin || ""))) return false;
  const a = Buffer.from(resumoPin(pin, f.pin.sal).resumo, "hex");
  const b = Buffer.from(f.pin.resumo, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
const publico = (f) => ({ id: f.id, nome: f.nome, ativo: Boolean(f.ativo), criadoEm: f.criadoEm || null, atualizadoEm: f.atualizadoEm || null });

async function todos(kv, k) {
  return Object.values((await kv.hgetall(k.funcionarios)) || {}).map(desembrulhar).filter(Boolean).sort((a, b) => a.nome.localeCompare(b.nome));
}

/** Lista para o dono (sem o PIN) ou só os nomes dos ativos (tela de entrada). */
export async function listarFuncionarios(kv, k, { soAtivos = false } = {}) {
  const lista = await todos(kv, k);
  return soAtivos ? lista.filter((f) => f.ativo).map((f) => ({ id: f.id, nome: f.nome })) : lista.map(publico);
}

/** Cadastrar (nome + PIN), trocar o PIN, renomear, desativar ou reativar. */
export async function salvarFuncionario(kv, k, d) {
  const nome = texto(d?.nome, 60).trim();
  const lista = await todos(kv, k);
  const atual = d?.id ? lista.find((f) => f.id === String(d.id)) : null;
  if (d?.id && !atual) throw erro(404, "Funcionário não encontrado.");
  if (!atual && !nome) throw erro(400, "Informe o nome do funcionário.");
  if (nome && lista.some((f) => f.id !== atual?.id && f.nome.toLowerCase() === nome.toLowerCase())) throw erro(409, `Já existe um funcionário chamado ${nome}.`);
  if (d.pin !== undefined && d.pin !== "" && !PIN.test(String(d.pin))) throw erro(400, "O PIN tem de 4 a 6 números.");
  if (!atual && !d.pin) throw erro(400, "Informe o PIN (4 a 6 números).");
  const agora = new Date().toISOString();
  const f = {
    ...(atual || { id: `F${Date.now().toString(36)}`, criadoEm: agora, ativo: true }),
    ...(nome ? { nome } : {}),
    ...(d.pin ? { pin: resumoPin(d.pin) } : {}),
    ...(d.ativo !== undefined ? { ativo: d.ativo === true } : {}),
    atualizadoEm: agora,
  };
  await kv.hset(k.funcionarios, { [f.id]: f });
  return publico(f);
}

// Meia-noite de hoje em Brasília: até lá vale a sessão
function proximaMeiaNoite() {
  return new Date(`${somarDias(hojeSP(), 1)}T00:00:00-03:00`);
}

/** Entrada com nome + PIN. 10 PINs errados seguidos do mesmo endereço bloqueiam por 15 minutos. */
export async function entrar(kv, k, request, { id, pin } = {}) {
  const erros = await errosDeSenha(request, "pin");
  if (erros && erros.n >= LIMITE_TENTATIVAS.n) {
    const min = Math.max(1, Math.ceil((LIMITE_TENTATIVAS.janelaMs - (Date.now() - erros.desde)) / 60000));
    throw erro(429, `Muitos PINs errados. Espere ${min} minuto(s) e tente de novo.`);
  }
  const f = desembrulhar(await kv.hget(k.funcionarios, String(id || "")));
  if (!f || !f.ativo || !pinConfere(pin, f)) {
    await anotarErroDeSenha(request, erros, "pin");
    throw erro(401, "PIN errado.");
  }
  const token = randomBytes(24).toString("base64url");
  const expira = proximaMeiaNoite();
  const seg = Math.max(60, Math.floor((expira - Date.now()) / 1000));
  await kv.set(k.sessao(resumoSessao(token)), { funcionarioId: f.id, nome: f.nome, expira: expira.toISOString() }, { ex: seg });
  return { token, nome: f.nome, id: f.id, expira: expira.toISOString() };
}

export async function sair(kv, k, token) {
  if (token) await kv.del(k.sessao(resumoSessao(token)));
  return { saiu: true };
}

// ---------- O que o funcionário recebe ----------

// Catálogo sem custo: os números do arquivo de custos viram vazio (o preço padrão das portas fica)
export function custosSemValores(c) {
  if (Array.isArray(c)) return c.map(custosSemValores);
  if (c && typeof c === "object") return Object.fromEntries(Object.entries(c).map(([k, v]) => [k, k === "venda" ? v : custosSemValores(v)]));
  return typeof c === "number" ? null : c;
}

const semCustoNoItem = ({ custoTotal, custoUnitario, ...resto }) => resto;
/** Venda/recebimento sem o que é do dono: custo, CMV, margem. */
export function lancamentoParaFuncionario(l) {
  const { cmv, tabelaTotal, variacao, ...resto } = l;
  return { ...resto, ...(Array.isArray(l.itens) ? { itens: l.itens.map(semCustoNoItem) } : {}) };
}
export function orcamentoParaFuncionario(o) {
  const { custo, margem, ...resto } = o;
  return { ...resto, itens: (o.itens || []).map(semCustoNoItem) };
}

// O que vale para o funcionário ver: vendas de hoje (Pedidos de hoje) e tudo o que forma o fiado (vendas fiado,
// recebimentos, fiado da pasta e vendas com cheque devolvido), sempre sem custo. Despesas, saldos e o resto, não.
export function lancamentosDoFuncionario(lista, hoje = hojeSP()) {
  const doFiado = (l) => l.conta === "recebimento" || l.conta === "fiado_anterior"
    || (l.pagamentos || []).some((p) => p.forma === "fiado" || (p.forma === "cheque" && p.cheque?.devolvidoEm));
  return lista.filter((l) => !l.excluido && ((l.conta === "venda_produtos" && l.competencia === hoje) || doFiado(l))).map(lancamentoParaFuncionario);
}

// Configuração que o Vender, os orçamentos e a impressão precisam (sem taxas, impostos, CMV nem pessoal)
export function configParaFuncionario(cfgSalva) {
  const c = mesclarConfigFinanceiro(cfgSalva);
  return { fiado: c.fiado, impressao: c.impressao, orcamentos: c.orcamentos, formas: c.formas, funcionarios: c.funcionarios };
}

// ---------- Conferência das vendas e orçamentos do funcionário ----------

/**
 * Recalcula o custo de cada item pelo catálogo (o custo nunca vem da tela do funcionário) e confere o preço:
 * nenhum item abaixo da tabela menos o desconto máximo (o frete fica fora), nenhum abaixo do custo. Item sem preço
 * de tabela e "Outros" entram como "preço digitado"; "Outros" fica com "custo não informado".
 * refTabela(itemId, acabamento): preço de tabela de referência (ex.: o do orçamento que virou venda).
 */
export async function conferirItensDoFuncionario(kv, k, itens, { refTabela = null } = {}) {
  if (!Array.isArray(itens) || !itens.length) throw erro(400, "O pedido está vazio.");
  const { precos, config } = await lerPrecosEConfig(kv, k);
  const cat = montarCatalogo(lerCustos(), config);
  const tabela = precosComPadrao(precosComIdsAtuais(precos), cat);
  const cfg = mesclarConfigFinanceiro(desembrulhar(await kv.get(k.configFinanceiro)) || {});
  const max = Number(cfg.funcionarios?.descontoMaxPct ?? 5) / 100;
  // "Últimas peças" (Ajustes da calculadora): o desconto que o dono configurou vale para o funcionário também
  const ultimas = Number(config?.modificadores?.ultimasPecasPct || 0) / 100;
  let cmv = 0, precoDigitado = false;
  const novos = itens.map((i) => {
    const item = cat.itens.get(idAtual(String(i?.itemId || "")));
    if (!item) throw erro(400, `Item fora do catálogo: ${texto(i?.descricao, 60) || i?.itemId}`);
    const livre = item.unidade === "valor_livre";
    const qc = quantidadeCobradaDe(item, i);
    if (!(qc > 0)) throw erro(400, "Quantidade inválida num item do pedido.");
    const venda = Number(i.vendaTotal);
    if (!Number.isFinite(venda) || venda < 0) throw erro(400, "Preço inválido num item do pedido.");
    const custoTotal = item.pedeCusto || item.custo == null ? null : reais(centavos(item.custo * qc));
    const acab = i.acabamento || "UNICO";
    const ref = refTabela?.(item.id, acab);
    const tab = livre ? null : ref ?? tabela[`${item.id}|${acab}`] ?? null;
    if (tab != null) {
      const maxItem = i.motivo === "Últimas peças" ? Math.max(max, ultimas) : max;
      if (centavos(venda) < Math.round(centavos(tab * qc) * (1 - maxItem)) - 1) throw erro(400, `Desconto acima do permitido em ${item.material} ${livre ? "" : item.rotuloDimensao}: chame o responsável.`);
    } else if (!livre || item.pedeCusto) precoDigitado = true;
    if (custoTotal != null && centavos(venda) < centavos(custoTotal)) throw erro(400, `Preço abaixo do permitido em ${item.material} ${item.rotuloDimensao}: chame o responsável.`);
    if (custoTotal != null) cmv += centavos(custoTotal);
    return { ...i, itemId: item.id, quantidadeCobrada: qc, custoTotal, ...(tab == null && !livre ? { precoDigitado: true } : {}) };
  });
  return { itens: novos, cmv: reais(cmv), precoDigitado };
}

/**
 * Venda ou recebimento lançado pelo funcionário. Só lançamento novo (corrigir e estornar são do dono);
 * a mesma gravação de novo (internet caiu e o funcionário tentou outra vez) é aceita.
 */
export async function prepararLancamentoDoFuncionario(kv, k, item, quem) {
  if (!item || typeof item !== "object") throw erro(400, "Lançamento inválido.");
  if (!["venda_produtos", "recebimento"].includes(item.conta)) throw erro(403, "Funcionário só lança vendas e recebimentos de fiado.");
  const antes = desembrulhar(await kv.hget(k.lancamentos, String(item.id || "")));
  if (antes && !(antes.vendedor?.id === quem.id && !antes.excluido && centavos(antes.value) === centavos(item.value) && !item.versaoBase)) {
    throw erro(403, "Corrigir ou estornar é só com o dono.");
  }
  const vendedor = { tipo: "funcionario", id: quem.id, nome: quem.nome };
  const { cmv: _c, versaoBase: _v, vendedor: _vd, alertaFiado: _a, precoDigitado: _p, migrado: _m, abertura: _ab, ...resto } = item;
  const limpo = { ...resto, competencia: hojeSP(), date: hojeSP() }; // funcionário lança só no dia
  if (item.conta === "recebimento") return { ...limpo, vendedor };
  // o orçamento que virou venda: vale o preço de tabela gravado nele (não o de hoje)
  let refTabela = null;
  if (item.orcamento) {
    const orc = desembrulhar(await kv.hget(k.orcamentos, String(item.orcamento)));
    const porItem = new Map((orc?.itens || []).map((x) => [`${idAtual(x.itemId)}|${x.acabamento || "UNICO"}`, x.precoTabela]));
    refTabela = (id, acab) => porItem.get(`${id}|${acab}`) ?? undefined;
  }
  const r = await conferirItensDoFuncionario(kv, k, item.itens, { refTabela });
  const soma = r.itens.reduce((s, i) => s + centavos(i.vendaTotal), 0) + centavos(item.frete || 0);
  if (Math.abs(soma - centavos(item.value)) > 1) throw erro(400, "O total não bate com os itens do pedido. Recarregue e tente de novo.");
  const venda = { ...limpo, itens: r.itens, cmv: r.cmv, vendedor };
  if (r.precoDigitado) venda.precoDigitado = true;
  // Fiado de cliente acima do combinado (limite ou dias sem pagar): a venda segue, marcada para o dono ver
  if ((item.pagamentos || []).some((p) => p.forma === "fiado") && item.clienteId) {
    const alertas = await alertasDoCliente(kv, k, item.clienteId);
    if (alertas.length) venda.alertaFiado = alertas.join("; ");
  }
  return venda;
}

async function alertasDoCliente(kv, k, clienteId) {
  const cli = desembrulhar(await kv.hget(k.clientes, String(clienteId)));
  if (!cli) return [];
  const lista = Object.values((await kv.hgetall(k.lancamentos)) || {}).map(desembrulhar).filter((l) => l && !l.excluido && String(l.clienteId) === String(clienteId));
  const cfg = desembrulhar(await kv.get(k.configFinanceiro)) || {};
  const r = contasAReceber(lista, cfg, hojeSP(), [cli]);
  return (r.porCliente.find((c) => String(c.clienteId) === String(clienteId))?.alertas || []).map((a) => a.texto);
}

/** Orçamento (ou "atualizar preços") do funcionário: custo e margem calculados aqui, desconto conferido. */
export async function prepararOrcamentoDoFuncionario(kv, k, d) {
  if (!d || typeof d !== "object") throw erro(400, "Orçamento inválido.");
  const r = await conferirItensDoFuncionario(kv, k, d.itens);
  const comCusto = r.itens.filter((i) => i.custoTotal != null).reduce((s, i) => s + centavos(i.vendaTotal), 0);
  return { ...d, itens: r.itens, custo: r.cmv, margem: comCusto > 0 ? (comCusto - centavos(r.cmv)) / comCusto : null,
  };
}
