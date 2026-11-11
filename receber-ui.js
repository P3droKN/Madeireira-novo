// Caixa › A receber (fiado): quanto cada cliente deve, atrasos, receber (total ou parcial),
// cobrar no WhatsApp; o cadastro fica em Clientes e Orçamentos › Clientes (aqui só o link "abrir ficha").
// Relatórios › A receber (para imprimir). "Sem prazo" é o cliente que acerta quando juntar (no código, contaCorrente).
import { contasAReceber, abertasDoCliente, textoCobrancaFiado } from "./lib/receber.js";
import { cheques } from "./lib/caixa.js";
import { linkWhatsApp, normalizarTelefone, somarDias } from "./lib/orcamentos.js";
import { criarEditorPagamentos } from "./pagamentos.js";
import { hojeSP } from "./lib/datas.js";
import { FORMAS_PADRAO } from "./lib/planoContas.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const moeda = (v) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v || 0);
const dataBR = (d) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "—");
const num = (v) => (v === "" || v == null ? null : Number(String(v).replace(",", ".")));
const C = () => window.Caixa;
const hoje = () => C()?.hoje() || hojeSP();
const centavos = (v) => Math.round(Number(v || 0) * 100);

const estado = { busca: "", quitados: false, ficha: null, verPagos: false, atual: null, editor: null, el: null };

// Trava o botão do formulário enquanto grava: clique duplo não lança duas vezes
const travar = (fn) => async (e) => {
  e.preventDefault();
  const botao = e.target.querySelector("button[type=submit]");
  if (botao?.disabled) return;
  if (botao) botao.disabled = true;
  try { await fn(e); } finally { if (botao) botao.disabled = false; }
};

// ---------- Lista por cliente (Caixa › A receber, e "Devendo" na aba Clientes, inclusive do funcionário) ----------
// Uma linha por cliente, do maior valor em aberto para o menor: em aberto, quantos pedidos, desde quando,
// último pagamento e o alerta. Clicar na linha abre a ficha do fiado (pedidos em aberto e pagamentos).

const confere = (nome, tel) => {
  const b = estado.busca.trim().toLowerCase();
  if (!b) return true;
  const dig = b.replace(/\D/g, "");
  return String(nome || "").toLowerCase().includes(b) || (dig.length >= 3 && String(tel || "").replace(/\D/g, "").includes(dig));
};

const etiquetas = (c) => [
  c.contaCorrente ? '<span class="tag tag-cc">sem prazo</span>' : "",
  c.atrasado > 0 ? `<span class="tag tag-menos">atrasado ${c.maiorAtraso} ${c.maiorAtraso === 1 ? "dia" : "dias"}</span>` : "",
  c.credito > 0 ? `<span class="tag tag-mais">crédito ${moeda(c.credito)}</span>` : "",
].join(" ");

