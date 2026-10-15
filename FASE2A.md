# Fase 2A: financeiro novo (base, migração e DRE)

## O que entrou

**Aba "Financeiro"**, com quatro partes:

1. **Lançar**
   - **Venda:**
     - aceita **várias formas de pagamento**, e a soma precisa fechar com o total;
     - campos de Nº da NF-e e cliente;
     - cheque com nº, emissor, banco e data de compensação;
     - crédito parcelado de 2 a 12x;
     - custo (CMV) opcional: sem ele, o DRE estima e marca como "estimado".
   - **Saída:**
     - conta do plano de contas;
     - **"Pago com" obrigatório** (Gaveta, Bradesco, PicPay ou Cheque emitido), com sugestão da última conta usada para o mesmo fornecedor ou conta;
     - data do pagamento;
     - **cheque emitido:** nº, favorecido, data de compensação e **conta escolhida em cada cheque** (padrão Bradesco);
     - vida útil (para depreciação) nos investimentos.
   - **Outra entrada:** rendimentos e aporte.
   - **Transferência entre contas:** não é receita nem despesa.
2. **Lançamentos**
   - Lista com filtros (mês, a classificar, com sugestão, entradas, saídas, migrados, conta e busca).
   - **Ações em lote:**
     - aplicar conta;
     - aceitar sugestões;
     - trocar forma de pagamento (ex.: PIX Bradesco → PIX PicPay).
   - A conta e a forma originais ficam guardadas.
3. **DRE gerencial**
   - **Mensal:**
     - com % da receita;
     - comparação com o mês anterior e com o mesmo mês do ano anterior;
     - avisos (custos a classificar, CMV estimado);
     - retiradas abaixo da linha e lucro retido;
     - compras do mês (viram estoque);
     - **estoque estimado em R$** (compras − CMV);
     - ponto de equilíbrio.
   - **Anual:** 12 meses + total.
   - Impressão em A4 e aviso "gerencial" no rodapé.
4. **Configuração**
   - formas de pagamento: conta de destino e código **tPag** (PIX Bradesco 20, PIX PicPay 17);
   - cartão: taxa e prazo do débito e do crédito, e taxa por nº de parcelas, tudo começando em 0%;
   - margem padrão do CMV (30%);
   - FGTS (8%, estimado até a guia ser lançada);
   - provisão de 13º e férias (19,44%, ligada);
   - regime, com a estimativa do Simples **desligada** e RBT12 opcional;
   - depreciação;
   - estoque inicial em R$.

**Calculadora**
- "Registrar venda" passa a usar o mesmo editor de **várias formas de pagamento**, com Nº da NF-e.
- A venda é gravada no formato novo: CMV exato, itens, preço de tabela e variação.

**Regras do DRE** (`lib/financeiro.js`, com testes)
- **DAS** é o valor real da guia, lançado em "Impostos (DAS)". A estimativa do Simples só aparece se for ligada (teste: RBT12 600 mil → 7,19%; 50 mil → R$ 3.595).
- **CMV:**
  - vendas da calculadora usam o custo gravado;
  - custos antigos entram quando classificados como CMV;
  - vendas novas sem itens recebem estimativa pela margem padrão, que passa a ser a média real quando houver 3 meses de vendas pela calculadora;
  - **vendas antigas não recebem estimativa**, para não contar o custo em dobro com os custos classificados.
- **Compras** viram estoque e ficam fora do resultado.
- **Custos "a classificar"** ficam fora, com aviso de que o lucro pode estar maior.
- **Despesas "a classificar"** entram, para o lucro não parecer maior do que é.
- **Retirada do dono** fica abaixo da linha. **Transferências** não entram.

## Migração para o financeiro novo (botão na aba Financeiro)

**O que ela faz:**
- **Vendas antigas:** `pix` → **PIX Bradesco** (tPag 20), `bradesco` → **Transferência Bradesco** (18), débito/crédito → PicPay, cheque → Cheques em carteira (com a data de compensação).
- **Custos** → "A classificar: compra ou CMV?", com sugestão:
  - o par da "Venda e Custo Juntos" (mesmo número com V e C) → CMV daquela venda;
  - "apenas custo" → compra.
- **Despesas** → "Despesa geral (a classificar)". **Funcionários** → Salários.
- **Saídas antigas em cheque** → cheque emitido pelo Bradesco, na data de compensação.
- **Acumulado de agosto** → **7 lançamentos de abertura** (vendas por forma, custo, despesa e funcionários), datados de 23/08/2026. Entram no DRE e não no caixa.
  - A gaveta (R$ 2.871,65) fica para a tela "Abertura de saldos" (Fase 2B).

**Proteções:**
- Nada é apagado: os campos antigos continuam em cada lançamento.
- Antes, guarda uma cópia no banco.
- Pode ser rodada de novo sem duplicar nada.
- A tela antiga do caixa continua mostrando os mesmos totais, sem contar agosto em dobro.

## Como testar no v2 (https://madeireirav2.vercel.app)
1. Confirme antes que a importação deu **"Tudo confere"** (Gestor de Caixa › 🔍 Conferir com arquivo).
2. **Financeiro** › aviso amarelo › **1. Baixar backup** › **2. Migrar**.
3. **Gestor de Caixa** › **🔍 Conferir com arquivo**, com o arquivo do site original. Deve dar **"Tudo confere"**, com as linhas novas **"Abertura × acumulado"** também batendo.
4. **Financeiro** › **Lançamentos** › Mostrar: **Com sugestão** › selecionar todos › **Aceitar sugestões**. Depois, Mostrar: **A classificar** e classifique o resto em lote.
   - Se algum PIX antigo foi PicPay: Mostrar **Entradas**, marque as vendas › **Trocar forma** › PIX PicPay.
5. **Lançar:**
   - uma venda com duas formas (ex.: dinheiro + PIX PicPay) e Nº de NF-e;
   - uma saída com fornecedor;
   - uma segunda saída do mesmo fornecedor, que deve vir com o "Pago com" sugerido;
   - uma compra paga com cheque emitido.
6. **Calculadora:** registre uma venda com duas formas de pagamento.
7. **DRE:** confira agosto, setembro e outubro e o ano, e imprima.
8. **Configuração:** coloque a taxa real do débito e veja a linha "Taxas de cartão" mudar no DRE.

## Testes
- **Automáticos:** `npm test`, com 70 testes (DRE, Simples, provisões, CMV estimado e média real, taxa de cartão, depreciação, estoque, migração, abertura, validação, reclassificação, configuração).
- **No navegador, com dados sintéticos:** os 27 passos da 2A passaram, e as baterias anteriores continuam passando.
