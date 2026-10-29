// Impressão de pedidos e orçamentos em vias (loja e cliente) numa folha A4. Funções puras: montam o
// documento a partir da venda ou do orçamento e o HTML da folha. Nunca entra nada de controle interno
// (custo, margem, tabela, % de variação, motivo, conta corrente, alertas, saldo devedor).

const arred = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const centavos = (v) => Math.round(Number(v || 0) * 100);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const moeda = (v) => "R$ " + (Number(v) || 0).toFixed(2).replace("-", "−").replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const dataBR = (d) => (d ? String(d).slice(0, 10).split("-").reverse().join("/") : "");
const numBR = (v, casas) => Number(v).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
const ACABAMENTO = { BRUTO: "Bruto", CEPILHADO: "Cepilhado" };

// Forma de pagamento em termos simples
export function nomeForma(p) {
  switch (p.forma) {
    case "dinheiro": return "Dinheiro";
    case "pix_bradesco": case "pix_picpay": return "PIX";
    case "transferencia": return "Transferência";
    case "debito": return "Cartão de débito";
    case "credito": return "Cartão de crédito";
    case "credito_parcelado": return `Crédito em ${Number(p.parcelas) || 2} vezes`;
    case "cheque": return "Cheque";
    case "fiado": return "A prazo";
    default: return "Outra";
  }
}

// Quantidade como o cliente entende: peças × comprimento, m², peças…
function quantidadeTexto(i) {
  if (i.quantidadeTexto) return String(i.quantidadeTexto);
  if (i.unidade === "un" || i.quantidadeCobrada == null) return "";
  const q = Number(i.quantidadeCobrada);
  if (i.comprimento && i.quantidade) return `${i.quantidade} pç × ${numBR(i.comprimento, 2)} m = ${numBR(q, 2)} m`;
  if (i.unidade === "m²") return `${numBR(q, 2)} m²`;
  if (i.unidade === "m") return `${numBR(q, 2)} m`;
  const plural = { peça: "peças", chapa: "chapas", jogo: "jogos", "meio jogo": "meios jogos", saco: "sacos" };
  return `${numBR(q, 0)} ${q > 1 ? plural[i.unidade] || i.unidade : i.unidade}`;
}

/**
 * Linhas impressas: preço unitário final com 2 casas e total = quantidade × unitário. A diferença de
 * centavos (arredondamento, total editado, %) vai na última linha, para a soma fechar com o total dos itens.
 */
export function linhasImpressas(itens, totalItens) {
  const linhas = (itens || []).map((i) => {
    const acab = ACABAMENTO[i.acabamento] || "";
    // a descrição antiga do orçamento já traz "(cepilhado)": o acabamento vai na coluna própria
    const descricao = String(i.descricao || "").replace(/\s*\((bruto|cepilhado)\)\s*$/i, "");
    const q = Number(i.quantidadeCobrada);
    const livre = i.unidade === "un" || !(q > 0) || i.vendaTotal == null;
    const unit = livre ? null : arred(Number(i.vendaTotal) / q);
    return { descricao, acabamento: acab, quantidade: livre ? "" : quantidadeTexto(i), unitario: unit, total: livre ? arred(i.vendaTotal || 0) : arred(q * unit) };
  });
  if (linhas.length && totalItens != null) {
    const dif = centavos(totalItens) - linhas.reduce((s, l) => s + centavos(l.total), 0);
    if (dif) linhas[linhas.length - 1].total = (centavos(linhas[linhas.length - 1].total) + dif) / 100;
  }
  return linhas;
}

/** Documento de uma venda (lançamento v2). */
export function documentoDaVenda(l, { agora = null } = {}) {
  const frete = Number(l.frete) || 0;
  const total = Number(l.value) || 0;
  const itens = Array.isArray(l.itens) && l.itens.length ? l.itens : null;
  const linhas = itens
    ? linhasImpressas(itens, arred(total - frete))
    : [{ descricao: String(l.description || "Venda").replace(/^Venda:\s*/, ""), acabamento: "", quantidade: "", unitario: null, total: arred(total - frete) }];
  const hora = l.criadoEm ? new Date(l.criadoEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }) : "";
  return {
    tipo: "pedido",
    numero: l.numero || null,
    data: l.competencia, hora,
    cliente: { nome: l.cliente || "Consumidor", telefone: l.clienteTelefone || "" },
    linhas, frete, total,
    pagamentos: (l.pagamentos || []).map((p) => ({ texto: nomeForma(p), valor: Number(p.valor) || 0 })),
    refOrcamento: l.orcamento || null,
    obs: l.obs || "",
    nfe: l.nfe || "",
    estornado: Boolean(l.excluido),
    segundaImpressao: l.impressoEm ? (agora || new Date().toISOString()).slice(0, 10) : null,
  };
}

