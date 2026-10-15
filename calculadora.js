// Aba Vender (pedido, modo balcão) e Ajustes › Preços. Os cálculos ficam em lib/calculo.js (calcularItem).
import { criarEditorPagamentos } from "./pagamentos.js";
import { montarCatalogo, chavePreco, UNIDADES, ACABAMENTOS, CEPILHADO_PADRAO } from "./lib/catalogo.js";
import { calcularItem, totalizarPedido, distribuirTotal, arred, MOTIVOS_AJUSTE, textoWhatsApp } from "./lib/calculo.js";

const $ = (id) => document.getElementById(id);
const moeda = (v) => (v == null ? "—" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v));
const numero = (v, casas = 2) => new Intl.NumberFormat("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas }).format(v);
const pct = (v) => (v == null ? "—" : `${numero(v * 100, 1)}%`);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const lerNumero = (v) => (v === "" || v == null ? null : Number(String(v).replace(",", ".")));

const PEDIDO_KEY = "madeireira_pedido";
const editorPagamentos = criarEditorPagamentos(document.getElementById("calc-pagamentos"));

const estado = {
  dados: null,      // { custos, precos, config, kvDisponivel }
  catalogo: null,   // montarCatalogo(...)
  pedido: [],       // linhas do pedido
  motivoGeral: "",
  vinculo: null,    // { id: "ORC-0001", modo: "editar" | "converter" | "duplicar", orcamento }
};

// ---------- Catálogo ----------

async function carregar() {
  const status = $("catalogo-status");
  try {
    estado.dados = await window.api("/api/catalogo");
  } catch (e) {
    status.innerHTML = `Não foi possível carregar o catálogo (${esc(e.message)}). <button class="btn-icon" onclick="Calculadora.recarregar()">Tentar de novo</button>`;
    return;
  }
  reconstruirCatalogo();
  restaurarPedido();
  preencherMateriais();
  renderPedido();
}

function reconstruirCatalogo() {
  estado.catalogo = montarCatalogo(estado.dados.custos, estado.dados.config);
  const total = estado.catalogo.itens.size;
  const comPreco = Object.keys(estado.dados.precos || {}).length;
  $("catalogo-status").textContent = `${total} itens no catálogo · ${comPreco} ${comPreco === 1 ? "preço de venda cadastrado" : "preços de venda cadastrados"}`;
}

const precoTabela = (itemId, acab) => {
  const v = estado.dados?.precos?.[chavePreco(itemId, acab)];
  return v == null ? null : Number(v);
};

const material = (id) => estado.catalogo.materiais.find((m) => m.id === id);

// ---------- Formulário ----------

function preencherMateriais() {
  const sel = $("material");
  const grupos = { madeira: "Madeiras", outros: "Outros produtos" };
  sel.innerHTML = '<option value="" disabled selected>Selecione o material</option>' +
    Object.entries(grupos).map(([g, rotulo]) => `<optgroup label="${rotulo}">` +
      estado.catalogo.materiais.filter((m) => m.grupo === g)
        .map((m) => `<option value="${m.id}">${esc(m.nome)}</option>`).join("") +
      "</optgroup>").join("");
  sel.disabled = false;
}

function acabamentoEscolhido() {
  const marcado = document.querySelector('#acabamento input:checked');
  return marcado ? marcado.value : material($("material").value)?.acabamentos[0];
}

// ---------- Modo balcão: esconde custo e margem (a escolha fica guardada neste aparelho) ----------

const BALCAO_KEY = "madeireira_modo_balcao";
function lerBalcao() {
  try { return localStorage.getItem(BALCAO_KEY) === "1"; } catch { return false; }
}
function aplicarBalcao(ligado) {
  document.body.classList.toggle("modo-balcao", ligado);
  const b = $("btn-balcao");
  if (b) {
    b.setAttribute("aria-pressed", String(ligado));
    b.textContent = ligado ? "👁 Balcão (custo escondido)" : "👁 Modo balcão";
    b.title = ligado ? "Mostrar custo e margem de novo" : "Esconde custo e margem para o cliente não ver a tela";
  }
  // Medidas no seletor: o custo aparece no texto da opção
  for (const opt of $("dimension").options) {
    const it = estado.catalogo?.itens.get(opt.value);
    if (it) opt.textContent = rotuloMedida(it);
  }
}
function alternarBalcao() {
  const ligado = !document.body.classList.contains("modo-balcao");
  try { localStorage.setItem(BALCAO_KEY, ligado ? "1" : "0"); } catch { /* aparelho sem armazenamento: vale só agora */ }
  aplicarBalcao(ligado);
  if (estado.catalogo) { renderPedido(); atualizarPrevia(); }
}

function rotuloMedida(it) {
  if (document.body.classList.contains("modo-balcao")) return it.rotuloDimensao;
  const u = UNIDADES[it.unidade].cobranca;
  const custo = it.custo == null ? "sem custo" : `custo ${moeda(it.custo)}/${u}`;
  return `${it.rotuloDimensao} — ${custo}`;
}

function aoEscolherMaterial() {
  const m = material($("material").value);
  if (!m) return;
  const dim = $("dimension");
  dim.innerHTML = '<option value="" disabled selected>Selecione a medida</option>' +
    m.itens.map((it) => `<option value="${esc(it.id)}">${esc(rotuloMedida(it))}</option>`).join("");
  dim.disabled = false;
  if (m.itens.length === 1) dim.value = m.itens[0].id;

  // Acabamento
  const grupo = $("acabamento-group");
  grupo.hidden = m.acabamentos.length < 2;
  $("acabamento").innerHTML = m.acabamentos.map((a, i) =>
    `<label><input type="radio" name="acabamento" value="${a}" ${i === 0 ? "checked" : ""}><span>${ACABAMENTOS[a]}</span></label>`).join("");

  aoEscolherMedida();
}

function aoEscolherMedida() {
  const it = estado.catalogo.itens.get($("dimension").value);
  const u = it ? UNIDADES[it.unidade] : null;
  const livre = it?.unidade === "valor_livre";

  $("quantidade-group").hidden = livre;
  $("valor-livre-group").hidden = !livre;
  $("descricao-group").hidden = !livre;
  $("length-group").hidden = !u?.pedeComprimento;

  const q = $("quantity-pieces");
  q.disabled = !it;
  if (u) {
    $("quantity-pieces-label").textContent = u.rotuloQtd;
    q.step = u.inteiro ? "1" : "0.01";
    q.min = u.inteiro ? "1" : "0.01";
    q.placeholder = u.inteiro ? "Ex: 6" : "Ex: 12,5";
  }
  $("btn-adicionar").disabled = !it;
  atualizarPrevia();
}

function lerFormulario() {
  const it = estado.catalogo.itens.get($("dimension").value);
  if (!it) return null;
  return {
    itemId: it.id,
    acabamento: acabamentoEscolhido(),
    quantidade: lerNumero($("quantity-pieces").value),
    comprimento: lerNumero($("quantity-length").value),
    totalManual: it.unidade === "valor_livre" ? lerNumero($("valor-livre").value) : null,
    descricao: it.unidade === "valor_livre" ? $("descricao-livre").value.trim() : "",
    precoManual: null,
    variacaoPct: null,
    motivo: "",
  };
}

function calcularLinha(l) {
  const item = estado.catalogo.itens.get(l.itemId);
  return calcularItem({ ...l, item, precoTabela: precoTabela(l.itemId, l.acabamento) });
}

function atualizarPrevia() {
  const previa = $("calc-previa");
  const l = lerFormulario();
  if (!l) { previa.hidden = true; return; }
  try {
    const r = calcularLinha(l);
    const partes = [`<span>${numero(r.quantidadeCobrada, r.unidadeCobranca === "m" || r.unidadeCobranca === "m²" ? 2 : 0)} ${r.unidadeCobranca}</span>`,
      `<span class="sigilo">Custo <strong>${moeda(r.custoTotal)}</strong></span>`];
    partes.push(r.vendaTotal == null
      ? '<span class="texto-alerta">Sem preço de tabela: digite no pedido</span>'
      : `<span>Tabela <strong>${moeda(r.vendaTotal)}</strong></span><span class="sigilo">Margem <strong>${pct(r.margem)}</strong></span>`);
    previa.innerHTML = partes.join("");
    previa.hidden = false;
  } catch {
    previa.hidden = true;
  }
}

function adicionar(e) {
  e.preventDefault();
  const l = lerFormulario();
  if (!l) return;
  try {
    calcularLinha(l);
  } catch (err) {
    alert(err.message);
    return;
  }
  estado.pedido.push({ uid: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), ...l });
  // Mantém o material para lançar várias medidas seguidas
  const m = material($("material").value);
  $("dimension").value = m.itens.length === 1 ? m.itens[0].id : "";
  for (const id of ["quantity-pieces", "quantity-length", "valor-livre", "descricao-livre"]) $(id).value = "";
  aoEscolherMedida();
  $("dimension").focus();
  renderPedido();
}

