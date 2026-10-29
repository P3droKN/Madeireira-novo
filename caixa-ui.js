// Caixa › Saldos (saldo por conta, conferir com o extrato, fechar gaveta, projeção de 30 dias),
// Caixa › Cheques (recebidos e emitidos), Relatórios › Fluxo de caixa e Ajustes › Saldos (abertura). Fase 2B.
import { movimentos, saldos, projecao, fluxoMensal, cheques, chequesNaAbertura, CONTAS_CAIXA, NOMES_CONTAS, rotuloTipo } from "./lib/caixa.js";
import { grupoPorId } from "./lib/planoContas.js";
import { somarDias } from "./lib/orcamentos.js";
import { recebidoDeFiadoAnterior } from "./lib/receber.js";

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

let alvos = { saldos: null, fluxo: null, abertura: null, cheques: null };

function semAbertura(el) {
  el.innerHTML = `<div class="aviso aviso-alerta"><strong>Faça a abertura de saldos.</strong> Os saldos, a projeção e o fluxo de caixa dependem dela: sem a abertura, o sistema não sabe quanto dinheiro já existia em cada conta.
    <div class="aviso-acoes"><button class="btn-icon" data-ir-abertura>Ir para Ajustes › Saldos</button></div></div>`;
  el.querySelector("[data-ir-abertura]").addEventListener("click", () => window.Financeiro.irPara("ajustes", "saldos"));
}

// Caixa › Saldos: saldo hoje por conta (conferir / fechar gaveta) e projeção de 30 dias
function renderSaldos(el) {
  alvos.saldos = el;
  if (!C()) return;
  const { movs, ab } = dados();
  const h = hoje();
  if (!ab) return semAbertura(el);
  const s = saldos(movs, ab, h);
  const confs = C().saldos?.conferencias || [];
  const ultima = (c) => [...confs].reverse().find((x) => x.conta === c);
  const p = projecao(movs, ab, h, 30);
  const chequesAReceber = p.porDia.flatMap((d) => d.movimentos).filter((m) => m.tipo === "cheque_compensado" && m.valor > 0).reduce((t, m) => t + Math.round(m.valor * 100), 0) / 100;
  el.innerHTML = `
  <section class="glass-panel">
    <div class="painel-titulo"><h2>Saldos hoje · ${dataBR(h)}</h2>
      <div class="painel-acoes"><span class="texto-suave">abertura em ${dataBR(ab.data)} (Ajustes › Saldos)</span></div></div>
    <div class="saldos-grid">
      ${CONTAS_CAIXA.map((c) => {
        const u = ultima(c);
        return `<div class="total-bloco saldo-conta">
          <span>${NOMES_CONTAS[c]}</span><strong>${moeda(s.porConta[c])}</strong>
          ${u ? `<small class="${Math.abs(u.diferenca) >= 0.01 ? "texto-ruim" : "texto-ok"}">conferido em ${dataBR(u.data)}: ${Math.abs(u.diferenca) < 0.01 ? "bateu" : `diferença ${moeda(u.diferenca)}`}</small>` : '<small class="texto-suave">ainda não conferido</small>'}
          <button class="btn-icon mini" data-conferir="${c}">${c === "gaveta" ? "Fechar gaveta (contagem)" : c === "cheques_carteira" ? "Conferir cheques" : "Conferir com o extrato"}</button>
          ${c === "gaveta" ? '<button class="btn-icon mini" id="cx-ver-resumo-dia">Ver resumo do dia</button>' : ""}
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
  </section>`;
  el.querySelectorAll("[data-conferir]").forEach((b) => b.addEventListener("click", () => conferir(b.dataset.conferir)));
  $("cx-ver-resumo-dia")?.addEventListener("click", () => { window.ResumoDia?.irParaHoje(); window.Financeiro.irPara("relatorios", "dia"); });
}

// Relatórios › Fluxo de caixa do mês (consolidado ou por conta)
function renderFluxo(el, mes) {
  alvos.fluxo = el;
  estado.mesFluxo = mes || estado.mesFluxo || hoje().slice(0, 7);
  if (!C()) return;
  const { movs, ab } = dados();
  if (!ab) return semAbertura(el);
  const f = fluxoMensal(movs, ab, estado.mesFluxo, estado.contaFluxo || null);
  const nomeSaida = (k) => grupoPorId[k]?.nome || rotuloTipo(k);
  // Só informação: quanto das entradas do mês pagou fiado da pasta (anterior à virada), para não parecer que a venda caiu
  const doAnterior = estado.contaFluxo ? 0 : recebidoDeFiadoAnterior(C().itens, C().configFinanceiro, estado.mesFluxo, hoje(), window.Clientes?.lista || []);
  el.innerHTML = `
  <section class="glass-panel">
    <div class="painel-titulo"><h2>Fluxo de caixa</h2>
      <div class="painel-acoes">
        <select id="cx-fluxo-conta" aria-label="Conta"><option value="">Consolidado</option>${CONTAS_CAIXA.map((c) => `<option value="${c}" ${estado.contaFluxo === c ? "selected" : ""}>${NOMES_CONTAS[c]}</option>`).join("")}</select>
      </div></div>
    <div class="fluxo-grid">
      <table class="tabela-dre">
        <tbody>
          <tr class="dre-total"><td>Saldo inicial</td><td class="num">${moeda(f.saldoInicial)}</td></tr>
          ${Object.entries(f.entradas).map(([t, v]) => `<tr class="dre-sub"><td>(+) ${esc(rotuloTipo(t))}</td><td class="num type-income">${moeda(v)}</td></tr>`).join("")}
          <tr class="dre-total"><td>(=) Entradas</td><td class="num">${moeda(f.totalEntradas)}</td></tr>
          ${doAnterior ? `<tr class="dre-sub dre-info-linha"><td><em>(i) Recebido de fiado anterior à virada</em><small class="texto-suave"> já está nas entradas; não é venda deste mês</small></td><td class="num">${moeda(doAnterior)}</td></tr>` : ""}
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
  $("cx-fluxo-conta").addEventListener("change", (e) => { estado.contaFluxo = e.target.value; renderFluxo(el, estado.mesFluxo); });
}