/** Documento de um orçamento. */
export function documentoDoOrcamento(o) {
  const frete = Number(o.frete) || 0;
  const total = Number(o.total) || 0;
  return {
    tipo: "orcamento",
    numero: o.id,
    data: o.data, validoAte: o.validoAte,
    cliente: { nome: o.cliente?.nome || "Consumidor", telefone: o.cliente?.telefone || "" },
    linhas: linhasImpressas(o.itens, arred(total - frete)),
    frete, total,
    obs: o.obs || "",
  };
}

/** Cabeçalho da loja (Ajustes › Impressão). */
export function lojaDaConfig(cfg) {
  const i = cfg?.impressao || {};
  return { nome: i.nome || "Madeireira", telefone: i.telefone || "", endereco: i.endereco || "", cnpj: i.cnpj || "" };
}

function umaVia(doc, loja, qual) {
  const pedido = doc.tipo === "pedido";
  const titulo = pedido ? (doc.numero ? `PEDIDO Nº ${esc(doc.numero)}` : "PEDIDO (rascunho, ainda não registrado)") : `ORÇAMENTO Nº ${esc(doc.numero)}`;
  const quando = pedido
    ? `${dataBR(doc.data)}${doc.hora ? ` às ${esc(doc.hora)}` : ""}`
    : `${dataBR(doc.data)} · <b>Válido até ${dataBR(doc.validoAte)}</b>`;
  const assinatura = qual === "loja" ? "Assinatura do cliente" : "Assinatura da loja";
  const extras = [doc.refOrcamento ? `Ref. orçamento ${esc(doc.refOrcamento)}` : "", doc.nfe ? `NF-e ${esc(doc.nfe)}` : "", doc.obs ? `Obs.: ${esc(doc.obs)}` : ""].filter(Boolean).join(" · ");
  return `<section class="pv-via">
    <div class="pv-topo"><div class="pv-loja"><strong>${esc(loja.nome)}</strong>${[loja.telefone, loja.endereco, loja.cnpj ? `CNPJ ${loja.cnpj}` : ""].filter(Boolean).map((t) => `<span>${esc(t)}</span>`).join("")}</div>
      <div class="pv-qual">${qual === "loja" ? "VIA DA LOJA" : "VIA DO CLIENTE"}</div></div>
    <div class="pv-titulo"><h1>${titulo}</h1><span>${quando}</span></div>
    ${doc.segundaImpressao ? `<div class="pv-marca">2ª impressão em ${dataBR(doc.segundaImpressao)}</div>` : ""}
    ${doc.estornado ? '<div class="pv-marca">VENDA ESTORNADA</div>' : ""}
    <div class="pv-cliente">Cliente: <b>${esc(doc.cliente.nome)}</b>${doc.cliente.telefone ? ` · ${esc(doc.cliente.telefone)}` : ""}</div>
    <table>
      <thead><tr><th>Item</th><th>Acabamento</th><th>Quantidade</th><th class="num">Preço unit.</th><th class="num">Total</th></tr></thead>
      <tbody>${doc.linhas.map((l) => `<tr><td>${esc(l.descricao)}</td><td>${esc(l.acabamento)}</td><td>${esc(l.quantidade)}</td>
        <td class="num">${l.unitario == null ? "" : moeda(l.unitario)}</td><td class="num">${moeda(l.total)}</td></tr>`).join("")}</tbody>
      <tfoot>${doc.frete ? `<tr><td colspan="4">Frete / entrega</td><td class="num">${moeda(doc.frete)}</td></tr>` : ""}
        <tr class="pv-total"><td colspan="4">TOTAL</td><td class="num">${moeda(doc.total)}</td></tr></tfoot>
    </table>
    ${pedido ? `<div class="pv-rodape"><div class="pv-pag"><div><b>Forma de pagamento:</b></div>
        ${doc.pagamentos.map((p) => `<div>${esc(p.texto)}: ${moeda(p.valor)}</div>`).join("") || "<div>—</div>"}
        ${extras ? `<div class="pv-extra">${extras}</div>` : ""}</div>
      <div class="pv-assinatura">${assinatura}</div></div>`
    : `${extras ? `<div class="pv-extra">${extras}</div>` : ""}<div class="pv-aviso-orc">Orçamento sujeito à disponibilidade de estoque. Preços válidos até a data acima.</div>`}
  </section>`;
}

