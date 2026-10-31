// --- DATA BASE DA CALCULADORA AGORA VEM DE tabela-precos.js ---


// --- GLOBAL UTILS ---
const formatCurrency = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

// Escapa texto antes de colocar no HTML (descrições vêm do banco e podem conter < > " ')
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const novoId = (sufixo = '') => Date.now().toString() + Math.random().toString(36).slice(2, 6) + sufixo;

// --- API (com senha) ---
const SENHA_KEY = 'madeireira_senha';
let pedidoDeSenha = null;

function pedirSenha(mensagem) {
    if (pedidoDeSenha) return pedidoDeSenha;
    pedidoDeSenha = new Promise(resolve => {
        const modal = document.getElementById('modal-senha');
        const input = document.getElementById('senha-input');
        document.getElementById('senha-msg').textContent = mensagem || 'Digite a senha do sistema.';
        input.value = '';
        modal.style.display = 'flex';
        input.focus();
        document.getElementById('senha-form').onsubmit = (e) => {
            e.preventDefault();
            if (!input.value) return;
            localStorage.setItem(SENHA_KEY, input.value);
            modal.style.display = 'none';
            pedidoDeSenha = null;
            resolve(input.value);
        };
    });
    return pedidoDeSenha;
}

// Sair deste aparelho (ex.: computador do balcão): apaga a senha e a cópia local dos dados
function sairDoAparelho() {
    if (!confirm('Sair deste aparelho? A senha e a cópia dos dados guardadas aqui serão apagadas. Para entrar de novo, é preciso digitar a senha.')) return;
    for (const k of [SENHA_KEY, 'madeireira_finance', 'madeireira_acumulado', 'madeireira_pedido']) {
        try { localStorage.removeItem(k); } catch { /* sem armazenamento */ }
    }
    location.reload();
}
document.getElementById('btn-sair')?.addEventListener('click', sairDoAparelho);

async function api(caminho, { method = 'GET', body, timeoutMs = 60000 } = {}) {
    const senha = localStorage.getItem(SENHA_KEY) || await pedirSenha();
    const controle = new AbortController();
    const relogio = setTimeout(() => controle.abort(), timeoutMs);
    let res;
    try {
        res = await fetch(caminho, {
            method,
            headers: { 'Content-Type': 'application/json', 'x-senha': senha },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: controle.signal,
        });
    } catch (e) {
        throw new Error(e.name === 'AbortError'
            ? `o servidor não respondeu em ${Math.round(timeoutMs / 1000)} segundos`
            : `sem conexão com o servidor (${e.message})`);
    } finally {
        clearTimeout(relogio);
    }
    if (res.status === 429) {
        const d = await res.json().catch(() => null);
        localStorage.removeItem(SENHA_KEY);
        throw new Error(d?.error || 'Muitas tentativas de senha erradas. Espere alguns minutos.');
    }
    if (res.status === 401) {
        localStorage.removeItem(SENHA_KEY);
        await pedirSenha('Senha incorreta. Tente de novo.');
        return api(caminho, { method, body, timeoutMs });
    }
    const dados = await res.json().catch(() => null);
    if (!res.ok) {
        const explicacao = { 504: 'o servidor demorou demais e foi interrompido', 413: 'pedido grande demais', 500: 'erro no servidor' }[res.status];
        throw new Error(dados?.error || `erro ${res.status}${explicacao ? ': ' + explicacao : ''}`);
    }
    return dados || {};
}

// --- ABAS ---
// Vender · Orçamentos · Caixa · Relatórios · Ajustes. O sistema abre em Vender; o Caixa abre em Lançar.
const ABAS = ['vender', 'orcamentos', 'caixa', 'relatorios', 'ajustes'];
function switchTab(tabId) {
    if (!ABAS.includes(tabId)) tabId = 'vender';
    document.querySelectorAll('.tab-content').forEach(el => { el.classList.remove('active'); el.style.display = 'none'; });
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
    document.getElementById(`tab-${tabId}`).style.display = 'block';
    document.getElementById(`tab-${tabId}`).classList.add('active');
    document.getElementById(`btn-tab-${tabId}`).classList.add('active');

    if (tabId === 'orcamentos' && window.Orcamentos) window.Orcamentos.abrir();
    if (['caixa', 'relatorios', 'ajustes'].includes(tabId) && window.Financeiro) window.Financeiro.abrir(tabId);
}