// Ajustes › Saldos: abertura de saldos (fazer ou refazer), com os cheques em carteira um por um
// e o fiado da pasta (o que cada cliente já devia no dia da virada).
const rascunho = {}; // o que foi digitado na abertura sobrevive aos redesenhos (ao lançar cheque/fiado)

function dataDaAbertura(ab, editando) {
  return editando ? (rascunho.data || ab?.data || hoje()) : ab.data;
}

function renderAbertura(el) {
  alvos.abertura = el;
  if (!C()) return;
  const ab = C().saldos?.abertura || null;
  const editando = !ab || estado.refazer;
  const data = dataDaAbertura(ab, editando);
  const ca = chequesNaAbertura(C().itens, C().configFinanceiro, data);
  const fiados = C().itens.filter((l) => l.conta === "fiado_anterior" && !l.excluido).sort((a, b) => String(a.cliente).localeCompare(String(b.cliente)));
  const totalFiado = fiados.reduce((s, l) => s + Math.round(l.value * 100), 0) / 100;
  const prazo = Number(C().configFinanceiro?.fiado?.prazoDias) || 30;
  const v = (c) => rascunho[c] ?? (ab ? ab.contas[c] : "");
  const linhaCheque = (c, removivel) => `<tr><td>${dataBR(c.compensacao)}</td><td>${esc(c.numero) || "—"}</td><td>${esc(c.emissor || c.cliente || "—")}${c.banco ? `<small>${esc(c.banco)}</small>` : ""}</td>
    <td class="num">${moeda(c.valor)}</td><td>${removivel && editando ? `<button class="delete-btn" data-ab-remover="${esc(c.lancamentoId)}">Remover</button>` : ""}</td></tr>`;

  el.innerHTML = `
  ${editando ? `<section class="glass-panel">
    ${ab ? "" : '<div class="aviso aviso-alerta"><strong>Faça a abertura de saldos.</strong> Os saldos, a projeção e o fluxo de caixa dependem dela.</div>'}
    <div class="painel-titulo"><h2>Abertura de saldos</h2>${ab ? `<span class="texto-suave">atual: ${dataBR(ab.data)}</span>` : ""}</div>
    <p class="texto-suave">No dia da troca para o sistema novo: confira o extrato do Bradesco e do PicPay, conte a gaveta e confira os cheques um por um (abaixo). O saldo vale para o <strong>início do dia</strong>; os movimentos desse dia em diante entram por cima.</p>
    <form id="cx-abertura" class="fin-form">
      <div class="form-row">
        <div class="form-group"><label for="cx-ab-data">Data da abertura</label><input type="date" id="cx-ab-data" value="${data}" required></div>
        <div class="form-group"><label for="cx-ab-gaveta">Gaveta (contagem)</label><input type="number" step="0.01" id="cx-ab-gaveta" value="${v("gaveta")}" required></div>
        <div class="form-group"><label for="cx-ab-bradesco">Bradesco (extrato)</label><input type="number" step="0.01" id="cx-ab-bradesco" value="${v("bradesco")}" required></div>
        <div class="form-group"><label for="cx-ab-picpay">PicPay (extrato)</label><input type="number" step="0.01" id="cx-ab-picpay" value="${v("picpay")}" required></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Cheques em carteira</label><strong class="valor-calculado" id="cx-ab-cheques">${moeda(ca.total)}</strong>
          <small class="texto-suave">Soma dos ${ca.doSistema.length + ca.naAbertura.length} cheque(s) da lista abaixo.</small></div>
        <div class="form-group"><label for="cx-ab-obs">Observação</label><input type="text" id="cx-ab-obs" maxlength="300" value="${esc(rascunho.obs ?? ab?.obs ?? "")}"></div>
      </div>
      <div class="export-actions">
        ${ab ? '<button type="button" class="btn-icon" id="cx-ab-cancelar">Cancelar</button>' : ""}
        <button type="submit" class="btn-primary">Salvar abertura</button>
      </div>
    </form>
  </section>` : `<section class="glass-panel">
    <div class="painel-titulo"><h2>Abertura de saldos</h2><button class="btn-icon" id="cx-refazer">Refazer abertura</button></div>
    <p>Feita em <strong>${dataBR(ab.data)}</strong> (saldo do início do dia):
      ${CONTAS_CAIXA.map((c) => `${NOMES_CONTAS[c]} <strong>${moeda(ab.contas[c] || 0)}</strong>`).join(" · ")}</p>
    ${ab.obs ? `<p class="texto-suave">${esc(ab.obs)}</p>` : ""}
    ${Math.abs(ca.total - (ab.contas.cheques_carteira || 0)) >= 0.01 ? `<p class="texto-ruim">Os cheques da lista somam ${moeda(ca.total)}, diferente da abertura (${moeda(ab.contas.cheques_carteira || 0)}). Use "Refazer abertura" para acertar.</p>` : ""}
  </section>`}

  <section class="glass-panel">
    <div class="painel-titulo"><h2>Cheques em carteira na abertura</h2><strong>${moeda(ca.total)}</strong></div>
    <p class="texto-suave">Confira cada cheque com os que estão na gaveta. Os do sistema antigo já estão aqui; ${editando ? "lance abaixo os que estão na gaveta e não aparecem na lista" : 'para lançar outros, use "Refazer abertura"'}.</p>
    <div class="table-container"><table class="tabela-fin">
      <thead><tr><th>Compensa em</th><th>Nº</th><th>Emissor / cliente</th><th class="num">Valor</th><th></th></tr></thead>
      <tbody>
        ${ca.doSistema.length ? `<tr class="grupo-linha"><td colspan="5">Vieram do sistema antigo (${moeda(ca.totalSistema)})</td></tr>${ca.doSistema.map((c) => linhaCheque(c, false)).join("")}` : ""}
        ${ca.naAbertura.length ? `<tr class="grupo-linha"><td colspan="5">Lançados na abertura (${moeda(ca.totalAbertura)})</td></tr>${ca.naAbertura.map((c) => linhaCheque(c, true)).join("")}` : ""}
        ${ca.doSistema.length || ca.naAbertura.length ? "" : '<tr><td colspan="5" class="texto-suave">Nenhum cheque em carteira.</td></tr>'}
      </tbody>
    </table></div>
    ${editando ? `<form id="cx-ab-cheque" class="fin-form linha-adicionar">
      <div class="form-row">
        <div class="form-group"><label for="cx-ch-numero">Nº</label><input type="text" id="cx-ch-numero" maxlength="40"></div>
        <div class="form-group"><label for="cx-ch-emissor">Emissor</label><input type="text" id="cx-ch-emissor" maxlength="120"></div>
        <div class="form-group"><label for="cx-ch-banco">Banco</label><input type="text" id="cx-ch-banco" maxlength="60"></div>
        <div class="form-group"><label for="cx-ch-valor">Valor (R$)</label><input type="number" step="0.01" min="0.01" id="cx-ch-valor" required></div>
        <div class="form-group"><label for="cx-ch-comp">Compensa em</label><input type="date" id="cx-ch-comp" required></div>
        <div class="form-group"><label for="cx-ch-cliente">Cliente (opcional)</label><input type="text" id="cx-ch-cliente" maxlength="120" list="clientes-lista" autocomplete="off"></div>
      </div>
      <button type="submit" class="btn-icon">+ Lançar cheque</button>
    </form>` : ""}
  </section>

  <section class="glass-panel">
    <div class="painel-titulo"><h2>Fiado anterior (pasta)</h2><strong>${moeda(totalFiado)}</strong></div>
    <p class="texto-suave">O que cada cliente já devia no dia da virada. Vai para Caixa › A receber e é abatido nos recebimentos, mas não conta como venda (a venda foi antes do sistema).</p>
    <div class="table-container"><table class="tabela-fin">
      <thead><tr><th>Cliente</th><th class="num">Valor devido</th><th>Desde</th><th>Vencimento</th><th>Observação</th><th></th></tr></thead>
      <tbody>${fiados.map((l) => `<tr><td>${esc(l.cliente)}</td><td class="num">${moeda(l.value)}</td><td>${l.desde ? dataBR(l.desde) : '<span class="texto-suave">—</span>'}</td><td>${l.contaCorrente || !l.vencimento || window.Clientes?.porId(l.clienteId)?.contaCorrente ? '<span class="tag tag-cc">conta corrente</span>' : dataBR(l.vencimento)}</td>
        <td>${l.description && l.description !== "Fiado anterior (pasta)" ? esc(l.description) : ""}</td>
        <td><button class="delete-btn" data-ab-remover="${esc(l.id)}">Remover</button></td></tr>`).join("") || '<tr><td colspan="6" class="texto-suave">Nenhum fiado anterior lançado.</td></tr>'}</tbody>
      ${fiados.length ? `<tfoot><tr class="dre-total" id="cx-fa-total"><td>Total do Fiado anterior (${fiados.length} lançamento${fiados.length > 1 ? "s" : ""})</td><td class="num">${moeda(totalFiado)}</td>
        <td colspan="4" class="texto-suave">confira com a soma da pasta</td></tr></tfoot>` : ""}
    </table></div>
    <form id="cx-ab-fiado" class="fin-form linha-adicionar">
      <div class="form-row">
        <div class="form-group"><label for="cx-fa-cliente">Cliente</label><input type="text" id="cx-fa-cliente" maxlength="120" list="clientes-lista" autocomplete="off" required></div>
        <div class="form-group"><label for="cx-fa-valor">Valor devido (R$)</label><input type="number" step="0.01" min="0.01" id="cx-fa-valor" required></div>
        <div class="form-group"><label for="cx-fa-desde">Desde (via mais antiga)</label><input type="date" id="cx-fa-desde" max="${data}">
          <small class="texto-suave">Para mostrar há quantos dias está em aberto. Em branco: data da abertura.</small></div>
        <div class="form-group"><label class="check"><input type="checkbox" id="cx-fa-cc" checked> Conta corrente (sem vencimento)</label>
          <small class="texto-suave">Marca o cliente como conta corrente no cadastro.</small></div>
        <div class="form-group" id="cx-fa-venc-grupo" hidden><label for="cx-fa-venc">Vencimento</label><input type="date" id="cx-fa-venc" value="${somarDias(data, prazo)}"></div>
        <div class="form-group"><label for="cx-fa-obs">Observação (opcional)</label><input type="text" id="cx-fa-obs" maxlength="200" placeholder="Ex: compras de setembro"></div>
      </div>
      <button type="submit" class="btn-icon">+ Lançar fiado anterior</button>
    </form>
  </section>`;

  if (editando) {
    $("cx-abertura").addEventListener("submit", salvarAbertura);
    $("cx-abertura").addEventListener("input", lerRascunho);
    $("cx-ab-cancelar")?.addEventListener("click", () => { estado.refazer = false; limparRascunho(); renderAbertura(el); });
    $("cx-ab-data").addEventListener("change", () => { lerRascunho(); renderAbertura(el); });
    $("cx-ab-cheque").addEventListener("submit", lancarCheque);
  } else {
    $("cx-refazer").addEventListener("click", () => { estado.refazer = true; renderAbertura(el); });
  }
  $("cx-ab-fiado").addEventListener("submit", lancarFiado);
  // Conta corrente esconde o vencimento; cliente já marcado no cadastro vem marcado
  const mostrarVenc = () => { $("cx-fa-venc-grupo").hidden = $("cx-fa-cc").checked; };
  $("cx-fa-cc").addEventListener("change", mostrarVenc);
  $("cx-fa-cliente").addEventListener("change", (e) => { if (window.Clientes?.ehContaCorrente(e.target.value)) { $("cx-fa-cc").checked = true; mostrarVenc(); } });
  mostrarVenc();
  el.querySelectorAll("[data-ab-remover]").forEach((b) => b.addEventListener("click", () => C().excluir(b.dataset.abRemover)));
}

