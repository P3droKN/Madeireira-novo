// Financeiro › Caixa e saldos (abertura, saldo por conta, conferir saldo, projeção 30 dias, fluxo mensal)
// e Financeiro › Cheques (recebidos e emitidos). Fase 2B.
import { movimentos, saldos, projecao, fluxoMensal, cheques, carteiraNaData, CONTAS_CAIXA, NOMES_CONTAS, rotuloTipo } from "./lib/caixa.js";
import { grupoPorId } from "./lib/planoContas.js";
import { somarDias } from "./lib/orcamentos.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const moeda = (v) => (v == null ? "—" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v));
const dataBR = (d) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "");
const num = (v) => (v === "" || v == null ? null : Number(String(v).replace(",", ".")));
const C = () => window.Caixa;
const hoje = () => C()?.hoje() || new Date().toISOString().slice(0, 10);

const estado = { refazer: false, mesFluxo: null, contaFluxo: "", filtroRecebidos: "a_compensar", filtroEmitidos: "a_compensar" };

function dados() {
  const cfg = C().configFinanceiro;
  const movs = movimentos(C().itens, cfg);
  const ab = C().saldos?.abertura || null;
  return { cfg, movs, ab };
}

async function postar(corpo) {
  return window.api("/api/config", { method: "POST", body: corpo });
}

// ---------- Caixa e saldos ----------

function formAbertura(ab) {
  const sugestaoData = hoje();
  const cart = carteiraNaData(C().itens, C().configFinanceiro, sugestaoData);
  const v = (c) => (ab ? ab.contas[c] : "");
  return `<section class="glass-panel">
    <div class="painel-titulo"><h2>Abertura de saldos</h2>${ab ? `<span class="texto-suave">atual: ${dataBR(ab.data)}</span>` : ""}</div>
    <p class="texto-suave">No dia da troca para o sistema novo: confira o extrato do Bradesco e do PicPay e conte a gaveta. O saldo vale para o <strong>início do dia</strong>; os movimentos desse dia em diante entram por cima.</p>
    <form id="cx-abertura" class="fin-form">
      <div class="form-row">
        <div class="form-group"><label for="cx-ab-data">Data da abertura</label><input type="date" id="cx-ab-data" value="${ab?.data || sugestaoData}" required></div>
        <div class="form-group"><label for="cx-ab-gaveta">Gaveta (contagem)</label><input type="number" step="0.01" id="cx-ab-gaveta" value="${v("gaveta")}" required></div>
        <div class="form-group"><label for="cx-ab-bradesco">Bradesco (extrato)</label><input type="number" step="0.01" id="cx-ab-bradesco" value="${v("bradesco")}" required></div>
        <div class="form-group"><label for="cx-ab-picpay">PicPay (extrato)</label><input type="number" step="0.01" id="cx-ab-picpay" value="${v("picpay")}" required></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label for="cx-ab-cheques">Cheques em carteira</label><input type="number" step="0.01" id="cx-ab-cheques" value="${ab ? v("cheques_carteira") : cart.valor}">
          <small class="texto-suave" id="cx-ab-cheques-info">Pelos lançamentos: ${moeda(cart.valor)} em ${cart.quantidade} cheque(s) recebidos antes e que compensam a partir da data. Confira com os cheques na gaveta.</small></div>
        <div class="form-group"><label for="cx-ab-obs">Observação</label><input type="text" id="cx-ab-obs" maxlength="300" value="${esc(ab?.obs || "")}"></div>
      </div>
      <div class="export-actions">
        ${ab ? '<button type="button" class="btn-icon" id="cx-ab-cancelar">Cancelar</button>' : ""}
        <button type="submit" class="btn-primary">Salvar abertura</button>
      </div>
    </form>
  </section>`;
}

