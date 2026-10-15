// Contas a receber (fiado) — funções puras, sem tela.
// Nada fica "baixado" no banco: o saldo de cada cliente é recalculado a partir dos lançamentos.
//   dívidas  = vendas com forma "Fiado" + cheques devolvidos (de venda ou de recebimento)
//   créditos = lançamentos "recebimento" do cliente (total ou parcial, em qualquer forma)
// O recebimento abate primeiro as vendas que ele indicar (vendaIds) e depois as mais antigas
// (vencimento, depois data). Excluir uma venda ou um recebimento recalcula tudo sozinho.
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
      grupos.set(chave, { chave, clienteId: clienteId || null, cliente: c?.nome || nome || "(sem nome)", telefone: c?.telefone || "", dividas: [], recebimentos: [] });
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
    if (ehRecebimento(l)) {
      grupo(l.clienteId, l.cliente).recebimentos.push({
        id: l.id, data: l.competencia, valor: centavos(l.value), vendaIds: Array.isArray(l.vendaIds) ? l.vendaIds.map(String) : [],
        formas: (l.pagamentos || []).map((p) => p.forma), descricao: l.description || "",
      });
    }
  }

  const porCliente = [];
  let totalAberto = 0, totalAtrasado = 0;
  for (const g of grupos.values()) {
    const ordem = (a, b) => a.vencimento.localeCompare(b.vencimento) || a.data.localeCompare(b.data) || String(a.origemId).localeCompare(String(b.origemId));
    g.dividas.sort(ordem);
    for (const d of g.dividas) d.pago = 0;
    g.recebimentos.sort((a, b) => a.data.localeCompare(b.data) || String(a.id).localeCompare(String(b.id)));
    // Cada recebimento abate só o que já existia na data dele (as indicadas primeiro, depois as que
    // vencem antes); o que sobra vira crédito e abate as compras seguintes. Assim uma compra nova
    // nunca "reabre" uma que já estava paga.
    const abater = (lista, valor) => {
      let resto = valor;
      for (const d of lista) {
        if (!resto) break;
        const falta = d.valor - d.pago;
        if (falta <= 0) continue;
        const usa = Math.min(falta, resto);
        d.pago += usa;
        resto -= usa;
      }
      return resto;
    };
    let credito = 0;
    for (const r of g.recebimentos) {
      const existentes = g.dividas.filter((d) => d.data <= r.data || r.vendaIds.includes(String(d.origemId)));
      const alvo = [...existentes.filter((d) => r.vendaIds.includes(String(d.origemId))), ...existentes.filter((d) => !r.vendaIds.includes(String(d.origemId)))];
      credito += abater(alvo, r.valor);
    }
    credito = abater(g.dividas, credito); // crédito de antes abate as compras seguintes; o resto continua de crédito
    let aberto = 0, atrasado = 0, maiorAtraso = 0, proximoVencimento = null;
    const dividas = g.dividas.map((d) => {
      const emAberto = d.valor - d.pago;
      const dias = emAberto > 0 ? diasEntre(d.vencimento, hoje) : 0;
      const situacao = emAberto <= 0 ? "pago" : dias > 0 ? "atrasado" : "a_vencer";
      aberto += Math.max(0, emAberto);
      if (situacao === "atrasado") { atrasado += emAberto; maiorAtraso = Math.max(maiorAtraso, dias); }
      if (situacao === "a_vencer" && (!proximoVencimento || d.vencimento < proximoVencimento)) proximoVencimento = d.vencimento;
      return { ...d, valor: reais(d.valor), pago: reais(d.pago), aberto: reais(Math.max(0, emAberto)), diasAtraso: Math.max(0, dias), situacao };
    });
    totalAberto += aberto;
    totalAtrasado += atrasado;
    porCliente.push({
      chave: g.chave, clienteId: g.clienteId, cliente: g.cliente, telefone: g.telefone,
      aberto: reais(aberto), atrasado: reais(atrasado), credito: reais(credito),
      maiorAtraso, proximoVencimento, dividas,
      recebimentos: g.recebimentos.map((r) => ({ ...r, valor: reais(r.valor) })),
      totalComprado: reais(g.dividas.reduce((s, d) => s + centavos(d.valor), 0)),
    });
  }
  porCliente.sort((a, b) => b.atrasado - a.atrasado || b.aberto - a.aberto || a.cliente.localeCompare(b.cliente));
  return { porCliente, totalAberto: reais(totalAberto), totalAtrasado: reais(totalAtrasado) };
}

/** Dívidas em aberto de um cliente, para escolher em qual abater o recebimento. */
export function abertasDoCliente(r, chave) {
  return (r.porCliente.find((c) => c.chave === chave)?.dividas || []).filter((d) => d.aberto > 0);
}

/** Texto de cobrança para o WhatsApp (nada é enviado sozinho). */
export function textoCobrancaFiado(c, hoje) {
  const brl = (v) => "R$ " + Number(v || 0).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const dataBR = (d) => d.split("-").reverse().join("/");
  const primeiro = (c.cliente || "").split(" ")[0];
  const abertas = c.dividas.filter((d) => d.aberto > 0);
  const linhas = [`Olá ${primeiro}, tudo bem? Aqui é da Madeireira.`, "", `Consta em aberto ${brl(c.aberto)}:`];
  for (const d of abertas) linhas.push(`• ${dataBR(d.data)} – ${brl(d.aberto)} (vence${d.vencimento < hoje ? "u" : ""} ${dataBR(d.vencimento)})`);
  linhas.push("", "Podemos combinar o pagamento? Obrigado!");
  return linhas.join("\n");
}
