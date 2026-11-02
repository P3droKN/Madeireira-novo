// Caixa › A receber (fiado): quanto cada cliente deve, atrasos, receber (total ou parcial),
// cobrar no WhatsApp; o cadastro fica em Clientes e Orçamentos › Clientes (aqui só o link "abrir ficha").
// Relatórios › A receber (para imprimir). "Sem prazo" é o cliente que acerta quando juntar (no código, contaCorrente).
import { contasAReceber, abertasDoCliente, textoCobrancaFiado } from "./lib/receber.js";
import { cheques } from "./lib/caixa.js";
import { linkWhatsApp, normalizarTelefone, somarDias } from "./lib/orcamentos.js";
import { criarEditorPagamentos } from "./pagamentos.js";
import { hojeSP } from "./lib/datas.js";
import { FORMAS_PADRAO } from "./lib/planoContas.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const moeda = (v) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v || 0);
const dataBR = (d) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "—");
const num = (v) => (v === "" || v == null ? null : Number(String(v).replace(",", ".")));
const C = () => window.Caixa;
const hoje = () => C()?.hoje() || hojeSP();
const centavos = (v) => Math.round(Number(v || 0) * 100);

const estado = { busca: "", quitados: false, abertos: new Set(), atual: null, editor: null, el: null };

function calcular() {
  const r = contasAReceber(C().itens, C().configFinanceiro, hoje(), window.Clientes?.lista || []);
  const ch = cheques(C().itens, C().configFinanceiro, hoje()).recebidos.filter((c) => c.situacao === "a_compensar");
  const carteira = ch.reduce((s, c) => s + centavos(c.valor), 0) / 100;
  return { r, carteira, chequesCarteira: ch, naRua: Math.round((r.totalAberto + carteira) * 100) / 100 };
}

const situacaoTag = (d) => d.situacao === "pago" ? '<span class="tag tag-mais">pago</span>'
  : d.situacao === "em_aberto" ? `<span class="tag tag-cc">em aberto há ${d.diasEmAberto} dia(s)</span>`
  : d.situacao === "atrasado" ? `<span class="tag tag-menos">${d.diasAtraso} dia(s) de atraso</span>` : '<span class="tag">a vencer</span>';


// Trava o botão do formulário enquanto grava: clique duplo não lança duas vezes
const travar = (fn) => async (e) => {
  e.preventDefault();
  const botao = e.target.querySelector("button[type=submit]");
  if (botao?.disabled) return;
  if (botao) botao.disabled = true;
  try { await fn(e); } finally { if (botao) botao.disabled = false; }
};

// ---------- Caixa › A receber ----------

function render(el) {
  estado.el = el;
  if (!C()) return;
  if (!window.Clientes?.lista?.length && !estado.pediuClientes) {
    estado.pediuClientes = true;
    window.Clientes?.carregar().then(() => render(el));
  }
  const { r, carteira, naRua } = calcular();
  const atrasados = r.porCliente.filter((c) => c.atrasado > 0).length;
  el.innerHTML = `
  <div class="saldos-grid receber-cards">
    <div class="total-bloco"><span>A receber</span><strong>${moeda(r.totalAberto)}</strong><small class="texto-suave">${r.porCliente.filter((c) => c.aberto > 0).length} cliente(s)</small>${r.totalContaCorrente ? `<small class="texto-suave">sem prazo ${moeda(r.totalContaCorrente)} · com prazo ${moeda(r.totalComVencimento)}</small>` : ""}${r.comAlerta ? `<small><span class="tag tag-alerta">⚠ ${r.comAlerta} cliente(s) sem prazo com alerta</span></small>` : ""}</div>
    <div class="total-bloco"><span>Atrasado</span><strong class="${r.totalAtrasado ? "type-expense" : ""}">${moeda(r.totalAtrasado)}</strong><small class="texto-suave">${atrasados} cliente(s) com atraso</small></div>
    <div class="total-bloco"><span>Cheques em carteira</span><strong>${moeda(carteira)}</strong><small class="texto-suave">a compensar</small></div>
    <div class="total-bloco destaque"><span>Total na rua</span><strong>${moeda(naRua)}</strong><small class="texto-suave">fiado + cheques em carteira</small></div>
  </div>
  <section class="glass-panel">
    <div class="painel-titulo receber-topo">
      <h2>A receber por cliente</h2>
      <input type="search" id="rc-busca" class="orc-busca" placeholder="🔎 nome ou telefone" value="${esc(estado.busca)}" aria-label="Buscar cliente">
    </div>
    <div id="rc-conteudo"></div>
  </section>`;
  el.querySelector("#rc-busca").addEventListener("input", (e) => { estado.busca = e.target.value; renderConteudo(); });
  renderConteudo(r);
}

