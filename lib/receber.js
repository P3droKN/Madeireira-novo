// Contas a receber (fiado) — funções puras, sem tela.
// Nada fica "baixado" no banco: o saldo de cada cliente é recalculado a partir dos lançamentos.
//   dívidas  = vendas com forma "Fiado" + cheques devolvidos (de venda ou de recebimento)
//   créditos = lançamentos "recebimento" do cliente (total ou parcial, em qualquer forma)
// O recebimento abate primeiro as vendas que ele indicar (vendaIds) e depois as mais antigas
// (vencimento, depois data). Excluir uma venda ou um recebimento recalcula tudo sozinho.
// Cliente "conta corrente" (marcado no cadastro): sem vencimento, nunca atrasado; mostra há quantos dias
// está em aberto e alerta opcional por limite em R$ e/ou dias sem pagar.
import { mesclarConfigFinanceiro } from "./planoContas.js";
import { normalizar } from "./financeiro.js";
import { somarDias, diasEntre } from "./orcamentos.js";

const centavos = (v) => Math.round(Number(v || 0) * 100);
const reais = (c) => Math.round(c) / 100;
const semAcento = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase().replace(/\s+/g, " ");

/** Chave do cliente: o id do cadastro; sem cadastro, o nome (sem acento e sem diferença de maiúsculas). */
export function chaveCliente(clienteId, nome) {
  if (clienteId) return String(clienteId);
  const n = semAcento(nome);
  return n ? `nome:${n}` : "nome:(sem nome)";
}

export const ehRecebimento = (l) => l.conta === "recebimento";

/** Vencimento de um fiado: o combinado na venda ou a data + prazo padrão. */
export function vencimentoFiado(pagamento, dataVenda, cfg) {
  return pagamento?.fiado?.vencimento || somarDias(dataVenda, cfg.fiado?.prazoDias ?? 30);
}

/**
 * Contas a receber por cliente, na data `hoje`.
 * @param {object[]} lancamentos como vêm do banco
 * @param {object} configSalva configuração financeira
 * @param {string} hoje AAAA-MM-DD
 * @param {object[]} [clientes] cadastro (para mostrar nome e telefone atuais)
 */
