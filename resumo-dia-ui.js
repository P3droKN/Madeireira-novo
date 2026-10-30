// Relatórios › Resumo do dia: o fechamento do balcão. Panorama do caixa por conta (com a gaveta esperado ×
// contado), vendido × entrou no caixa, entradas por forma, saídas por conta, lista do dia com 🖨 Vias,
// cheques, orçamentos e resultado (controle interno). Imprimir fechamento: 1 página A4 (+ a lista, se for longa).
import { resumoDoDia } from "./lib/resumoDia.js";
import { somarDias } from "./lib/orcamentos.js";
import { lojaDaConfig } from "./lib/impressao.js";
import { hojeSP } from "./lib/datas.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const moeda = (v) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v || 0);
const dataBR = (d) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "");
const horaBR = (iso) => (iso ? new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }) : "—");
const pct = (v) => (v == null ? "—" : `${(v * 100).toFixed(1).replace(".", ",")}%`);
const C = () => window.Caixa;
const hoje = () => C()?.hoje() || hojeSP();

const estado = { de: null, ate: null, periodo: false, filtro: "todos", semCusto: false, el: null, r: null };

function calcular() {
  return resumoDoDia({
    lancamentos: C().itens, estornados: C().estornados || [], config: C().configFinanceiro, saldos: C().saldos || {},
    de: estado.de, ate: estado.periodo ? estado.ate : estado.de, clientes: window.Clientes?.lista || [], orcamentos: window.Orcamentos?.lista || [],
  });
}

const rotuloDia = () => {
  if (estado.periodo && estado.ate !== estado.de) return `de ${dataBR(estado.de)} a ${dataBR(estado.ate)}`;
  return estado.de === hoje() ? `hoje, ${dataBR(estado.de)}` : dataBR(estado.de);
};
const hojeOuNoDia = (txt) => (estado.periodo && estado.ate !== estado.de ? `${txt} no período` : estado.de === hoje() ? `${txt} hoje` : `${txt} no dia`);

