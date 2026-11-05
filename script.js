// --- DATA BASE DA CALCULADORA AGORA VEM DE tabela-precos.js ---


// --- GLOBAL UTILS ---
const formatCurrency = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

// Escapa texto antes de colocar no HTML (descrições vêm do banco e podem conter < > " ')
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const novoId = (sufixo = '') => Date.now().toString() + Math.random().toString(36).slice(2, 6) + sufixo;

// --- API (com senha) ---
const SENHA_KEY = 'madeireira_senha';
let pedidoDeSenha = null;

// --- MODO FUNCIONÁRIO (/funcionarios) ---
// O funcionário entra com o nome e o PIN; o servidor devolve uma sessão que vale até a meia-noite.
// O PIN não fica guardado no aparelho (só a sessão). A senha do dono não vale aqui, e o PIN não vale na entrada do dono.
const MODO_FUNC = /^\/funcionarios\/?$/.test(location.pathname);
window.MODO_FUNC = MODO_FUNC;
const SESSAO_KEY = 'madeireira_sessao_func';
const COPIA_KEY = MODO_FUNC ? 'madeireira_finance_func' : 'madeireira_finance';
if (MODO_FUNC) {
    document.body.classList.add('modo-funcionario', 'modo-balcao');
    document.title = 'Madeireira · Funcionários';
}
let pedidoDePin = null;

function sessaoGuardada() {
    try {
        const s = JSON.parse(localStorage.getItem(SESSAO_KEY));
        return s && s.token && new Date(s.expira) > new Date() ? s : null;
    } catch { return null; }
}
function mostrarNomeFuncionario() {
    const el = document.getElementById('func-nome');
    const s = MODO_FUNC ? sessaoGuardada() : null;
    if (el) { el.hidden = !s; el.textContent = s ? `👤 ${s.nome}` : ''; }
}

function pedirPin(mensagem) {
    if (pedidoDePin) return pedidoDePin;
    pedidoDePin = new Promise(resolve => {
        const modal = document.getElementById('modal-pin');
        const sel = document.getElementById('pin-nome');
        const input = document.getElementById('pin-input');
        const msg = document.getElementById('pin-msg');
        msg.textContent = mensagem || 'Escolha o seu nome e digite o seu PIN.';
        input.value = '';
        modal.style.display = 'flex';
        fetch('/api/sessao').then(r => r.json()).then(d => {
            const lista = d.funcionarios || [];
            sel.innerHTML = '<option value="">Escolha…</option>' + lista.map(f => `<option value="${esc(f.id)}">${esc(f.nome)}</option>`).join('');
            if (!lista.length) msg.textContent = 'Nenhum funcionário cadastrado. O dono cadastra em Ajustes › Funcionários.';
            sel.focus();
        }).catch(e => { msg.textContent = `Sem conexão com o servidor (${e.message}). Tente de novo.`; });
        document.getElementById('pin-form').onsubmit = async (e) => {
            e.preventDefault();
            if (!sel.value || !input.value) return;
            try {
                const r = await fetch('/api/sessao', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: sel.value, pin: input.value }) });
                const d = await r.json().catch(() => null);
                input.value = '';
                if (!r.ok) { msg.textContent = d?.error || `erro ${r.status}`; input.focus(); return; }
                try { localStorage.setItem(SESSAO_KEY, JSON.stringify({ token: d.token, nome: d.nome, id: d.id, expira: d.expira })); } catch { /* sem armazenamento */ }
                sessaoAtual = d;
                modal.style.display = 'none';
                pedidoDePin = null;
                mostrarNomeFuncionario();
                resolve(d.token);
            } catch (err) { msg.textContent = `Sem conexão com o servidor (${err.message}).`; }
        };
    });
    return pedidoDePin;
}
// Sem armazenamento no aparelho, a sessão fica só na memória desta tela
let sessaoAtual = null;
const tokenFuncionario = () => sessaoGuardada()?.token || (sessaoAtual && new Date(sessaoAtual.expira) > new Date() ? sessaoAtual.token : null);

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
async function sairDoAparelho() {
    if (MODO_FUNC) {
        const token = tokenFuncionario();
        if (token) await fetch('/api/sessao', { method: 'DELETE', headers: { 'x-sessao': token } }).catch(() => null);
        for (const k of [SESSAO_KEY, COPIA_KEY]) {
            try { localStorage.removeItem(k); } catch { /* sem armazenamento */ }
        }
        sessaoAtual = null;
        location.reload();
        return;
    }
    if (!confirm('Sair deste aparelho? A senha e a cópia dos dados guardadas aqui serão apagadas. Para entrar de novo, é preciso digitar a senha.')) return;
    for (const k of [SENHA_KEY, 'madeireira_finance', 'madeireira_acumulado', 'madeireira_pedido']) {
        try { localStorage.removeItem(k); } catch { /* sem armazenamento */ }
    }
    location.reload();
}
document.getElementById('btn-sair')?.addEventListener('click', sairDoAparelho);

