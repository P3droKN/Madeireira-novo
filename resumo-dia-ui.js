// Relatórios › Resumo do dia: o fechamento do balcão. Panorama do caixa por conta (com a gaveta esperado ×
// contado), vendido × entrou no caixa, entradas por forma, saídas por conta, lista do dia com 🖨 Vias,
// cheques, orçamentos e resultado (controle interno). Imprimir fechamento: 1 página A4 (+ a lista, se for longa).
import { resumoDoDia } from "./lib/resumoDia.js";
import { somarDias } from "./lib/orcamentos.js";
import { lojaDaConfig } from "./lib/impressao.js";
import { pontoEquilibrioMedio } from "./lib/financeiro.js";
import { hojeSP } from "./lib/datas.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const moeda = (v) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v || 0);
const dataBR = (d) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "");
const horaBR = (iso) => (iso ? new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }) : "—");
const pct = (v) => (v == null ? "—" : `${(v * 100).toFixed(1).replace(".", ",")}%`);
const C = () => window.Caixa;
const hoje = () => C()?.hoje() || hojeSP();

const estado = { modo: "dia", de: null, ate: null, periodo: false, mes: null, filtro: "todos", semCusto: false, el: null, r: null };
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const fimDoMes = (mes) => { const [a, m] = mes.split("-").map(Number); return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10); };
const mesVizinho = (mes, n) => { const [a, m] = mes.split("-").map(Number); const d = new Date(Date.UTC(a, m - 1 + n, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; };
const ehMes = () => estado.modo === "mes";
const ehPeriodo = () => ehMes() || (estado.periodo && estado.ate !== estado.de);

function calcular(de = estado.de, ate = ehMes() || estado.periodo ? estado.ate : estado.de) {
  return resumoDoDia({
    lancamentos: C().itens, estornados: C().estornados || [], config: C().configFinanceiro, saldos: C().saldos || {},
    de, ate, clientes: window.Clientes?.lista || [], orcamentos: window.Orcamentos?.lista || [],
  });
}

const rotuloDia = () => {
  if (ehMes()) { const [a, m] = estado.mes.split("-"); return `${MESES[Number(m) - 1]} de ${a}${estado.mes === hoje().slice(0, 7) ? ` (até ${dataBR(hoje()).slice(0, 5)})` : ""}`; }
  if (estado.periodo && estado.ate !== estado.de) return `de ${dataBR(estado.de)} a ${dataBR(estado.ate)}`;
  return estado.de === hoje() ? `hoje, ${dataBR(estado.de)}` : dataBR(estado.de);
};
const quando = () => (ehMes() ? "no mês" : estado.periodo && estado.ate !== estado.de ? "no período" : estado.de === hoje() ? "hoje" : "no dia");

/**
 * Relatórios › Dia (modo "dia") e › Mês (modo "mes"): o mesmo layout, na ordem em que se lê.
 * 1. data · 2. a resposta em três números · 3. caixa por conta · 4. entradas e saídas · 5. movimentos (recolhidos) · 6. mais detalhes
 */
function render(el, modo = estado.modo) {
  estado.el = el;
  estado.modo = modo;
  if (!C()) return;
  if (!estado.de) { estado.de = hoje(); estado.ate = hoje(); }
  if (!estado.mes) estado.mes = hoje().slice(0, 7);
  if (ehMes()) { estado.de = `${estado.mes}-01`; estado.ate = estado.mes === hoje().slice(0, 7) ? hoje() : fimDoMes(estado.mes); }
  if (!window.Clientes?.lista?.length && !estado.pediuClientes) { estado.pediuClientes = true; window.Clientes?.carregar().then(() => render(el)); }
  const r = (estado.r = calcular());
  const q = r.quadros;
  const ab = C().saldos?.abertura;
  const nMov = r.detalhada.length;
  el.innerHTML = `
  <section class="glass-panel dia-barra">
    <div class="dia-nav">
      ${ehMes()
        ? `<button class="btn-icon" id="dia-ant" title="Mês anterior" aria-label="Mês anterior">◀</button>
           <input type="month" id="dia-mes" value="${estado.mes}" aria-label="Mês">
           <button class="btn-icon" id="dia-prox" title="Mês seguinte" aria-label="Mês seguinte">▶</button>
           <button class="btn-icon" id="dia-hoje">Este mês</button>`
        : `<button class="btn-icon" id="dia-ant" title="Dia anterior" aria-label="Dia anterior">◀</button>
           <input type="date" id="dia-data" value="${estado.de}" aria-label="Dia">
           <button class="btn-icon" id="dia-prox" title="Dia seguinte" aria-label="Dia seguinte">▶</button>
           <button class="btn-icon" id="dia-hoje">Hoje</button>
           <label class="check"><input type="checkbox" id="dia-periodo" ${estado.periodo ? "checked" : ""}> Período</label>
           <span id="dia-periodo-campos" ${estado.periodo ? "" : "hidden"}>até <input type="date" id="dia-ate" value="${estado.ate}" min="${estado.de}" aria-label="Até"></span>`}
    </div>
    <div class="dia-acoes">
      <label class="check texto-suave"><input type="checkbox" id="dia-sem-custo" ${estado.semCusto ? "checked" : ""}> imprimir sem lucro</label>
      <button class="btn-primary" id="dia-imprimir">🖨 Imprimir ${ehMes() ? "relatório do mês" : "fechamento"}</button>
    </div>
  </section>
  ${ab ? "" : '<div class="aviso aviso-alerta">Sem abertura de saldos: os saldos por conta começam do zero (Ajustes › Saldos).</div>'}
  ${ehMes() ? equilibrioHtml() : ""}

  <section class="dia-resposta" id="dia-numeros" aria-label="Resumo ${esc(quando())}">
    <h2 class="dia-titulo">${ehMes() ? "Mês" : "Dia"} · ${esc(rotuloDia())}</h2>
    <div class="dia-tres">
      <div data-numero="vendeu"><span>Vendeu</span><strong>${moeda(q.vendido)}</strong><small>${q.pedidos} pedido${q.pedidos === 1 ? "" : "s"}${q.pedidos ? ` · média ${moeda(q.ticketMedio)}` : ""}</small></div>
      <div data-numero="entrou"><span>Entrou no caixa <button type="button" class="info" id="dia-info" aria-expanded="false" title="Por que é diferente de Vendeu?">ⓘ</button></span><strong class="ent">${moeda(q.entrou)}</strong><small>gaveta, Bradesco e PicPay</small></div>
      <div data-numero="saiu"><span>Saiu</span><strong class="${q.saiu ? "sai" : ""}">${moeda(q.saiu)}</strong><small>pago ${esc(quando())}</small></div>
    </div>
    <p class="dia-explica" id="dia-explica" hidden>“Vendeu” é tudo o que foi vendido, em qualquer forma. “Entrou no caixa” é o dinheiro que entrou de verdade: fiado e crédito não entram na hora, o débito entra no dia seguinte e o recebimento de fiado entra, mas não é venda ${esc(quando())}.</p>
    <p class="dia-linha" id="dia-linha-fiado">Fiado vendido ${moeda(q.fiadoVendido)} · Recebido de fiado ${moeda(q.recebidoFiado)}${q.recebidoAnterior ? ` (${moeda(q.recebidoAnterior)} da pasta, anterior à virada)` : ""}</p>
  </section>

  <section class="glass-panel" id="dia-panorama">
    <div class="painel-titulo"><h2>Caixa por conta</h2>${r.contas.inicioNaAbertura ? `<span class="texto-suave">início = abertura de ${dataBR(r.contas.abertura)}</span>` : ""}</div>
    <div class="table-container"><table class="tabela-fin tabela-panorama">
      <thead><tr><th>Conta</th><th class="num">Início</th><th class="num">+ Entradas</th><th class="num">− Saídas</th><th class="num">± Transf.</th><th class="num">= Fim</th></tr></thead>
      <tbody>${r.contas.porConta.map((c) => `<tr data-conta="${c.conta}"><td><strong>${esc(c.nome)}</strong>${c.recebiveisCartao ? `<small>${moeda(c.recebiveisCartao)} de cartão de vendas anteriores</small>` : ""}
        ${c.conta === "gaveta" && !ehPeriodo() ? gavetaHtml(r.contas.gaveta) : ""}</td>
        <td class="num">${moeda(c.inicio)}</td><td class="num ent">${c.entradas ? moeda(c.entradas) : "—"}</td><td class="num sai">${c.saidas ? moeda(c.saidas) : "—"}</td>
        <td class="num">${c.transferencias ? moeda(c.transferencias) : "—"}</td><td class="num"><strong>${moeda(c.fim)}</strong></td></tr>`).join("")}</tbody>
      <tfoot><tr class="dre-total" id="dia-total-contas"><td>Total</td><td class="num">${moeda(r.contas.total.inicio)}</td><td class="num">${moeda(r.contas.total.entradas)}</td><td class="num">${moeda(r.contas.total.saidas)}</td><td class="num">${moeda(r.contas.total.transferencias)}</td><td class="num">${moeda(r.contas.total.fim)}</td></tr></tfoot>
    </table></div>
  </section>

  <div class="dia-colunas">
    <section class="glass-panel"><div class="painel-titulo"><h2>Entradas por forma</h2></div>${entradasHtml(r)}</section>
    <section class="glass-panel"><div class="painel-titulo"><h2>Saídas por conta</h2></div>${saidasHtml(r)}</section>
  </div>

  <details class="glass-panel dia-recolhido" id="dia-movimentos">
    <summary>Ver ${nMov === 1 ? "o movimento" : `os ${nMov} movimentos`} ${esc(ehMes() ? "do mês" : ehPeriodo() ? "do período" : "do dia")}</summary>
    <div class="segmentado" id="dia-filtro" role="radiogroup" aria-label="Filtro">
      ${[["todos", "Todos"], ["entradas", "Entradas"], ["saidas", "Saídas"], ["vendas", "Vendas"], ["fiado", "Fiado"]].map(([v, t]) => `<label><input type="radio" name="dia-filtro" value="${v}" ${estado.filtro === v ? "checked" : ""}><span>${t}</span></label>`).join("")}
    </div>
    <div class="table-container"><table class="tabela-fin" id="dia-lista">
      <thead><tr><th>${ehPeriodo() ? "Data" : "Hora"}</th><th>Nº</th><th>Descrição / cliente</th><th>Tipo</th><th>Forma / pago com</th><th class="num">Entrada</th><th class="num">Saída</th><th></th></tr></thead>
      <tbody>${listaHtml(r)}</tbody>
    </table></div>
  </details>

  ${ehMes() ? `<details class="glass-panel dia-recolhido" id="dia-dia-a-dia"><summary>Dia a dia do mês</summary><div id="dia-dia-a-dia-conteudo"><p class="texto-suave">Calculando…</p></div></details>` : ""}

  <details class="glass-panel dia-recolhido" id="dia-detalhes">
    <summary>Mais detalhes <span class="texto-suave">cheques · orçamentos · resultado</span></summary>
    <div class="dia-colunas">
      <div><h3>Cheques</h3>${chequesHtml(r)}</div>
      <div><h3>Orçamentos</h3>${orcamentosHtml(r)}</div>
    </div>
    <div class="sigilo" id="dia-resultado">
      <h3>Resultado <span class="texto-suave">(some no modo balcão)</span></h3>
      <table class="tabela-fin dia-resultado"><tbody>
        <tr><td>Vendas</td><td class="num">${moeda(r.resultado.vendas)}</td></tr>
        <tr><td>Custo das mercadorias</td><td class="num sai">−${moeda(r.resultado.cmv).replace("-", "")}</td></tr>
        <tr class="dre-total"><td>Lucro bruto <span class="texto-suave">· margem ${pct(r.resultado.margemPct)}</span></td><td class="num">${moeda(r.resultado.lucroBruto)}</td></tr>
      </tbody></table>
    </div>
  </details>`;
  ligar(el);
}

// Mês: quanto vender para empatar (média dos 3 meses completos anteriores), no topo
function equilibrioHtml() {
  const pe = pontoEquilibrioMedio(C().itens, C().configFinanceiro, hoje().slice(0, 7), 3);
  if (!pe) return "";
  const nomes = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  const meses = pe.meses.map((m) => `${nomes[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`).join(", ");
  const pctMc = (pe.margemContribuicaoPct * 100).toFixed(1).replace(".", ",");
  if (pe.pontoEquilibrio == null) return `<div class="equilibrio aviso aviso-alerta" id="rel-equilibrio"><span>Quanto preciso vender por mês para empatar</span><strong>Sem ponto de equilíbrio</strong><small>A margem de ${meses} ficou negativa (${pctMc}%): vender mais não cobre os custos. Verifique custos e preços.</small></div>`;
  const vendeuMes = estado.mes === hoje().slice(0, 7) ? estado.r?.quadros.vendido ?? calcular().quadros.vendido : null;
  return `<div class="equilibrio" id="rel-equilibrio">
    <span>Quanto preciso vender por mês para empatar</span>
    <strong id="rel-equilibrio-valor">${moeda(pe.pontoEquilibrio)}</strong>
    <small>Custos fixos médios ${moeda(pe.custosFixosMedia)} ÷ margem de ${pctMc}% · média de ${meses}</small>
    ${vendeuMes != null ? `<small>Este mês até ${dataBR(hoje()).slice(0, 5)}: ${moeda(vendeuMes)}${vendeuMes < pe.pontoEquilibrio ? ` (faltam ${moeda(pe.pontoEquilibrio - vendeuMes)})` : " (já empatou)"}</small>` : ""}
  </div>`;
}

// Mês › Dia a dia: só calcula quando abre (um resumo por dia)
function diaADiaHtml() {
  const linhas = [];
  for (let d = estado.de; d <= estado.ate; d = somarDias(d, 1)) {
    const r = calcular(d, d);
    if (!r.quadros.vendido && !r.quadros.entrou && !r.quadros.saiu) continue;
    linhas.push(`<tr data-dia="${d}"><td><button type="button" class="link-suave" data-ir-dia="${d}">${dataBR(d)}</button></td><td class="num">${moeda(r.quadros.vendido)}</td><td class="num ent">${moeda(r.quadros.entrou)}</td><td class="num sai">${moeda(r.quadros.saiu)}</td><td class="num"><strong>${moeda(r.contas.total.fim)}</strong></td></tr>`);
  }
  return `<div class="table-container"><table class="tabela-fin"><thead><tr><th>Dia</th><th class="num">Vendeu</th><th class="num">Entrou</th><th class="num">Saiu</th><th class="num">Caixa no fim</th></tr></thead>
    <tbody>${linhas.join("") || '<tr><td colspan="5" class="texto-suave">Nenhum movimento no mês.</td></tr>'}</tbody></table></div>`;
}

function gavetaHtml(g) {
  if (!g) return `<button type="button" class="btn-icon mini" id="dia-ir-gaveta">Fechar gaveta</button>`;
  return `<small class="${g.bateu ? "texto-ok" : "texto-ruim"}" id="dia-gaveta">contado ${moeda(g.contado)} · ${g.bateu ? "bateu" : `${g.diferenca < 0 ? "faltou" : "sobrou"} ${moeda(Math.abs(g.diferenca))}`} <span class="texto-suave">(esperado ${moeda(g.esperado)})</span></small>`;
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
      <td>${ehPeriodo() ? dataBR(l.data) : horaBR(l.hora)}</td><td>${l.numero ? `<strong>${esc(l.numero)}</strong>` : ""}</td>
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
  if (ehMes()) {
    const irMes = (m) => { estado.mes = m; render(el); };
    $("dia-ant").addEventListener("click", () => irMes(mesVizinho(estado.mes, -1)));
    $("dia-prox").addEventListener("click", () => irMes(mesVizinho(estado.mes, 1)));
    $("dia-hoje").addEventListener("click", () => irMes(hoje().slice(0, 7)));
    $("dia-mes").addEventListener("change", (e) => e.target.value && irMes(e.target.value));
    $("dia-dia-a-dia").addEventListener("toggle", (e) => { if (e.target.open) $("dia-dia-a-dia-conteudo").innerHTML = diaADiaHtml(); });
    $("dia-dia-a-dia").addEventListener("click", (e) => {
      const d = e.target.closest("[data-ir-dia]")?.dataset.irDia;
      if (d) { estado.de = estado.ate = d; estado.periodo = false; window.Financeiro.irPara("relatorios", "dia"); }
    });
  } else {
    const ir = (d) => { estado.de = d; if (!estado.periodo || estado.ate < d) estado.ate = d; render(el); };
    $("dia-ant").addEventListener("click", () => ir(somarDias(estado.de, -1)));
    $("dia-prox").addEventListener("click", () => ir(somarDias(estado.de, 1)));
    $("dia-hoje").addEventListener("click", () => { estado.periodo = false; ir(hoje()); });
    $("dia-data").addEventListener("change", (e) => e.target.value && ir(e.target.value));
    $("dia-periodo").addEventListener("change", (e) => { estado.periodo = e.target.checked; if (!estado.periodo) estado.ate = estado.de; render(el); });
    $("dia-ate")?.addEventListener("change", (e) => { if (e.target.value) { estado.ate = e.target.value < estado.de ? estado.de : e.target.value; render(el); } });
  }
  $("dia-info").addEventListener("click", (e) => { const ab = $("dia-explica").hidden; $("dia-explica").hidden = !ab; e.currentTarget.setAttribute("aria-expanded", String(ab)); });
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
      <div class="fech-topo"><div><strong>${esc(loja.nome)}</strong><span>${ehMes() ? `Relatório do mês: ${esc(rotuloDia())}` : `Fechamento ${estado.periodo && estado.ate !== estado.de ? `de ${dataBR(estado.de)} a ${dataBR(estado.ate)}` : `do dia ${dataBR(estado.de)}`}`}</span></div><span>Impresso em ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</span></div>
      <div class="fech-quadros">
        <div><span>Vendeu</span><strong>${moeda(q.vendido)}</strong><small>${q.pedidos} pedido(s)</small></div>
        <div><span>Entrou no caixa</span><strong>${moeda(q.entrou)}</strong></div>
        <div><span>Saiu</span><strong>${moeda(q.saiu)}</strong></div>
      </div>
      <p class="fech-linha">Fiado vendido ${moeda(q.fiadoVendido)} · Recebido de fiado ${moeda(q.recebidoFiado)}${q.recebidoAnterior ? ` (${moeda(q.recebidoAnterior)} da pasta)` : ""}</p>
      <h3>Caixa por conta</h3>
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
  irParaHoje() { estado.de = estado.ate = hoje(); estado.periodo = false; estado.mes = hoje().slice(0, 7); },
};