function render(el) {
  estado.el = el;
  if (!C()) return;
  if (!estado.de) { estado.de = hoje(); estado.ate = hoje(); }
  if (!window.Clientes?.lista?.length && !estado.pediuClientes) { estado.pediuClientes = true; window.Clientes?.carregar().then(() => render(el)); }
  const r = (estado.r = calcular());
  const q = r.quadros;
  const ab = C().saldos?.abertura;
  el.innerHTML = `
  <section class="glass-panel dia-barra">
    <div class="dia-nav">
      <button class="btn-icon" id="dia-ant" title="Dia anterior" aria-label="Dia anterior">◀</button>
      <input type="date" id="dia-data" value="${estado.de}" aria-label="Dia">
      <button class="btn-icon" id="dia-prox" title="Dia seguinte" aria-label="Dia seguinte">▶</button>
      <button class="btn-icon" id="dia-hoje">Hoje</button>
      <label class="check"><input type="checkbox" id="dia-periodo" ${estado.periodo ? "checked" : ""}> Período</label>
      <span id="dia-periodo-campos" ${estado.periodo ? "" : "hidden"}>até <input type="date" id="dia-ate" value="${estado.ate}" min="${estado.de}" aria-label="Até"></span>
    </div>
    <div class="dia-acoes">
      <label class="check texto-suave"><input type="checkbox" id="dia-sem-custo" ${estado.semCusto ? "checked" : ""}> imprimir sem custo e margem</label>
      <button class="btn-primary" id="dia-imprimir">🖨 Imprimir fechamento</button>
    </div>
  </section>

  ${ab ? "" : '<div class="aviso aviso-alerta">Sem abertura de saldos: os saldos por conta começam do zero (Ajustes › Saldos).</div>'}
  <section class="glass-panel panorama" id="dia-panorama">
    <div class="painel-titulo"><h2>Panorama do caixa · ${esc(rotuloDia())}</h2></div>
    <div class="table-container"><table class="tabela-fin tabela-panorama">
      <thead><tr><th>Conta</th><th class="num">Saldo no início</th><th class="num">+ Entradas</th><th class="num">− Saídas</th><th class="num">± Transferências</th><th class="num">= Saldo no fim</th></tr></thead>
      <tbody>${r.contas.porConta.map((c) => `<tr data-conta="${c.conta}"><td><strong>${esc(c.nome)}</strong>${c.recebiveisCartao ? `<small>inclui ${moeda(c.recebiveisCartao)} de recebíveis de cartão (vendas anteriores)</small>` : ""}
        ${c.conta === "gaveta" ? gavetaHtml(r.contas.gaveta) : ""}</td>
        <td class="num">${moeda(c.inicio)}</td><td class="num type-income">${c.entradas ? moeda(c.entradas) : "—"}</td><td class="num type-expense">${c.saidas ? moeda(c.saidas) : "—"}</td>
        <td class="num">${c.transferencias ? moeda(c.transferencias) : "—"}</td><td class="num"><strong>${moeda(c.fim)}</strong></td></tr>`).join("")}</tbody>
      <tfoot><tr class="dre-total" id="dia-total-contas"><td>Total</td><td class="num">${moeda(r.contas.total.inicio)}</td><td class="num">${moeda(r.contas.total.entradas)}</td><td class="num">${moeda(r.contas.total.saidas)}</td><td class="num">${moeda(r.contas.total.transferencias)}</td><td class="num">${moeda(r.contas.total.fim)}</td></tr></tfoot>
    </table></div>
  </section>

  <div class="saldos-grid dia-quadros" id="dia-quadros">
    <div class="total-bloco"><span>${hojeOuNoDia("Vendido")}</span><strong>${moeda(q.vendido)}</strong><small class="texto-suave">${q.pedidos} pedido(s) · ticket médio ${moeda(q.ticketMedio)}</small></div>
    <div class="total-bloco"><span>${hojeOuNoDia("Entrou no caixa")}</span><strong class="type-income">${moeda(q.entrou)}</strong><small class="texto-suave">gaveta, Bradesco e PicPay</small></div>
    <div class="total-bloco"><span>${hojeOuNoDia("Saiu do caixa")}</span><strong class="type-expense">${moeda(q.saiu)}</strong></div>
    <div class="total-bloco destaque"><span>Saldo ${estado.periodo && estado.ate !== estado.de ? "do período" : "do dia"}</span><strong>${moeda(q.saldo)}</strong><small class="texto-suave">entrou − saiu</small></div>
    <div class="total-bloco"><span>${hojeOuNoDia("Fiado vendido")}</span><strong>${moeda(q.fiadoVendido)}</strong><small class="texto-suave">a prazo: não entrou no caixa</small></div>
    <div class="total-bloco"><span>${hojeOuNoDia("Recebido de fiado")}</span><strong>${moeda(q.recebidoFiado)}</strong>${q.recebidoAnterior ? `<small class="texto-suave">${moeda(q.recebidoAnterior)} de fiado anterior à virada</small>` : ""}</div>
  </div>
  <p class="texto-suave dia-frase">"Vendido" é tudo o que foi vendido, em qualquer forma. "Entrou no caixa" é o dinheiro que entrou de verdade: fiado e crédito não entram no dia, débito entra no dia seguinte (D+1) e recebimento de fiado entra, mas não é venda de hoje.</p>

  <div class="dia-colunas">
    <section class="glass-panel"><div class="painel-titulo"><h2>Entradas por forma</h2></div>${entradasHtml(r)}</section>
    <section class="glass-panel"><div class="painel-titulo"><h2>Saídas por conta</h2></div>${saidasHtml(r)}</section>
  </div>

  <section class="glass-panel">
    <div class="painel-titulo"><h2>Lançamentos ${estado.periodo && estado.ate !== estado.de ? "do período" : "do dia"}</h2>
      <div class="segmentado" id="dia-filtro" role="radiogroup" aria-label="Filtro">
        ${[["todos", "Todos"], ["entradas", "Entradas"], ["saidas", "Saídas"], ["vendas", "Vendas"], ["fiado", "Fiado"]].map(([v, t]) => `<label><input type="radio" name="dia-filtro" value="${v}" ${estado.filtro === v ? "checked" : ""}><span>${t}</span></label>`).join("")}
      </div></div>
    <div class="table-container"><table class="tabela-fin" id="dia-lista">
      <thead><tr><th>Hora</th><th>Nº</th><th>Descrição / cliente</th><th>Tipo</th><th>Forma / pago com</th><th class="num">Entrada</th><th class="num">Saída</th><th></th></tr></thead>
      <tbody>${listaHtml(r)}</tbody>
    </table></div>
  </section>

  <div class="dia-colunas">
    <section class="glass-panel"><div class="painel-titulo"><h2>Cheques</h2></div>${chequesHtml(r)}</section>
    <section class="glass-panel"><div class="painel-titulo"><h2>Orçamentos</h2></div>${orcamentosHtml(r)}</section>
  </div>

  <section class="glass-panel sigilo" id="dia-resultado">
    <div class="painel-titulo"><h2>Resultado (controle interno)</h2><span class="texto-suave">some no Modo balcão</span></div>
    <div class="saldos-grid">
      <div class="total-bloco"><span>Vendas</span><strong>${moeda(r.resultado.vendas)}</strong></div>
      <div class="total-bloco"><span>Custo das vendas (CMV)</span><strong class="type-expense">${moeda(r.resultado.cmv)}</strong></div>
      <div class="total-bloco destaque"><span>Lucro bruto</span><strong>${moeda(r.resultado.lucroBruto)}</strong><small class="texto-suave">margem ${pct(r.resultado.margemPct)}</small></div>
    </div>
  </section>`;
  ligar(el);
}