function renderCaixa() {
  const el = $("fin-caixa");
  if (!C()) return;
  const { movs, ab } = dados();
  const h = hoje();
  if (!ab) {
    el.innerHTML = '<div class="aviso aviso-alerta"><strong>Faça a abertura de saldos.</strong> Os saldos, a projeção e o fluxo de caixa dependem dela: sem a abertura, o sistema não sabe quanto dinheiro já existia em cada conta.</div>' + formAbertura(null);
    ligarAbertura(null);
    return;
  }
  const s = saldos(movs, ab, h);
  const confs = C().saldos?.conferencias || [];
  const ultima = (c) => [...confs].reverse().find((x) => x.conta === c);
  const p = projecao(movs, ab, h, 30);
  const mes = estado.mesFluxo || h.slice(0, 7);
  const f = fluxoMensal(movs, ab, mes, estado.contaFluxo || null);
  const nomeSaida = (k) => grupoPorId[k]?.nome || rotuloTipo(k);

  const chequesAReceber = p.porDia.flatMap((d) => d.movimentos).filter((m) => m.tipo === "cheque_compensado" && m.valor > 0).reduce((t, m) => t + Math.round(m.valor * 100), 0) / 100;
  el.innerHTML = `${estado.refazer ? formAbertura(ab) : ""}
  <section class="glass-panel">
    <div class="painel-titulo"><h2>Saldos hoje · ${dataBR(h)}</h2>
      <div class="painel-acoes"><span class="texto-suave">abertura em ${dataBR(ab.data)}</span><button class="btn-icon" id="cx-refazer">Refazer abertura</button></div></div>
    <div class="saldos-grid">
      ${CONTAS_CAIXA.map((c) => {
        const u = ultima(c);
        return `<div class="total-bloco saldo-conta">
          <span>${NOMES_CONTAS[c]}</span><strong>${moeda(s.porConta[c])}</strong>
          ${u ? `<small class="${Math.abs(u.diferenca) >= 0.01 ? "texto-ruim" : "texto-ok"}">conferido em ${dataBR(u.data)}: ${Math.abs(u.diferenca) < 0.01 ? "bateu" : `diferença ${moeda(u.diferenca)}`}</small>` : '<small class="texto-suave">ainda não conferido</small>'}
          <button class="btn-icon mini" data-conferir="${c}">${c === "gaveta" ? "Fechar gaveta (contagem)" : c === "cheques_carteira" ? "Conferir cheques" : "Conferir com o extrato"}</button>
        </div>`;
      }).join("")}
      <div class="total-bloco destaque"><span>Total</span><strong>${moeda(s.total)}</strong></div>
    </div>
  </section>

  <section class="glass-panel">
    <div class="painel-titulo"><h2>Projeção dos próximos 30 dias</h2><span class="texto-suave">até ${dataBR(p.fim)}</span></div>
    <div class="saldos-grid">
      <div class="total-bloco"><span>Cartão a receber (PicPay)</span><strong class="type-income">${moeda(p.porTipo.recebivel_cartao || 0)}</strong></div>
      <div class="total-bloco"><span>Cheques a compensar</span><strong class="type-income">${moeda(chequesAReceber)}</strong><small class="texto-suave">saem da carteira e entram no banco</small></div>
      <div class="total-bloco"><span>Cheques emitidos (saem)</span><strong class="type-expense">${moeda(Math.abs(p.porTipo.cheque_emitido || 0))}</strong></div>
      <div class="total-bloco"><span>Contas a pagar lançadas (saem)</span><strong class="type-expense">${moeda(Math.abs(p.porTipo.saida || 0))}</strong></div>
      <div class="total-bloco destaque"><span>Saldo hoje → em 30 dias</span><strong>${moeda(p.saldoHoje.total)} → ${moeda(p.saldoFinal)}</strong></div>
    </div>
    <p class="texto-suave">Em 30 dias, por conta: ${CONTAS_CAIXA.map((c) => `${NOMES_CONTAS[c]} ${moeda(p.porContaFinal[c] || 0)}`).join(" · ")}</p>
    <div class="table-container"><table class="tabela-fin">
      <thead><tr><th>Dia</th><th>O que entra / sai</th><th class="num">Entradas</th><th class="num">Saídas</th><th class="num">Saldo projetado</th></tr></thead>
      <tbody>${p.porDia.map((d) => `<tr><td>${dataBR(d.data)}</td>
        <td>${d.movimentos.filter((m) => !((m.tipo === "cheque_compensado" || m.tipo === "transferencia") && m.valor < 0)).map((m) => m.tipo === "cheque_compensado"
          ? `<small>Cheque${m.cheque ? ` nº ${esc(m.cheque)}` : ""} compensa: carteira → ${NOMES_CONTAS[m.conta]} (${moeda(m.valor)})</small>`
          : `<small>${esc(rotuloTipo(m.tipo))} · ${NOMES_CONTAS[m.conta]}${m.cheque ? ` nº ${esc(m.cheque)}` : ""}${m.descricao ? ` · ${esc(m.descricao)}` : ""}: ${moeda(m.valor)}</small>`).join("")}</td>
        <td class="num type-income">${d.entradas ? moeda(d.entradas) : ""}</td><td class="num type-expense">${d.saidas ? moeda(d.saidas) : ""}</td><td class="num"><strong>${moeda(d.saldo)}</strong></td></tr>`).join("") || '<tr><td colspan="5" class="texto-suave">Nada previsto para os próximos 30 dias.</td></tr>'}</tbody>
    </table></div>
  </section>

  <section class="glass-panel">
    <div class="painel-titulo"><h2>Fluxo de caixa</h2>
      <div class="painel-acoes">
        <input type="month" id="cx-fluxo-mes" value="${mes}" aria-label="Mês">
        <select id="cx-fluxo-conta" aria-label="Conta"><option value="">Consolidado</option>${CONTAS_CAIXA.map((c) => `<option value="${c}" ${estado.contaFluxo === c ? "selected" : ""}>${NOMES_CONTAS[c]}</option>`).join("")}</select>
      </div></div>
    <div class="fluxo-grid">
      <table class="tabela-dre">
        <tbody>
          <tr class="dre-total"><td>Saldo inicial</td><td class="num">${moeda(f.saldoInicial)}</td></tr>
          ${Object.entries(f.entradas).map(([t, v]) => `<tr class="dre-sub"><td>(+) ${esc(rotuloTipo(t))}</td><td class="num type-income">${moeda(v)}</td></tr>`).join("")}
          <tr class="dre-total"><td>(=) Entradas</td><td class="num">${moeda(f.totalEntradas)}</td></tr>
          ${Object.entries(f.saidas).map(([g, v]) => `<tr class="dre-sub"><td>(−) ${esc(nomeSaida(g))}</td><td class="num type-expense">${moeda(-v)}</td></tr>`).join("")}
          <tr class="dre-total"><td>(=) Saídas</td><td class="num">${moeda(-f.totalSaidas)}</td></tr>
          <tr class="dre-total dre-destaque"><td>Saldo final</td><td class="num">${moeda(f.saldoFinal)}</td></tr>
        </tbody>
      </table>
      <div class="table-container"><table class="tabela-fin">
        <thead><tr><th>Dia</th><th class="num">Entradas</th><th class="num">Saídas</th><th class="num">Saldo</th></tr></thead>
        <tbody>${f.dias.map((d) => `<tr><td>${dataBR(d.data)}</td><td class="num type-income">${d.entradas ? moeda(d.entradas) : ""}</td><td class="num type-expense">${d.saidas ? moeda(d.saidas) : ""}</td><td class="num"><strong>${moeda(d.saldo)}</strong></td></tr>`).join("") || '<tr><td colspan="4" class="texto-suave">Sem movimentos no mês.</td></tr>'}</tbody>
      </table></div>
    </div>
    ${estado.contaFluxo ? "" : '<p class="texto-suave">No consolidado, transferências entre contas não aparecem (saem de uma e entram na outra).</p>'}
  </section>`;

  if (estado.refazer) ligarAbertura(ab);
  $("cx-refazer").addEventListener("click", () => { estado.refazer = true; renderCaixa(); });
  el.querySelectorAll("[data-conferir]").forEach((b) => b.addEventListener("click", () => conferir(b.dataset.conferir)));
  $("cx-fluxo-mes").addEventListener("change", (e) => { estado.mesFluxo = e.target.value; renderCaixa(); });
  $("cx-fluxo-conta").addEventListener("change", (e) => { estado.contaFluxo = e.target.value; renderCaixa(); });
}

