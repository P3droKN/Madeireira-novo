// Plano de contas, contas financeiras, formas de pagamento e configuração financeira padrão.
// Sistema gerencial (controle interno): não substitui a contabilidade do escritório.

// natureza: "entrada" ou "saida". dre/caixa: se entra no DRE e no fluxo de caixa.
export const GRUPOS = [
  { id: "receita", nome: "Receita", natureza: "entrada", dre: true, caixa: true },
  { id: "deducoes", nome: "Deduções", natureza: "saida", dre: true, caixa: true },
  { id: "cmv", nome: "CMV", natureza: "saida", dre: true, caixa: false },
  { id: "compras", nome: "Compras / estoque", natureza: "saida", dre: false, caixa: true },
  { id: "variaveis", nome: "Despesas variáveis de venda", natureza: "saida", dre: true, caixa: true },
  { id: "pessoal", nome: "Pessoal", natureza: "saida", dre: true, caixa: true },
  { id: "fixas", nome: "Despesas fixas / administrativas", natureza: "saida", dre: true, caixa: true },
  { id: "operacionais", nome: "Operacionais", natureza: "saida", dre: true, caixa: true },
  { id: "financeiras", nome: "Financeiras", natureza: "saida", dre: true, caixa: true },
  { id: "investimentos", nome: "Investimentos", natureza: "saida", dre: false, caixa: true },
  { id: "socios", nome: "Sócios", natureza: "saida", dre: false, caixa: true },
  { id: "classificar", nome: "A classificar", natureza: "saida", dre: true, caixa: true },
];

// Contas. Campos opcionais sobrescrevem o grupo (ex.: rendimentos é entrada; 13º pago não entra no DRE).
export const CONTAS = [
  { id: "venda_produtos", grupo: "receita", nome: "Venda de produtos" },
  { id: "frete_cobrado", grupo: "receita", nome: "Frete cobrado do cliente" },
  { id: "servicos", grupo: "receita", nome: "Serviços (corte, cepilhamento)" },

  { id: "das", grupo: "deducoes", nome: "Impostos (DAS)" },
  { id: "descontos", grupo: "deducoes", nome: "Descontos concedidos" },
  { id: "devolucoes", grupo: "deducoes", nome: "Devoluções" },

  { id: "cmv", grupo: "cmv", nome: "Custo da mercadoria vendida (CMV)" },

  { id: "compra_material", grupo: "compras", nome: "Compra de madeira e materiais" },
  { id: "frete_compras", grupo: "compras", nome: "Frete sobre compras" },

  { id: "taxa_cartao", grupo: "variaveis", nome: "Taxa de maquininha/cartão" },
  { id: "frete_entrega", grupo: "variaveis", nome: "Frete de entrega (caminhão/terceiro)" },
  { id: "comissoes", grupo: "variaveis", nome: "Comissões" },

  { id: "salarios", grupo: "pessoal", nome: "Salários" },
  { id: "fgts", grupo: "pessoal", nome: "FGTS" },
  { id: "vale", grupo: "pessoal", nome: "Vale-transporte / alimentação" },
  { id: "rescisoes", grupo: "pessoal", nome: "Rescisões" },
  { id: "decimo_ferias_pagos", grupo: "pessoal", nome: "13º e férias pagos", dreSeProvisao: false },

  { id: "pro_labore", grupo: "fixas", nome: "Pró-labore" },
  { id: "aluguel", grupo: "fixas", nome: "Aluguel" },
  { id: "energia", grupo: "fixas", nome: "Energia" },
  { id: "agua", grupo: "fixas", nome: "Água" },
  { id: "telefone", grupo: "fixas", nome: "Telefone / internet" },
  { id: "contador", grupo: "fixas", nome: "Contador" },
  { id: "sistemas", grupo: "fixas", nome: "Sistemas" },
  { id: "seguros", grupo: "fixas", nome: "Seguros" },
  { id: "escritorio", grupo: "fixas", nome: "Material de escritório" },

  { id: "combustivel", grupo: "operacionais", nome: "Combustível" },
  { id: "manut_veiculos", grupo: "operacionais", nome: "Manutenção de veículos" },
  { id: "manut_maquinas", grupo: "operacionais", nome: "Manutenção de máquinas (serra, plaina)" },
  { id: "ferramentas", grupo: "operacionais", nome: "Ferramentas e lâminas" },

  { id: "tarifas", grupo: "financeiras", nome: "Tarifas bancárias" },
  { id: "juros", grupo: "financeiras", nome: "Juros" },
  { id: "antecipacao", grupo: "financeiras", nome: "Desconto/antecipação de cheque e cartão" },
  { id: "rendimentos", grupo: "financeiras", nome: "Receita de rendimentos", natureza: "entrada" },

  { id: "investimento", grupo: "investimentos", nome: "Compra de máquina, veículo, reforma" },

  { id: "retirada", grupo: "socios", nome: "Retirada do dono (além do pró-labore)" },
  { id: "aporte", grupo: "socios", nome: "Aporte do dono", natureza: "entrada" },

  { id: "classificar_custo", grupo: "classificar", nome: "A classificar: compra ou CMV?", dre: false },
  { id: "classificar_despesa", grupo: "classificar", nome: "Despesa geral (a classificar)" },
];

