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

async function api(caminho, { method = 'GET', body } = {}) {
    const senha = localStorage.getItem(SENHA_KEY) || await pedirSenha();
    const res = await fetch(caminho, {
        method,
        headers: { 'Content-Type': 'application/json', 'x-senha': senha },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 401) {
        localStorage.removeItem(SENHA_KEY);
        await pedirSenha('Senha incorreta. Tente de novo.');
        return api(caminho, { method, body });
    }
    const dados = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(dados.error || `Erro ${res.status}`);
    return dados;
}

// --- TAB SWITCHING ---
function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
    
    document.getElementById(`tab-${tabId}`).style.display = 'block';
    document.getElementById(`tab-${tabId}`).classList.add('active');
    document.getElementById(`btn-tab-${tabId}`).classList.add('active');
    
    if(tabId === 'finance') {
        renderFinance();
    }
}

// --- CALCULADORA LOGIC ---
const materialSelect = document.getElementById('material');
const dimensionSelect = document.getElementById('dimension');
const quantityPiecesInput = document.getElementById('quantity-pieces');
const quantityPiecesLabel = document.getElementById('quantity-pieces-label');
const lengthGroup = document.getElementById('length-group');
const quantityLengthInput = document.getElementById('quantity-length');
const calcForm = document.getElementById('calc-form');
const itemsBody = document.getElementById('items-body');
const grandTotalEl = document.getElementById('grand-total');

let orderItems = [];
let currentCalcTotal = 0;

materialSelect.addEventListener('change', (e) => {
    const selectedMaterial = e.target.value;
    dimensionSelect.innerHTML = '<option value="" disabled selected>Selecione a dimensão/tipo</option>';
    dimensionSelect.disabled = false;
    
    const dimensions = woodData[selectedMaterial].dimensions;
    for (const [dim, priceData] of Object.entries(dimensions)) {
        const option = document.createElement('option');
        option.value = dim;
        
        let costPrice = typeof priceData === 'number' ? priceData : (priceData.custo || 0);
        let salePrice = typeof priceData === 'number' ? 0 : (priceData.venda || 0);
        
        let labelText = `${dim} - Custo: ${formatCurrency(costPrice)}`;
        if (salePrice > 0) labelText += ` | Venda: ${formatCurrency(salePrice)}`;
        
        option.textContent = labelText;
        dimensionSelect.appendChild(option);
    }

    const unitType = woodData[selectedMaterial].unit;
    quantityPiecesInput.disabled = false;
    quantityPiecesInput.value = '';
    quantityPiecesLabel.textContent = woodData[selectedMaterial].label;

    if (unitType === 'pieces' || unitType === 'square_meters') {
        lengthGroup.style.display = 'none';
        quantityLengthInput.disabled = true;
        quantityLengthInput.required = false;
        quantityLengthInput.value = '';
        
        if (unitType === 'square_meters') {
            quantityPiecesInput.step = "0.01"; quantityPiecesInput.min = "0.01"; quantityPiecesInput.placeholder = "Ex: 15.5";
        } else {
            quantityPiecesInput.step = "1"; quantityPiecesInput.min = "1"; quantityPiecesInput.placeholder = "Ex: 5";
        }
    } else {
        lengthGroup.style.display = 'flex';
        quantityLengthInput.disabled = false;
        quantityLengthInput.required = true;
        quantityLengthInput.value = '';
        quantityPiecesInput.step = "1"; quantityPiecesInput.min = "1"; quantityPiecesInput.placeholder = "Qtd de peças (Ex: 6)";
    }
});

calcForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const material = materialSelect.value;
    const dimension = dimensionSelect.value;
    const piecesOrArea = parseFloat(quantityPiecesInput.value);

    if (!material || !dimension || isNaN(piecesOrArea) || piecesOrArea <= 0) return;

    const unitType = woodData[material].unit;
    let totalQuantity = 0;
    let displayQuantity = '';

    if (unitType === 'pieces') {
        totalQuantity = piecesOrArea;
        let unitLabel = material === 'PREGOS' ? 'saco(s)' : 'un';
        displayQuantity = `${piecesOrArea} ${unitLabel}`;
    } else if (unitType === 'square_meters') {
        totalQuantity = piecesOrArea;
        displayQuantity = `${piecesOrArea.toFixed(2)} m²`;
    } else {
        const pieces = parseInt(piecesOrArea);
        const length = parseFloat(quantityLengthInput.value);
        if (isNaN(length) || length <= 0) return;
        totalQuantity = pieces * length;
        displayQuantity = `${pieces} un x ${length}m = ${totalQuantity.toFixed(2)}m`;
    }

    const priceData = woodData[material].dimensions[dimension];
    let costPrice = typeof priceData === 'number' ? priceData : (priceData.custo || 0);
    let salePrice = typeof priceData === 'number' ? 0 : (priceData.venda || 0);

    const subtotal = costPrice * totalQuantity;
    const saleSubtotal = salePrice * totalQuantity;

    orderItems.push({ 
        id: Date.now().toString(), 
        material, 
        dimension, 
        displayQuantity, 
        priceUnit: costPrice, 
        saleSubtotal,
        subtotal 
    });
    renderCalcTable();
    
    dimensionSelect.value = ''; quantityPiecesInput.value = ''; quantityLengthInput.value = '';
    quantityPiecesInput.focus();
});

const deleteCalcItem = (id) => { orderItems = orderItems.filter(item => item.id !== id); renderCalcTable(); };

