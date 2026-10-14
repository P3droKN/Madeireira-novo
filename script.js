// --- DATA BASE DA CALCULADORA AGORA VEM DE tabela-precos.js ---


// --- GLOBAL UTILS ---
const formatCurrency = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

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
        tr.innerHTML = `<td>${item.material.replace(/_/g, ' ')}</td><td>${item.dimension}</td><td>${item.displayQuantity}</td><td>${formatCurrency(item.priceUnit)}</td><td>${formatCurrency(item.subtotal)}</td><td><button class="delete-btn" onclick="deleteCalcItem('${item.id}')">Excluir</button></td>`;
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
let acumulado = { venda: 0, pix: 0, credito: 0, debito: 0, custo: 0, despesa: 0, func: 0, dinheiroCaixa: 0 };

async function initDB() {
    try {
        const response = await fetch('/api/getFinance');
        if (response.ok) {
            const data = await response.json();
            
            let fetchedItems = data.financeItems;
            if (typeof fetchedItems === 'string') fetchedItems = JSON.parse(fetchedItems);
            financeItems = fetchedItems || [];
            
            let fetchedAcc = data.acumulado;
            if (typeof fetchedAcc === 'string') fetchedAcc = JSON.parse(fetchedAcc);
            acumulado = Object.assign(acumulado, fetchedAcc || {});
            
            // Salva um backup local ao carregar com sucesso da nuvem
            localStorage.setItem('madeireira_finance', JSON.stringify(financeItems));
            localStorage.setItem('madeireira_acumulado', JSON.stringify(acumulado));
        } else {
            console.error('Falha ao conectar com o banco. Usando fallback local para testes.');
            // Fallback para quando ele testar no PC sem rodar servidor local
            financeItems = JSON.parse(localStorage.getItem('madeireira_finance')) || [];
            acumulado = JSON.parse(localStorage.getItem('madeireira_acumulado')) || acumulado;
        }
    } catch (e) {
        console.warn('Rodando offline. Tentando localStorage.', e);
        financeItems = JSON.parse(localStorage.getItem('madeireira_finance')) || [];
        acumulado = JSON.parse(localStorage.getItem('madeireira_acumulado')) || acumulado;
    }
    renderFinance();
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

document.getElementById('finance-form').addEventListener('submit', (e) => {
    e.preventDefault();
    
    const category = document.getElementById('fin-category').value;
    const type = category === 'venda' ? 'income' : 'expense';
    const value = parseFloat(document.getElementById('fin-value').value);
    const date = document.getElementById('fin-date').value;
    const description = document.getElementById('fin-description').value;
    const method = document.getElementById('fin-method').value;
    
    const item = {
        id: Date.now().toString(),
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

    financeItems.push(item);
    saveFinance();
    
    // Atualiza o painel para refletir a mesma data que o usuário acabou de preencher (Facilita lançamento atrasado)
    document.getElementById('filter-date').value = document.getElementById('fin-date').value;
    
    renderFinance();
    e.target.reset();
    
    // Devolve a data para o que estava antes do reset do formulário
    document.getElementById('fin-date').value = document.getElementById('filter-date').value;
    
    toggleCheckFields();
});

function deleteFinanceItem(id) {
    financeItems = financeItems.filter(i => i.id !== id);
    saveFinance();
    renderFinance();
}

async function saveFinance() {
    // Continua salvando no LocalStorage como redundância offline
    localStorage.setItem('madeireira_finance', JSON.stringify(financeItems));
    
    // Tenta salvar no banco de dados da Vercel
    try {
        const res = await fetch('/api/saveFinance', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ financeItems })
        });
        if (!res.ok) {
            console.error("Erro na Vercel:", await res.text());
            alert("Atenção: Os dados não foram salvos na nuvem. Verifique se rodou 'npx vercel --prod' após conectar o banco.");
        }
    } catch (e) {
        console.warn('Salvamento local efetuado, mas falha ao sincronizar com nuvem.', e);
    }
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
        
        let methodStr = item.method.toUpperCase();
        if(item.method === 'cheque') {
            methodStr += `<br><small style="color:var(--text-muted)">Nº: ${item.checkNumber || '-'} | Para: ${item.checkDate ? item.checkDate.split('-').reverse().join('/') : '-'}</small>`;
        }
        
        let catStr = "";
        if (cat === 'venda') catStr = "Venda (Bruto)";
        if (cat === 'custo') catStr = "Custo Material";
        if (cat === 'funcionario') catStr = "Funcionário";
        if (cat === 'despesa') catStr = "Despesa Geral";

        tr.innerHTML = `
            <td>${item.date.split('-').reverse().join('/')}</td>
            <td>${item.description}</td>
            <td class="${isIncome ? 'type-income' : 'type-expense'}">${catStr}</td>
            <td>${methodStr}</td>
            <td class="${isIncome ? 'type-income' : 'type-expense'}">${formatCurrency(item.value)}</td>
            <td><button class="delete-btn" onclick="deleteFinanceItem('${item.id}')">Excluir</button></td>
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
    
    const dateInput = document.getElementById('direct-sale-date').value;
    const date = dateInput ? dateInput : getLocalDateString();
    
    // Extrai o nome dos materiais
    const materialsList = orderItems.map(item => item.material.replace(/_/g, ' ')).join(', ');
    
    const custoItem = {
        id: Date.now().toString() + 'C',
        category: 'custo',
        type: 'expense',
        value: currentCalcTotal,
        date: date,
        description: `Custo Extraído (Apenas Material): ${materialsList}`,
        method: 'cheque'
    };
    
    financeItems.push(custoItem);
    await saveFinance();
    renderFinance();
    
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
    const saleMethod = document.getElementById('direct-sale-method').value;
    const dateInput = document.getElementById('direct-sale-date').value;
    const date = dateInput ? dateInput : getLocalDateString();
    
    // Extrai o nome dos materiais da calculadora para uma descrição detalhada
    const materialsList = orderItems.map(item => item.material.replace(/_/g, ' ')).join(', ');
    
    // Cria Lançamento da Venda
    const vendaItem = {
        id: Date.now().toString() + 'V',
        category: 'venda',
        type: 'income',
        value: salePrice,
        date: date,
        description: `Venda Direta: ${materialsList}`,
        method: saleMethod
    };
    
    // Cria Lançamento do Custo daquele material
    const custoItem = {
        id: Date.now().toString() + 'C',
        category: 'custo',
        type: 'expense',
        value: currentCalcTotal,
        date: date,
        description: `Custo Extraído: ${materialsList}`,
        method: 'cheque' // Assumimos que o custo material gerado entra no controle de custos (cheque/prazo)
    };
    
    // Salva os dois simultaneamente no array
    financeItems.push(vendaItem, custoItem);
    
    // Salva na nuvem e atualiza a interface
    await saveFinance();
    renderFinance();
    
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
    acumulado = {
        dinheiroCaixa: parseFloat(document.getElementById('mod-acc-dinheiro').value) || 0,
        venda: parseFloat(document.getElementById('mod-acc-venda').value) || 0,
        pix: parseFloat(document.getElementById('mod-acc-pix').value) || 0,
        credito: parseFloat(document.getElementById('mod-acc-credito').value) || 0,
        debito: parseFloat(document.getElementById('mod-acc-debito').value) || 0,
        custo: parseFloat(document.getElementById('mod-acc-custo').value) || 0,
        despesa: parseFloat(document.getElementById('mod-acc-despesa').value) || 0,
        func: parseFloat(document.getElementById('mod-acc-func').value) || 0,
    };
    
    // Salva localmente (redundância)
    localStorage.setItem('madeireira_acumulado', JSON.stringify(acumulado));
    
    // Tenta salvar no banco de dados da Vercel
    try {
        const res = await fetch('/api/saveFinance', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ acumulado })
        });
        if (!res.ok) {
            console.error("Erro na Vercel:", await res.text());
            alert("Atenção: Os Acumulados não foram salvos na nuvem. Verifique o banco.");
        } else {
            alert("Saldos acumulados salvos com sucesso na nuvem!");
        }
    } catch (e) {
        console.warn('Falha ao sincronizar com nuvem.', e);
        alert("Erro de conexão ao salvar Acumulados.");
    }
    
    closeAcumuladoModal();
    renderFinance();
}

// --- BACKUP ---
function exportBackup() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify({ financeItems, acumulado }));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", `madeireira_backup_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
}

function importBackup(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            const imported = JSON.parse(e.target.result);
            
            if (Array.isArray(imported)) {
                financeItems = imported;
                await saveFinance();
            } else if (imported.financeItems) {
                financeItems = imported.financeItems;
                if (imported.acumulado) {
                    acumulado = imported.acumulado;
                    // Salva acumulado localmente
                    localStorage.setItem('madeireira_acumulado', JSON.stringify(acumulado));
                }
                
                // Envia TUDO em uma única requisição para a nuvem para evitar erros!
                const res = await fetch('/api/saveFinance', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ financeItems, acumulado })
                });
                
                if (!res.ok) {
                    throw new Error("Falha ao salvar na nuvem");
                }
            } else {
                throw new Error("Formato inválido");
            }
            
            renderFinance();
            alert("Backup restaurado e sincronizado com sucesso!");
        } catch (err) {
            console.error(err);
            alert("Erro ao ler o arquivo ou salvar na nuvem. Verifique sua conexão.");
        }
    };
    reader.readAsText(file);
    event.target.value = ''; // Reset input
}

// Inicializa a conexão com o Banco
initDB();
