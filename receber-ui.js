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
  : d.situacao === "em_aberto" ? `<span class="tag tag-cc">em aberto há ${d.diasEmAberto} dia(s)</span>`
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
    <div class="total-bloco"><span>A receber (fiado)</span><strong>${moeda(r.totalAberto)}</strong><small class="texto-suave">${r.porCliente.filter((c) => c.aberto > 0).length} cliente(s)</small>${r.totalContaCorrente ? `<small class="texto-suave">conta corrente ${moeda(r.totalContaCorrente)} · com vencimento ${moeda(r.totalComVencimento)}</small>` : ""}${r.comAlerta ? `<small><span class="tag tag-alerta">⚠ ${r.comAlerta} conta(s) corrente(s) com alerta</span></small>` : ""}</div>
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
  const cc = lista.filter((c) => c.contaCorrente);
  const comVenc = lista.filter((c) => !c.contaCorrente);
  alvo.innerHTML = `
    <label class="check texto-suave"><input type="checkbox" id="rc-quitados" ${estado.quitados ? "checked" : ""}> Mostrar também quem já pagou tudo</label>
    <div class="receber-secao-titulo"><h3>Conta corrente</h3><span class="texto-suave">sem vencimento: nunca fica atrasado · ${moeda(r.totalContaCorrente)}</span></div>
    <div class="table-container"><table class="tabela-fin tabela-receber" id="rc-tabela-cc">
      <thead><tr><th>Cliente</th><th class="num">Em aberto</th><th>Em aberto há</th><th>Último pagamento</th><th>Alerta</th><th>Ações</th></tr></thead>
      <tbody>${cc.map((c) => linhaCliente(c)).join("") || '<tr><td colspan="6" class="texto-suave">Nenhum cliente de conta corrente em aberto. Marque "Conta corrente" no cadastro do cliente (Clientes).</td></tr>'}</tbody>
    </table></div>
    <div class="receber-secao-titulo"><h3>Fiado com vencimento</h3><span class="texto-suave">${moeda(r.totalComVencimento)}</span></div>
    <div class="table-container"><table class="tabela-fin tabela-receber" id="rc-tabela-venc">
      <thead><tr><th>Cliente</th><th class="num">Em aberto</th><th class="num">Atrasado</th><th class="num">Maior atraso</th><th>Próximo vencimento</th><th>Ações</th></tr></thead>
      <tbody>${comVenc.map((c) => linhaCliente(c)).join("") || '<tr><td colspan="6" class="texto-suave">Ninguém devendo. As vendas em "Fiado (a receber)" aparecem aqui.</td></tr>'}</tbody>
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
const temVia = (d) => d.tipo === "fiado" && C().itens.some((l) => String(l.id) === String(d.origemId));

// Conta corrente e alertas, direto no detalhe do cliente (o mesmo que Clientes › Editar)
function formAlerta(c) {
  if (!c.clienteId) return '<p class="texto-suave">Cliente sem cadastro: cadastre em Clientes para usar conta corrente e alertas.</p>';
  return `<form class="rc-alerta-form fin-form" data-cliente="${esc(c.clienteId)}">
    <div class="form-row">
      <div class="form-group"><label class="check"><input type="checkbox" class="rc-al-cc" ${c.contaCorrente ? "checked" : ""}> Conta corrente (sem vencimento)</label></div>
      <div class="form-group"><label>Alerta: limite em R$</label><input type="number" class="rc-al-limite" step="0.01" min="0" inputmode="decimal" placeholder="em branco = sem alerta" value="${c.alertaLimite ?? ""}" ${c.contaCorrente ? "" : "disabled"}></div>
      <div class="form-group"><label>Alerta: dias sem pagar</label><input type="number" class="rc-al-dias" step="1" min="1" inputmode="numeric" placeholder="em branco = sem alerta" value="${c.alertaDias ?? ""}" ${c.contaCorrente ? "" : "disabled"}></div>
      <div class="form-group"><button type="submit" class="btn-icon">Salvar alerta</button></div>
    </div>
  </form>`;
}

function detalheCliente(c) {
  return `<div class="receber-detalhe">
    ${formAlerta(c)}
    <table class="tabela-fin">
      <thead><tr><th>Data</th><th>O quê</th><th>Vencimento</th><th class="num">Valor</th><th class="num">Pago</th><th class="num">Em aberto</th><th>Situação</th></tr></thead>
      <tbody>${c.dividas.map((d) => `<tr><td>${dataBR(d.data)}</td><td>${esc(d.descricao)}${temVia(d) ? ` <button class="btn-icon mini" data-rc-via="${esc(d.origemId)}" title="Imprimir as 2 vias (loja e cliente)">🖨 Via</button>` : ""}</td><td>${c.contaCorrente ? "conta corrente" : dataBR(d.vencimento)}</td>
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
      <div class="form-row">
        <div class="form-group"><label class="check"><input type="checkbox" id="rc-cli-cc" ${ed?.contaCorrente ? "checked" : ""}> Conta corrente (sem vencimento)</label>
          <small class="texto-suave">Cliente antigo e de confiança: o fiado não vence e nunca aparece como atrasado.</small></div>
        <div class="form-group rc-cli-alerta"><label for="rc-cli-limite">Alerta: limite em R$</label><input type="number" id="rc-cli-limite" step="0.01" min="0" inputmode="decimal" placeholder="em branco = sem alerta" value="${ed?.alertaLimite ?? ""}"></div>
        <div class="form-group rc-cli-alerta"><label for="rc-cli-dias">Alerta: dias sem pagar</label><input type="number" id="rc-cli-dias" step="1" min="1" inputmode="numeric" placeholder="em branco = sem alerta" value="${ed?.alertaDias ?? ""}"></div>
      </div>
      <div class="export-actions">
        ${ed ? '<button type="button" class="btn-icon" id="rc-cli-cancelar">Cancelar</button>' : ""}
        <button type="submit" class="btn-primary">${ed ? "Salvar alterações" : "+ Cadastrar cliente"}</button>
      </div>
    </form>
    <div class="table-container"><table class="tabela-fin">
      <thead><tr><th>Cliente</th><th>Tipo</th><th>WhatsApp</th><th>Observação</th><th class="num">Em aberto</th><th></th></tr></thead>
      <tbody>${lista.map((c) => `<tr><td><strong>${esc(c.nome)}</strong></td>
        <td>${c.contaCorrente ? `<span class="tag tag-cc">Conta corrente</span><small>${esc(textoAlerta(c))}</small>` : '<span class="texto-suave">Fiado com vencimento</span>'}</td>
        <td>${esc(c.telefone || "—")}</td><td>${esc(c.obs || "")}</td>
        <td class="num">${saldo[c.id]?.aberto ? moeda(saldo[c.id].aberto) : "—"}</td>
        <td><button class="btn-icon mini" data-rc-editar="${esc(c.id)}">Editar</button></td></tr>`).join("")
        || '<tr><td colspan="6" class="texto-suave">Nenhum cliente cadastrado.</td></tr>'}</tbody>
    </table></div>
    <p class="texto-suave">O mesmo cadastro dos orçamentos. Cliente sem WhatsApp fica com um código (C1, C2…).</p>`;
  $("rc-cliente-form").addEventListener("submit", salvarClienteForm);
  $("rc-cli-cancelar")?.addEventListener("click", () => { estado.editandoCliente = null; renderConteudo(); });
  const mostrarAlertas = () => document.querySelectorAll(".rc-cli-alerta").forEach((g) => { g.hidden = !$("rc-cli-cc").checked; });
  $("rc-cli-cc").addEventListener("change", mostrarAlertas);
  mostrarAlertas();
}

async function salvarClienteForm(e) {
  e.preventDefault();
  const tel = $("rc-cli-tel").value.trim();
  if (tel && !normalizarTelefone(tel).ok) return alert(normalizarTelefone(tel).erro);
  const ed = estado.editandoCliente;
  try {
    const cc = $("rc-cli-cc").checked;
    await window.Clientes.salvar({
      id: ed?.id, nome: $("rc-cli-nome").value.trim(), telefone: tel, obs: $("rc-cli-obs").value.trim(),
      contaCorrente: cc, alertaLimite: cc ? $("rc-cli-limite").value.trim() : "", alertaDias: cc ? $("rc-cli-dias").value.trim() : "",
    });
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
  $("rc-receber-info").innerHTML = `Em aberto: <strong>${moeda(c.aberto)}</strong>${c.atrasado ? ` · atrasado ${moeda(c.atrasado)}` : ""}${c.contaCorrente && c.aberto ? ` · conta corrente, em aberto há ${c.diasEmAberto} dia(s)` : ""}`;
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
  const lista = r.porCliente.filter((c) => c.aberto > 0 && !c.contaCorrente);
  const cc = r.porCliente.filter((c) => c.aberto > 0 && c.contaCorrente);
  el.innerHTML = `
  <section class="glass-panel">
    <div class="painel-titulo"><h2>Conta corrente</h2><span class="texto-suave">posição de ${dataBR(hoje())} · sem vencimento</span></div>
    <div class="table-container"><table class="tabela-fin">
      <thead><tr><th>Cliente</th><th>WhatsApp</th><th class="num">Em aberto</th><th>Em aberto há</th><th>Último pagamento</th><th>Alerta</th></tr></thead>
      <tbody>${cc.map((c) => `<tr><td>${esc(c.cliente)}</td><td>${esc(c.telefone || "—")}</td><td class="num">${moeda(c.aberto)}</td>
        <td>${c.diasEmAberto} dia(s) (desde ${dataBR(c.emAbertoDesde)})</td><td>${c.ultimoPagamento ? dataBR(c.ultimoPagamento) : "—"}</td>
        <td>${c.alertas.map((a) => `⚠ ${esc(a.texto)}`).join("; ") || "—"}</td></tr>`).join("")
        || '<tr><td colspan="6" class="texto-suave">Nenhuma conta corrente em aberto.</td></tr>'}</tbody>
      <tfoot><tr class="dre-total"><td colspan="2">Total conta corrente</td><td class="num">${moeda(r.totalContaCorrente)}</td><td colspan="3"></td></tr></tfoot>
    </table></div>
  </section>
  <section class="glass-panel">
    <div class="painel-titulo"><h2>Fiado com vencimento</h2><span class="texto-suave">posição de ${dataBR(hoje())}</span></div>
    <div class="table-container"><table class="tabela-fin">
      <thead><tr><th>Cliente</th><th>WhatsApp</th><th class="num">Em aberto</th><th class="num">Atrasado</th><th class="num">Maior atraso</th><th>Próximo vencimento</th></tr></thead>
      <tbody>${lista.map((c) => `<tr><td>${esc(c.cliente)}</td><td>${esc(c.telefone || "—")}</td><td class="num">${moeda(c.aberto)}</td>
        <td class="num">${c.atrasado ? moeda(c.atrasado) : "—"}</td><td class="num">${c.maiorAtraso ? `${c.maiorAtraso} dia(s)` : "—"}</td><td>${c.proximoVencimento ? dataBR(c.proximoVencimento) : "—"}</td></tr>`).join("")
        || '<tr><td colspan="6" class="texto-suave">Nada a receber.</td></tr>'}</tbody>
      <tfoot><tr class="dre-total"><td colspan="2">Total com vencimento</td><td class="num">${moeda(r.totalComVencimento)}</td><td class="num">${moeda(r.totalAtrasado)}</td><td colspan="2"></td></tr></tfoot>
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
  const b = e.target.closest("[data-rc], [data-rc-estornar], [data-rc-editar], [data-rc-via]");
  if (!b || !estado.el?.contains(b)) return;
  if (b.dataset.rcVia) {
    window.Via?.imprimir(C().itens.find((l) => String(l.id) === String(b.dataset.rcVia)));
    return;
  }
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
document.addEventListener("change", (e) => {
  if (!e.target.classList.contains("rc-al-cc")) return;
  const f = e.target.closest("form");
  f.querySelectorAll(".rc-al-limite, .rc-al-dias").forEach((i) => { i.disabled = !e.target.checked; });
});
document.addEventListener("submit", async (e) => {
  const f = e.target.closest(".rc-alerta-form");
  if (!f) return;
  e.preventDefault();
  const cad = window.Clientes.porId(f.dataset.cliente);
  if (!cad) return alert("Cliente não encontrado no cadastro.");
  const cc = f.querySelector(".rc-al-cc").checked;
  try {
    await window.Clientes.salvar({
      id: cad.id, nome: cad.nome, telefone: cad.telefone || "", obs: cad.obs || "", contaCorrente: cc,
      alertaLimite: cc ? f.querySelector(".rc-al-limite").value.trim() : "", alertaDias: cc ? f.querySelector(".rc-al-dias").value.trim() : "",
    });
  } catch (err) {
    return alert(`O alerta não foi salvo: ${err.message}`);
  }
  renderConteudo();
});
$("rc-receber-form").addEventListener("submit", salvarRecebimento);
$("rc-receber-cancelar").addEventListener("click", fecharReceber);
$("rc-valor").addEventListener("input", (e) => estado.editor?.definirTotal(num(e.target.value) || 0));

window.ReceberUI = { render, relatorio, abertasDoCliente };
