// Via do pedido para a pasta (fiado de conta corrente): 2 vias na mesma folha A4,
// uma da loja e uma do cliente. Só preço de venda: sem custo e sem margem.
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const moeda = (v) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v || 0);
const dataBR = (d) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "");
const qtd = (i) => {
  if (i.quantidadeCobrada == null || i.unidade === "valor_livre") return "";
  const n = Number(i.quantidadeCobrada).toLocaleString("pt-BR", { maximumFractionDigits: 3 });
  return `${n} ${esc(i.unidade || "")}`.trim();
};

function umaVia(l, titulo) {
  const itens = Array.isArray(l.itens) && l.itens.length ? l.itens : null;
  const fiado = (l.pagamentos || []).filter((p) => p.forma === "fiado").reduce((s, p) => s + Number(p.valor || 0), 0);
  const outras = (l.pagamentos || []).filter((p) => p.forma !== "fiado").reduce((s, p) => s + Number(p.valor || 0), 0);
  return `<div class="via">
    <div class="via-topo"><strong>Madeireira</strong><span>${esc(titulo)}</span></div>
    <p>Data: <strong>${dataBR(l.competencia)}</strong> · Pedido ${esc(l.id)}${l.nfe ? ` · NF ${esc(l.nfe)}` : ""}</p>
    <p>Cliente: <strong>${esc(l.cliente || "")}</strong> · Conta corrente</p>
    <table><thead><tr><th>Item</th><th>Qtd.</th><th class="num">Preço</th><th class="num">Total</th></tr></thead>
    <tbody>${itens ? itens.map((i) => `<tr><td>${esc(i.descricao)}</td><td>${qtd(i)}</td>
      <td class="num">${i.precoUnitario != null && i.unidade !== "valor_livre" ? moeda(i.precoUnitario) : ""}</td><td class="num">${moeda(i.vendaTotal)}</td></tr>`).join("")
      : `<tr><td colspan="4">${esc(String(l.description || "").replace(/^Venda:\s*/, ""))}</td></tr>`}</tbody>
    <tfoot>${l.frete ? `<tr><td colspan="3">Frete / entrega</td><td class="num">${moeda(l.frete)}</td></tr>` : ""}
      <tr><td colspan="3"><strong>Total</strong></td><td class="num"><strong>${moeda(l.value)}</strong></td></tr>
      ${outras > 0.004 ? `<tr><td colspan="3">Pago na hora</td><td class="num">${moeda(outras)}</td></tr><tr><td colspan="3"><strong>Na conta (fiado)</strong></td><td class="num"><strong>${moeda(fiado)}</strong></td></tr>` : ""}</tfoot></table>
    <div class="via-assinatura">______________________________________<br>Assinatura do cliente</div>
  </div>`;
}

/** Imprime as 2 vias (loja/pasta e cliente) de uma venda. */
function imprimir(lancamento) {
  const el = document.getElementById("impressao-via");
  if (!el || !lancamento) return;
  el.innerHTML = umaVia(lancamento, "Via da loja (pasta)") + '<div class="via-corte">✂ - - - - - - - - - - - - - - - - - - - - - - - - - - - -</div>' + umaVia(lancamento, "Via do cliente");
  document.body.classList.add("imprimindo-via");
  window.print();
  document.body.classList.remove("imprimindo-via");
}

window.Via = { imprimir };