const confere = (nome, tel) => {
  const b = estado.busca.trim().toLowerCase();
  if (!b) return true;
  const dig = b.replace(/\D/g, "");
  return String(nome || "").toLowerCase().includes(b) || (dig.length >= 3 && String(tel || "").replace(/\D/g, "").includes(dig));
};

function renderConteudo(rPronto) {
  const alvo = $("rc-conteudo");
  if (!alvo) return;
  const r = rPronto || calcular().r;
  const lista = r.porCliente.filter((c) => (estado.quitados || c.aberto > 0 || c.credito > 0) && confere(c.cliente, c.telefone));
  const cc = lista.filter((c) => c.contaCorrente);
  const comVenc = lista.filter((c) => !c.contaCorrente);
  alvo.innerHTML = `
    <label class="check texto-suave"><input type="checkbox" id="rc-quitados" ${estado.quitados ? "checked" : ""}> Mostrar também quem já pagou tudo</label>
    <div class="receber-secao-titulo"><h3>Sem prazo</h3><span class="texto-suave">acerta quando juntar: nunca fica atrasado, segue o alerta de limite e de dias · ${moeda(r.totalContaCorrente)}</span></div>
    <div class="table-container"><table class="tabela-fin tabela-receber" id="rc-tabela-cc">
      <thead><tr><th>Cliente</th><th class="num">Em aberto</th><th>Em aberto há</th><th>Último pagamento</th><th>Alerta</th><th>Ações</th></tr></thead>
      <tbody>${cc.map((c) => linhaCliente(c)).join("") || '<tr><td colspan="6" class="texto-suave">Nenhum cliente sem prazo em aberto. O prazo de cada cliente fica no cadastro (Clientes e Orçamentos › Clientes).</td></tr>'}</tbody>
    </table></div>
    <div class="receber-secao-titulo"><h3>Fiado com prazo</h3><span class="texto-suave">${moeda(r.totalComVencimento)}</span></div>
    <div class="table-container"><table class="tabela-fin tabela-receber" id="rc-tabela-venc">
      <thead><tr><th>Cliente</th><th class="num">Em aberto</th><th class="num">Atrasado</th><th class="num">Maior atraso</th><th>Próximo vencimento</th><th>Ações</th></tr></thead>
      <tbody>${comVenc.map((c) => linhaCliente(c)).join("") || '<tr><td colspan="6" class="texto-suave">Ninguém devendo. As vendas em Fiado aparecem aqui.</td></tr>'}</tbody>
    </table></div>`;
  $("rc-quitados").addEventListener("change", (e) => { estado.quitados = e.target.checked; renderConteudo(); });
}

function linhaCliente(c) {
  const aberto = estado.abertos.has(c.chave);
  const tel = normalizarTelefone(c.telefone);
  const colunas = c.contaCorrente ? `
      <td>${c.aberto ? `${c.diasEmAberto} dia(s)<small>desde ${dataBR(c.emAbertoDesde)}</small>` : "—"}</td>
      <td>${c.ultimoPagamento ? `${dataBR(c.ultimoPagamento)}<small>${c.aberto ? `${c.diasSemPagar} dia(s) sem pagar` : ""}</small>` : "—"}</td>
      <td>${c.alertas.map((a) => `<span class="tag tag-alerta">⚠ ${esc(a.texto)}</span>`).join(" ") || `<small class="texto-suave">${textoAlerta(c)}</small>`}</td>` : `
      <td class="num ${c.atrasado ? "type-expense" : ""}">${c.atrasado ? moeda(c.atrasado) : "—"}</td>
      <td class="num">${c.maiorAtraso ? `${c.maiorAtraso} dia(s)` : "—"}</td>
      <td>${c.proximoVencimento ? dataBR(c.proximoVencimento) : "—"}</td>`;
  return `<tr class="${c.atrasado > 0 ? "cor-vermelho" : c.alertas.length ? "cor-alerta" : ""}" data-chave="${esc(c.chave)}">
      <td><strong>${esc(c.cliente)}</strong><small>${esc(c.telefone || (c.clienteId ? "sem WhatsApp" : "sem cadastro"))}</small>${c.credito > 0 ? `<small class="texto-ok">crédito ${moeda(c.credito)}</small>` : ""}</td>
      <td class="num"><strong>${moeda(c.aberto)}</strong></td>${colunas}
      <td class="orc-acoes">
        ${c.aberto > 0 ? `<button class="btn-icon mini destaque-verde" data-rc="receber">Receber</button>` : ""}
        ${c.aberto > 0 ? (tel.ok ? `<button class="btn-icon mini" data-rc="cobrar">Cobrar 💬</button>` : '<span class="texto-suave mini-nota">sem WhatsApp</span>') : ""}
        <button class="btn-icon mini" data-rc="ver">${aberto ? "Fechar ▴" : "Ver ▾"}</button>
      </td>
    </tr>${aberto ? `<tr class="linha-detalhe"><td colspan="6">${detalheCliente(c)}</td></tr>` : ""}`;
}

