# Fase 2B: contas, cartão, cheques e projeção

## O que mudou
Duas seções novas no **Financeiro**: **Caixa e saldos** e **Cheques**.

**Abertura de saldos (no dia da troca)**
- Data, mais o saldo de cada conta no **início do dia**:
  - Gaveta, pela contagem;
  - Bradesco e PicPay, pelos extratos;
  - Cheques em carteira, com sugestão automática pelos cheques recebidos antes da data que ainda vão compensar.
- Dá para **refazer**. As aberturas anteriores ficam guardadas no histórico.

**Saldos hoje**
- Por conta e o total. São calculados: abertura + tudo o que entrou e saiu desde então.
- **"Conferir com o extrato"** e **"Fechar gaveta (contagem)"**: você digita o valor real e o sistema mostra a diferença em relação ao calculado. A diferença revela lançamentos esquecidos, e a última conferência fica no quadro de cada conta.

**Como o dinheiro anda** (`lib/caixa.js`, com testes)

| Origem | Conta | Quando |
|---|---|---|
| Dinheiro | Gaveta | na hora |
| PIX Bradesco, Transferência | Bradesco | na hora |
| PIX PicPay | PicPay | na hora |
| Débito | PicPay | D+1, sem a taxa |
| Crédito à vista | PicPay | D+30, sem a taxa |
| Crédito parcelado | PicPay | uma parcela a cada 30 dias, sem a taxa da quantidade de parcelas, centavos exatos |
| Cheque recebido | Cheques em carteira → conta de depósito (padrão Bradesco, trocável em cada cheque) | entra na carteira na venda; passa para o banco na data de compensação |
| Saídas | Gaveta, Bradesco ou PicPay | na data do pagamento (pode ser futura: vira "conta a pagar") |
| Cheque emitido | a conta escolhida | na data de compensação |
| Transferência | sai de uma conta e entra na outra | na data |

- Os lançamentos de abertura de agosto e as vendas com "forma não informada" não mexem no caixa.

**Projeção dos próximos 30 dias**
- Cartão a receber (PicPay), cheques a compensar, cheques emitidos e contas a pagar lançadas.
- Saldo hoje → saldo em 30 dias, no total e por conta.
- Lista dia a dia com o que entra e o que sai.

**Fluxo de caixa mensal**
- Consolidado ou por conta: saldo inicial, entradas por tipo, saídas por grupo, saldo final e dia a dia.
- No consolidado, as transferências e a compensação de cheque (carteira → banco) não aparecem, porque são movimentos internos.

**Cheques**
- Quadros:
  - em carteira;
  - compensam nos próximos 30 dias;
  - **devolvidos (cobrar do cliente)**;
  - emitidos a compensar.
- **Recebidos:**
  - mudar a data de compensação;
  - mudar a conta de depósito;
  - **Devolvido** (com a data): antes da compensação, sai da carteira; depois, estorna no banco;
  - **Desfazer**.
- **Emitidos:** mudar a data de compensação (cheque adiado) e a conta.
- Na 2C, o cheque devolvido vai ser ligado à conta a receber do cliente.

**Configuração:** conta de depósito padrão dos cheques recebidos.

## Como testar no v2
1. **Financeiro › Caixa e saldos.** Aparece o pedido de abertura.
   - Confira a sugestão de "Cheques em carteira" com os cheques que estão na gaveta.
   - Digite a contagem da gaveta e os saldos dos extratos do Bradesco e do PicPay de hoje › **Salvar abertura**.
2. Os saldos de hoje devem bater com o que você digitou. Lance uma venda em dinheiro e uma saída paga com o Bradesco e veja os saldos mudarem.
3. **Fechar gaveta:** conte a gaveta, digite o valor e veja a diferença. Faça o mesmo com o extrato do Bradesco ("Conferir com o extrato").
4. **Projeção:** lance uma venda no crédito parcelado 3x, uma compra com cheque emitido para daqui a 10 dias e uma conta a pagar com data futura, e confira a lista dia a dia.
5. **Cheques:** marque um cheque como **Devolvido** e veja o saldo e o quadro "Devolvidos". Depois use **Desfazer**. Mude a data de compensação de um cheque emitido.
6. **Fluxo de caixa:** escolha o mês e cada conta, e compare com os extratos.

## Como voltar atrás
- **Código:** Vercel › madeireira.v2 › Deployments › deploy anterior ("Orçamentos…") › **Instant Rollback**. Ou reverta o commit "Fase 2B…" no GitHub.
- **Dados:**
  - a abertura e as conferências ficam numa chave nova (`madeireira_saldos`), que entra no backup e na restauração;
  - as ações nos cheques só acrescentam campos no próprio lançamento (`devolvidoEm`, `contaDeposito`, nova data de compensação, `historicoCheque`).
  - Os saldos e a projeção **não são gravados**: são calculados na hora a partir dos lançamentos. Por isso, voltar o código não deixa nada inconsistente.

## Testes
- **Automáticos:** 96 (`npm test`), incluindo:
  - PIX e dinheiro no dia;
  - débito D+1 e crédito D+30 sem a taxa;
  - parcelado 3x com centavos exatos;
  - cheque compensado, devolvido antes e depois;
  - cheque emitido na conta escolhida;
  - transferência;
  - saldos com abertura;
  - projeção de 30 dias;
  - fluxo mensal consolidado e por conta;
  - carteira sugerida;
  - abertura com histórico, conferência e ações nos cheques no servidor.
- **No navegador:** os 23 passos da 2B passaram, entre eles:
  - abertura com a sugestão de cheques;
  - saldos, conferência da gaveta com a diferença;
  - projeção, com a venda antiga no crédito caindo depois da abertura;
  - fluxo consolidado e do Bradesco;
  - cheque devolvido e desfeito, conta de depósito, cheque emitido adiado;
  - refazer abertura.
- Todas as baterias anteriores continuam passando (Fase 0, preços, importação em lotes, trava, 2A e orçamentos).