/** HTML da lista. clientes: os do contasAReceber; opções: { quitados } */
function listaHtml(r, { quitados = false } = {}) {
  const lista = r.porCliente.filter((c) => (quitados || c.aberto > 0 || c.credito > 0) && confere(c.cliente, c.telefone))
    .sort((a, b) => b.aberto - a.aberto || a.cliente.localeCompare(b.cliente));
  return `<div class="table-container"><table class="tabela-fin tabela-receber" id="rc-tabela">
    <thead><tr><th>Cliente</th><th class="num">Em aberto</th><th class="num">Pedidos</th><th>Desde</th><th>Último pagamento</th><th>Alerta</th><th></th></tr></thead>
    <tbody>${lista.map((c) => {
      const tel = normalizarTelefone(c.telefone);
      return `<tr class="linha-clicavel ${c.atrasado > 0 ? "cor-vermelho" : c.alertas.length ? "cor-alerta" : ""}" data-chave="${esc(c.chave)}">
        <td><strong>${esc(c.cliente)}</strong> ${etiquetas(c)}<small>${esc(c.telefone || (c.clienteId ? "sem WhatsApp" : "sem cadastro"))}</small></td>
        <td class="num"><strong>${moeda(c.aberto)}</strong></td>
        <td class="num">${c.pedidosEmAberto || "—"}</td>
        <td>${c.emAbertoDesde ? `desde ${dataBR(c.emAbertoDesde).slice(0, 5)}<small>${c.diasEmAberto} dia(s)</small>` : "—"}</td>
        <td>${c.ultimoPagamento ? `${dataBR(c.ultimoPagamento)}<small>${moeda(c.ultimoPagamentoValor)}</small>` : "—"}</td>
        <td>${c.alertas.map((a) => `<span class="tag tag-alerta">⚠ ${esc(a.texto)}</span>`).join(" ") || (c.contaCorrente ? `<small class="texto-suave">${textoAlerta(c)}</small>` : "")}</td>
        <td class="orc-acoes">${c.aberto > 0 ? `<button class="btn-icon mini destaque-verde" data-rc="receber">Receber</button>` : ""}
          ${c.aberto > 0 && tel.ok ? `<button class="btn-icon mini" data-rc="cobrar">Cobrar 💬</button>` : ""}</td>
      </tr>`;
    }).join("") || `<tr><td colspan="7" class="texto-suave">${estado.busca ? "Nenhum cliente com essa busca." : "Ninguém devendo. As vendas em Fiado aparecem aqui."}</td></tr>`}</tbody>
  </table></div>`;
}

// Alerta configurado (em branco = sem alerta)
const textoAlerta = (c) => [c.alertaLimite != null ? `limite ${moeda(c.alertaLimite)}` : "", c.alertaDias != null ? `${c.alertaDias} dias sem pagar` : ""].filter(Boolean).join(" · ") || "sem alerta";

// Venda com itens que dá para imprimir de novo (as 2 vias)
const vendaDa = (d) => (d.tipo === "fiado" ? C().itens.find((l) => String(l.id) === String(d.origemId) && l.conta === "venda_produtos") : null);

// ---------- Ficha do fiado do cliente ----------

const nomeDivida = (d) => d.tipo === "fiado_anterior" ? `Saldo anterior à virada (desde ${dataBR(d.data).slice(0, 5)})`
  : d.tipo === "cheque_devolvido" ? d.descricao : vendaDa(d)?.numero || d.descricao;
const situacaoDivida = (d) => d.estado === "pago" ? '<span class="tag tag-mais">pago</span>'
  : `${d.estado === "parcial" ? '<span class="tag">pago em parte</span>' : '<span class="tag tag-cc">em aberto</span>'}${d.situacao === "atrasado" ? ` <span class="tag tag-menos">atrasado ${d.diasAtraso} ${d.diasAtraso === 1 ? "dia" : "dias"}</span>` : d.vencimento && d.situacao === "a_vencer" ? ` <small class="texto-suave">vence ${dataBR(d.vencimento)}</small>` : ""}`;
// Cheque: em carteira · compensado · devolvido (pela data "bom para")
const situacaoCheque = (ch) => ch.devolvidoEm ? "devolvido" : ch.compensacao && ch.compensacao <= hoje() ? "compensado" : "em carteira";