// ---------- Pedido ----------

function salvarPedidoLocal() {
  try {
    localStorage.setItem(PEDIDO_KEY, JSON.stringify({ linhas: estado.pedido, motivoGeral: estado.motivoGeral, vinculo: estado.vinculo }));
  } catch { /* sem armazenamento local */ }
}

function restaurarPedido() {
  try {
    const salvo = JSON.parse(localStorage.getItem(PEDIDO_KEY) || "{}");
    const linhas = Array.isArray(salvo) ? salvo : salvo.linhas || [];
    estado.pedido = linhas
      .filter((l) => estado.catalogo.itens.has(l.itemId))
      .map((l) => ({ precoManual: null, variacaoPct: null, motivo: "", ...l }));
    estado.motivoGeral = Array.isArray(salvo) ? "" : salvo.motivoGeral || "";
    estado.vinculo = Array.isArray(salvo) ? null : salvo.vinculo || null;
  } catch {
    estado.pedido = [];
  }
}

function descreverQtd(l, r) {
  const item = estado.catalogo.itens.get(l.itemId);
  if (item.unidade === "valor_livre") return "—";
  if (UNIDADES[item.unidade].pedeComprimento) {
    return `${l.quantidade} pç × ${numero(l.comprimento)} m<small>${numero(r.quantidadeCobrada)} m</small>`;
  }
  return `${numero(r.quantidadeCobrada, item.unidade === "m2" ? 2 : 0)} ${r.unidadeCobranca}${r.quantidadeCobrada > 1 && item.unidade !== "m2" ? "s" : ""}`;
}

