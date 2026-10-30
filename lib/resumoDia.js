// Resumo do dia (ou de um período): o fechamento do balcão. Funções puras, montadas sobre as mesmas
// funções do DRE (montarDRE) e do fluxo de caixa (movimentos): a soma dos dias fecha com o mês.
import { mesclarConfigFinanceiro, contaPorId, naturezaDaConta } from "./planoContas.js";
import { normalizar, montarDRE } from "./financeiro.js";
import { movimentos, CONTAS_CAIXA, NOMES_CONTAS } from "./caixa.js";
import { contasAReceber } from "./receber.js";
import { somarDias } from "./orcamentos.js";
import { dataSP } from "./datas.js";

const centavos = (v) => Math.round(Number(v || 0) * 100);
const reais = (c) => Math.round(c) / 100 || 0; // sem "-0"
const RECEITA = ["venda_produtos", "frete_cobrado", "servicos"];
const BANCOS = ["gaveta", "bradesco", "picpay"]; // onde o dinheiro "entra no caixa"
const NOME_FORMA = {
  dinheiro: "Dinheiro", pix_bradesco: "PIX Bradesco", pix_picpay: "PIX PicPay", transferencia: "Transferência",
  debito: "Débito", credito: "Crédito à vista", credito_parcelado: "Crédito parcelado", cheque: "Cheque (em carteira)",
  fiado: "Fiado", nao_informada: "Forma não informada",
};
const ORDEM_FORMAS = Object.keys(NOME_FORMA);
const NOME_PAGO = { gaveta: "Gaveta", bradesco: "Bradesco", picpay: "PicPay", cheque_emitido: "Cheque emitido" };
// Saídas agrupadas como o pai entende (plano de contas → grupo do resumo)
const GRUPO_SAIDA = {
  compras: "Compras de madeira e materiais", cmv: "Compras de madeira e materiais", pessoal: "Pessoal", deducoes: "Impostos",
  fixas: "Despesas fixas", operacionais: "Operacionais", financeiras: "Financeiras", variaveis: "Despesas de venda",
  socios: "Retiradas do dono", investimentos: "Investimentos", classificar: "Outras (a classificar)",
};
const ORDEM_GRUPOS = ["Compras de madeira e materiais", "Pessoal", "Impostos", "Despesas fixas", "Operacionais", "Despesas de venda", "Financeiras", "Investimentos", "Retiradas do dono", "Outras (a classificar)", "Outras"];

const noPeriodo = (d, de, ate) => d && d >= de && d <= ate;
const meses = (de, ate) => {
  const r = [];
  for (let m = de.slice(0, 7); m <= ate.slice(0, 7);) {
    r.push(m);
    const [a, mm] = m.split("-").map(Number);
    m = mm === 12 ? `${a + 1}-01` : `${a}-${String(mm + 1).padStart(2, "0")}`;
  }
  return r;
};

/**
 * @param {object} d
 * @param {object[]} d.lancamentos  como vêm do banco (sem os estornados)
 * @param {object[]} [d.estornados] estornados (aparecem riscados na lista, sem somar)
 * @param {object} d.config         configuração financeira
 * @param {object} d.saldos         { abertura, conferencias }
 * @param {string} d.de             AAAA-MM-DD
 * @param {string} [d.ate]          AAAA-MM-DD (período); padrão = de
 * @param {object[]} [d.clientes]   cadastro (conta corrente)
 * @param {object[]} [d.orcamentos]
 */