async function api(caminho, { method = 'GET', body, timeoutMs = 60000 } = {}) {
    const senha = MODO_FUNC ? (tokenFuncionario() || await pedirPin()) : (localStorage.getItem(SENHA_KEY) || await pedirSenha());
    const controle = new AbortController();
    const relogio = setTimeout(() => controle.abort(), timeoutMs);
    let res;
    try {
        res = await fetch(caminho, {
            method,
            headers: { 'Content-Type': 'application/json', [MODO_FUNC ? 'x-sessao' : 'x-senha']: senha },
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
        if (!MODO_FUNC) localStorage.removeItem(SENHA_KEY);
        throw new Error(d?.error || 'Muitas tentativas de senha erradas. Espere alguns minutos.');
    }
    if (res.status === 401 && MODO_FUNC) {
        const d = await res.json().catch(() => null);
        try { localStorage.removeItem(SESSAO_KEY); } catch { /* sem armazenamento */ }
        sessaoAtual = null;
        mostrarNomeFuncionario();
        await pedirPin(d?.error || 'Sessão encerrada. Entre de novo com o seu PIN.');
        return api(caminho, { method, body, timeoutMs });
    }
    if (res.status === 401) {
        localStorage.removeItem(SENHA_KEY);
        await pedirSenha('Senha incorreta. Tente de novo.');
        return api(caminho, { method, body, timeoutMs });
    }
    const dados = await res.json().catch(() => null);
    if (!res.ok) {
        const explicacao = { 504: 'o servidor demorou demais e foi interrompido', 413: 'pedido grande demais', 500: 'erro no servidor' }[res.status];
        // o que o servidor mandou junto (ex.: recebimento recente, duplicado) segue no erro
        throw Object.assign(new Error(dados?.error || `erro ${res.status}${explicacao ? ': ' + explicacao : ''}`), { status: res.status, dados });
    }
    return dados || {};
}

// --- ABAS ---
// Vender · Orçamentos · Caixa · Relatórios · Ajustes. O sistema abre em Vender; o Caixa abre em Lançar.
const ABAS = ['vender', 'orcamentos', 'caixa', 'relatorios', 'ajustes'];
function switchTab(tabId) {
    if (!ABAS.includes(tabId) || (MODO_FUNC && !['vender', 'orcamentos'].includes(tabId))) tabId = 'vender';
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
let proximosNumeros = null; // próxima venda e próximo orçamento (Ajustes › Dados)
// Até o backup + migração, os lançamentos ficam na lista antiga, que é regravada inteira.
let migrado = true;
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
        proximosNumeros = data.proximos || null;
        configFinanceiro = data.configFinanceiro || {};
        saldosCaixa = data.saldos || { abertura: null, conferencias: [] };
        migradoV2 = Boolean(data.migradoV2);
        somenteLeitura = false;
        erroConexao = '';
        // Cópia local só para leitura quando estiver sem conexão. Se a memória do aparelho encher,
        // o sistema continua normal (só fica sem a cópia)
        try {
            localStorage.setItem(COPIA_KEY, JSON.stringify(financeItems));
            if (!MODO_FUNC) localStorage.setItem('madeireira_acumulado', JSON.stringify(acumulado));
        } catch (e) {
            console.warn('Cópia local não coube na memória do aparelho:', e.message);
            try { localStorage.removeItem(COPIA_KEY); } catch { /* sem armazenamento */ }
        }
    } catch (e) {
        console.warn('Sem conexão com a nuvem. Mostrando a última cópia local, sem gravar.', e);
        somenteLeitura = true;
        erroConexao = e.message || String(e);
        try {
            financeItems = JSON.parse(localStorage.getItem(COPIA_KEY)) || [];
            acumulado = JSON.parse(localStorage.getItem('madeireira_acumulado')) || { ...ACUMULADO_VAZIO };
        } catch { financeItems = []; acumulado = { ...ACUMULADO_VAZIO }; }
    }
    atualizarAviso();
    atualizarStatusBanco();
    if (window.Financeiro) window.Financeiro.atualizar();
    if (window.ClientesUI) window.ClientesUI.atualizar();
    if (window.PedidosHoje) window.PedidosHoje.atualizar();
}

// Pedidos de hoje, orçamentos e clientes se atualizam sozinhos a cada 30 s (e ao voltar para a tela), para quem
// vende ao mesmo tempo em outro aparelho. Só no Vender e em Clientes e Orçamentos, e nunca com uma janela aberta
// ou com alguém digitando ali (não pode perder o que está sendo preenchido).
async function atualizarSozinho() {
    if (document.hidden || pedidoDeSenha || pedidoDePin) return;
    const aba = document.querySelector('.tab-content.active')?.id;
    if (!['tab-vender', 'tab-orcamentos'].includes(aba)) return;
    if ([...document.querySelectorAll('.modal-overlay')].some(m => m.offsetParent !== null || getComputedStyle(m).display !== 'none')) return;
    const foco = document.activeElement;
    if (foco && foco.closest?.('#tab-orcamentos') && /^(INPUT|TEXTAREA|SELECT)$/.test(foco.tagName)) return;
    await carregarDados();
    window.Orcamentos?.recarregar();
    window.Clientes?.carregar();
    window.Calculadora?.atualizarPrecos?.(); // preço salvo pelo dono depois que esta tela abriu
}
setInterval(atualizarSozinho, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) atualizarSozinho(); });
mostrarNomeFuncionario();

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
    if (statusBanco.gravacaoBloqueada) partes.push('⛔ GRAVAÇÃO BLOQUEADA (banco de produção)');
    else if (statusBanco.travaConfigurada) partes.push('trava de produção: ativa');
    if (statusBanco.zerarPermitido) partes.push('⚠️ ZERAR LIGADO (desligar depois da virada)');
    if (proximosNumeros) partes.push(`próxima venda: ${proximosNumeros.venda} · próximo orçamento: ${proximosNumeros.orcamento}`);
    el.textContent = partes.join(' · ');
    el.classList.toggle('texto-ruim', Boolean(statusBanco.gravacaoBloqueada || statusBanco.zerarPermitido));
    document.getElementById('zerar-bloco').hidden = !statusBanco.zerarPermitido;
    document.getElementById('copiar-loja-bloco').hidden = !statusBanco.copiarDaLoja;
}

