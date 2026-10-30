// Orçamentos: regras puras (telefone, WhatsApp, validade, cores, indicadores, atualizar preços).
import { calcularItem, totalizarPedido, textoWhatsApp, arred } from "./calculo.js";
import { dataSP } from "./datas.js";

export const ORIGENS = { balcao: "Balcão", whatsapp: "WhatsApp", telefone: "Telefone" };
// Só 3 situações. "aguardando" vem de dados antigos e conta como Em aberto.
export const STATUS = { aberto: "Em aberto", aguardando: "Em aberto", fechado: "Fechado", perdido: "Perdido" };
export const LIXEIRA_DIAS = 30;
export const MOTIVOS_PERDA = ["Preço", "Comprou em outro lugar", "Desistiu", "Sem resposta", "Outro"];

export const CONFIG_ORCAMENTOS_PADRAO = {
  validadeDias: 7,
  diasParaCobrar: 3,
  diasAmarelo: 3,
  modelos: [
    "Olá {nome}, tudo bem? Aqui é da Madeireira. Passando para saber se conseguiu ver o orçamento {numero} de {valor}. Qualquer dúvida estou à disposição!",
    "Olá {nome}! O orçamento {numero} ({valor}) vale até {validade}. Quer que eu separe o material?",
  ],
};

export const numeroOrcamento = (n) => `ORC-${String(n).padStart(4, "0")}`;

const DDDS = new Set([11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38, 41, 42, 43, 44, 45, 46, 47, 48, 49,
  51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69, 71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89, 91, 92, 93, 94, 95, 96, 97, 98, 99]);

/** Telefone brasileiro com DDD: aceita (47) 99999-1234, 47999991234, +55 47 99999-1234. */
export function normalizarTelefone(entrada) {
  let d = String(entrada || "").replace(/\D/g, "");
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) d = d.slice(2);
  if (d.length !== 10 && d.length !== 11) return { ok: false, erro: "Informe o WhatsApp com DDD (10 ou 11 dígitos)." };
  const ddd = Number(d.slice(0, 2));
  if (!DDDS.has(ddd)) return { ok: false, erro: `DDD ${d.slice(0, 2)} não existe.` };
  if (d.length === 11 && d[2] !== "9") return { ok: false, erro: "Celular com 11 dígitos deve começar com 9 depois do DDD." };
  const num = d.slice(2);
  const formatado = `(${d.slice(0, 2)}) ${num.length === 9 ? `${num.slice(0, 5)}-${num.slice(5)}` : `${num.slice(0, 4)}-${num.slice(4)}`}`;
  return { ok: true, digitos: d, formatado };
}

export function linkWhatsApp(telefone, texto) {
  const t = normalizarTelefone(telefone);
  if (!t.ok) throw new Error(t.erro);
  return `https://wa.me/55${t.digitos}?text=${encodeURIComponent(texto)}`;
}

const brl = (v) => "R$ " + Number(v || 0).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const dataBR = (d) => (d ? d.split("-").reverse().join("/") : "");

export function somarDias(data, dias) {
  const [a, m, d] = data.split("-").map(Number);
  const r = new Date(Date.UTC(a, m - 1, d + dias));
  return r.toISOString().slice(0, 10);
}

