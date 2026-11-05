// Clientes e Orçamentos › Clientes: lista com busca, ficha (pedidos, orçamentos, fiado) e o cadastro em 3 blocos
// (Contato · Endereço e documentos · Fiado). Inativar/reativar e excluir para sempre (digitando EXCLUIR).
// O mesmo formulário abre de qualquer tela pelo "+ cadastrar novo" (window.ClientesUI.novo).
import { contasAReceber, prazoDoCliente } from "./lib/receber.js";
import { normalizarTelefone } from "./lib/orcamentos.js";
import { hojeSP } from "./lib/datas.js";
import { FORMAS_PADRAO } from "./lib/planoContas.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const moeda = (v) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v || 0);
const dataBR = (d) => (d ? String(d).slice(0, 10).split("-").reverse().join("/") : "—");
const semAcento = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const C = () => window.Caixa;
const hoje = () => C()?.hoje() || hojeSP();
const NOMES_FORMA = Object.fromEntries(FORMAS_PADRAO.map((f) => [f.id, f.nome.replace(/\s*\(.*\)$/, "")]));

const estado = { busca: "", filtro: "ativos", ficha: null, form: null };

// ---------- Dados ----------

function dados() {
  const clientes = window.Clientes?.lista || [];
  const r = C() ? contasAReceber(C().itens || [], C().configFinanceiro, hoje(), clientes) : { porCliente: [] };
  const saldo = new Map(r.porCliente.filter((c) => c.clienteId).map((c) => [String(c.clienteId), c]));
  const vendas = new Map();
  for (const l of C()?.itens || []) {
    if (l.conta !== "venda_produtos" || !l.clienteId) continue;
    const k = String(l.clienteId);
    if (!vendas.has(k)) vendas.set(k, []);
    vendas.get(k).push(l);
  }
  for (const v of vendas.values()) v.sort((a, b) => (b.competencia || "").localeCompare(a.competencia || "") || String(b.numero || "").localeCompare(String(a.numero || "")));
  return { clientes, saldo, vendas };
}

const orcamentosDe = (id) => (window.Orcamentos?.lista || []).filter((o) => String(o.cliente?.id) === String(id))
  .sort((a, b) => (b.data || "").localeCompare(a.data || ""));

const textoPrazo = (c) => {
  const p = prazoDoCliente(c, C()?.configFinanceiro);
  if (p.semPrazo) return "Sem prazo (acerta quando juntar)";
  return p.proprio ? `${p.dias} dias` : `${p.dias} dias (padrão)`;
};
const textoAlerta = (c) => [c.alertaLimite != null ? `limite ${moeda(c.alertaLimite)}` : "", c.alertaDias != null ? `${c.alertaDias} dias sem pagar` : ""].filter(Boolean).join(" · ");

// ---------- Lista ----------