/** Pedidos em aberto (ou todos, com verPagos) e o histórico de pagamentos do cliente. */
function fichaFiadoHtml(c, { verPagos = false } = {}) {
  const porData = [...c.dividas].sort((a, b) => a.data.localeCompare(b.data) || String(a.origemId).localeCompare(String(b.origemId)));
  const visiveis = porData.filter((d) => verPagos || d.estado !== "pago");
  const nPagos = porData.filter((d) => d.estado === "pago").length;
  const nomePorOrigem = new Map(c.dividas.map((d) => [String(d.origemId) + "|" + d.tipo, d]));
  const quitouTxt = (r) => {
    const partes = r.quitou.map((q) => {
      const d = nomePorOrigem.get(String(q.origemId) + "|" + q.tipo);
      const nome = d ? (d.tipo === "fiado_anterior" ? "saldo anterior" : nomeDivida(d)) : "pedido";
      return d && q.valor < d.valor ? `parte da ${esc(nome)} (${moeda(q.valor)})` : `${esc(nome)} (${moeda(q.valor)})`;
    });
    const sobra = Math.round((r.valor - r.quitou.reduce((s, q) => s + q.valor, 0)) * 100) / 100;
    if (sobra > 0) partes.push(`crédito ${moeda(sobra)}`);
    return partes.join(", ");
  };
  const formasTxt = (r) => {
    const chs = r.pagamentos.filter((p) => p.forma === "cheque");
    const outras = r.pagamentos.filter((p) => p.forma !== "cheque").map((p) => `${nomeForma(p.forma)} ${moeda(p.valor)}`);
    return [chs.length ? `${chs.length === 1 ? "1 cheque" : `${chs.length} cheques`} ${moeda(chs.reduce((s, p) => s + p.valor, 0))}` : "", ...outras].filter(Boolean).join(" + ");
  };
  const cheques = (r) => r.pagamentos.filter((p) => p.forma === "cheque").map((p) => {
    const ch = p.cheque || {};
    return `<li>Cheque ${ch.numero ? `nº ${esc(ch.numero)} ` : ""}${moeda(p.valor)} · bom para ${dataBR(ch.compensacao)}${ch.banco ? ` · ${esc(ch.banco)}` : ""}${ch.emissor ? ` · ${esc(ch.emissor)}` : ""} · <strong>${situacaoCheque(ch)}</strong></li>`;
  }).join("");
  return `<div class="rc-ficha-fiado" data-chave="${esc(c.chave)}">
    <div class="table-container"><table class="tabela-fin" id="rc-pedidos">
      <thead><tr><th>Pedido</th><th>Data</th><th class="num">Valor</th><th class="num">Pago</th><th class="num">Falta</th><th>Situação</th><th></th></tr></thead>
      <tbody>${visiveis.map((d) => `<tr class="${d.estado === "pago" ? "linha-paga" : ""}"><td><strong>${esc(nomeDivida(d))}</strong></td><td>${dataBR(d.data)}</td>
        <td class="num">${moeda(d.valor)}</td><td class="num">${d.pago ? moeda(d.pago) : "—"}</td><td class="num"><strong>${d.aberto ? moeda(d.aberto) : "—"}</strong></td>
        <td>${situacaoDivida(d)}</td>
        <td>${vendaDa(d) ? `<button class="btn-icon mini" data-rc-via="${esc(d.origemId)}" title="Imprimir as vias deste pedido">🖨 Vias</button> <button class="btn-icon mini so-dono" data-rc-corrigir="${esc(d.origemId)}" title="Abrir a venda de volta para corrigir (mantém o número)">Corrigir</button>` : ""}</td></tr>`).join("")
        || `<tr><td colspan="7" class="texto-suave">${c.dividas.length ? "Nenhum pedido em aberto." : "Sem compras no fiado."}</td></tr>`}</tbody>
    </table></div>
    ${nPagos ? `<button type="button" class="link-suave" data-rc="pagos">${verPagos ? "Esconder pedidos pagos" : `Ver pedidos pagos (${nPagos})`}</button>` : ""}
    <h4>Pagamentos</h4>
    <div class="table-container"><table class="tabela-fin" id="rc-pagamentos-hist">
      <thead><tr><th>Data</th><th class="num">Valor</th><th>Forma</th><th>Recebeu</th><th>Quitou</th><th></th></tr></thead>
      <tbody>${[...c.recebimentos].reverse().map((r) => `<tr><td>${dataBR(r.data)}</td><td class="num"><strong>${moeda(r.valor)}</strong></td>
        <td>${esc(formasTxt(r))}${cheques(r) ? `<ul class="rc-cheques">${cheques(r)}</ul>` : ""}${r.descricao && !/^Recebimento de /.test(r.descricao) ? `<small>${esc(r.descricao)}</small>` : ""}</td>
        <td>${esc(r.recebidoPor || "—")}</td><td><small>${quitouTxt(r) || "—"}</small></td>
        <td><button class="delete-btn so-dono" data-rc-estornar="${esc(r.id)}" title="Desfazer este recebimento (a dívida volta)">Estornar</button></td></tr>`).join("")
        || '<tr><td colspan="6" class="texto-suave">Nenhum pagamento ainda.</td></tr>'}</tbody>
    </table></div>
  </div>`;
}