export function diasEntre(de, ate) {
  const [a1, m1, d1] = de.slice(0, 10).split("-").map(Number);
  const [a2, m2, d2] = ate.slice(0, 10).split("-").map(Number);
  return Math.round((Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / 86400000);
}

/** Troca {nome}, {numero}, {valor}, {dias}, {validade} no modelo de mensagem. */
export function preencherModelo(modelo, orc, hoje) {
  const vars = {
    nome: (orc.cliente?.nome || "").split(" ")[0] || "",
    numero: orc.id,
    valor: brl(orc.total),
    dias: String(diasEntre(orc.data, hoje)),
    validade: dataBR(orc.validoAte),
  };
  return String(modelo).replace(/\{(nome|numero|valor|dias|validade)\}/g, (_, k) => vars[k]);
}

/** Texto do orçamento para o cliente: itens e total, sem custo, margem nem preço de tabela. */
export function textoParaCliente(orc) {
  const corpo = textoWhatsApp({
    data: dataBR(orc.data),
    itens: orc.itens.map((i) => ({ descricao: i.descricao, quantidade: i.quantidadeTexto, precoUnitario: i.precoUnitario, unidade: i.unidade, vendaTotal: i.vendaTotal })),
    totalItens: arred(orc.total - (orc.frete || 0)),
    frete: orc.frete || 0,
  }).replace("*Orçamento", `*Orçamento ${orc.id}`);
  return `${corpo}\nVálido até ${dataBR(orc.validoAte)}.`;
}

export const emAbertoStatus = (o) => o.status === "aberto" || o.status === "aguardando";
export const naLixeira = (o) => Boolean(o.excluidoEm);

/** Em aberto / Fechados / Perdidos (as 3 abas da lista). */
export function grupoDaLista(o) {
  return emAbertoStatus(o) ? "aberto" : o.status === "fechado" ? "fechado" : "perdido";
}

/** Na lixeira e ainda dentro dos 30 dias (depois disso some da lista, mas continua guardado). */
export function visivelNaLixeira(o, hoje) {
  return naLixeira(o) && diasEntre(dataSP(o.excluidoEm), hoje) <= LIXEIRA_DIAS;
}

/**
 * Situação para a lista: dias em aberto, sem contato, vencido (só um aviso: continua em aberto)
 * e o 🔔 (em aberto há X dias ou mais sem contato).
 */
export function situacao(orc, hoje, cfg = CONFIG_ORCAMENTOS_PADRAO) {
  const emAberto = emAbertoStatus(orc) && !naLixeira(orc);
  const ultimo = orc.ultimoContato ? dataSP(orc.ultimoContato) : orc.data; // contato às 22h conta no dia dele
  const diasAberto = diasEntre(orc.data, hoje);
  const diasSemContato = diasEntre(ultimo, hoje);
  const vencido = hoje > orc.validoAte;
  const cor = emAberto && vencido ? "vermelho" : null;
  return { emAberto, diasAberto, diasSemContato, vencido, cor, cobrarHoje: emAberto && diasSemContato >= cfg.diasParaCobrar };
}

/** Indicadores. Excluídos (lixeira) não contam: foram erro ou teste. */
export function indicadores(todos, mes) {
  const orcs = todos.filter((o) => !naLixeira(o));
  const doMes = orcs.filter((o) => o.data.slice(0, 7) === mes);
  const fechadosMes = doMes.filter((o) => o.status === "fechado");
  const fechados = orcs.filter((o) => o.status === "fechado" && o.fechadoEm);
  const motivos = {};
  for (const o of orcs.filter((x) => x.status === "perdido")) motivos[o.motivoPerda || "Outro"] = (motivos[o.motivoPerda || "Outro"] || 0) + 1;
  const porOrigem = {};
  for (const o of doMes) porOrigem[o.origem] = (porOrigem[o.origem] || 0) + 1;
  return {
    valorAberto: arred(orcs.filter(emAbertoStatus).reduce((s, o) => s + o.total, 0)),
    qtdAberto: orcs.filter(emAbertoStatus).length,
    taxaConversaoMes: doMes.length ? fechadosMes.length / doMes.length : null,
    tempoMedioFechar: fechados.length ? fechados.reduce((s, o) => s + diasEntre(o.data, o.fechadoEm), 0) / fechados.length : null,
    motivosPerda: motivos,
    porOrigem,
    totalMes: doMes.length,
  };
}

export function ordenar(orcs, modo, hoje) {
  const lista = [...orcs];
  if (modo === "valor") return lista.sort((a, b) => b.total - a.total);
  // Padrão: em aberto primeiro, do mais antigo para o mais novo; depois os demais, mais recentes primeiro
  const aberto = emAbertoStatus;
  return lista.sort((a, b) => (aberto(b) - aberto(a)) || (aberto(a) ? a.data.localeCompare(b.data) || a.numero - b.numero : b.data.localeCompare(a.data) || b.numero - a.numero));
}

/**
 * Recalcula um orçamento pela tabela e pelos custos atuais, mantendo o % aplicado em cada item.
 * Itens sem preço de tabela mantêm o preço digitado. Devolve os itens novos e as diferenças.
 * @param {object} orc
 * @param {(itemId) => object} itemDoCatalogo
 * @param {(itemId, acabamento) => number|null} precoDaTabela
 */
export function atualizarPrecos(orc, itemDoCatalogo, precoDaTabela) {
  const itens = orc.itens.map((i) => {
    const item = itemDoCatalogo(i.itemId);
    if (!item) return { ...i, aviso: "item não existe mais no catálogo" };
    const tabela = precoDaTabela(i.itemId, i.acabamento);
    const base = { item, acabamento: i.acabamento, quantidade: i.quantidade, comprimento: i.comprimento, descricao: i.descricaoLivre };
    let r;
    if (item.unidade === "valor_livre") r = calcularItem({ ...base, totalManual: i.vendaTotal });
    else if (tabela != null) r = calcularItem({ ...base, precoTabela: tabela, variacaoPct: i.variacaoPct ? arred(i.variacaoPct) : null });
    else r = calcularItem({ ...base, precoManual: i.precoUnitario });
    return { ...i, precoTabela: r.precoTabela, tabelaTotal: r.tabelaTotal, precoUnitario: r.precoUnitario, vendaTotal: r.vendaTotal, custoTotal: r.custoTotal, variacaoPct: r.variacaoPct, diferenca: arred((r.vendaTotal || 0) - (i.vendaTotal || 0)) };
  });
  const t = totalizarPedido(itens.map((i) => ({ custoTotal: i.custoTotal, vendaTotal: i.vendaTotal, tabelaTotal: i.tabelaTotal })));
  // O frete não depende da tabela: continua o mesmo e soma no total
  const frete = orc.frete || 0;
  const totalNovo = arred(t.venda + frete);
  return { itens, frete, totalAntigo: orc.total, totalNovo, diferenca: arred(totalNovo - orc.total), custo: t.custo, margem: t.margem };
}
