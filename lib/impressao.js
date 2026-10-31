// Impressão de pedidos e orçamentos em vias (loja e cliente) numa folha A4. Funções puras: montam o
// documento a partir da venda ou do orçamento e o HTML da folha. Nunca entra nada de controle interno
// (custo, margem, tabela, % de variação, motivo, conta corrente, alertas, saldo devedor).
import { dataSP } from "./datas.js";

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

// Quantidade como o cliente entende: peças × comprimento, m², peças… (texto corrido, para a tela)
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

// Colunas Quant. e Unid. da via (como no cartão da loja)
const UNID = { peça: "pç", m: "m", "m²": "m²", chapa: "ch", jogo: "jg", "meio jogo": "½ jg", saco: "sc", un: "un" };
const quantNum = (q) => (Number.isInteger(q) ? numBR(q, 0) : numBR(q, 2));

/**
 * Linhas impressas: preço unitário final com 2 casas e total = quantidade × unitário. A diferença de
 * centavos (arredondamento, total editado, %) vai na última linha, para a soma fechar com o total dos itens.
 */
export function linhasImpressas(itens, totalItens) {
  const linhas = (itens || []).map((i) => {
    const acab = ACABAMENTO[i.acabamento] || "";
    // a descrição antiga do orçamento já traz "(cepilhado)": o acabamento vai na coluna própria
    let descricao = String(i.descricao || "").replace(/\s*\((bruto|cepilhado)\)\s*$/i, "");
    const q = Number(i.quantidadeCobrada);
    const livre = i.unidade === "un" || !(q > 0) || i.vendaTotal == null;
    const unit = livre ? null : arred(Number(i.vendaTotal) / q);
    // Vendido por metro em peças: "Cedro 1x2 (6 pç de 2,50 m)", 15 m
    if (!livre && i.comprimento && i.quantidade) descricao += ` (${i.quantidade} pç de ${numBR(i.comprimento, 2)} m)`;
    return {
      descricao, acabamento: acab, cep: i.acabamento === "CEPILHADO",
      quantidade: livre ? "" : quantidadeTexto(i),
      quant: q > 0 ? quantNum(q) : "", unid: q > 0 ? UNID[i.unidade] || String(i.unidade || "") : "",
      unitario: unit, total: livre ? arred(i.vendaTotal || 0) : arred(q * unit),
    };
  });
  if (linhas.length && totalItens != null) {
    const dif = centavos(totalItens) - linhas.reduce((s, l) => s + centavos(l.total), 0);
    if (dif) linhas[linhas.length - 1].total = (centavos(linhas[linhas.length - 1].total) + dif) / 100;
  }
  return linhas;
}

/** Documento de uma venda (lançamento v2). */
// Cliente na via: nome e, do cadastro, endereço, telefone e documentos (em branco o que não tiver)
function clienteDaVia(nome, telefone, cad) {
  const c = cad || {};
  return {
    nome: nome || c.nome || "Consumidor",
    endereco: c.endereco || "", bairro: c.bairro || "", cidade: c.cidade || "", uf: c.uf || "",
    fone: [telefone || c.telefone, c.fixo].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(" / "),
    documento: c.documento || "", ie: c.ie || "",
  };
}

export function documentoDaVenda(l, { agora = null, cadastro = null } = {}) {
  const frete = Number(l.frete) || 0;
  const total = Number(l.value) || 0;
  const itens = Array.isArray(l.itens) && l.itens.length ? l.itens : null;
  const linhas = itens
    ? linhasImpressas(itens, arred(total - frete))
    : [{ descricao: String(l.description || "Venda").replace(/^Venda:\s*/, ""), acabamento: "", cep: false, quantidade: "", quant: "", unid: "", unitario: null, total: arred(total - frete) }];
  const hora = l.criadoEm ? new Date(l.criadoEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }) : "";
  return {
    tipo: "pedido",
    numero: l.numero || null,
    data: l.competencia, hora,
    cliente: clienteDaVia(l.cliente, l.clienteTelefone, cadastro),
    linhas, frete, total,
    pagamentos: (l.pagamentos || []).map((p) => ({ texto: nomeForma(p), valor: Number(p.valor) || 0 })),
    refOrcamento: l.orcamento || null,
    obs: l.obs || "",
    nfe: l.nfe || "",
    estornado: Boolean(l.excluido),
    segundaImpressao: l.impressoEm ? dataSP(agora || new Date()) : null,
  };
}