function render() {
  const el = $("co-clientes");
  if (!el) return;
  if (estado.ficha) return renderFicha(el);
  const { clientes, saldo, vendas } = dados();
  const b = semAcento(estado.busca.trim());
  const dig = estado.busca.replace(/\D/g, "");
  const lista = clientes.filter((c) => {
    if (estado.filtro === "ativos" && c.inativo) return false;
    if (estado.filtro === "inativos" && !c.inativo) return false;
    if (estado.filtro === "devendo" && !(saldo.get(String(c.id))?.aberto > 0)) return false;
    if (!b) return true;
    return semAcento(c.nome).includes(b) || (dig.length >= 3 && [c.telefone, c.fixo, c.documento].some((t) => String(t || "").replace(/\D/g, "").includes(dig)));
  });
  const nInativos = clientes.filter((c) => c.inativo).length;
  el.innerHTML = `
  <section class="glass-panel">
    <div class="painel-titulo orc-topo">
      <div class="segmentado" id="cli-filtro" role="radiogroup" aria-label="Quais clientes">
        ${[["ativos", "Ativos"], ["devendo", "Devendo"], ["inativos", `Inativos${nInativos ? ` (${nInativos})` : ""}`], ["todos", "Todos"]].map(([v, t]) =>
          `<label><input type="radio" name="cli-filtro" value="${v}" ${estado.filtro === v ? "checked" : ""}><span>${t}</span></label>`).join("")}
      </div>
      <div class="painel-acoes">
        <input type="search" id="cli-busca" class="orc-busca" placeholder="🔎 nome, telefone ou CPF/CNPJ" value="${esc(estado.busca)}" aria-label="Buscar cliente">
        <button type="button" class="btn-primary" id="cli-novo">+ Novo cliente</button>
      </div>
    </div>
    <div class="table-container"><table class="tabela-fin tabela-clientes">
      <thead><tr><th>Nome</th><th>WhatsApp</th><th>Cidade</th><th class="num">Em aberto</th><th>Último pedido</th></tr></thead>
      <tbody id="cli-body">${lista.map((c) => {
        const s = saldo.get(String(c.id));
        const v = vendas.get(String(c.id))?.[0];
        return `<tr class="linha-clicavel ${c.inativo ? "inativo" : ""}" data-cli="${esc(c.id)}">
          <td><strong>${esc(c.nome)}</strong>${c.inativo ? ' <span class="tag">inativo</span>' : ""}${c.contaCorrente ? ' <span class="tag tag-cc">sem prazo</span>' : ""}${s?.alertas?.length ? ' <span class="tag tag-alerta">⚠</span>' : ""}</td>
          <td>${esc(c.telefone || c.fixo || "—")}</td><td>${esc(c.cidade || "—")}</td>
          <td class="num ${s?.atrasado ? "type-expense" : ""}">${s?.aberto ? `<strong>${moeda(s.aberto)}</strong>` : "—"}</td>
          <td>${v ? `${esc(v.numero || "")} <small>${dataBR(v.competencia)}</small>` : "—"}</td></tr>`;
      }).join("") || `<tr><td colspan="5" class="texto-suave">${clientes.length ? "Nenhum cliente com esse filtro." : "Nenhum cliente cadastrado. Use \"+ Novo cliente\"."}</td></tr>`}</tbody>
    </table></div>
    <p class="texto-suave">Clique no cliente para abrir a ficha: pedidos, orçamentos, fiado, receber e cobrar.</p>
  </section>`;
  $("cli-filtro").addEventListener("change", (e) => { estado.filtro = e.target.value; render(); });
  $("cli-busca").addEventListener("input", (e) => { estado.busca = e.target.value; renderMantendoFoco(); });
  $("cli-novo").addEventListener("click", () => novo().then((c) => { if (c) abrirFicha(c.id); }));
  $("cli-body").addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-cli]");
    if (tr) abrirFicha(tr.dataset.cli);
  });
}

// Redesenha a lista sem perder o que está sendo digitado na busca
function renderMantendoFoco() {
  const pos = $("cli-busca")?.selectionStart;
  render();
  const b = $("cli-busca");
  if (b) { b.focus(); try { b.setSelectionRange(pos, pos); } catch { /* campo de busca sem seleção */ } }
}

// ---------- Ficha ----------

function abrirFicha(id) {
  estado.ficha = String(id);
  window.switchTab?.("orcamentos");
  mostrarSub("clientes");
  render();
  $("co-clientes")?.scrollIntoView({ block: "start" });
}