function ligarAbertura(ab) {
  $("cx-abertura").addEventListener("submit", salvarAbertura);
  $("cx-ab-cancelar")?.addEventListener("click", () => { estado.refazer = false; renderCaixa(); });
  $("cx-ab-data").addEventListener("change", (e) => {
    const c = carteiraNaData(C().itens, C().configFinanceiro, e.target.value);
    $("cx-ab-cheques-info").textContent = `Pelos lançamentos: ${moeda(c.valor)} em ${c.quantidade} cheque(s) recebidos antes e que compensam a partir da data. Confira com os cheques na gaveta.`;
    if (!ab) $("cx-ab-cheques").value = c.valor;
  });
}

async function salvarAbertura(e) {
  e.preventDefault();
  if (C().somenteLeitura) return alert("Sem conexão com a nuvem. Nada foi salvo.");
  const contas = { gaveta: num($("cx-ab-gaveta").value) ?? 0, bradesco: num($("cx-ab-bradesco").value) ?? 0, picpay: num($("cx-ab-picpay").value) ?? 0, cheques_carteira: num($("cx-ab-cheques").value) ?? 0 };
  const data = $("cx-ab-data").value;
  if (!confirm(`Salvar a abertura de ${dataBR(data)}?\n\nGaveta ${moeda(contas.gaveta)}\nBradesco ${moeda(contas.bradesco)}\nPicPay ${moeda(contas.picpay)}\nCheques em carteira ${moeda(contas.cheques_carteira)}`)) return;
  try {
    await postar({ abertura: { data, contas, obs: $("cx-ab-obs").value.trim() } });
  } catch (err) {
    return alert(`A abertura não foi salva: ${err.message}`);
  }
  estado.refazer = false;
  await C().recarregar();
}

