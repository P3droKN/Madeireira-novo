# Especificação financeira: Sistema Madeireira

Use este documento junto com o `PROMPT-claude-code.md`. Ele **substitui a Fase 2** daquele prompt (itens 8 a 13). Leia tudo e me apresente o plano antes de programar.

## Por que mudar

Hoje o sistema mistura duas coisas diferentes:

- **Caixa:** quanto dinheiro entrou e saiu, e em que dia.
- **Resultado:** se a empresa teve lucro ou prejuízo no mês.

A compra de madeira é **saída de caixa**, mas não é despesa do mês: a madeira vira estoque e só vira custo quando é vendida (CMV). Por isso o sistema atual não consegue dizer se o mês deu lucro. Ele também não trata impostos, frete, taxas de cartão nem encargos, e deixa os funcionários fora do resultado.

Exemplo com os dados de agosto/2026 que estão no sistema:
- venda 48.866 − custo 23.422 − despesas 28.910 = **−3.466**;
- descontando os funcionários (16.160), o resultado vai para **−19.627**.

Mas não dá para saber se esse "custo" foi compra de estoque ou custo do que foi vendido. Ou seja, o número atual não é confiável nem para mais nem para menos.

A solução são **dois relatórios separados**, alimentados pelos mesmos lançamentos:

1. **DRE gerencial** (regime de competência): mostra o lucro.
2. **Fluxo de caixa** (regime de caixa): mostra o dinheiro.

---

## 1. Plano de contas

Cada lançamento tem uma **conta** (lista abaixo), **data de competência** (quando aconteceu), **data de caixa** (quando o dinheiro entrou ou saiu), **forma de pagamento** e **conta financeira** (Gaveta, Bradesco, etc.).

| Grupo | Contas | Entra no DRE? | Entra no caixa? |
|---|---|---|---|
| **Receita** | Venda de produtos; Frete cobrado do cliente; Serviços (corte, cepilhamento cobrado à parte) | Sim | Sim (na data do recebimento) |
| **Deduções** | Impostos sobre vendas (DAS); Descontos concedidos; Devoluções | Sim | Sim (DAS no vencimento) |
| **CMV** | Custo da mercadoria vendida (calculado automaticamente) | Sim | **Não** |
| **Compras / estoque** | Compra de madeira e materiais; Frete sobre compras | **Não** (vira estoque e CMV) | Sim |
| **Despesas variáveis de venda** | Taxa de maquininha/cartão; Frete de entrega (custo do caminhão/terceiro); Comissões | Sim | Sim |
| **Pessoal** | Salários; FGTS; Provisão de 13º e férias; Vale-transporte/alimentação; Rescisões | Sim | Sim (provisão: não) |
| **Despesas fixas / administrativas** | Pró-labore; Aluguel; Energia; Água; Telefone/internet; Contador; Sistemas; Seguros; Material de escritório | Sim | Sim |
| **Operacionais** | Combustível; Manutenção de veículos; Manutenção de máquinas (serra, plaina); Ferramentas e lâminas | Sim | Sim |
| **Financeiras** | Tarifas bancárias; Juros; Desconto/antecipação de cheque e cartão; Receita de rendimentos | Sim | Sim |
| **Investimentos** | Compra de máquina, veículo, reforma | **Não** (opcional: depreciação mensal no DRE) | Sim |
| **Sócios** | Retirada do dono (além do pró-labore); Aporte | **Não** (é distribuição de lucro) | Sim |
| **Movimentação** | Transferência entre contas (gaveta → banco) | Não | Neutra |

Regras importantes:

1. **Frete sobre compras** entra no custo de aquisição do material, não em despesa.
2. **Retirada do dono não é despesa.** Se misturar, o lucro fica falso. Pró-labore fixo é despesa; o resto é retirada.
3. **Compra de máquina não é despesa do mês.** Registrar como investimento e, se quiser, gerar depreciação mensal (ex.: máquina de R$ 60 mil em 10 anos = R$ 500/mês).

---

## 2. CMV: custo da mercadoria vendida

- **Venda feita pela calculadora:** o CMV é o custo dos itens do pedido (a partir de `data/custos.json`). Gravar junto com a venda, sem lançamento separado de "custo".
- **Venda lançada só com valor (sem itens):** o CMV é estimado como venda × (1 − margem bruta média dos últimos 3 meses), marcado como **"estimado"**.
- **Conferência mensal (opcional, fase futura):** CMV real = estoque inicial + compras − estoque final. Deixar um campo para o valor do inventário no fim do mês e mostrar a diferença entre o CMV calculado e o real. A diferença indica perdas, quebras ou preço desatualizado.

---

## 3. Impostos

Configuração editável na tela de admin, **sem nada fixo no código**:

- Regime: `simples_nacional` (padrão) | `lucro_presumido` | `outro`.
- Simples Nacional, **Anexo I (comércio)**. Tabela padrão (vigente em 2026, confirmar com o contador):