function renderFicha(el) {
  const c = window.Clientes?.porId(estado.ficha);
  if (!c) { estado.ficha = null; return render(); }
  const { saldo, vendas } = dados();
  const s = saldo.get(String(c.id));
  const tel = normalizarTelefone(c.telefone);
  const peds = vendas.get(String(c.id)) || [];
  const orcs = orcamentosDe(c.id);
  const endereco = [c.endereco, c.bairro, [c.cidade, c.uf].filter(Boolean).join(" – ")].filter(Boolean).join(", ");
  el.innerHTML = `
  <section class="glass-panel ficha-cliente">
    <div class="painel-titulo">
      <div><h2>${esc(c.nome)} ${c.inativo ? '<span class="tag">inativo</span>' : ""}</h2>
        <small class="texto-suave">${[c.telefone && `WhatsApp ${esc(c.telefone)}`, c.fixo && `fixo ${esc(c.fixo)}`].filter(Boolean).join(" · ") || "sem telefone"}</small></div>
      <button type="button" class="btn-icon" id="cli-voltar">← Clientes</button>
    </div>
    <div class="ficha-acoes">
      ${c.inativo ? "" : '<button type="button" class="btn-success" id="cli-nova-venda">Nova venda</button><button type="button" class="btn-icon" id="cli-novo-orc">Novo orçamento</button>'}
      ${s?.aberto > 0 ? '<button type="button" class="btn-icon destaque-verde" id="cli-receber">Receber</button>' : ""}
      ${s?.aberto > 0 && tel.ok ? '<button type="button" class="btn-icon" id="cli-cobrar">Cobrar no WhatsApp 💬</button>' : ""}
      <button type="button" class="btn-icon" id="cli-editar">Editar</button>
      <button type="button" class="btn-icon" id="cli-inativar">${c.inativo ? "Reativar" : "Inativar"}</button>
      <button type="button" class="btn-icon item-perigo so-dono" id="cli-excluir">Excluir para sempre</button>
    </div>
    <div class="ficha-grade">
      <div class="ficha-bloco"><h3>Dados</h3>
        <dl class="ficha-dados">
          <dt>Endereço</dt><dd>${esc(endereco || "—")}</dd>
          <dt>CPF/CNPJ</dt><dd>${esc(c.documento || "—")}</dd>
          <dt>Inscr. estadual</dt><dd>${esc(c.ie || "—")}</dd>
          <dt>Atendimento</dt><dd>${esc(c.obs || "—")}</dd>
        </dl></div>
      <div class="ficha-bloco"><h3>Fiado</h3>
        <dl class="ficha-dados">
          <dt>Em aberto</dt><dd><strong class="${s?.atrasado ? "type-expense" : ""}">${moeda(s?.aberto || 0)}</strong>${s?.aberto ? ` <small>desde ${dataBR(s.emAbertoDesde)}${s.atrasado ? ` · atrasado ${moeda(s.atrasado)}` : ""}</small>` : ""}${s?.credito > 0 ? ` <small class="texto-ok">crédito ${moeda(s.credito)}</small>` : ""}</dd>
          <dt>Prazo para pagar</dt><dd>${esc(textoPrazo(c))}</dd>
          ${c.contaCorrente ? `<dt>Alerta</dt><dd>${esc(textoAlerta(c) || "sem alerta")}${s?.alertas?.length ? `<br>${s.alertas.map((a) => `<span class="tag tag-alerta">⚠ ${esc(a.texto)}</span>`).join(" ")}` : ""}</dd>` : ""}
          <dt>Observação do fiado</dt><dd>${esc(c.obsFiado || "—")}</dd>
        </dl></div>
    </div>
    <h3>Pedidos</h3>
    <div class="table-container"><table class="tabela-fin">
      <thead><tr><th>Nº</th><th>Data</th><th>Forma</th><th class="num">Total</th><th></th></tr></thead>
      <tbody>${peds.slice(0, 50).map((l) => `<tr><td><strong>${esc(l.numero || "—")}</strong></td><td>${dataBR(l.competencia)}</td>
        <td>${esc((l.pagamentos || []).map((p) => NOMES_FORMA[p.forma] || p.forma).join(" + "))}</td><td class="num">${moeda(l.value)}</td>
        <td><button type="button" class="btn-icon mini" data-cli-vias="${esc(l.id)}">🖨 Vias</button></td></tr>`).join("")
        || '<tr><td colspan="5" class="texto-suave">Nenhum pedido ainda.</td></tr>'}</tbody>
    </table></div>
    <h3>Orçamentos</h3>
    <div class="table-container"><table class="tabela-fin">
      <thead><tr><th>Nº</th><th>Data</th><th>Situação</th><th class="num">Total</th></tr></thead>
      <tbody>${orcs.slice(0, 50).map((o) => `<tr><td><strong>${esc(o.id)}</strong></td><td>${dataBR(o.data)}</td>
        <td>${o.excluidoEm ? "na lixeira" : o.status === "fechado" ? "fechado (virou venda)" : o.status === "perdido" ? "perdido" : "em aberto"}</td><td class="num">${moeda(o.total)}</td></tr>`).join("")
        || '<tr><td colspan="4" class="texto-suave">Nenhum orçamento.</td></tr>'}</tbody>
    </table></div>
    ${s ? `<h3>Fiado: compras e pagamentos</h3>
    <div class="table-container"><table class="tabela-fin">
      <thead><tr><th>Data</th><th>O quê</th><th>Vencimento</th><th class="num">Valor</th><th class="num">Em aberto</th></tr></thead>
      <tbody>${s.dividas.map((d) => `<tr><td>${dataBR(d.data)}</td><td>${esc(d.descricao)}</td><td>${c.contaCorrente || !d.vencimento ? "sem prazo" : dataBR(d.vencimento)}</td>
        <td class="num">${moeda(d.valor)}</td><td class="num">${d.aberto ? `<strong>${moeda(d.aberto)}</strong>` : '<span class="texto-ok">pago</span>'}</td></tr>`).join("")}
        ${s.recebimentos.map((r) => `<tr class="linha-recebimento"><td>${dataBR(r.data)}</td><td>Pagamento (${esc(r.formas.map((f) => NOMES_FORMA[f] || f).join(" + "))})</td><td></td><td class="num texto-ok">−${moeda(r.valor)}</td><td></td></tr>`).join("")}</tbody>
    </table></div>` : ""}
  </section>`;
  $("cli-voltar").addEventListener("click", () => { estado.ficha = null; render(); });
  $("cli-editar").addEventListener("click", () => editar(c.id));
  $("cli-inativar").addEventListener("click", () => mudarSituacao(c));
  $("cli-excluir").addEventListener("click", () => excluir(c));
  $("cli-nova-venda")?.addEventListener("click", () => irParaVender(c, "venda"));
  $("cli-novo-orc")?.addEventListener("click", () => irParaVender(c, "orcamento"));
  $("cli-receber")?.addEventListener("click", () => window.ReceberUI?.abrirReceber(s));
  $("cli-cobrar")?.addEventListener("click", () => window.ReceberUI?.cobrar(s));
  el.querySelectorAll("[data-cli-vias]").forEach((b) => b.addEventListener("click", () => window.Vendas?.vias(b.dataset.cliVias)));
}

