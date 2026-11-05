// Bloco "Cliente" do pedido (aba Vender): nome, WhatsApp, CPF/CNPJ, endereço, bairro, cidade, observação de entrega e
// inscrição estadual ("+ mais dados"). Tudo opcional e tudo sai nas vias.
//   - Cliente cadastrado (escolhido na sugestão): a venda fica na ficha dele; mudar um campo aqui vale só para esta via.
//   - Compra de uma vez: os dados ficam só na venda (clienteVia).
//   - "Salvar como cliente": cria o cadastro ao registrar (nunca com WhatsApp ou CPF/CNPJ de outro: oferece vincular).
//   - Fiado: exige nome e WhatsApp; cliente novo é cadastrado com o prazo padrão.
import { normalizarTelefone } from "./lib/orcamentos.js";
import { prazoDoCliente } from "./lib/receber.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const CAMPOS = { nome: "cp-nome", telefone: "cp-tel", documento: "cp-doc", endereco: "cp-endereco", bairro: "cp-bairro", cidade: "cp-cidade", obs: "cp-obs", ie: "cp-ie" };
const chave = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase().replace(/\s+/g, " ");
const digitos = (s) => String(s || "").replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
const lista = () => window.Clientes?.lista || [];
const porId = (id) => lista().find((c) => String(c.id) === String(id)) || null;

const estado = { id: null };

function dados() {
  return Object.fromEntries(Object.entries(CAMPOS).map(([k, id]) => [k, $(id)?.value.trim() || ""]));
}
const temDados = (d = dados()) => Object.values(d).some(Boolean);
function preencher(d) {
  for (const [k, id] of Object.entries(CAMPOS)) if ($(id)) $(id).value = d[k] || "";
  if (d.ie) $("cp-mais").open = true;
}

// Outro cliente com o mesmo WhatsApp ou CPF/CNPJ (inclusive inativo)
function repetido(d = dados()) {
  const tel = digitos(d.telefone), doc = digitos(d.documento);
  for (const c of lista()) {
    if (estado.id && String(c.id) === String(estado.id)) continue;
    if (tel.length >= 10 && digitos(c.telefone) === tel) return { cliente: c, campo: "WhatsApp" };
    if (doc.length >= 11 && digitos(c.documento) === doc) return { cliente: c, campo: "CPF/CNPJ" };
  }
  return null;
}

function status(html) {
  $("cp-status").hidden = !html;
  // não redesenha à toa: um clique em "Vincular" logo depois de sair do campo não pode perder o botão
  if ($("cp-status").dataset.html !== (html || "")) { $("cp-status").innerHTML = html || ""; $("cp-status").dataset.html = html || ""; }
}

function render() {
  const cad = estado.id ? porId(estado.id) : null;
  $("cp-salvar-rotulo").hidden = Boolean(cad);
  if (cad) {
    status(`✓ <strong>Cliente cadastrado:</strong> ${esc(cad.nome)}: a venda fica na ficha dele. Mudar um campo aqui vale só para esta via. <button type="button" class="link-suave" data-cp="desvincular">Desvincular</button>`);
    return;
  }
  const dup = repetido();
  if (dup) {
    status(dup.cliente.inativo
      ? `⚠ ${esc(dup.cliente.nome)} tem esse ${dup.campo}, mas está <strong>inativo</strong>. <button type="button" class="btn-icon mini" data-cp="reativar" data-id="${esc(dup.cliente.id)}">Reativar e vincular</button>`
      : `É o <strong>${esc(dup.cliente.nome)}</strong> (mesmo ${dup.campo})? <button type="button" class="btn-icon mini" data-cp="vincular" data-id="${esc(dup.cliente.id)}">Vincular</button>`);
    return;
  }
  // Nome igual ao de um cliente inativo (a sugestão só mostra os ativos)
  const inativo = lista().find((c) => c.inativo && chave(c.nome) === chave($("cp-nome").value));
  if (inativo) return status(`⚠ ${esc(inativo.nome)} é um cliente <strong>inativo</strong>. <button type="button" class="btn-icon mini" data-cp="reativar" data-id="${esc(inativo.id)}">Reativar e vincular</button>`);
  status("");
}

function vincular(c) {
  const cad = typeof c === "object" ? porId(c.id) || c : porId(c);
  if (!cad) return;
  estado.id = String(cad.id);
  const obs = $("cp-obs").value;
  preencher({ nome: cad.nome, telefone: cad.telefone || "", documento: cad.documento || "", endereco: cad.endereco || "", bairro: cad.bairro || "", cidade: cad.cidade || "", ie: cad.ie || "", obs });
  $("cp-salvar").checked = false;
  render();
  window.Calculadora?.clienteMudou?.();
}

function limpar() {
  estado.id = null;
  preencher({});
  $("cp-salvar").checked = false;
  $("cp-mais").open = false;
  render();
  window.Calculadora?.clienteMudou?.();
}

async function reativar(id) {
  try {
    await window.api("/api/clientes", { method: "PATCH", body: { id, acao: "reativar" } });
    await window.Clientes.carregar();
    vincular(id);
  } catch (e) { alert(`Não foi possível reativar: ${e.message}`); }
}

// Venda (ou orçamento) a corrigir / converter: os dados voltam para o bloco
function carregar({ clienteId = null, cliente = "", clienteVia = null } = {}) {
  limpar();
  const cad = clienteId ? porId(clienteId) : null;
  if (cad) vincular(cad);
  const via = clienteVia || {};
  const d = dados();
  preencher({ ...d, nome: via.nome || cliente || d.nome, ...Object.fromEntries(Object.entries(via).filter(([, v]) => v)) });
  render();
}

