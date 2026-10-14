Contexto: este é o sistema da madeireira do meu pai (Calculadora + Gestor de Caixa), em HTML/JS puro, com APIs serverless na Vercel e Vercel KV. Coloquei em `data/custos.json` os custos atualizados. Esse arquivo passa a ser a fonte da verdade dos custos e substitui o `tabela-precos.js`. O campo `duvidas` lista pendências: não invente valores para elas.

PREÇOS DE VENDA: ainda não existem no sistema, e as tabelas impressas estão desatualizadas. Não importe nenhum preço de venda. Crie a estrutura com o campo de venda vazio (null) para cada item e acabamento do catálogo, editável numa tela de admin, para meu pai preencher aos poucos. Enquanto estiver vazio, o vendedor digita o preço na hora.

Primeiro leia o projeto inteiro e me devolva:
(1) a lista dos problemas abaixo confirmados ou refutados no código;
(2) um plano por fases.
Não escreva código antes de eu aprovar.

PROBLEMAS QUE ENCONTREI

Dados e calculadora:
1. Os preços estão em `tabela-precos.js` com `venda: 0` em tudo. Migrar os custos para `data/custos.json` e os preços de venda para o KV (vazios, editáveis no admin), sem preço no código.
2. O `<select>` de materiais está fixo no HTML e não bate com os dados (o RETALHO existe nos dados mas não aparece; jequitibá, assoalho, rodapé, beiral e eucalipto roliço não existem). Gerar a lista a partir dos dados.
3. As unidades estão erradas em alguns itens:
   - eucalipto roliço é por PEÇA, mas está como metro linear;
   - o pinus diz "cada peça = 2,5 m", mas existem peças de 3 m e 4 m;
   - caixilho é por jogo completo (madeira + vistas);
   - vistas são vendidas por jogo (4 peças) ou meio jogo.
   Unidades corretas: metro linear (cedro, cambará, itaúba, jequitibá, eucalipto, meia cana, rodapé, beiral), peça (pinus, eucalipto roliço, madeirite, pregos por saco), m² (forro, deck, assoalho), jogo ou meio jogo (caixilho, vistas).
4. Falta escolher o acabamento BRUTO ou CEPILHADO por item. Cada acabamento terá seu próprio preço de venda; o custo é o mesmo (só existe custo bruto).
5. A tabela do pedido mostra só o custo. Mostrar por item: custo, preço de venda, subtotal de venda e margem. No rodapé: total de custo, total de venda e margem %.
6. O preço de venda de cada item precisa ser editável no pedido, com modificadores:
   - "madeira selecionada / escolhida" (+%)
   - "últimas peças" (−%)
   - ajuste manual com motivo
   Os percentuais ficam numa config editável.
7. Cedro: CEDRO_MESCLADO e CEDRO_VERMELHO usam o mesmo custo (CEDRO), mas têm preços de venda diferentes.

Gestor de Caixa:
8. Possível CUSTO EM DOBRO: "Lançar Venda e Custo Juntos" cria uma saída de custo do material vendido. Se a compra do material também é lançada como "Custo de Material", o mesmo custo é descontado duas vezes. Proposta:
   - separar "Compra de material" (saída de caixa real);
   - "Custo da mercadoria vendida" (CMV), informativo para calcular margem, que não sai do caixa.
   Me mostre a proposta antes de mudar.
9. O resultado do mês (venda − custo − despesa) não desconta Funcionários. Confirme se é bug.
10. O detalhamento de vendas (PIX/Bradesco, crédito, débito) não inclui dinheiro nem cheque, então a soma não fecha com o total de vendas.
11. O "Acumulado" está fixo para agosto/2026 no código (`isAgosto2026`). Trocar por saldo de abertura com mês de referência.
12. O custo é sempre lançado como "cheque", fixo no código. Deixar escolher.
13. Código redundante:
    - `exportToFinance` não é usado;
    - `registerDirectSale` e `registerDirectCost` repetem código;
    - em `renderFinance`, os blocos "do dia" e "anteriores" são copiados;
    - as opções de forma de pagamento estão duplicadas no HTML e no JS;
    - PIX/crédito/débito aparecem duas vezes (cards e tabela).
    Simplificar sem mudar o comportamento.
14. Risco de perder dados:
    - `saveFinance` regrava a lista inteira a cada lançamento, então dois aparelhos ao mesmo tempo podem apagar dados um do outro;
    - se carregar do localStorage offline e depois salvar, pode sobrescrever a nuvem com dados velhos.
    Proponha a solução mais simples (por exemplo, salvar lançamento a lançamento ou checar versão).
15. As rotas `/api/getFinance` e `/api/saveFinance` não têm nenhuma autenticação. Adicionar uma senha simples via variável de ambiente.
16. A caixa "Lançamento Inteligente" tem fundo claro (#f8fafc) com texto claro do tema escuro, então fica ilegível.

FASES (nesta ordem)
- Fase 0: itens 15 e 14 (segurança e dados).
- Fase 1: itens 1 a 7 (catálogo único de custo e venda, e calculadora nova).
- Fase 2: itens 8 a 13 e 16 (lógica do caixa e limpeza).

REGRAS
- Manter HTML/JS puro + Vercel. Não migrar para framework.
- Não perder nem alterar os lançamentos já salvos no KV. Faça backup antes de qualquer migração.
- Todo cálculo de preço numa função única (ex.: `calcularItem()`), que depois vai ser reaproveitada por um agente de orçamento de WhatsApp.
- Escrever testes simples para o cálculo, por exemplo:
  - Cambará 1x2, 6 peças x 3 m: custo 6 × 3 × 3,44 = R$ 61,92;
  - Pinus 2x4x3,00, 10 peças: custo 10 × 18,36 = R$ 183,60;
  - venda digitada de R$ 90,00 no cambará acima: margem = (90 − 61,92) ÷ 90 = 31,2%.
- No fim de cada fase, me diga o que mudou e como testar.