// Nova venda / novo orçamento: vai para o Vender com o cliente já escolhido
function irParaVender(c, tipo) {
  window.Calculadora?.definirClientePedido({ id: c.id, nome: c.nome, telefone: c.telefone || "" });
  window.switchTab?.("vender");
  if (tipo === "orcamento") alert(`Monte o pedido e clique "💾 Salvar como orçamento": o cliente ${c.nome} já vem preenchido.`);
  $("material")?.focus();
}

async function mudarSituacao(c) {
  const inativar = !c.inativo;
  if (inativar && !confirm(`Inativar ${c.nome}?\n\nO cliente some das buscas do Vender e dos orçamentos. O histórico, o fiado e os pedidos continuam. Dá para reativar quando quiser.`)) return;
  try {
    await window.api("/api/clientes", { method: "PATCH", body: { id: c.id, acao: inativar ? "inativar" : "reativar" } });
    await window.Clientes.carregar();
    render();
  } catch (e) { alert(`Não foi possível: ${e.message}`); }
}

async function excluir(c) {
  let imp;
  try { imp = await window.api(`/api/clientes?impacto=${encodeURIComponent(c.id)}`); } catch (e) { return alert(e.message); }
  if (imp.deve > 0.004) return alert(`Receba ou estorne o saldo de ${moeda(imp.deve)} antes de excluir ${c.nome}.`);
  if (imp.chequesValor > 0.004) return alert(`${c.nome} tem ${moeda(imp.chequesValor)} em cheques na carteira. Espere compensar (ou registre a devolução) antes de excluir.`);
  const texto = [
    `${c.nome} sai do cadastro de vez (não dá para desfazer).`,
    imp.vendas ? `${imp.vendas} venda(s) e recebimento(s) continuam no Caixa, com o nome em texto ("cliente excluído").` : "",
    imp.orcamentosApagados ? `${imp.orcamentosApagados} orçamento(s) dele (em aberto, perdidos ou na lixeira) também serão apagados.` : "",
    imp.orcamentosConvertidos ? `${imp.orcamentosConvertidos} orçamento(s) que viraram venda ficam, com o nome em texto.` : "",
    "Se só não quer mais ver o cliente, use Inativar.",
  ].filter(Boolean).join("\n");
  if (!(await window.CaixaUI.confirmarExcluir(`Excluir ${c.nome} para sempre?`, texto))) return;
  try {
    await window.api("/api/clientes", { method: "PATCH", body: { id: c.id, acao: "excluir", confirmacao: "EXCLUIR" } });
  } catch (e) { return alert(`Não foi excluído: ${e.message}`); }
  estado.ficha = null;
  await Promise.all([window.Clientes.carregar(), C()?.recarregar(), window.Orcamentos?.recarregar()]);
  render();
}

// ---------- Cadastro (3 blocos) ----------

