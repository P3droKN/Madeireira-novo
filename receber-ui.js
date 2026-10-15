// Caixa › A receber (fiado): quanto cada cliente deve, atrasos, receber (total ou parcial),
// cobrar no WhatsApp e o cadastro de clientes. Relatórios › A receber (para imprimir). Fase 2C.
import { contasAReceber, abertasDoCliente, textoCobrancaFiado } from "./lib/receber.js";
import { cheques } from "./lib/caixa.js";
import { linkWhatsApp, normalizarTelefone, somarDias } from "./lib/orcamentos.js";
import { criarEditorPagamentos } from "./pagamentos.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const moeda = (v) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v || 0);
const dataBR = (d) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "—");
const num = (v) => (v === "" || v == null ? null : Number(String(v).replace(",", ".")));
const C = () => window.Caixa;
const hoje = () => C()?.hoje() || new Date().toISOString().slice(0, 10);
const centavos = (v) => Math.round(Number(v || 0) * 100);

const estado = { visao: "dividas", busca: "", quitados: false, abertos: new Set(), atual: null, editor: null, editandoCliente: null, el: null };

function calcular() {
  const r = contasAReceber(C().itens, C().configFinanceiro, hoje(), window.Clientes?.lista || []);
  const ch = cheques(C().itens, C().configFinanceiro, hoje()).recebidos.filter((c) => c.situacao === "a_compensar");
  const carteira = ch.reduce((s, c) => s + centavos(c.valor), 0) / 100;
  return { r, carteira, chequesCarteira: ch, naRua: Math.round((r.totalAberto + carteira) * 100) / 100 };
}