export function contasAReceber(lancamentos, configSalva, hoje, clientes = []) {
  const cfg = mesclarConfigFinanceiro(configSalva);
  const lista = normalizar(lancamentos, cfg).filter((l) => !l.abertura);
  const cadastro = Object.fromEntries((clientes || []).map((c) => [String(c.id), c]));
  const grupos = new Map();
  const grupo = (clienteId, nome) => {
    const chave = chaveCliente(clienteId, nome);
    if (!grupos.has(chave)) {
      const c = clienteId ? cadastro[clienteId] : null;
      grupos.set(chave, {
        chave, clienteId: clienteId || null, cliente: c?.nome || nome || "(sem nome)", telefone: c?.telefone || "", dividas: [], recebimentos: [],
        contaCorrente: c?.contaCorrente === true, alertaLimite: c?.alertaLimite ?? null, alertaDias: c?.alertaDias ?? null,
      });
    }
    const g = grupos.get(chave);
    if (!g.cliente || g.cliente === "(sem nome)") g.cliente = nome || g.cliente;
    return g;
  };

  for (const l of lista) {
    (l.pagamentos || []).forEach((p, i) => {
      if (p.forma === "fiado" && !ehRecebimento(l)) {
        grupo(l.clienteId, l.cliente).dividas.push({
          tipo: "fiado", origemId: l.id, pagamento: i, data: l.competencia, vencimento: vencimentoFiado(p, l.competencia, cfg),
          valor: centavos(p.valor), descricao: l.description || "Venda fiado",
        });
      }
      // Cheque que voltou: o cliente passa a dever esse valor (de uma venda ou de um recebimento)
      if (p.forma === "cheque" && p.cheque?.devolvidoEm) {
        grupo(l.clienteId, l.cliente || p.cheque.emissor).dividas.push({
          tipo: "cheque_devolvido", origemId: l.id, pagamento: i, data: p.cheque.devolvidoEm, vencimento: p.cheque.devolvidoEm,
          valor: centavos(p.valor), descricao: `Cheque devolvido${p.cheque.numero ? ` nº ${p.cheque.numero}` : ""}${p.cheque.emissor ? ` (${p.cheque.emissor})` : ""}`,
        });
      }
    });
    // Fiado da pasta, lançado na abertura (sem receita: a venda foi antes do sistema)
    if (l.conta === "fiado_anterior") {
      grupo(l.clienteId, l.cliente).dividas.push({
        tipo: "fiado_anterior", origemId: l.id, pagamento: null, data: l.competencia, vencimento: l.vencimento || somarDias(l.competencia, cfg.fiado?.prazoDias ?? 30),
        valor: centavos(l.value), descricao: l.description || "Fiado anterior (pasta)",
      });
    }
    if (ehRecebimento(l)) {
      grupo(l.clienteId, l.cliente).recebimentos.push({
        id: l.id, data: l.competencia, valor: centavos(l.value), vendaIds: Array.isArray(l.vendaIds) ? l.vendaIds.map(String) : [],
        formas: (l.pagamentos || []).map((p) => p.forma), descricao: l.description || "",
      });
    }
  }

  const porCliente = [];
  let totalAberto = 0, totalAtrasado = 0, totalContaCorrente = 0;
  for (const g of grupos.values()) {
    // Conta corrente não tem vencimento: abate sempre as compras mais antigas primeiro
    const ordem = g.contaCorrente
      ? (a, b) => a.data.localeCompare(b.data) || String(a.origemId).localeCompare(String(b.origemId))
      : (a, b) => a.vencimento.localeCompare(b.vencimento) || a.data.localeCompare(b.data) || String(a.origemId).localeCompare(String(b.origemId));
    g.dividas.sort(ordem);
    for (const d of g.dividas) d.pago = 0;
    g.recebimentos.sort((a, b) => a.data.localeCompare(b.data) || String(a.id).localeCompare(String(b.id)));
    // Cada recebimento abate só o que já existia na data dele (as indicadas primeiro, depois as que
    // vencem antes); o que sobra vira crédito e abate as compras seguintes. Assim uma compra nova
    // nunca "reabre" uma que já estava paga.
    // r (opcional): o recebimento, para saber quanto dele pagou fiado anterior à virada
    const abater = (lista, valor, r) => {
      let resto = valor;
      for (const d of lista) {
        if (!resto) break;
        const falta = d.valor - d.pago;
        if (falta <= 0) continue;
        const usa = Math.min(falta, resto);
        d.pago += usa;
        resto -= usa;
        if (r && d.tipo === "fiado_anterior") r.paraAnterior += usa;
      }
      return resto;
    };
    let credito = 0;
    for (const r of g.recebimentos) {
      r.paraAnterior = 0;
      const existentes = g.dividas.filter((d) => d.data <= r.data || r.vendaIds.includes(String(d.origemId)));
      const alvo = [...existentes.filter((d) => r.vendaIds.includes(String(d.origemId))), ...existentes.filter((d) => !r.vendaIds.includes(String(d.origemId)))];
      credito += abater(alvo, r.valor, r);
    }
    credito = abater(g.dividas, credito); // crédito de antes abate as compras seguintes; o resto continua de crédito
    let aberto = 0, atrasado = 0, maiorAtraso = 0, proximoVencimento = null, emAbertoDesde = null;
    const dividas = g.dividas.map((d) => {
      const emAberto = d.valor - d.pago;
      if (emAberto > 0 && (!emAbertoDesde || d.data < emAbertoDesde)) emAbertoDesde = d.data;
      if (g.contaCorrente) {
        aberto += Math.max(0, emAberto);
        return { ...d, vencimento: null, valor: reais(d.valor), pago: reais(d.pago), aberto: reais(Math.max(0, emAberto)), diasAtraso: 0,
          diasEmAberto: emAberto > 0 ? Math.max(0, diasEntre(d.data, hoje)) : 0, situacao: emAberto <= 0 ? "pago" : "em_aberto" };
      }
      const dias = emAberto > 0 ? diasEntre(d.vencimento, hoje) : 0;
      const situacao = emAberto <= 0 ? "pago" : dias > 0 ? "atrasado" : "a_vencer";
      aberto += Math.max(0, emAberto);
      if (situacao === "atrasado") { atrasado += emAberto; maiorAtraso = Math.max(maiorAtraso, dias); }
      if (situacao === "a_vencer" && (!proximoVencimento || d.vencimento < proximoVencimento)) proximoVencimento = d.vencimento;
      return { ...d, valor: reais(d.valor), pago: reais(d.pago), aberto: reais(Math.max(0, emAberto)), diasAtraso: Math.max(0, dias), situacao };
    });
    totalAberto += aberto;
    totalAtrasado += atrasado;
    if (g.contaCorrente) totalContaCorrente += aberto;
    // Conta corrente: há quantos dias está em aberto, dias sem pagar e alertas (em branco = sem alerta)
    const ultimoPagamento = g.recebimentos.length ? g.recebimentos[g.recebimentos.length - 1].data : null;
    const diasEmAberto = emAbertoDesde ? Math.max(0, diasEntre(emAbertoDesde, hoje)) : 0;
    const diasSemPagar = !aberto ? 0 : ultimoPagamento && ultimoPagamento > emAbertoDesde ? Math.max(0, diasEntre(ultimoPagamento, hoje)) : diasEmAberto;
    const alertas = [];
    if (g.contaCorrente && aberto > 0) {
      if (g.alertaLimite != null && aberto >= centavos(g.alertaLimite)) alertas.push({ tipo: "limite", texto: `passou do limite de ${brl(g.alertaLimite)}` });
      if (g.alertaDias != null && diasSemPagar >= g.alertaDias) alertas.push({ tipo: "dias", texto: `${diasSemPagar} dias sem pagar (alerta: ${g.alertaDias})` });
    }
    porCliente.push({
      chave: g.chave, clienteId: g.clienteId, cliente: g.cliente, telefone: g.telefone,
      contaCorrente: g.contaCorrente, alertaLimite: g.alertaLimite, alertaDias: g.alertaDias,
      aberto: reais(aberto), atrasado: reais(atrasado), credito: reais(credito),
      maiorAtraso, proximoVencimento, emAbertoDesde: aberto ? emAbertoDesde : null, diasEmAberto: aberto ? diasEmAberto : 0,
      ultimoPagamento, diasSemPagar, alertas, dividas,
      recebimentos: g.recebimentos.map((r) => ({ ...r, valor: reais(r.valor), paraAnterior: reais(r.paraAnterior || 0) })),
      totalComprado: reais(g.dividas.reduce((s, d) => s + centavos(d.valor), 0)),
    });
  }
  porCliente.sort((a, b) => b.alertas.length - a.alertas.length || b.atrasado - a.atrasado || b.aberto - a.aberto || a.cliente.localeCompare(b.cliente));
  return {
    porCliente, totalAberto: reais(totalAberto), totalAtrasado: reais(totalAtrasado),
    totalContaCorrente: reais(totalContaCorrente), totalComVencimento: reais(totalAberto - totalContaCorrente),
    comAlerta: porCliente.filter((c) => c.alertas.length).length,
  };
}