async function conferir(conta) {
  const { movs, ab } = dados();
  const data = hoje();
  const calculado = saldos(movs, ab, data).porConta[conta];
  const rotulo = conta === "gaveta" ? "Quanto tem na gaveta (contagem)?" : conta === "cheques_carteira" ? "Quanto soma os cheques em carteira?" : `Saldo do extrato do ${NOMES_CONTAS[conta]} hoje?`;
  const resp = prompt(`${rotulo}\n\nCalculado pelo sistema: ${moeda(calculado)}`);
  if (resp === null) return;
  const informado = num(resp.replace(/\./g, "").replace(",", ".")) ?? num(resp);
  if (informado == null || !Number.isFinite(informado)) return alert("Valor inválido.");
  try {
    const r = await postar({ conferencia: { data, conta, informado, calculado } });
    const dif = r.conferencia.diferenca;
    alert(Math.abs(dif) < 0.01
      ? `${NOMES_CONTAS[conta]}: bateu! ${moeda(informado)}.`
      : `${NOMES_CONTAS[conta]}: diferença de ${moeda(dif)} (real ${moeda(informado)} × calculado ${moeda(calculado)}).\n\n${dif > 0 ? "Tem mais dinheiro do que o lançado: falta lançar alguma entrada?" : "Tem menos dinheiro do que o lançado: falta lançar alguma saída?"}`);
  } catch (err) {
    return alert(`A conferência não foi salva: ${err.message}`);
  }
  await C().recarregar();
}

// ---------- Cheques ----------

