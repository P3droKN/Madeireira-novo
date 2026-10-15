# Fase 2: plano (financeiro)

Junta a `ESPEC-financeiro.md` e as decisões do `PLANO.md` (seção 3). **Sem código até a aprovação.**
Tudo é feito e testado primeiro no v2, com os dados reais importados e conferidos.

## Ideia central

Os mesmos lançamentos alimentam dois relatórios:
- **DRE**, pela data de competência: diz se o mês deu lucro.
- **Fluxo de caixa**, pela data em que o dinheiro entra ou sai de cada conta: diz quanto dinheiro há.

Os cálculos ficam em funções puras em `lib/financeiro.js`, com testes. Os percentuais, taxas, prazos e códigos ficam na configuração, editável no admin, e nunca fixos no código.

### O que é gravado
- **Lançamentos** (no mesmo banco de hoje, com campo de versão):
  - venda, saída, transferência e eventos (recebimento, compensação, devolução, conferência de saldo);
  - cada um tem conta do plano de contas, data de competência, data de caixa e conta financeira;
  - a venda tem uma **lista de pagamentos**, cada um com forma, conta, valor, parcelas e tPag. A soma tem que ser igual ao total.
- **Clientes:** nome, telefone e observação.
- **Cheques:** recebidos (em carteira) e emitidos, com número, emissor ou favorecido, banco, data de compensação e situação.
- **Contas a receber (fiado):** cliente, valor, vencimento, pagamentos parciais e situação.
- **Configuração:**
  - plano de contas;
  - contas financeiras (Gaveta, Bradesco, PicPay, Cheques em carteira);
  - forma de pagamento → conta de destino e tPag;
  - taxas e prazos do cartão (débito, crédito à vista, parcelado por número de parcelas), começando em 0%;
  - margem padrão do CMV estimado: 30%;
  - provisão de 13º e férias: ligada (19,44%);
  - FGTS: 8%;
  - estimativa do Simples: **desligada**, com RBT12 opcional;
  - depreciação: opcional.

O saldo de cada conta e a projeção são **calculados** a partir dos lançamentos, pela função `movimentos()`. Não ficam guardados, para nunca saírem de sincronia.

## Entregas (cada uma vai para o v2 e é conferida antes da próxima)

### 2A: base, migração e DRE
- **Formulário novo**, com três tipos: entrada, saída e transferência.
  - **Venda com várias formas de pagamento:** a soma precisa fechar com o total. Campo opcional para o Nº da NF-e.
  - **Saída com "Pago com" obrigatório** (Gaveta, Bradesco, PicPay ou Cheque emitido). O sistema sugere a última conta usada naquela categoria ou fornecedor.
  - A calculadora passa a usar a mesma lista de pagamentos e grava o CMV, como já faz hoje.
- **Migração v1 → v2** (com backup e conferência antes e depois):
  - **Vendas:**

    | Método antigo | Forma nova |
    |---|---|
    | `pix` | PIX Bradesco (tPag 20) |
    | `bradesco` | Transferência Bradesco |
    | `debito` | Débito PicPay |
    | `credito` | Crédito à vista PicPay |
    | `dinheiro` | Dinheiro (Gaveta) |
    | `cheque` | Cheque em carteira |

  - **Custos:** viram "A classificar: compra ou CMV?". A tela sugere pela descrição ("Custo Extraído:" = provável CMV), mas **quem decide é você**.
  - **Despesas** viram "Despesa geral (a classificar)" e **funcionários** viram "Salários".
  - **Saídas antigas pagas em cheque** viram "Cheque emitido", com saída do Bradesco na data de compensação.
  - Tudo fica marcado como **migrado**, com uma **tela de reclassificação em lote**: filtro, seleção múltipla e "aplicar conta" (ex.: corrigir PIX que foi no PicPay).
  - **Acumulado de agosto → lançamentos de abertura de 01 a 23/08/2026**, que entram no DRE e não mexem no caixa:
    - vendas por forma: PIX 12.440 → PIX Bradesco; crédito 16.565; débito 5.757,50; o restante, 14.103,50, como "forma não informada";
    - custo 23.422,50 a classificar;
    - despesa 28.910,55 a classificar;
    - funcionários 16.160,28 → Salários.
  - O `isAgosto2026` some.
  - A conferência passa a comparar também os totais antigos com o DRE migrado, para garantir que nada se perdeu.
- **DRE mensal e anual** (12 colunas + total):
  - % sobre a receita;
  - comparação com o mês anterior e com o mesmo mês do ano anterior;
  - aviso "gerencial" no rodapé;
  - impressão em uma página A4.
  - Como cada linha é calculada:
    - **DAS:** valor real lançado na conta "Impostos (DAS)". A estimativa só aparece se for ligada.
    - **CMV:** o da calculadora. Nas vendas sem itens, é estimado pela margem padrão (30%), marcado "estimado", e passa a usar a média real quando houver 3 meses de vendas pela calculadora.
    - **Provisão** de 13º e férias e **FGTS** estimado: aparecem até o valor real ser lançado.
    - **Retiradas:** ficam abaixo da linha, só como informação.