function margemClasse(m) {
  if (m == null) return "pill pill-neutra";
  if (m < 0) return "pill pill-ruim";
  return "pill pill-boa";
}

// "+R$ 9,90 (+10,0%)" em verde se acima da tabela, laranja se abaixo
function variacaoHtml(valor, pctValor) {
  if (valor == null || pctValor == null) return "";
  if (Math.abs(valor) < 0.005) return '<span class="variacao">igual à tabela</span>';
  const sinal = valor > 0 ? "+" : "−";
  return `<span class="variacao ${valor > 0 ? "acima" : "abaixo"}">${sinal}${moeda(Math.abs(valor))} (${sinal}${numero(Math.abs(pctValor), 1)}%) sobre a tabela</span>`;
}

const pctCampo = (v) => (v == null ? "" : numero(v, 1).replace(/\./g, "").replace(",", "."));

function chipsMotivo(ativo, acao) {
  return `<div class="motivos" role="group" aria-label="Motivo (opcional)">
    ${MOTIVOS_AJUSTE.map((m) => {
      const marcado = m === "Outro" ? ativo.startsWith("Outro") : ativo === m;
      const rotulo = m === "Outro" && marcado ? esc(ativo) : m;
      return `<button type="button" class="chip ${marcado ? "ativo" : ""}" onclick="${acao}('${m}')">${rotulo}</button>`;
    }).join("")}
  </div>`;
}

function linhaAjuste(l, r, item) {
  if (item.unidade === "valor_livre") return "";
  if (r.precoTabela == null) {
    return `<tr class="linha-ajuste"><td colspan="7"><div class="ajuste">
      <span class="texto-alerta">Sem preço de tabela: digite o preço acima${r.vendaTotal != null ? "" : " para fechar o pedido"}.</span>
    </div></td></tr>`;
  }
  return `<tr class="linha-ajuste"><td colspan="7"><div class="ajuste">
    <span class="tabela-ref">Tabela ${moeda(r.precoTabela)}/${r.unidadeCobranca} · ${moeda(r.tabelaTotal)}</span>
    <label class="pct-campo" title="% sobre a tabela (negativo = desconto)">
      <input type="number" step="0.1" inputmode="decimal" class="pct-input" value="${pctCampo(r.variacaoPct)}"
        aria-label="Variação em % sobre a tabela" onchange="Calculadora.pct('${l.uid}', this.value)">%
    </label>
    ${variacaoHtml(r.variacaoValor, r.variacaoPct)}
    ${chipsMotivo(l.motivo || "", `Calculadora.motivo.bind(null, '${l.uid}')`)}
    ${r.ajustado ? `<button type="button" class="link-suave" onclick="Calculadora.voltarTabela('${l.uid}')">↺ Voltar ao preço de tabela</button>` : ""}
  </div></td></tr>`;
}