function renderCheques() {
  const el = $("fin-cheques");
  if (!C()) return;
  const h = hoje();
  const { recebidos, emitidos } = cheques(C().itens, C().configFinanceiro, h);
  const em30 = somarDias(h, 30);
  const aCompensar30 = recebidos.filter((c) => c.situacao === "a_compensar" && c.compensacao <= em30);
  const carteira = recebidos.filter((c) => c.situacao === "a_compensar");
  const devolvidos = recebidos.filter((c) => c.situacao === "devolvido");
  const emitAbertos = emitidos.filter((c) => c.situacao === "a_compensar");
  const soma = (l) => l.reduce((s, c) => s + c.valor, 0);
  const fr = estado.filtroRecebidos, fe = estado.filtroEmitidos;
  const recFiltrados = recebidos.filter((c) => fr === "todos" || c.situacao === fr);
  const emiFiltrados = emitidos.filter((c) => fe === "todos" || c.situacao === fe);
  const sel = (id, atual, opcoes) => `<select id="${id}">${opcoes.map(([v, n]) => `<option value="${v}" ${v === atual ? "selected" : ""}>${n}</option>`).join("")}</select>`;
  const contaSel = (attrs, atual) => `<select class="mini-select" ${attrs}>${["bradesco", "picpay"].map((c) => `<option value="${c}" ${c === atual ? "selected" : ""}>${NOMES_CONTAS[c]}</option>`).join("")}</select>`;

  el.innerHTML = `
  <div class="saldos-grid" style="margin-bottom: 1.25rem;">
    <div class="total-bloco"><span>Em carteira (a compensar)</span><strong>${moeda(soma(carteira))}</strong><small class="texto-suave">${carteira.length} cheque(s)</small></div>
    <div class="total-bloco"><span>Compensam nos próximos 30 dias</span><strong class="type-income">${moeda(soma(aCompensar30))}</strong><small class="texto-suave">${aCompensar30.length} cheque(s)</small></div>
    <div class="total-bloco"><span>Devolvidos (cobrar do cliente)</span><strong class="type-expense">${moeda(soma(devolvidos))}</strong><small class="texto-suave">${devolvidos.length} cheque(s)</small></div>
    <div class="total-bloco"><span>Emitidos a compensar</span><strong class="type-expense">${moeda(soma(emitAbertos))}</strong><small class="texto-suave">${emitAbertos.length} cheque(s)</small></div>
  </div>

  <section class="glass-panel">
    <div class="painel-titulo"><h2>Cheques recebidos</h2>${sel("ch-f-rec", fr, [["a_compensar", "A compensar (em carteira)"], ["compensado", "Compensados"], ["devolvido", "Devolvidos"], ["todos", "Todos"]])}</div>
    <p class="texto-suave">Na data de compensação, o cheque sai da carteira e entra na conta de depósito. Se voltar, marque como devolvido: ele sai do saldo e fica na lista para cobrar o cliente.</p>
    <div class="table-container"><table class="tabela-fin">
      <thead><tr><th>Compensa em</th><th>Nº</th><th>Emissor / cliente</th><th class="num">Valor</th><th>Recebido</th><th>Depositar em</th><th>Situação</th><th></th></tr></thead>
      <tbody>${recFiltrados.map((c) => `<tr class="${c.situacao === "devolvido" ? "cor-vermelho" : c.situacao === "a_compensar" && c.compensacao <= h ? "cor-amarelo" : ""}">
        <td><input type="date" class="mini-data" value="${c.compensacao}" data-ch-comp="${esc(c.lancamentoId)}|${c.pagamento}" aria-label="Data de compensação"></td>
        <td>${esc(c.numero) || "—"}</td>
        <td>${esc(c.emissor) || "—"}${c.banco ? `<small>${esc(c.banco)}</small>` : ""}${c.cliente ? `<small>${esc(c.cliente)}</small>` : ""}</td>
        <td class="num"><strong>${moeda(c.valor)}</strong></td>
        <td>${dataBR(c.recebidoEm)}</td>
        <td>${contaSel(`data-ch-dep="${esc(c.lancamentoId)}|${c.pagamento}" aria-label="Conta de depósito"`, c.contaDeposito)}</td>
        <td>${c.situacao === "devolvido" ? `<span class="tag tag-menos">devolvido ${dataBR(c.devolvidoEm)}</span>` : c.situacao === "compensado" ? '<span class="tag tag-mais">compensado</span>' : '<span class="tag">em carteira</span>'}</td>
        <td>${c.situacao === "devolvido" ? `<button class="btn-icon mini" data-ch-desfazer="${esc(c.lancamentoId)}|${c.pagamento}">Desfazer</button>` : `<button class="btn-icon mini destaque-vermelho" data-ch-devolver="${esc(c.lancamentoId)}|${c.pagamento}">Devolvido</button>`}</td>
      </tr>`).join("") || '<tr><td colspan="8" class="texto-suave">Nenhum cheque nessa situação.</td></tr>'}</tbody>
    </table></div>
  </section>

  <section class="glass-panel">
    <div class="painel-titulo"><h2>Cheques emitidos</h2>${sel("ch-f-emi", fe, [["a_compensar", "A compensar"], ["compensado", "Compensados"], ["todos", "Todos"]])}</div>
    <p class="texto-suave">O cheque sai do saldo da conta na data de compensação, não na emissão.</p>
    <div class="table-container"><table class="tabela-fin">
      <thead><tr><th>Compensa em</th><th>Nº</th><th>Favorecido</th><th class="num">Valor</th><th>Emitido</th><th>Sai da conta</th><th>Situação</th></tr></thead>
      <tbody>${emiFiltrados.map((c) => `<tr>
        <td><input type="date" class="mini-data" value="${c.compensacao}" data-che-comp="${esc(c.lancamentoId)}" aria-label="Data de compensação"></td>
        <td>${esc(c.numero) || "—"}</td><td>${esc(c.favorecido) || "—"}${c.descricao ? `<small>${esc(c.descricao)}</small>` : ""}</td>
        <td class="num"><strong>${moeda(c.valor)}</strong></td><td>${dataBR(c.emitidoEm)}</td>
        <td>${contaSel(`data-che-conta="${esc(c.lancamentoId)}" aria-label="Conta"`, c.conta)}</td>
        <td>${c.situacao === "compensado" ? '<span class="tag tag-mais">compensado</span>' : '<span class="tag">a compensar</span>'}</td>
      </tr>`).join("") || '<tr><td colspan="7" class="texto-suave">Nenhum cheque nessa situação.</td></tr>'}</tbody>
    </table></div>
  </section>`;

  $("ch-f-rec").addEventListener("change", (e) => { estado.filtroRecebidos = e.target.value; renderCheques(); });
  $("ch-f-emi").addEventListener("change", (e) => { estado.filtroEmitidos = e.target.value; renderCheques(); });
}

