// Aba Orçamentos: salvar (de Vender), lista em 3 abas (Em aberto · Fechados · Perdidos) com o 🔔 de cobrar,
// WhatsApp, converter em venda, duplicar, editar, imprimir, perdido, atualizar preços, excluir e lixeira.
// A situação muda pelas ações (converter, perdido, reabrir), nunca por uma caixa de seleção.
import {
  ORIGENS, STATUS, MOTIVOS_PERDA, CONFIG_ORCAMENTOS_PADRAO, normalizarTelefone, linkWhatsApp, preencherModelo,
  textoParaCliente, situacao, indicadores, ordenar, atualizarPrecos, grupoDaLista, naLixeira, visivelNaLixeira,
} from "./lib/orcamentos.js";
import { mesclarConfigFinanceiro } from "./lib/planoContas.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const moeda = (v) => (v == null ? "—" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v));
const dataBR = (d) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "");
const dataHora = (iso) => (iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");
const hoje = () => window.Caixa?.hoje() || new Date().toISOString().slice(0, 10);
const cfgOrc = () => mesclarConfigFinanceiro(window.Caixa?.configFinanceiro).orcamentos || CONFIG_ORCAMENTOS_PADRAO;

const estado = { orcamentos: [], clientes: [], carregado: false, atual: null, soSino: false, lixeira: false };

async function carregar() {
  try {
    const r = await window.api("/api/orcamentos");
    estado.orcamentos = r.orcamentos;
    estado.clientes = r.clientes;
    estado.carregado = true;
  } catch (e) {
    $("orc-body").innerHTML = `<tr><td colspan="7" class="texto-alerta">Não foi possível carregar os orçamentos: ${esc(e.message)}</td></tr>`;
    return false;
  }
  atualizarContador();
  return true;
}

const paraCobrar = () => estado.orcamentos.filter((o) => situacao(o, hoje(), cfgOrc()).cobrarHoje);

function atualizarContador() {
  const n = paraCobrar().length;
  $("orc-contador").textContent = `🔔 ${n}`;
  $("orc-contador").hidden = n === 0;
}

const porId = (id) => estado.orcamentos.find((o) => o.id === id);

// ---------- Lista ----------

const abaAtual = () => document.querySelector('input[name="orc-aba"]:checked').value;
const ativos = () => estado.orcamentos.filter((o) => !naLixeira(o));

function filtrar() {
  const aba = abaAtual();
  const de = $("orc-f-de").value, ate = $("orc-f-ate").value;
  const busca = $("orc-f-busca").value.trim().toLowerCase();
  const buscaDig = busca.replace(/\D/g, "");
  const h = hoje(), cfg = cfgOrc();
  const lista = ativos().filter((o) => {
    if (grupoDaLista(o) !== aba) return false;
    if (estado.soSino && !situacao(o, h, cfg).cobrarHoje) return false;
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

// Só 3 indicadores no topo; tempo médio, motivos de perda e origem ficam em Relatórios
function renderIndicadores() {
  const ind = indicadores(estado.orcamentos, hoje().slice(0, 7));
  const pctTxt = (v) => (v == null ? "—" : `${(v * 100).toFixed(0)}%`);
  const n = paraCobrar().length;
  $("orc-indicadores").innerHTML = `
    <div class="total-bloco"><span>Em aberto</span><strong>${moeda(ind.valorAberto)}</strong><small class="texto-suave">${ind.qtdAberto} ${ind.qtdAberto === 1 ? "orçamento" : "orçamentos"}</small></div>
    <div class="total-bloco"><span>Conversão do mês</span><strong>${pctTxt(ind.taxaConversaoMes)}</strong><small class="texto-suave">${ind.totalMes} orçamentos no mês</small></div>
    <button type="button" class="total-bloco bloco-sino ${n ? "tem" : ""} ${estado.soSino ? "ativo" : ""}" id="orc-sino" title="Mostrar só os orçamentos para cobrar hoje">
      <span>🔔 Para cobrar hoje</span><strong>${n}</strong><small class="texto-suave">${n ? "clique para ver só esses" : "nenhum"}</small></button>`;
  $("orc-sino").addEventListener("click", () => verCobrar(!estado.soSino));
  $("orc-legenda-sino").textContent = `🔔 = em aberto há ${cfgOrc().diasParaCobrar} ou mais dias sem contato`;
}

function verCobrar(ligar) {
  estado.soSino = ligar;
  if (ligar) document.querySelector('input[name="orc-aba"][value="aberto"]').checked = true;
  renderTudo();
}

// Fechado pode ser reaberto se não há venda ativa vinculada (venda estornada ou dado antigo)
function podeReabrir(o) {
  if (o.status === "perdido") return true;
  if (o.status !== "fechado") return false;
  if (!o.vendaId) return true;
  const itens = window.Caixa?.itens;
  return Array.isArray(itens) && !window.Caixa.somenteLeitura && !itens.some((l) => String(l.id) === String(o.vendaId));
}

function renderLista() {
  const h = hoje(), cfg = cfgOrc();
  const lista = filtrar();
  $("orc-body").innerHTML = lista.map((o) => {
    const s = situacao(o, h, cfg);
    const acoes = [];
    if (s.emAberto) {
      acoes.push(`<button class="btn-icon mini" data-acao="enviar" data-id="${o.id}">Enviar</button>`);
      acoes.push(`<button class="btn-icon mini" data-acao="cobrar" data-id="${o.id}">Cobrar</button>`);
      acoes.push(`<button class="btn-icon mini destaque-verde" data-acao="converter" data-id="${o.id}">Converter em venda</button>`);
    }
    const mais = [
      s.emAberto ? `<button data-acao="editar" data-id="${o.id}">Editar</button>` : "",
      `<button data-acao="duplicar" data-id="${o.id}">Duplicar</button>`,
      `<button data-acao="imprimir" data-id="${o.id}">🖨 Imprimir 2 vias</button>`,
      s.emAberto ? `<button data-acao="precos" data-id="${o.id}">Atualizar preços</button>` : "",
      s.emAberto ? `<button data-acao="perdido" data-id="${o.id}">Marcar como perdido</button>` : "",
      podeReabrir(o) ? `<button data-acao="reabrir" data-id="${o.id}">Reabrir</button>` : "",
      o.status === "fechado"
        ? '<small class="menu-nota">Excluir: não dá, virou venda. Para desfazer, estorne a venda no Caixa.</small>'
        : `<button data-acao="excluir" data-id="${o.id}" class="item-perigo">Excluir</button>`,
    ].filter(Boolean).join("");
    acoes.push(`<details class="menu-mais"><summary class="btn-icon mini" aria-label="Mais ações">⋯</summary><div class="menu-itens">${mais}</div></details>`);
    const selo = o.status === "perdido"
      ? `<small class="texto-ruim">perdido: ${esc(o.motivoPerda || "")}${o.motivoPerdaTexto ? " – " + esc(o.motivoPerdaTexto) : ""}</small>`
      : o.status === "fechado" ? `<small class="texto-ok">fechado${o.vendaId ? ` · venda ${esc(o.vendaId)}` : ""}</small>` : "";
    return `<tr class="${s.cor ? "cor-" + s.cor : ""}">
      <td><strong>${o.id}</strong>${s.cobrarHoje ? ` <span class="sino" title="${s.diasSemContato} dias sem contato: cobrar hoje">🔔</span>` : ""}</td>
      <td>${esc(o.cliente?.nome)}<small>${esc(o.cliente?.telefone)} · ${ORIGENS[o.origem] || esc(o.origem)}</small>${o.obs ? `<small class="texto-suave">${esc(o.obs)}</small>` : ""}${selo}</td>
      <td>${dataBR(o.data)}${s.vencido && s.emAberto ? '<small class="selo-vencido">vencido – preços podem ter mudado</small>' : `<small>vale até ${dataBR(o.validoAte)}</small>`}</td>
      <td class="num">${s.emAberto ? s.diasAberto : "—"}</td>
      <td class="num"><strong>${moeda(o.total)}</strong>${o.frete ? `<small>com frete ${moeda(o.frete)}</small>` : ""}</td>
      <td>${dataHora(o.ultimoContato)}${s.emAberto && o.ultimoContato ? `<small>${s.diasSemContato} dia(s)</small>` : ""}</td>
      <td class="orc-acoes">${s.vencido && s.emAberto ? `<button class="btn-icon mini destaque-vermelho" data-acao="precos" data-id="${o.id}">Atualizar preços</button>` : ""}${acoes.join("")}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="7" class="texto-suave">${estado.soSino ? "Nenhum orçamento para cobrar hoje." : "Nenhum orçamento aqui."}</td></tr>`;
  const cont = { aberto: 0, fechado: 0, perdido: 0 };
  for (const o of ativos()) cont[grupoDaLista(o)]++;
  for (const g of Object.keys(cont)) $(`orc-n-${g}`).textContent = cont[g] ? `(${cont[g]})` : "";
  $("orc-filtro-sino").hidden = !estado.soSino;
  const nLixeira = estado.orcamentos.filter((o) => visivelNaLixeira(o, h)).length;
  $("orc-lixeira-link").textContent = `🗑 Lixeira${nLixeira ? ` (${nLixeira})` : ""}`;
  $("orc-contagem").textContent = `· mostrando ${lista.length}`;
}

function renderLixeira() {
  const h = hoje();
  const lista = estado.orcamentos.filter((o) => visivelNaLixeira(o, h)).sort((a, b) => b.excluidoEm.localeCompare(a.excluidoEm));
  $("orc-lixeira-body").innerHTML = lista.map((o) => `<tr>
      <td><strong>${o.id}</strong></td><td>${esc(o.cliente?.nome)}<small>${esc(o.cliente?.telefone)}</small></td>
      <td>${dataBR(o.data)}</td><td class="num">${moeda(o.total)}</td><td>${dataHora(o.excluidoEm)}</td>
      <td><button class="btn-icon mini" data-acao="restaurar" data-id="${o.id}">Restaurar</button></td>
    </tr>`).join("") || '<tr><td colspan="6" class="texto-suave">A lixeira está vazia.</td></tr>';
}

function mostrarLixeira(ligar) {
  estado.lixeira = ligar;
  $("orc-lixeira").hidden = !ligar;
  $("orc-painel-lista").hidden = ligar;
  $("orc-indicadores").hidden = ligar;
  if (ligar) renderLixeira();
}

// Relatórios › Orçamentos: indicadores completos do mês
function renderRelatorio(el, mes) {
  const desenhar = () => {
    const ind = indicadores(estado.orcamentos, mes);
    const pctTxt = (v) => (v == null ? "—" : `${(v * 100).toFixed(0)}%`);
    const motivos = Object.entries(ind.motivosPerda).sort((a, b) => b[1] - a[1]);
    el.innerHTML = `<div class="saldos-grid">
        <div class="total-bloco"><span>Em aberto (hoje)</span><strong>${moeda(ind.valorAberto)}</strong><small class="texto-suave">${ind.qtdAberto} orçamento(s)</small></div>
        <div class="total-bloco"><span>Orçamentos do mês</span><strong>${ind.totalMes}</strong></div>
        <div class="total-bloco"><span>Conversão do mês</span><strong>${pctTxt(ind.taxaConversaoMes)}</strong></div>
        <div class="total-bloco"><span>Tempo médio até fechar</span><strong>${ind.tempoMedioFechar == null ? "—" : `${ind.tempoMedioFechar.toFixed(1).replace(".", ",")} dias`}</strong><small class="texto-suave">todos os fechados</small></div>
      </div>
      <div class="fluxo-grid">
        <table class="tabela-fin"><thead><tr><th>Origem (orçamentos do mês)</th><th class="num">Qtd.</th></tr></thead>
          <tbody>${Object.entries(ORIGENS).map(([id, n]) => `<tr><td>${n}</td><td class="num">${ind.porOrigem[id] || 0}</td></tr>`).join("")}</tbody></table>
        <table class="tabela-fin"><thead><tr><th>Motivos de perda (todos)</th><th class="num">Qtd.</th></tr></thead>
          <tbody>${motivos.map(([m, n]) => `<tr><td>${esc(m)}</td><td class="num">${n}</td></tr>`).join("") || '<tr><td colspan="2" class="texto-suave">Nenhum perdido.</td></tr>'}</tbody></table>
      </div>
      <p class="texto-suave">Excluídos (lixeira) não contam: foram erro ou teste.</p>`;
  };
  if (estado.carregado) desenhar();
  else carregar().then((ok) => (ok ? desenhar() : (el.innerHTML = '<p class="texto-ruim">Não foi possível carregar os orçamentos.</p>')));
}

function renderTudo() {
  renderIndicadores();
  renderLista();
  if (estado.lixeira) renderLixeira();
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
    await patch({ id: orc.id, acao: "precos", hoje: hoje(), itens: novo.itens, total: novo.totalNovo, frete: novo.frete, custo: novo.custo, margem: novo.margem,
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
  window.switchTab("vender");
  ($(modo === "converter" ? "finalizar" : "btn-salvar-orcamento") || document.body).scrollIntoView({ behavior: "smooth", block: "center" });
}

async function acao(nome, id) {
  const o = porId(id);
  if (!o) return;
  document.querySelectorAll(".menu-mais[open]").forEach((d) => d.removeAttribute("open"));
  if (nome === "enviar" || nome === "cobrar") return abrirWhats(o, nome);
  if (nome === "perdido") return abrirPerdido(o);
  if (nome === "precos") return abrirPrecos(o);
  if (nome === "imprimir") return window.Impressao.abrir({ orcamento: o });
  if (nome === "editar") return carregarNaCalculadora(o, "editar", "orcamento");
  if (nome === "duplicar") return carregarNaCalculadora(o, "duplicar", "orcamento");
  if (nome === "reabrir") return patch({ id, acao: "reabrir" }).catch((e) => alert(e.message));
  if (nome === "excluir") {
    const msg = `Excluir ${o.id} de ${o.cliente?.nome || "cliente"}?\n\nExcluir = foi erro ou teste: some da lista e dos indicadores (fica 30 dias na Lixeira, de onde dá para restaurar).\nSe o cliente não fechou, cancele e use "Marcar como perdido".`;
    if (!confirm(msg)) return;
    return patch({ id, acao: "excluir" }).catch((e) => alert(`Não foi excluído: ${e.message}`));
  }
  if (nome === "restaurar") return patch({ id, acao: "restaurar" }).catch((e) => alert(`Não foi restaurado: ${e.message}`));
  if (nome === "converter") {
    estado.atual = { orc: o };
    const s = situacao(o, hoje(), cfgOrc());
    $("orc-converter-titulo").textContent = `Converter ${o.id} em venda`;
    $("orc-converter-info").innerHTML = `${esc(o.cliente?.nome)} · ${moeda(o.total)}.${s.vencido ? ' <span class="texto-ruim">Orçamento vencido: os preços podem ter mudado.</span>' : ""}<br>O pedido vai para a aba Vender; ao registrar a venda, o orçamento fica como Fechado.`;
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
    window.Impressao.abrir({ orcamento: r.orcamento, titulo: `Orçamento ${r.orcamento.id} ${corpo.id ? "atualizado" : "salvo"}`,
      mensagem: `<div>${moeda(r.orcamento.total)}, válido até ${dataBR(r.orcamento.validoAte)}.</div><div>Ele está na aba Orçamentos, em "Em aberto", com os botões Enviar e Cobrar no WhatsApp.</div>` });
  } catch (err) {
    alert(`O orçamento não foi salvo: ${err.message}`);
  } finally {
    botao.disabled = false;
  }
}

// ---------- Eventos ----------

for (const id of ["orc-f-de", "orc-f-ate", "orc-f-ordem"]) $(id).addEventListener("change", renderLista);
$("orc-abas").addEventListener("change", () => { estado.soSino = false; renderTudo(); });
$("orc-sino-limpar").addEventListener("click", () => verCobrar(false));
$("orc-lixeira-link").addEventListener("click", () => mostrarLixeira(true));
$("orc-lixeira-voltar").addEventListener("click", () => mostrarLixeira(false));
$("orc-lixeira-body").addEventListener("click", (e) => {
  const b = e.target.closest("[data-acao]");
  if (b) acao(b.dataset.acao, b.dataset.id);
});
$("orc-f-busca").addEventListener("input", renderLista);
$("orc-body").addEventListener("click", (e) => {
  const b = e.target.closest("[data-acao]");
  if (b) acao(b.dataset.acao, b.dataset.id);
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
  verCobrar() { verCobrar(true); },
  relatorio: renderRelatorio,
  configMudou() { if (estado.carregado) renderTudo(); },
};

// Contador de "para cobrar" na aba, assim que houver senha/conexão
setTimeout(() => { carregar(); }, 1500);
