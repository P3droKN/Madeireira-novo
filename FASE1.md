# Fase 1: catálogo único e calculadora nova

## O que mudou

**Catálogo (itens 1, 2, 3 e 7)**
- Os custos vêm só de `data/custos.json`. O `tabela-precos.js`, que tinha custos velhos, foi removido.
- A lista de materiais é gerada a partir dos dados. São 19 materiais e 198 itens, incluindo jequitibá, assoalho, rodapé, beiral, eucalipto roliço e retalho.
- Cedro Mesclado e Cedro Vermelho são materiais separados, com preços de venda separados, mas usam o mesmo custo (CEDRO).
- **Unidades corrigidas:**

  | Unidade | Materiais |
  |---|---|
  | metro linear (peças × comprimento) | madeiras, meia cana, rodapé, beiral |
  | peça | pinus (comprimento na medida) e eucalipto roliço |
  | chapa | madeirite |
  | m² | forro, deck, assoalho |
  | jogo completo | caixilho |
  | jogo (4 peças) ou meio jogo | vistas |
  | saco | pregos |
  | valor livre, com descrição | retalho |

- Itens sem custo na folha (assoalho emendado) aparecem como "sem custo". Nenhum valor foi inventado.
- O arquivo de custos não fica mais aberto no site. A calculadora busca os custos pela API, que exige senha.

**Preços de venda (itens 1, 4 e 6)**
- Nova aba **Preços**:
  - preço por item e acabamento (Bruto/Cepilhado, ou Único);
  - margem calculada ao digitar;
  - filtro por material e "só sem preço".
- **Nenhum preço foi importado.** Tudo começa vazio.
- Na mesma aba ficam os ajustes:
  - % de "madeira selecionada";
  - % de "últimas peças";
  - quais materiais têm cepilhado (`tem_cepilhado`). O padrão é ligado para cedros, cambará, itaúba, jequitibá e pinus, e **desligado para o eucalipto**.

**Pedido: o preço sempre parte da tabela, e o vendedor ajusta livremente (itens 5 e 6, e a caixa ilegível do item 16)**
- **Cada linha mostra:**
  - o preço de tabela (cinza, pequeno);
  - o preço final editável;
  - o % de variação (editável);
  - a variação em R$ e %: verde se acima da tabela, laranja se abaixo.
- **Preço e % ficam sincronizados:**
  - digitar +10% recalcula o preço (1.500 → 1.650), e aceita negativo (−5% → 1.425);
  - digitar o preço (2.100) recalcula o % (+40%);
  - o % vale sobre o total de tabela do item, então fica exato nos centavos.
- **No total do pedido:**
  - o **total final** é editável, e a diferença é distribuída proporcionalmente entre os itens (a soma bate no centavo e o CMV não muda);
  - há também um **% geral sobre a tabela**;
  - sempre visíveis: total de tabela, total final, variação (R$ e %), custo e margem.
- **Motivo opcional**, que não trava a venda. Os botões rápidos ficam ao lado do %, na linha e no total: Selecionada, Últimas peças, Cliente antigo, Frete/entrega, Urgência e Outro (só "Outro" pede texto).
  - "Selecionada" e "Últimas peças" são atalhos que aplicam o % padrão da aba Preços.
- **"↺ Voltar ao preço de tabela"** em cada linha e no total.
- **Item sem preço de tabela:** o vendedor digita o preço. A venda só é registrada quando todos os itens têm preço.
- **Avisos:** item sem preço e item sem custo.
- O pedido e os ajustes não se perdem se a página recarregar.
- **💬 Texto para WhatsApp:** itens e total, **sem custo, margem nem preço de tabela**, com os botões "Copiar texto" e "Abrir no WhatsApp".
- **Na impressão:** custo, margem e ajustes não aparecem, porque a folha vai para o cliente.

**Registrar venda (lógica nova)**
- É **um lançamento só**. A venda grava, **por item e no total**:
  - o preço de tabela;
  - o preço final;
  - a variação;
  - o motivo;
  - o **custo dos itens (CMV)**.
- Não cria mais a saída de "custo" separada, que contava o custo em dobro (item 8).
- O botão "Lançar apenas Custo" saiu da calculadora. Compra de material é lançada no Gestor de Caixa (vira estoque na Fase 2).
- A caixa saiu do fundo branco e segue o tema escuro.

**Função única de cálculo**
- `lib/calculo.js` › `calcularItem()`. É uma função pura, a mesma no navegador, nos testes e, depois, no agente de WhatsApp.

## Observações
- O **Gestor de Caixa ainda não mostra o CMV** das vendas novas. O DRE (lucro do mês) entra na Fase 2. Até lá, o "resultado" da tela antiga não desconta o custo dessas vendas. Como isso só roda no site de testes, não afeta o site do seu pai.
- No site de testes **sem banco**:
  - a calculadora funciona, porque os custos vêm do arquivo;
  - a aba Preços mostra um aviso e **não salva**;
  - "Registrar venda" não grava, porque o caixa fica em "sem conexão".

## Como testar

### Automático
```bash
npm install
npm test
```
São 43 testes. Entre eles:
- os 3 exemplos do pedido: Cambará = R$ 61,92; Pinus = R$ 183,60; venda de R$ 90 = margem 31,2%;
- roliço por peça, vistas em jogo e meio jogo, m² com fração, peças inteiras;
- preço a partir da tabela: % → preço (1.500 → 1.650 → 1.425), preço → % (2.100 = +40%), % exato nos centavos;
- rateio do total entre os itens, com soma exata e CMV igual;
- texto do WhatsApp sem custo nem margem;
- retalho, item sem custo e totais do pedido;
- catálogo completo sem preços, acabamentos e validação das chaves;
- preços e config no banco, backup e restauração incluindo os preços, CMV gravado na venda.

### No navegador
Rodei a tela inteira contra o banco simulado, e todos os passos passaram:
- catálogo gerado;
- Cambará 6 × 3 m = R$ 61,92 e margem de 31,2% com R$ 5/m;
- eucalipto sem cepilhado; roliço e pinus sem comprimento;
- preço salvo na aba Preços, com 10% de selecionada → R$ 6,05;
- ajuste com motivo; retalho;
- impressão sem custo;
- pedido mantido depois de recarregar;
- venda bloqueada sem motivo e depois registrada com CMV, sem lançamento de custo separado.

### No site de testes, sem banco
1. Abra o site e digite a senha. O topo mostra "198 itens no catálogo".
2. Monte os exemplos acima e confira os números.
3. Abra `<link do site>/data/custos.json`. Deve voltar para a página inicial, sem mostrar os custos.