/** Documento de um orçamento. */
export function documentoDoOrcamento(o, { cadastro = null } = {}) {
  const frete = Number(o.frete) || 0;
  const total = Number(o.total) || 0;
  return {
    tipo: "orcamento",
    numero: o.id,
    data: o.data, validoAte: o.validoAte,
    cliente: clienteDaVia(o.cliente?.nome, o.cliente?.telefone, cadastro),
    linhas: linhasImpressas(o.itens, arred(total - frete)),
    frete, total,
    obs: o.obs || "",
  };
}

/** Cabeçalho e rodapé da loja (Ajustes › Impressão). */
export function lojaDaConfig(cfg) {
  const i = cfg?.impressao || {};
  const t = (v) => String(v || "").trim();
  return {
    nome: t(i.nome), endereco: t(i.endereco), cidade: t(i.cidade), telefone: t(i.telefone), whatsapp: t(i.whatsapp),
    email: t(i.email), instagram: t(i.instagram), pix: t(i.pix), logo: t(i.logo),
    avisos: t(i.avisos).split("\n").map((x) => x.trim()).filter(Boolean),
  };
}

/** O que falta em Ajustes › Impressão para a via sair completa (o aviso amarelo na janela de impressão). */
export function faltaNaImpressao(loja) {
  const rotulos = { nome: "nome da loja", endereco: "endereço", telefone: "telefone", pix: "linha do Pix" };
  return Object.entries(rotulos).filter(([k]) => !loja[k]).map(([, r]) => r);
}

const LINHAS_CARTAO = 10; // a tabela tem pelo menos 10 linhas, como o bloco de papel
const campo = (rotulo, valor, classe, extra = "") => `<div class="pv-campo ${classe}"><b>${rotulo}</b><span${extra}>${esc(valor)}</span></div>`;
// "MERCADO DA MADEIRA": as palavras pequenas (da, de, do, e) saem menores, como no cartão
const nomeLoja = (n) => esc(n).replace(/ (DA|DE|DO|DAS|DOS|E) /g, " <small>$1</small> ");