function lerRascunho() {
  if (!$("cx-abertura")) return;
  Object.assign(rascunho, { data: $("cx-ab-data").value, gaveta: $("cx-ab-gaveta").value, bradesco: $("cx-ab-bradesco").value, picpay: $("cx-ab-picpay").value, obs: $("cx-ab-obs").value });
}
function limparRascunho() { for (const k of Object.keys(rascunho)) delete rascunho[k]; }

async function lancarCheque(e) {
  e.preventDefault();
  if (!C().podeGravar()) return;
  lerRascunho();
  const data = dataDaAbertura(C().saldos?.abertura, true);
  const valor = num($("cx-ch-valor").value);
  if (!(valor > 0)) return alert("Informe o valor do cheque.");
  const comp = $("cx-ch-comp").value;
  if (!comp) return alert("Informe a data de compensação.");
  const nomeCli = $("cx-ch-cliente").value.trim();
  const cli = nomeCli ? (window.Clientes?.lista || []).find((c) => c.nome.trim().toLowerCase() === nomeCli.toLowerCase()) : null;
  const item = {
    id: C().novoId("CA"), v: 2, conta: "cheque_anterior", value: valor, competencia: data,
    pagamentos: [{ forma: "cheque", valor, cheque: { numero: $("cx-ch-numero").value.trim(), emissor: $("cx-ch-emissor").value.trim(), banco: $("cx-ch-banco").value.trim(), compensacao: comp } }],
  };
  if (nomeCli) item.cliente = cli?.nome || nomeCli;
  if (cli) item.clienteId = cli.id;
  await C().gravar([item]);
}