function renderPedido() {
  const corpo = $("items-body");
  const resultados = [];
  corpo.innerHTML = estado.pedido.map((l) => {
    const item = estado.catalogo.itens.get(l.itemId);
    let r;
    try { r = calcularLinha(l); } catch (e) { return `<tr><td colspan="7">${esc(item.material)}: ${esc(e.message)}</td></tr>`; }
    resultados.push(r);
    const livre = item.unidade === "valor_livre";
    const tags = l.acabamento !== "UNICO" ? `<span class="tag">${ACABAMENTOS[l.acabamento]}</span>` : "";
    const valorInput = livre ? (r.vendaTotal ?? "") : (r.precoUnitario == null ? "" : arred(r.precoUnitario).toFixed(2));
    return `<tr class="linha-item">
      <td class="col-item"><strong>${esc(item.material)}</strong> ${esc(livre ? (l.descricao || "") : item.rotuloDimensao)} ${tags}</td>
      <td class="num">${descreverQtd(l, r)}</td>
      <td class="num so-tela sigilo">${r.custoTotal == null ? '<span class="texto-alerta">sem custo</span>' : moeda(r.custoTotal)}${r.custoUnitario != null && !livre ? `<small>${moeda(r.custoUnitario)}/${r.unidadeCobranca}</small>` : ""}</td>
      <td class="num">
        <div class="preco-cel">
          <input type="number" class="preco-input ${r.vendaTotal == null ? "falta" : ""} ${r.ajustado ? "alterado" : ""}" step="0.01" min="0" inputmode="decimal"
            value="${valorInput}" placeholder="digite" aria-label="Preço final"
            onchange="Calculadora.preco('${l.uid}', this.value)">
          <small>${livre ? "total" : "/" + r.unidadeCobranca}</small>
        </div>
      </td>
      <td class="num"><strong>${moeda(r.vendaTotal)}</strong></td>
      <td class="num so-tela sigilo"><span class="${margemClasse(r.margem)}">${pct(r.margem)}</span></td>
      <td><button class="delete-btn" title="Remover" aria-label="Remover item" onclick="Calculadora.remover('${l.uid}')">✕</button></td>
    </tr>${linhaAjuste(l, r, item)}`;
  }).join("");

  const vazio = estado.pedido.length === 0;
  $("pedido-vazio").hidden = !vazio;
  $("items-table").classList.toggle("sem-itens", vazio);

  const t = totalizarPedido(resultados);
  estado.ultimoTotal = t;
  estado.ultimosResultados = resultados;

  $("total-tabela").textContent = t.tabela > 0 ? moeda(t.tabela) : "—";
  $("total-tabela-nota").textContent = t.semTabela ? `${t.semTabela} ${t.semTabela > 1 ? "itens" : "item"} sem tabela` : "";
  const campoTotal = $("total-final");
  if (document.activeElement !== campoTotal) campoTotal.value = t.venda > 0 ? t.venda.toFixed(2) : "";
  $("total-variacao").innerHTML = t.variacaoPct == null ? "—" : variacaoHtml(t.variacao, t.variacaoPct).replace(" sobre a tabela", "");
  $("total-custo").textContent = moeda(t.custo);
  $("total-margem").textContent = pct(t.margem);
  $("total-margem").className = t.margem != null && t.margem < 0 ? "texto-ruim" : "";
  $("total-margem-nota").textContent = t.semPreco && t.margem != null ? "só dos itens com preço" : "";
  // % geral mostra o valor quando todos os itens com tabela têm o mesmo %
  const pcts = resultados.filter((r) => r.precoTabela != null && r.variacaoPct != null).map((r) => Math.round(r.variacaoPct * 10) / 10);
  const comum = pcts.length && pcts.every((p) => p === pcts[0]) && pcts[0] !== 0 ? pcts[0] : null;
  if (document.activeElement !== $("pct-geral")) $("pct-geral").value = comum == null ? "" : comum.toFixed(1);
  $("motivos-geral").innerHTML = chipsMotivo(estado.motivoGeral || "", "Calculadora.motivoGeral");
  $("voltar-tabela-geral").hidden = !resultados.some((r) => r.ajustado);

  const pend = [];
  if (t.semPreco) pend.push(`${t.semPreco} ${t.semPreco > 1 ? "itens sem" : "item sem"} preço: digite o preço na linha do item.`);
  if (t.semCusto && !document.body.classList.contains("modo-balcao")) pend.push(`${t.semCusto} ${t.semCusto > 1 ? "itens sem" : "item sem"} custo cadastrado: a margem não considera ${t.semCusto > 1 ? "esses itens" : "esse item"}.`);
  $("pendencias").innerHTML = pend.map((p) => `<li>${esc(p)}</li>`).join("");

  $("ajuste-geral").hidden = vazio;
  $("finalizar").hidden = vazio;
  $("total-cobrar").textContent = moeda(t.venda);
  renderVinculo();
  editorPagamentos.definirTotal(t.venda);
  salvarPedidoLocal();
}

function linha(uid) {
  return estado.pedido.find((l) => l.uid === uid);
}

function limparAjuste(l) {
  l.precoManual = null;
  l.totalManual = null;
  l.variacaoPct = null;
}

// Os campos da tabela disparam "change" ao perder o foco; redesenhar no meio desse evento
// remove o próprio campo e quebra. Por isso o redesenho vai para depois do evento.
const redesenhar = () => setTimeout(renderPedido, 0);

const pctPadrao = (motivo) => {
  const cfg = estado.catalogo.config.modificadores;
  if (motivo === "Selecionada" && cfg.selecionadaPct) return Number(cfg.selecionadaPct);
  if (motivo === "Últimas peças" && cfg.ultimasPecasPct) return -Number(cfg.ultimasPecasPct);
  return null;
};

function pedirOutro(atual) {
  const texto = prompt("Qual o motivo?", atual.startsWith("Outro: ") ? atual.slice(7) : "");
  return texto === null || !texto.trim() ? null : `Outro: ${texto.trim()}`;
}

// ---------- Orçamentos ----------