function umaVia(doc, loja, qual, { paginaInteira = false } = {}) {
  const pedido = doc.tipo === "pedido";
  const numero = doc.numero ? esc(doc.numero) : "—";
  const c = doc.cliente;
  const marcas = [doc.segundaImpressao ? `2ª impressão em ${dataBR(doc.segundaImpressao)}` : "", doc.estornado ? "VENDA ESTORNADA" : ""].filter(Boolean);
  const contato1 = [loja.telefone ? `☎ <b>${esc(loja.telefone)}</b>` : "", loja.whatsapp ? `✆ <b>${esc(loja.whatsapp)}</b>` : ""].filter(Boolean).join("<br>");
  const contato2 = [loja.email ? `@ ${esc(loja.email)}` : "", loja.instagram ? `◎ ${esc(loja.instagram)}` : ""].filter(Boolean).join("<br>");
  const colunas = [loja.logo ? "auto" : "", "1fr", contato1 ? "auto" : "", contato2 ? "auto" : ""].filter(Boolean).join(" ");
  const vazias = paginaInteira ? 0 : Math.max(0, LINHAS_CARTAO - doc.linhas.length - (doc.frete ? 1 : 0));
  const pagamento = pedido
    ? [doc.pagamentos.length ? `Pagamento: ${doc.pagamentos.map((p) => `${esc(p.texto)} ${moeda(p.valor)}`).join(" · ")}` : "",
      doc.refOrcamento ? `Ref. orçamento ${esc(doc.refOrcamento)}` : "", doc.nfe ? `NF-e ${esc(doc.nfe)}` : ""].filter(Boolean).join(" · ")
    : "";
  return `<section class="pv-via">
    <div class="pv-etiqueta">${qual === "loja" ? "VIA DA LOJA" : "VIA DO CLIENTE"}${marcas.length ? ` · <b>${marcas.join(" · ")}</b>` : ""}</div>
    <div class="pv-caixa">
      <div class="pv-topo" style="grid-template-columns:${colunas}">
        ${loja.logo ? `<img class="pv-logo" src="${esc(loja.logo)}" alt="">` : ""}
        <div class="pv-marca"><strong>${nomeLoja(loja.nome)}</strong>${loja.endereco ? `<span>${esc(loja.endereco)}</span>` : ""}${loja.cidade ? `<span>${esc(loja.cidade)}</span>` : ""}</div>
        ${contato1 ? `<div class="pv-contato">${contato1}</div>` : ""}
        ${contato2 ? `<div class="pv-contato">${contato2}</div>` : ""}
      </div>
      <div class="pv-cliente">
        ${campo("CLIENTE:", c.nome, "c9")}
        <div class="pv-campo c3 pv-num"><b>${pedido ? "PEDIDO Nº" : "ORÇAMENTO Nº"}</b> <strong>${numero}</strong></div>
        ${campo("ENDEREÇO:", c.endereco, "c9")}
        ${campo("DATA:", dataBR(doc.data), "c3")}
        ${campo("BAIRRO:", c.bairro, "c4")}
        ${campo("CIDADE:", c.cidade, "c3")}
        ${campo("ESTADO:", c.uf, "c2")}
        ${campo("FONE:", c.fone, "c3")}
        ${campo("CNPJ/CPF:", c.documento, "c6")}
        ${campo("INSCR. EST.:", c.ie, "c6")}
        ${pedido ? "" : campo("VÁLIDO ATÉ:", dataBR(doc.validoAte), "c12", ' class="pv-forte"')}
      </div>
    </div>
    <div class="pv-caixa pv-tabela"><table>
      <thead><tr><th class="pv-c-prod">Prod.</th><th class="pv-c-q">Quant.</th><th class="pv-c-u">Unid.</th><th class="pv-cinza">Descrição</th><th class="pv-c-cep">Cep.</th><th class="pv-cinza pv-c-v">Valor Unitário</th><th class="pv-cinza pv-c-v">Total</th></tr></thead>
      <tbody>${doc.linhas.map((l) => `<tr><td></td><td class="num">${esc(l.quant)}</td><td class="centro">${esc(l.unid)}</td><td class="pv-desc">${esc(l.descricao)}</td><td class="centro">${l.cep ? "✓" : ""}</td>
        <td class="num">${l.unitario == null ? "" : moeda(l.unitario).replace("R$ ", "")}</td><td class="num">${moeda(l.total).replace("R$ ", "")}</td></tr>`).join("")}
        ${doc.frete ? `<tr class="pv-frete"><td></td><td></td><td></td><td>Frete / entrega</td><td></td><td></td><td class="num">${moeda(doc.frete).replace("R$ ", "")}</td></tr>` : ""}
        ${'<tr><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>'.repeat(vazias)}</tbody>
    </table></div>
    <div class="pv-rodape">
      <div>
        ${pagamento ? `<div class="pv-pag">${pagamento}</div>` : ""}
        ${doc.obs ? `<div class="pv-pag">Obs.: ${esc(doc.obs)}</div>` : ""}
        ${pedido
          ? `${loja.avisos.length ? `<div class="pv-avisos">${loja.avisos.map(esc).join("<br>")}</div>` : ""}<div class="pv-assin">ASSINATURA: <span></span></div>`
          : '<div class="pv-aviso-orc">Orçamento sujeito à disponibilidade de estoque. Preços válidos até a data acima.</div>'}
      </div>
      <div><div class="pv-total"><b>TOTAL<br>GERAL</b><strong>${moeda(doc.total)}</strong></div>${loja.pix ? `<div class="pv-pix">${esc(loja.pix)}</div>` : ""}</div>
    </div>
  </section>`;
}

/**
 * HTML da folha. modo: "duas" (loja em cima, cliente embaixo), "loja" ou "cliente" (metade de cima).
 * paginaInteira: cada via numa página (pedido grande demais para meia folha).
 */
export function folhaHtml(doc, loja, { modo = "duas", paginaInteira = false } = {}) {
  const vias = modo === "duas" ? ["loja", "cliente"] : [modo];
  const corpo = vias.map((q) => umaVia(doc, loja, q, { paginaInteira }));
  const sep = paginaInteira ? '<div class="pv-quebra"></div>' : '<div class="pv-corte">✂</div>';
  return `<div class="pv-folha${paginaInteira ? " pv-inteira" : ""}">${corpo.join(sep)}</div>`;
}