// Alerta configurado (em branco = sem alerta)
const textoAlerta = (c) => [c.alertaLimite != null ? `limite ${moeda(c.alertaLimite)}` : "", c.alertaDias != null ? `${c.alertaDias} dias sem pagar` : ""].filter(Boolean).join(" · ") || "sem alerta";

// Venda com itens que dá para imprimir de novo (as 2 vias)
const vendaDa = (d) => (d.tipo === "fiado" ? C().itens.find((l) => String(l.id) === String(d.origemId) && l.conta === "venda_produtos") : null);

// Prazo, alertas e dados do cliente ficam na ficha (Clientes e Orçamentos › Clientes)
function linkFicha(c) {
  if (!c.clienteId) return '<p class="texto-suave">Cliente sem cadastro: cadastre em Clientes e Orçamentos › Clientes para definir o prazo e os alertas.</p>';
  return `<p><button type="button" class="link-suave" data-rc-ficha="${esc(c.clienteId)}">Abrir ficha do cliente ›</button> <span class="texto-suave">prazo: ${c.contaCorrente ? "sem prazo" : "com prazo"}${c.contaCorrente ? ` · alerta: ${esc(textoAlerta(c))}` : ""}</span></p>`;
}

function detalheCliente(c) {
  return `<div class="receber-detalhe">
    ${linkFicha(c)}
    <table class="tabela-fin">
      <thead><tr><th>Data</th><th>O quê</th><th>Vencimento</th><th class="num">Valor</th><th class="num">Pago</th><th class="num">Em aberto</th><th>Situação</th></tr></thead>
      <tbody>${c.dividas.map((d) => `<tr><td>${dataBR(d.data)}</td><td>${vendaDa(d)?.numero ? `<strong>${esc(vendaDa(d).numero)}</strong> · ` : ""}${esc(d.descricao)}${vendaDa(d) ? ` <button class="btn-icon mini" data-rc-via="${esc(d.origemId)}" title="Imprimir as vias desta venda">🖨 Vias</button> <button class="btn-icon mini" data-rc-corrigir="${esc(d.origemId)}" title="Abrir a venda de volta para corrigir (mantém o número)">Corrigir</button>` : ""}</td><td>${c.contaCorrente ? "sem prazo" : dataBR(d.vencimento)}</td>
        <td class="num">${moeda(d.valor)}</td><td class="num">${d.pago ? moeda(d.pago) : "—"}</td><td class="num"><strong>${moeda(d.aberto)}</strong></td><td>${situacaoTag(d)}</td></tr>`).join("")
        || '<tr><td colspan="7" class="texto-suave">Sem compras no fiado.</td></tr>'}</tbody>
    </table>
    <h4>Recebimentos</h4>
    <table class="tabela-fin">
      <thead><tr><th>Data</th><th>Forma</th><th class="num">Valor</th><th></th></tr></thead>
      <tbody>${c.recebimentos.map((r) => `<tr><td>${dataBR(r.data)}</td><td>${esc(r.formas.map(nomeForma).join(" + "))}${r.descricao ? `<small>${esc(r.descricao)}</small>` : ""}</td>
        <td class="num">${moeda(r.valor)}</td><td><button class="delete-btn" data-rc-estornar="${esc(r.id)}" title="Desfazer este recebimento (a dívida volta)">Estornar</button></td></tr>`).join("")
        || '<tr><td colspan="4" class="texto-suave">Nenhum recebimento ainda.</td></tr>'}</tbody>
    </table>
  </div>`;
}

// Os mesmos nomes de forma do resto do sistema
const NOMES_FORMA = Object.fromEntries(FORMAS_PADRAO.map((f) => [f.id, f.nome.replace(/\s*\(.*\)$/, "")]));
const nomeForma = (f) => NOMES_FORMA[f] || f;

// ---------- Receber ----------

