// Editor de formas de pagamento de uma venda (Vender, Caixa › Lançar e recebimento de fiado).
// Uma venda pode ter várias formas, como na NF-e; a soma precisa ser igual ao total.
// Fiado: pede o cliente (a não ser que a tela já tenha um campo de cliente) e o vencimento.
import { FORMAS_PADRAO } from "./lib/planoContas.js";

const moeda = (v) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v || 0);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const centavos = (v) => Math.round(Number(v || 0) * 100);
const num = (v) => (v === "" || v == null ? 0 : Number(String(v).replace(",", ".")));
const somarDias = (data, dias) => {
  const [a, m, d] = String(data).split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
};

/**
 * @param {HTMLElement} el
 * @param {object} [opcoes]
 * @param {number} [opcoes.total]
 * @param {boolean} [opcoes.semFiado] recebimento: sem a forma Fiado
 * @param {boolean} [opcoes.clienteExterno] a tela já tem um campo "Cliente" (o fiado usa ele)
 * @param {() => {ligado: boolean, prazoDias: number, data: string}} [opcoes.fiado] configuração do fiado e data da venda
 */
export function criarEditorPagamentos(el, { total = 0, semFiado = false, clienteExterno = false, fiado = null } = {}) {
  let alvo = total;
  let linhas = [{ forma: "dinheiro", valor: total, parcelas: 2, cheque: {} }];
  let cliente = "";

  const cfgFiado = () => (fiado ? fiado() : { ligado: false, prazoDias: 30, data: "" });
  const formas = () => FORMAS_PADRAO.filter((f) => !f.soMigracao && (!f.fiado || (!semFiado && cfgFiado().ligado)));
  const restante = () => (centavos(alvo) - linhas.reduce((s, l) => s + centavos(l.valor), 0)) / 100;
  const temFiado = () => linhas.some((l) => l.forma === "fiado" && centavos(l.valor) > 0);

  function render() {
    el.innerHTML = `
      <div class="pagamentos">
        ${linhas.map((l, i) => `
          <div class="pag-linha" data-i="${i}">
            <select class="pag-forma" aria-label="Forma de pagamento">
              ${formas().map((f) => `<option value="${f.id}" ${f.id === l.forma ? "selected" : ""}>${esc(f.nome)}</option>`).join("")}
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
            ${l.forma === "fiado" ? `
              <div class="pag-fiado">
                ${clienteExterno ? '<span class="texto-suave">Cliente: use o campo "Cliente" acima (obrigatório no fiado).</span>'
                  : `<input type="text" class="pag-fiado-cliente" list="clientes-lista" placeholder="Cliente (obrigatório)" value="${esc(cliente)}" aria-label="Cliente do fiado" autocomplete="off">`}
                <label class="texto-suave">Vence em <input type="date" class="pag-fiado-venc" value="${esc(l.vencimento || "")}" aria-label="Vencimento do fiado"></label>
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
    if (e.target.classList.contains("pag-forma")) {
      l.forma = e.target.value;
      if (l.forma === "fiado" && !l.vencimento) {
        const c = cfgFiado();
        l.vencimento = somarDias(c.data || new Date().toISOString().slice(0, 10), c.prazoDias || 30);
      }
      return render();
    }
    if (e.target.classList.contains("pag-parcelas")) l.parcelas = Number(e.target.value);
    if (e.target.classList.contains("pag-ch")) l.cheque[e.target.dataset.campo] = e.target.value;
    if (e.target.classList.contains("pag-fiado-venc")) l.vencimento = e.target.value;
  });
  el.addEventListener("input", (e) => {
    if (e.target.classList.contains("pag-fiado-cliente")) { cliente = e.target.value; return; }
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
      cliente = "";
      render();
    },
    // Cliente sugerido (ex.: venda de um orçamento)
    definirCliente(nome) {
      cliente = nome || "";
      render();
    },
    clienteDigitado: () => cliente.trim(),
    temFiado,
    // Lança erro claro se a soma não fechar ou se faltar o vencimento do fiado
    ler() {
      if (Math.abs(restante()) >= 0.005) {
        const r = restante();
        throw new Error(r > 0 ? `Falta ${moeda(r)} nas formas de pagamento.` : `As formas de pagamento passam ${moeda(-r)} do total.`);
      }
      return linhas.filter((l) => centavos(l.valor) > 0).map((l) => {
        const p = { forma: l.forma, valor: Math.round(Number(l.valor) * 100) / 100 };
        if (l.forma === "credito_parcelado") p.parcelas = Number(l.parcelas) || 2;
        if (l.forma === "cheque") p.cheque = { ...l.cheque };
        if (l.forma === "fiado") {
          if (!l.vencimento) throw new Error("Informe o vencimento do fiado.");
          p.fiado = { vencimento: l.vencimento };
        }
        return p;
      });
    },
  };
}
