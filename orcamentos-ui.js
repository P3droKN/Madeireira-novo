// Aba Orçamentos: salvar (da Calculadora), lista com lembretes e indicadores, WhatsApp,
// converter em venda, duplicar, editar, imprimir, perdido e atualizar preços.
import {
  ORIGENS, STATUS, MOTIVOS_PERDA, CONFIG_ORCAMENTOS_PADRAO, normalizarTelefone, linkWhatsApp, preencherModelo,
  textoParaCliente, situacao, indicadores, ordenar, atualizarPrecos,
} from "./lib/orcamentos.js";
import { mesclarConfigFinanceiro } from "./lib/planoContas.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const moeda = (v) => (v == null ? "—" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v));
const dataBR = (d) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "");
const dataHora = (iso) => (iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");
const hoje = () => window.Caixa?.hoje() || new Date().toISOString().slice(0, 10);
const cfgOrc = () => mesclarConfigFinanceiro(window.Caixa?.configFinanceiro).orcamentos || CONFIG_ORCAMENTOS_PADRAO;

const estado = { orcamentos: [], clientes: [], carregado: false, atual: null };

async function carregar() {
  try {
    const r = await window.api("/api/orcamentos");
    estado.orcamentos = r.orcamentos;
    estado.clientes = r.clientes;
    estado.carregado = true;
  } catch (e) {
    $("orc-body").innerHTML = `<tr><td colspan="9" class="texto-alerta">Não foi possível carregar os orçamentos: ${esc(e.message)}</td></tr>`;
    return false;
  }
  atualizarContador();
  return true;
}

function atualizarContador() {
  const n = estado.orcamentos.filter((o) => situacao(o, hoje(), cfgOrc()).cobrarHoje).length;
  $("orc-contador").textContent = n;
  $("orc-contador").hidden = n === 0;
}

const porId = (id) => estado.orcamentos.find((o) => o.id === id);

// ---------- Lista ----------

function filtrar() {
  const st = $("orc-f-status").value;
  const de = $("orc-f-de").value, ate = $("orc-f-ate").value;
  const busca = $("orc-f-busca").value.trim().toLowerCase();
  const buscaDig = busca.replace(/\D/g, "");
  const h = hoje(), cfg = cfgOrc();
  const lista = estado.orcamentos.filter((o) => {
    const s = situacao(o, h, cfg);
    if (st === "abertos" && !s.emAberto) return false;
    if (st === "cobrar" && !s.cobrarHoje) return false;
    if (["aberto", "aguardando", "fechado", "perdido"].includes(st) && o.status !== st) return false;
    if (de && o.data < de) return false;
    if (ate && o.data > ate) return false;
    if (busca) {
      const nome = (o.cliente?.nome || "").toLowerCase();
      const tel = (o.cliente?.telefone || "").replace(/\D/g, "");
      if (!nome.includes(busca) && !(buscaDig.length >= 3 && tel.includes(buscaDig)) && !o.id.toLowerCase().includes(busca)) return false;
    }
    return true;
  });
  return ordenar(lista, $("orc-f-ordem").value, h);
}

function renderIndicadores() {
  const ind = indicadores(estado.orcamentos, hoje().slice(0, 7));
  const pct = (v) => (v == null ? "—" : `${(v * 100).toFixed(0)}%`);
  const motivos = Object.entries(ind.motivosPerda).sort((a, b) => b[1] - a[1]).map(([m, n]) => `${esc(m)}: ${n}`).join(" · ") || "nenhum";
  const origens = Object.entries(ORIGENS).map(([id, n]) => `${n}: ${ind.porOrigem[id] || 0}`).join(" · ");
  $("orc-indicadores").innerHTML = `
    <div class="total-bloco"><span>Valor em aberto</span><strong>${moeda(ind.valorAberto)}</strong></div>
    <div class="total-bloco"><span>Conversão do mês</span><strong>${pct(ind.taxaConversaoMes)}</strong><small class="texto-suave">${ind.totalMes} orçamentos no mês</small></div>
    <div class="total-bloco"><span>Tempo médio até fechar</span><strong>${ind.tempoMedioFechar == null ? "—" : `${ind.tempoMedioFechar.toFixed(1).replace(".", ",")} dias`}</strong></div>
    <div class="total-bloco"><span>Por origem (mês)</span><small>${origens}</small></div>
    <div class="total-bloco"><span>Motivos de perda</span><small>${motivos}</small></div>`;
  const cobrar = estado.orcamentos.filter((o) => situacao(o, hoje(), cfgOrc()).cobrarHoje);
  const lem = $("orc-lembrete");
  lem.hidden = cobrar.length === 0;
  lem.innerHTML = `<strong>${cobrar.length} ${cobrar.length === 1 ? "orçamento para cobrar" : "orçamentos para cobrar"} hoje</strong> (em aberto há ${cfgOrc().diasParaCobrar} ou mais dias sem contato).
    <button class="btn-icon" onclick="Orcamentos.verCobrar()">Ver</button>`;
}

function renderLista() {
  const h = hoje(), cfg = cfgOrc();
  const lista = filtrar();
  $("orc-body").innerHTML = lista.map((o) => {
    const s = situacao(o, h, cfg);
    const statusCel = s.emAberto
      ? `<select class="orc-status" data-id="${o.id}" aria-label="Status">${["aberto", "aguardando"].map((x) => `<option value="${x}" ${o.status === x ? "selected" : ""}>${STATUS[x]}</option>`).join("")}</select>`
      : `<span class="tag ${o.status === "fechado" ? "tag-mais" : "tag-menos"}">${STATUS[o.status]}</span>${o.motivoPerda ? `<small>${esc(o.motivoPerda)}${o.motivoPerdaTexto ? ": " + esc(o.motivoPerdaTexto) : ""}</small>` : ""}${o.vendaId ? `<small>venda ${esc(o.vendaId)}</small>` : ""}`;
    const acoes = [];
    if (s.emAberto) {
      acoes.push(`<button class="btn-icon mini" data-acao="enviar" data-id="${o.id}">Enviar</button>`);
      acoes.push(`<button class="btn-icon mini" data-acao="cobrar" data-id="${o.id}">Cobrar</button>`);
      acoes.push(`<button class="btn-icon mini destaque-verde" data-acao="converter" data-id="${o.id}">Converter em venda</button>`);
    }
    const mais = [
      s.emAberto ? `<button data-acao="precos" data-id="${o.id}">Atualizar preços</button>` : "",
      s.emAberto ? `<button data-acao="editar" data-id="${o.id}">Editar</button>` : "",
      `<button data-acao="duplicar" data-id="${o.id}">Duplicar</button>`,
      `<button data-acao="imprimir" data-id="${o.id}">Imprimir</button>`,
      s.emAberto ? `<button data-acao="perdido" data-id="${o.id}">Marcar como perdido</button>` : "",
      o.status === "perdido" ? `<button data-acao="reabrir" data-id="${o.id}">Reabrir</button>` : "",
    ].filter(Boolean).join("");
    acoes.push(`<details class="menu-mais"><summary class="btn-icon mini">Mais ▾</summary><div class="menu-itens">${mais}</div></details>`);
    return `<tr class="${s.cor ? "cor-" + s.cor : ""}">
      <td><strong>${o.id}</strong></td>
      <td>${esc(o.cliente?.nome)}<small>${esc(o.cliente?.telefone)}</small>${o.obs ? `<small class="texto-suave">${esc(o.obs)}</small>` : ""}</td>
      <td>${dataBR(o.data)}${s.vencido && s.emAberto ? '<small class="texto-ruim">vencido: preços podem ter mudado</small>' : `<small>vale até ${dataBR(o.validoAte)}</small>`}</td>
      <td class="num">${s.emAberto ? s.diasAberto : "—"}</td>
      <td class="num"><strong>${moeda(o.total)}</strong></td>
      <td>${ORIGENS[o.origem] || o.origem}</td>
      <td>${statusCel}</td>
      <td>${dataHora(o.ultimoContato)}${s.emAberto && o.ultimoContato ? `<small>${s.diasSemContato} dia(s)</small>` : ""}</td>
      <td class="orc-acoes">${s.vencido && s.emAberto ? `<button class="btn-icon mini destaque-vermelho" data-acao="precos" data-id="${o.id}">Atualizar preços</button>` : ""}${acoes.join("")}</td>
    </tr>`;
  }).join("") || '<tr><td colspan="9" class="texto-suave">Nenhum orçamento com esse filtro.</td></tr>';
  $("orc-contagem").textContent = `${lista.length} de ${estado.orcamentos.length}`;
}

function renderTudo() {
  renderIndicadores();
  renderLista();
  atualizarContador();
}

// ---------- Ações ----------

function abrirModal(id) {
  for (const m of ["modal-orc-salvar", "modal-orc-whats", "modal-orc-perdido", "modal-orc-precos", "modal-orc-converter"]) $(m).style.display = m === id ? "flex" : "none";
}
function fecharModais() { abrirModal(null); }

async function patch(corpo) {
  const r = await window.api("/api/orcamentos", { method: "PATCH", body: corpo });
  const i = estado.orcamentos.findIndex((o) => o.id === r.orcamento.id);
  if (i >= 0) estado.orcamentos[i] = r.orcamento; else estado.orcamentos.push(r.orcamento);
  renderTudo();
  return r.orcamento;
}

function abrirWhats(o, tipo) {
  estado.atual = { orc: o, tipo };
  const t = normalizarTelefone(o.cliente?.telefone);
  $("orc-whats-titulo").textContent = tipo === "cobrar" ? `Cobrar ${o.id}` : `Enviar ${o.id}`;
  $("orc-whats-para").textContent = `Para ${o.cliente?.nome} · ${t.ok ? t.formatado : "telefone inválido"}`;
  const modelos = cfgOrc().modelos;
  $("orc-whats-modelo-grupo").hidden = tipo !== "cobrar";
  $("orc-whats-modelo").innerHTML = modelos.map((m, i) => `<option value="${i}">Modelo ${i + 1}: ${esc(m.slice(0, 60))}…</option>`).join("");
  $("orc-whats-texto").value = tipo === "cobrar" ? preencherModelo(modelos[0], o, hoje()) : textoParaCliente(o);
  atualizarLinkWhats();
  abrirModal("modal-orc-whats");
}

function atualizarLinkWhats() {
  const { orc } = estado.atual;
  try {
    $("orc-whats-abrir").href = linkWhatsApp(orc.cliente.telefone, $("orc-whats-texto").value);
  } catch (e) {
    $("orc-whats-abrir").removeAttribute("href");
  }
}

function abrirPerdido(o) {
  estado.atual = { orc: o };
  $("orc-perdido-qual").textContent = `${o.id} · ${o.cliente?.nome} · ${moeda(o.total)}`;
  $("orc-perdido-motivos").innerHTML = MOTIVOS_PERDA.map((m) => `<button class="btn-icon" data-motivo="${esc(m)}">${esc(m)}</button>`).join("");
  abrirModal("modal-orc-perdido");
}

function abrirPrecos(o) {
  const cat = window.Calculadora?.catalogoAtual();
  if (!cat) return alert("O catálogo ainda está carregando. Tente de novo em instantes.");
  const r = atualizarPrecos(o, cat.item, cat.preco);
  estado.atual = { orc: o, novo: r };
  $("orc-precos-titulo").textContent = `Atualizar preços · ${o.id}`;
  $("orc-precos-body").innerHTML = r.itens.map((i, n) => `<tr class="${i.diferenca ? "diferente" : ""}">
    <td>${esc(i.descricao)}${i.aviso ? `<small class="texto-ruim">${esc(i.aviso)}</small>` : ""}</td>
    <td class="num">${moeda(o.itens[n].vendaTotal)}</td><td class="num">${moeda(i.vendaTotal)}</td>
    <td class="num">${i.diferenca ? (i.diferenca > 0 ? "+" : "") + moeda(i.diferenca) : "—"}</td></tr>`).join("");
  const el = $("orc-precos-total");
  el.className = "aviso " + (r.diferenca ? "aviso-alerta" : "aviso-ok");
  el.innerHTML = r.diferenca
    ? `Total: <strong>${moeda(r.totalAntigo)} → ${moeda(r.totalNovo)}</strong> (${r.diferenca > 0 ? "+" : ""}${moeda(r.diferenca)})`
    : `Os preços de hoje dão o mesmo total: <strong>${moeda(r.totalNovo)}</strong>.`;
  abrirModal("modal-orc-precos");
}

async function aplicarPrecos() {
  const { orc, novo } = estado.atual;
  try {
    await patch({ id: orc.id, acao: "precos", hoje: hoje(), itens: novo.itens, total: novo.totalNovo, custo: novo.custo, margem: novo.margem,
      tabelaTotal: novo.itens.reduce((s, i) => s + (i.tabelaTotal || 0), 0), variacao: null, motivoGeral: orc.motivoGeral });
    fecharModais();
  } catch (e) {
    alert(`Os preços não foram atualizados: ${e.message}`);
  }
}

async function carregarNaCalculadora(o, modo, precos) {
  fecharModais();
  const ok = await window.Calculadora.carregarOrcamento(o, modo, precos);
  if (!ok) return;
  window.switchTab("calculator");
  ($(modo === "converter" ? "finalizar" : "btn-salvar-orcamento") || document.body).scrollIntoView({ behavior: "smooth", block: "center" });
}

function imprimir(o) {
  $("impressao-orcamento").innerHTML = `
    <h1>Orçamento ${o.id}</h1>
    <p>Data: ${dataBR(o.data)} · Válido até ${dataBR(o.validoAte)}</p>
    <p>Cliente: <strong>${esc(o.cliente?.nome)}</strong> · ${esc(o.cliente?.telefone)}</p>
    <table><thead><tr><th>Item</th><th>Quantidade</th><th class="num">Preço</th><th class="num">Total</th></tr></thead>
    <tbody>${o.itens.map((i) => `<tr><td>${esc(i.descricao)}</td><td>${esc(i.quantidadeTexto || "")}</td>
      <td class="num">${i.unidade && i.unidade !== "un" && i.precoUnitario != null ? `${moeda(i.precoUnitario)}/${esc(i.unidade)}` : ""}</td><td class="num">${moeda(i.vendaTotal)}</td></tr>`).join("")}</tbody>
    <tfoot><tr><td colspan="3"><strong>Total</strong></td><td class="num"><strong>${moeda(o.total)}</strong></td></tr></tfoot></table>
    ${o.obs ? `<p>Obs.: ${esc(o.obs)}</p>` : ""}
    <p class="rodape-orc">Preços válidos até ${dataBR(o.validoAte)}. Depois dessa data, consulte novamente.</p>`;
  document.body.classList.add("imprimindo-orc");
  window.print();
  document.body.classList.remove("imprimindo-orc");
}

async function acao(nome, id) {
  const o = porId(id);
  if (!o) return;
  document.querySelectorAll(".menu-mais[open]").forEach((d) => d.removeAttribute("open"));
  if (nome === "enviar" || nome === "cobrar") return abrirWhats(o, nome);
  if (nome === "perdido") return abrirPerdido(o);
  if (nome === "precos") return abrirPrecos(o);
  if (nome === "imprimir") return imprimir(o);
  if (nome === "editar") return carregarNaCalculadora(o, "editar", "orcamento");
  if (nome === "duplicar") return carregarNaCalculadora(o, "duplicar", "orcamento");
  if (nome === "reabrir") return patch({ id, acao: "reabrir" }).catch((e) => alert(e.message));
  if (nome === "converter") {
    estado.atual = { orc: o };
    const s = situacao(o, hoje(), cfgOrc());
    $("orc-converter-titulo").textContent = `Converter ${o.id} em venda`;
    $("orc-converter-info").innerHTML = `${esc(o.cliente?.nome)} · ${moeda(o.total)}.${s.vencido ? ' <span class="texto-ruim">Orçamento vencido: os preços podem ter mudado.</span>' : ""}<br>O pedido vai para a Calculadora; ao registrar a venda, o orçamento fica como Fechado.`;
    abrirModal("modal-orc-converter");
  }
}

// ---------- Salvar orçamento (da Calculadora) ----------

function abrirSalvar() {
  const f = window.Calculadora?.fotografia();
  if (!f || !f.itens.length) return alert("O pedido está vazio. Adicione itens primeiro.");
  if (f.semPreco) return alert("Há item sem preço. Digite o preço na linha do item antes de salvar o orçamento.");
  const v = window.Calculadora.vinculo();
  const editando = v?.modo === "editar";
  $("orc-salvar-titulo").textContent = editando ? `Salvar alterações no ${v.id}` : v?.modo === "duplicar" ? `Novo orçamento (cópia do ${v.id})` : "Salvar como orçamento";
  $("orc-salvar-resumo").textContent = `${f.itens.length} ${f.itens.length === 1 ? "item" : "itens"} · total ${moeda(f.total)}`;
  $("orc-nome").value = v?.cliente?.nome || "";
  $("orc-tel").value = v?.cliente?.telefone || "";
  $("orc-obs").value = v?.obs || "";
  $("orc-validade").value = v?.validadeDias || cfgOrc().validadeDias;
  const origem = v?.origem || "balcao";
  document.querySelectorAll('input[name="orc-origem"]').forEach((r) => { r.checked = r.value === origem; });
  $("orc-clientes").innerHTML = estado.clientes.map((c) => `<option value="${esc(c.nome)}">${esc(c.telefone)}</option>`).join("");
  validarTelefone();
  abrirModal("modal-orc-salvar");
  $("orc-nome").focus();
}

function validarTelefone() {
  const v = $("orc-tel").value.trim();
  const t = normalizarTelefone(v);
  const info = $("orc-tel-info");
  if (!v) { info.textContent = ""; return t; }
  info.textContent = t.ok ? `✓ ${t.formatado}` : t.erro;
  info.className = t.ok ? "texto-suave" : "texto-ruim";
  return t;
}

async function salvar(e) {
  e.preventDefault();
  const t = validarTelefone();
  if (!t.ok) return alert(t.erro);
  const f = window.Calculadora.fotografia();
  const v = window.Calculadora.vinculo();
  const corpo = {
    ...f,
    cliente: { nome: $("orc-nome").value.trim(), telefone: t.formatado },
    origem: document.querySelector('input[name="orc-origem"]:checked').value,
    obs: $("orc-obs").value.trim(),
    validadeDias: Number($("orc-validade").value) || cfgOrc().validadeDias,
    hoje: hoje(),
  };
  if (v?.modo === "editar") corpo.id = v.id;
  if (v?.modo === "duplicar") corpo.duplicadoDe = v.id;
  const botao = $("orc-salvar-botao");
  botao.disabled = true;
  try {
    const r = await window.api("/api/orcamentos", { method: "POST", body: { orcamento: corpo } });
    fecharModais();
    await carregar();
    renderTudo();
    window.Calculadora.limpar(false);
    alert(`Orçamento ${r.orcamento.id} ${corpo.id ? "atualizado" : "salvo"}: ${moeda(r.orcamento.total)}, válido até ${dataBR(r.orcamento.validoAte)}.\n\nEle está na aba Orçamentos, com os botões Enviar e Cobrar no WhatsApp.`);
  } catch (err) {
    alert(`O orçamento não foi salvo: ${err.message}`);
  } finally {
    botao.disabled = false;
  }
}

// ---------- Eventos ----------

for (const id of ["orc-f-status", "orc-f-de", "orc-f-ate", "orc-f-ordem"]) $(id).addEventListener("change", renderLista);
$("orc-f-busca").addEventListener("input", renderLista);
$("orc-body").addEventListener("click", (e) => {
  const b = e.target.closest("[data-acao]");
  if (b) acao(b.dataset.acao, b.dataset.id);
});
$("orc-body").addEventListener("change", async (e) => {
  if (!e.target.classList.contains("orc-status")) return;
  try { await patch({ id: e.target.dataset.id, acao: "status", status: e.target.value }); } catch (err) { alert(err.message); renderLista(); }
});
$("orc-whats-modelo").addEventListener("change", (e) => {
  $("orc-whats-texto").value = preencherModelo(cfgOrc().modelos[Number(e.target.value)], estado.atual.orc, hoje());
  atualizarLinkWhats();
});
$("orc-whats-texto").addEventListener("input", atualizarLinkWhats);
// O link abre o WhatsApp (o navegador cuida disso); aqui só registramos o contato
$("orc-whats-abrir").addEventListener("click", () => {
  if (!$("orc-whats-abrir").href) return;
  const { orc, tipo } = estado.atual;
  patch({ id: orc.id, acao: "contato", tipo }).catch((e) => alert(`O contato não foi registrado: ${e.message}`));
  fecharModais();
});
$("orc-perdido-motivos").addEventListener("click", async (e) => {
  const m = e.target.dataset.motivo;
  if (!m) return;
  let motivo = m;
  if (m === "Outro") {
    const t = prompt("Qual o motivo?");
    if (t === null) return;
    motivo = `Outro: ${t.trim()}`;
  }
  try { await patch({ id: estado.atual.orc.id, acao: "perdido", motivo }); fecharModais(); } catch (err) { alert(err.message); }
});
$("orc-precos-aplicar").addEventListener("click", aplicarPrecos);
$("orc-converter-orcamento").addEventListener("click", () => carregarNaCalculadora(estado.atual.orc, "converter", "orcamento"));
$("orc-converter-atuais").addEventListener("click", () => carregarNaCalculadora(estado.atual.orc, "converter", "atuais"));
$("orc-salvar-form").addEventListener("submit", salvar);
$("orc-tel").addEventListener("input", () => {
  const t = validarTelefone();
  if (t.ok && !$("orc-nome").value.trim()) {
    const c = estado.clientes.find((x) => x.id === t.digitos);
    if (c) $("orc-nome").value = c.nome;
  }
});
$("orc-nome").addEventListener("change", () => {
  const nome = $("orc-nome").value.trim().toLowerCase();
  const c = estado.clientes.find((x) => x.nome.toLowerCase() === nome);
  if (c && !$("orc-tel").value.trim()) { $("orc-tel").value = c.telefone; validarTelefone(); }
});

window.Orcamentos = {
  async abrir() {
    if (await carregar()) renderTudo();
  },
  async recarregar() {
    if (await carregar()) renderTudo();
  },
  abrirSalvar() {
    if (!estado.carregado) carregar().then(abrirSalvar); else abrirSalvar();
  },
  fecharModais,
  verCobrar() {
    $("orc-f-status").value = "cobrar";
    renderLista();
  },
};

// Contador de "para cobrar" na aba, assim que houver senha/conexão
setTimeout(() => { carregar(); }, 1500);