async function lancarFiado(e) {
  e.preventDefault();
  if (!C().podeGravar()) return;
  lerRascunho();
  const ab = C().saldos?.abertura || null;
  const data = dataDaAbertura(ab, !ab || estado.refazer);
  const valor = num($("cx-fa-valor").value);
  if (!(valor > 0)) return alert("Informe o valor devido.");
  const contaCorrente = $("cx-fa-cc").checked;
  const venc = contaCorrente ? "" : $("cx-fa-venc").value;
  if (!contaCorrente && !venc) return alert("Informe o vencimento (ou marque Conta corrente).");
  const obs = $("cx-fa-obs").value.trim();
  const desde = $("cx-fa-desde").value;
  if (desde && desde > data) return alert(`"Desde" é a data da via mais antiga: não pode ser depois da abertura (${dataBR(data)}).`);
  const cli = await window.Clientes.garantir($("cx-fa-cliente").value);
  if (!cli) return;
  // Mesmo cliente com outro Fiado anterior: confirma antes de somar (evita lançar duas vezes)
  const ja = C().itens.filter((l) => l.conta === "fiado_anterior" && !l.excluido && String(l.clienteId) === String(cli.id));
  if (ja.length) {
    const soma = ja.reduce((s, l) => s + Math.round(l.value * 100), 0) / 100;
    if (!confirm(`${cli.nome} já tem um Fiado anterior de ${moeda(soma)}${ja.length > 1 ? ` (${ja.length} lançamentos)` : ""}. Somar mesmo assim?\n\nNovo: ${moeda(valor)} → total ${moeda(soma + valor)}.`)) return;
  }
  // Marca o cliente como conta corrente no cadastro (mantém telefone, observação e alertas)
  const cad = window.Clientes.porId(cli.id);
  if (contaCorrente && !cad?.contaCorrente) {
    try {
      await window.Clientes.salvar({ id: cli.id, nome: cad?.nome || cli.nome, telefone: cad?.telefone || "", obs: cad?.obs || "", contaCorrente: true });
    } catch (err) {
      return alert(`O cliente não foi marcado como conta corrente: ${err.message}`);
    }
  }
  const item = { id: C().novoId("FA"), v: 2, conta: "fiado_anterior", value: valor, competencia: data, clienteId: cli.id, cliente: cli.nome,
    description: obs ? `Fiado anterior (pasta): ${obs}` : "Fiado anterior (pasta)" };
  if (contaCorrente) item.contaCorrente = true; else item.vencimento = venc;
  if (desde) item.desde = desde;
  await C().gravar([item]);
}