export const contaPorId = Object.fromEntries(CONTAS.map((c) => [c.id, c]));
export const grupoPorId = Object.fromEntries(GRUPOS.map((g) => [g.id, g]));

export function naturezaDaConta(id) {
  const c = contaPorId[id];
  if (!c) return null;
  return c.natureza || grupoPorId[c.grupo].natureza;
}

// Contas financeiras (onde o dinheiro está)
export const CONTAS_FINANCEIRAS_PADRAO = [
  { id: "gaveta", nome: "Gaveta (dinheiro)" },
  { id: "bradesco", nome: "Bradesco" },
  { id: "picpay", nome: "PicPay" },
  { id: "cheques_carteira", nome: "Cheques em carteira" },
];

// Formas de recebimento: conta de destino e código tPag da NF-e (editáveis na config)
export const FORMAS_PADRAO = [
  { id: "dinheiro", nome: "Dinheiro", conta: "gaveta", tPag: "01" },
  { id: "pix_bradesco", nome: "PIX Bradesco", conta: "bradesco", tPag: "20" },
  { id: "pix_picpay", nome: "PIX PicPay", conta: "picpay", tPag: "17" },
  { id: "transferencia", nome: "Transferência/TED Bradesco", conta: "bradesco", tPag: "18" },
  { id: "debito", nome: "Débito (maquininha)", conta: "picpay", tPag: "04", cartao: "debito" },
  { id: "credito", nome: "Crédito à vista", conta: "picpay", tPag: "03", cartao: "credito" },
  { id: "credito_parcelado", nome: "Crédito parcelado", conta: "picpay", tPag: "03", cartao: "parcelado" },
  { id: "cheque", nome: "Cheque", conta: "cheques_carteira", tPag: "02" },
  { id: "nao_informada", nome: "Forma não informada (dados antigos)", conta: null, tPag: "99", soMigracao: true },
];

// "Pago com" das saídas
export const PAGO_COM = [
  { id: "gaveta", nome: "Gaveta" },
  { id: "bradesco", nome: "Bradesco" },
  { id: "picpay", nome: "PicPay" },
  { id: "cheque_emitido", nome: "Cheque emitido" },
];

export const CONFIG_FINANCEIRO_PADRAO = {
  formas: Object.fromEntries(FORMAS_PADRAO.map((f) => [f.id, { conta: f.conta, tPag: f.tPag }])),
  cartao: {
    debito: { taxaPct: 0, prazoDias: 1 },
    credito: { taxaPct: 0, prazoDias: 30 },
    // taxa por número de parcelas (2 a 12); cada parcela cai a cada 30 dias
    parcelado: { taxaPctPorParcelas: Object.fromEntries([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => [n, 0])), prazoDias: 30 },
  },
  cmv: { margemPadraoPct: 30, mesesMedia: 3 },
  pessoal: { provisao13FeriasLigada: true, provisaoPct: 19.44, fgtsPct: 8, estimarFgts: true },
  impostos: {
    regime: "simples_nacional",
    estimarSimples: false,
    rbt12: null,
    // Anexo I (comércio): até, alíquota nominal %, parcela a deduzir
    tabelaSimples: [
      [180000, 4.0, 0],
      [360000, 7.3, 5940],
      [720000, 9.5, 13860],
      [1800000, 10.7, 22500],
      [3600000, 14.3, 87300],
      [4800000, 19.0, 378000],
    ],
  },
  depreciacaoLigada: false,
  estoque: { inicial: 0, dataInicial: null, porItem: false },
};

const ehObj = (v) => v && typeof v === "object" && !Array.isArray(v);
function mesclar(base, extra) {
  if (!ehObj(extra)) return structuredClone(base);
  const r = structuredClone(base);
  for (const [k, v] of Object.entries(extra)) r[k] = ehObj(v) && ehObj(base[k]) ? mesclar(base[k], v) : v;
  return r;
}

export const mesclarConfigFinanceiro = (salva) => mesclar(CONFIG_FINANCEIRO_PADRAO, salva);
