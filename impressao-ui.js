// Janela de impressão das vias (pedidos e orçamentos): escolha 2 vias / só loja / só cliente (lembrada no
// aparelho), prévia na tela, Imprimir (A4, sem cabeçalho e rodapé do navegador) e Baixar PDF.
// O documento sai de lib/impressao.js: nada de custo, margem, tabela, % ou controle interno.
import { documentoDaVenda, documentoDoOrcamento, folhaHtml, lojaDaConfig, faltaNaImpressao, CSS_FOLHA, moeda } from "./lib/impressao.js";
import { normalizarTelefone, pareceFixo } from "./lib/orcamentos.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const MODO_KEY = "madeireira_vias_modo";
const lerModo = () => { try { return localStorage.getItem(MODO_KEY) || "duas"; } catch { return "duas"; } };
const guardarModo = (m) => { try { localStorage.setItem(MODO_KEY, m); } catch { /* aparelho sem armazenamento */ } };

const estado = { doc: null, vendaId: null, nomeArquivo: "pedido", paginaInteira: false, lojaExemplo: null };

// O CSS da folha vai uma vez para a página (prévia, impressão e PDF usam o mesmo)
if (!$("estilo-folha")) {
  const st = document.createElement("style");
  st.id = "estilo-folha";
  st.textContent = CSS_FOLHA;
  document.head.appendChild(st);
}

const loja = () => estado.lojaExemplo || lojaDaConfig(window.Caixa?.configFinanceiro);
const modoAtual = () => document.querySelector('input[name="imp-modo"]:checked')?.value || "duas";

// Pedido grande demais para meia folha: cada via vai numa página inteira
function cabeEmMeiaFolha(doc) {
  const teste = document.createElement("div");
  teste.style.cssText = "position:fixed;left:-20000px;top:0;";
  teste.innerHTML = folhaHtml(doc, loja(), { modo: "loja" });
  document.body.appendChild(teste);
  const via = teste.querySelector(".pv-via");
  const cabe = via.scrollHeight <= via.clientHeight + 1;
  teste.remove();
  return cabe;
}

function renderPrevia() {
  const modo = modoAtual();
  $("imp-previa-folha").innerHTML = folhaHtml(estado.doc, loja(), { modo, paginaInteira: estado.paginaInteira });
  $("imp-aviso").hidden = !estado.paginaInteira;
}

/**
 * Abre a janela. venda: lançamento já gravado (tem número); orcamento: orçamento salvo.
 * titulo/mensagem: o que aparece no topo ("Venda V-0012 registrada", "Orçamento ORC-0005 salvo"…).
 */
/**
 * imprimirJa: "✅ Registrar e imprimir vias" manda direto para a impressora (com a última escolha de vias),
 * a não ser que falte algo em Ajustes › Impressão: aí a janela fica aberta com o aviso amarelo.
 */
function abrir({ venda = null, orcamento = null, titulo = "", mensagem = "", exemplo = null, imprimirJa = false } = {}) {
  estado.lojaExemplo = exemplo;
  if (venda) {
    const salvo = window.Caixa?.itens?.find((l) => String(l.id) === String(venda.id));
    const l = { ...(salvo || venda) };
    const cad = l.clienteId ? window.Clientes?.porId(l.clienteId) : null;
    estado.doc = documentoDaVenda(l, { cadastro: cad });
    estado.vendaId = salvo ? salvo.id : null;
    estado.nomeArquivo = l.numero ? `Pedido ${l.numero}` : "Pedido";
  } else {
    estado.doc = documentoDoOrcamento(orcamento, { cadastro: orcamento.cliente?.id ? window.Clientes?.porId(orcamento.cliente.id) : null });
    estado.vendaId = null;
    estado.nomeArquivo = `Orçamento ${orcamento.id}`;
  }
  estado.paginaInteira = !cabeEmMeiaFolha(estado.doc);
  $("imp-titulo").textContent = titulo || (estado.doc.tipo === "pedido"
    ? `Imprimir pedido ${estado.doc.numero || ""}`
    : `Imprimir orçamento ${estado.doc.numero}`);
  $("imp-mensagem").innerHTML = mensagem;
  $("imp-mensagem").hidden = !mensagem;
  const modo = lerModo();
  const r = document.querySelector(`input[name="imp-modo"][value="${modo}"]`) || document.querySelector('input[name="imp-modo"][value="duas"]');
  r.checked = true;
  renderPrevia();
  const falta = faltaNaImpressao(loja());
  $("imp-incompleto").hidden = !falta.length;
  $("imp-incompleto").innerHTML = falta.length
    ? `A via está saindo incompleta: falta ${esc(falta.join(", "))}. <a href="#" id="imp-ir-ajustes">Preencher em Ajustes › Impressão</a>`
    : "";
  $("imp-ir-ajustes")?.addEventListener("click", (e) => { e.preventDefault(); fechar(); window.Financeiro?.irPara("ajustes", "impressao"); });
  // Venda registrada: dá para preencher/editar o cliente e a entrega da via
  $("imp-cliente-btn").hidden = !estado.vendaId;
  $("imp-cliente-form").hidden = true;
  estado.orcamentoId = orcamento?.id && !exemplo ? orcamento.id : null;
  atualizarWhats();
  $("modal-impressao").style.display = "flex";
  if (imprimirJa && !falta.length) setTimeout(imprimir, 60);
}