// Dados que vão para a venda: vínculo (clienteId) e o que sai na via (clienteVia)
function ler() {
  const d = dados();
  if (!estado.id && !temDados(d)) return null;
  const cad = estado.id ? porId(estado.id) : null;
  return { id: estado.id, nome: d.nome || cad?.nome || "", telefone: d.telefone, dados: d, salvar: $("cp-salvar").checked };
}

function prazo() {
  const cad = estado.id ? porId(estado.id) : null;
  return prazoDoCliente(cad, window.Caixa?.configFinanceiro);
}

/**
 * Antes de registrar: confere duplicado, cadastra se pediu (ou se é fiado) e devolve o que vai na venda:
 * { clienteId?, cliente?, clienteVia? }; {} sem cliente; null se a pessoa desistiu ou falta algo.
 */
async function paraVenda({ fiado = false } = {}) {
  let d = dados();
  if (fiado) {
    if (!d.nome) { alert("Fiado: informe o nome do cliente (bloco Cliente, acima das formas de pagamento)."); $("cp-nome").focus(); return null; }
    if (!estado.id && !normalizarTelefone(d.telefone).ok) { alert("Fiado: informe o WhatsApp do cliente com DDD (bloco Cliente)."); $("cp-tel").focus(); return null; }
  }
  if (!estado.id && !temDados(d)) return {};
  if (!estado.id && (fiado || $("cp-salvar").checked)) {
    await atualizarLista(true); // confere o duplicado com a lista de agora (outro aparelho pode ter cadastrado)
    const dup = repetido(d);
    if (dup) {
      if (!confirm(`Já existe ${dup.cliente.nome} com esse ${dup.campo}${dup.cliente.inativo ? " (inativo)" : ""}.\n\nVincular a venda a ${dup.cliente.nome}?`)) return null;
      if (dup.cliente.inativo) await reativar(dup.cliente.id); else vincular(dup.cliente);
    } else {
      if (!d.nome) { alert("Para salvar como cliente, informe o nome."); $("cp-nome").focus(); return null; }
      const tel = normalizarTelefone(d.telefone);
      try {
        // fiado de cliente novo: prazo padrão (Ajustes › Financeiro, 30 dias)
        const c = await window.Clientes.salvar({ nome: d.nome, telefone: tel.ok ? tel.formatado : "", fixo: !tel.ok ? d.telefone : "",
          documento: d.documento, endereco: d.endereco, bairro: d.bairro, cidade: d.cidade, ie: d.ie });
        vincular(c);
      } catch (e) { alert(`O cliente não foi cadastrado: ${e.message}`); return null; }
    }
    d = dados();
  }
  const r = {};
  if (estado.id) { r.clienteId = estado.id; r.cliente = porId(estado.id)?.nome || d.nome; }
  else r.cliente = d.nome;
  if (temDados(d)) r.clienteVia = d;
  return r;
}

// Lista de clientes lida do servidor ao começar a digitar (cliente cadastrado agora em outro aparelho aparece na hora)
let ultimaLeitura = 0;
async function atualizarLista(forcar = false) {
  if (!forcar && Date.now() - ultimaLeitura < 3000) return;
  ultimaLeitura = Date.now();
  try { await window.Clientes?.carregar(); } catch { /* sem conexão: fica a lista que já tinha */ }
}
for (const id of ["cp-nome", "cp-tel", "cp-doc"]) $(id).addEventListener("focus", () => atualizarLista().then(render));

// ---------- Eventos ----------

$("cp-nome").addEventListener("change", () => {
  if (estado.id) return render();
  // escolheu na sugestão: nome igual ao de um (único) cadastrado ativo
  const iguais = lista().filter((c) => !c.inativo && chave(c.nome) === chave($("cp-nome").value));
  if (iguais.length === 1) vincular(iguais[0]); else render();
});
$("cp-tel").addEventListener("change", () => {
  if (!estado.id) {
    const t = digitos($("cp-tel").value);
    const c = lista().filter((x) => !x.inativo && t.length >= 10 && digitos(x.telefone) === t);
    // escolheu o número na sugestão (e o nome está vazio ou é o dele): vincula; senão pergunta
    if (c.length === 1 && (!$("cp-nome").value.trim() || chave($("cp-nome").value) === chave(c[0].nome))) return vincular(c[0]);
  }
  render();
});
$("cp-doc").addEventListener("change", render);
$("cp-bloco").addEventListener("click", (e) => {
  const b = e.target.closest("[data-cp]");
  if (!b) return;
  if (b.dataset.cp === "vincular") vincular(b.dataset.id);
  if (b.dataset.cp === "reativar") reativar(b.dataset.id);
  if (b.dataset.cp === "desvincular") { estado.id = null; render(); window.Calculadora?.clienteMudou?.(); }
});
$("cp-limpar").addEventListener("click", limpar);
// Enter passa de campo (nunca registra a venda)
$("cp-bloco").addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || e.isComposing || e.target.tagName === "BUTTON") return;
  e.preventDefault();
  const campos = [...$("cp-bloco").querySelectorAll("input")].filter((i) => i.offsetParent !== null);
  campos[campos.indexOf(e.target) + 1]?.focus();
});

window.ClientePedido = { vincular, limpar, carregar, ler, prazo, paraVenda, dados };
