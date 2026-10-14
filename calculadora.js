// Calculadora (pedido) e aba Preços. Os cálculos ficam em lib/calculo.js (calcularItem).
import { montarCatalogo, chavePreco, UNIDADES, ACABAMENTOS, CEPILHADO_PADRAO } from "./lib/catalogo.js";
import { calcularItem, totalizarPedido, arred } from "./lib/calculo.js";

const $ = (id) => document.getElementById(id);
const moeda = (v) => (v == null ? "—" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v));
const numero = (v, casas = 2) => new Intl.NumberFormat("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas }).format(v);
const pct = (v) => (v == null ? "—" : `${numero(v * 100, 1)}%`);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const lerNumero = (v) => (v === "" || v == null ? null : Number(String(v).replace(",", ".")));

const PEDIDO_KEY = "madeireira_pedido";

const estado = {
  dados: null,      // { custos, precos, config, kvDisponivel }
  catalogo: null,   // montarCatalogo(...)
  pedido: [],       // linhas do pedido
  valorEditado: false,
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

function aoEscolherMaterial() {
  const m = material($("material").value);
  if (!m) return;
  const dim = $("dimension");
  dim.innerHTML = '<option value="" disabled selected>Selecione a medida</option>' +
    m.itens.map((it) => {
      const u = UNIDADES[it.unidade].cobranca;
      const custo = it.custo == null ? "sem custo" : `custo ${moeda(it.custo)}/${u}`;
      return `<option value="${esc(it.id)}">${esc(it.rotuloDimensao)} — ${custo}</option>`;
    }).join("");
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
  $("modificadores").hidden = !it || livre;

  const q = $("quantity-pieces");
  q.disabled = !it;
  if (u) {
    $("quantity-pieces-label").textContent = u.rotuloQtd;
    q.step = u.inteiro ? "1" : "0.01";
    q.min = u.inteiro ? "1" : "0.01";
    q.placeholder = u.inteiro ? "Ex: 6" : "Ex: 12,5";
  }
  const cfg = estado.catalogo.config.modificadores;
  $("pct-selecionada").textContent = cfg.selecionadaPct ? `+${numero(cfg.selecionadaPct, 0)}%` : "0% · ajuste em Preços";
  $("pct-ultimas").textContent = cfg.ultimasPecasPct ? `−${numero(cfg.ultimasPecasPct, 0)}%` : "0% · ajuste em Preços";
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
    modificadores: { selecionada: $("mod-selecionada").checked, ultimasPecas: $("mod-ultimas").checked },
    precoManual: null,
    motivoAjuste: "",
  };
}

function calcularLinha(l) {
  const item = estado.catalogo.itens.get(l.itemId);
  return calcularItem({ ...l, item, precoTabela: precoTabela(l.itemId, l.acabamento) }, estado.catalogo.config);
}

function atualizarPrevia() {
  const previa = $("calc-previa");
  const l = lerFormulario();
  if (!l) { previa.hidden = true; return; }
  try {
    const r = calcularLinha(l);
    const partes = [`<span>${numero(r.quantidadeCobrada, r.unidadeCobranca === "m" || r.unidadeCobranca === "m²" ? 2 : 0)} ${r.unidadeCobranca}</span>`,
      `<span>Custo <strong>${moeda(r.custoTotal)}</strong></span>`];
    partes.push(r.vendaTotal == null
      ? '<span class="texto-alerta">Sem preço de venda: digite no pedido</span>'
      : `<span>Venda <strong>${moeda(r.vendaTotal)}</strong></span><span>Margem <strong>${pct(r.margem)}</strong></span>`);
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
  $("mod-selecionada").checked = false;
  $("mod-ultimas").checked = false;
  aoEscolherMedida();
  $("dimension").focus();
  renderPedido();
}

// ---------- Pedido ----------

function salvarPedidoLocal() {
  try { localStorage.setItem(PEDIDO_KEY, JSON.stringify(estado.pedido)); } catch { /* sem armazenamento local */ }
}

function restaurarPedido() {
  try {
    const salvo = JSON.parse(localStorage.getItem(PEDIDO_KEY) || "[]");
    estado.pedido = salvo.filter((l) => estado.catalogo.itens.has(l.itemId));
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

function renderPedido() {
  const corpo = $("items-body");
  const resultados = [];
  corpo.innerHTML = estado.pedido.map((l) => {
    const item = estado.catalogo.itens.get(l.itemId);
    let r;
    try { r = calcularLinha(l); } catch (e) { return `<tr><td colspan="7">${esc(item.material)}: ${esc(e.message)}</td></tr>`; }
    resultados.push(r);
    const livre = item.unidade === "valor_livre";
    const tags = [];
    if (l.acabamento !== "UNICO") tags.push(`<span class="tag">${ACABAMENTOS[l.acabamento]}</span>`);
    if (l.modificadores.selecionada) tags.push('<span class="tag tag-mais">Selecionada</span>');
    if (l.modificadores.ultimasPecas) tags.push('<span class="tag tag-menos">Últimas peças</span>');
    const motivo = r.ajusteManual
      ? (r.motivoAjuste ? `<small class="motivo">Ajuste: ${esc(r.motivoAjuste)} <button type="button" class="link-suave" onclick="Calculadora.motivo('${l.uid}')">editar</button></small>` : `<button type="button" class="link-alerta" onclick="Calculadora.motivo('${l.uid}')">Preço alterado: informar motivo</button>`)
      : "";
    const sugerido = r.ajusteManual ? `<small>tabela ${moeda(r.precoSugerido)}</small>` : "";
    const temTabela = r.precoTabela != null;
    const valorInput = livre ? (r.vendaTotal ?? "") : (r.precoUnitario == null ? "" : arred(r.precoUnitario).toFixed(2));
    const toggles = temTabela ? `
        <span class="mini-mods">
          <label title="Madeira selecionada"><input type="checkbox" ${l.modificadores.selecionada ? "checked" : ""} onchange="Calculadora.modificador('${l.uid}','selecionada',this.checked)">Selec.</label>
          <label title="Últimas peças"><input type="checkbox" ${l.modificadores.ultimasPecas ? "checked" : ""} onchange="Calculadora.modificador('${l.uid}','ultimasPecas',this.checked)">Últ.</label>
        </span>` : "";
    return `<tr>
      <td class="col-item"><strong>${esc(item.material)}</strong> ${esc(livre ? (l.descricao || "") : item.rotuloDimensao)} ${tags.join(" ")}${motivo}</td>
      <td class="num">${descreverQtd(l, r)}</td>
      <td class="num so-tela">${r.custoTotal == null ? '<span class="texto-alerta">sem custo</span>' : moeda(r.custoTotal)}${r.custoUnitario != null && !livre ? `<small>${moeda(r.custoUnitario)}/${r.unidadeCobranca}</small>` : ""}</td>
      <td class="num">
        <div class="preco-cel">
          <input type="number" class="preco-input ${r.vendaTotal == null ? "falta" : ""}" step="0.01" min="0" inputmode="decimal"
            value="${valorInput}" placeholder="digite" aria-label="Preço de venda"
            onchange="Calculadora.preco('${l.uid}', this.value)">
          <small>${livre ? "total" : "/" + r.unidadeCobranca}</small>
        </div>
        ${sugerido}${toggles}
      </td>
      <td class="num"><strong>${moeda(r.vendaTotal)}</strong></td>
      <td class="num so-tela"><span class="${margemClasse(r.margem)}">${pct(r.margem)}</span></td>
      <td><button class="delete-btn" title="Remover" aria-label="Remover item" onclick="Calculadora.remover('${l.uid}')">✕</button></td>
    </tr>`;
  }).join("");

  const vazio = estado.pedido.length === 0;
  $("pedido-vazio").hidden = !vazio;
  $("items-table").classList.toggle("sem-itens", vazio);

  const t = totalizarPedido(resultados);
  $("total-custo").textContent = moeda(t.custo);
  $("total-venda").textContent = t.semPreco && !t.venda ? "—" : moeda(t.venda);
  $("total-margem").textContent = pct(t.margem);
  $("total-margem-nota").textContent = t.semPreco && t.margem != null ? "só dos itens com preço" : "";
  $("total-margem").className = t.margem != null && t.margem < 0 ? "texto-ruim" : "";

  const pend = [];
  if (t.semPreco) pend.push(`${t.semPreco} ${t.semPreco > 1 ? "itens sem" : "item sem"} preço de venda: digite o preço na linha do item.`);
  if (t.semCusto) pend.push(`${t.semCusto} ${t.semCusto > 1 ? "itens sem" : "item sem"} custo cadastrado: a margem não considera ${t.semCusto > 1 ? "esses itens" : "esse item"}.`);
  const semMotivo = resultados.filter((r) => r.pendencias.includes("ajuste_sem_motivo")).length;
  if (semMotivo) pend.push(`${semMotivo} preço${semMotivo > 1 ? "s alterados" : " alterado"} sem motivo.`);
  $("pendencias").innerHTML = pend.map((p) => `<li>${esc(p)}</li>`).join("");

  $("finalizar").hidden = vazio;
  estado.ultimoTotal = t;
  estado.ultimosResultados = resultados;
  if (!estado.valorEditado) $("direct-sale-price").value = t.venda > 0 ? t.venda.toFixed(2) : "";
  atualizarInfoValor();
  salvarPedidoLocal();
}

function atualizarInfoValor() {
  const info = $("valor-cobrado-info");
  const t = estado.ultimoTotal;
  const cobrado = lerNumero($("direct-sale-price").value);
  if (!t || !cobrado) { info.textContent = ""; return; }
  const partes = [];
  if (t.venda > 0 && Math.abs(cobrado - t.venda) >= 0.01) {
    const dif = cobrado - t.venda;
    partes.push(`${dif < 0 ? "Desconto" : "Acréscimo"} de ${moeda(Math.abs(dif))} (${numero(Math.abs(dif) / t.venda * 100, 1)}%) sobre os itens.`);
  }
  if (t.semPreco) partes.push("Inclua no valor os itens sem preço.");
  partes.push(`Margem final: ${pct((cobrado - t.custo) / cobrado)}.`);
  info.textContent = partes.join(" ");
}

function linha(uid) {
  return estado.pedido.find((l) => l.uid === uid);
}

// Os campos da tabela disparam "change" ao perder o foco; redesenhar no meio desse evento
// remove o próprio campo e quebra. Por isso o redesenho vai para depois do evento.
const redesenhar = () => setTimeout(renderPedido, 0);

window.Calculadora = {
  recarregar: carregar,

  remover(uid) {
    estado.pedido = estado.pedido.filter((l) => l.uid !== uid);
    renderPedido();
  },

  modificador(uid, nome, ligado) {
    const l = linha(uid);
    l.modificadores[nome] = ligado;
    // Mudou a base do preço: volta ao sugerido
    l.precoManual = null;
    l.motivoAjuste = "";
    redesenhar();
  },

  preco(uid, valor) {
    const l = linha(uid);
    const item = estado.catalogo.itens.get(l.itemId);
    const v = lerNumero(valor);
    if (item.unidade === "valor_livre") {
      l.totalManual = v;
      return redesenhar();
    }
    const sugerido = calcularItem({ ...l, item, precoManual: null, precoTabela: precoTabela(l.itemId, l.acabamento) }, estado.catalogo.config).precoSugerido;
    if (v == null || (sugerido != null && Math.abs(v - sugerido) < 0.005)) {
      l.precoManual = null;
      l.motivoAjuste = "";
      return redesenhar();
    }
    if (sugerido != null) {
      const motivo = prompt(`Preço de tabela: ${moeda(sugerido)}. Qual o motivo do ajuste para ${moeda(v)}?`, l.motivoAjuste || "");
      if (motivo === null) return redesenhar(); // cancelou: volta o valor anterior
      l.motivoAjuste = motivo.trim();
    }
    l.precoManual = v;
    redesenhar();
  },

  motivo(uid) {
    const l = linha(uid);
    const motivo = prompt("Motivo do ajuste de preço:", l.motivoAjuste || "");
    if (motivo === null) return;
    l.motivoAjuste = motivo.trim();
    renderPedido();
  },

  limpar(perguntar) {
    if (perguntar && estado.pedido.length && !confirm("Remover todos os itens do pedido?")) return;
    estado.pedido = [];
    estado.valorEditado = false;
    $("direct-sale-price").value = "";
    renderPedido();
  },

  // Usado por registerDirectSale (script.js)
  resumo() {
    const t = estado.ultimoTotal || totalizarPedido([]);
    const resultados = estado.pedido.map(calcularLinha);
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
        precoUnitario: r.precoUnitario,
        vendaTotal: r.vendaTotal,
        selecionada: l.modificadores.selecionada,
        ultimasPecas: l.modificadores.ultimasPecas,
        motivoAjuste: r.motivoAjuste,
      };
    });
    return {
      itens,
      custo: t.custo,
      venda: t.venda,
      descricao: itens.map((i) => i.descricao).join(", ").slice(0, 300),
      pendencias: { ajusteSemMotivo: resultados.some((r) => r.pendencias.includes("ajuste_sem_motivo")) },
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
for (const id of ["quantity-pieces", "quantity-length", "valor-livre", "mod-selecionada", "mod-ultimas"]) {
  $(id).addEventListener("input", atualizarPrevia);
}
$("calc-form").addEventListener("submit", adicionar);
$("direct-sale-price").addEventListener("input", (e) => {
  estado.valorEditado = e.target.value !== "";
  atualizarInfoValor();
});
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

carregar();
