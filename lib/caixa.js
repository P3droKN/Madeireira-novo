// Fluxo de caixa (funções puras): movimentos por conta financeira, saldos, projeção e fluxo mensal.
// Cada lançamento vira movimentos de dinheiro em uma conta, na data em que o dinheiro entra ou sai.
import { mesclarConfigFinanceiro, contaPorId, naturezaDaConta, FORMAS_PADRAO } from "./planoContas.js";
import { normalizar } from "./financeiro.js";
import { somarDias } from "./orcamentos.js";

export const CONTAS_CAIXA = ["gaveta", "bradesco", "picpay", "cheques_carteira"];
export const NOMES_CONTAS = { gaveta: "Gaveta", bradesco: "Bradesco", picpay: "PicPay", cheques_carteira: "Cheques em carteira" };
const CARTAO = Object.fromEntries(FORMAS_PADRAO.filter((f) => f.cartao).map((f) => [f.id, f.cartao]));

const centavos = (v) => Math.round(Number(v || 0) * 100);
const reais = (c) => Math.round(c) / 100;

// Divide um valor em n parcelas de centavos exatos (a sobra vai para a última)
export function dividirEmParcelas(valorCentavos, n) {
  const base = Math.floor(valorCentavos / n);
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? valorCentavos - base * (n - 1) : base));
}

function taxaPct(forma, parcelas, cfg) {
  const tipo = CARTAO[forma];
  if (tipo === "debito") return cfg.cartao.debito.taxaPct;
  if (tipo === "credito") return cfg.cartao.credito.taxaPct;
  if (tipo === "parcelado") return cfg.cartao.parcelado.taxaPctPorParcelas[parcelas] ?? 0;
  return 0;
}

/**
 * Movimentos de dinheiro de todos os lançamentos.
 * @returns {{ conta, data, valor, tipo, origemId, descricao, grupo?, pagamento?, previsto? }[]} valor em reais (+ entra, − sai)
 */