// Cabeçalho da ficha no Caixa › A receber (na aba Clientes, o cabeçalho é o da própria ficha do cliente)
function fichaCaixaHtml(c) {
  const tel = normalizarTelefone(c.telefone);
  return `<section class="glass-panel ficha-fiado">
    <div class="painel-titulo">
      <div><h2>${esc(c.cliente)} ${etiquetas(c)}</h2>
        <small class="texto-suave">em aberto <strong>${moeda(c.aberto)}</strong> · ${c.pedidosEmAberto} ${c.pedidosEmAberto === 1 ? "pedido" : "pedidos"}${c.emAbertoDesde ? ` · desde ${dataBR(c.emAbertoDesde)}` : ""}${c.contaCorrente ? ` · alerta: ${esc(textoAlerta(c))}` : ""}</small>
        ${c.alertas.length ? `<div>${c.alertas.map((a) => `<span class="tag tag-alerta">⚠ ${esc(a.texto)}</span>`).join(" ")}</div>` : ""}</div>
      <button type="button" class="btn-icon" data-rc="voltar">← A receber</button>
    </div>
    <div class="ficha-acoes">
      ${c.aberto > 0 ? '<button type="button" class="btn-icon destaque-verde" data-rc="receber">Receber</button>' : ""}
      ${c.aberto > 0 && tel.ok ? '<button type="button" class="btn-icon" data-rc="cobrar">Cobrar no WhatsApp 💬</button>' : ""}
      ${c.clienteId ? `<button type="button" class="link-suave" data-rc-ficha="${esc(c.clienteId)}">Abrir cadastro do cliente ›</button>` : '<span class="texto-suave">Cliente sem cadastro: cadastre em Clientes e Orçamentos › Clientes para definir o prazo e os alertas.</span>'}
    </div>
    ${fichaFiadoHtml(c, { verPagos: estado.verPagos })}
  </section>`;
}

// ---------- Caixa › A receber ----------

function calcular() {
  const r = contasAReceber(C().itens, C().configFinanceiro, hoje(), window.Clientes?.lista || []);
  const ch = cheques(C().itens, C().configFinanceiro, hoje()).recebidos.filter((c) => c.situacao === "a_compensar");
  const carteira = ch.reduce((s, c) => s + centavos(c.valor), 0) / 100;
  return { r, carteira, chequesCarteira: ch, naRua: Math.round((r.totalAberto + carteira) * 100) / 100 };
}