/** CSS da folha (o mesmo na tela, na impressão e no PDF). Cada via é meia A4 (A4 deitada). */
export const CSS_FOLHA = `
.pv-folha { width: 210mm; background: #fff; color: #111; font-family: "Arial Narrow", Arial, Helvetica, sans-serif; }
.pv-folha * { box-sizing: border-box; }
.pv-via { height: 146mm; padding: 5mm 8mm 3mm; display: flex; flex-direction: column; gap: 1.6mm; position: relative; overflow: hidden; }
.pv-inteira .pv-via { height: auto; min-height: 285mm; overflow: visible; }
.pv-quebra { break-after: page; height: 0; }
.pv-corte { height: 5mm; display: flex; align-items: center; gap: 2mm; padding: 0 5mm; color: #777; font-size: 9pt; }
.pv-corte::after { content: ""; flex: 1; border-top: 1px dashed #999; }
.pv-etiqueta { position: absolute; top: 1.2mm; right: 9mm; font-size: 6.5pt; letter-spacing: .08em; color: #555; }
.pv-etiqueta b { color: #111; }
.pv-caixa { border: 1.3px solid #222; border-radius: 4mm; flex-shrink: 0; }
.pv-topo { display: grid; align-items: center; gap: 3mm; padding: 2mm 4mm 1.5mm; border-bottom: 1.3px solid #222; }
.pv-logo { height: 13mm; max-width: 30mm; object-fit: contain; display: block; }
.pv-marca strong { display: block; font-family: "Arial Black", Arial, sans-serif; font-weight: 900; font-size: 18pt; letter-spacing: .02em; line-height: 1; color: #111; }
.pv-marca strong small { font-size: 9pt; }
.pv-marca span { display: block; font-size: 8pt; line-height: 1.3; }
.pv-contato { border-left: 1.3px solid #222; padding-left: 3mm; font-size: 9pt; line-height: 1.5; white-space: nowrap; }
.pv-contato b { font-size: 10.5pt; }
.pv-cliente { padding: 1.5mm 4mm 2mm; display: grid; grid-template-columns: repeat(12, 1fr); column-gap: 3mm; row-gap: 1.2mm; font-size: 8pt; }
.pv-campo { display: flex; gap: 1.5mm; align-items: baseline; min-width: 0; }
.pv-campo b { white-space: nowrap; font-size: 7.5pt; }
.pv-campo span { flex: 1; border-bottom: 1px solid #333; min-height: 3.6mm; padding-left: 1mm; white-space: nowrap; overflow: hidden; }
.pv-campo .pv-forte { font-weight: 700; }
.pv-num { justify-content: flex-end; }
.pv-num strong { border: 1.5px solid #111; border-radius: 1.5mm; padding: 0 2mm; font-size: 10.5pt; white-space: nowrap; }
.pv-folha .c12 { grid-column: span 12; } .pv-folha .c9 { grid-column: span 9; } .pv-folha .c6 { grid-column: span 6; }
.pv-folha .c4 { grid-column: span 4; } .pv-folha .c3 { grid-column: span 3; } .pv-folha .c2 { grid-column: span 2; }
.pv-tabela { overflow: hidden; }
.pv-folha table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 8.3pt; margin: 0; }
.pv-folha th { font-size: 8pt; padding: 1mm 1.5mm; border-bottom: 1.3px solid #222; border-right: 1px solid #222; text-align: center; color: #111; background: none; text-transform: none; letter-spacing: 0; }
.pv-folha th.pv-cinza { background: #ddd; }
.pv-folha td { white-space: nowrap; height: 5.2mm; padding: .3mm 1.5mm; border-right: 1px solid #555; border-bottom: 1px solid #999; color: #111; background: none; vertical-align: middle; }
.pv-folha td.pv-desc { white-space: normal; }
.pv-folha th:last-child, .pv-folha td:last-child { border-right: none; }
.pv-folha tbody tr:last-child td { border-bottom: none; }
.pv-c-prod { width: 15mm; } .pv-c-q { width: 14mm; } .pv-c-u { width: 10mm; } .pv-c-cep { width: 9mm; } .pv-c-v { width: 24mm; }
.pv-folha .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.pv-folha .centro { text-align: center; }
.pv-folha tr.pv-frete td { font-style: italic; }
.pv-rodape { display: grid; grid-template-columns: 1fr auto; gap: 4mm; align-items: start; font-size: 7.8pt; margin-top: auto; }
.pv-pag { font-size: 8pt; color: #333; margin-bottom: .8mm; }
.pv-avisos { line-height: 1.45; }
.pv-assin { margin-top: 2.5mm; font-size: 9pt; font-weight: 700; }
.pv-assin span { display: inline-block; width: 70mm; border-bottom: 1px solid #111; }
.pv-aviso-orc { font-size: 8.5pt; line-height: 1.45; }
.pv-total { display: flex; align-items: center; gap: 2mm; }
.pv-total b { font-size: 9pt; line-height: 1; text-align: right; }
.pv-total strong { background: #ddd; border-radius: 2.5mm; padding: 1.8mm 4mm; font-size: 13pt; min-width: 40mm; text-align: right; font-variant-numeric: tabular-nums; }
.pv-pix { text-align: right; font-size: 6.5pt; color: #333; margin-top: 1mm; }
`;