export function movimentos(lancamentos, configSalva) {
  const cfg = mesclarConfigFinanceiro(configSalva);
  const lista = normalizar(lancamentos, cfg);
  const mov = [];
  const add = (m) => { if (m.conta && m.valor) mov.push({ ...m, valor: reais(m.valor) }); };

  for (const l of lista) {
    if (l.abertura) continue;
    const desc = l.description || contaPorId[l.conta]?.nome || "";
    if (l.conta === "transferencia") {
      add({ conta: l.de, data: l.competencia, valor: -centavos(l.value), tipo: "transferencia", origemId: l.id, descricao: desc || `Transferência para ${NOMES_CONTAS[l.para]}` });
      add({ conta: l.para, data: l.competencia, valor: centavos(l.value), tipo: "transferencia", origemId: l.id, descricao: desc || `Transferência de ${NOMES_CONTAS[l.de]}` });
      continue;
    }
    if (Array.isArray(l.pagamentos)) {
      l.pagamentos.forEach((p, i) => {
        const valor = centavos(p.valor);
        const base = { origemId: l.id, pagamento: i, descricao: desc };
        if (!p.conta && p.forma !== "cheque") return; // "forma não informada" (dados antigos)
        const tipoCartao = CARTAO[p.forma];
        if (tipoCartao) {
          const n = tipoCartao === "parcelado" ? Number(p.parcelas) || 2 : 1;
          const prazo = tipoCartao === "debito" ? cfg.cartao.debito.prazoDias : tipoCartao === "credito" ? cfg.cartao.credito.prazoDias : cfg.cartao.parcelado.prazoDias;
          const liquido = Math.round(valor * (1 - taxaPct(p.forma, n, cfg) / 100));
          dividirEmParcelas(liquido, n).forEach((v, k) => add({
            ...base, conta: p.conta, data: somarDias(l.competencia, prazo * (k + 1)), valor: v, tipo: "recebivel_cartao",
            descricao: `${desc}${n > 1 ? ` (parcela ${k + 1}/${n})` : ""}`.trim(),
          }));
          return;
        }
        if (p.forma === "cheque") {
          const ch = p.cheque || {};
          const comp = ch.compensacao || l.competencia;
          const deposito = ch.contaDeposito || cfg.cheques?.contaDeposito || "bradesco";
          // Cheque lançado na abertura: já está dentro do saldo "Cheques em carteira" da abertura
          if (l.conta !== "cheque_anterior") add({ ...base, conta: "cheques_carteira", data: l.competencia, valor, tipo: "cheque_recebido", cheque: ch.numero });
          if (ch.devolvidoEm && ch.devolvidoEm < comp) {
            add({ ...base, conta: "cheques_carteira", data: ch.devolvidoEm, valor: -valor, tipo: "cheque_devolvido", cheque: ch.numero });
          } else {
            add({ ...base, conta: "cheques_carteira", data: comp, valor: -valor, tipo: "cheque_compensado", cheque: ch.numero });
            add({ ...base, conta: deposito, data: comp, valor, tipo: "cheque_compensado", cheque: ch.numero });
            if (ch.devolvidoEm) add({ ...base, conta: deposito, data: ch.devolvidoEm, valor: -valor, tipo: "cheque_devolvido", cheque: ch.numero });
          }
          return;
        }
        add({ ...base, conta: p.conta, data: l.competencia, valor, tipo: l.conta === "recebimento" ? "recebimento" : "venda" });
      });
      continue;
    }
    if (l.pagoCom) {
      const entrada = naturezaDaConta(l.conta) === "entrada";
      const grupo = contaPorId[l.conta]?.grupo;
      if (l.pagoCom === "cheque_emitido") {
        const ch = l.chequeEmitido || {};
        add({ conta: ch.conta || "bradesco", data: ch.compensacao || l.dataPagamento || l.competencia, valor: -centavos(l.value), tipo: "cheque_emitido", origemId: l.id, descricao: desc, grupo, cheque: ch.numero });
      } else {
        const conta = { gaveta: "gaveta", bradesco: "bradesco", picpay: "picpay" }[l.pagoCom];
        add({ conta, data: l.dataPagamento || l.competencia, valor: (entrada ? 1 : -1) * centavos(l.value), tipo: entrada ? "entrada" : "saida", origemId: l.id, descricao: desc, grupo });
      }
    }
  }
  return mov.sort((a, b) => a.data.localeCompare(b.data));
}

/**
 * Saldo de cada conta até uma data (inclusive).
 * A abertura vale para o início do dia da abertura: entram os movimentos a partir dessa data.
 */
export function saldos(movs, abertura, ate) {
  const r = Object.fromEntries(CONTAS_CAIXA.map((c) => [c, centavos(abertura?.contas?.[c] || 0)]));
  for (const m of movs) {
    if (abertura?.data && m.data < abertura.data) continue;
    if (m.data > ate) continue;
    r[m.conta] = (r[m.conta] || 0) + centavos(m.valor);
  }
  const porConta = Object.fromEntries(Object.entries(r).map(([c, v]) => [c, reais(v)]));
  return { porConta, total: reais(Object.values(r).reduce((s, v) => s + v, 0)) };
}