function render(el) {
  estado.el = el;
  if (!C()) return;
  if (!window.Clientes?.lista?.length && !estado.pediuClientes) {
    estado.pediuClientes = true;
    window.Clientes?.carregar().then(() => render(el));
  }
  const { r, carteira, naRua } = calcular();
  const ficha = estado.ficha ? r.porCliente.find((c) => c.chave === estado.ficha) : null;
  if (ficha) { el.innerHTML = `<div class="rc-comp" data-ctx="caixa">${fichaCaixaHtml(ficha)}</div>`; return; }
  estado.ficha = null;
  const atrasados = r.porCliente.filter((c) => c.atrasado > 0).length;
  el.innerHTML = `
  <div class="saldos-grid receber-cards">
    <div class="total-bloco"><span>A receber</span><strong>${moeda(r.totalAberto)}</strong><small class="texto-suave">${r.porCliente.filter((c) => c.aberto > 0).length} cliente(s)</small>${r.totalContaCorrente ? `<small class="texto-suave">sem prazo ${moeda(r.totalContaCorrente)}</small>` : ""}</div>
    <div class="total-bloco"><span>Atrasado</span><strong class="${r.totalAtrasado ? "type-expense" : ""}">${moeda(r.totalAtrasado)}</strong><small class="texto-suave">${atrasados} cliente(s) com atraso</small></div>
    <div class="total-bloco"><span>Cheques em carteira</span><strong>${moeda(carteira)}</strong><small class="texto-suave">a compensar</small></div>
    <div class="total-bloco destaque"><span>Total na rua</span><strong>${moeda(naRua)}</strong><small class="texto-suave">fiado + cheques em carteira</small></div>
  </div>
  <section class="glass-panel rc-comp" data-ctx="caixa">
    <div class="painel-titulo receber-topo">
      <h2>A receber por cliente</h2>
      <input type="search" id="rc-busca" class="orc-busca" placeholder="🔎 nome ou telefone" value="${esc(estado.busca)}" aria-label="Buscar cliente">
    </div>
    <label class="check texto-suave"><input type="checkbox" id="rc-quitados" ${estado.quitados ? "checked" : ""}> Mostrar também quem já pagou tudo</label>
    <div id="rc-conteudo">${listaHtml(r, { quitados: estado.quitados })}</div>
    <p class="texto-suave">Clique no cliente para ver os pedidos em aberto e os pagamentos.</p>
  </section>`;
  el.querySelector("#rc-busca").addEventListener("input", (e) => { estado.busca = e.target.value; $("rc-conteudo").innerHTML = listaHtml(calcular().r, { quitados: estado.quitados }); });
  $("rc-quitados").addEventListener("change", (e) => { estado.quitados = e.target.checked; $("rc-conteudo").innerHTML = listaHtml(calcular().r, { quitados: estado.quitados }); });
}

// Aba Clientes › Devendo (dono e funcionário): a mesma lista; clicar abre a ficha do cliente
function devendoHtml(busca) {
  estado.busca = busca || "";
  const r = contasAReceber(C()?.itens || [], C()?.configFinanceiro, hoje(), window.Clientes?.lista || []);
  return `<div class="rc-comp" data-ctx="clientes"><p class="texto-suave">A receber: <strong>${moeda(r.totalAberto)}</strong> · ${r.porCliente.filter((c) => c.aberto > 0).length} cliente(s)</p>${listaHtml(r)}</div>`;
}
// Ficha do cliente (aba Clientes): os pedidos em aberto e os pagamentos do fiado dele
function fichaDoCliente(clienteId, { verPagos = false } = {}) {
  const r = contasAReceber(C()?.itens || [], C()?.configFinanceiro, hoje(), window.Clientes?.lista || []);
  const c = r.porCliente.find((x) => String(x.clienteId) === String(clienteId));
  return c ? { c, html: `<div class="rc-comp" data-ctx="clientes">${fichaFiadoHtml(c, { verPagos })}</div>` } : null;
}

// Os mesmos nomes de forma do resto do sistema
const NOMES_FORMA = Object.fromEntries(FORMAS_PADRAO.map((f) => [f.id, f.nome.replace(/\s*\(.*\)$/, "")]));
const nomeForma = (f) => NOMES_FORMA[f] || f;

// ---------- Receber ----------

// O saldo do cliente é lido do servidor na hora de receber (outro aparelho pode ter recebido ou vendido fiado)
const ultimoRecebimentoDe = (clienteId) => (C().itens || []).filter((l) => l.conta === "recebimento" && String(l.clienteId || "") === String(clienteId || ""))
  .reduce((m, l) => (String(l.criadoEm || "") > m ? String(l.criadoEm) : m), "");