function renderVinculo() {
  const el = $("orc-vinculo");
  const v = estado.vinculo;
  $("btn-salvar-orcamento").textContent = v?.modo === "editar" ? `💾 Salvar alterações no ${v.id}` : "💾 Salvar como orçamento";
  if (!v || !estado.pedido.length) { el.hidden = true; return; }
  const textos = {
    editar: `Editando o orçamento <strong>${esc(v.id)}</strong>. Ao salvar, o número continua o mesmo.`,
    converter: `Venda do orçamento <strong>${esc(v.id)}</strong>: ao registrar a venda, o orçamento é marcado como Fechado.`,
    duplicar: `Cópia do orçamento <strong>${esc(v.id)}</strong>: ao salvar, vira um orçamento novo.`,
  };
  el.innerHTML = `${textos[v.modo]} <button type="button" class="link-suave" onclick="Calculadora.desvincular()">desfazer vínculo</button>`;
  el.hidden = false;
}

// Fotografia do pedido para gravar no orçamento (preços do dia)
function fotografiaPedido() {
  const resultados = estado.pedido.map(calcularLinha);
  const t = totalizarPedido(resultados);
  const itens = estado.pedido.map((l, i) => {
    const item = estado.catalogo.itens.get(l.itemId);
    const r = resultados[i];
    const livre = item.unidade === "valor_livre";
    const acab = l.acabamento !== "UNICO" ? ` (${ACABAMENTOS[l.acabamento].toLowerCase()})` : "";
    return {
      itemId: l.itemId, acabamento: l.acabamento, quantidade: l.quantidade, comprimento: l.comprimento,
      descricao: livre ? `${item.material}${l.descricao ? " - " + l.descricao : ""}` : `${item.material} ${item.rotuloDimensao}${acab}`,
      descricaoLivre: l.descricao || "",
      quantidadeTexto: livre ? "" : descreverQtd(l, r).replace(/<small>/, " = ").replace(/<[^>]+>/g, ""),
      unidade: livre ? "un" : r.unidadeCobranca,
      precoTabela: r.precoTabela, tabelaTotal: r.tabelaTotal,
      precoUnitario: r.precoUnitario == null ? null : arred(r.precoUnitario),
      vendaTotal: r.vendaTotal, custoTotal: r.custoTotal, variacaoPct: r.variacaoPct, motivo: l.motivo || "",
    };
  });
  return { itens, total: t.venda, custo: t.custo, margem: t.margem, tabelaTotal: t.tabela, variacao: t.variacao, motivoGeral: estado.motivoGeral || "", semPreco: t.semPreco };
}

