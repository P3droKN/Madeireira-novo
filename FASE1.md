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

**Pedido (itens 5 e 6, e a caixa ilegível do item 16)**
- Cada item mostra quantidade, custo, venda unitária (editável), venda total e margem.
- Os totais mostram custo, venda e margem %. Quando faltam preços, a margem avisa que considera só os itens com preço.
- **Preço editável na linha:**
  - sem preço de tabela, o campo fica em destaque e o vendedor digita;
  - com preço de tabela, mudar o valor **pede o motivo**, e a venda não é registrada sem ele;
  - a linha tem um botão "informar motivo".
- **Modificadores** "Selec." e "Últ." em cada linha, aplicados sobre o preço de tabela.
- **Avisos:** item sem preço, item sem custo e preço alterado sem motivo.
- O pedido não se perde se a página recarregar.
- **Na impressão:** custo e margem não aparecem, porque a folha vai para o cliente.

**Registrar venda (lógica nova)**
- É **um lançamento só**: a venda, com o **custo dos itens (CMV)** e a lista de itens guardados dentro dela.
- Não cria mais uma saída de "custo" separada, que era o que contava o custo em dobro (item 8).
- O botão "Lançar apenas Custo" saiu da calculadora. Compra de material é lançada no Gestor de Caixa (vira estoque na Fase 2).
- O "valor cobrado" é preenchido com a soma dos itens. Se o vendedor mudar, aparece o desconto ou acréscimo e a margem final.
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
São 36 testes. Entre eles:
- os 3 exemplos do pedido: Cambará = R$ 61,92; Pinus = R$ 183,60; venda de R$ 90 = margem 31,2%;
- roliço por peça, vistas em jogo e meio jogo, m² com fração, peças inteiras;
- modificadores e motivo obrigatório;
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