// Ensaio: copiar os preços de venda e os ajustes da calculadora da loja (o botão não aparece na produção)
document.getElementById('copiar-loja')?.addEventListener('click', async () => {
    if (!statusBanco?.copiarDaLoja) return;
    if (!confirm('Copiar os preços de venda e os ajustes da calculadora da loja para o ensaio?\n\nOs preços do ensaio são substituídos (fica uma cópia antes). Nada é gravado na loja.')) return;
    try {
        const r = await api('/api/config', { method: 'POST', body: { copiarDaLoja: true } });
        await window.Calculadora?.recarregar?.();
        alert(`Copiado para o ensaio: ${r.precos} preços de venda${r.config ? ' e os ajustes da calculadora' : ''}.`);
    } catch (e) { alert(`Não foi copiado: ${e.message}`); }
});

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
        alert(`Banco zerado.\n\nApagados: lançamentos, clientes, orçamentos, abertura, fiado anterior, conferências e contadores (a próxima venda é V-0001 e o próximo orçamento ORC-0001).\nMantidos: catálogo, custos, preços, ajustes, configuração financeira e Ajustes › Impressão.\nCópia do estado anterior: ${r.copia}\n\nPróximo passo: Ajustes › Saldos › abertura do dia. Depois, desligue o PERMITIR_ZERAR na Vercel.`);
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
    // Antes de registrar, confere se a tabela de preços mudou (se mudou, a pessoa vê os preços novos e registra de novo)
    if (window.Calculadora?.atualizarPrecos && await window.Calculadora.atualizarPrecos()) {
        alert('A tabela de preços foi atualizada agora há pouco (Ajustes › Preços). Confira os valores do pedido e registre de novo.');
        return;
    }
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
    // Cliente: do bloco "Cliente" do pedido (vinculado a um cadastrado ou só os dados da via).
    // No fiado é obrigatório (nome e WhatsApp) e o cliente novo é cadastrado.
    const cli = await window.ClientePedido.paraVenda({ fiado: pagamentos.some((p) => p.forma === 'fiado') });
    if (!cli) return;
    Object.assign(vendaItem, cli);
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
        alert(`Backup restaurado: ${r.lancamentos} lançamentos${r.funcionarios != null ? `, ${r.funcionarios} funcionário(s)` : ""}.\n\nCópia do estado anterior: ${r.copia}`);
    } catch (e) {
        alert(`Erro ao restaurar: ${e.message}`);
    }
    await carregarDados();
}

// Inicializa a conexão com o Banco
carregarDados();
