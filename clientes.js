// Cadastro de clientes compartilhado (fiado, recebimentos, orçamentos): carrega a lista,
// preenche o <datalist id="clientes-lista"> (só os ativos) e acha ou cadastra um cliente pelo nome.
import { prazoDoCliente } from "./lib/receber.js";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const chave = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase().replace(/\s+/g, " ");

const estado = { lista: [], carregado: false };

async function carregar() {
  try {
    const r = await window.api("/api/clientes");
    estado.lista = r.clientes || [];
    estado.carregado = true;
  } catch (e) {
    console.warn("Clientes não carregados:", e.message);
  }
  preencherDatalist();
  return estado.lista;
}

function preencherDatalist() {
  const dl = document.getElementById("clientes-lista");
  const dt = document.getElementById("clientes-tel-lista"); // sugestão pelo WhatsApp (bloco Cliente do pedido)
  if (dt) dt.innerHTML = estado.lista.filter((c) => !c.inativo && c.telefone).map((c) => `<option value="${esc(c.telefone)}">${esc(c.nome)}</option>`).join("");
  if (dl) dl.innerHTML = estado.lista.filter((c) => !c.inativo).map((c) => `<option value="${esc(c.nome)}">${esc(c.telefone || "sem WhatsApp")}</option>`).join("");
}

async function salvar(cliente) {
  const r = await window.api("/api/clientes", { method: "POST", body: { cliente } });
  await carregar();
  return r.cliente;
}

/**
 * Acha o cliente pelo nome digitado (sem diferença de acento/maiúsculas) ou oferece cadastrar.
 * Devolve { id, nome } ou null se a pessoa desistir.
 */
async function garantir(nome) {
  const n = String(nome || "").trim();
  if (!n) { alert("Informe o cliente."); return null; }
  if (!estado.carregado) await carregar();
  const iguais = estado.lista.filter((c) => chave(c.nome) === chave(n));
  if (iguais.length === 1) return { id: iguais[0].id, nome: iguais[0].nome };
  if (iguais.length > 1) {
    const opcoes = iguais.map((c, i) => `${i + 1}. ${c.nome} · ${c.telefone || c.id}`).join("\n");
    const escolha = prompt(`Há ${iguais.length} clientes com esse nome. Qual é?\n\n${opcoes}\n\nDigite o número:`, "1");
    const c = iguais[Number(escolha) - 1];
    return c ? { id: c.id, nome: c.nome } : null;
  }
  if (!confirm(`"${n}" não está no cadastro de clientes. Cadastrar agora?`)) return null;
  // Abre o cadastro completo (Clientes e Orçamentos › Clientes) já com o nome
  const c = await window.ClientesUI?.novo({ nome: n });
  return c ? { id: c.id, nome: c.nome } : null;
}

// Cliente "sem prazo" (pelo nome digitado): fiado sem vencimento, acerta quando juntar
function ehContaCorrente(nome) {
  const n = chave(nome);
  if (!n) return false;
  const iguais = estado.lista.filter((c) => chave(c.nome) === n);
  return iguais.length > 0 && iguais.every((c) => c.contaCorrente === true);
}

// Prazo do fiado do cliente digitado: { semPrazo, dias } (null se não achar um só cliente com o nome)
function prazoDe(nome) {
  const n = chave(nome);
  const iguais = n ? estado.lista.filter((c) => chave(c.nome) === n) : [];
  if (iguais.length !== 1) return null;
  return prazoDoCliente(iguais[0], window.Caixa?.configFinanceiro);
}

window.Clientes = {
  carregar,
  salvar,
  garantir,
  ehContaCorrente,
  prazoDe,
  get lista() { return estado.lista; },
  porId: (id) => estado.lista.find((c) => String(c.id) === String(id)) || null,
};

// Lista para as sugestões assim que houver senha/conexão
setTimeout(() => { carregar(); }, 1200);