async function salvarAbertura(e) {
  e.preventDefault();
  if (C().somenteLeitura) return alert("Sem conexão com a nuvem. Nada foi salvo.");
  const data = $("cx-ab-data").value;
  const ca = chequesNaAbertura(C().itens, C().configFinanceiro, data);
  const contas = { gaveta: num($("cx-ab-gaveta").value) ?? 0, bradesco: num($("cx-ab-bradesco").value) ?? 0, picpay: num($("cx-ab-picpay").value) ?? 0, cheques_carteira: ca.total };
  if (!confirm(`Salvar a abertura de ${dataBR(data)}?\n\nGaveta ${moeda(contas.gaveta)}\nBradesco ${moeda(contas.bradesco)}\nPicPay ${moeda(contas.picpay)}\nCheques em carteira ${moeda(contas.cheques_carteira)} (${ca.doSistema.length + ca.naAbertura.length} cheque(s))`)) return;
  try {
    await postar({ abertura: { data, contas, obs: $("cx-ab-obs").value.trim() } });
  } catch (err) {
    return alert(`A abertura não foi salva: ${err.message}`);
  }
  estado.refazer = false;
  limparRascunho();
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

function renderCheques(el) {
  alvos.cheques = el;
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

  $("ch-f-rec").addEventListener("change", (e) => { estado.filtroRecebidos = e.target.value; renderCheques(el); });
  $("ch-f-emi").addEventListener("change", (e) => { estado.filtroEmitidos = e.target.value; renderCheques(el); });
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
  saldos: renderSaldos,
  cheques: renderCheques,
  fluxo: renderFluxo,
  abertura: renderAbertura,
};