const situacaoTag = (d) => d.situacao === "pago" ? '<span class="tag tag-mais">pago</span>'
  : d.situacao === "atrasado" ? `<span class="tag tag-menos">${d.diasAtraso} dia(s) de atraso</span>` : '<span class="tag">a vencer</span>';

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
    <div class="total-bloco"><span>A receber (fiado)</span><strong>${moeda(r.totalAberto)}</strong><small class="texto-suave">${r.porCliente.filter((c) => c.aberto > 0).length} cliente(s)</small></div>
    <div class="total-bloco"><span>Atrasado</span><strong class="${r.totalAtrasado ? "type-expense" : ""}">${moeda(r.totalAtrasado)}</strong><small class="texto-suave">${atrasados} cliente(s) com atraso</small></div>
    <div class="total-bloco"><span>Cheques em carteira</span><strong>${moeda(carteira)}</strong><small class="texto-suave">a compensar</small></div>
    <div class="total-bloco destaque"><span>Total na rua</span><strong>${moeda(naRua)}</strong><small class="texto-suave">fiado + cheques em carteira</small></div>
  </div>
  <section class="glass-panel">
    <div class="painel-titulo receber-topo">
      <div class="segmentado" id="rc-visao" role="radiogroup" aria-label="Visão">
        <label><input type="radio" name="rc-visao" value="dividas" ${estado.visao === "dividas" ? "checked" : ""}><span>A receber por cliente</span></label>
        <label><input type="radio" name="rc-visao" value="clientes" ${estado.visao === "clientes" ? "checked" : ""}><span>Clientes (cadastro)</span></label>
      </div>
      <input type="search" id="rc-busca" class="orc-busca" placeholder="🔎 nome ou telefone" value="${esc(estado.busca)}" aria-label="Buscar cliente">
    </div>
    <div id="rc-conteudo"></div>
  </section>`;
  el.querySelector("#rc-visao").addEventListener("change", (e) => { estado.visao = e.target.value; renderConteudo(); });
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
  if (estado.visao === "clientes") return renderClientes(alvo, rPronto || calcular().r);
  const r = rPronto || calcular().r;
  const lista = r.porCliente.filter((c) => (estado.quitados || c.aberto > 0 || c.credito > 0) && confere(c.cliente, c.telefone));
  alvo.innerHTML = `
    <label class="check texto-suave"><input type="checkbox" id="rc-quitados" ${estado.quitados ? "checked" : ""}> Mostrar também quem já pagou tudo</label>
    <div class="table-container"><table class="tabela-fin tabela-receber">
      <thead><tr><th>Cliente</th><th class="num">Em aberto</th><th class="num">Atrasado</th><th class="num">Maior atraso</th><th>Próximo vencimento</th><th>Ações</th></tr></thead>
      <tbody>${lista.map((c) => linhaCliente(c)).join("") || '<tr><td colspan="6" class="texto-suave">Ninguém devendo. As vendas em "Fiado (a receber)" aparecem aqui.</td></tr>'}</tbody>
    </table></div>`;
  $("rc-quitados").addEventListener("change", (e) => { estado.quitados = e.target.checked; renderConteudo(); });
}

function linhaCliente(c) {
  const aberto = estado.abertos.has(c.chave);
  const tel = normalizarTelefone(c.telefone);
  return `<tr class="${c.atrasado > 0 ? "cor-vermelho" : ""}" data-chave="${esc(c.chave)}">
      <td><strong>${esc(c.cliente)}</strong><small>${esc(c.telefone || (c.clienteId ? "sem WhatsApp" : "sem cadastro"))}</small>${c.credito > 0 ? `<small class="texto-ok">crédito ${moeda(c.credito)}</small>` : ""}</td>
      <td class="num"><strong>${moeda(c.aberto)}</strong></td>
      <td class="num ${c.atrasado ? "type-expense" : ""}">${c.atrasado ? moeda(c.atrasado) : "—"}</td>
      <td class="num">${c.maiorAtraso ? `${c.maiorAtraso} dia(s)` : "—"}</td>
      <td>${c.proximoVencimento ? dataBR(c.proximoVencimento) : "—"}</td>
      <td class="orc-acoes">
        ${c.aberto > 0 ? `<button class="btn-icon mini destaque-verde" data-rc="receber">Receber</button>` : ""}
        ${c.aberto > 0 ? (tel.ok ? `<button class="btn-icon mini" data-rc="cobrar">Cobrar 💬</button>` : '<span class="texto-suave mini-nota">sem WhatsApp</span>') : ""}
        <button class="btn-icon mini" data-rc="ver">${aberto ? "Fechar ▴" : "Ver ▾"}</button>
      </td>
    </tr>${aberto ? `<tr class="linha-detalhe"><td colspan="6">${detalheCliente(c)}</td></tr>` : ""}`;
}

function detalheCliente(c) {
  return `<div class="receber-detalhe">
    <table class="tabela-fin">
      <thead><tr><th>Data</th><th>O quê</th><th>Vencimento</th><th class="num">Valor</th><th class="num">Pago</th><th class="num">Em aberto</th><th>Situação</th></tr></thead>
      <tbody>${c.dividas.map((d) => `<tr><td>${dataBR(d.data)}</td><td>${esc(d.descricao)}</td><td>${dataBR(d.vencimento)}</td>
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

const NOMES_FORMA = { dinheiro: "Dinheiro", pix_bradesco: "PIX Bradesco", pix_picpay: "PIX PicPay", transferencia: "Transferência", debito: "Débito", credito: "Crédito", credito_parcelado: "Crédito parcelado", cheque: "Cheque" };
const nomeForma = (f) => NOMES_FORMA[f] || f;

// ---------- Clientes (cadastro) ----------

function renderClientes(alvo, r) {
  const saldo = Object.fromEntries(r.porCliente.filter((c) => c.clienteId).map((c) => [c.clienteId, c]));
  const lista = (window.Clientes?.lista || []).filter((c) => confere(c.nome, c.telefone));
  const ed = estado.editandoCliente;
  alvo.innerHTML = `
    <form id="rc-cliente-form" class="fin-form rc-cliente-form">
      <div class="form-row">
        <div class="form-group"><label for="rc-cli-nome">${ed ? "Editar cliente" : "Novo cliente"}: nome</label><input type="text" id="rc-cli-nome" maxlength="120" required value="${esc(ed?.nome || "")}"></div>
        <div class="form-group"><label for="rc-cli-tel">WhatsApp com DDD (opcional)</label><input type="tel" id="rc-cli-tel" maxlength="20" placeholder="(47) 99999-1234" value="${esc(ed?.telefone || "")}"></div>
        <div class="form-group"><label for="rc-cli-obs">Observação</label><input type="text" id="rc-cli-obs" maxlength="500" placeholder="Ex: paga todo dia 10" value="${esc(ed?.obs || "")}"></div>
      </div>
      <div class="export-actions">
        ${ed ? '<button type="button" class="btn-icon" id="rc-cli-cancelar">Cancelar</button>' : ""}
        <button type="submit" class="btn-primary">${ed ? "Salvar alterações" : "+ Cadastrar cliente"}</button>
      </div>
    </form>
    <div class="table-container"><table class="tabela-fin">
      <thead><tr><th>Cliente</th><th>WhatsApp</th><th>Observação</th><th class="num">Em aberto</th><th></th></tr></thead>
      <tbody>${lista.map((c) => `<tr><td><strong>${esc(c.nome)}</strong></td><td>${esc(c.telefone || "—")}</td><td>${esc(c.obs || "")}</td>
        <td class="num">${saldo[c.id]?.aberto ? moeda(saldo[c.id].aberto) : "—"}</td>
        <td><button class="btn-icon mini" data-rc-editar="${esc(c.id)}">Editar</button></td></tr>`).join("")
        || '<tr><td colspan="5" class="texto-suave">Nenhum cliente cadastrado.</td></tr>'}</tbody>
    </table></div>
    <p class="texto-suave">O mesmo cadastro dos orçamentos. Cliente sem WhatsApp fica com um código (C1, C2…).</p>`;
  $("rc-cliente-form").addEventListener("submit", salvarClienteForm);
  $("rc-cli-cancelar")?.addEventListener("click", () => { estado.editandoCliente = null; renderConteudo(); });
}

async function salvarClienteForm(e) {
  e.preventDefault();
  const tel = $("rc-cli-tel").value.trim();
  if (tel && !normalizarTelefone(tel).ok) return alert(normalizarTelefone(tel).erro);
  const ed = estado.editandoCliente;
  try {
    await window.Clientes.salvar({ id: ed?.id, nome: $("rc-cli-nome").value.trim(), telefone: tel, obs: $("rc-cli-obs").value.trim() });
  } catch (err) {
    return alert(`O cliente não foi salvo: ${err.message}`);
  }
  estado.editandoCliente = null;
  render(estado.el);
}

// ---------- Receber ----------

function abrirReceber(c) {
  if (C().somenteLeitura) return alert("Sem conexão com a nuvem. Nada pode ser lançado.");
  estado.atual = c;
  const abertas = c.dividas.filter((d) => d.aberto > 0);
  $("rc-receber-titulo").textContent = `Receber de ${c.cliente}`;
  $("rc-receber-info").innerHTML = `Em aberto: <strong>${moeda(c.aberto)}</strong>${c.atrasado ? ` · atrasado ${moeda(c.atrasado)}` : ""}`;
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
    id: C().novoId("R"), v: 2, conta: "recebimento", value: Math.round(valor * 100) / 100, competencia: $("rc-data").value || hoje(),
    clienteId: c.clienteId, cliente: c.cliente, pagamentos, description: $("rc-desc").value.trim() || `Recebimento de ${c.cliente}`,
  };
  if ($("rc-abater").value) item.vendaIds = [$("rc-abater").value];
  if (await C().gravar([item])) {
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
  const lista = r.porCliente.filter((c) => c.aberto > 0);
  el.innerHTML = `
  <section class="glass-panel">
    <div class="painel-titulo"><h2>A receber por cliente</h2><span class="texto-suave">posição de ${dataBR(hoje())}</span></div>
    <div class="table-container"><table class="tabela-fin">
      <thead><tr><th>Cliente</th><th>WhatsApp</th><th class="num">Em aberto</th><th class="num">Atrasado</th><th class="num">Maior atraso</th><th>Próximo vencimento</th></tr></thead>
      <tbody>${lista.map((c) => `<tr><td>${esc(c.cliente)}</td><td>${esc(c.telefone || "—")}</td><td class="num">${moeda(c.aberto)}</td>
        <td class="num">${c.atrasado ? moeda(c.atrasado) : "—"}</td><td class="num">${c.maiorAtraso ? `${c.maiorAtraso} dia(s)` : "—"}</td><td>${c.proximoVencimento ? dataBR(c.proximoVencimento) : "—"}</td></tr>`).join("")
        || '<tr><td colspan="6" class="texto-suave">Nada a receber.</td></tr>'}</tbody>
      <tfoot><tr class="dre-total"><td colspan="2">Total</td><td class="num">${moeda(r.totalAberto)}</td><td class="num">${moeda(r.totalAtrasado)}</td><td colspan="2"></td></tr></tfoot>
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
  const b = e.target.closest("[data-rc], [data-rc-estornar], [data-rc-editar]");
  if (!b || !estado.el?.contains(b)) return;
  if (b.dataset.rcEstornar) {
    if (confirm("Estornar este recebimento? O valor volta a ficar em aberto para o cliente.")) C().excluir(b.dataset.rcEstornar);
    return;
  }
  if (b.dataset.rcEditar) {
    estado.editandoCliente = window.Clientes.porId(b.dataset.rcEditar);
    renderConteudo();
    $("rc-cli-nome")?.focus();
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
$("rc-receber-form").addEventListener("submit", salvarRecebimento);
$("rc-receber-cancelar").addEventListener("click", fecharReceber);
$("rc-valor").addEventListener("input", (e) => estado.editor?.definirTotal(num(e.target.value) || 0));

window.ReceberUI = { render, relatorio, abertasDoCliente };