function abrirReceber(c) {
  if (C().somenteLeitura) return alert("Sem conexão com a nuvem. Nada pode ser lançado.");
  estado.atual = c;
  estado.idReceb = null; // recebimento novo; numa nova tentativa (falha de internet) o mesmo identificador
  const abertas = c.dividas.filter((d) => d.aberto > 0);
  $("rc-receber-titulo").textContent = `Receber de ${c.cliente}`;
  $("rc-receber-info").innerHTML = `Em aberto: <strong>${moeda(c.aberto)}</strong>${c.atrasado ? ` · atrasado ${moeda(c.atrasado)}` : ""}${c.contaCorrente && c.aberto ? ` · sem prazo, em aberto há ${c.diasEmAberto} dia(s)` : ""}`;
  $("rc-valor").value = c.aberto.toFixed(2);
  $("rc-data").value = hoje();
  $("rc-desc").value = "";
  $("rc-abater").innerHTML = `<option value="">Automático: as mais antigas primeiro</option>${abertas.map((d) =>
    `<option value="${esc(d.origemId)}">${dataBR(d.data)} · ${esc(d.descricao).slice(0, 50)} · em aberto ${moeda(d.aberto)}</option>`).join("")}`;
  estado.editor = criarEditorPagamentos($("rc-pagamentos"), { total: c.aberto, semFiado: true });
  $("modal-receber").style.display = "flex";
  $("rc-valor").focus();
}

function fecharReceber() { $("modal-receber").style.display = "none"; }

async function salvarRecebimento(e) {
  e.preventDefault();
  const c = estado.atual;
  const valor = num($("rc-valor").value);
  if (!(valor > 0)) return alert("Informe o valor recebido.");
  let pagamentos;
  try { pagamentos = estado.editor.ler(); } catch (err) { return alert(err.message); }
  if (!C().podeGravar()) return;
  if (valor > c.aberto + 0.005 && !confirm(`O valor (${moeda(valor)}) é maior que o que ${c.cliente} deve (${moeda(c.aberto)}). A diferença fica de crédito. Continuar?`)) return;
  const item = {
    id: (estado.idReceb ||= C().novoId("R")), v: 2, conta: "recebimento", value: Math.round(valor * 100) / 100, competencia: $("rc-data").value || hoje(),
    clienteId: c.clienteId, cliente: c.cliente, pagamentos, description: $("rc-desc").value.trim() || `Recebimento de ${c.cliente}`,
  };
  if ($("rc-abater").value) item.vendaIds = [$("rc-abater").value];
  if (await C().gravar([item])) {
    estado.idReceb = null;
    fecharReceber();
    const resta = Math.max(0, Math.round((c.aberto - valor) * 100) / 100);
    alert(`Recebido ${moeda(valor)} de ${c.cliente}.${resta ? `\nAinda em aberto: ${moeda(resta)}.` : "\nQuitado!"}${pagamentos.some((p) => p.forma === "cheque") ? "\nO cheque foi para a carteira (Caixa › Cheques)." : ""}`);
  }
}

function cobrar(c) {
  const texto = textoCobrancaFiado(c, hoje());
  try {
    window.open(linkWhatsApp(c.telefone, texto), "_blank", "noopener");
  } catch (err) {
    alert(err.message);
  }
}

// ---------- Relatórios › A receber ----------