window.Calculadora = {
  recarregar: carregar,

  remover(uid) {
    estado.pedido = estado.pedido.filter((l) => l.uid !== uid);
    renderPedido();
  },

  // Preço final digitado na linha (o % é recalculado)
  preco(uid, valor) {
    const l = linha(uid);
    const item = estado.catalogo.itens.get(l.itemId);
    const v = lerNumero(valor);
    if (item.unidade === "valor_livre") {
      l.totalManual = v;
      return redesenhar();
    }
    limparAjuste(l);
    l.precoManual = v; // vazio = volta à tabela
    redesenhar();
  },

  // % sobre a tabela digitado na linha (o preço é recalculado)
  pct(uid, valor) {
    const l = linha(uid);
    const v = lerNumero(valor);
    limparAjuste(l);
    l.variacaoPct = v == null || v === 0 ? null : v;
    redesenhar();
  },

  // Motivo opcional; "Selecionada" e "Últimas peças" aplicam o % padrão
  motivo(uid, escolhido) {
    const l = linha(uid);
    if (l.motivo === escolhido) {
      l.motivo = "";
      return renderPedido();
    }
    if (escolhido === "Outro") {
      const texto = pedirOutro(l.motivo || "");
      if (!texto) return;
      l.motivo = texto;
    } else {
      l.motivo = escolhido;
      const p = pctPadrao(escolhido);
      if (p != null) {
        limparAjuste(l);
        l.variacaoPct = p;
      }
    }
    renderPedido();
  },

  voltarTabela(uid) {
    const l = linha(uid);
    limparAjuste(l);
    l.motivo = "";
    renderPedido();
  },

  // Total do pedido editado: a diferença é distribuída proporcionalmente entre os itens
  total(valor) {
    const v = lerNumero(valor);
    const t = estado.ultimoTotal;
    if (v == null || !t || Math.abs(v - t.venda) < 0.005) return redesenhar();
    let totais;
    try {
      totais = distribuirTotal(estado.ultimosResultados, v);
    } catch (e) {
      alert(e.message);
      return redesenhar();
    }
    estado.pedido.forEach((l, i) => {
      if (totais[i] == null) return;
      limparAjuste(l);
      l.totalManual = totais[i];
    });
    redesenhar();
  },

  // % geral sobre a tabela, aplicado a todos os itens que têm preço de tabela
  pctGeral(valor) {
    const v = lerNumero(valor);
    if (v == null) return;
    estado.pedido.forEach((l, i) => {
      if (estado.ultimosResultados[i]?.precoTabela == null) return;
      limparAjuste(l);
      l.variacaoPct = v === 0 ? null : v;
    });
    redesenhar();
  },

  motivoGeral(escolhido) {
    if (estado.motivoGeral === escolhido) {
      estado.motivoGeral = "";
      return renderPedido();
    }
    if (escolhido === "Outro") {
      const texto = pedirOutro(estado.motivoGeral || "");
      if (!texto) return;
      estado.motivoGeral = texto;
      return renderPedido();
    }
    estado.motivoGeral = escolhido;
    const p = pctPadrao(escolhido);
    if (p != null) return window.Calculadora.pctGeral(String(p));
    renderPedido();
  },

  voltarTudoTabela() {
    estado.pedido.forEach((l) => {
      const item = estado.catalogo.itens.get(l.itemId);
      if (item.unidade === "valor_livre") return;
      limparAjuste(l);
      l.motivo = "";
    });
    estado.motivoGeral = "";
    renderPedido();
  },

  whatsapp() {
    if (!estado.pedido.length) return alert("O pedido está vazio.");
    const itens = estado.pedido.map((l) => {
      const item = estado.catalogo.itens.get(l.itemId);
      const r = calcularLinha(l);
      const livre = item.unidade === "valor_livre";
      const acab = l.acabamento !== "UNICO" ? ` (${ACABAMENTOS[l.acabamento].toLowerCase()})` : "";
      return {
        descricao: livre ? `${item.material}${l.descricao ? " - " + l.descricao : ""}` : `${item.material} ${item.rotuloDimensao}${acab}`,
        quantidade: livre ? "" : descreverQtd(l, r).replace(/<small>/, " = ").replace(/<[^>]+>/g, ""),
        precoUnitario: r.precoUnitario == null ? null : arred(r.precoUnitario),
        unidade: livre ? "un" : r.unidadeCobranca,
        vendaTotal: r.vendaTotal,
      };
    });
    const texto = textoWhatsApp({ data: new Date().toLocaleDateString("pt-BR"), itens, totalItens: estado.ultimoTotal.venda });
    $("whatsapp-texto").value = texto;
    $("whatsapp-abrir").href = "https://wa.me/?text=" + encodeURIComponent(texto);
    $("whatsapp-copiado").textContent = "";
    $("modal-whatsapp").style.display = "flex";
  },

  async copiarWhatsapp() {
    const campo = $("whatsapp-texto");
    try {
      await navigator.clipboard.writeText(campo.value);
    } catch {
      campo.select();
      document.execCommand("copy");
    }
    $("whatsapp-copiado").textContent = "Copiado! Agora é só colar na conversa.";
  },

  fecharWhatsapp() {
    $("modal-whatsapp").style.display = "none";
  },

  limpar(perguntar) {
    if (perguntar && estado.pedido.length && !confirm("Remover todos os itens do pedido?")) return;
    estado.pedido = [];
    estado.motivoGeral = "";
    estado.vinculo = null;
    editorPagamentos.reiniciar(0);
    $("calc-nfe").value = "";
    renderPedido();
  },

  // Formas de pagamento da venda (lança erro se a soma não fechar com o total)
  pagamentos() {
    return editorPagamentos.ler();
  },

  fotografia: fotografiaPedido,
  vinculo: () => estado.vinculo,
  desvincular() {
    estado.vinculo = null;
    renderPedido();
  },

  // Para a aba Orçamentos: catálogo e preço de tabela atuais
  catalogoAtual: () => (estado.catalogo ? { item: (id) => estado.catalogo.itens.get(id), preco: (id, acab) => precoTabela(id, acab) } : null),

  /**
   * Carrega um orçamento no pedido.
   * modo: "editar" | "converter" | "duplicar"; precos: "orcamento" (congelados) ou "atuais" (tabela de hoje, mesmo %)
   */
  async carregarOrcamento(orc, modo, precos = "orcamento") {
    if (!estado.catalogo) await carregar();
    if (estado.pedido.length && !confirm("O pedido atual será substituído pelo orçamento. Continuar?")) return false;
    estado.pedido = orc.itens.filter((i) => estado.catalogo.itens.has(i.itemId)).map((i) => {
      const item = estado.catalogo.itens.get(i.itemId);
      const livre = item.unidade === "valor_livre";
      const tabelaHoje = precoTabela(i.itemId, i.acabamento);
      const linha = {
        uid: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
        itemId: i.itemId, acabamento: i.acabamento, quantidade: i.quantidade, comprimento: i.comprimento,
        descricao: i.descricaoLivre || "", precoManual: null, variacaoPct: null, totalManual: null, motivo: i.motivo || "",
      };
      if (livre || precos === "orcamento") linha.totalManual = i.vendaTotal;
      else if (tabelaHoje != null) linha.variacaoPct = i.variacaoPct ? arred(i.variacaoPct) : null;
      else linha.precoManual = i.precoUnitario;
      return linha;
    });
    estado.motivoGeral = orc.motivoGeral || "";
    estado.vinculo = { id: orc.id, modo, cliente: orc.cliente, origem: orc.origem, obs: orc.obs, validadeDias: orc.validadeDias };
    editorPagamentos.reiniciar(0);
    renderPedido();
    return true;
  },

  // Usado por registerDirectSale (script.js): tudo o que a venda grava
  resumo() {
    const resultados = estado.pedido.map(calcularLinha);
    const t = totalizarPedido(resultados);
    const itens = estado.pedido.map((l, i) => {
      const item = estado.catalogo.itens.get(l.itemId);
      const r = resultados[i];
      return {
        itemId: l.itemId,
        descricao: item.unidade === "valor_livre" ? `${item.material}${l.descricao ? " - " + l.descricao : ""}` : `${item.material} ${item.rotuloDimensao}`,
        acabamento: l.acabamento,
        quantidadeCobrada: r.quantidadeCobrada,
        unidade: r.unidadeCobranca,
        custoTotal: r.custoTotal,
        precoTabela: r.precoTabela,
        tabelaTotal: r.tabelaTotal,
        precoUnitario: r.precoUnitario,
        vendaTotal: r.vendaTotal,
        variacaoPct: r.variacaoPct,
        motivo: l.motivo || "",
      };
    });
    return {
      itens,
      custo: t.custo,
      venda: t.venda,
      tabela: t.tabela,
      variacao: t.variacao,
      variacaoPct: t.variacaoPct,
      motivoGeral: estado.motivoGeral || "",
      semPreco: t.semPreco,
      descricao: itens.map((i) => i.descricao).join(", ").slice(0, 300),
    };
  },
};