function garantirModal() {
  if ($("modal-cliente")) return;
  document.body.insertAdjacentHTML("beforeend", `<div id="modal-cliente" class="modal-overlay" style="display:none">
    <form class="modal-content glass-panel modal-cliente fin-form" id="cli-form" novalidate>
      <h2 id="cli-form-titulo">Novo cliente</h2>
      <fieldset class="cli-bloco"><legend>Contato</legend>
        <div class="form-row">
          <div class="form-group"><label for="cli-nome">Nome *</label><input type="text" id="cli-nome" maxlength="120" autocomplete="off"></div>
          <div class="form-group"><label for="cli-tel">WhatsApp com DDD</label><input type="tel" id="cli-tel" maxlength="20" placeholder="(41) 99999-1234"></div>
          <div class="form-group"><label for="cli-fixo">Telefone fixo</label><input type="tel" id="cli-fixo" maxlength="20"></div>
        </div>
        <div class="form-group"><label for="cli-obs">Observação do atendimento</label><input type="text" id="cli-obs" maxlength="500" placeholder="Ex: prefere entrega pela manhã"></div>
      </fieldset>
      <fieldset class="cli-bloco"><legend>Endereço e documentos <small class="texto-suave">(saem na via)</small></legend>
        <div class="form-row">
          <div class="form-group"><label for="cli-endereco">Endereço</label><input type="text" id="cli-endereco" maxlength="160"></div>
          <div class="form-group"><label for="cli-bairro">Bairro</label><input type="text" id="cli-bairro" maxlength="80"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label for="cli-cidade">Cidade</label><input type="text" id="cli-cidade" maxlength="80"></div>
          <div class="form-group cli-uf"><label for="cli-uf">UF</label><input type="text" id="cli-uf" maxlength="2" placeholder="PR"></div>
          <div class="form-group"><label for="cli-documento">CPF/CNPJ</label><input type="text" id="cli-documento" maxlength="20" inputmode="numeric"></div>
          <div class="form-group"><label for="cli-ie">Inscr. estadual</label><input type="text" id="cli-ie" maxlength="20"></div>
        </div>
      </fieldset>
      <fieldset class="cli-bloco"><legend>Fiado</legend>
        <div class="form-group"><span class="rotulo">Prazo para pagar</span>
          <div class="cli-prazo" id="cli-prazo" role="radiogroup" aria-label="Prazo para pagar">
            <label class="check"><input type="radio" name="cli-prazo" value="padrao" checked> <span id="cli-prazo-padrao">30 dias (padrão)</span></label>
            <label class="check"><input type="radio" name="cli-prazo" value="outro"> Outro: <input type="number" id="cli-prazo-dias" min="1" max="3650" step="1" inputmode="numeric" class="cli-dias"> dias</label>
            <label class="check"><input type="radio" name="cli-prazo" value="sem"> Sem prazo (acerta quando juntar)</label>
          </div></div>
        <div class="form-row" id="cli-alertas" hidden>
          <div class="form-group"><label for="cli-limite">Alerta: limite em R$</label><input type="number" id="cli-limite" step="0.01" min="0" inputmode="decimal" placeholder="em branco = sem alerta"></div>
          <div class="form-group"><label for="cli-dias">Alerta: dias sem pagar</label><input type="number" id="cli-dias" step="1" min="1" inputmode="numeric" placeholder="em branco = sem alerta"></div>
        </div>
        <div class="form-group"><label for="cli-obs-fiado">Observação do fiado</label><input type="text" id="cli-obs-fiado" maxlength="500" placeholder="Ex: paga todo dia 10"></div>
      </fieldset>
      <div class="export-actions"><button type="button" class="btn-icon" id="cli-cancelar">Cancelar</button><button type="submit" class="btn-primary" id="cli-salvar">Salvar cliente</button></div>
    </form></div>`);
  const mostrarAlertas = () => {
    const v = document.querySelector('input[name="cli-prazo"]:checked')?.value;
    $("cli-alertas").hidden = v !== "sem";
  };
  $("cli-prazo").addEventListener("change", mostrarAlertas);
  $("cli-prazo-dias").addEventListener("input", () => { document.querySelector('input[name="cli-prazo"][value="outro"]').checked = true; mostrarAlertas(); });
  $("cli-cancelar").addEventListener("click", () => fecharForm(null));
  $("cli-form").addEventListener("submit", salvarForm);
  // Enter passa de campo; salvar é só pelo botão
  $("cli-form").addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.isComposing || e.target.tagName === "BUTTON") return;
    e.preventDefault();
    const campos = [...$("cli-form").querySelectorAll("input")].filter((i) => (i.type !== "radio" || i.checked) && i.offsetParent !== null);
    campos[campos.indexOf(e.target) + 1]?.focus();
  });
  estado.mostrarAlertas = mostrarAlertas;
}