function relatorio(el) {
  if (!C()) return;
  const { r, carteira, chequesCarteira, naRua } = calcular();
  const em30 = somarDias(hoje(), 30);
  const ch30 = chequesCarteira.filter((c) => c.compensacao <= em30);
  const lista = r.porCliente.filter((c) => c.aberto > 0 && !c.contaCorrente);
  const cc = r.porCliente.filter((c) => c.aberto > 0 && c.contaCorrente);
  el.innerHTML = `
  <section class="glass-panel">
    <div class="painel-titulo"><h2>Sem prazo</h2><span class="texto-suave">posição de ${dataBR(hoje())} · acerta quando juntar</span></div>
    <div class="table-container"><table class="tabela-fin">
      <thead><tr><th>Cliente</th><th>WhatsApp</th><th class="num">Em aberto</th><th>Em aberto há</th><th>Último pagamento</th><th>Alerta</th></tr></thead>
      <tbody>${cc.map((c) => `<tr><td>${esc(c.cliente)}</td><td>${esc(c.telefone || "—")}</td><td class="num">${moeda(c.aberto)}</td>
        <td>${c.diasEmAberto} dia(s) (desde ${dataBR(c.emAbertoDesde)})</td><td>${c.ultimoPagamento ? dataBR(c.ultimoPagamento) : "—"}</td>
        <td>${c.alertas.map((a) => `⚠ ${esc(a.texto)}`).join("; ") || "—"}</td></tr>`).join("")
        || '<tr><td colspan="6" class="texto-suave">Nenhum cliente sem prazo em aberto.</td></tr>'}</tbody>
      <tfoot><tr class="dre-total"><td colspan="2">Total sem prazo</td><td class="num">${moeda(r.totalContaCorrente)}</td><td colspan="3"></td></tr></tfoot>
    </table></div>
  </section>
  <section class="glass-panel">
    <div class="painel-titulo"><h2>Fiado com prazo</h2><span class="texto-suave">posição de ${dataBR(hoje())}</span></div>
    <div class="table-container"><table class="tabela-fin">
      <thead><tr><th>Cliente</th><th>WhatsApp</th><th class="num">Em aberto</th><th class="num">Atrasado</th><th class="num">Maior atraso</th><th>Próximo vencimento</th></tr></thead>
      <tbody>${lista.map((c) => `<tr><td>${esc(c.cliente)}</td><td>${esc(c.telefone || "—")}</td><td class="num">${moeda(c.aberto)}</td>
        <td class="num">${c.atrasado ? moeda(c.atrasado) : "—"}</td><td class="num">${c.maiorAtraso ? `${c.maiorAtraso} dia(s)` : "—"}</td><td>${c.proximoVencimento ? dataBR(c.proximoVencimento) : "—"}</td></tr>`).join("")
        || '<tr><td colspan="6" class="texto-suave">Nada a receber.</td></tr>'}</tbody>
      <tfoot><tr class="dre-total"><td colspan="2">Total com prazo</td><td class="num">${moeda(r.totalComVencimento)}</td><td class="num">${moeda(r.totalAtrasado)}</td><td colspan="2"></td></tr></tfoot>
    </table></div>
  </section>
  <section class="glass-panel">
    <div class="painel-titulo"><h2>Cheques a compensar nos próximos 30 dias</h2></div>
    <div class="table-container"><table class="tabela-fin">
      <thead><tr><th>Compensa em</th><th>Nº</th><th>Emissor / cliente</th><th class="num">Valor</th></tr></thead>
      <tbody>${ch30.map((c) => `<tr><td>${dataBR(c.compensacao)}</td><td>${esc(c.numero || "—")}</td><td>${esc(c.emissor || c.cliente || "—")}</td><td class="num">${moeda(c.valor)}</td></tr>`).join("")
        || '<tr><td colspan="4" class="texto-suave">Nenhum cheque a compensar nos próximos 30 dias.</td></tr>'}</tbody>
    </table></div>
  </section>
  <div class="saldos-grid">
    <div class="total-bloco"><span>Fiado em aberto</span><strong>${moeda(r.totalAberto)}</strong></div>
    <div class="total-bloco"><span>Cheques em carteira</span><strong>${moeda(carteira)}</strong></div>
    <div class="total-bloco destaque"><span>Total na rua</span><strong>${moeda(naRua)}</strong></div>
  </div>`;
}

// ---------- Eventos ----------

document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-rc], [data-rc-estornar], [data-rc-ficha], [data-rc-via], [data-rc-corrigir]");
  if (!b || !estado.el?.contains(b)) return;
  if (b.dataset.rcFicha) return window.ClientesUI?.abrirFicha(b.dataset.rcFicha);
  if (b.dataset.rcCorrigir) return window.Vendas?.corrigir(b.dataset.rcCorrigir);
  if (b.dataset.rcVia) {
    window.Vendas?.vias(b.dataset.rcVia);
    return;
  }
  if (b.dataset.rcEstornar) {
    if (confirm("Estornar este recebimento? O valor volta a ficar em aberto para o cliente.")) C().excluir(b.dataset.rcEstornar, { confirmado: true });
    return;
  }
  const chave = b.closest("tr")?.dataset.chave;
  const c = calcular().r.porCliente.find((x) => x.chave === chave);
  if (!c) return;
  if (b.dataset.rc === "receber") abrirReceber(c);
  if (b.dataset.rc === "cobrar") cobrar(c);
  if (b.dataset.rc === "ver") {
    if (estado.abertos.has(chave)) estado.abertos.delete(chave); else estado.abertos.add(chave);
    renderConteudo();
  }
});
$("rc-receber-form").addEventListener("submit", travar(salvarRecebimento));
$("rc-receber-cancelar").addEventListener("click", fecharReceber);
$("rc-valor").addEventListener("input", (e) => estado.editor?.definirTotal(num(e.target.value) || 0));

window.ReceberUI = { render, relatorio, abertasDoCliente, abrirReceber, cobrar };
