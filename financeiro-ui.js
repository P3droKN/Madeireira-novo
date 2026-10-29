// Navegação das abas Caixa, Relatórios e Ajustes (sub-abas) e as telas de:
// Caixa › Lançar e Lançamentos; Relatórios › Resumo do mês, DRE e Formas de pagamento; Ajustes › Financeiro e Orçamentos.
// Saldos, Cheques, Fluxo de caixa e Abertura de saldos ficam em caixa-ui.js.
import { CONTAS, GRUPOS, contaPorId, grupoPorId, naturezaDaConta, FORMAS_PADRAO, PAGO_COM, mesclarConfigFinanceiro } from "./lib/planoContas.js";
import { montarDRE, montarDREAnual, normalizar, mesDe, estoqueEstimado, VINCULOS, pontoEquilibrioMedio } from "./lib/financeiro.js";
import { resumoDoMes, vendasPorForma } from "./lib/relatorios.js";
import { criarEditorPagamentos } from "./pagamentos.js";
import { recebidoDeFiadoAnterior } from "./lib/receber.js";
import { sugestaoDe } from "./lib/migracaoV2.js";
import { criarItensCaixa } from "./itens-caixa.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const moeda = (v) => (v == null ? "—" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v));
const pct = (v) => (v == null || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(1).replace(".", ",")}%`);
const num = (v) => (v === "" || v == null ? null : Number(String(v).replace(",", ".")));
const dataBR = (d) => (d ? d.split("-").reverse().join("/") : "");
const C = () => window.Caixa;
// Estimativas contábeis (Ajustes › Financeiro): desligadas, some o vínculo CLT/não CLT/pró-labore (o gravado fica)
const estimativasLigadas = () => mesclarConfigFinanceiro(C()?.configFinanceiro).estimativasContabeis === true;

const FORMAS = Object.fromEntries(FORMAS_PADRAO.map((f) => [f.id, f]));
const NOME_PAGO = Object.fromEntries(PAGO_COM.map((p) => [p.id, p.nome]));
const CONTAS_FIN = { gaveta: "Gaveta", bradesco: "Bradesco", picpay: "PicPay", cheques_carteira: "Cheques em carteira" };

const estado = { aba: null, sub: { caixa: "lancar", relatorios: "resumo", ajustes: "precos" }, selecionados: new Set(), editor: null, visivel: [] };

// Sub-aba -> elemento da tela
const TELAS = {
  caixa: { lancar: "fin-lancar", saldos: "fin-saldos", cheques: "fin-cheques", receber: "fin-receber", lista: "fin-lista" },
  relatorios: { resumo: "rel-resumo", dre: "fin-dre", fluxo: "rel-fluxo", formas: "rel-formas", receber: "rel-receber", orcamentos: "rel-orcamentos" },
  ajustes: { precos: "aj-precos", financeiro: "aj-financeiro", orcamentos: "aj-orcamentos", impressao: "aj-impressao", saldos: "aj-saldos", dados: "aj-dados" },
};

function opcoesContas(filtro, selecionada) {
  return GRUPOS.map((g) => {
    const contas = CONTAS.filter((c) => c.grupo === g.id && filtro(c));
    if (!contas.length) return "";
    return `<optgroup label="${esc(g.nome)}">${contas.map((c) => `<option value="${c.id}" ${c.id === selecionada ? "selected" : ""}>${esc(c.nome)}</option>`).join("")}</optgroup>`;
  }).join("");
}

const ehEntrada = (c) => naturezaDaConta(c.id) === "entrada";
const ehReceitaVenda = (c) => ["venda_produtos", "frete_cobrado", "servicos"].includes(c.id);

// ---------- Sub-abas ----------

function mostrarSub(grupo, sub) {
  estado.sub[grupo] = sub;
  document.querySelectorAll(`.subtabs[data-grupo="${grupo}"] .subtab`).forEach((b) => b.classList.toggle("ativo", b.dataset.sub === sub));
  for (const [s, id] of Object.entries(TELAS[grupo])) $(id).hidden = s !== sub;
  renderSub();
}

const mesRelatorio = () => $("rel-mes").value || (C()?.hoje() || "").slice(0, 7);

function renderSub() {
  const grupo = estado.aba;
  const sub = estado.sub[grupo];
  if (grupo === "caixa") {
    avisoMigracao();
    if (sub === "lancar") renderFormulario();
    if (sub === "lista") renderLista();
    if (sub === "saldos") window.CaixaUI?.saldos($("fin-saldos"));
    if (sub === "cheques") window.CaixaUI?.cheques($("fin-cheques"));
    if (sub === "receber") window.ReceberUI?.render($("fin-receber"));
  }
  if (grupo === "relatorios") {
    if (!$("rel-mes").value) $("rel-mes").value = mesRelatorio();
    $("rel-visao-grupo").hidden = sub !== "dre";
    renderEquilibrio();
    if (sub === "resumo") renderResumo();
    if (sub === "dre") renderDRE();
    const mesBR = mesRelatorio().split("-").reverse().join("/");
    if (sub === "fluxo") { $("rel-titulo-impressao").textContent = `Fluxo de caixa · ${mesBR}`; window.CaixaUI?.fluxo($("rel-fluxo"), mesRelatorio()); }
    if (sub === "formas") renderFormas();
    if (sub === "receber") { $("rel-titulo-impressao").textContent = `A receber (fiado) · ${(C()?.hoje() || "").split("-").reverse().join("/")}`; window.ReceberUI?.relatorio($("rel-receber")); }
    if (sub === "orcamentos") { $("rel-titulo-impressao").textContent = `Orçamentos · ${mesBR}`; window.Orcamentos?.relatorio($("rel-orcamentos-conteudo"), mesRelatorio()); }
  }
  if (grupo === "ajustes") {
    if (sub === "precos") window.Precos?.abrir();
    if (sub === "financeiro" || sub === "orcamentos") renderConfig();
    if (sub === "impressao") {
      const i = mesclarConfigFinanceiro(C()?.configFinanceiro).impressao;
      for (const k of ["nome", "telefone", "endereco", "cnpj"]) $(`imp-cfg-${k}`).value = i[k] || "";
    }
    if (sub === "saldos") window.CaixaUI?.abertura($("aj-abertura"));
  }
}

function avisoMigracao() {
  const el = $("fin-aviso-v2");
  if (!C() || C().somenteLeitura) { el.hidden = true; return; }
  if (C().migradoV2) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = `<strong>Migrar para o financeiro novo (uma vez só).</strong>
    Converte os lançamentos antigos para o plano de contas (PIX antigo → PIX Bradesco, "bradesco" → Transferência, custos e despesas "a classificar")
    e transforma o acumulado de agosto em lançamentos de abertura. Nada é apagado e uma cópia é guardada antes.
    <div class="aviso-acoes">
      <button class="btn-icon" id="fin-v2-backup">1. 💾 Baixar backup</button>
      <button class="btn-success" id="fin-v2-migrar" ${estado.backupV2 ? "" : "disabled"}>2. Migrar</button>
    </div>`;
  $("fin-v2-backup").onclick = async () => { if (await C().baixarBackup()) { estado.backupV2 = true; avisoMigracao(); } };
  $("fin-v2-migrar").onclick = async () => {
    try {
      const r = await window.api("/api/migrar?versao=2", { method: "POST", timeoutMs: 90000 });
      alert(r.jaMigrado ? "A migração já tinha sido feita." : `Migração concluída.\n\nLançamentos convertidos: ${r.convertidos}\nLançamentos de abertura (agosto): ${r.abertura}\n\nConfira com "🔍 Conferir com arquivo" em Ajustes › Dados e classifique os custos em Lançamentos › A classificar.`);
    } catch (e) {
      alert(`A migração não foi feita: ${e.message}`);
    }
    await C().recarregar();
  };
}

// ---------- Lançar ----------

function tipoAtual() {
  return document.querySelector('input[name="fin-tipo"]:checked').value;
}

// Sugestão de "Pago com": a última conta usada para o mesmo fornecedor ou, se não houver, para a mesma conta
function sugerirPagoCom(conta, fornecedor) {
  const itens = (C()?.itens || []).filter((l) => l.pagoCom && !l.abertura).sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.id).localeCompare(String(a.id)));
  const f = String(fornecedor || "").trim().toLowerCase();
  if (f) {
    const doFornecedor = itens.find((l) => String(l.fornecedor || "").trim().toLowerCase() === f);
    if (doFornecedor) return doFornecedor.pagoCom;
  }
  return itens.find((l) => l.conta === conta)?.pagoCom || null;
}

function renderFormulario() {
  const tipo = tipoAtual();
  const hoje = C()?.hoje() || new Date().toISOString().slice(0, 10);
  const form = $("fin-form");
  const fornecedores = [...new Set((C()?.itens || []).map((l) => l.fornecedor).filter(Boolean))].sort();
  let html = `<div class="form-row">
      <div class="form-group"><label for="ff-data">Data (competência)</label><input type="date" id="ff-data" value="${hoje}" required></div>`;
  if (tipo === "venda") {
    html += `
      <div class="form-group"><label for="ff-conta">Tipo de receita</label><select id="ff-conta">${opcoesContas(ehReceitaVenda, "venda_produtos")}</select></div>
      <div class="form-group"><label for="ff-valor">Total (R$)</label><input type="number" id="ff-valor" step="0.01" min="0.01" inputmode="decimal" required></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label for="ff-desc">Descrição</label><input type="text" id="ff-desc" maxlength="200" placeholder="Ex: venda balcão"></div>
      <div class="form-group"><label for="ff-cliente">Cliente (obrigatório no fiado)</label><input type="text" id="ff-cliente" maxlength="120" list="clientes-lista" autocomplete="off"></div>
      <div class="form-group"><label for="ff-nfe">Nº da NF-e (opcional)</label><input type="text" id="ff-nfe" maxlength="20" inputmode="numeric"></div>
    </div>
    <fieldset class="ff-itens" id="ff-itens-bloco"><legend>Itens vendidos</legend>
      <div id="ff-itens"></div>
      <p class="aviso aviso-alerta" id="ff-itens-aviso">Sem itens, o custo será estimado. Para o lucro sair certo, adicione os itens ou use a aba Vender.</p>
      <p class="sigilo" id="ff-cmv-calculado" hidden>Custo dos produtos (CMV) calculado pelos itens: <strong></strong></p>
    </fieldset>
    <div class="form-group"><label>Formas de pagamento</label><div id="ff-pagamentos"></div></div>
    <div class="form-group" id="ff-cmv-grupo"><label for="ff-cmv">Custo dos produtos (CMV), se souber</label>
      <input type="number" id="ff-cmv" step="0.01" min="0" inputmode="decimal" placeholder="vazio = estimado pela margem padrão">
      <small class="texto-suave">Sem itens e sem custo, o DRE estima pela margem padrão e marca como "estimado".</small></div>`;
  } else if (tipo === "transferencia") {
    const op = (sel) => Object.entries(CONTAS_FIN).map(([id, n]) => `<option value="${id}" ${id === sel ? "selected" : ""}>${n}</option>`).join("");
    html += `
      <div class="form-group"><label for="ff-de">De</label><select id="ff-de">${op("picpay")}</select></div>
      <div class="form-group"><label for="ff-para">Para</label><select id="ff-para">${op("bradesco")}</select></div>
      <div class="form-group"><label for="ff-valor">Valor (R$)</label><input type="number" id="ff-valor" step="0.01" min="0.01" inputmode="decimal" required></div>
    </div>
    <div class="form-group"><label for="ff-desc">Descrição</label><input type="text" id="ff-desc" maxlength="200" placeholder="Ex: repasse PicPay → Bradesco, depósito de cheque"></div>
    <p class="texto-suave">Transferência não é receita nem despesa: só muda o dinheiro de lugar.</p>`;
  } else {
    const entrada = tipo === "entrada";
    const filtro = entrada ? (c) => ehEntrada(c) && !ehReceitaVenda(c) : (c) => !ehEntrada(c) && c.grupo !== "classificar" && c.id !== "cmv";
    html += `
      <div class="form-group"><label for="ff-conta">Conta</label><select id="ff-conta" required><option value="" disabled selected>Escolha</option>${opcoesContas(filtro)}</select></div>
      <div class="form-group"><label for="ff-valor">Valor (R$)</label><input type="number" id="ff-valor" step="0.01" min="0.01" inputmode="decimal" required></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label for="ff-desc">Descrição</label><input type="text" id="ff-desc" maxlength="200"></div>
      ${entrada ? "" : `<div class="form-group"><label for="ff-fornecedor">Fornecedor / favorecido</label><input type="text" id="ff-fornecedor" maxlength="120" list="ff-fornecedores"><datalist id="ff-fornecedores">${fornecedores.map((f) => `<option value="${esc(f)}">`).join("")}</datalist></div>`}
    </div>
    <div class="form-group">
      <label>${entrada ? "Recebido em" : "Pago com"} <span class="texto-suave" id="ff-sugestao"></span></label>
      <div class="segmentado" id="ff-pagocom">${PAGO_COM.filter((p) => !entrada || p.id !== "cheque_emitido").map((p) => `<label><input type="radio" name="ff-pagocom" value="${p.id}"><span>${p.nome}</span></label>`).join("")}</div>
    </div>
    <div class="form-row">
      <div class="form-group"><label for="ff-datapag">Data do ${entrada ? "recebimento" : "pagamento"}</label><input type="date" id="ff-datapag" value="${hoje}"></div>
      <div class="form-group" id="ff-vinculo-grupo" hidden><label for="ff-vinculo">Vínculo</label><select id="ff-vinculo">${VINCULOS.map((v) => `<option value="${v.id}">${v.nome}</option>`).join("")}</select>
        <small class="texto-suave">FGTS e provisão de 13º/férias só para CLT.</small></div>
      <div class="form-group" id="ff-vida-grupo" hidden><label for="ff-vida">Vida útil (meses), para depreciação</label><input type="number" id="ff-vida" min="1" max="600" step="1" placeholder="Ex: 120"></div>
    </div>
    <div id="ff-cheque" class="fin-cheque" hidden>
      <div class="form-row">
        <div class="form-group"><label for="ff-ch-numero">Nº do cheque</label><input type="text" id="ff-ch-numero" maxlength="40"></div>
        <div class="form-group"><label for="ff-ch-favorecido">Favorecido</label><input type="text" id="ff-ch-favorecido" maxlength="120"></div>
        <div class="form-group"><label for="ff-ch-comp">Data de compensação</label><input type="date" id="ff-ch-comp" value="${hoje}"></div>
        <div class="form-group"><label for="ff-ch-conta">Sai da conta</label><select id="ff-ch-conta"><option value="bradesco">Bradesco</option><option value="picpay">PicPay</option></select></div>
      </div>
      <small class="texto-suave">O cheque sai do saldo da conta na data de compensação, não na emissão.</small>
    </div>`;
  }
  html += `<button type="submit" class="btn-primary" style="margin-top: 1.25rem;">Registrar</button>`;
  form.innerHTML = html;

  if (tipo === "venda") {
    const f = C()?.configFinanceiro?.fiado || {};
    estado.editor = criarEditorPagamentos($("ff-pagamentos"), {
      clienteExterno: true,
      fiado: () => ({ ligado: f.ligado !== false, prazoDias: Number(f.prazoDias) || 30, data: $("ff-data")?.value || hoje }),
      contaCorrente: () => Boolean(window.Clientes?.ehContaCorrente($("ff-cliente")?.value)),
    });
    $("ff-cliente").addEventListener("change", () => estado.editor.atualizar());
    // Com itens: total e CMV saem dos itens (mesmo cálculo do Vender); sem itens: valor digitado e CMV estimado
    estado.itensCaixa = criarItensCaixa($("ff-itens"), (r) => {
      estado.itensVenda = r;
      const tem = r.linhas.length > 0;
      $("ff-itens-aviso").hidden = tem;
      $("ff-cmv-grupo").hidden = tem;
      $("ff-cmv-calculado").hidden = !tem;
      $("ff-cmv-calculado").querySelector("strong").textContent = moeda(r.custo);
      $("ff-valor").readOnly = tem;
      if (tem) {
        $("ff-valor").value = r.venda.toFixed(2);
        estado.editor.definirTotal(r.venda);
      }
    });
    const soProdutos = () => { $("ff-itens-bloco").hidden = $("ff-conta").value !== "venda_produtos"; };
    $("ff-conta").addEventListener("change", soProdutos);
    soProdutos();
    // Corrigir uma venda sem itens: o formulário volta preenchido; ao salvar, mantém o número
    const corr = estado.corrigindo;
    if (corr) {
      const l = corr.origem;
      $("ff-data").value = l.competencia;
      $("ff-conta").value = l.conta;
      $("ff-valor").value = Number(l.value).toFixed(2);
      $("ff-desc").value = l.description || "";
      $("ff-cliente").value = l.cliente || "";
      $("ff-nfe").value = l.nfe || "";
      if (l.cmv != null) $("ff-cmv").value = l.cmv;
      estado.editor.carregar(l.pagamentos, l.value, l.cliente || "");
      form.insertAdjacentHTML("afterbegin", `<div class="aviso" id="ff-corrigindo">Corrigindo a venda <strong>${esc(corr.numero || "")}</strong> (antes ${moeda(corr.valorAntes)}). Ao salvar, o número continua o mesmo. <button type="button" class="link-suave" id="ff-corrigir-cancelar">cancelar correção</button></div>`);
      $("ff-corrigir-cancelar").addEventListener("click", () => { estado.corrigindo = null; renderFormulario(); });
    }
  } else estado.corrigindo = null;
  if (tipo === "venda") $("ff-valor").addEventListener("input", (e) => estado.editor.definirTotal(num(e.target.value) || 0));
  if (tipo === "saida" || tipo === "entrada") {
    const atualizarSugestao = () => {
      const s = sugerirPagoCom($("ff-conta").value, $("ff-fornecedor")?.value);
      const marcado = document.querySelector('input[name="ff-pagocom"]:checked');
      $("ff-sugestao").textContent = s ? `(sugestão: ${NOME_PAGO[s]}, a última usada)` : "";
      if (s && (!marcado || marcado.dataset.auto)) {
        const r = document.querySelector(`input[name="ff-pagocom"][value="${s}"]`);
        if (r) { r.checked = true; r.dataset.auto = "1"; }
      }
      mostrarCheque();
    };
    const mostrarCheque = () => {
      const pc = document.querySelector('input[name="ff-pagocom"]:checked')?.value;
      $("ff-cheque") && ($("ff-cheque").hidden = pc !== "cheque_emitido");
      $("ff-vida-grupo").hidden = $("ff-conta").value !== "investimento";
      $("ff-vinculo-grupo").hidden = $("ff-conta").value !== "salarios" || !estimativasLigadas();
      if (pc === "cheque_emitido" && !$("ff-ch-favorecido").value && $("ff-fornecedor")) $("ff-ch-favorecido").value = $("ff-fornecedor").value;
    };
    $("ff-conta").addEventListener("change", atualizarSugestao);
    $("ff-fornecedor")?.addEventListener("change", atualizarSugestao);
    $("ff-pagocom").addEventListener("change", (e) => { delete e.target.dataset.auto; document.querySelectorAll('input[name="ff-pagocom"]').forEach((r) => delete r.dataset.auto); mostrarCheque(); });
  }
}

async function enviarFormulario(e) {
  e.preventDefault();
  if (!C().podeGravar()) return;
  const tipo = tipoAtual();
  const valor = num($("ff-valor").value);
  const data = $("ff-data").value;
  if (!(valor > 0)) return alert("Informe o valor.");
  const corrigindo = tipo === "venda" ? estado.corrigindo : null;
  const item = { id: corrigindo ? corrigindo.id : C().novoId(tipo === "venda" ? "V" : tipo === "transferencia" ? "T" : "S"), v: 2, value: valor, competencia: data, description: $("ff-desc").value.trim() };
  if (tipo === "venda") {
    try { item.pagamentos = estado.editor.ler(); } catch (err) { return alert(err.message); }
    item.conta = $("ff-conta").value;
    item.nfe = $("ff-nfe").value.trim();
    item.cliente = $("ff-cliente").value.trim();
    // Fiado: cliente obrigatório e cadastrado (vira conta a receber)
    if (item.pagamentos.some((p) => p.forma === "fiado")) {
      const cli = await window.Clientes.garantir(item.cliente);
      if (!cli) return;
      item.cliente = cli.nome;
      item.clienteId = cli.id;
    }
    const iv = item.conta === "venda_produtos" ? estado.itensVenda : null;
    if (iv?.linhas.length) {
      if (iv.semPreco) return alert("Há item sem preço. Digite o preço unitário na linha do item.");
      item.itens = iv.itens;
      item.cmv = iv.custo;
      if (iv.tabela) item.tabelaTotal = iv.tabela;
      if (!item.description) item.description = `Venda: ${iv.itens.map((i) => i.descricao).join(", ")}`.slice(0, 200);
    } else {
      const cmv = num($("ff-cmv").value);
      if (cmv != null) item.cmv = cmv;
    }
  } else if (tipo === "transferencia") {
    Object.assign(item, { conta: "transferencia", de: $("ff-de").value, para: $("ff-para").value });
  } else {
    item.conta = $("ff-conta").value;
    if (!item.conta) return alert("Escolha a conta.");
    const pc = document.querySelector('input[name="ff-pagocom"]:checked')?.value;
    if (!pc) return alert(tipo === "entrada" ? 'Escolha onde foi recebido.' : 'Escolha "Pago com".');
    item.pagoCom = pc;
    item.dataPagamento = $("ff-datapag").value || data;
    if ($("ff-fornecedor")) item.fornecedor = $("ff-fornecedor").value.trim();
    if (pc === "cheque_emitido") {
      item.chequeEmitido = { numero: $("ff-ch-numero").value.trim(), favorecido: $("ff-ch-favorecido").value.trim(), compensacao: $("ff-ch-comp").value, conta: $("ff-ch-conta").value };
    }
    if (item.conta === "investimento" && num($("ff-vida").value)) item.vidaUtilMeses = num($("ff-vida").value);
    if (item.conta === "salarios") item.vinculo = $("ff-vinculo").value;
  }
  if (await C().gravar([item])) {
    estado.corrigindo = null;
    renderFormulario();
    // Venda de produtos: a janela das vias ("Venda V-0003 registrada"); o resto, um aviso simples
    const salvo = vendaPorId(item.id);
    if (salvo?.numero) {
      window.Impressao.abrir({ venda: salvo, titulo: `Venda ${salvo.numero} ${corrigindo ? "corrigida" : "registrada"}`,
        mensagem: `<div>Total: <strong>${moeda(salvo.value)}</strong>${corrigindo ? ` · antes da correção: ${moeda(corrigindo.valorAntes)}` : ""}</div>` });
    } else alert("Lançamento registrado.");
  }
}

// ---------- Lançamentos (lista e reclassificação em lote) ----------

// Transferências e recebimentos de fiado não são receita nem despesa: ficam fora do "saldo do filtro"
const foraDoSaldo = (l) => ["transferencia", "recebimento", "fiado_anterior", "cheque_anterior"].includes(l.conta);
const NOMES_ESPECIAIS = { transferencia: "Transferência", recebimento: "Recebimento de fiado", fiado_anterior: "Fiado anterior (abertura)", cheque_anterior: "Cheque em carteira (abertura)" };

function descreverForma(l) {
  if (l.conta === "transferencia") return `${CONTAS_FIN[l.de] || l.de} → ${CONTAS_FIN[l.para] || l.para}`;
  if (Array.isArray(l.pagamentos)) {
    return l.pagamentos.map((p) => `${FORMAS[p.forma]?.nome || p.forma}${p.parcelas ? ` ${p.parcelas}x` : ""}${p.forma === "fiado" ? (p.fiado?.contaCorrente ? " (conta corrente)" : p.fiado?.vencimento ? ` (vence ${dataBR(p.fiado.vencimento)})` : "") : ""}`).join(" + ");
  }
  if (l.conta === "fiado_anterior") return l.contaCorrente || !l.vencimento ? "a receber, conta corrente" : `a receber, vence ${dataBR(l.vencimento)}`;
  if (l.pagoCom) return NOME_PAGO[l.pagoCom] + (l.chequeEmitido?.numero ? ` nº ${l.chequeEmitido.numero}` : "");
  return l.abertura ? "abertura" : "—";
}

function filtrarLista() {
  const cfg = C().configFinanceiro;
  const lista = normalizar(C().itens, cfg);
  const mes = $("fin-f-mes").value;
  const tipo = $("fin-f-tipo").value;
  const conta = $("fin-f-conta").value;
  const busca = $("fin-f-busca").value.trim().toLowerCase();
  return lista.filter((l) => {
    if (mes && mesDe(l) !== mes) return false;
    if (conta && l.conta !== conta) return false;
    if (tipo === "classificar" && !l.classificar) return false;
    if (tipo === "sugestao" && !sugestaoDe(l)) return false;
    if (tipo === "entradas" && naturezaDaConta(l.conta) !== "entrada") return false;
    if (tipo === "saidas" && (l.conta === "transferencia" || naturezaDaConta(l.conta) !== "saida")) return false;
    if (tipo === "migrados" && !l.migrado) return false;
    if (tipo === "fiado" && !(l.conta === "recebimento" || l.conta === "fiado_anterior" || (l.pagamentos || []).some((p) => p.forma === "fiado"))) return false;
    if (busca && ![l.description, l.fornecedor, l.nfe, l.cliente, l.numero].some((t) => String(t || "").toLowerCase().includes(busca)) && !numeroConfere(l.numero, busca)) return false;
    return true;
  }).sort((a, b) => String(b.competencia).localeCompare(String(a.competencia)) || String(b.id).localeCompare(String(a.id)));
}

// Busca pelo número da venda: "V-0012", "v12" ou só "12"
const numeroConfere = (numero, busca) => {
  if (!numero || !/^\s*v?-?\s*\d+\s*$/i.test(busca)) return false;
  return Number(busca.replace(/\D/g, "")) === Number(String(numero).replace(/\D/g, ""));
};
const dataHoraBR = (iso) => (iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }).replace(",", "") : "");

// Vendas: imprimir as vias e corrigir (com itens, volta para o Vender; sem itens, para o Caixa › Lançar)
function vendaPorId(id) { return C()?.itens.find((l) => String(l.id) === String(id)); }
function viasDaVenda(id) {
  const l = vendaPorId(id);
  if (l) window.Impressao.abrir({ venda: l });
}
async function corrigirVenda(id) {
  const l = vendaPorId(id);
  if (!l) return;
  if (C().somenteLeitura) return alert("Sem conexão com a nuvem. Nada pode ser corrigido.");
  if (Array.isArray(l.itens) && l.itens.length) {
    window.switchTab("vender");
    if (await window.Calculadora.carregarVenda(l)) $("btn-registrar-venda")?.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  estado.corrigindo = { id: l.id, numero: l.numero, valorAntes: l.value, origem: l };
  window.switchTab("caixa");
  mostrarSub("caixa", "lancar");
  const r = document.querySelector('input[name="fin-tipo"][value="venda"]');
  if (r) r.checked = true;
  renderFormulario();
}
window.Vendas = { vias: viasDaVenda, corrigir: corrigirVenda };

function renderLista() {
  if (!$("fin-f-conta").options.length) {
    $("fin-f-conta").innerHTML = `<option value="">Todas</option>${opcoesContas(() => true)}<option value="transferencia">Transferência</option><option value="recebimento">Recebimento de fiado</option>`;
    $("fin-lote-conta").innerHTML = `<option value="" disabled selected>Nova conta…</option>${opcoesContas((c) => c.id !== "classificar_custo")}`;
    $("fin-lote-vinculo").hidden = $("fin-lote-vinculo-aplicar").hidden = !estimativasLigadas();
    $("fin-lote-vinculo").innerHTML = `<option value="" disabled selected>Vínculo (salários)…</option>${VINCULOS.map((v) => `<option value="${v.id}">${v.nome}</option>`).join("")}`;
    $("fin-lote-forma").innerHTML = `<option value="" disabled selected>Nova forma (vendas)…</option>${FORMAS_PADRAO.filter((f) => !f.soMigracao && !f.fiado).map((f) => `<option value="${f.id}">${esc(f.nome)}</option>`).join("")}`;
  }
  if (!C()) return;
  const lista = filtrarLista();
  estado.visivel = lista;
  const LIMITE = 400;
  $("fin-lista-body").innerHTML = lista.slice(0, LIMITE).map((l) => {
    const c = contaPorId[l.conta];
    const entrada = naturezaDaConta(l.conta) === "entrada";
    const s = sugestaoDe(l);
    const sug = s ? `<small class="sugestao">sugestão: ${esc(contaPorId[s.conta]?.nome || s.conta)} (${esc(s.motivo)})</small>` : "";
    const tags = [l.classificar ? '<span class="tag tag-menos">a classificar</span>' : "", l.abertura ? '<span class="tag">abertura</span>' : "", l.migrado && !l.abertura ? '<span class="tag">migrado</span>' : ""].join(" ");
    return `<tr class="${estado.selecionados.has(String(l.id)) ? "selecionado" : ""}">
      <td><input type="checkbox" class="fin-sel" value="${esc(l.id)}" ${estado.selecionados.has(String(l.id)) ? "checked" : ""} aria-label="Selecionar"></td>
      <td>${dataBR(l.competencia)}</td>
      <td>${l.numero ? `<strong>${esc(l.numero)}</strong>` : ""}${l.historico?.length ? `<small title="${esc(l.historico.map((h) => `corrigida em ${dataHoraBR(h.em)}, antes ${moeda(h.valorAntes)}`).join("\n"))}">corrigida</small>` : ""}</td>
      <td>${esc(l.description || "")}${l.cliente ? `<small>cliente: ${esc(l.cliente)}</small>` : ""}${l.fornecedor ? `<small>${esc(l.fornecedor)}</small>` : ""}${l.nfe ? `<small>NF-e ${esc(l.nfe)}</small>` : ""}${l.frete ? `<small>inclui frete ${moeda(l.frete)}</small>` : ""}</td>
      <td>${esc(c?.nome || NOMES_ESPECIAIS[l.conta] || l.conta)}${l.conta === "salarios" && estimativasLigadas() ? ` <small class="texto-suave">(${esc(VINCULOS.find((v) => v.id === (l.vinculo || "clt"))?.nome || "CLT")})</small>` : ""} ${tags}${sug}</td>
      <td>${esc(descreverForma(l))}</td>
      <td class="num ${foraDoSaldo(l) ? "" : entrada ? "type-income" : "type-expense"}">${moeda(l.value)}</td>
      <td class="lanc-acoes">${l.conta === "venda_produtos" ? `<button class="btn-icon mini" data-vias="${esc(l.id)}" title="Imprimir as vias desta venda">🖨 Vias</button><button class="btn-icon mini" data-corrigir="${esc(l.id)}" title="Abrir a venda de volta para corrigir (mantém o número)">Corrigir</button>` : ""}
        <button class="delete-btn" data-excluir="${esc(l.id)}" title="${l.conta === "venda_produtos" ? "Estornar: desfaz a venda inteira (o número fica marcado como estornado)" : "Excluir (estornar) este lançamento"}">${l.conta === "venda_produtos" ? "Estornar" : "Excluir"}</button></td>
    </tr>`;
  }).join("") || '<tr><td colspan="8" class="texto-suave">Nenhum lançamento com esse filtro.</td></tr>';
  const total = lista.reduce((s, l) => s + (foraDoSaldo(l) ? 0 : (naturezaDaConta(l.conta) === "entrada" ? 1 : -1) * Math.round(l.value * 100)), 0) / 100;
  $("fin-lista-contagem").textContent = `${lista.length} lançamentos${lista.length > LIMITE ? ` (mostrando ${LIMITE})` : ""} · saldo do filtro ${moeda(total)}`;
  $("fin-sel-todos").checked = lista.length > 0 && lista.every((l) => estado.selecionados.has(String(l.id)));
  atualizarLote();
}

function atualizarLote() {
  const n = estado.selecionados.size;
  $("fin-lote").hidden = n === 0 || !C()?.migradoV2;
  $("fin-lote-n").textContent = `${n} selecionado${n > 1 ? "s" : ""}`;
}

async function aplicarLote(corpo) {
  const ids = [...estado.selecionados];
  try {
    const r = await window.api("/api/lancamento", { method: "PATCH", body: { ids, ...corpo } });
    const ign = r.ignorados.length ? `\n\nNão alterados: ${r.ignorados.length}\n` + [...new Set(r.ignorados.map((i) => i.motivo))].map((m) => `• ${m}`).join("\n") : "";
    alert(`Alterados: ${r.alterados}${ign}`);
  } catch (e) {
    alert(`Não foi alterado: ${e.message}`);
    return;
  }
  estado.selecionados.clear();
  await C().recarregar();
}

// ---------- DRE ----------

function mesAnterior(mes, n = 1) {
  const [a, m] = mes.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1 - n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const variacao = (atual, antes) => (antes ? (atual - antes) / Math.abs(antes) : null);

function renderDRE() {
  if (!C()) return;
  const cfg = C().configFinanceiro;
  const mes = mesRelatorio();
  const visao = document.querySelector('input[name="rel-visao"]:checked').value;
  const lista = normalizar(C().itens, cfg);
  const alvo = $("fin-dre-conteudo");

  if (visao === "ano") {
    const ano = Number(mes.slice(0, 4));
    const a = montarDREAnual(C().itens, cfg, ano);
    $("rel-titulo-impressao").textContent = `DRE gerencial ${ano}`;
    const nomes = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
    alvo.innerHTML = `<div class="table-container"><table class="tabela-dre anual">
      <thead><tr><th>${ano}</th>${nomes.map((n) => `<th class="num">${n}</th>`).join("")}<th class="num">Total</th><th class="num">%</th></tr></thead>
      <tbody>${a.ids.map((id) => {
        const m = a.modelo[id];
        return `<tr class="dre-${m.tipo}${m.destaque ? " dre-destaque" : ""}">
          <td>${esc(m.rotulo)}${m.estimado ? ' <span class="tag">est.</span>' : ""}</td>
          ${a.meses.map((d) => `<td class="num">${fmtCurto(d.valores[id])}</td>`).join("")}
          <td class="num"><strong>${fmtCurto(a.total[id])}</strong></td>
          <td class="num">${a.total.receitaBruta ? pct(a.total[id] / a.total.receitaBruta) : "—"}</td></tr>`;
      }).join("")}</tbody></table></div>
      <p class="dre-modo" id="dre-modo">${estimativasLigadas() ? "Estimativas contábeis ligadas (DAS estimado, FGTS estimado e provisão de 13º/férias)" : "Estimativas contábeis desligadas: só os lançamentos reais (guias, salários, despesas)"} · Ajustes › Financeiro</p>`;
    return;
  }

  // Mês em andamento: compara com o mesmo pedaço (até o mesmo dia) do mês anterior e do ano passado,
  // para não parecer queda frente a um mês completo
  const hojeStr = C().hoje();
  const emAndamento = mes === hojeStr.slice(0, 7);
  const ateDia = emAndamento ? Number(hojeStr.slice(8, 10)) : null;
  const ddmm = (m) => `${String(ateDia).padStart(2, "0")}/${m.slice(5, 7)}`;
  const d = montarDRE(lista, cfg, mes, { jaNormalizado: true });
  const ant = montarDRE(lista, cfg, mesAnterior(mes), { jaNormalizado: true, ateDia });
  const anoAnt = montarDRE(lista, cfg, mesAnterior(mes, 12), { jaNormalizado: true, ateDia });
  const rb = d.valores.receitaBruta;
  $("rel-titulo-impressao").textContent = `DRE gerencial · ${mes.split("-").reverse().join("/")}${emAndamento ? ` (mês em andamento, até ${ddmm(mes)})` : ""}`;
  const linha = (l) => {
    const va = ant.valores[l.id] ?? 0, vb = anoAnt.valores[l.id] ?? 0;
    const dv = variacao(l.valor, va), dy = variacao(l.valor, vb);
    const seta = (x) => (x == null ? "—" : `${x > 0 ? "▲" : x < 0 ? "▼" : ""} ${pct(Math.abs(x))}`);
    return `<tr class="dre-${l.tipo}${l.destaque ? " dre-destaque" : ""}${l.alerta ? " dre-alerta" : ""}">
      <td>${esc(l.rotulo)}${l.estimado ? ' <span class="tag">estimado</span>' : ""}</td>
      <td class="num">${moeda(l.valor)}</td>
      <td class="num">${rb ? pct(l.valor / rb) : "—"}</td>
      <td class="num so-tela-dre">${moeda(va)}</td><td class="num so-tela-dre">${seta(dv)}</td>
      <td class="num so-tela-dre">${moeda(vb)}</td><td class="num so-tela-dre">${seta(dy)}</td>
    </tr>`;
  };
  const estoque = estoqueEstimado(lista, cfg, mes);
  // Recebimentos que pagaram fiado da pasta (antes da virada): entram no caixa, mas não são venda deste mês
  const doAnterior = recebidoDeFiadoAnterior(C().itens, cfg, mes, C().hoje(), window.Clientes?.lista || []);
  alvo.innerHTML = `
    ${emAndamento ? `<div class="aviso dre-andamento"><strong>Mês em andamento (até ${ddmm(mes)})</strong>: as comparações usam o mesmo período (1 a ${ddmm(mesAnterior(mes))} no mês anterior). Salários e contas do fim do mês ainda podem entrar.</div>` : ""}
    ${d.provisorio.length ? `<div class="aviso aviso-alerta dre-provisorio"><strong>Resultado provisório: ${d.provisorio.length} pendência${d.provisorio.length > 1 ? "s" : ""}</strong>
      <ul>${d.provisorio.map((p) => `<li>${esc(p.texto)}</li>`).join("")}</ul></div>` : ""}
    ${d.avisos.length ? `<ul class="pendencias">${d.avisos.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>` : ""}
    <div class="table-container"><table class="tabela-dre">
      <thead><tr><th></th><th class="num">${mes.split("-").reverse().join("/")}${emAndamento ? ` <small>(até ${ddmm(mes)})</small>` : ""}</th><th class="num">% receita</th>
        <th class="num so-tela-dre">Mês anterior${emAndamento ? ` <small>(até ${ddmm(mesAnterior(mes))})</small>` : ""}</th><th class="num so-tela-dre">Δ</th>
        <th class="num so-tela-dre">Mesmo mês ${Number(mes.slice(0, 4)) - 1}${emAndamento ? ` <small>(até ${ddmm(mesAnterior(mes, 12))})</small>` : ""}</th><th class="num so-tela-dre">Δ</th></tr></thead>
      <tbody>${d.linhas.map(linha).join("")}</tbody>
      ${doAnterior ? `<tfoot><tr class="dre-info-linha"><td><em>(i) Recebido de fiado anterior à virada</em><small class="texto-suave"> entrou no caixa; não é venda deste mês e não soma no lucro</small></td>
        <td class="num">${moeda(doAnterior)}</td><td colspan="5"></td></tr></tfoot>` : ""}
    </table></div>
    <p class="dre-modo" id="dre-modo">${d.estimativasContabeis ? "Estimativas contábeis ligadas (DAS estimado, FGTS estimado e provisão de 13º/férias)" : "Estimativas contábeis desligadas: só os lançamentos reais (guias, salários, despesas)"} · Ajustes › Financeiro</p>
    ${cmvOrigemHtml(d.info.cmvOrigem)}
    <div class="dre-info">
      <div><span>Retiradas do dono (abaixo da linha)</span><strong>${moeda(d.info.retiradas)}</strong></div>
      <div><span>Lucro retido</span><strong>${moeda(d.info.lucroRetido)}</strong></div>
      ${d.info.freteCobrado ? `<div><span>Frete cobrado dos clientes (já na receita)</span><strong>${moeda(d.info.freteCobrado)}</strong></div>` : ""}
      <div><span>Compras do mês (viram estoque)</span><strong>${moeda(d.info.compras)}</strong></div>
      <div><span>Estoque estimado em R$ (compras − CMV)</span><strong>${moeda(estoque)}</strong></div>
      <div><span>Ponto de equilíbrio</span><strong>${moeda(d.info.pontoEquilibrio)}</strong></div>
      ${doAnterior ? `<div><span>Recebido de fiado anterior à virada (entrou no caixa; não é venda deste mês)</span><strong>${moeda(doAnterior)}</strong></div>` : ""}
      ${d.info.aportes ? `<div><span>Aportes do dono</span><strong>${moeda(d.info.aportes)}</strong></div>` : ""}
    </div>`;
}

// De onde vem o custo das vendas do mês: o quanto o lucro é confiável
function cmvOrigemHtml(o) {
  if (!o?.total) return "";
  const p = (x) => `${(x.pct * 100).toFixed(0)}%`;
  const partes = [
    ["dre-cmv-itens", "calculado pelos itens", o.itens],
    ["dre-cmv-estimado", "estimado (vendas sem itens)", o.estimado],
    ["", "informado à mão", o.informado],
    ["", "custos antigos classificados como CMV", o.classificado],
    ["", "custos a classificar", o.aClassificar],
  ].filter(([id, , x]) => x.valor || id);
  return `<div class="dre-cmv-origem" id="dre-cmv-origem"><span>Custo das vendas (CMV) do mês: <strong>${moeda(o.total)}</strong></span>
    ${partes.map(([id, rot, x]) => `<span${id ? ` id="${id}"` : ""}>${rot}: <strong>${moeda(x.valor)}</strong> (${p(x)})</span>`).join("")}</div>`;
}

const fmtCurto = (v) => (v ? v.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }) : "–");

// ---------- Resumo do mês e formas de pagamento ----------

function ultimoDia(mes) {
  const [a, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
}

// Dia de referência do resumo: hoje, se for o mês escolhido; senão o último dia do mês
function diaDoMes(mes) {
  const h = C()?.hoje() || "";
  return h.startsWith(mes) ? h : ultimoDia(mes);
}

// Relatórios: "Quanto preciso vender por mês para empatar" (média dos últimos 3 meses completos)
function renderEquilibrio() {
  const el = $("rel-equilibrio");
  if (!el || !C()) return;
  const hoje = C().hoje();
  const mes = hoje.slice(0, 7);
  const pe = pontoEquilibrioMedio(C().itens, C().configFinanceiro, mes, 3);
  if (!pe) { el.innerHTML = ""; return; }
  const nomes = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  const meses = pe.meses.map((m) => `${nomes[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`).join(", ");
  const doMes = montarDRE(C().itens, C().configFinanceiro, mes).valores.receitaBruta;
  const pct = (pe.margemContribuicaoPct * 100).toFixed(1).replace(".", ",");
  el.innerHTML = pe.pontoEquilibrio == null
    ? `<div class="equilibrio aviso aviso-alerta"><span>Quanto preciso vender por mês para empatar</span>
        <strong>Sem ponto de equilíbrio</strong><small>A margem de contribuição de ${meses} ficou negativa (${pct}%): vender mais não cobre os custos. Verifique o CMV e os preços.</small></div>`
    : `<div class="equilibrio">
        <span>Quanto preciso vender por mês para empatar</span>
        <strong id="rel-equilibrio-valor">${moeda(pe.pontoEquilibrio)}</strong>
        <small>Custos fixos médios ${moeda(pe.custosFixosMedia)} ÷ margem de contribuição de ${pct}% · média de ${meses}</small>
        <small>Vendas médias nesses meses: ${moeda(pe.vendasMedia)} (${pe.vendasMedia >= pe.pontoEquilibrio ? `${moeda(pe.vendasMedia - pe.pontoEquilibrio)} acima` : `${moeda(pe.pontoEquilibrio - pe.vendasMedia)} abaixo`} do empate)
          · este mês até ${hoje.slice(8, 10)}/${hoje.slice(5, 7)}: ${moeda(doMes)}${doMes < pe.pontoEquilibrio ? ` (faltam ${moeda(pe.pontoEquilibrio - doMes)})` : " (já empatou)"}</small>
      </div>`;
}

function renderResumo() {
  if (!C()) return;
  const mes = mesRelatorio();
  if (!$("rel-dia").value.startsWith(mes)) $("rel-dia").value = diaDoMes(mes);
  const dia = $("rel-dia").value;
  const r = resumoDoMes(C().itens, C().acumulado, dia);
  const linhas = [
    ["vendas", "Vendas no geral (bruto)", "font-bold"],
    ["pix", "↳ em PIX / transferência", "sub-row"],
    ["cred", "↳ em Crédito", "sub-row"],
    ["deb", "↳ em Débito", "sub-row"],
    ["custos", "Custo de material", "text-danger"],
    ["despesas", "Despesas gerais", "text-danger"],
    ["funcionarios", "Funcionários", "text-danger"],
  ];
  const t = r.total.resultado;
  const rotuloRes = t > 0 ? "LUCRO BRUTO DO MÊS" : t < 0 ? "PREJUÍZO BRUTO DO MÊS" : "RESULTADO BRUTO DO MÊS";
  $("rel-titulo-impressao").textContent = `Resumo do mês · ${dataBR(dia)}`;
  $("rel-resumo-conteudo").innerHTML = `<table class="summary-table">
    <thead><tr><th>Indicador</th><th class="num">Lançado no dia (${dataBR(dia)})</th><th class="num">Acumulado (mês + passado)</th><th class="num">Total do mês</th></tr></thead>
    <tbody>${linhas.map(([k, rot, cls]) => `<tr class="${cls}"><td>${rot}</td><td class="num">${moeda(r.doDia[k])}</td><td class="num">${moeda(r.acumulado[k])}</td><td class="num" id="rel-tot-${k}">${moeda(r.total[k])}</td></tr>`).join("")}
      <tr class="result-row"><td>${rotuloRes}<small class="texto-suave">vendas − custo de material − despesas gerais (como na tela antiga)</small></td>
        <td class="num">${moeda(r.doDia.resultado)}</td><td class="num">${moeda(r.acumulado.resultado)}</td>
        <td class="num ${t > 0 ? "text-success" : t < 0 ? "text-danger" : ""} font-bold">${moeda(t)}</td></tr>
    </tbody></table>`;
}

function renderFormas() {
  if (!C()) return;
  const mes = mesRelatorio();
  const cfg = mesclarConfigFinanceiro(C().configFinanceiro);
  const r = vendasPorForma(normalizar(C().itens, cfg), mes, cfg);
  $("rel-titulo-impressao").textContent = `Vendas por forma de pagamento · ${mes.split("-").reverse().join("/")}`;
  $("rel-formas-conteudo").innerHTML = `
    <div class="table-container"><table class="tabela-fin">
      <thead><tr><th>Forma</th><th>tPag</th><th class="num">Vendas</th><th class="num">Valor</th><th class="num">%</th></tr></thead>
      <tbody>${r.linhas.map((l) => `<tr><td>${esc(l.nome)}</td><td>${esc(l.tPag)}</td><td class="num">${l.quantidade}</td><td class="num"><strong>${moeda(l.valor)}</strong></td><td class="num">${pct(l.pct)}</td></tr>`).join("")
        || '<tr><td colspan="5" class="texto-suave">Nenhuma venda no mês.</td></tr>'}</tbody>
      <tfoot><tr class="dre-total"><td colspan="2">Total</td><td class="num">${r.vendas}</td><td class="num"><strong>${moeda(r.total)}</strong></td><td></td></tr></tfoot>
    </table></div>
    <p class="texto-suave">Pela data da venda (competência). Uma venda paga com duas formas aparece nas duas. O arquivo CSV e o detalhamento chegam na Fase 2D.</p>`;
}

// ---------- Configuração ----------

function renderConfig() {
  if (!C()) return;
  const c = mesclarConfigFinanceiro(C().configFinanceiro);
  const op = (sel) => Object.entries(CONTAS_FIN).map(([id, n]) => `<option value="${id}" ${id === sel ? "selected" : ""}>${n}</option>`).join("");
  $("fin-config-form").innerHTML = `
    <h3 class="cfg-titulo">Formas de pagamento</h3>
    <div class="table-container"><table class="tabela-cfg">
      <thead><tr><th>Forma</th><th>Conta de destino</th><th>Código tPag (NF-e)</th></tr></thead>
      <tbody>${FORMAS_PADRAO.filter((f) => !f.soMigracao).map((f) => `<tr>
        <td>${esc(f.nome)}</td>
        <td>${f.fiado ? '<span class="texto-suave">Contas a receber (Caixa › A receber)</span>' : `<select data-forma-conta="${f.id}">${op(c.formas[f.id].conta)}</select>`}</td>
        <td><input type="text" data-forma-tpag="${f.id}" value="${esc(c.formas[f.id].tPag)}" maxlength="2" inputmode="numeric" class="campo-curto"></td>
      </tr>`).join("")}</tbody></table></div>
    <small class="texto-suave">Códigos a confirmar com o escritório. PIX Bradesco (chave pelo WhatsApp) = 20 estático; PIX PicPay (QR na maquininha) = 17 dinâmico.</small>

    <h3 class="cfg-titulo">Cartão (PicPay)</h3>
    <div class="form-row">
      <div class="form-group"><label>Débito: taxa %</label><input type="number" step="0.01" min="0" max="100" id="cfg-deb-taxa" value="${c.cartao.debito.taxaPct}"></div>
      <div class="form-group"><label>Débito: prazo (dias)</label><input type="number" step="1" min="0" id="cfg-deb-prazo" value="${c.cartao.debito.prazoDias}"></div>
      <div class="form-group"><label>Crédito à vista: taxa %</label><input type="number" step="0.01" min="0" max="100" id="cfg-cred-taxa" value="${c.cartao.credito.taxaPct}"></div>
      <div class="form-group"><label>Crédito à vista: prazo (dias)</label><input type="number" step="1" min="0" id="cfg-cred-prazo" value="${c.cartao.credito.prazoDias}"></div>
    </div>
    <label>Crédito parcelado: taxa % por número de parcelas (cada parcela cai a cada <input type="number" id="cfg-parc-prazo" class="campo-curto" min="1" step="1" value="${c.cartao.parcelado.prazoDias}"> dias)</label>
    <div class="parcelas-grid">${Object.entries(c.cartao.parcelado.taxaPctPorParcelas).map(([n, t]) => `<label>${n}x <input type="number" step="0.01" min="0" max="100" data-parcela="${n}" value="${t}"></label>`).join("")}</div>

    <h3 class="cfg-titulo">CMV, pessoal e impostos</h3>
    <div class="form-row">
      <div class="form-group"><label>Margem padrão para estimar o CMV (%)</label><input type="number" step="0.5" min="0" max="100" id="cfg-margem" value="${c.cmv.margemPadraoPct}">
        <small class="texto-suave">Usada nas vendas sem itens até haver ${c.cmv.mesesMedia} meses de vendas pela calculadora; depois vale a média real.</small></div>
    </div>
    <div class="form-group"><label class="check"><input type="checkbox" id="cfg-estimativas" ${c.estimativasContabeis ? "checked" : ""}> <strong>Estimativas contábeis</strong> (DAS estimado pelo RBT12, FGTS estimado e provisão de 13º/férias)</label>
      <small class="texto-suave">Desligado: o DRE usa só o que foi lançado de verdade (guias de DAS e FGTS pagas, salários). Ligar de novo traz as configurações abaixo como estavam.</small></div>
    <div id="cfg-estimativas-campos">
    <div class="form-row">
      <div class="form-group"><label>FGTS (%)</label><input type="number" step="0.01" min="0" max="100" id="cfg-fgts" value="${c.pessoal.fgtsPct}">
        <label class="check"><input type="checkbox" id="cfg-fgts-estimar" ${c.pessoal.estimarFgts ? "checked" : ""}> Estimar FGTS até a guia ser lançada</label></div>
      <div class="form-group"><label>Provisão de 13º e férias (%)</label><input type="number" step="0.01" min="0" max="100" id="cfg-provisao" value="${c.pessoal.provisaoPct}">
        <label class="check"><input type="checkbox" id="cfg-provisao-ligada" ${c.pessoal.provisao13FeriasLigada ? "checked" : ""}> Ligada</label></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Regime</label><select id="cfg-regime">
        ${[["simples_nacional", "Simples Nacional"], ["lucro_presumido", "Lucro presumido"], ["outro", "Outro"]].map(([v, n]) => `<option value="${v}" ${v === c.impostos.regime ? "selected" : ""}>${n}</option>`).join("")}</select></div>
      <div class="form-group"><label for="cfg-rbt12">RBT12 (receita bruta dos últimos 12 meses)</label><input type="number" step="0.01" min="0" id="cfg-rbt12" value="${c.impostos.rbt12 ?? ""}" placeholder="pergunte ao escritório">
        <small class="texto-suave">Enquanto a guia do DAS do mês não é lançada (conta "Impostos (DAS)", com a data do mês a que se refere), o DRE estima pelo Simples, Anexo I, e marca como "estimado".</small></div>
    </div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="check"><input type="checkbox" id="cfg-depreciacao" ${c.depreciacaoLigada ? "checked" : ""}> Depreciação mensal dos investimentos</label></div>
    </div>

    <h3 class="cfg-titulo">Estoque em R$</h3>
    <div class="form-row">
      <div class="form-group"><label>Estoque inicial (R$)</label><input type="number" step="0.01" min="0" id="cfg-estoque" value="${c.estoque.inicial}"></div>
      <div class="form-group"><label>A partir de</label><input type="date" id="cfg-estoque-data" value="${c.estoque.dataInicial || ""}"></div>
    </div>
    <small class="texto-suave">Estoque estimado = inicial + compras − CMV. O controle por item fica para uma fase futura (as compras já aceitam itens).</small>

    <h3 class="cfg-titulo">Cheques recebidos</h3>
    <div class="form-row"><div class="form-group"><label>Conta de depósito padrão (na compensação)</label>
      <select id="cfg-cheque-deposito">${["bradesco", "picpay"].map((x) => `<option value="${x}" ${c.cheques.contaDeposito === x ? "selected" : ""}>${CONTAS_FIN[x]}</option>`).join("")}</select>
      <small class="texto-suave">Pode ser trocada em cada cheque, na seção Cheques.</small></div></div>

    <h3 class="cfg-titulo">Fiado</h3>
    <div class="form-row">
      <div class="form-group"><label class="check"><input type="checkbox" id="cfg-fiado-ligado" ${c.fiado.ligado ? "checked" : ""}> Vender fiado (a forma "Fiado" aparece nas vendas)</label></div>
      <div class="form-group"><label for="cfg-fiado-prazo">Prazo padrão para pagar (dias)</label><input type="number" min="1" max="365" step="1" id="cfg-fiado-prazo" value="${c.fiado.prazoDias}">
        <small class="texto-suave">O vencimento sugerido é a data da venda + esse prazo; pode ser trocado em cada venda.</small></div>
    </div>

    <div class="export-actions"><button type="submit" class="btn-primary">Salvar configuração</button></div>`;
  const mostrarEstimativas = () => { $("cfg-estimativas-campos").hidden = !$("cfg-estimativas").checked; };
  $("cfg-estimativas").addEventListener("change", mostrarEstimativas);
  mostrarEstimativas();
  $("orc-config-form").innerHTML = `
    <div class="form-row">
      <div class="form-group"><label for="cfg-orc-validade">Validade padrão (dias)</label><input type="number" min="1" max="90" step="1" id="cfg-orc-validade" value="${c.orcamentos.validadeDias}"></div>
      <div class="form-group"><label for="cfg-orc-cobrar">Mostrar o 🔔 (cobrar) depois de quantos dias sem contato</label><input type="number" min="1" max="60" step="1" id="cfg-orc-cobrar" value="${c.orcamentos.diasParaCobrar}"></div>
    </div>
    <label>Modelos de mensagem de cobrança do WhatsApp (variáveis: {nome}, {numero}, {valor}, {dias}, {validade}). Deixe em branco para apagar.</label>
    <div class="modelos-orc">${[0, 1, 2].map((i) => `<textarea data-modelo="${i}" maxlength="600" placeholder="Modelo ${i + 1}">${esc(c.orcamentos.modelos[i] || "")}</textarea>`).join("")}</div>
    <div class="export-actions"><button type="submit" class="btn-primary">Salvar configuração</button></div>`;
}

async function salvarConfig(e) {
  e.preventDefault();
  const formas = {};
  document.querySelectorAll("[data-forma-conta]").forEach((s) => { formas[s.dataset.formaConta] = { conta: s.value }; });
  document.querySelectorAll("[data-forma-tpag]").forEach((i) => { (formas[i.dataset.formaTpag] ||= { conta: null }).tPag = i.value.trim(); });
  const taxaPctPorParcelas = {};
  document.querySelectorAll("[data-parcela]").forEach((i) => { taxaPctPorParcelas[i.dataset.parcela] = num(i.value) || 0; });
  const financeiro = {
    formas,
    cartao: {
      debito: { taxaPct: num($("cfg-deb-taxa").value) || 0, prazoDias: num($("cfg-deb-prazo").value) || 0 },
      credito: { taxaPct: num($("cfg-cred-taxa").value) || 0, prazoDias: num($("cfg-cred-prazo").value) || 0 },
      parcelado: { taxaPctPorParcelas, prazoDias: num($("cfg-parc-prazo").value) || 30 },
    },
    cmv: { margemPadraoPct: num($("cfg-margem").value) ?? 50 },
    pessoal: { fgtsPct: num($("cfg-fgts").value) ?? 8, estimarFgts: $("cfg-fgts-estimar").checked, provisaoPct: num($("cfg-provisao").value) ?? 19.44, provisao13FeriasLigada: $("cfg-provisao-ligada").checked },
    impostos: { regime: $("cfg-regime").value, rbt12: num($("cfg-rbt12").value) },
    depreciacaoLigada: $("cfg-depreciacao").checked,
    estimativasContabeis: $("cfg-estimativas").checked,
    estoque: { inicial: num($("cfg-estoque").value) || 0, dataInicial: $("cfg-estoque-data").value || null },
    cheques: { contaDeposito: $("cfg-cheque-deposito").value },
    fiado: { ligado: $("cfg-fiado-ligado").checked, prazoDias: num($("cfg-fiado-prazo").value) },
    orcamentos: {
      validadeDias: num($("cfg-orc-validade").value),
      diasParaCobrar: num($("cfg-orc-cobrar").value),
      diasAmarelo: mesclarConfigFinanceiro(C().configFinanceiro).orcamentos.diasAmarelo, // não usado mais (o 🔔 substituiu o amarelo)
      modelos: [...document.querySelectorAll("[data-modelo]")].map((t) => t.value.trim()).filter(Boolean),
    },
  };
  try {
    const r = await window.api("/api/config", { method: "POST", body: { financeiro } });
    C().configFinanceiro = r.financeiro;
    alert("Configuração salva.");
    window.Orcamentos?.configMudou();
  } catch (err) {
    alert(`A configuração não foi salva: ${err.message}`);
  }
}

// ---------- Eventos ----------

document.querySelectorAll(".subtabs[data-grupo]").forEach((nav) => nav.addEventListener("click", (e) => {
  const b = e.target.closest(".subtab");
  if (b) mostrarSub(nav.dataset.grupo, b.dataset.sub);
}));
$("fin-tipo").addEventListener("change", renderFormulario);
$("fin-form").addEventListener("submit", enviarFormulario);
$("fin-config-form").addEventListener("submit", salvarConfig);
// Ajustes › Impressão: só o cabeçalho; o resto da configuração vai junto, como está
$("aj-impressao-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const impressao = Object.fromEntries(["nome", "telefone", "endereco", "cnpj"].map((k) => [k, $(`imp-cfg-${k}`).value.trim()]));
  try {
    const r = await window.api("/api/config", { method: "POST", body: { financeiro: { ...mesclarConfigFinanceiro(C().configFinanceiro), impressao } } });
    C().configFinanceiro = r.financeiro;
    alert("Cabeçalho da impressão salvo.");
  } catch (err) {
    alert(`Não foi salvo: ${err.message}`);
  }
});
$("orc-config-form").addEventListener("submit", salvarConfig);
for (const id of ["fin-f-mes", "fin-f-tipo", "fin-f-conta"]) $(id).addEventListener("change", () => { estado.selecionados.clear(); renderLista(); });
$("fin-f-busca").addEventListener("input", () => renderLista());
$("fin-lista-body").addEventListener("change", (e) => {
  if (!e.target.classList.contains("fin-sel")) return;
  if (e.target.checked) estado.selecionados.add(e.target.value); else estado.selecionados.delete(e.target.value);
  e.target.closest("tr").classList.toggle("selecionado", e.target.checked);
  atualizarLote();
});
$("fin-lista-body").addEventListener("click", (e) => {
  const b = e.target.closest("[data-excluir], [data-vias], [data-corrigir]");
  if (!b) return;
  if (b.dataset.excluir) C().excluir(b.dataset.excluir);
  if (b.dataset.vias) viasDaVenda(b.dataset.vias);
  if (b.dataset.corrigir) corrigirVenda(b.dataset.corrigir);
});
$("fin-sel-todos").addEventListener("change", (e) => {
  for (const l of estado.visivel) { if (e.target.checked) estado.selecionados.add(String(l.id)); else estado.selecionados.delete(String(l.id)); }
  renderLista();
});
$("fin-lote-aplicar").addEventListener("click", () => {
  const conta = $("fin-lote-conta").value;
  if (!conta) return alert("Escolha a nova conta.");
  if (confirm(`Aplicar "${contaPorId[conta].nome}" em ${estado.selecionados.size} lançamento(s)?`)) aplicarLote({ conta });
});
$("fin-lote-sugestao").addEventListener("click", () => {
  if (confirm(`Aceitar a sugestão dos ${estado.selecionados.size} lançamento(s) selecionados? Os que não têm sugestão ficam como estão.`)) aplicarLote({ aceitarSugestao: true });
});
$("fin-lote-vinculo-aplicar").addEventListener("click", () => {
  const vinculo = $("fin-lote-vinculo").value;
  if (!vinculo) return alert("Escolha o vínculo.");
  if (confirm(`Marcar os salários selecionados como "${VINCULOS.find((v) => v.id === vinculo).nome}"? Os que não são salário ficam como estão.`)) aplicarLote({ vinculo });
});
$("fin-lote-forma-aplicar").addEventListener("click", () => {
  const forma = $("fin-lote-forma").value;
  if (!forma) return alert("Escolha a nova forma.");
  if (confirm(`Trocar a forma de pagamento para "${FORMAS[forma].nome}" nas vendas selecionadas?`)) aplicarLote({ forma });
});
$("rel-mes").addEventListener("change", () => { $("rel-dia").value = ""; renderSub(); });
$("rel-visao").addEventListener("change", renderSub);
$("rel-dia").addEventListener("change", () => {
  const d = $("rel-dia").value;
  if (d) $("rel-mes").value = d.slice(0, 7);
  renderResumo();
});
// Imprimir A4: só a seção aberta de Relatórios
$("rel-imprimir").addEventListener("click", () => {
  const sub = estado.sub.relatorios;
  document.body.classList.add("imprimindo-rel");
  document.body.classList.toggle("dre-anual", sub === "dre" && document.querySelector('input[name="rel-visao"]:checked').value === "ano");
  window.print();
  document.body.classList.remove("imprimindo-rel", "dre-anual");
});

window.Financeiro = {
  // Abrir a aba: o Caixa sempre abre em Lançar
  abrir(aba) {
    estado.aba = aba;
    if (aba === "caixa") estado.sub.caixa = "lancar";
    mostrarSub(aba, estado.sub[aba]);
  },
  atualizar() {
    if (!estado.aba || $(`tab-${estado.aba}`).style.display === "none") return;
    renderSub();
  },
  irPara(aba, sub) {
    window.switchTab(aba);
    mostrarSub(aba, sub);
  },
};