// ---------- 💬 Enviar no WhatsApp (venda registrada ou orçamento salvo) ----------
// Usa o WhatsApp do cliente (não o fixo), só os números, com 55. Grava "WhatsApp aberto em", não "enviado":
// o sistema só sabe que a conversa abriu com a mensagem pronta.
const dataHoraBR = (iso) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).replace(",", "");
function textoPedido(l, doc) {
  const primeiro = String(doc.cliente.nome || "").split(" ")[0];
  const linhas = [`Olá${primeiro && primeiro !== "Consumidor" ? ` ${primeiro}` : ""}! Aqui é da ${loja().nome || "madeireira"}.`, "", `Pedido ${doc.numero || ""}${doc.data ? ` de ${doc.data.split("-").reverse().join("/")}` : ""}:`];
  for (const i of doc.linhas) linhas.push(`• ${[i.quant, i.unid].filter(Boolean).join(" ")} ${i.descricao}${i.cep ? " (cepilhado)" : ""} – ${moeda(i.total)}`.replace("•  ", "• "));
  if (doc.frete) linhas.push(`• Frete / entrega – ${moeda(doc.frete)}`);
  linhas.push("", `Total: ${moeda(doc.total)}`);
  if (doc.pagamentos?.length) linhas.push(`Pagamento: ${doc.pagamentos.map((p) => p.texto).join(" + ")}`);
  if (doc.entrega) linhas.push(`Entrega: ${doc.entrega}`);
  linhas.push("", "Obrigado pela preferência!");
  return linhas.join("\n");
}
function atualizarWhats() {
  const a = $("imp-whats"), info = $("imp-whats-info");
  a.hidden = !estado.vendaId && !estado.orcamentoId;
  info.textContent = "";
  a.removeAttribute("href");
  if (a.hidden) return;
  if (estado.orcamentoId) { a.dataset.modo = "orcamento"; return; }
  a.dataset.modo = "venda";
  const l = window.Caixa?.itens?.find((x) => String(x.id) === String(estado.vendaId));
  const cad = l?.clienteId ? window.Clientes?.porId(l.clienteId) : null;
  const tel = l?.clienteVia?.telefone || cad?.telefone || "";
  const t = normalizarTelefone(tel);
  const abertos = l?.whatsappAbertoEm || [];
  const ultimo = abertos.length ? ` · WhatsApp aberto em ${dataHoraBR(abertos[abertos.length - 1])}` : "";
  if (!t.ok) { info.textContent = `Sem WhatsApp do cliente: preencha em "✎ Cliente e entrega".${ultimo}`; return; }
  a.href = `https://wa.me/55${t.digitos}?text=${encodeURIComponent(textoPedido(l, estado.doc))}`;
  info.textContent = `Para ${t.formatado}${pareceFixo(tel) ? " · ⚠ parece telefone fixo: o WhatsApp pode não abrir" : ""}${ultimo}`;
}
$("imp-whats").addEventListener("click", async (e) => {
  // Orçamento: abre a janela "Enviar" do orçamento (modelo de mensagem, número, registra o contato).
  // A janela das vias fecha antes: senão a do WhatsApp ficava escondida atrás dela.
  if (e.currentTarget.dataset.modo === "orcamento") { e.preventDefault(); const id = estado.orcamentoId; fechar(); window.Orcamentos?.enviarWhats(id); return; }
  if (!e.currentTarget.href) { e.preventDefault(); return alert('Preencha o WhatsApp do cliente em "✎ Cliente e entrega".'); }
  // o link abre o WhatsApp (o navegador cuida disso); aqui só registramos que abriu
  try {
    const r = await window.api("/api/lancamento", { method: "PATCH", body: { acao: "whatsapp", id: estado.vendaId } });
    const l = window.Caixa?.itens?.find((x) => String(x.id) === String(estado.vendaId));
    if (l) l.whatsappAbertoEm = r.whatsappAbertoEm;
    atualizarWhats();
  } catch (err) { console.warn("WhatsApp aberto, mas não registrado:", err.message); }
});