export function resumoDoDia({ lancamentos, estornados = [], config, saldos: sal = {}, de, ate = de, clientes = [], orcamentos = [] }) {
  const cfg = mesclarConfigFinanceiro(config);
  const lista = normalizar(lancamentos, cfg).filter((l) => !l.abertura);
  const ab = sal.abertura || null;
  const doPeriodo = lista.filter((l) => noPeriodo(l.competencia, de, ate));

  // --- Vendas (competência no período) ---
  const vendas = doPeriodo.filter((l) => RECEITA.includes(l.conta));
  const pedidos = vendas.filter((l) => l.conta === "venda_produtos");
  const vendido = vendas.reduce((s, l) => s + centavos(l.value), 0);
  const porForma = {};
  for (const l of vendas) for (const p of l.pagamentos || []) {
    const k = p.forma === "credito_parcelado" ? `credito_parcelado:${Number(p.parcelas) || 2}` : p.forma;
    const f = (porForma[k] ||= { forma: p.forma, parcelas: p.forma === "credito_parcelado" ? Number(p.parcelas) || 2 : null, quantidade: 0, valor: 0 });
    f.quantidade++;
    f.valor += centavos(p.valor);
  }
  const fiadoVendido = porForma.fiado?.valor || 0;
  const freteCobrado = pedidos.reduce((s, l) => s + centavos(l.frete || 0), 0) + doPeriodo.filter((l) => l.conta === "frete_cobrado").reduce((s, l) => s + centavos(l.value), 0);

  // --- Recebimentos de fiado (por forma; quanto pagou fiado anterior à virada) ---
  const rec = contasAReceber(lancamentos, config, ate, clientes);
  const paraAnterior = {};
  for (const c of rec.porCliente) for (const r of c.recebimentos) if (r.paraAnterior) paraAnterior[r.id] = centavos(r.paraAnterior);
  const recebimentos = doPeriodo.filter((l) => l.conta === "recebimento");
  const recPorForma = {};
  for (const l of recebimentos) for (const p of l.pagamentos || []) {
    const f = (recPorForma[p.forma] ||= { forma: p.forma, quantidade: 0, valor: 0, anterior: 0 });
    f.quantidade++;
    f.valor += centavos(p.valor);
  }
  for (const l of recebimentos) {
    const ant = paraAnterior[l.id] || 0;
    if (!ant) continue;
    // a parte do fiado anterior vai na primeira forma do recebimento (marca informativa)
    const p = (l.pagamentos || [])[0];
    if (p) recPorForma[p.forma].anterior += ant;
  }
  const recebido = recebimentos.reduce((s, l) => s + centavos(l.value), 0);
  const recebidoAnterior = recebimentos.reduce((s, l) => s + (paraAnterior[l.id] || 0), 0);

  // --- Outras entradas (rendimentos, aporte) e saídas pagas no período ---
  // Outras entradas (rendimento, aporte): pela data em que o dinheiro entrou, como no caixa
  const outrasEntradas = lista.filter((l) => l.pagoCom && naturezaDaConta(l.conta) === "entrada" && !RECEITA.includes(l.conta) && noPeriodo(l.dataPagamento || l.competencia, de, ate));
  const saidas = lista.filter((l) => l.pagoCom && naturezaDaConta(l.conta) === "saida" && noPeriodo(l.dataPagamento || l.competencia, de, ate));
  const gruposSaida = {};
  for (const l of saidas) {
    const nome = GRUPO_SAIDA[contaPorId[l.conta]?.grupo] || "Outras";
    const g = (gruposSaida[nome] ||= { grupo: nome, total: 0, itens: [] });
    g.total += centavos(l.value);
    g.itens.push({ id: l.id, data: l.dataPagamento || l.competencia, descricao: l.description || contaPorId[l.conta]?.nome || "", conta: contaPorId[l.conta]?.nome || l.conta,
      fornecedor: l.fornecedor || "", pagoCom: NOME_PAGO[l.pagoCom] + (l.chequeEmitido?.numero ? ` nº ${l.chequeEmitido.numero}` : ""), valor: Number(l.value) });
  }

  // --- Movimento por conta (o fechamento): o mesmo cálculo do fluxo de caixa ---
  const movs = movimentos(lancamentos, config).filter((m) => !ab?.data || m.data >= ab.data);
  const saldoAte = (data) => {
    const r = Object.fromEntries(CONTAS_CAIXA.map((c) => [c, ab && (!ab.data || ab.data <= data) ? centavos(ab.contas?.[c] || 0) : 0]));
    for (const m of movs) if (m.data <= data) r[m.conta] = (r[m.conta] || 0) + centavos(m.valor);
    return r;
  };
  // Período que começa antes da abertura: o início é a própria abertura (antes dela o sistema não conta nada)
  const inicioNaAbertura = Boolean(ab?.data && ab.data >= de); // no próprio dia da abertura também
  const inicio = inicioNaAbertura ? Object.fromEntries(CONTAS_CAIXA.map((c) => [c, centavos(ab.contas?.[c] || 0)])) : saldoAte(somarDias(de, -1));
  const noDia = movs.filter((m) => noPeriodo(m.data, de, ate));
  // Interno (não é entrada nem saída de dinheiro da loja): transferência entre contas e cheque que sai da carteira para o banco
  const interno = (m) => m.tipo === "transferencia" || m.tipo === "cheque_compensado";
  const porConta = CONTAS_CAIXA.map((c) => {
    const ms = noDia.filter((m) => m.conta === c);
    const ent = ms.filter((m) => !interno(m) && m.valor > 0).reduce((s, m) => s + centavos(m.valor), 0);
    const sai = -ms.filter((m) => !interno(m) && m.valor < 0).reduce((s, m) => s + centavos(m.valor), 0);
    const transf = ms.filter(interno).reduce((s, m) => s + centavos(m.valor), 0);
    const cartao = ms.filter((m) => m.tipo === "recebivel_cartao").reduce((s, m) => s + centavos(m.valor), 0);
    return { conta: c, nome: NOMES_CONTAS[c], inicio: reais(inicio[c]), entradas: reais(ent), saidas: reais(sai), transferencias: reais(transf),
      fim: reais(inicio[c] + ent - sai + transf), recebiveisCartao: reais(cartao) };
  });
  const somaCol = (k) => reais(porConta.reduce((s, c) => s + centavos(c[k]), 0));
  const totalContas = { inicio: somaCol("inicio"), entradas: somaCol("entradas"), saidas: somaCol("saidas"), transferencias: somaCol("transferencias"), fim: somaCol("fim") };

  // "Entrou no caixa": dinheiro que entrou de verdade em gaveta, Bradesco ou PicPay (sem transferências)
  const entrou = noDia.filter((m) => BANCOS.includes(m.conta) && m.valor > 0 && m.tipo !== "transferencia").reduce((s, m) => s + centavos(m.valor), 0);
  const saiu = -noDia.filter((m) => BANCOS.includes(m.conta) && m.valor < 0 && m.tipo !== "transferencia").reduce((s, m) => s + centavos(m.valor), 0);

  // Gaveta: esperado × contado (última contagem do período)
  const conf = [...(sal.conferencias || [])].reverse().find((c) => c.conta === "gaveta" && noPeriodo(c.data, de, ate)) || null;
  const gaveta = conf ? { esperado: conf.calculado, contado: conf.informado, diferenca: conf.diferenca, em: conf.em, bateu: Math.abs(conf.diferenca) < 0.01 } : null;

  // --- Cheques do período ---
  const cheques = { recebidos: [], emitidos: [], compensados: [], devolvidos: [] };
  for (const l of lista) {
    (l.pagamentos || []).forEach((p) => {
      if (p.forma !== "cheque") return;
      const ch = p.cheque || {};
      const item = { numero: ch.numero || "", quem: ch.emissor || l.cliente || "", valor: Number(p.valor), lancamentoId: l.id };
      if (noPeriodo(l.competencia, de, ate) && l.conta !== "cheque_anterior") cheques.recebidos.push(item);
      const comp = ch.compensacao || l.competencia;
      if (ch.devolvidoEm && noPeriodo(ch.devolvidoEm, de, ate)) cheques.devolvidos.push(item);
      // compensou na data (mesmo que tenha voltado depois), como no caixa
      if (noPeriodo(comp, de, ate) && !(ch.devolvidoEm && ch.devolvidoEm < comp)) cheques.compensados.push({ ...item, tipo: "recebido" });
    });
    if (l.pagoCom === "cheque_emitido") {
      const ch = l.chequeEmitido || {};
      const item = { numero: ch.numero || "", quem: ch.favorecido || l.fornecedor || "", valor: Number(l.value), lancamentoId: l.id };
      if (noPeriodo(l.dataPagamento || l.competencia, de, ate)) cheques.emitidos.push(item);
      if (noPeriodo(ch.compensacao || l.dataPagamento || l.competencia, de, ate)) cheques.compensados.push({ ...item, tipo: "emitido" });
    }
  }

  // --- Orçamentos do período ---
  const orcs = (orcamentos || []).filter((o) => !o.excluido && !o.excluidoEm); // fora os da lixeira
  const orcamentosDia = {
    criados: orcs.filter((o) => noPeriodo(o.data, de, ate)),
    convertidos: orcs.filter((o) => o.status === "fechado" && noPeriodo(dataSP(o.fechadoEm || ""), de, ate)),
    perdidos: orcs.filter((o) => o.status === "perdido" && noPeriodo(dataSP(o.perdidoEm || ""), de, ate)),
  };

  // --- Resultado (controle interno): vendas − custo das vendas, pelo DRE de cada mês do período ---
  let receitaDre = 0, cmv = 0;
  for (const m of meses(de, ate)) {
    const d = montarDRE(lista, cfg, m, { jaNormalizado: true, deDia: m === de.slice(0, 7) ? Number(de.slice(8, 10)) : null, ateDia: m === ate.slice(0, 7) ? Number(ate.slice(8, 10)) : null });
    receitaDre += centavos(d.valores.receitaBruta);
    cmv += centavos(d.info.cmvOrigem.total);
  }

  // --- Lista detalhada (ordem de hora) ---
  const linha = (l, estornado = false) => {
    const entrada = naturezaDaConta(l.conta) === "entrada" || RECEITA.includes(l.conta) || l.conta === "recebimento";
    const tipo = l.conta === "recebimento" ? "Recebimento de fiado" : l.conta === "transferencia" ? "Transferência" : RECEITA.includes(l.conta) ? "Venda" : contaPorId[l.conta]?.nome || l.conta;
    const forma = Array.isArray(l.pagamentos) ? l.pagamentos.map((p) => `${NOME_FORMA[p.forma] || p.forma}${p.parcelas ? ` ${p.parcelas}x` : ""}`).join(" + ")
      : l.conta === "transferencia" ? `${NOMES_CONTAS[l.de]} → ${NOMES_CONTAS[l.para]}` : NOME_PAGO[l.pagoCom] || "";
    const fiado = (l.pagamentos || []).some((p) => p.forma === "fiado") || l.conta === "recebimento";
    return {
      id: l.id, hora: l.criadoEm || "", numero: l.numero || "", descricao: l.description || "", cliente: l.cliente || l.fornecedor || "", tipo, forma,
      entrada: l.conta === "transferencia" ? null : entrada ? Number(l.value) : null, saida: l.conta === "transferencia" ? null : entrada ? null : Number(l.value),
      transferencia: l.conta === "transferencia" ? Number(l.value) : null,
      venda: l.conta === "venda_produtos", fiado, estornado,
    };
  };
  // (normalizar tira os excluídos; aqui eles entram de propósito, só para a lista)
  const estornadosPeriodo = normalizar((estornados || []).map((l) => ({ ...l, excluido: false })), cfg).filter((l) => noPeriodo(l.competencia, de, ate));
  const detalhada = [...doPeriodo.filter((l) => !["fiado_anterior", "cheque_anterior"].includes(l.conta)).map((l) => linha(l)), ...estornadosPeriodo.map((l) => linha(l, true))]
    .sort((a, b) => String(a.hora).localeCompare(String(b.hora)) || String(a.id).localeCompare(String(b.id)));

  const R = reais;
  return {
    de, ate,
    quadros: {
      vendido: R(vendido), pedidos: pedidos.length, ticketMedio: pedidos.length ? R(pedidos.reduce((s, l) => s + centavos(l.value), 0) / pedidos.length) : 0,
      entrou: R(entrou), saiu: R(saiu), saldo: R(entrou - saiu), fiadoVendido: R(fiadoVendido), recebidoFiado: R(recebido), recebidoAnterior: R(recebidoAnterior),
    },
    entradas: {
      formas: Object.values(porForma).sort((a, b) => ORDEM_FORMAS.indexOf(a.forma) - ORDEM_FORMAS.indexOf(b.forma) || (a.parcelas || 0) - (b.parcelas || 0))
        .map((f) => ({ ...f, nome: NOME_FORMA[f.forma] + (f.parcelas ? ` ${f.parcelas}x` : ""), valor: R(f.valor), naoEntraNoCaixa: f.forma === "fiado" })),
      recebimentos: Object.values(recPorForma).sort((a, b) => ORDEM_FORMAS.indexOf(a.forma) - ORDEM_FORMAS.indexOf(b.forma))
        .map((f) => ({ ...f, nome: NOME_FORMA[f.forma] || f.forma, valor: R(f.valor), anterior: R(f.anterior) })),
      outras: outrasEntradas.map((l) => ({ id: l.id, descricao: l.description || contaPorId[l.conta]?.nome, conta: contaPorId[l.conta]?.nome, valor: Number(l.value) })),
      freteCobrado: R(freteCobrado),
      totalVendas: R(vendido), totalRecebimentos: R(recebido), total: R(vendido + recebido),
      totalOutras: R(outrasEntradas.reduce((s, l) => s + centavos(l.value), 0)),
    },
    saidas: {
      grupos: Object.values(gruposSaida).sort((a, b) => ORDEM_GRUPOS.indexOf(a.grupo) - ORDEM_GRUPOS.indexOf(b.grupo)).map((g) => ({ ...g, total: R(g.total) })),
      total: R(saidas.reduce((s, l) => s + centavos(l.value), 0)),
    },
    contas: { porConta, total: totalContas, gaveta, inicioNaAbertura, abertura: ab?.data || null },
    cheques,
    orcamentos: orcamentosDia,
    resultado: { vendas: R(receitaDre), cmv: R(cmv), lucroBruto: R(receitaDre - cmv), margemPct: receitaDre ? (receitaDre - cmv) / receitaDre : null },
    detalhada,
  };
}