function gavetaHtml(g) {
  if (!g) return `<small class="texto-suave">gaveta ainda não fechada ${estado.de === hoje() ? "hoje" : "neste dia"} · <button type="button" class="link-suave" id="dia-ir-gaveta">Fechar gaveta</button></small>`;
  return `<small class="${g.bateu ? "texto-ok" : "texto-ruim"}" id="dia-gaveta">Gaveta: esperado ${moeda(g.esperado)} × contado ${moeda(g.contado)} · ${g.bateu ? "bateu" : `${g.diferenca < 0 ? "faltou" : "sobrou"} ${moeda(Math.abs(g.diferenca))}`}</small>`;
}

function entradasHtml(r) {
  const e = r.entradas;
  return `<div class="table-container"><table class="tabela-fin" id="dia-entradas">
    <thead><tr><th>Forma</th><th class="num">Qtd.</th><th class="num">Valor</th></tr></thead>
    <tbody>
      ${e.formas.map((f) => `<tr><td>${esc(f.nome)}${f.naoEntraNoCaixa ? ' <small class="texto-suave">não entra no caixa</small>' : ""}</td><td class="num">${f.quantidade}</td><td class="num">${moeda(f.valor)}</td></tr>`).join("") || '<tr><td colspan="3" class="texto-suave">Nenhuma venda.</td></tr>'}
      ${e.recebimentos.length ? `<tr class="dre-sub"><td colspan="3"><strong>Recebimentos de fiado</strong></td></tr>${e.recebimentos.map((f) => `<tr><td>${esc(f.nome)}${f.anterior ? ` <small class="texto-suave">${moeda(f.anterior)} de fiado anterior à virada</small>` : ""}</td><td class="num">${f.quantidade}</td><td class="num">${moeda(f.valor)}</td></tr>`).join("")}` : ""}
    </tbody>
    <tfoot>
      <tr class="dre-total"><td>Total (vendas ${moeda(e.totalVendas)} + recebimentos ${moeda(e.totalRecebimentos)})</td><td></td><td class="num" id="dia-entradas-total">${moeda(e.total)}</td></tr>
      ${e.freteCobrado ? `<tr><td colspan="2" class="texto-suave">Frete cobrado (já incluído nas vendas)</td><td class="num texto-suave">${moeda(e.freteCobrado)}</td></tr>` : ""}
      ${e.outras.map((o) => `<tr><td colspan="2">Outra entrada: ${esc(o.descricao)} <small class="texto-suave">${esc(o.conta)} · fora do total</small></td><td class="num">${moeda(o.valor)}</td></tr>`).join("")}
    </tfoot></table></div>`;
}

