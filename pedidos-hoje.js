// Vender › Pedidos de hoje: as vendas registradas hoje (de todos os vendedores), da mais nova para a mais antiga,
// com o botão de reimprimir as vias. Atualiza junto com os dados (e a cada 30 s, ver script.js).
import { FORMAS_PADRAO } from "./lib/planoContas.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const moeda = (v) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v || 0);
const NOMES_FORMA = Object.fromEntries(FORMAS_PADRAO.map((f) => [f.id, f.nome.replace(/\s*\(.*\)$/, "")]));
const hora = (iso) => (iso ? new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }) : "");
export const nomeVendedor = (l) => (l.vendedor?.tipo === "funcionario" ? l.vendedor.nome : l.vendedor ? "Dono" : "—");

function atualizar() {
  const el = $("pedidos-hoje");
  const C = window.Caixa;
  if (!el || !C) return;
  const hoje = C.hoje();
  const vendas = (C.itens || []).filter((l) => l.conta === "venda_produtos" && l.competencia === hoje)
    .sort((a, b) => String(b.criadoEm || b.id).localeCompare(String(a.criadoEm || a.id)));
  $("pedidos-hoje-resumo").textContent = vendas.length ? `${vendas.length} ${vendas.length > 1 ? "pedidos" : "pedido"} · ${moeda(vendas.reduce((s, l) => s + Number(l.value || 0), 0))}` : "";
  el.innerHTML = vendas.length ? `<div class="table-container"><table class="tabela-fin tabela-pedidos-hoje">
    <thead><tr><th>Nº</th><th>Hora</th><th>Cliente</th><th>Forma</th><th class="num">Total</th><th>Vendedor</th><th></th></tr></thead>
    <tbody>${vendas.map((l) => `<tr><td><strong>${esc(l.numero || "—")}</strong>${l.precoDigitado ? ' <span class="tag" title="Algum item foi vendido com preço digitado (sem preço na tabela)">preço digitado</span>' : ""}</td>
      <td>${hora(l.criadoEm)}</td><td>${esc(l.cliente || l.clienteVia?.nome || "—")}</td>
      <td>${esc((l.pagamentos || []).map((p) => NOMES_FORMA[p.forma] || p.forma).join(" + "))}</td>
      <td class="num">${moeda(l.value)}</td><td>${esc(nomeVendedor(l))}</td>
      <td><button type="button" class="btn-icon mini" data-ph-vias="${esc(l.id)}">🖨 Vias</button></td></tr>`).join("")}</tbody>
  </table></div>` : '<p class="texto-suave">Nenhuma venda registrada hoje.</p>';
}

$("pedidos-hoje")?.addEventListener("click", (e) => {
  const b = e.target.closest("[data-ph-vias]");
  if (b) window.Vendas?.vias(b.dataset.phVias);
});

window.PedidosHoje = { atualizar };