async function acaoCheque(corpo) {
  if (C().somenteLeitura) return alert("Sem conexão com a nuvem. Nada foi alterado.");
  try {
    await window.api("/api/lancamento", { method: "PATCH", body: { acao: "cheque", ...corpo } });
  } catch (e) {
    return alert(`O cheque não foi atualizado: ${e.message}`);
  }
  await C().recarregar();
}

document.addEventListener("change", (e) => {
  const t = e.target;
  if (t.dataset.chComp) { const [id, p] = t.dataset.chComp.split("|"); acaoCheque({ id, tipo: "recebido", pagamento: Number(p), compensacao: t.value }); }
  if (t.dataset.chDep) { const [id, p] = t.dataset.chDep.split("|"); acaoCheque({ id, tipo: "recebido", pagamento: Number(p), contaDeposito: t.value }); }
  if (t.dataset.cheComp) acaoCheque({ id: t.dataset.cheComp, tipo: "emitido", compensacao: t.value });
  if (t.dataset.cheConta) acaoCheque({ id: t.dataset.cheConta, tipo: "emitido", conta: t.value });
});
document.addEventListener("click", (e) => {
  const t = e.target;
  if (t.dataset.chDevolver) {
    const [id, p] = t.dataset.chDevolver.split("|");
    const data = prompt("Data em que o cheque voltou (AAAA-MM-DD):", hoje());
    if (data === null) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return alert("Data inválida. Use AAAA-MM-DD.");
    acaoCheque({ id, tipo: "recebido", pagamento: Number(p), devolvidoEm: data });
  }
  if (t.dataset.chDesfazer) {
    const [id, p] = t.dataset.chDesfazer.split("|");
    if (confirm("Desfazer a devolução deste cheque?")) acaoCheque({ id, tipo: "recebido", pagamento: Number(p), devolvidoEm: null });
  }
});

window.CaixaUI = {
  render(sub) {
    if (sub === "caixa") renderCaixa();
    if (sub === "cheques") renderCheques();
  },
};