function situacaoAtual(c) {
  const r = contasAReceber(C().itens, C().configFinanceiro, hoje(), window.Clientes?.lista || []);
  return r.porCliente.find((x) => (c.clienteId ? String(x.clienteId) === String(c.clienteId) : x.cliente === c.cliente)) || { ...c, aberto: 0, atrasado: 0, dividas: [] };
}
async function abrirReceber(c0) {
  if (C().somenteLeitura) return alert("Sem conexão com a nuvem. Nada pode ser lançado.");
  try { await C().recarregar(); } catch { /* sem conexão: o aviso aparece ao gravar */ }
  if (C().somenteLeitura) return alert("Sem conexão com a nuvem. Nada pode ser lançado.");
  const c = situacaoAtual(c0);
  estado.ultimoVisto = ultimoRecebimentoDe(c.clienteId);
  estado.atual = c;
  estado.idReceb = null; // recebimento novo; numa nova tentativa (falha de internet) o mesmo identificador
  const abertas = c.dividas.filter((d) => d.aberto > 0);
  $("rc-receber-titulo").textContent = `Receber de ${c.cliente}`;
  $("rc-receber-info").innerHTML = `Em aberto: <strong>${moeda(c.aberto)}</strong>${c.atrasado ? ` · atrasado ${moeda(c.atrasado)}` : ""}${c.contaCorrente && c.aberto ? ` · sem prazo, em aberto há ${c.diasEmAberto} dia(s)` : ""}`;
  $("rc-valor").value = c.aberto.toFixed(2);
  $("rc-data").value = hoje();
  $("rc-desc").value = "";
  $("rc-abater").innerHTML = `<option value="">Automático: as mais antigas primeiro</option>${abertas.map((d) =>
    `<option value="${esc(d.origemId)}">${dataBR(d.data)} · ${esc(d.descricao).slice(0, 50)} · em aberto ${moeda(d.aberto)}</option>`).join("")}`;
  estado.editor = criarEditorPagamentos($("rc-pagamentos"), { total: c.aberto, semFiado: true });
  $("modal-receber").style.display = "flex";
  $("rc-valor").focus();
}

function fecharReceber() { $("modal-receber").style.display = "none"; }

async function salvarRecebimento(e) {
  e.preventDefault();
  const c = estado.atual;
  const valor = num($("rc-valor").value);
  if (!(valor > 0)) return alert("Informe o valor recebido.");
  let pagamentos;
  try { pagamentos = estado.editor.ler(); } catch (err) { return alert(err.message); }
  if (!C().podeGravar()) return;
  if (valor > c.aberto + 0.005 && !confirm(`O valor (${moeda(valor)}) é maior que o que ${c.cliente} deve (${moeda(c.aberto)}). A diferença fica de crédito. Continuar?`)) return;
  const item = {
    id: (estado.idReceb ||= C().novoId("R")), v: 2, conta: "recebimento", value: Math.round(valor * 100) / 100, competencia: $("rc-data").value || hoje(),
    clienteId: c.clienteId, cliente: c.cliente, pagamentos, description: $("rc-desc").value.trim() || `Recebimento de ${c.cliente}`,
  };
  if ($("rc-abater").value) item.vendaIds = [$("rc-abater").value];
  item.ultimoRecebimentoVisto = estado.ultimoVisto || "";
  let gravou = false;
  for (let tentativa = 0; tentativa < 3 && !gravou; tentativa++) {
    try {
      await window.api("/api/lancamento", { method: "POST", body: { itens: [item] } });
      gravou = true;
    } catch (err) {
      // Outro aparelho recebeu deste cliente depois que esta tela leu o saldo: mostra o saldo novo e pergunta
      if (err.dados?.recebidoRecente) {
        await C().recarregar();
        const agora = situacaoAtual(c);
        if (!confirm(`${err.message}\n\nEm aberto agora: ${moeda(err.dados.aberto ?? agora.aberto)}.\nReceber mais ${moeda(valor)} de ${c.cliente}?`)) {
          fecharReceber();
          window.ClientesUI?.atualizar?.();
          return;
        }
        item.ultimoRecebimentoVisto = estado.ultimoVisto = err.dados.ultimoRecebimento || ultimoRecebimentoDe(c.clienteId);
        item.confirmarOutro = true;
        c.aberto = err.dados.aberto ?? agora.aberto;
        continue;
      }
      alert(`Não foi salvo: ${err.message}`);
      return;
    }
  }
  if (gravou) {
    await C().recarregar();
    estado.idReceb = null;
    fecharReceber();
    const resta = Math.max(0, Math.round((c.aberto - valor) * 100) / 100);
    alert(`Recebido ${moeda(valor)} de ${c.cliente}.${resta ? `\nAinda em aberto: ${moeda(resta)}.` : "\nQuitado!"}${pagamentos.some((p) => p.forma === "cheque") ? "\nO cheque foi para a carteira (Caixa › Cheques)." : ""}`);
  }
}