| RBT12 (receita dos últimos 12 meses) | Alíquota nominal | Parcela a deduzir |
|---|---|---|
| até 180.000 | 4,00% | 0 |
| até 360.000 | 7,30% | 5.940 |
| até 720.000 | 9,50% | 13.860 |
| até 1.800.000 | 10,70% | 22.500 |
| até 3.600.000 | 14,30% | 87.300 |
| até 4.800.000 | 19,00% | 378.000 |

- Alíquota efetiva = (RBT12 × alíquota nominal − parcela a deduzir) ÷ RBT12.
- **DAS estimado do mês** = receita bruta do mês × alíquota efetiva. Aparece no DRE como "estimado" até o usuário lançar o valor real da guia paga, que substitui a estimativa.
- No Simples (Anexo I), o INSS patronal já está dentro do DAS. O FGTS (8% sobre salários) é pago à parte.
- **Provisão de 13º e férias:** opcional, padrão ligado. Provisão mensal = salários × (1/12 + 1/12 × 4/3) ≈ salários × 19,44%. Entra no DRE todo mês, para dezembro e o mês de férias não parecerem prejuízo. No caixa, só quando é pago.

---

## 4. Recebimentos

- **Cartão de crédito:** prazo e taxa configuráveis (padrão D+30 e taxa %). A venda entra no DRE no dia da venda. No caixa, entra o valor líquido na data prevista.
- **Débito:** D+1, com taxa configurável.
- **PIX e dinheiro:** D+0, sem taxa.
- **Cheque (recebido ou emitido):** no caixa, na **data de compensação**. Lista de "cheques a compensar" com vencimento.
- **Fiado / a prazo:** se existir, criar "Contas a receber" com vencimento e status (aberto / pago / atrasado).

---

## 5. Relatórios

### 5.1 DRE gerencial (mensal, e anual com 12 colunas + total)

```
(+) Receita bruta
(−) Deduções (DAS, descontos, devoluções)
(=) RECEITA LÍQUIDA
(−) CMV
(=) LUCRO BRUTO                     → margem bruta %
(−) Despesas variáveis de venda (cartão, frete de entrega, comissões)
(=) MARGEM DE CONTRIBUIÇÃO          → MC %
(−) Pessoal (salários + FGTS + provisões)
(−) Despesas fixas / administrativas
(−) Operacionais
(=) RESULTADO OPERACIONAL (EBITDA)
(−/+) Resultado financeiro
(−) Depreciação (se ligada)
(=) LUCRO LÍQUIDO                   → margem líquida %
    Retiradas do dono (abaixo da linha, só informativo)
    Lucro retido = lucro líquido − retiradas
```

Cada linha com % sobre a receita bruta e comparação com o mês anterior e com o mesmo mês do ano anterior.

### 5.2 Fluxo de caixa (diário e mensal)

- Saldo inicial → entradas → saídas (por grupo) → saldo final, **por conta financeira** (Gaveta, Bradesco, …) e consolidado.
- A gaveta tem **fechamento do dia**: saldo contado × saldo calculado, com a diferença registrada.
- **Projeção dos próximos 30 dias:** recebíveis de cartão, cheques a compensar, contas a pagar lançadas.

### 5.3 Painel de indicadores (tela inicial)

1. Faturamento do mês e acumulado no ano
2. Lucro líquido do mês e margem líquida %
3. Margem bruta % (alerta se cair mais de 5 pontos frente à média de 3 meses)
4. **Ponto de equilíbrio** = (pessoal + fixas + operacionais) ÷ MC%, com quanto falta vender no mês para chegar nele
5. Ticket médio e número de vendas
6. Saldo de caixa hoje e projeção de 30 dias
7. Despesas fixas e pessoal como % do faturamento
8. Top 5 materiais por margem (em R$) no mês, quando a venda vem da calculadora

Impressão: DRE do mês e DRE anual em uma página A4, no lugar do relatório atual.

---

## 6. Migração dos dados atuais

- Fazer **backup** do KV antes de tudo e não apagar a estrutura antiga até eu aprovar.
- Mapear os lançamentos existentes para o novo plano de contas:
  - venda → Venda de produtos;
  - funcionario → Salários;
  - despesa → "Despesa geral (a classificar)";
  - **custo → "A classificar: compra ou CMV?"**. Mostrar uma tela para eu reclassificar em lote. **Não decidir sozinho.**
- O "acumulado" manual de agosto/2026 vira um **saldo de abertura** com data, e não um caso especial no código.

## 7. Regras

- Todos os cálculos (DAS, CMV, provisões, DRE) ficam em funções puras num arquivo separado (ex.: `financeiro.js`), com testes. Exemplo de teste: RBT12 = 600.000 → alíquota efetiva = (600.000 × 9,5% − 13.860) ÷ 600.000 = **7,19%**; receita do mês de 50.000 → DAS de aproximadamente **R$ 3.595**.
- Os percentuais (tabela do Simples, taxas de cartão, provisões) ficam numa config editável, nunca no código.
- O sistema é **gerencial**: ele não substitui a contabilidade oficial do contador. Mostrar esse aviso no rodapé do DRE.
- Manter HTML/JS puro + Vercel.
