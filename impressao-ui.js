// Janela de impressão das vias (pedidos e orçamentos): escolha 2 vias / só loja / só cliente (lembrada no
// aparelho), prévia na tela, Imprimir (A4, sem cabeçalho e rodapé do navegador) e Baixar PDF.
// O documento sai de lib/impressao.js: nada de custo, margem, tabela, % ou controle interno.
import { documentoDaVenda, documentoDoOrcamento, folhaHtml, lojaDaConfig, faltaNaImpressao, CSS_FOLHA } from "./lib/impressao.js";

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
  $("modal-impressao").style.display = "flex";
  if (imprimirJa && !falta.length) setTimeout(imprimir, 60);
}

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