/** Projeção dos próximos dias: o que entra e sai depois de hoje, dia a dia, com saldo projetado. */
export function projecao(movs, abertura, hoje, dias = 30) {
  const fim = somarDias(hoje, dias);
  const atual = saldos(movs, abertura, hoje);
  const futuros = movs.filter((m) => m.data > hoje && m.data <= fim && (!abertura?.data || m.data >= abertura.data));
  const porTipo = {};
  for (const m of futuros) porTipo[m.tipo] = reais(centavos(porTipo[m.tipo] || 0) + centavos(m.valor));
  const porDia = [];
  let saldo = centavos(atual.total);
  const datas = [...new Set(futuros.map((m) => m.data))].sort();
  for (const d of datas) {
    const doDia = futuros.filter((m) => m.data === d);
    // Movimentos internos (compensação carteira → banco, transferências) não mudam o total
    const externos = doDia.filter((m) => m.tipo !== "cheque_compensado" && m.tipo !== "transferencia");
    const ent = externos.filter((m) => m.valor > 0).reduce((s, m) => s + centavos(m.valor), 0);
    const sai = externos.filter((m) => m.valor < 0).reduce((s, m) => s + centavos(m.valor), 0);
    saldo += ent + sai;
    porDia.push({ data: d, entradas: reais(ent), saidas: reais(-sai), saldo: reais(saldo), movimentos: doDia });
  }
  const contaFinal = { ...Object.fromEntries(Object.entries(atual.porConta).map(([c, v]) => [c, centavos(v)])) };
  for (const m of futuros) contaFinal[m.conta] = (contaFinal[m.conta] || 0) + centavos(m.valor);
  return {
    hoje, fim, saldoHoje: atual, porTipo, porDia,
    saldoFinal: reais(saldo),
    porContaFinal: Object.fromEntries(Object.entries(contaFinal).map(([c, v]) => [c, reais(v)])),
  };
}

const ROTULOS_TIPO = {
  venda: "Vendas (dinheiro, PIX, transferência)",
  recebivel_cartao: "Cartão (PicPay)",
  recebimento: "Recebimentos de fiado",
  cheque_recebido: "Cheques recebidos",
  cheque_compensado: "Cheques compensados",
  cheque_devolvido: "Cheques devolvidos",
  entrada: "Outras entradas",
  transferencia: "Transferências",
  saida: "Conta a pagar / saída",
  cheque_emitido: "Cheque emitido",
};
export const rotuloTipo = (t) => ROTULOS_TIPO[t] || t;

/** Fluxo de um mês para uma conta (ou todas): saldo inicial, entradas por tipo, saídas por grupo, saldo final e dia a dia. */
export function fluxoMensal(movs, abertura, mes, conta = null) {
  const ini = `${mes}-01`;
  const [a, m] = mes.split("-").map(Number);
  const fim = new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
  const daConta = (x) => !conta || x.conta === conta;
  const valida = (x) => (!abertura?.data || x.data >= abertura.data) && daConta(x);
  // Consolidado: transferências e compensação de cheque (carteira → banco) são internas e ficam de fora
  const conta_ = (x) => conta || (x.tipo !== "transferencia" && x.tipo !== "cheque_compensado");
  const saldoAntes = movs.filter((x) => valida(x) && x.data < ini).reduce((s, x) => s + centavos(x.valor), 0)
    + (abertura?.data && abertura.data <= fim ? CONTAS_CAIXA.filter((c) => !conta || c === conta).reduce((s, c) => s + centavos(abertura.contas?.[c] || 0), 0) : 0);
  const doMes = movs.filter((x) => valida(x) && x.data >= ini && x.data <= fim && conta_(x));
  const entradas = {}, saidas = {};
  for (const x of doMes) {
    if (x.valor > 0) entradas[x.tipo] = (entradas[x.tipo] || 0) + centavos(x.valor);
    else {
      const chave = x.grupo || x.tipo;
      saidas[chave] = (saidas[chave] || 0) - centavos(x.valor);
    }
  }
  const totalEnt = Object.values(entradas).reduce((s, v) => s + v, 0);
  const totalSai = Object.values(saidas).reduce((s, v) => s + v, 0);
  const dias = [];
  let corrente = saldoAntes;
  for (let d = ini; d <= fim; d = somarDias(d, 1)) {
    const doDia = doMes.filter((x) => x.data === d);
    if (!doDia.length) continue;
    const e = doDia.filter((x) => x.valor > 0).reduce((s, x) => s + centavos(x.valor), 0);
    const s = -doDia.filter((x) => x.valor < 0).reduce((t, x) => t + centavos(x.valor), 0);
    corrente += e - s;
    dias.push({ data: d, entradas: reais(e) || 0, saidas: reais(s) || 0, saldo: reais(corrente) });
  }
  const R = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, reais(v)]));
  return {
    mes, conta, saldoInicial: reais(saldoAntes), entradas: R(entradas), saidas: R(saidas),
    totalEntradas: reais(totalEnt), totalSaidas: reais(totalSai), saldoFinal: reais(saldoAntes + totalEnt - totalSai), dias,
  };
}