const renderCalcTable = () => {
    itemsBody.innerHTML = '';
    currentCalcTotal = 0;
    let currentSuggestedSale = 0;
    
    orderItems.forEach(item => {
        currentCalcTotal += item.subtotal;
        currentSuggestedSale += (item.saleSubtotal || 0);
        
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${esc(item.material.replace(/_/g, ' '))}</td><td>${esc(item.dimension)}</td><td>${esc(item.displayQuantity)}</td><td>${formatCurrency(item.priceUnit)}</td><td>${formatCurrency(item.subtotal)}</td><td><button class="delete-btn" onclick="deleteCalcItem('${item.id}')">Excluir</button></td>`;
        itemsBody.appendChild(tr);
    });
    grandTotalEl.textContent = formatCurrency(currentCalcTotal);
    
    // Auto-preencher o campo de venda se houver valor de venda sugerido
    const directSalePriceInput = document.getElementById('direct-sale-price');
    if (directSalePriceInput) {
        if (currentSuggestedSale > 0) {
            // Se o usuário ainda não tiver digitado nada ou se quiser que ele sempre atualize:
            // Vamos sempre atualizar para facilitar, pois cada item novo muda o total.
            directSalePriceInput.value = currentSuggestedSale.toFixed(2);
        } else if (orderItems.length === 0) {
            directSalePriceInput.value = '';
        }
    }
};

// --- GESTOR DE CAIXA LOGIC ---
let financeItems = [];
const ACUMULADO_VAZIO = { venda: 0, pix: 0, credito: 0, debito: 0, custo: 0, despesa: 0, func: 0, dinheiroCaixa: 0 };
let acumulado = { ...ACUMULADO_VAZIO };

// Sem conexão com a nuvem: mostra a última cópia, mas não deixa gravar
// (gravar com dados velhos apagaria lançamentos feitos em outro aparelho).
let somenteLeitura = false;
// Até o backup + migração, os lançamentos ficam na lista antiga, que é regravada inteira.
let migrado = true;
let backupBaixado = false;

async function carregarDados() {
    try {
        const data = await api('/api/getFinance');
        financeItems = data.financeItems || [];
        acumulado = Object.assign({ ...ACUMULADO_VAZIO }, data.acumulado || {});
        migrado = data.migrado;
        somenteLeitura = false;
        // Cópia local só para leitura quando estiver sem conexão
        localStorage.setItem('madeireira_finance', JSON.stringify(financeItems));
        localStorage.setItem('madeireira_acumulado', JSON.stringify(acumulado));
    } catch (e) {
        console.warn('Sem conexão com a nuvem. Mostrando a última cópia local, sem gravar.', e);
        somenteLeitura = true;
        financeItems = JSON.parse(localStorage.getItem('madeireira_finance')) || [];
        acumulado = JSON.parse(localStorage.getItem('madeireira_acumulado')) || { ...ACUMULADO_VAZIO };
    }
    atualizarAviso();
    renderFinance();
}

function atualizarAviso() {
    const aviso = document.getElementById('aviso-sistema');
    if (somenteLeitura) {
        aviso.className = 'aviso aviso-erro';
        aviso.innerHTML = `<strong>Sem conexão com a nuvem.</strong> Mostrando a última cópia deste aparelho, só para consulta. Nada pode ser lançado até a conexão voltar.
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

function getLocalDateString() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

const filterDateEl = document.getElementById('filter-date');
const directSaleDateEl = document.getElementById('direct-sale-date');

// Começa com a data de hoje (YYYY-MM-DD) local
const initialDate = getLocalDateString();
filterDateEl.value = initialDate;
if (directSaleDateEl) directSaleDateEl.value = initialDate;

filterDateEl.addEventListener('change', () => {
    if (directSaleDateEl) directSaleDateEl.value = filterDateEl.value;
    renderFinance();
});

const finCategory = document.getElementById('fin-category');
const finMethod = document.getElementById('fin-method');

finCategory.addEventListener('change', () => {
    const cat = finCategory.value;
    const currentMethod = finMethod.value;
    
    finMethod.innerHTML = `
        <option value="dinheiro">Dinheiro Físico</option>
        <option value="pix">PIX</option>
        <option value="bradesco">Bradesco (Transferência)</option>
        <option value="debito">Cartão de Débito</option>
        <option value="credito">Cartão de Crédito</option>
        <option value="cheque">Cheque</option>
    `;
    
    if (cat === 'custo') {
        Array.from(finMethod.options).forEach(opt => {
            if (['pix', 'debito', 'credito'].includes(opt.value)) {
                opt.remove();
            }
        });
        finMethod.value = 'cheque';
    } else {
        finMethod.value = currentMethod || 'dinheiro';
    }
    
    toggleCheckFields();
});

function toggleCheckFields() {
    const method = document.getElementById('fin-method').value;
    const checkFields = document.getElementById('check-fields');
    if (method === 'cheque') {
        checkFields.style.display = 'flex';
    } else {
        checkFields.style.display = 'none';
    }
}

document.getElementById('finance-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!podeGravar()) return;

    const category = document.getElementById('fin-category').value;
    const type = category === 'venda' ? 'income' : 'expense';
    const value = parseFloat(document.getElementById('fin-value').value);
    const date = document.getElementById('fin-date').value;
    const description = document.getElementById('fin-description').value;
    const method = document.getElementById('fin-method').value;
    
    const item = {
        id: novoId(),
        category,
        type,
        value,
        date,
        description,
        method
    };

    if (method === 'cheque') {
        item.checkNumber = document.getElementById('fin-check-number').value;
        item.checkIssuer = document.getElementById('fin-check-issuer').value;
        item.checkDate = document.getElementById('fin-check-date').value;
    }

    if (!(await gravarLancamentos([item]))) return;

    // Atualiza o painel para refletir a mesma data que o usuário acabou de preencher (Facilita lançamento atrasado)
    document.getElementById('filter-date').value = document.getElementById('fin-date').value;

    renderFinance();
    e.target.reset();
    
    // Devolve a data para o que estava antes do reset do formulário
    document.getElementById('fin-date').value = document.getElementById('filter-date').value;
    
    toggleCheckFields();
});

async function deleteFinanceItem(id) {
    if (!podeGravar()) return;
    const item = financeItems.find(i => i.id === id);
    if (!item) return;
    const resumo = `${item.date.split('-').reverse().join('/')} - ${formatCurrency(item.value)}${item.description ? ' - ' + item.description : ''}`;
    if (!confirm(`Excluir este lançamento?\n\n${resumo}`)) return;
    try {
        await api(`/api/lancamento?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    } catch (e) {
        alert(`Não foi excluído: ${e.message}`);
        return;
    }
    await carregarDados();
}

function renderFinance() {
    const tbody = document.getElementById('finance-body');
    tbody.innerHTML = '';
    
    const filterDate = filterDateEl.value; // "YYYY-MM-DD"
    const filterMonth = filterDate.substring(0, 7); // "YYYY-MM"
    
    const dateLabel = filterDate.split('-').reverse().join('/');
    const dateLabelEl = document.getElementById('current-date-label');
    if(dateLabelEl) dateLabelEl.textContent = dateLabel;
    
    // Atualiza o título de impressão com o mês selecionado
    const printMonthEl = document.getElementById('print-month-label');
    if (printMonthEl) {
        const [, month, year] = dateLabel.split('/');
        printMonthEl.textContent = `${month}/${year}`;
    }
    
    let cashInMonth = 0;
    let grandTotal = 0;
    
    // O que foi lançado EXATAMENTE no dia selecionado (sys)
    let sysVenda = 0, sysPix = 0, sysCred = 0, sysDeb = 0;
    let sysCusto = 0, sysFunc = 0, sysDesp = 0;

    // O que foi lançado no mesmo MÊS, mas em dias ANTERIORES ao dia selecionado (past)
    let pastVenda = 0, pastPix = 0, pastCred = 0, pastDeb = 0;
    let pastCusto = 0, pastFunc = 0, pastDesp = 0;

    // Filtra histórico só para o mês selecionado até o dia atual
    const filtered = financeItems.filter(item => item.date.startsWith(filterMonth) && item.date <= filterDate)
                                 .sort((a, b) => new Date(b.date) - new Date(a.date));

    filtered.forEach(item => {
        const isIncome = item.type === 'income';
        const val = isIncome ? item.value : -item.value;
        
        if (item.method === 'dinheiro') {
            cashInMonth += val;
        }
        
        const cat = item.category || (isIncome ? 'venda' : 'despesa');
        
        // Separa a lógica: Foi no dia selecionado? ou foi nos dias anteriores?
        if (item.date === filterDate) {
            if (cat === 'venda') {
                sysVenda += item.value;
                if (item.method === 'pix' || item.method === 'bradesco') sysPix += item.value;
                if (item.method === 'credito') sysCred += item.value;
                if (item.method === 'debito') sysDeb += item.value;
            }
            else if (cat === 'custo') sysCusto += item.value;
            else if (cat === 'funcionario') sysFunc += item.value;
            else if (cat === 'despesa') sysDesp += item.value;
        } else {
            // Dias anteriores dentro do mesmo mês
            if (cat === 'venda') {
                pastVenda += item.value;
                if (item.method === 'pix' || item.method === 'bradesco') pastPix += item.value;
                if (item.method === 'credito') pastCred += item.value;
                if (item.method === 'debito') pastDeb += item.value;
            }
            else if (cat === 'custo') pastCusto += item.value;
            else if (cat === 'funcionario') pastFunc += item.value;
            else if (cat === 'despesa') pastDesp += item.value;
        }

        const tr = document.createElement('tr');
        
        let methodStr = esc(String(item.method).toUpperCase());
        if(item.method === 'cheque') {
            methodStr += `<br><small style="color:var(--text-muted)">Nº: ${esc(item.checkNumber || '-')} | Para: ${item.checkDate ? esc(item.checkDate.split('-').reverse().join('/')) : '-'}</small>`;
        }
        
        let catStr = "";
        if (cat === 'venda') catStr = "Venda (Bruto)";
        if (cat === 'custo') catStr = "Custo Material";
        if (cat === 'funcionario') catStr = "Funcionário";
        if (cat === 'despesa') catStr = "Despesa Geral";

        tr.innerHTML = `
            <td>${item.date.split('-').reverse().join('/')}</td>
            <td>${esc(item.description)}</td>
            <td class="${isIncome ? 'type-income' : 'type-expense'}">${catStr}</td>
            <td>${methodStr}</td>
            <td class="${isIncome ? 'type-income' : 'type-expense'}">${formatCurrency(item.value)}</td>
            <td><button class="delete-btn" onclick="deleteFinanceItem('${esc(item.id)}')">Excluir</button></td>
        `;
        tbody.appendChild(tr);
    });

    // Migration/Fix: O acumulado manual que foi inserido era referente apenas aos dias 1 a 23 de Agosto.
    // Ele não deve ser somado nos meses seguintes (Setembro em diante).
    const isAgosto2026 = filterMonth === '2026-08';

    // Calculates Totals: Acumulado = (Anterior no Mês) + (Manual de Agosto)
    let accVenda = pastVenda + (isAgosto2026 ? (acumulado.venda || 0) : 0);
    let accPix = pastPix + (isAgosto2026 ? (acumulado.pix || 0) : 0);
    let accCred = pastCred + (isAgosto2026 ? (acumulado.credito || 0) : 0);
    let accDeb = pastDeb + (isAgosto2026 ? (acumulado.debito || 0) : 0);
    let accCusto = pastCusto + (isAgosto2026 ? (acumulado.custo || 0) : 0);
    let accFunc = pastFunc + (isAgosto2026 ? (acumulado.func || 0) : 0);
    let accDesp = pastDesp + (isAgosto2026 ? (acumulado.despesa || 0) : 0);

    // Total Geral = (Hoje) + (Acumulado do Mês)
    let totVenda = sysVenda + accVenda;
    let totPix = sysPix + accPix;
    let totCred = sysCred + accCred;
    let totDeb = sysDeb + accDeb;
    let totCusto = sysCusto + accCusto;
    let totFunc = sysFunc + accFunc;
    let totDesp = sysDesp + accDesp;

    // Calcula os Resultados
    let sysRes = sysVenda - sysCusto - sysDesp; // Resultado só do dia
    let accRes = accVenda - accCusto - accDesp; // Resultado de dias anteriores
    grandTotal = totVenda - totCusto - totDesp; // Resultado final

    // Total na Gaveta Físico
    // Para a gaveta ser real, precisamos somar TODO o dinheiro físico de todos os tempos até a data atual.
    const dateLimit = filterDateEl.value;
    let allTimeCash = acumulado.dinheiroCaixa || 0;
    financeItems.forEach(item => {
        if (item.date <= dateLimit) {
            if (item.method === 'dinheiro') {
                if (item.type === 'income') allTimeCash += item.value;
                else if (item.type === 'expense') allTimeCash -= item.value;
            }
        }
    });
    document.getElementById('dash-cash').textContent = formatCurrency(allTimeCash);
    
    const totalEl = document.getElementById('dash-total');
    totalEl.textContent = formatCurrency(grandTotal);
    totalEl.className = grandTotal >= 0 ? 'positive' : 'negative';

    // Atualiza os cartões novos de métodos de pagamento (Totais do Mês)
    document.getElementById('dash-tot-pix').textContent = formatCurrency(totPix);
    document.getElementById('dash-tot-cred').textContent = formatCurrency(totCred);
    document.getElementById('dash-tot-deb').textContent = formatCurrency(totDeb);
    
    // Atualiza Resumo Tabela
    document.getElementById('sys-vendas').textContent = formatCurrency(sysVenda);
    document.getElementById('acc-vendas').textContent = formatCurrency(accVenda);
    document.getElementById('tot-vendas').textContent = formatCurrency(totVenda);

    document.getElementById('sys-pix').textContent = formatCurrency(sysPix);
    document.getElementById('acc-pix').textContent = formatCurrency(accPix);
    document.getElementById('tot-pix').textContent = formatCurrency(totPix);

    document.getElementById('sys-cred').textContent = formatCurrency(sysCred);
    document.getElementById('acc-cred').textContent = formatCurrency(accCred);
    document.getElementById('tot-cred').textContent = formatCurrency(totCred);

    document.getElementById('sys-deb').textContent = formatCurrency(sysDeb);
    document.getElementById('acc-deb').textContent = formatCurrency(accDeb);
    document.getElementById('tot-deb').textContent = formatCurrency(totDeb);

    document.getElementById('sys-custos').textContent = formatCurrency(sysCusto);
    document.getElementById('acc-custos').textContent = formatCurrency(accCusto);
    document.getElementById('tot-custos').textContent = formatCurrency(totCusto);

    document.getElementById('sys-despesas').textContent = formatCurrency(sysDesp);
    document.getElementById('acc-despesas').textContent = formatCurrency(accDesp);
    document.getElementById('tot-despesas').textContent = formatCurrency(totDesp);

    document.getElementById('sys-funcionarios').textContent = formatCurrency(sysFunc);
    document.getElementById('acc-funcionarios').textContent = formatCurrency(accFunc);
    document.getElementById('tot-funcionarios').textContent = formatCurrency(totFunc);

    document.getElementById('sys-res').textContent = formatCurrency(sysRes);
    document.getElementById('acc-res').textContent = formatCurrency(accRes);
    
    const totResEl = document.getElementById('tot-res');
    totResEl.textContent = formatCurrency(grandTotal);
    
    const resultLabel = document.getElementById('sum-resultado-label');
    
    if (grandTotal > 0) {
        totResEl.className = 'text-success font-bold';
        resultLabel.textContent = 'LUCRO BRUTO DO MÊS';
    } else if (grandTotal < 0) {
        totResEl.className = 'text-danger font-bold';
        resultLabel.textContent = 'PREJUÍZO BRUTO DO MÊS';
    } else {
        totResEl.className = 'font-bold';
        resultLabel.textContent = 'RESULTADO BRUTO DO MÊS';
    }
}

function exportToFinance(type) {
    if (currentCalcTotal <= 0) {
        alert("A calculadora está vazia. Adicione itens primeiro.");
        return;
    }
    switchTab('finance');
    if (type === 'expense') {
        document.getElementById('fin-category').value = 'custo';
        document.getElementById('fin-description').value = "Compra/Custo de Material (Via Calculadora)";
    } else {
        document.getElementById('fin-category').value = 'venda';
        document.getElementById('fin-description').value = "Venda de Material (Via Calculadora)";
    }
    document.getElementById('fin-category').dispatchEvent(new Event('change'));
    document.getElementById('fin-value').value = currentCalcTotal.toFixed(2);
    document.getElementById('fin-date').value = getLocalDateString();
    alert(`O valor de ${formatCurrency(currentCalcTotal)} foi levado para o formulário do Caixa. Escolha a forma de pagamento e clique em Registrar Lançamento.`);
}

async function registerDirectCost() {
    if (orderItems.length === 0) {
        alert("A calculadora está vazia. Adicione itens primeiro.");
        return;
    }
    if (!podeGravar()) return;

    const dateInput = document.getElementById('direct-sale-date').value;
    const date = dateInput ? dateInput : getLocalDateString();

    // Extrai o nome dos materiais
    const materialsList = orderItems.map(item => item.material.replace(/_/g, ' ')).join(', ');

    const custoItem = {
        id: novoId('C'),
        category: 'custo',
        type: 'expense',
        value: currentCalcTotal,
        date: date,
        description: `Custo Extraído (Apenas Material): ${materialsList}`,
        method: 'cheque'
    };
    
    if (!(await gravarLancamentos([custoItem]))) return;

    alert(`Pronto! Apenas o custo de ${formatCurrency(currentCalcTotal)} foi registrado no caixa.`);
    orderItems = [];
    renderCalcTable();
}

async function registerDirectSale() {
    if (orderItems.length === 0) {
        alert("A calculadora está vazia. Adicione itens primeiro.");
        return;
    }
    
    const salePriceInput = document.getElementById('direct-sale-price');
    const salePrice = parseFloat(salePriceInput.value);
    
    if (isNaN(salePrice) || salePrice <= 0) {
        alert("Por favor, informe o valor de venda (maior que zero).");
        salePriceInput.focus();
        return;
    }
    if (!podeGravar()) return;
    const saleMethod = document.getElementById('direct-sale-method').value;
    const dateInput = document.getElementById('direct-sale-date').value;
    const date = dateInput ? dateInput : getLocalDateString();
    
    // Extrai o nome dos materiais da calculadora para uma descrição detalhada
    const materialsList = orderItems.map(item => item.material.replace(/_/g, ' ')).join(', ');
    
    // Cria Lançamento da Venda
    const vendaItem = {
        id: novoId('V'),
        category: 'venda',
        type: 'income',
        value: salePrice,
        date: date,
        description: `Venda Direta: ${materialsList}`,
        method: saleMethod
    };
    
    // Cria Lançamento do Custo daquele material
    const custoItem = {
        id: novoId('C'),
        category: 'custo',
        type: 'expense',
        value: currentCalcTotal,
        date: date,
        description: `Custo Extraído: ${materialsList}`,
        method: 'cheque' // Assumimos que o custo material gerado entra no controle de custos (cheque/prazo)
    };
    
    // Salva os dois juntos na nuvem e atualiza a interface
    // (custo 0, como no retalho, não gera lançamento: o servidor exige valor > 0)
    const itens = currentCalcTotal > 0 ? [vendaItem, custoItem] : [vendaItem];
    if (!(await gravarLancamentos(itens))) return;
    
    alert(`Pronto! Lançamento duplo efetuado com sucesso:\n\n✅ Venda registrada: ${formatCurrency(salePrice)}\n✅ Custo extraído: ${formatCurrency(currentCalcTotal)}\n\n(Consulte a aba Gestor de Caixa)`);
    
    // Reseta a calculadora e o campo
    salePriceInput.value = '';
    orderItems = [];
    renderCalcTable();
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
        // Sem nuvem: exporta pelo menos a cópia deste aparelho
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

// Importar = JUNTAR: adiciona só os lançamentos que ainda não existem. Não apaga nada.
async function importBackup(event) {
    const arquivo = await lerArquivoJson(event);
    if (!arquivo || !podeGravar()) return;
    try {
        const r = await api('/api/importar', { method: 'POST', body: arquivo });
        alert(`Importação concluída.\n\nNovos lançamentos: ${r.adicionados}\nJá existiam: ${r.existentes}\nIgnorados (inválidos): ${r.invalidos}`);
    } catch (e) {
        alert(`Erro ao importar: ${e.message}`);
    }
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
