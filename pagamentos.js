// Editor de formas de pagamento de uma venda (calculadora e lançamento manual).
// Uma venda pode ter várias formas, como na NF-e; a soma precisa ser igual ao total.
import { FORMAS_PADRAO } from "./lib/planoContas.js";

const FORMAS = FORMAS_PADRAO.filter((f) => !f.soMigracao);
const moeda = (v) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v || 0);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const centavos = (v) => Math.round(Number(v || 0) * 100);
const num = (v) => (v === "" || v == null ? 0 : Number(String(v).replace(",", ".")));

export function criarEditorPagamentos(el, { total = 0, prefixo = "pg" } = {}) {
  let alvo = total;
  let linhas = [{ forma: "dinheiro", valor: total, parcelas: 2, cheque: {} }];

  const restante = () => (centavos(alvo) - linhas.reduce((s, l) => s + centavos(l.valor), 0)) / 100;

  function render() {
    el.innerHTML = `
      <div class="pagamentos">
        ${linhas.map((l, i) => `
          <div class="pag-linha" data-i="${i}">
            <select class="pag-forma" aria-label="Forma de pagamento">
              ${FORMAS.map((f) => `<option value="${f.id}" ${f.id === l.forma ? "selected" : ""}>${esc(f.nome)}</option>`).join("")}
            </select>
            <input type="number" class="pag-valor" step="0.01" min="0" inputmode="decimal" value="${l.valor ? Number(l.valor).toFixed(2) : ""}" aria-label="Valor">
            ${l.forma === "credito_parcelado" ? `<select class="pag-parcelas" aria-label="Parcelas">${[2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => `<option value="${n}" ${n === Number(l.parcelas) ? "selected" : ""}>${n}x</option>`).join("")}</select>` : ""}
            ${linhas.length > 1 ? `<button type="button" class="delete-btn pag-remover" aria-label="Remover forma">✕</button>` : ""}
            ${l.forma === "cheque" ? `
              <div class="pag-cheque">
                <input type="text" class="pag-ch" data-campo="numero" placeholder="Nº do cheque" value="${esc(l.cheque.numero)}">
                <input type="text" class="pag-ch" data-campo="emissor" placeholder="Emissor" value="${esc(l.cheque.emissor)}">
                <input type="text" class="pag-ch" data-campo="banco" placeholder="Banco" value="${esc(l.cheque.banco)}">
                <label class="texto-suave">Compensa em <input type="date" class="pag-ch" data-campo="compensacao" value="${esc(l.cheque.compensacao)}"></label>
              </div>` : ""}
          </div>`).join("")}
        <div class="pag-rodape">
          <button type="button" class="btn-icon pag-adicionar">+ outra forma</button>
          <span class="pag-status"></span>
        </div>
      </div>`;
    atualizarStatus();
  }

  function atualizarStatus() {
    const r = restante();
    const st = el.querySelector(".pag-status");
    if (!st) return;
    if (Math.abs(r) < 0.005) {
      st.className = "pag-status ok";
      st.textContent = `Soma confere: ${moeda(alvo)}`;
    } else {
      st.className = "pag-status falta";
      st.textContent = r > 0 ? `Falta ${moeda(r)} para fechar ${moeda(alvo)}` : `Passou ${moeda(-r)} do total de ${moeda(alvo)}`;
    }
  }

  el.addEventListener("change", (e) => {
    const linha = e.target.closest(".pag-linha");
    if (!linha) return;
    const l = linhas[Number(linha.dataset.i)];
    if (e.target.classList.contains("pag-forma")) { l.forma = e.target.value; return render(); }
    if (e.target.classList.contains("pag-parcelas")) l.parcelas = Number(e.target.value);
    if (e.target.classList.contains("pag-ch")) l.cheque[e.target.dataset.campo] = e.target.value;
  });
  el.addEventListener("input", (e) => {
    if (!e.target.classList.contains("pag-valor")) return;
    linhas[Number(e.target.closest(".pag-linha").dataset.i)].valor = num(e.target.value);
    atualizarStatus();
  });
  el.addEventListener("click", (e) => {
    if (e.target.classList.contains("pag-adicionar")) {
      const r = Math.max(0, restante());
      linhas.push({ forma: "pix_bradesco", valor: r, parcelas: 2, cheque: {} });
      render();
    } else if (e.target.classList.contains("pag-remover")) {
      linhas.splice(Number(e.target.closest(".pag-linha").dataset.i), 1);
      render();
    }
  });

  render();

  return {
    // Com uma forma só, o valor acompanha o total; com várias, quem ajusta é o vendedor
    definirTotal(t) {
      alvo = Number(t) || 0;
      if (linhas.length === 1) linhas[0].valor = alvo;
      render();
    },
    reiniciar(t = 0) {
      alvo = t;
      linhas = [{ forma: "dinheiro", valor: t, parcelas: 2, cheque: {} }];
      render();
    },
    // Lança erro claro se a soma não fechar
    ler() {
      if (Math.abs(restante()) >= 0.005) {
        const r = restante();
        throw new Error(r > 0 ? `Falta ${moeda(r)} nas formas de pagamento.` : `As formas de pagamento passam ${moeda(-r)} do total.`);
      }
      return linhas.filter((l) => centavos(l.valor) > 0).map((l) => {
        const p = { forma: l.forma, valor: Math.round(Number(l.valor) * 100) / 100 };
        if (l.forma === "credito_parcelado") p.parcelas = Number(l.parcelas) || 2;
        if (l.forma === "cheque") p.cheque = { ...l.cheque };
        return p;
      });
    },
  };
}