/**
 * HTML da folha. modo: "duas" (loja em cima, cliente embaixo), "loja" ou "cliente" (metade de cima).
 * paginaInteira: cada via numa página (pedido grande demais para meia folha).
 */
export function folhaHtml(doc, loja, { modo = "duas", paginaInteira = false } = {}) {
  const vias = modo === "duas" ? ["loja", "cliente"] : [modo];
  const corpo = vias.map((q) => umaVia(doc, loja, q));
  const sep = paginaInteira ? '<div class="pv-quebra"></div>' : '<div class="pv-corte">✂</div>';
  return `<div class="pv-folha${paginaInteira ? " pv-inteira" : ""}">${corpo.join(sep)}</div>`;
}

/** CSS da folha (o mesmo na tela, na impressão e no PDF). */
export const CSS_FOLHA = `
.pv-folha { width: 210mm; background: #fff; color: #111; font-family: Arial, Helvetica, sans-serif; }
.pv-folha * { box-sizing: border-box; }
.pv-via { height: 146mm; padding: 9mm 12mm 6mm; display: flex; flex-direction: column; overflow: hidden; }
.pv-inteira .pv-via { height: auto; min-height: 285mm; overflow: visible; }
.pv-quebra { break-after: page; height: 0; }
.pv-corte { height: 5mm; display: flex; align-items: center; gap: 2mm; padding: 0 6mm; color: #777; font-size: 9pt; }
.pv-corte::after { content: ""; flex: 1; border-top: 1px dashed #999; }
.pv-topo { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #111; padding-bottom: 2mm; }
.pv-loja strong { font-size: 12pt; display: block; }
.pv-loja span { font-size: 8pt; color: #333; display: block; line-height: 1.35; }
.pv-qual { font-size: 10pt; font-weight: 700; letter-spacing: 0.06em; border: 1.5px solid #111; padding: 1.2mm 3mm; white-space: nowrap; }
.pv-titulo { display: flex; justify-content: space-between; align-items: baseline; margin: 3mm 0 1.5mm; }
.pv-titulo h1 { font-size: 14pt; margin: 0; color: #111; }
.pv-titulo span { font-size: 9pt; }
.pv-marca { font-size: 8.5pt; font-weight: 700; border: 1px solid #111; display: inline-block; padding: 0.5mm 2mm; margin-bottom: 1.5mm; align-self: flex-start; }
.pv-cliente { font-size: 9.5pt; margin-bottom: 2mm; }
.pv-folha table { width: 100%; border-collapse: collapse; font-size: 8.8pt; margin: 0; }
.pv-folha th { text-align: left; border-bottom: 1px solid #111; padding: 1mm 1.5mm; font-size: 7.8pt; text-transform: uppercase; letter-spacing: 0.03em; color: #111; background: none; }
.pv-folha td { padding: 1mm 1.5mm; border-bottom: 1px solid #ddd; vertical-align: top; color: #111; background: none; }
.pv-folha .num { text-align: right; white-space: nowrap; }
.pv-folha tfoot td { border-bottom: none; }
.pv-folha tr.pv-total td { border-top: 1.5px solid #111; font-size: 11pt; font-weight: 700; padding-top: 1.5mm; }
.pv-rodape { margin-top: auto; display: flex; justify-content: space-between; align-items: flex-end; gap: 8mm; font-size: 8.5pt; padding-top: 2mm; }
.pv-pag { line-height: 1.45; }
.pv-extra { color: #333; font-size: 8pt; margin-top: 1.5mm; }
.pv-assinatura { width: 62mm; text-align: center; border-top: 1px solid #111; padding-top: 1mm; font-size: 8pt; flex-shrink: 0; }
.pv-aviso-orc { margin-top: auto; font-size: 8.5pt; border-top: 1px solid #ccc; padding-top: 2mm; color: #333; }
`;
