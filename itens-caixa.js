// Caixa › Lançar › Venda: bloco "Itens vendidos". Usa o catálogo e o cálculo do Vender
// (window.Calculadora.calcularLinha / itensDaVenda, que chamam calcularItem): uma lógica só.
import { UNIDADES, ACABAMENTOS } from "./lib/catalogo.js";

const moeda = (v) => (v == null ? "—" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = (v) => (v === "" || v == null ? null : Number(String(v).replace(",", ".")));
const fmt = (v, casas) => new Intl.NumberFormat("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas }).format(v);
const K = () => window.Calculadora;

/**
 * @param {HTMLElement} el
 * @param {(estado: {linhas: object[], venda: number, custo: number, semPreco: number}) => void} aoMudar
 */
export function criarItensCaixa(el, aoMudar) {
  let linhas = [];
  const catalogo = () => K()?.catalogo();
  const material = (id) => catalogo()?.materiais.find((m) => m.id === id);

  function qtdTexto(l, r) {
    const item = catalogo().itens.get(l.itemId);
    if (item.unidade === "valor_livre") return "—";
    if (UNIDADES[item.unidade].pedeComprimento) return `${l.quantidade} pç × ${fmt(l.comprimento, 2)} m = ${fmt(r.quantidadeCobrada, 2)} m`;
    return `${fmt(r.quantidadeCobrada, item.unidade === "m2" ? 2 : 0)} ${r.unidadeCobranca}${r.quantidadeCobrada > 1 && item.unidade !== "m2" ? "s" : ""}`;
  }

  function render() {
    if (!el.isConnected) return; // o formulário mudou (ex.: virou Saída) enquanto o catálogo carregava
    if (!K()?.pronta()) {
      el.innerHTML = '<p class="texto-suave">Carregando o catálogo… (o mesmo da aba Vender)</p>';
      setTimeout(render, 500);
      return;
    }
    const grupos = { madeira: "Madeiras", outros: "Outros produtos" };
    const r = linhas.length ? K().itensDaVenda(linhas) : null;
    el.innerHTML = `
      <div class="ic-seletor form-row">
        <div class="form-group"><label for="ic-material">Material</label><select id="ic-material"><option value="" selected disabled>Selecione</option>
          ${Object.entries(grupos).map(([g, rot]) => `<optgroup label="${rot}">${catalogo().materiais.filter((m) => m.grupo === g).map((m) => `<option value="${m.id}">${esc(m.nome)}</option>`).join("")}</optgroup>`).join("")}</select></div>
        <div class="form-group"><label for="ic-medida">Bitola / medida</label><select id="ic-medida" disabled><option value="">—</option></select></div>
        <div class="form-group" id="ic-acab-grupo" hidden><label for="ic-acab">Acabamento</label><select id="ic-acab"></select></div>
        <div class="form-group" id="ic-qtd-grupo"><label for="ic-qtd" id="ic-qtd-rotulo">Quantidade</label><input type="number" id="ic-qtd" min="0" step="1" inputmode="decimal"></div>
        <div class="form-group" id="ic-comp-grupo" hidden><label for="ic-comp">Comprimento (m)</label><input type="number" id="ic-comp" min="0" step="0.01" inputmode="decimal"></div>
        <div class="form-group" id="ic-livre-grupo" hidden><label for="ic-livre">Valor (R$)</label><input type="number" id="ic-livre" min="0" step="0.01" inputmode="decimal"></div>
        <div class="form-group"><label for="ic-preco">Preço unitário (R$)</label><input type="number" id="ic-preco" min="0" step="0.01" inputmode="decimal" placeholder="da tabela"></div>
        <div class="form-group"><button type="button" class="btn-icon" id="ic-adicionar" disabled>+ Adicionar item</button></div>
      </div>
      ${r ? `<div class="table-container"><table class="tabela-fin" id="ic-tabela">
        <thead><tr><th>Item</th><th>Quantidade</th><th class="num">Preço unit.</th><th class="num">Total</th><th class="num sigilo">Custo</th><th></th></tr></thead>
        <tbody>${linhas.map((l, i) => {
          const x = r.resultados[i];
          const livre = catalogo().itens.get(l.itemId).unidade === "valor_livre";
          return `<tr data-i="${i}"><td>${esc(r.itens[i].descricao)}${l.acabamento !== "UNICO" ? ` <small>${esc(ACABAMENTOS[l.acabamento])}</small>` : ""}</td><td>${esc(qtdTexto(l, x))}</td>
            <td class="num">${livre ? "" : `<input type="number" class="ic-preco-linha mini-input" min="0" step="0.01" value="${x.precoUnitario == null ? "" : (Math.round(x.precoUnitario * 100) / 100).toFixed(2)}" placeholder="digite" aria-label="Preço unitário">`}</td>
            <td class="num"><strong>${moeda(x.vendaTotal)}</strong></td><td class="num sigilo">${x.custoTotal == null ? "sem custo" : moeda(x.custoTotal)}</td>
            <td><button type="button" class="delete-btn ic-remover" aria-label="Remover item">✕</button></td></tr>`;
        }).join("")}</tbody>
        <tfoot><tr class="dre-total"><td colspan="3">Total dos itens</td><td class="num" id="ic-total">${moeda(r.venda)}</td><td class="num sigilo" id="ic-custo">${moeda(r.custo)}</td><td></td></tr></tfoot>
      </table></div>` : ""}`;
    ligar();
    aoMudar(r ? { linhas, venda: r.venda, custo: r.custo, semPreco: r.semPreco, itens: r.itens, tabela: r.tabela } : { linhas, venda: 0, custo: 0, semPreco: 0, itens: [] });
  }

  // Preço igual ao da tabela fica "da tabela" (como no Vender); diferente, vale o digitado
  function precoDigitado(it) {
    const p = num(el.querySelector("#ic-preco").value);
    const tab = K().precoTabela(it.id, el.querySelector("#ic-acab").value || "UNICO");
    return p != null && tab != null && Math.abs(p - tab) < 0.005 ? null : p;
  }

  function lerSeletor() {
    const it = catalogo().itens.get(el.querySelector("#ic-medida").value);
    if (!it) return null;
    const livre = it.unidade === "valor_livre";
    return {
      uid: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      itemId: it.id, acabamento: el.querySelector("#ic-acab").value || material(el.querySelector("#ic-material").value).acabamentos[0],
      quantidade: livre ? null : num(el.querySelector("#ic-qtd").value), comprimento: num(el.querySelector("#ic-comp").value),
      totalManual: livre ? num(el.querySelector("#ic-livre").value) : null, descricao: "",
      precoManual: livre ? null : precoDigitado(it), variacaoPct: null, motivo: "",
    };
  }

  function aoEscolherMedida() {
    const it = catalogo().itens.get(el.querySelector("#ic-medida").value);
    const u = it ? UNIDADES[it.unidade] : null;
    const livre = it?.unidade === "valor_livre";
    el.querySelector("#ic-qtd-grupo").hidden = livre;
    el.querySelector("#ic-livre-grupo").hidden = !livre;
    el.querySelector("#ic-comp-grupo").hidden = !u?.pedeComprimento;
    if (u) {
      el.querySelector("#ic-qtd-rotulo").textContent = u.rotuloQtd;
      el.querySelector("#ic-qtd").step = u.inteiro ? "1" : "0.01";
    }
    // Preço da tabela como sugestão (editável)
    const tab = it && !livre ? K().precoTabela(it.id, el.querySelector("#ic-acab").value || "UNICO") : null;
    el.querySelector("#ic-preco").value = tab == null ? "" : tab.toFixed(2);
    el.querySelector("#ic-preco").disabled = livre;
    el.querySelector("#ic-adicionar").disabled = !it;
  }

  function ligar() {
    const selM = el.querySelector("#ic-material");
    const selD = el.querySelector("#ic-medida");
    selM.addEventListener("change", () => {
      const m = material(selM.value);
      selD.innerHTML = '<option value="" disabled selected>Selecione</option>' + m.itens.map((it) => `<option value="${esc(it.id)}">${esc(it.rotuloDimensao)}</option>`).join("");
      selD.disabled = false;
      if (m.itens.length === 1) selD.value = m.itens[0].id;
      el.querySelector("#ic-acab-grupo").hidden = m.acabamentos.length < 2;
      el.querySelector("#ic-acab").innerHTML = m.acabamentos.map((a) => `<option value="${a}">${ACABAMENTOS[a]}</option>`).join("");
      aoEscolherMedida();
    });
    selD.addEventListener("change", aoEscolherMedida);
    el.querySelector("#ic-acab").addEventListener("change", aoEscolherMedida);
    el.querySelector("#ic-adicionar").addEventListener("click", () => {
      const l = lerSeletor();
      if (!l) return;
      try {
        const r = K().calcularLinha(l);
        if (r.vendaTotal == null) return alert("Item sem preço de tabela: digite o preço unitário.");
      } catch (err) {
        return alert(err.message);
      }
      linhas.push(l);
      render();
    });
    el.querySelectorAll(".ic-remover").forEach((b) => b.addEventListener("click", () => { linhas.splice(Number(b.closest("tr").dataset.i), 1); render(); }));
    el.querySelectorAll(".ic-preco-linha").forEach((inp) => inp.addEventListener("change", () => {
      const l = linhas[Number(inp.closest("tr").dataset.i)];
      l.precoManual = num(inp.value);
      render();
    }));
  }

  render();
  return {
    linhas: () => linhas,
    limpar() { linhas = []; render(); },
    // Para os testes e para repetir um pedido: adiciona linhas já prontas
    adicionar(novas) { linhas.push(...novas.map((l) => ({ uid: Math.random().toString(36).slice(2), acabamento: "UNICO", precoManual: null, variacaoPct: null, totalManual: null, motivo: "", descricao: "", ...l }))); render(); },
  };
}