/** Abre o cadastro. Devolve uma Promise com o cliente salvo (ou null se cancelar). */
function abrirForm(c = {}, titulo = "Novo cliente") {
  garantirModal();
  $("cli-form-titulo").textContent = titulo;
  const campos = { nome: c.nome, tel: c.telefone, fixo: c.fixo, obs: c.obs, endereco: c.endereco, bairro: c.bairro, cidade: c.cidade, uf: c.uf, documento: c.documento, ie: c.ie,
    limite: c.alertaLimite ?? "", dias: c.alertaDias ?? "", "obs-fiado": c.obsFiado, "prazo-dias": c.prazoDias ?? "" };
  for (const [k, v] of Object.entries(campos)) $(`cli-${k}`).value = v ?? "";
  const padrao = prazoDoCliente(null, C()?.configFinanceiro).padrao;
  $("cli-prazo-padrao").textContent = `${padrao} dias (padrão)`;
  const modo = c.contaCorrente ? "sem" : c.prazoDias ? "outro" : "padrao";
  document.querySelectorAll('input[name="cli-prazo"]').forEach((r) => { r.checked = r.value === modo; });
  estado.mostrarAlertas();
  $("modal-cliente").style.display = "flex";
  $("cli-nome").focus();
  return new Promise((resolve) => { estado.form = { id: c.id || null, resolve }; });
}

function fecharForm(resultado) {
  $("modal-cliente").style.display = "none";
  const f = estado.form;
  estado.form = null;
  f?.resolve(resultado);
}

async function salvarForm(e) {
  e.preventDefault();
  const botao = $("cli-salvar");
  if (botao.disabled) return;
  const nome = $("cli-nome").value.trim();
  if (!nome) { alert("Informe o nome do cliente."); return $("cli-nome").focus(); }
  const tel = $("cli-tel").value.trim();
  if (tel && !normalizarTelefone(tel).ok) { alert(normalizarTelefone(tel).erro); return $("cli-tel").focus(); }
  const prazo = document.querySelector('input[name="cli-prazo"]:checked')?.value || "padrao";
  const dias = $("cli-prazo-dias").value.trim();
  if (prazo === "outro" && !(Number(dias) >= 1)) { alert("Informe o prazo em dias (ou escolha o padrão)."); return $("cli-prazo-dias").focus(); }
  const sem = prazo === "sem";
  const cliente = {
    id: estado.form?.id || undefined, nome, telefone: tel, fixo: $("cli-fixo").value.trim(), obs: $("cli-obs").value.trim(),
    endereco: $("cli-endereco").value.trim(), bairro: $("cli-bairro").value.trim(), cidade: $("cli-cidade").value.trim(),
    uf: $("cli-uf").value.trim(), documento: $("cli-documento").value.trim(), ie: $("cli-ie").value.trim(),
    contaCorrente: sem, prazoDias: prazo === "outro" ? Number(dias) : "",
    alertaLimite: sem ? $("cli-limite").value.trim() : "", alertaDias: sem ? $("cli-dias").value.trim() : "",
    obsFiado: $("cli-obs-fiado").value.trim(),
  };
  botao.disabled = true;
  try {
    const salvo = await window.Clientes.salvar(cliente);
    fecharForm(salvo);
    render();
  } catch (err) {
    alert(`O cliente não foi salvo: ${err.message}`);
  } finally {
    botao.disabled = false;
  }
}

function novo(pre = {}) {
  return abrirForm({ nome: pre.nome || "", telefone: pre.telefone || "" }, "Novo cliente");
}
function editar(id) {
  const c = window.Clientes?.porId(id);
  if (!c) return Promise.resolve(null);
  return abrirForm(c, `Editar ${c.nome}`);
}

// ---------- Sub-abas Orçamentos | Clientes ----------

function mostrarSub(sub) {
  document.querySelectorAll("#co-subtabs .subtab").forEach((b) => b.classList.toggle("ativo", b.dataset.co === sub));
  $("co-orcamentos").hidden = sub !== "orcamentos";
  $("co-clientes").hidden = sub !== "clientes";
  if (sub === "clientes") {
    if (!window.Clientes?.lista?.length) window.Clientes?.carregar().then(render);
    window.Orcamentos?.abrir();
    render();
  }
}
$("co-subtabs")?.addEventListener("click", (e) => {
  const b = e.target.closest(".subtab");
  if (!b) return;
  if (b.dataset.co === "clientes") estado.ficha = null;
  mostrarSub(b.dataset.co);
});

window.ClientesUI = {
  novo, editar, abrirFicha,
  atualizar() { if ($("co-clientes") && !$("co-clientes").hidden) render(); },
};