function cobrar(c) {
  const texto = textoCobrancaFiado(c, hoje());
  try {
    window.open(linkWhatsApp(c.telefone, texto), "_blank", "noopener");
  } catch (err) {
    alert(err.message);
  }
}

// ---------- Relatórios › A receber ----------

function relatorio(el) {
  if (!C()) return;
  const { r, carteira, chequesCarteira, naRua } = calcular();
  const em30 = somarDias(hoje(), 30);
  const ch30 = chequesCarteira.filter((c) => c.compensacao <= em30);
  const lista = r.porCliente.filter((c) => c.aberto > 0 && !c.contaCorrente);
  const cc = r.porCliente.filter((c) => c.aberto > 0 && c.contaCorrente);
  el.innerHTML = `
  <section class="glass-panel">
    <div class="painel-titulo"><h2>Sem prazo</h2><span class="texto-suave">posição de ${dataBR(hoje())} · acerta quando juntar</span></div>
    <div class="table-container"><table class="tabela-fin">
      <thead><tr><th>Cliente</th><th>WhatsApp</th><th class="num">Em aberto</th><th>Em aberto há</th><th>Último pagamento</th><th>Alerta</th></tr></thead>
      <tbody>${cc.map((c) => `<tr><td>${esc(c.cliente)}</td><td>${esc(c.telefone || "—")}</td><td class="num">${moeda(c.aberto)}</td>
        <td>${c.diasEmAberto} dia(s) (desde ${dataBR(c.emAbertoDesde)})</td><td>${c.ultimoPagamento ? dataBR(c.ultimoPagamento) : "—"}</td>
        <td>${c.alertas.map((a) => `⚠ ${esc(a.texto)}`).join("; ") || "—"}</td></tr>`).join("")
        || '<tr><td colspan="6" class="texto-suave">Nenhum cliente sem prazo em aberto.</td></tr>'}</tbody>
      <tfoot><tr class="dre-total"><td colspan="2">Total sem prazo</td><td class="num">${moeda(r.totalContaCorrente)}</td><td colspan="3"></td></tr></tfoot>
    </table></div>
  </section>
  <section class="glass-panel">
    <div class="painel-titulo"><h2>Fiado com prazo</h2><span class="texto-suave">posição de ${dataBR(hoje())}</span></div>
    <div class="table-container"><table class="tabela-fin">
      <thead><tr><th>Cliente</th><th>WhatsApp</th><th class="num">Em aberto</th><th class="num">Atrasado</th><th class="num">Maior atraso</th><th>Próximo vencimento</th></tr></thead>
      <tbody>${lista.map((c) => `<tr><td>${esc(c.cliente)}</td><td>${esc(c.telefone || "—")}</td><td class="num">${moeda(c.aberto)}</td>
        <td class="num">${c.atrasado ? moeda(c.atrasado) : "—"}</td><td class="num">${c.maiorAtraso ? `${c.maiorAtraso} dia(s)` : "—"}</td><td>${c.proximoVencimento ? dataBR(c.proximoVencimento) : "—"}</td></tr>`).join("")
        || '<tr><td colspan="6" class="texto-suave">Nada a receber.</td></tr>'}</tbody>
      <tfoot><tr class="dre-total"><td colspan="2">Total com prazo</td><td class="num">${moeda(r.totalComVencimento)}</td><td class="num">${moeda(r.totalAtrasado)}</td><td colspan="2"></td></tr></tfoot>
    </table></div>
  </section>
  <section class="glass-panel">
    <div class="painel-titulo"><h2>Cheques a compensar nos próximos 30 dias</h2></div>
    <div class="table-container"><table class="tabela-fin">
      <thead><tr><th>Compensa em</th><th>Nº</th><th>Emissor / cliente</th><th class="num">Valor</th></tr></thead>
      <tbody>${ch30.map((c) => `<tr><td>${dataBR(c.compensacao)}</td><td>${esc(c.numero || "—")}</td><td>${esc(c.emissor || c.cliente || "—")}</td><td class="num">${moeda(c.valor)}</td></tr>`).join("")
        || '<tr><td colspan="4" class="texto-suave">Nenhum cheque a compensar nos próximos 30 dias.</td></tr>'}</tbody>
    </table></div>
  </section>
  <div class="saldos-grid">
    <div class="total-bloco"><span>Fiado em aberto</span><strong>${moeda(r.totalAberto)}</strong></div>
    <div class="total-bloco"><span>Cheques em carteira</span><strong>${moeda(carteira)}</strong></div>
    <div class="total-bloco destaque"><span>Total na rua</span><strong>${moeda(naRua)}</strong></div>
  </div>`;
}