### Orçamentos (entre a 2A e a 2B, pedido em 14/10)
- Na Calculadora, ao lado de "Registrar venda", fica o botão **"Salvar como orçamento"**.
  - Pede: cliente, WhatsApp com DDD (com validação), origem (Balcão / WhatsApp / Telefone) e observação opcional.
  - Recebe um número sequencial: **ORC-0001**, ORC-0002…
  - Grava os itens com os preços do dia, o % aplicado, o total, o custo e a margem (custo e margem só para uso interno).
- **Validade configurável** (padrão 7 dias).
  - Depois de vencido, o orçamento mostra "preços podem ter mudado" e o botão **"Atualizar preços"**, que recalcula pela tabela atual e mostra a diferença.
- **Cadastro de clientes** compartilhado com o fiado (Fase 2C). *A mensagem chegou cortada neste ponto; falta o resto.*

### 2B: contas, cartão e cheques
- **Tela "Abertura de saldos"** (resposta 3):
  - saldos de Bradesco e PicPay conferidos com os extratos;
  - Gaveta pela contagem, no dia da troca para o sistema novo.
- **Saldo por conta:** saldo inicial com data, mais o botão **"Conferir saldo"**. Você digita o saldo do extrato e o sistema mostra a diferença em relação ao calculado.
- **Fechamento da gaveta:** valor contado × valor calculado.
- **Transferência entre contas** (PicPay → Bradesco, depósito de cheque): não conta como receita nem despesa.
- **Cartão no PicPay:** cada venda (ou cada parcela, em D+30, D+60…) vira um recebível, já descontada a taxa. A taxa vai para "Despesas variáveis".
- **Cheques recebidos:**
  - ficam em carteira até a compensação;
  - na compensação, entram na conta de depósito (padrão Bradesco);
  - **"Cheque devolvido"** marca o cheque e reabre a dívida do cliente.
- **Cheques emitidos:** saem do Bradesco na data de compensação e aparecem na lista "a compensar".
- **Fluxo de caixa** diário e mensal, por conta e consolidado, com **projeção de 30 dias** (recebíveis do PicPay, cheques a receber, cheques emitidos e contas a pagar).

### 2C: fiado e clientes
- **Venda fiado:** entra na receita e no CMV na data da venda e gera uma conta a receber (cliente, valor, vencimento).
- **Recebimento**, inclusive **parcial:** em cheque (vai para a carteira) ou em outra forma (entra na conta).
- **Relatórios:**
  - a receber por cliente, com dias em atraso;
  - cheques a compensar nos próximos 30 dias;
  - total **"na rua"** (fiado + cheques em carteira).

### 2D: relatórios, painel e limpeza
- **Vendas por forma de pagamento** (dia, mês e ano): por forma e por conta, com quantidade. A soma bate com o total de vendas.
  - **CSV** com data, Nº NF-e, forma, tPag e valor, para o escritório conferir com os XMLs.
- **Painel inicial:**
  - faturamento do mês e acumulado no ano;
  - lucro e margem líquida;
  - margem bruta, com alerta se cair 5 pontos frente à média de 3 meses;
  - ponto de equilíbrio e quanto falta vender;
  - ticket médio;
  - saldos e projeção de 30 dias;
  - despesas fixas e pessoal como % do faturamento;
  - top 5 materiais por margem;
  - total na rua.
- **Limpeza:** sai a tela antiga de "Resumo do mês" e o resto do item 13.

## Como cada entrega é testada
- **Testes automáticos** dos cálculos. Alguns exemplos:
  - DAS de 7,19% (se ligado);
  - provisão de 19,44%;
  - parcelas em D+30/D+60;
  - cheque devolvido reabrindo a conta a receber;
  - pagamento parcial;
  - soma das formas = total de vendas.
- **Ensaio no navegador** com o banco simulado e o arquivo real (como foi feito agora). Depois, no v2, com **🔍 Conferir com arquivo** antes e depois de cada migração.

## Respostas (15/10)
1. Estoque **só em R$** (compras − CMV), pronto para ligar por item no futuro: as compras já aceitam itens e a config tem `estoque.porItem`.
2. Cheques emitidos: padrão **Bradesco**, com a conta escolhida em cada cheque.
3. Saldo inicial **no dia da troca**, conferido com os extratos e a contagem da gaveta, na tela "Abertura de saldos" (2B).
4. Cheque de venda à vista: a receita entra na data da venda e o cheque fica **em carteira até compensar**.

## Perguntas originais
1. **Estoque em R$ ou em quantidade?** Proponho só em R$: compras − CMV = "estoque estimado". Controle por peça seria outra fase.
2. **Cheques que a madeireira emite** (os "custo" antigos em cheque): sempre saem do **Bradesco**?
3. **Data do saldo inicial das contas:** proponho começar no dia da troca para o sistema novo, usando o "Conferir saldo" com o extrato daquele dia. Antes disso, o caixa fica só como histórico, e o DRE continua completo desde agosto.
4. **Cheque recebido numa venda à vista**, sem fiado: também fica em carteira até a compensação, igual ao do fiado?