// --- CALCULADORA: ver calculadora.js (módulo) ---

// --- DADOS DO CAIXA (lidos uma vez e usados por todas as abas) ---
let financeItems = [];
let estornados = [];
const ACUMULADO_VAZIO = { venda: 0, pix: 0, credito: 0, debito: 0, custo: 0, despesa: 0, func: 0, dinheiroCaixa: 0 };
let acumulado = { ...ACUMULADO_VAZIO };

// Sem conexão com a nuvem: mostra a última cópia, mas não deixa gravar
// (gravar com dados velhos apagaria lançamentos feitos em outro aparelho).
let somenteLeitura = false;
// Até o backup + migração, os lançamentos ficam na lista antiga, que é regravada inteira.
let migrado = true;
let backupBaixado = false;
let erroConexao = '';
let configFinanceiro = {};
let saldosCaixa = { abertura: null, conferencias: [] };
let migradoV2 = false;
let statusBanco = null;

async function carregarDados() {
    try {
        const data = await api('/api/getFinance');
        financeItems = data.financeItems || [];
        estornados = data.estornados || [];
        acumulado = Object.assign({ ...ACUMULADO_VAZIO }, data.acumulado || {});
        migrado = data.migrado;
        statusBanco = data.status || null;
        configFinanceiro = data.configFinanceiro || {};
        saldosCaixa = data.saldos || { abertura: null, conferencias: [] };
        migradoV2 = Boolean(data.migradoV2);
        somenteLeitura = false;
        erroConexao = '';
        // Cópia local só para leitura quando estiver sem conexão. Se a memória do aparelho encher,
        // o sistema continua normal (só fica sem a cópia)
        try {
            localStorage.setItem('madeireira_finance', JSON.stringify(financeItems));
            localStorage.setItem('madeireira_acumulado', JSON.stringify(acumulado));
        } catch (e) {
            console.warn('Cópia local não coube na memória do aparelho:', e.message);
            try { localStorage.removeItem('madeireira_finance'); } catch { /* sem armazenamento */ }
        }
    } catch (e) {
        console.warn('Sem conexão com a nuvem. Mostrando a última cópia local, sem gravar.', e);
        somenteLeitura = true;
        erroConexao = e.message || String(e);
        try {
            financeItems = JSON.parse(localStorage.getItem('madeireira_finance')) || [];
            acumulado = JSON.parse(localStorage.getItem('madeireira_acumulado')) || { ...ACUMULADO_VAZIO };
        } catch { financeItems = []; acumulado = { ...ACUMULADO_VAZIO }; }
    }
    atualizarAviso();
    atualizarStatusBanco();
    if (window.Financeiro) window.Financeiro.atualizar();
}

// Acesso das abas Caixa, Relatórios e Ajustes (módulos) aos dados carregados aqui
window.Caixa = {
    get itens() { return financeItems; },
    get estornados() { return estornados; },
    get acumulado() { return acumulado; },
    get configFinanceiro() { return configFinanceiro; },
    set configFinanceiro(c) { configFinanceiro = c; },
    get migrado() { return migrado; },
    get migradoV2() { return migradoV2; },
    get saldos() { return saldosCaixa; },
    get somenteLeitura() { return somenteLeitura; },
    podeGravar: () => podeGravar(),
    gravar: (itens) => gravarLancamentos(itens),
    recarregar: () => carregarDados(),
    baixarBackup: () => baixarBackup(),
    excluir: (id, opcoes) => deleteFinanceItem(id, opcoes),
    novoId: (s) => novoId(s),
    hoje: () => getLocalDateString(),
};

function atualizarAviso() {
    const aviso = document.getElementById('aviso-sistema');
    if (somenteLeitura) {
        aviso.className = 'aviso aviso-erro';
        aviso.innerHTML = `<strong>Sem conexão com a nuvem.</strong> Mostrando a última cópia deste aparelho, só para consulta. Nada pode ser lançado até a conexão voltar.
            <br><small>Motivo: ${esc(erroConexao || 'desconhecido')}</small>
            <button class="btn-icon" onclick="carregarDados()">🔄 Tentar de novo</button>`;
        aviso.style.display = 'block';
    } else if (!migrado) {
        aviso.className = 'aviso aviso-alerta';
        aviso.innerHTML = `<strong>Ativar salvamento seguro (uma vez só).</strong> Antes de lançar, baixe o backup e depois ative o salvamento seguro.
            <div class="aviso-acoes">
                <button class="btn-icon" onclick="baixarBackup()">1. 💾 Baixar backup</button>
                <button class="btn-success" onclick="ativarSalvamentoSeguro()" ${backupBaixado ? '' : 'disabled'}>2. Ativar salvamento seguro</button>
            </div>`;
        aviso.style.display = 'block';
    } else {
        aviso.style.display = 'none';
    }
}