// Recalcula a folha depois de mudar o cliente da venda
function refazerDoc() {
  const l = window.Caixa?.itens?.find((x) => String(x.id) === String(estado.vendaId));
  if (!l) return;
  estado.doc = documentoDaVenda(l, { cadastro: l.clienteId ? window.Clientes?.porId(l.clienteId) : null });
  estado.paginaInteira = !cabeEmMeiaFolha(estado.doc);
  renderPrevia();
  atualizarWhats();
}

// ---------- Cliente e entrega (dados da via salvos na venda) ----------
const CAMPOS_CLI = ["nome", "telefone", "endereco", "bairro", "cidade", "uf", "documento", "ie", "obs"];
const chaveNome = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase().replace(/\s+/g, " ");
const cadastradoPeloNome = (nome) => {
  const iguais = (window.Clientes?.lista || []).filter((c) => !c.inativo && chaveNome(c.nome) === chaveNome(nome));
  return iguais.length === 1 ? iguais[0] : null;
};
function mostrarVinculo() {
  const cad = cadastradoPeloNome($("imp-cli-nome").value);
  $("imp-cli-vinculo").textContent = cad ? "✓ cliente cadastrado: a venda fica vinculada a ele" : $("imp-cli-nome").value.trim() ? "sem cadastro: os dados ficam só nesta venda" : "";
  $("imp-cli-cadastrar-rotulo").hidden = Boolean(cad);
  return cad;
}
function abrirCliente() {
  const l = window.Caixa?.itens?.find((x) => String(x.id) === String(estado.vendaId));
  if (!l) return;
  const cad = l.clienteId ? window.Clientes?.porId(l.clienteId) : null;
  const via = l.clienteVia || {};
  const base = cad ? { nome: cad.nome, telefone: cad.telefone || cad.fixo, endereco: cad.endereco, bairro: cad.bairro, cidade: cad.cidade, uf: cad.uf, documento: cad.documento, ie: cad.ie } : { ...via, nome: via.nome || l.cliente || "" };
  for (const c of CAMPOS_CLI) $(`imp-cli-${c}`).value = (c === "obs" ? via.obs : base[c]) || "";
  $("imp-cli-cadastrar").checked = false;
  mostrarVinculo();
  $("imp-cliente-form").hidden = false;
  $("imp-cli-nome").focus();
}
// Escolheu um cadastrado na lista: preenche com os dados do cadastro
$("imp-cli-nome").addEventListener("change", () => {
  const cad = mostrarVinculo();
  if (!cad) return;
  const dados = { telefone: cad.telefone || cad.fixo, endereco: cad.endereco, bairro: cad.bairro, cidade: cad.cidade, uf: cad.uf, documento: cad.documento, ie: cad.ie };
  for (const [c, v] of Object.entries(dados)) if (v) $(`imp-cli-${c}`).value = v;
});
$("imp-cli-nome").addEventListener("input", mostrarVinculo);
$("imp-cliente-btn").addEventListener("click", () => ($("imp-cliente-form").hidden ? abrirCliente() : ($("imp-cliente-form").hidden = true)));
$("imp-cli-cancelar").addEventListener("click", () => { $("imp-cliente-form").hidden = true; });
$("imp-cliente-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const botao = $("imp-cli-salvar");
  if (botao.disabled) return;
  const v = Object.fromEntries(CAMPOS_CLI.map((c) => [c, $(`imp-cli-${c}`).value.trim()]));
  botao.disabled = true;
  try {
    let cad = cadastradoPeloNome(v.nome);
    if (!cad && $("imp-cli-cadastrar").checked) {
      if (!v.nome) throw new Error("Informe o nome do cliente para cadastrar.");
      const tel = v.telefone.replace(/\D/g, "");
      cad = await window.Clientes.salvar({ nome: v.nome, telefone: tel.length >= 10 && tel.length <= 13 ? v.telefone : "", fixo: tel.length >= 10 ? "" : v.telefone,
        endereco: v.endereco, bairro: v.bairro, cidade: v.cidade, uf: v.uf, documento: v.documento, ie: v.ie });
    }
    await window.api("/api/lancamento", { method: "PATCH", body: { acao: "cliente", id: estado.vendaId, clienteId: cad?.id || null, clienteVia: v } });
    await window.Caixa.recarregar();
    $("imp-cliente-form").hidden = true;
    refazerDoc();
  } catch (err) {
    alert(`Não foi salvo: ${err.message}`);
  } finally {
    botao.disabled = false;
  }
});

function fechar() { $("modal-impressao").style.display = "none"; }