// ---------- Eventos ----------

document.addEventListener("click", (e) => {
  const comp = e.target.closest(".rc-comp");
  if (!comp) return;
  const ctx = comp.dataset.ctx;
  const b = e.target.closest("[data-rc], [data-rc-estornar], [data-rc-ficha], [data-rc-via], [data-rc-corrigir]");
  if (b?.dataset.rcFicha) return window.ClientesUI?.abrirFicha(b.dataset.rcFicha);
  if (b?.dataset.rcCorrigir) return window.Vendas?.corrigir(b.dataset.rcCorrigir);
  if (b?.dataset.rcVia) return window.Vendas?.vias(b.dataset.rcVia);
  if (b?.dataset.rcEstornar) {
    if (confirm("Estornar este recebimento? O valor volta a ficar em aberto para o cliente.")) C().excluir(b.dataset.rcEstornar, { confirmado: true });
    return;
  }
  if (b?.dataset.rc === "voltar") { estado.ficha = null; estado.verPagos = false; return render(estado.el); }
  if (b?.dataset.rc === "pagos") {
    if (ctx === "clientes") return window.ClientesUI?.alternarPagos?.();
    estado.verPagos = !estado.verPagos;
    return render(estado.el);
  }
  const chave = e.target.closest("[data-chave]")?.dataset.chave;
  const c = chave && calcular().r.porCliente.find((x) => x.chave === chave);
  if (!c) return;
  if (b?.dataset.rc === "receber") return abrirReceber(c);
  if (b?.dataset.rc === "cobrar") return cobrar(c);
  // clique na linha da lista: abre a ficha do fiado
  if (!b && e.target.closest("#rc-tabela tr[data-chave]")) {
    if (ctx === "clientes") {
      if (c.clienteId) return window.ClientesUI?.abrirFicha(c.clienteId);
      return alert("Cliente sem cadastro: cadastre em Clientes para ver a ficha.");
    }
    estado.ficha = c.chave;
    estado.verPagos = false;
    render(estado.el);
    estado.el?.scrollIntoView({ block: "start" });
  }
});
$("rc-receber-form").addEventListener("submit", travar(salvarRecebimento));
$("rc-receber-cancelar").addEventListener("click", fecharReceber);
$("rc-valor").addEventListener("input", (e) => estado.editor?.definirTotal(num(e.target.value) || 0));

window.ReceberUI = { voltarLista() { estado.ficha = null; estado.verPagos = false; }, render, relatorio, abertasDoCliente, abrirReceber, cobrar, devendoHtml, fichaDoCliente, listaHtml };