function atualizarStatusBanco() {
    const el = document.getElementById('status-banco');
    if (!el) return;
    if (!statusBanco) { el.textContent = ''; return; }
    const partes = [`Banco: ${statusBanco.bancoHost || '—'}`, `ambiente: ${statusBanco.ambiente}`];
    if (statusBanco.prefixo) partes.push(`prefixo: ${statusBanco.prefixo}`);
    partes.push(migrado ? 'salvamento seguro: ativo' : 'salvamento seguro: não ativado');
    if (statusBanco.gravacaoBloqueada) partes.push('⛔ GRAVAÇÃO BLOQUEADA (banco de produção)');
    else if (statusBanco.travaConfigurada) partes.push('trava de produção: ativa');
    if (statusBanco.zerarPermitido) partes.push('⚠️ ZERAR LIGADO (desligar depois da virada)');
    el.textContent = partes.join(' · ');
    el.classList.toggle('texto-ruim', Boolean(statusBanco.gravacaoBloqueada || statusBanco.zerarPermitido));
    document.getElementById('zerar-bloco').hidden = !statusBanco.zerarPermitido;
}

// --- ZERAR BANCO (dia da virada): backup baixado + digitar ZERAR ---
let zerarBackupOk = false;
function atualizarBotaoZerar() {
    document.getElementById('zerar-botao').disabled = !(zerarBackupOk && document.getElementById('zerar-texto').value.trim() === 'ZERAR');
}
document.getElementById('zerar-backup').addEventListener('click', async () => {
    if (await baixarBackup()) {
        zerarBackupOk = true;
        document.getElementById('zerar-backup-ok').textContent = '✓ backup baixado';
        atualizarBotaoZerar();
    }
});
document.getElementById('zerar-texto').addEventListener('input', atualizarBotaoZerar);
document.getElementById('zerar-botao').addEventListener('click', async () => {
    if (!zerarBackupOk || document.getElementById('zerar-texto').value.trim() !== 'ZERAR') return;
    try {
        const r = await api('/api/zerar', { method: 'POST', body: { confirmacao: 'ZERAR' } });
        alert(`Banco zerado.\n\nApagados: lançamentos, acumulado, abertura, clientes e orçamentos.\nMantidos: preços, ajustes da calculadora e configuração financeira.\nCópia do estado anterior: ${r.copia}\n\nPróximo passo: Importar o arquivo do sistema antigo.`);
    } catch (e) {
        alert(`O banco não foi zerado: ${e.message}`);
        return;
    }
    zerarBackupOk = false;
    document.getElementById('zerar-texto').value = '';
    document.getElementById('zerar-backup-ok').textContent = '';
    atualizarBotaoZerar();
    await carregarDados();
    if (window.Orcamentos) window.Orcamentos.recarregar();
    if (window.Clientes) window.Clientes.carregar();
});

function podeGravar() {
    if (somenteLeitura) {
        alert('Sem conexão com a nuvem. Nada foi lançado. Clique em "Tentar de novo" quando a internet voltar.');
        return false;
    }
    if (!migrado) {
        alert('Antes de lançar, baixe o backup e ative o salvamento seguro (aviso no topo da tela).');
        return false;
    }
    return true;
}

// Grava só os lançamentos novos (um por um no servidor) e recarrega a lista,
// trazendo também o que foi lançado em outros aparelhos.
async function gravarLancamentos(itens) {
    try {
        await api('/api/lancamento', { method: 'POST', body: { itens } });
    } catch (e) {
        alert(`Não foi salvo: ${e.message}`);
        return false;
    }
    await carregarDados();
    return true;
}

async function ativarSalvamentoSeguro() {
    if (!backupBaixado) return;
    try {
        const r = await api('/api/migrar', { method: 'POST' });
        alert(r.jaMigrado ? 'O salvamento seguro já estava ativo.' : `Pronto! ${r.migrados} lançamentos copiados para o salvamento seguro.\nA lista antiga foi mantida intacta.`);
    } catch (e) {
        alert(`Não foi possível ativar: ${e.message}`);
    }
    await carregarDados();
}