// ---------- Aba Preços ----------

const admin = { alteracoes: {}, carregado: false };

function valorAtual(chave) {
  if (chave in admin.alteracoes) return admin.alteracoes[chave];
  const v = estado.dados.precos[chave];
  return v == null ? null : Number(v);
}

function renderConfig() {
  const cfg = estado.catalogo.config;
  $("cfg-selecionada").value = cfg.modificadores.selecionadaPct;
  $("cfg-ultimas").value = cfg.modificadores.ultimasPecasPct;
  $("cfg-cepilhado").innerHTML = Object.keys(CEPILHADO_PADRAO).map((id) =>
    `<label class="check"><input type="checkbox" value="${id}" ${cfg.temCepilhado[id] ? "checked" : ""}> ${esc(material(id)?.nome || id)}</label>`).join("");
  $("admin-aviso-kv").hidden = estado.dados.kvDisponivel;
}

function renderFiltro() {
  const sel = $("precos-filtro-material");
  if (sel.options.length) return;
  sel.innerHTML = '<option value="">Todos</option>' + estado.catalogo.materiais
    .filter((m) => m.id !== "RETALHO")
    .map((m) => `<option value="${m.id}">${esc(m.nome)}</option>`).join("");
}

function celulaPreco(item, acab, habilitado) {
  if (!habilitado) return '<td class="num texto-suave">—</td>';
  const chave = chavePreco(item.id, acab);
  const v = valorAtual(chave);
  const margem = v && item.custo != null ? (v - item.custo) / v : null;
  return `<td class="num">
    <input type="number" class="preco-input ${chave in admin.alteracoes ? "alterado" : ""}" step="0.01" min="0" inputmode="decimal"
      value="${v ?? ""}" placeholder="—" data-chave="${esc(chave)}" aria-label="Preço ${ACABAMENTOS[acab]}">
    <small class="${margem != null && margem < 0 ? "texto-ruim" : ""}">${margem == null ? "&nbsp;" : "margem " + pct(margem)}</small>
  </td>`;
}