/** Cheques recebidos e emitidos, com situação na data. */
export function cheques(lancamentos, configSalva, hoje) {
  const cfg = mesclarConfigFinanceiro(configSalva);
  const lista = normalizar(lancamentos, cfg);
  const recebidos = [], emitidos = [];
  for (const l of lista) {
    if (l.abertura) continue;
    (l.pagamentos || []).forEach((p, i) => {
      if (p.forma !== "cheque") return;
      const ch = p.cheque || {};
      const comp = ch.compensacao || l.competencia;
      const situacaoCheque = ch.devolvidoEm ? "devolvido" : comp <= hoje ? "compensado" : "a_compensar";
      recebidos.push({
        lancamentoId: l.id, pagamento: i, valor: p.valor, numero: ch.numero || "", emissor: ch.emissor || "", banco: ch.banco || "",
        recebidoEm: l.competencia, compensacao: comp, contaDeposito: ch.contaDeposito || cfg.cheques?.contaDeposito || "bradesco",
        devolvidoEm: ch.devolvidoEm || null, situacao: situacaoCheque, cliente: l.cliente || "", descricao: l.description || "", origem: l.conta,
      });
    });
    if (l.pagoCom === "cheque_emitido") {
      const ch = l.chequeEmitido || {};
      const comp = ch.compensacao || l.dataPagamento || l.competencia;
      emitidos.push({
        lancamentoId: l.id, valor: l.value, numero: ch.numero || "", favorecido: ch.favorecido || l.fornecedor || "", conta: ch.conta || "bradesco",
        emitidoEm: l.competencia, compensacao: comp, situacao: comp <= hoje ? "compensado" : "a_compensar", descricao: l.description || "",
      });
    }
  }
  const ord = (a, b) => a.compensacao.localeCompare(b.compensacao);
  return { recebidos: recebidos.sort(ord), emitidos: emitidos.sort(ord) };
}

/** Valor sugerido para "Cheques em carteira" na abertura: recebidos antes da data, que compensam depois. */
export function carteiraNaData(lancamentos, configSalva, data) {
  const { recebidos } = cheques(lancamentos, configSalva, data);
  const em = recebidos.filter((c) => c.origem !== "cheque_anterior" && c.recebidoEm < data && c.compensacao >= data && !(c.devolvidoEm && c.devolvidoEm < data));
  return { valor: reais(em.reduce((s, c) => s + centavos(c.valor), 0)), quantidade: em.length };
}

/**
 * Cheques em carteira no dia da abertura, um por um:
 * os que vieram do sistema antigo (recebidos antes e compensam a partir da data) e os lançados na abertura.
 * O total é o saldo "Cheques em carteira" da abertura.
 */
export function chequesNaAbertura(lancamentos, configSalva, data) {
  const { recebidos } = cheques(lancamentos, configSalva, data);
  const doSistema = recebidos.filter((c) => c.origem !== "cheque_anterior" && c.recebidoEm < data && c.compensacao >= data && !(c.devolvidoEm && c.devolvidoEm < data));
  const naAbertura = recebidos.filter((c) => c.origem === "cheque_anterior");
  const soma = (l) => reais(l.reduce((s, c) => s + centavos(c.valor), 0));
  return { doSistema, naAbertura, totalSistema: soma(doSistema), totalAbertura: soma(naAbertura), total: soma([...doSistema, ...naAbertura]) };
}