async function imprimir() {
  const modo = modoAtual();
  guardarModo(modo);
  const el = $("impressao-via");
  el.innerHTML = folhaHtml(estado.doc, loja(), { modo, paginaInteira: estado.paginaInteira });
  // Margem zero só nesta impressão: sem margem, o navegador não tem onde pôr o cabeçalho e o rodapé
  const folha = document.createElement("style");
  folha.textContent = "@page { size: A4; margin: 0; }";
  document.head.appendChild(folha);
  document.body.classList.add("imprimindo-via");
  window.print();
  document.body.classList.remove("imprimindo-via");
  folha.remove();
  await marcarImpresso();
}

// A partir da primeira impressão, as próximas saem marcadas "2ª impressão em DD/MM"
async function marcarImpresso() {
  if (!estado.vendaId) return;
  const l = window.Caixa?.itens?.find((x) => String(x.id) === String(estado.vendaId));
  if (!l || l.impressoEm) return;
  try {
    const r = await window.api("/api/lancamento", { method: "PATCH", body: { acao: "impresso", id: estado.vendaId } });
    l.impressoEm = r.impressoEm;
  } catch (e) {
    console.warn("Impressão não marcada:", e.message);
  }
}

// Bibliotecas do PDF (guardadas no projeto, em vendor/): só carregam quando alguém pede o PDF
function carregarScript(src) {
  return new Promise((ok, falha) => {
    if (document.querySelector(`script[src="${src}"]`)) return ok();
    const s = document.createElement("script");
    s.src = src;
    s.onload = ok;
    s.onerror = () => falha(new Error(`não carregou ${src}`));
    document.head.appendChild(s);
  });
}

async function baixarPdf() {
  const modo = modoAtual();
  guardarModo(modo);
  const botao = $("imp-pdf");
  botao.disabled = true;
  const antes = botao.textContent;
  botao.textContent = "Gerando PDF…";
  const area = document.createElement("div");
  area.style.cssText = "position:fixed;left:-20000px;top:0;background:#fff;";
  try {
    await carregarScript("vendor/html2canvas.min.js");
    await carregarScript("vendor/jspdf.umd.min.js");
    area.innerHTML = folhaHtml(estado.doc, loja(), { modo, paginaInteira: estado.paginaInteira });
    document.body.appendChild(area);
    const pdf = new window.jspdf.jsPDF({ orientation: "p", unit: "mm", format: "a4" });
    // Meia folha: a folha inteira numa página; pedido grande: uma via por página
    const paginas = estado.paginaInteira ? [...area.querySelectorAll(".pv-via")] : [area.querySelector(".pv-folha")];
    for (let i = 0; i < paginas.length; i++) {
      const canvas = await window.html2canvas(paginas[i], { scale: 2, backgroundColor: "#ffffff" });
      let w = 210, h = (canvas.height / canvas.width) * 210;
      if (h > 297) { w = w * 297 / h; h = 297; }
      if (i) pdf.addPage();
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, w, h);
    }
    pdf.save(`${estado.nomeArquivo}.pdf`);
    await marcarImpresso();
  } catch (e) {
    alert(`O PDF não foi gerado: ${e.message}. Use Imprimir e escolha "Salvar como PDF".`);
  } finally {
    area.remove();
    botao.disabled = false;
    botao.textContent = antes;
  }
}

$("imp-imprimir").addEventListener("click", imprimir);
$("imp-pdf").addEventListener("click", baixarPdf);
$("imp-fechar").addEventListener("click", fechar);
$("imp-modo").addEventListener("change", () => { guardarModo(modoAtual()); renderPrevia(); });

// Ajustes › Impressão › Ver exemplo: um pedido de mostra com o que está no formulário (nada é gravado)
function exemplo(impressao) {
  const itens = [
    { descricao: "Pinus 2x4 × 3,00 m", acabamento: "BRUTO", quantidadeCobrada: 10, unidade: "peça", vendaTotal: 242.5 },
    { descricao: "Cedro mesclado 1x2", acabamento: "CEPILHADO", quantidade: 6, comprimento: 2.5, quantidadeCobrada: 15, unidade: "m", vendaTotal: 128.1 },
    { descricao: "Forro de pinus comprido", acabamento: "UNICO", quantidadeCobrada: 12.5, unidade: "m²", vendaTotal: 423.13 },
  ];
  const venda = { id: "exemplo", numero: "V-0000", competencia: window.Caixa?.hoje?.() || "", value: 833.73, frete: 40, cliente: "Cliente de exemplo",
    itens, pagamentos: [{ forma: "pix_bradesco", valor: 833.73 }] };
  abrir({ venda, titulo: "Exemplo da via (nada foi gravado)", exemplo: lojaDaConfig({ impressao }) });
  estado.vendaId = null;
}

// window.Via.imprimir(l): compatível com as chamadas antigas (abre a janela)
window.Impressao = { abrir, fechar, esc, exemplo };
window.Via = { imprimir: (l) => abrir({ venda: l }) };