function renderTabelaPrecos() {
  const filtroMat = $("precos-filtro-material").value;
  const filtroStatus = $("precos-filtro-status").value;
  let total = 0, preenchidos = 0;
  const linhas = [];
  for (const m of estado.catalogo.materiais) {
    if (m.id === "RETALHO" || (filtroMat && m.id !== filtroMat)) continue;
    const acabs = m.grupo === "madeira" ? ["BRUTO", "CEPILHADO"] : ["UNICO"];
    const linhasMat = [];
    for (const it of m.itens) {
      const ativos = acabs.filter((a) => a !== "CEPILHADO" || m.temCepilhado);
      const valores = ativos.map((a) => valorAtual(chavePreco(it.id, a)));
      total += ativos.length;
      const n = valores.filter((v) => v != null).length;
      preenchidos += n;
      if (filtroStatus === "vazios" && n === ativos.length) continue;
      if (filtroStatus === "preenchidos" && n === 0) continue;
      const u = UNIDADES[it.unidade].cobranca;
      linhasMat.push(`<tr>
        <td>${esc(it.rotuloDimensao)} <small class="texto-suave">/${u}</small></td>
        <td class="num">${it.custo == null ? '<span class="texto-alerta">sem custo</span>' : moeda(it.custo)}</td>
        ${celulaPreco(it, acabs[0], true)}
        ${celulaPreco(it, "CEPILHADO", m.grupo === "madeira" && m.temCepilhado)}
      </tr>`);
    }
    if (linhasMat.length) linhas.push(`<tr class="grupo-linha"><td colspan="4">${esc(m.nome)}</td></tr>`, ...linhasMat);
  }
  $("precos-body").innerHTML = linhas.join("") || '<tr><td colspan="4" class="texto-suave">Nada para mostrar com esse filtro.</td></tr>';
  $("precos-contagem").textContent = `${preenchidos} de ${total} preços preenchidos`;
  const n = Object.keys(admin.alteracoes).length;
  $("precos-barra").hidden = n === 0;
  $("precos-alterados").textContent = `${n} ${n === 1 ? "alteração" : "alterações"} sem salvar`;
}

window.Precos = {
  async abrir() {
    if (!estado.catalogo) await carregar();
    if (!estado.catalogo) return;
    renderConfig();
    renderFiltro();
    renderTabelaPrecos();
  },

  descartar() {
    admin.alteracoes = {};
    renderTabelaPrecos();
  },

  async salvar() {
    const alteracoes = admin.alteracoes;
    if (!Object.keys(alteracoes).length) return;
    try {
      await window.api("/api/precos", { method: "POST", body: { alteracoes } });
    } catch (e) {
      alert(`Os preços não foram salvos: ${e.message}`);
      return;
    }
    for (const [k, v] of Object.entries(alteracoes)) {
      if (v == null) delete estado.dados.precos[k]; else estado.dados.precos[k] = v;
    }
    admin.alteracoes = {};
    reconstruirCatalogo();
    renderTabelaPrecos();
    renderPedido();
    alert("Preços salvos.");
  },

  async salvarConfig() {
    const temCepilhado = {};
    document.querySelectorAll("#cfg-cepilhado input").forEach((c) => { temCepilhado[c.value] = c.checked; });
    const config = {
      modificadores: { selecionadaPct: lerNumero($("cfg-selecionada").value) || 0, ultimasPecasPct: lerNumero($("cfg-ultimas").value) || 0 },
      temCepilhado,
    };
    try {
      const r = await window.api("/api/config", { method: "POST", body: { config } });
      estado.dados.config = r.config;
    } catch (e) {
      alert(`Os ajustes não foram salvos: ${e.message}`);
      return;
    }
    reconstruirCatalogo();
    renderConfig();
    renderTabelaPrecos();
    renderPedido();
    if ($("material").value) aoEscolherMaterial();
    alert("Ajustes salvos.");
  },
};

// ---------- Eventos ----------

$("material").addEventListener("change", aoEscolherMaterial);
$("dimension").addEventListener("change", aoEscolherMedida);
$("acabamento").addEventListener("change", atualizarPrevia);
for (const id of ["quantity-pieces", "quantity-length", "valor-livre"]) {
  $(id).addEventListener("input", atualizarPrevia);
}
$("calc-form").addEventListener("submit", adicionar);
$("precos-filtro-material").addEventListener("change", renderTabelaPrecos);
$("precos-filtro-status").addEventListener("change", renderTabelaPrecos);
$("precos-body").addEventListener("change", (e) => {
  const input = e.target.closest("input[data-chave]");
  if (!input) return;
  const chave = input.dataset.chave;
  const v = lerNumero(input.value);
  const original = estado.dados.precos[chave] == null ? null : Number(estado.dados.precos[chave]);
  if (v === original) delete admin.alteracoes[chave]; else admin.alteracoes[chave] = v;
  // Atualiza só esta célula, para não tirar o foco de quem está digitando em sequência
  input.classList.toggle("alterado", chave in admin.alteracoes);
  const item = estado.catalogo.itens.get(chave.slice(0, chave.lastIndexOf("|")));
  const margem = v && item?.custo != null ? (v - item.custo) / v : null;
  const legenda = input.nextElementSibling;
  legenda.innerHTML = margem == null ? "&nbsp;" : "margem " + pct(margem);
  legenda.className = margem != null && margem < 0 ? "texto-ruim" : "";
  const n = Object.keys(admin.alteracoes).length;
  $("precos-barra").hidden = n === 0;
  $("precos-alterados").textContent = `${n} ${n === 1 ? "alteração" : "alterações"} sem salvar`;
});
window.addEventListener("beforeunload", (e) => {
  if (Object.keys(admin.alteracoes).length) e.preventDefault();
});

$("btn-balcao").addEventListener("click", alternarBalcao);
aplicarBalcao(lerBalcao());
carregar();