function saidasHtml(r) {
  const s = r.saidas;
  if (!s.grupos.length) return '<p class="texto-suave">Nenhuma saída paga.</p>';
  return `<div class="table-container"><table class="tabela-fin" id="dia-saidas">
    <thead><tr><th>Conta</th><th>Pago com</th><th class="num">Valor</th></tr></thead>
    <tbody>${s.grupos.map((g) => `<tr class="dre-sub"><td colspan="2"><strong>${esc(g.grupo)}</strong></td><td class="num"><strong>${moeda(g.total)}</strong></td></tr>
      ${g.itens.map((i) => `<tr><td>${esc(i.descricao)}${i.fornecedor ? `<small>${esc(i.fornecedor)}</small>` : ""}</td><td>${esc(i.pagoCom)}</td><td class="num">${moeda(i.valor)}</td></tr>`).join("")}`).join("")}</tbody>
    <tfoot><tr class="dre-total"><td colspan="2">Total das saídas</td><td class="num">${moeda(s.total)}</td></tr></tfoot></table></div>`;
}

function filtrar(l) {
  if (estado.filtro === "entradas") return l.entrada != null;
  if (estado.filtro === "saidas") return l.saida != null;
  if (estado.filtro === "vendas") return l.venda;
  if (estado.filtro === "fiado") return l.fiado;
  return true;
}

function listaHtml(r) {
  const linhas = r.detalhada.filter(filtrar);
  return linhas.map((l) => `<tr class="${l.estornado ? "estornado" : ""}" ${l.venda && !l.estornado ? `data-dia-venda="${esc(l.id)}"` : ""}>
      <td>${horaBR(l.hora)}</td><td>${l.numero ? `<strong>${esc(l.numero)}</strong>` : ""}</td>
      <td>${esc(l.descricao)}${l.cliente ? `<small>${esc(l.cliente)}</small>` : ""}${l.estornado ? '<small class="texto-ruim">estornada</small>' : ""}</td>
      <td>${esc(l.tipo)}</td><td>${esc(l.forma)}</td>
      <td class="num type-income">${l.entrada != null ? moeda(l.entrada) : l.transferencia != null ? `<small class="texto-suave">${moeda(l.transferencia)}</small>` : ""}</td>
      <td class="num type-expense">${l.saida != null ? moeda(l.saida) : ""}</td>
      <td>${l.venda && !l.estornado ? `<button class="btn-icon mini" data-dia-vias="${esc(l.id)}">🖨 Vias</button>` : ""}</td></tr>`).join("")
    || '<tr><td colspan="8" class="texto-suave">Nada lançado.</td></tr>';
}

function chequesHtml(r) {
  const c = r.cheques;
  const bloco = (t, l) => (l.length ? `<div><strong>${t}</strong> (${l.length}): ${l.map((x) => `${x.numero ? `nº ${esc(x.numero)} ` : ""}${esc(x.quem)} ${moeda(x.valor)}`).join(" · ")}</div>` : "");
  return [bloco("Recebidos", c.recebidos), bloco("Emitidos", c.emitidos), bloco("Compensados", c.compensados), bloco("Devolvidos", c.devolvidos)].join("") || '<p class="texto-suave">Nenhum cheque.</p>';
}

function orcamentosHtml(r) {
  const o = r.orcamentos;
  const bloco = (t, l) => `<div><strong>${t}:</strong> ${l.length}${l.length ? ` · ${l.map((x) => `${esc(x.id)} ${moeda(x.total)}`).join(", ")}` : ""}</div>`;
  return bloco("Criados", o.criados) + bloco("Convertidos em venda", o.convertidos) + bloco("Perdidos", o.perdidos);
}

