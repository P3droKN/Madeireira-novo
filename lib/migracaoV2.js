// Conversão dos lançamentos do formato antigo (v1) para o novo (v2), sem perder campos.
// Os campos antigos (category, type, value, date, method, check*) continuam no lançamento.

// Venda: método antigo -> forma nova
export const FORMA_DO_METODO = {
  pix: "pix_bradesco", // vendas por WhatsApp sempre foram PIX no Bradesco
  bradesco: "transferencia",
  debito: "debito",
  credito: "credito",
  dinheiro: "dinheiro",
  cheque: "cheque",
};

// Saída: método antigo -> "Pago com"
export const PAGO_COM_DO_METODO = {
  dinheiro: "gaveta",
  bradesco: "bradesco",
  pix: "bradesco",
  cheque: "cheque_emitido",
  debito: "picpay",
  credito: "picpay",
};

const CONTA_DA_CATEGORIA = {
  venda: "venda_produtos",
  custo: "classificar_custo",
  despesa: "classificar_despesa",
  funcionario: "salarios",
};

const arred = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;

// Sugestão para custos antigos: o par "Venda + Custo juntos" tinha o mesmo número com V e C.
export function sugestaoCusto(item, idsVenda) {
  const desc = String(item.description || "");
  const id = String(item.id || "");
  if (id.endsWith("C") && idsVenda.has(id.slice(0, -1) + "V")) {
    return { conta: "cmv", vendaId: id.slice(0, -1) + "V", motivo: "lançado junto com a venda (Venda e Custo Juntos)" };
  }
  if (desc.startsWith("Custo Extraído (Apenas Material)")) return { conta: "compra_material", motivo: "lançado como 'apenas custo' na calculadora" };
  if (desc.startsWith("Custo Extraído:")) return { conta: "cmv", motivo: "custo extraído de uma venda" };
  return null;
}

// Sugestão para despesas antigas: guia de imposto ou de FGTS. A guia paga num mês é do mês anterior
// (DAS e FGTS vencem no mês seguinte), então a sugestão leva a competência para o último dia do mês
// anterior; o caixa continua na data do pagamento. Assim ela substitui a estimativa do mês certo.
const semAcento = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
function fimDoMesAnterior(data) {
  const [a, m] = String(data).slice(0, 7).split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, 0)).toISOString().slice(0, 10);
}
export function sugestaoDespesa(item) {
  const desc = semAcento(item.description);
  const data = item.competencia || item.date;
  if (!desc || !data) return null;
  const comp = fimDoMesAnterior(data);
  const ref = comp.slice(0, 7).split("-").reverse().join("/");
  if (/\bfgts\b/.test(desc)) return { conta: "fgts", competencia: comp, motivo: `descrição fala em FGTS: guia de ${ref}` };
  if (/\b(das|simples|impostos?|guia)\b/.test(desc)) return { conta: "das", competencia: comp, motivo: `descrição fala em DAS/imposto: guia de ${ref}` };
  return null;
}

/** Sugestão de um lançamento a classificar: a gravada (custos) ou a das despesas (DAS/FGTS), calculada na hora. */
export function sugestaoDe(l) {
  if (!l?.classificar) return null;
  if (l.sugestao) return l.sugestao;
  return l.conta === "classificar_despesa" ? sugestaoDespesa(l) : null;
}

/**
 * Converte um lançamento v1 em v2. Lançamentos já v2 voltam iguais.
 * @param {object} item
 * @param {object} formas config.formas (forma -> {conta, tPag})
 * @param {Set<string>} idsVenda ids das vendas (para sugerir o par custo/venda)
 */
export function converterLancamento(item, formas, idsVenda = new Set()) {
  if (item.v === 2) return item;
  const categoria = item.category || (item.type === "income" ? "venda" : "despesa");
  const novo = {
    ...item,
    v: 2,
    migrado: true,
    conta: CONTA_DA_CATEGORIA[categoria] || "classificar_despesa",
    competencia: item.date,
  };
  if (categoria === "venda") {
    const forma = FORMA_DO_METODO[item.method] || "nao_informada";
    const pag = { forma, conta: formas[forma]?.conta ?? null, valor: arred(item.value), tPag: formas[forma]?.tPag ?? "99" };
    if (forma === "cheque") {
      pag.cheque = { numero: item.checkNumber || "", emissor: item.checkIssuer || "", banco: "", compensacao: item.checkDate || item.date };
    }
    novo.pagamentos = [pag];
  } else {
    novo.pagoCom = PAGO_COM_DO_METODO[item.method] || "bradesco";
    novo.dataPagamento = item.date;
    if (novo.pagoCom === "cheque_emitido") {
      novo.chequeEmitido = { numero: item.checkNumber || "", favorecido: item.checkIssuer || "", compensacao: item.checkDate || item.date, conta: "bradesco" };
    }
    if (novo.conta === "classificar_custo") {
      novo.classificar = true;
      const s = sugestaoCusto(item, idsVenda);
      if (s) novo.sugestao = s;
    }
    if (novo.conta === "classificar_despesa") novo.classificar = true;
  }
  return novo;
}

/**
 * O "acumulado" manual de 01 a 23/08/2026 vira lançamentos de abertura datados.
 * Entram no DRE (competência agosto) e não mexem no caixa (abertura: true).
 * A gaveta (dinheiroCaixa) não vira lançamento: fica para a tela "Abertura de saldos".
 */
export function lancamentosDeAbertura(acumulado, data = "2026-08-23") {
  if (!acumulado) return [];
  const a = Object.fromEntries(Object.entries(acumulado).map(([k, v]) => [k, arred(v || 0)]));
  const base = { v: 2, abertura: true, migrado: true, date: data, competencia: data, description: "Abertura: acumulado de 01 a 23/08/2026" };
  const lista = [];
  const venda = (id, forma, valor) => valor > 0 && lista.push({
    ...base, id: `abertura-${id}`, category: "venda", type: "income", value: valor, method: "", conta: "venda_produtos",
    pagamentos: [{ forma, conta: null, valor, tPag: forma === "pix_bradesco" ? "20" : forma === "credito" ? "03" : forma === "debito" ? "04" : "99" }],
  });
  venda("venda-pix", "pix_bradesco", a.pix);
  venda("venda-credito", "credito", a.credito);
  venda("venda-debito", "debito", a.debito);
  venda("venda-outras", "nao_informada", arred(a.venda - a.pix - a.credito - a.debito));
  const saida = (id, categoria, conta, valor, extra = {}) => valor > 0 && lista.push({
    ...base, id: `abertura-${id}`, category: categoria, type: "expense", value: valor, method: "", conta, pagoCom: null, ...extra,
  });
  saida("custo", "custo", "classificar_custo", a.custo, { classificar: true });
  saida("despesa", "despesa", "classificar_despesa", a.despesa, { classificar: true });
  saida("funcionarios", "funcionario", "salarios", a.func);
  return lista;
}

// Categoria antiga equivalente (a tela antiga do caixa continua funcionando até a Fase 2D)
export function categoriaLegada(conta) {
  if (conta === "venda_produtos" || conta === "frete_cobrado" || conta === "servicos" || conta === "rendimentos" || conta === "aporte") return "venda";
  if (conta === "salarios" || conta === "fgts" || conta === "vale" || conta === "rescisoes" || conta === "decimo_ferias_pagos") return "funcionario";
  if (conta === "compra_material" || conta === "frete_compras" || conta === "cmv" || conta === "classificar_custo") return "custo";
  return "despesa";
}
