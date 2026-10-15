// Cadastro de clientes compartilhado (fiado, recebimentos, orçamentos): carrega a lista,
// preenche o <datalist id="clientes-lista"> e acha ou cadastra um cliente pelo nome.
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
  if (dl) dl.innerHTML = estado.lista.map((c) => `<option value="${esc(c.nome)}">${esc(c.telefone || "sem WhatsApp")}</option>`).join("");
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
  const tel = prompt(`WhatsApp de ${n} com DDD (opcional; deixe em branco se não tiver):`, "");
  if (tel === null) return null;
  try {
    const c = await salvar({ nome: n, telefone: tel.trim() });
    return { id: c.id, nome: c.nome };
  } catch (e) {
    alert(`O cliente não foi cadastrado: ${e.message}`);
    return null;
  }
}

window.Clientes = {
  carregar,
  salvar,
  garantir,
  get lista() { return estado.lista; },
  porId: (id) => estado.lista.find((c) => String(c.id) === String(id)) || null,
};

// Lista para as sugestões assim que houver senha/conexão
setTimeout(() => { carregar(); }, 1200);