function ligar(el) {
  const ir = (d) => { estado.de = d; if (!estado.periodo || estado.ate < d) estado.ate = d; render(el); };
  $("dia-ant").addEventListener("click", () => ir(somarDias(estado.de, -1)));
  $("dia-prox").addEventListener("click", () => ir(somarDias(estado.de, 1)));
  $("dia-hoje").addEventListener("click", () => { estado.periodo = false; ir(hoje()); });
  $("dia-data").addEventListener("change", (e) => e.target.value && ir(e.target.value));
  $("dia-periodo").addEventListener("change", (e) => { estado.periodo = e.target.checked; if (!estado.periodo) estado.ate = estado.de; render(el); });
  $("dia-ate")?.addEventListener("change", (e) => { if (e.target.value) { estado.ate = e.target.value < estado.de ? estado.de : e.target.value; render(el); } });
  $("dia-sem-custo").addEventListener("change", (e) => { estado.semCusto = e.target.checked; });
  $("dia-imprimir").addEventListener("click", imprimirFechamento);
  $("dia-filtro").addEventListener("change", (e) => { estado.filtro = e.target.value; $("dia-lista").querySelector("tbody").innerHTML = listaHtml(estado.r); });
  $("dia-ir-gaveta")?.addEventListener("click", () => window.Financeiro.irPara("caixa", "saldos"));
  // Clicar na venda abre o pedido (com a opção de reimprimir as vias)
  $("dia-lista").addEventListener("click", (e) => {
    const tr = e.target.closest("[data-dia-venda]");
    const b = e.target.closest("[data-dia-vias]");
    const id = b?.dataset.diaVias || tr?.dataset.diaVenda;
    if (id) window.Vendas?.vias(id);
  });
}

// ---------- Imprimir fechamento: 1 página A4 (a lista vai numa página extra, se for longa) ----------