// Hoje em Brasília (America/Sao_Paulo), mesmo com o relógio do aparelho em outro fuso
function getLocalDateString() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

// A data da venda começa com hoje (YYYY-MM-DD local)
const directSaleDateEl = document.getElementById('direct-sale-date');
if (directSaleDateEl) directSaleDateEl.value = getLocalDateString();

async function deleteFinanceItem(id, { confirmado = false } = {}) {
    if (!podeGravar()) return;
    const item = financeItems.find(i => i.id === id);
    if (!item) return;
    const data = item.competencia || item.date || '';
    const resumo = `${item.numero ? item.numero + ' · ' : ''}${data.split('-').reverse().join('/')} - ${formatCurrency(item.value)}${item.description ? ' - ' + item.description : ''}`;
    if (!confirmado && !confirm(`Estornar este lançamento? Ele sai de todos os totais e fica riscado na lista do dia${item.numero ? ' (o número continua reservado)' : ''}.\n\n${resumo}`)) return;
    let r;
    try {
        r = await api(`/api/lancamento?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    } catch (e) {
        alert(`Não foi estornado: ${e.message}`);
        return;
    }
    await carregarDados();
    if (r && r.orcamentoReaberto) {
        alert(`O orçamento ${r.orcamentoReaberto} voltou para "Em aberto".`);
        if (window.Orcamentos) window.Orcamentos.recarregar();
    }
}

// Registra a venda do pedido da calculadora: um lançamento só, com o custo dos itens (CMV)
// e, por item e no total, preço de tabela, preço final, variação e motivo.
// Trava o botão enquanto grava (clique duplo não duplica a venda) e, se a gravação falhar, a nova
// tentativa usa o mesmo identificador: o servidor reconhece que é a mesma venda.
let vendaPendenteId = null;
let gravandoVenda = false;
async function registerDirectSale(opcoes) {
    if (gravandoVenda) return;
    gravandoVenda = true;
    const botoes = ['btn-registrar-venda', 'btn-registrar-imprimir'].map((id) => document.getElementById(id)).filter(Boolean);
    botoes.forEach((b) => { b.disabled = true; });
    try { await registrarVendaAgora(opcoes); } finally {
        gravandoVenda = false;
        botoes.forEach((b) => { b.disabled = false; });
    }
}

async function registrarVendaAgora(opcoes = {}) {
    const pedido = window.Calculadora && window.Calculadora.resumo();
    if (!pedido || pedido.itens.length === 0) {
        alert("O pedido está vazio. Adicione itens primeiro.");
        return;
    }
    if (pedido.semPreco) {
        alert("Há item sem preço. Digite o preço na linha do item.");
        return;
    }
    if (!(pedido.venda > 0)) {
        alert("O total do pedido precisa ser maior que zero.");
        return;
    }
    let pagamentos;
    try {
        pagamentos = window.Calculadora.pagamentos();
    } catch (e) {
        alert(e.message);
        return;
    }
    if (!podeGravar()) return;

    // Venda no formato novo (v2): conta, competência e formas de pagamento.
    // O frete (opcional) soma no valor e fica separado no campo "frete".
    const frete = pedido.frete || 0;
    // Mesmo pedido de uma tentativa que falhou: mesmo identificador. Pedido diferente: identificador novo
    const assinatura = JSON.stringify([pedido.itens.map((i) => [i.itemId, i.quantidadeCobrada, i.vendaTotal]), pedido.frete || 0]);
    if (!vendaPendenteId || vendaPendenteId.assinatura !== assinatura) vendaPendenteId = { id: novoId('V'), assinatura };
    const vendaItem = {
        id: vendaPendenteId.id,
        v: 2,
        conta: 'venda_produtos',
        value: Math.round((pedido.venda + frete) * 100) / 100,
        competencia: document.getElementById('direct-sale-date').value || getLocalDateString(),
        description: `Venda: ${pedido.descricao}`,
        pagamentos,
        nfe: document.getElementById('calc-nfe').value.trim(),
        origem: 'calculadora',
        cmv: pedido.custo,
        tabelaTotal: pedido.tabela,
        variacao: pedido.variacao,
        motivo: pedido.motivoGeral,
        itens: pedido.itens,
    };
    if (frete) vendaItem.frete = frete;
    const vinculo = window.Calculadora.vinculo();
    if (vinculo && vinculo.modo === 'converter') vendaItem.orcamento = vinculo.id;
    // Corrigir venda: mesmo id (o servidor mantém o número V-000X e guarda o histórico)
    const corrigindo = vinculo && vinculo.modo === 'corrigir' ? vinculo : null;
    if (corrigindo) {
        vendaItem.id = corrigindo.id;
        vendaItem.versaoBase = Number(corrigindo.versaoBase || 0);
        if (corrigindo.orcamento) vendaItem.orcamento = corrigindo.orcamento;
    }
    // Cliente: obrigatório (e cadastrado) no fiado; numa venda de orçamento, vem do orçamento
    if (pagamentos.some((p) => p.forma === 'fiado')) {
        const cli = await window.Clientes.garantir(window.Calculadora.clienteFiado());
        if (!cli) return;
        vendaItem.clienteId = cli.id;
        vendaItem.cliente = cli.nome;
    } else if (vinculo && (vinculo.modo === 'converter' || vinculo.modo === 'corrigir') && vinculo.cliente?.nome) {
        vendaItem.cliente = vinculo.cliente.nome;
        if (vinculo.cliente.id) vendaItem.clienteId = vinculo.cliente.id;
    }
    if (!(await gravarLancamentos([vendaItem]))) return;
    vendaPendenteId = null;

    const margem = ((pedido.venda - pedido.custo) / pedido.venda * 100).toFixed(1).replace('.', ',');
    const fiadoTotal = pagamentos.filter((p) => p.forma === 'fiado').reduce((s, p) => s + p.valor, 0);
    // O orçamento de origem já foi marcado como Fechado pelo servidor, na mesma gravação da venda
    if (vendaItem.orcamento && !corrigindo && window.Orcamentos) window.Orcamentos.recarregar();
    // Janela "Venda V-0012 registrada" com as vias (qualquer forma de pagamento)
    const salva = (window.Caixa?.itens || []).find((l) => String(l.id) === String(vendaItem.id)) || vendaItem;
    const num = salva.numero || '';
    const esc = window.Impressao.esc;
    const linhas = [
        `Total: <strong>${formatCurrency(vendaItem.value)}</strong>${frete ? ` (itens ${formatCurrency(pedido.venda)} + frete ${formatCurrency(frete)})` : ''}`,
        corrigindo ? `Antes da correção: ${formatCurrency(corrigindo.valorAntes)}. O número continua ${esc(num)}.` : '',
        vendaItem.orcamento && !corrigindo ? `Orçamento ${esc(vendaItem.orcamento)} marcado como Fechado.` : '',
        `<span class="sigilo">Custo dos itens (CMV): ${formatCurrency(pedido.custo)} · Margem dos produtos: ${margem}%</span>`,
        fiadoTotal ? `Fiado: ${formatCurrency(fiadoTotal)} a receber de ${esc(vendaItem.cliente)} (Caixa › A receber).` : '',
    ].filter(Boolean);
    window.Calculadora.limpar(false);
    window.Impressao.abrir({ venda: salva, titulo: `Venda ${num} ${corrigindo ? 'corrigida' : 'registrada'}`, mensagem: linhas.map((t) => `<div>${t}</div>`).join(''), imprimirJa: Boolean(opcoes.imprimir) });
}

// --- LOGICA DE ACUMULADOS ---
function openAcumuladoModal() {
    document.getElementById('mod-acc-dinheiro').value = acumulado.dinheiroCaixa || 0;
    document.getElementById('mod-acc-venda').value = acumulado.venda || 0;
    document.getElementById('mod-acc-pix').value = acumulado.pix || 0;
    document.getElementById('mod-acc-credito').value = acumulado.credito || 0;
    document.getElementById('mod-acc-debito').value = acumulado.debito || 0;
    document.getElementById('mod-acc-custo').value = acumulado.custo || 0;
    document.getElementById('mod-acc-despesa').value = acumulado.despesa || 0;
    document.getElementById('mod-acc-func').value = acumulado.func || 0;
    document.getElementById('modal-acumulado').style.display = 'flex';
}

function closeAcumuladoModal() {
    document.getElementById('modal-acumulado').style.display = 'none';
}

async function saveAcumulado() {
    if (somenteLeitura) {
        alert('Sem conexão com a nuvem. Nada foi salvo.');
        return;
    }
    const novo = {
        dinheiroCaixa: parseFloat(document.getElementById('mod-acc-dinheiro').value) || 0,
        venda: parseFloat(document.getElementById('mod-acc-venda').value) || 0,
        pix: parseFloat(document.getElementById('mod-acc-pix').value) || 0,
        credito: parseFloat(document.getElementById('mod-acc-credito').value) || 0,
        debito: parseFloat(document.getElementById('mod-acc-debito').value) || 0,
        custo: parseFloat(document.getElementById('mod-acc-custo').value) || 0,
        despesa: parseFloat(document.getElementById('mod-acc-despesa').value) || 0,
        func: parseFloat(document.getElementById('mod-acc-func').value) || 0,
    };

    try {
        await api('/api/acumulado', { method: 'POST', body: { acumulado: novo } });
        alert("Saldos acumulados salvos com sucesso na nuvem!");
    } catch (e) {
        alert(`Os acumulados não foram salvos: ${e.message}`);
        return;
    }

    closeAcumuladoModal();
    await carregarDados();
}

// --- BACKUP ---
function baixarArquivo(objeto, nome) {
    const blob = new Blob([JSON.stringify(objeto, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = nome;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
}

// Backup completo, direto do servidor (todas as chaves, inclusive excluídos)
async function baixarBackup() {
    try {
        const backup = await api('/api/backup');
        baixarArquivo(backup, `madeireira_backup_${backup.ambiente}_${getLocalDateString()}.json`);
        backupBaixado = true;
        atualizarAviso();
        return true;
    } catch (e) {
        alert(`Não foi possível baixar o backup: ${e.message}`);
        return false;
    }
}

async function exportBackup() {
    if (somenteLeitura) {
        // Sem nuvem: exporta pelo menos a cópia deste aparelho, avisando
        alert(`Sem conexão com a nuvem (${erroConexao || 'motivo desconhecido'}).\n\nVou exportar só a cópia guardada neste aparelho, que pode estar vazia ou desatualizada. Para o backup completo, resolva a conexão e exporte de novo.`);
        baixarArquivo({ financeItems, acumulado }, `madeireira_copia_local_${getLocalDateString()}.json`);
        return;
    }
    await baixarBackup();
}

function lerArquivoJson(event) {
    const file = event.target.files[0];
    event.target.value = ''; // permite escolher o mesmo arquivo de novo
    if (!file) return Promise.resolve(null);
    return file.text().then(JSON.parse).catch(() => {
        alert('Não consegui ler o arquivo. Ele precisa ser um backup .json do sistema.');
        return null;
    });
}

// Importar = JUNTAR: adiciona só os lançamentos que ainda não existem (pelo id). Não apaga nada.
// Vai em lotes, com progresso; se parar no meio, importar o mesmo arquivo de novo continua
// de onde parou, porque o que já entrou é reconhecido e não é duplicado.
const LOTE_IMPORTACAO = 100;

function extrairDoArquivo(arquivo) {
    if (Array.isArray(arquivo)) return { lista: arquivo, acumulado: null };
    if (arquivo && arquivo.chaves) {
        const ler = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
        const hash = arquivo.chaves.madeireira_lancamentos;
        const lista = hash && Object.keys(hash).length ? Object.values(hash).map(ler) : (ler(arquivo.chaves.madeireira_finance) || []);
        return { lista, acumulado: ler(arquivo.chaves.madeireira_acumulado) || null };
    }
    if (arquivo && Array.isArray(arquivo.financeItems)) return { lista: arquivo.financeItems, acumulado: arquivo.acumulado || null };
    return null;
}

function progressoImportacao({ titulo, feito, total, texto, fim, erro }) {
    document.getElementById('modal-progresso').style.display = 'flex';
    document.getElementById('progresso-titulo').textContent = titulo;
    const barra = document.getElementById('progresso-barra');
    barra.max = total || 1;
    barra.value = feito;
    document.getElementById('progresso-texto').textContent = texto;
    const msg = document.getElementById('progresso-erro');
    msg.hidden = !erro;
    msg.textContent = erro || '';
    document.getElementById('progresso-fechar').hidden = !fim;
}

async function importBackup(event) {
    const arquivo = await lerArquivoJson(event);
    if (!arquivo) return;
    if (somenteLeitura) {
        alert(`Sem conexão com a nuvem (${erroConexao || 'motivo desconhecido'}). Nada foi importado.`);
        return;
    }
    const dados = extrairDoArquivo(arquivo);
    if (!dados) {
        alert('Arquivo de backup não reconhecido. Nada foi importado.');
        return;
    }
    if (!migrado && !confirm('Importar também ativa o salvamento seguro (uma cópia do banco é guardada antes).\n\nContinuar?')) return;

    const { lista, acumulado: acc } = dados;
    const total = lista.length;
    const soma = { adicionados: 0, existentes: 0, invalidos: 0, migrou: false, acumuladoImportado: false };
    const titulo = `Importando ${total} lançamentos`;
    progressoImportacao({ titulo, feito: 0, total, texto: 'Começando…' });

    for (let i = 0; i < total || i === 0; i += LOTE_IMPORTACAO) {
        const lote = lista.slice(i, i + LOTE_IMPORTACAO);
        const corpo = { financeItems: lote };
        if (i === 0 && acc) corpo.acumulado = acc;
        let r, ultimoErro;
        for (let tentativa = 1; tentativa <= 3 && !r; tentativa++) {
            try {
                r = await api('/api/importar', { method: 'POST', body: corpo, timeoutMs: 45000 });
            } catch (e) {
                ultimoErro = e;
                if (tentativa < 3) await new Promise((ok) => setTimeout(ok, 1500 * tentativa));
            }
        }
        if (!r) {
            progressoImportacao({
                titulo: 'A importação parou', feito: i, total, fim: true,
                texto: `Entraram ${soma.adicionados} novos lançamentos antes de parar (${i} de ${total} processados).`,
                erro: `Erro no lote ${i + 1} a ${Math.min(i + LOTE_IMPORTACAO, total)}: ${ultimoErro.message}. ` +
                    'Nada foi duplicado. Para continuar, clique em 📂 Importar e escolha o MESMO arquivo: o que já entrou é pulado.',
            });
            await carregarDados();
            return;
        }
        soma.adicionados += r.adicionados;
        soma.existentes += r.existentes;
        soma.invalidos += r.invalidos;
        soma.migrou = soma.migrou || r.migrou;
        soma.acumuladoImportado = soma.acumuladoImportado || r.acumuladoImportado;
        const feito = Math.min(i + LOTE_IMPORTACAO, total);
        progressoImportacao({ titulo, feito, total, texto: `${feito} de ${total} processados · ${soma.adicionados} novos · ${soma.existentes} já existiam` });
        if (total === 0) break;
    }

    progressoImportacao({
        titulo: 'Importação concluída', feito: total, total, fim: true,
        texto: `Novos: ${soma.adicionados} · Já existiam: ${soma.existentes} · Ignorados (inválidos): ${soma.invalidos}` +
            (soma.acumuladoImportado ? ' · Acumulado de agosto importado' : '') +
            (soma.migrou ? ' · Salvamento seguro ativado' : '') +
            '. Agora use "🔍 Conferir com arquivo" com o mesmo arquivo.',
    });
    await carregarDados();
}

// Restaurar = VOLTAR NO TEMPO: deixa os dados exatamente como estão no arquivo.
// O servidor guarda uma cópia do estado atual antes, então dá para desfazer.
async function restoreBackup(event) {
    const arquivo = await lerArquivoJson(event);
    if (!arquivo) return;
    if (somenteLeitura) {
        alert('Sem conexão com a nuvem. Nada foi restaurado.');
        return;
    }
    const resposta = prompt('ATENÇÃO: isto substitui TODOS os dados pelos do arquivo.\nUma cópia do estado atual é guardada antes.\n\nPara continuar, digite RESTAURAR:');
    if (resposta !== 'RESTAURAR') return;
    try {
        const r = await api('/api/restaurar', { method: 'POST', body: { confirmacao: 'RESTAURAR', arquivo } });
        alert(`Backup restaurado.\n\nLista antiga: ${r.listaAntiga} lançamentos\nSalvamento seguro: ${r.migrado ? `ativo (${r.lancamentos} lançamentos)` : 'desativado'}\n\nCópia do estado anterior: ${r.copia}`);
    } catch (e) {
        alert(`Erro ao restaurar: ${e.message}`);
    }
    backupBaixado = false;
    await carregarDados();
}

// Inicializa a conexão com o Banco
carregarDados();
