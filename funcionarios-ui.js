// Ajustes › Funcionários (só o dono): cadastrar, trocar o PIN, desativar/reativar e o desconto máximo por item.
import { mesclarConfigFinanceiro } from "./lib/planoContas.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const estado = { lista: [] };

async function abrir() {
  $("aj-func-endereco").textContent = `${location.origin}/funcionarios`;
  $("aj-func-desconto").value = mesclarConfigFinanceiro(window.Caixa?.configFinanceiro).funcionarios.descontoMaxPct;
  try {
    estado.lista = (await window.api("/api/funcionarios")).funcionarios || [];
  } catch (e) {
    $("aj-func-lista").innerHTML = `<p class="aviso aviso-erro">Não foi possível carregar os funcionários: ${esc(e.message)}</p>`;
    return;
  }
  render();
}

function render() {
  $("aj-func-lista").innerHTML = estado.lista.length ? `<div class="table-container"><table class="tabela-fin">
    <thead><tr><th>Nome</th><th>Situação</th><th></th></tr></thead>
    <tbody>${estado.lista.map((f) => `<tr class="${f.ativo ? "" : "inativo"}"><td><strong>${esc(f.nome)}</strong></td>
      <td>${f.ativo ? "ativo" : '<span class="tag">desativado</span>'}</td>
      <td class="lanc-acoes"><button type="button" class="btn-icon mini" data-func-editar="${esc(f.id)}">Trocar nome/PIN</button>
        <button type="button" class="btn-icon mini ${f.ativo ? "item-perigo" : ""}" data-func-ativo="${esc(f.id)}">${f.ativo ? "Desativar" : "Reativar"}</button></td></tr>`).join("")}</tbody>
  </table></div>` : '<p class="texto-suave">Nenhum funcionário cadastrado.</p>';
}

function limparForm() {
  $("aj-func-id").value = "";
  $("aj-func-nome").value = "";
  $("aj-func-pin").value = "";
  $("aj-func-form-titulo").textContent = "Cadastrar funcionário";
  $("aj-func-salvar").textContent = "Cadastrar";
  $("aj-func-cancelar").hidden = true;
  $("aj-func-pin-nota").hidden = true;
}

async function salvar(funcionario, ok) {
  try {
    await window.api("/api/funcionarios", { method: "POST", body: { funcionario } });
    await abrir();
    if (ok) alert(ok);
    return true;
  } catch (e) { alert(`Não foi possível salvar: ${e.message}`); return false; }
}

$("aj-func-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = $("aj-func-id").value, nome = $("aj-func-nome").value.trim(), pin = $("aj-func-pin").value.trim();
  if (!nome) return alert("Informe o nome do funcionário.");
  if ((!id || pin) && !/^\d{4,6}$/.test(pin)) return alert("O PIN tem de 4 a 6 números.");
  if (await salvar({ ...(id ? { id } : {}), nome, ...(pin ? { pin } : {}) }, id ? (pin ? `PIN de ${nome} trocado.` : "Salvo.") : `${nome} cadastrado. Ele entra em /funcionarios com o PIN.`)) limparForm();
});
$("aj-func-cancelar").addEventListener("click", limparForm);
$("aj-func-lista").addEventListener("click", async (e) => {
  const ed = e.target.closest("[data-func-editar]");
  const at = e.target.closest("[data-func-ativo]");
  const f = estado.lista.find((x) => x.id === (ed || at)?.dataset[ed ? "funcEditar" : "funcAtivo"]);
  if (!f) return;
  if (ed) {
    $("aj-func-id").value = f.id;
    $("aj-func-nome").value = f.nome;
    $("aj-func-pin").value = "";
    $("aj-func-form-titulo").textContent = `Trocar nome ou PIN de ${f.nome}`;
    $("aj-func-salvar").textContent = "Salvar";
    $("aj-func-cancelar").hidden = false;
    $("aj-func-pin-nota").hidden = false;
    $("aj-func-nome").focus();
    return;
  }
  if (f.ativo && !confirm(`Desativar ${f.nome}? Ele não consegue mais entrar (as vendas dele continuam no sistema). Dá para reativar depois.`)) return;
  await salvar({ id: f.id, ativo: !f.ativo });
});
$("aj-func-desconto-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const pct = Number($("aj-func-desconto").value);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) return alert("Desconto máximo: de 0 a 100%.");
  try {
    const cfg = mesclarConfigFinanceiro(window.Caixa.configFinanceiro);
    const r = await window.api("/api/config", { method: "POST", body: { financeiro: { ...cfg, funcionarios: { descontoMaxPct: pct } } } });
    window.Caixa.configFinanceiro = r.financeiro;
    alert(`Desconto máximo do funcionário: ${pct}% por item.`);
  } catch (err) { alert(`Não foi possível salvar: ${err.message}`); }
});

window.FuncionariosUI = { abrir };