/**
 * Quanto dos recebimentos de fiado do mês (pela data do recebimento) pagou fiado anterior à virada.
 * Entra no caixa, mas não é venda deste mês: o DRE e o fluxo mostram só como informação.
 */
export function recebidoDeFiadoAnterior(lancamentos, configSalva, mes, hoje, clientes = []) {
  const r = contasAReceber(lancamentos, configSalva, hoje, clientes);
  let total = 0;
  for (const c of r.porCliente) for (const rec of c.recebimentos) if (rec.data.slice(0, 7) === mes) total += centavos(rec.paraAnterior);
  return reais(total);
}

const brl = (v) => "R$ " + Number(v || 0).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");

/** Dívidas em aberto de um cliente, para escolher em qual abater o recebimento. */
export function abertasDoCliente(r, chave) {
  return (r.porCliente.find((c) => c.chave === chave)?.dividas || []).filter((d) => d.aberto > 0);
}

/** Texto de cobrança para o WhatsApp (nada é enviado sozinho). */
export function textoCobrancaFiado(c, hoje) {
  const dataBR = (d) => d.split("-").reverse().join("/");
  const primeiro = (c.cliente || "").split(" ")[0];
  const abertas = c.dividas.filter((d) => d.aberto > 0);
  const linhas = [`Olá ${primeiro}, tudo bem? Aqui é da Madeireira.`, "", `Consta em aberto ${brl(c.aberto)}:`];
  for (const d of abertas) linhas.push(c.contaCorrente || !d.vencimento ? `• ${dataBR(d.data)} – ${brl(d.aberto)}` : `• ${dataBR(d.data)} – ${brl(d.aberto)} (vence${d.vencimento < hoje ? "u" : ""} ${dataBR(d.vencimento)})`);
  linhas.push("", "Podemos combinar o pagamento? Obrigado!");
  return linhas.join("\n");
}