function imprimirFechamento() {
  const r = estado.r;
  const q = r.quadros;
  const loja = lojaDaConfig(C().configFinanceiro);
  const comCusto = !estado.semCusto && !document.body.classList.contains("modo-balcao");
  const LISTA_CABE = 8; // até 8 lançamentos, a lista vai na mesma página
  const lista = r.detalhada;
  const listaHtmlImp = `<h3>Lançamentos (${lista.length})</h3><table><thead><tr><th>Hora</th><th>Nº</th><th>Descrição</th><th>Tipo</th><th>Forma</th><th class="num">Entrada</th><th class="num">Saída</th></tr></thead>
    <tbody>${lista.map((l) => `<tr class="${l.estornado ? "estornado" : ""}"><td>${horaBR(l.hora)}</td><td>${esc(l.numero)}</td><td>${esc(l.descricao)}${l.cliente ? ` · ${esc(l.cliente)}` : ""}${l.estornado ? " (estornada)" : ""}</td><td>${esc(l.tipo)}</td><td>${esc(l.forma)}</td>
      <td class="num">${l.entrada != null ? moeda(l.entrada) : ""}</td><td class="num">${l.saida != null ? moeda(l.saida) : ""}</td></tr>`).join("")}</tbody></table>`;
  const g = r.contas.gaveta;
  const html = `<div class="fech-folha">
    <section class="fech-pagina">
      <div class="fech-topo"><div><strong>${esc(loja.nome)}</strong><span>Fechamento ${estado.periodo && estado.ate !== estado.de ? `de ${dataBR(estado.de)} a ${dataBR(estado.ate)}` : `do dia ${dataBR(estado.de)}`}</span></div><span>Impresso em ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</span></div>
      <div class="fech-quadros">
        <div><span>Vendido</span><strong>${moeda(q.vendido)}</strong><small>${q.pedidos} pedido(s) · ticket ${moeda(q.ticketMedio)}</small></div>
        <div><span>Entrou no caixa</span><strong>${moeda(q.entrou)}</strong></div>
        <div><span>Saiu do caixa</span><strong>${moeda(q.saiu)}</strong></div>
        <div><span>Saldo</span><strong>${moeda(q.saldo)}</strong></div>
        <div><span>Fiado vendido</span><strong>${moeda(q.fiadoVendido)}</strong></div>
        <div><span>Recebido de fiado</span><strong>${moeda(q.recebidoFiado)}</strong></div>
      </div>
      <h3>Movimento por conta</h3>
      <table><thead><tr><th>Conta</th><th class="num">Início</th><th class="num">+ Entradas</th><th class="num">− Saídas</th><th class="num">± Transf.</th><th class="num">= Fim</th></tr></thead>
        <tbody>${r.contas.porConta.map((c) => `<tr><td>${esc(c.nome)}</td><td class="num">${moeda(c.inicio)}</td><td class="num">${moeda(c.entradas)}</td><td class="num">${moeda(c.saidas)}</td><td class="num">${moeda(c.transferencias)}</td><td class="num"><b>${moeda(c.fim)}</b></td></tr>`).join("")}</tbody>
        <tfoot><tr><td>Total</td><td class="num">${moeda(r.contas.total.inicio)}</td><td class="num">${moeda(r.contas.total.entradas)}</td><td class="num">${moeda(r.contas.total.saidas)}</td><td class="num">${moeda(r.contas.total.transferencias)}</td><td class="num"><b>${moeda(r.contas.total.fim)}</b></td></tr></tfoot></table>
      <p class="fech-gaveta">Gaveta: ${g ? `esperado ${moeda(g.esperado)} × contado ${moeda(g.contado)} → ${g.bateu ? "bateu" : `${g.diferenca < 0 ? "faltou" : "sobrou"} ${moeda(Math.abs(g.diferenca))}`}` : "contagem não feita · contado: ______________"}</p>
      <div class="fech-colunas">
        <div><h3>Entradas por forma</h3><table><tbody>
          ${r.entradas.formas.map((f) => `<tr><td>${esc(f.nome)}${f.naoEntraNoCaixa ? " (não entra no caixa)" : ""}</td><td class="num">${f.quantidade}</td><td class="num">${moeda(f.valor)}</td></tr>`).join("")}
          ${r.entradas.recebimentos.map((f) => `<tr><td>Recebimento de fiado · ${esc(f.nome)}</td><td class="num">${f.quantidade}</td><td class="num">${moeda(f.valor)}</td></tr>`).join("")}
          <tr class="fech-total"><td>Total</td><td></td><td class="num">${moeda(r.entradas.total)}</td></tr></tbody></table></div>
        <div><h3>Saídas por conta</h3><table><tbody>
          ${r.saidas.grupos.map((s) => `<tr><td>${esc(s.grupo)}</td><td class="num">${moeda(s.total)}</td></tr>`).join("") || '<tr><td colspan="2">Nenhuma saída</td></tr>'}
          <tr class="fech-total"><td>Total</td><td class="num">${moeda(r.saidas.total)}</td></tr></tbody></table></div>
      </div>
      ${comCusto ? `<p class="fech-resultado">Resultado (controle interno): vendas ${moeda(r.resultado.vendas)} − custo das vendas ${moeda(r.resultado.cmv)} = lucro bruto <b>${moeda(r.resultado.lucroBruto)}</b> (margem ${pct(r.resultado.margemPct)})</p>` : ""}
      ${lista.length && lista.length <= LISTA_CABE ? listaHtmlImp : ""}
      <div class="fech-conferido">Conferido por: ________________________________ &nbsp;&nbsp; Data: ____/____/______</div>
    </section>
    ${lista.length > LISTA_CABE ? `<section class="fech-pagina fech-lista">${listaHtmlImp}</section>` : ""}
  </div>`;
  const el = $("impressao-via");
  el.innerHTML = html;
  const folha = document.createElement("style");
  folha.textContent = "@page { size: A4; margin: 0; }";
  document.head.appendChild(folha);
  document.body.classList.add("imprimindo-via");
  window.print();
  document.body.classList.remove("imprimindo-via");
  folha.remove();
}

window.ResumoDia = {
  render,
  // Relatórios sempre abre no dia de hoje
  irParaHoje() { estado.de = estado.ate = hoje(); estado.periodo = false; },
};
