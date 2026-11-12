// Editor de formas de pagamento de uma venda (Vender, Caixa › Lançar e recebimento de fiado).
// Uma venda pode ter várias formas, como na NF-e; a soma precisa ser igual ao total.
// Fiado: pede o cliente (a não ser que a tela já tenha um campo de cliente) e o vencimento.
import { FORMAS_PADRAO } from "./lib/planoContas.js";
import { hojeSP } from "./lib/datas.js";

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
 * @param {(nomeCliente: string) => ({semPrazo: boolean, dias: number|null}|null)} [opcoes.prazo] prazo do fiado do cliente
 *   (cadastro): "sem prazo" (acerta quando juntar, sem vencimento) ou o prazo dele em dias
 * @param {() => string} [opcoes.emitente] nome do cliente: vem preenchido como emitente de cada cheque (pode trocar)
 *
 * Cheques: cada cheque é uma linha (forma "cheque") com valor, "bom para" (obrigatório), banco, número e emitente.
 * "+ adicionar cheque" acrescenta uma linha; "Dividir em cheques" gera N cheques iguais (os centavos que sobram
 * vão no último) com as datas a cada X dias, tudo editável depois.
 */
export function criarEditorPagamentos(el, { total = 0, semFiado = false, clienteExterno = false, fiado = null, prazo = null, emitente = null } = {}) {
  let alvo = total;
  let linhas = [{ forma: "dinheiro", valor: total, parcelas: 2, cheque: {} }];
  let cliente = "";
  let divisor = null; // painel "Dividir em cheques" aberto: { total, qtd, intervalo, primeira }
  const nomeEmitente = () => (emitente ? emitente() : cliente) || "";
  const novoCheque = (valor, compensacao = "") => ({ forma: "cheque", valor, parcelas: 2, cheque: { emissor: nomeEmitente(), compensacao } });

  const cfgFiado = () => (fiado ? fiado() : { ligado: false, prazoDias: 30, data: "" });
  const formas = () => FORMAS_PADRAO.filter((f) => !f.soMigracao && (!f.fiado || (!semFiado && cfgFiado().ligado)));
  const restante = () => (centavos(alvo) - linhas.reduce((s, l) => s + centavos(l.valor), 0)) / 100;
  const temFiado = () => linhas.some((l) => l.forma === "fiado" && centavos(l.valor) > 0);
  const prazoAtual = () => (prazo ? prazo(cliente.trim()) : null);
  const ehContaCorrente = () => Boolean(prazoAtual()?.semPrazo);
  // Vencimento sugerido: data da venda + o prazo do cliente (ou o padrão). Se a pessoa mudou a data, fica a dela.
  const vencimentoSugerido = () => {
    const c = cfgFiado();
    return somarDias(c.data || hojeSP(), prazoAtual()?.dias || c.prazoDias || 30);
  };
  const ajustarVencimentos = () => { for (const l of linhas) if (l.forma === "fiado" && !l.vencManual) l.vencimento = vencimentoSugerido(); };

  let prazoDesenhado = null;
  function render() {
    prazoDesenhado = JSON.stringify(prazoAtual());
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
                <label class="texto-suave pag-ch-data">Bom para <input type="date" class="pag-ch" data-campo="compensacao" value="${esc(l.cheque.compensacao)}" aria-label="Bom para (data de depósito)"></label>
                <input type="text" class="pag-ch" data-campo="banco" placeholder="Banco" value="${esc(l.cheque.banco)}" aria-label="Banco">
                <input type="text" class="pag-ch" data-campo="numero" placeholder="Nº do cheque" value="${esc(l.cheque.numero)}" aria-label="Número do cheque">
                <input type="text" class="pag-ch" data-campo="emissor" placeholder="Emitente" value="${esc(l.cheque.emissor)}" aria-label="Emitente">
              </div>` : ""}
            ${l.forma === "fiado" ? `
              <div class="pag-fiado">
                ${clienteExterno ? '<span class="texto-suave">Cliente: use o campo "Cliente" acima (obrigatório no fiado).</span>'
                  : `<input type="text" class="pag-fiado-cliente" list="clientes-lista" placeholder="Cliente (obrigatório)" value="${esc(cliente)}" aria-label="Cliente do fiado" autocomplete="off"><button type="button" class="btn-icon mini pag-cli-novo">+ cadastrar novo</button>`}
                ${ehContaCorrente() ? '<span class="tag tag-cc">Sem prazo: acerta quando juntar</span>'
                  : `<label class="texto-suave">Vence em <input type="date" class="pag-fiado-venc" value="${esc(l.vencimento || "")}" aria-label="Vencimento do fiado"></label>${prazoAtual()?.dias ? `<small class="texto-suave">prazo do cliente: ${prazoAtual().dias} dias</small>` : ""}`}
              </div>` : ""}
          </div>`).join("")}
        ${divisor ? `
        <div class="pag-divisor">
          <strong>Dividir em cheques</strong>
          <label class="texto-suave">Total (R$) <input type="number" class="pag-div" data-campo="total" step="0.01" min="0" inputmode="decimal" value="${divisor.total ? Number(divisor.total).toFixed(2) : ""}"></label>
          <label class="texto-suave">Quantos cheques <input type="number" class="pag-div" data-campo="qtd" step="1" min="2" max="24" inputmode="numeric" value="${divisor.qtd}"></label>
          <label class="texto-suave">A cada (dias) <input type="number" class="pag-div" data-campo="intervalo" step="1" min="0" max="365" inputmode="numeric" value="${divisor.intervalo}"></label>
          <label class="texto-suave">1º bom para <input type="date" class="pag-div" data-campo="primeira" value="${esc(divisor.primeira)}"></label>
          <button type="button" class="btn-primary pag-div-gerar">Gerar cheques</button>
          <button type="button" class="btn-icon pag-div-cancelar">Cancelar</button>
        </div>` : ""}
        <div class="pag-rodape">
          <button type="button" class="btn-icon pag-adicionar">+ outra forma</button>
          <button type="button" class="btn-icon pag-add-cheque">+ adicionar cheque</button>
          <button type="button" class="btn-icon pag-dividir">Dividir em cheques</button>
          <span class="pag-status"></span>
        </div>
      </div>`;
    atualizarStatus();
  }

  // "· 4 cheques R$ 3.980,00"
  const resumoCheques = () => {
    const chs = linhas.filter((l) => l.forma === "cheque");
    return chs.length > 1 ? ` · ${chs.length} cheques ${moeda(chs.reduce((s, l) => s + centavos(l.valor), 0) / 100)}` : "";
  };

  // Gera os cheques: valores iguais (os centavos que sobram vão no último) e as datas a cada X dias
  function gerarCheques({ total: t, qtd, intervalo, primeira }) {
    const n = Math.round(Number(qtd));
    const tc = centavos(t);
    if (!(tc > 0)) throw new Error("Informe o total a dividir.");
    if (!(n >= 2 && n <= 24)) throw new Error("Quantidade de cheques: de 2 a 24.");
    if (!primeira) throw new Error("Informe a data do 1º cheque (bom para).");
    const passo = Math.max(0, Math.round(Number(intervalo) || 0));
    const cada = Math.floor(tc / n);
    const novos = Array.from({ length: n }, (_, k) => novoCheque((k === n - 1 ? tc - cada * (n - 1) : cada) / 100, somarDias(primeira, k * passo)));
    // os cheques antigos saem; se os cheques cobrem o total todo, as outras formas também (ex.: o "Dinheiro" que vinha preenchido)
    const outras = linhas.filter((l) => l.forma !== "cheque" && centavos(l.valor) > 0);
    linhas = [...(tc >= centavos(alvo) ? [] : outras), ...novos];
  }

  function atualizarStatus() {
    const r = restante();
    const st = el.querySelector(".pag-status");
    if (!st) return;
    if (!(alvo > 0)) {
      st.className = "pag-status";
      st.textContent = ""; // sem total ainda: nada a conferir
    } else if (Math.abs(r) < 0.005) {
      st.className = "pag-status ok";
      st.textContent = `Soma confere: ${moeda(alvo)}${resumoCheques()}`;
    } else {
      st.className = "pag-status falta";
      st.textContent = (r > 0 ? `Faltam ${moeda(r)} para fechar ${moeda(alvo)}` : `Sobram ${moeda(-r)} além do total de ${moeda(alvo)}`) + resumoCheques();
    }
  }

  el.addEventListener("change", (e) => {
    const linha = e.target.closest(".pag-linha");
    if (!linha) return;
    const l = linhas[Number(linha.dataset.i)];
    if (e.target.classList.contains("pag-forma")) {
      l.forma = e.target.value;
      if (l.forma === "cheque" && !l.cheque.emissor) l.cheque.emissor = nomeEmitente();
      if (l.forma === "fiado" && !l.vencimento) l.vencimento = vencimentoSugerido();
      return render();
    }
    if (e.target.classList.contains("pag-parcelas")) l.parcelas = Number(e.target.value);
    if (e.target.classList.contains("pag-ch")) l.cheque[e.target.dataset.campo] = e.target.value;
    if (e.target.classList.contains("pag-fiado-venc")) { l.vencimento = e.target.value; l.vencManual = true; }
    // Ao terminar de digitar o cliente: sem prazo esconde o vencimento; com prazo próprio, o vencimento acompanha
    if (e.target.classList.contains("pag-fiado-cliente")) { cliente = e.target.value; atualizar(); }
  });
  el.addEventListener("input", (e) => {
    if (e.target.classList.contains("pag-div") && divisor) { divisor[e.target.dataset.campo] = e.target.value; return; }
    if (e.target.classList.contains("pag-fiado-cliente")) { cliente = e.target.value; return; }
    if (!e.target.classList.contains("pag-valor")) return;
    linhas[Number(e.target.closest(".pag-linha").dataset.i)].valor = num(e.target.value);
    atualizarStatus();
  });
  el.addEventListener("click", (e) => {
    if (e.target.classList.contains("pag-cli-novo")) {
      window.ClientesUI?.novo({ nome: cliente.trim() }).then((c) => { if (c) { cliente = c.nome; ajustarVencimentos(); render(); } });
      return;
    }
    if (e.target.classList.contains("pag-add-cheque")) {
      linhas.push(novoCheque(Math.max(0, restante())));
      return render();
    }
    if (e.target.classList.contains("pag-dividir")) {
      // total sugerido: o que falta, ou o total todo se uma forma só ainda está com tudo
      const semCheques = linhas.filter((l) => l.forma !== "cheque");
      const livre = (centavos(alvo) - semCheques.reduce((s, l) => s + centavos(l.valor), 0)) / 100;
      divisor = { total: livre > 0.004 ? livre : alvo, qtd: 4, intervalo: 30, primeira: hojeSP() };
      return render();
    }
    if (e.target.classList.contains("pag-div-cancelar")) { divisor = null; return render(); }
    if (e.target.classList.contains("pag-div-gerar")) {
      el.querySelectorAll(".pag-div").forEach((i) => { divisor[i.dataset.campo] = i.value; });
      try { gerarCheques({ ...divisor, total: num(divisor.total) }); } catch (err) { return alert(err.message); }
      divisor = null;
      return render();
    }
    if (e.target.classList.contains("pag-adicionar")) {
      const r = Math.max(0, restante());
      linhas.push({ forma: "pix_bradesco", valor: r, parcelas: 2, cheque: {} });
      render();
    } else if (e.target.classList.contains("pag-remover")) {
      linhas.splice(Number(e.target.closest(".pag-linha").dataset.i), 1);
      render();
    }
  });

  // Só redesenha se o prazo mudou (outro cliente): não apaga o que está sendo digitado
  function atualizar() { if (JSON.stringify(prazoAtual()) !== prazoDesenhado) { ajustarVencimentos(); render(); } }

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
      divisor = null;
      linhas = [{ forma: "dinheiro", valor: t, parcelas: 2, cheque: {} }];
      cliente = "";
      render();
    },
    // Cliente sugerido (ex.: venda de um orçamento)
    definirCliente(nome) {
      cliente = nome || "";
      ajustarVencimentos();
      render();
    },
    // Corrigir uma venda: volta as formas gravadas (valor, parcelas, cheque, vencimento do fiado)
    carregar(pagamentos, total, nomeCliente = "") {
      alvo = Number(total) || 0;
      linhas = (pagamentos || []).map((p) => ({
        forma: p.forma, valor: Number(p.valor) || 0, parcelas: p.parcelas || 2, cheque: { ...(p.cheque || {}) },
        vencimento: p.fiado?.vencimento || "",
      }));
      if (!linhas.length) linhas = [{ forma: "dinheiro", valor: alvo, parcelas: 2, cheque: {} }];
      cliente = nomeCliente || "";
      render();
    },
    clienteDigitado: () => cliente.trim(),
    temFiado,
    gerarCheques(op) { gerarCheques(op); render(); }, // (testes)
    // A tela mudou o cliente (campo "Cliente" de fora): redesenha (conta corrente esconde o vencimento)
    atualizar,
    // Lança erro claro se a soma não fechar ou se faltar o vencimento do fiado
    ler() {
      if (Math.abs(restante()) >= 0.005) {
        const r = restante();
        throw new Error(r > 0 ? `Falta ${moeda(r)} nas formas de pagamento.` : `As formas de pagamento passam ${moeda(-r)} do total.`);
      }
      return linhas.filter((l) => centavos(l.valor) > 0).map((l) => {
        const p = { forma: l.forma, valor: Math.round(Number(l.valor) * 100) / 100 };
        if (l.forma === "credito_parcelado") p.parcelas = Number(l.parcelas) || 2;
        if (l.forma === "cheque") {
          if (!l.cheque.compensacao) throw new Error("Informe o \"bom para\" de cada cheque (a data de depósito).");
          p.cheque = { ...l.cheque };
        }
        if (l.forma === "fiado") {
          if (ehContaCorrente()) p.fiado = { contaCorrente: true };
          else {
            if (!l.vencimento) throw new Error("Informe o vencimento do fiado.");
            p.fiado = { vencimento: l.vencimento };
          }
        }
        return p;
      });
    },
  };
}
