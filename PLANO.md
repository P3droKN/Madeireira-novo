# Sistema Madeireira: diagnóstico e plano

Base: `index.html`, `script.js`, `styles.css`, `tabela-precos.js`, `api/getFinance.js`, `api/saveFinance.js`, `package.json`, `dados-iniciais.json`, `data/custos.json`, `PROMPT-claude-code.md` e `ESPEC-financeiro.md`.
Nenhum código foi alterado. O commit `82d59cf` guarda o código original, como você enviou.

---

## 1. Os 16 problemas

### Dados e calculadora

| # | Situação | O que está no código |
|---|---|---|
| 1 | **Confirmado** | `tabela-precos.js` tem `venda: 0` em todos os itens. Os custos dele também estão **desatualizados** em relação ao `custos.json`: pinus 1x2 custa 2,40 contra 2,97, caixilho 10 cm custa 60 contra 131,50, e meia cana, vistas e forro pinus também mudaram. Ou seja, o custo que a calculadora lança hoje está **baixo**. |
| 2 | **Confirmado** | O `<select>` está fixo em `index.html:27-42`. RETALHO existe em `tabela-precos.js`, mas não aparece. Jequitibá, assoalho, rodapé, beiral e eucalipto roliço (como item próprio) não existem. |
| 3 | **Confirmado** | Os três roliços estão dentro de `EUCALIPTO`, com unidade `linear_meters`. Por isso a calculadora pede comprimento e multiplica o preço da peça por peças × metros, o que dá um custo errado. O pinus tem o rótulo "cada peça = 2,5m", mas tem 2x4x3,00 e 2x4x4,00 (e as chaves `1x2` não têm comprimento). Caixilho e vistas usam `pieces` ("Jogos/Unid"). Não existe meio jogo. |
| 4 | **Confirmado** | Não há escolha de acabamento. |
| 5 | **Confirmado** | Colunas "Preço Unit." e "Subtotal" mostram o custo, e o rodapé mostra "Custo Total Estimado". O `saleSubtotal` é calculado, mas nunca é exibido. |
| 6 | **Confirmado** | Não há como editar o preço de venda de um item. Só existe o total "Por quanto você vendeu?". Detalhe: `script.js:150-153` **sobrescreve** esse campo toda vez que um item é adicionado, quando há preço de venda cadastrado. Hoje isso não acontece porque toda venda é 0, mas vai acontecer quando os preços forem preenchidos. |
| 7 | **Confirmado** | Só existe `CEDRO`. O forro já separa mesclado e vermelho. |

### Gestor de Caixa

| # | Situação | O que está no código |
|---|---|---|
| 8 | **Confirmado** | `registerDirectSale` (`script.js:596`) cria um lançamento `category: 'custo'`, igual ao "Custo de Material" manual e ao "Lançar apenas Custo". O resultado subtrai os três juntos. Não há campo que diga se o lançamento foi compra ou CMV. A **descrição** ajuda a separar: "Custo Extraído: …" sai de uma venda (provável CMV), e "Custo Extraído (Apenas Material): …" e os lançamentos manuais são provável compra. Vou usar isso só como **sugestão** na tela de reclassificação. Você decide. |
| 9 | **Confirmado (bug)** | `script.js:437-439`: `venda − custo − despesa`. Funcionários aparecem na tabela, mas ficam fora do resultado do dia, do acumulado e do mês, que ainda é chamado de "LUCRO BRUTO". Com o acumulado de agosto, o resultado vai de **−3.467,05** para **−19.627,33**, o que bate com a ESPEC. |
| 10 | **Confirmado** | Os subtotais só somam `pix`/`bradesco`, `credito` e `debito`. `dinheiro` e `cheque` ficam fora. No acumulado de agosto, **R$ 14.103,50** de vendas não aparecem em nenhuma linha. |
| 11 | **Confirmado** | `script.js:416` (`isAgosto2026`). E o `dinheiroCaixa` do acumulado entra na gaveta em **qualquer** data, até antes de agosto. |
| 12 | **Confirmado, com detalhe** | O custo da calculadora é sempre `cheque` (`script.js:551` e `603`). No formulário manual, escolher "custo" remove PIX, débito e crédito e força cheque (`script.js:232-238`). Sobram dinheiro, Bradesco e cheque. |
| 13 | **Confirmado (todos)** | `exportToFinance` não é chamado em lugar nenhum. `registerDirectSale` e `registerDirectCost` repetem o mesmo código. Os blocos `sys*` e `past*` de `renderFinance` são cópias. As formas de pagamento aparecem em **três** lugares: `index.html:100-106`, `index.html:277-282` e `script.js:223-230`. PIX, crédito e débito aparecem nos cards e na tabela. |
| 14 | **Confirmado, e é pior que o previsto** | Veja abaixo. |
| 15 | **Confirmado** | `getFinance` e `saveFinance` não checam nada. Qualquer pessoa com o endereço do site consegue **ler** todo o financeiro ou **apagar tudo** com um POST `{ "financeItems": [] }`. |
| 16 | **Confirmado** | A caixa tem `background: #f8fafc` (`index.html:90`) e os rótulos usam `var(--text-main)` = `#f8fafc` (`styles.css:5`). É texto branco em fundo branco. |

**Detalhes do item 14:**
- `saveFinance` regrava a lista inteira (`kv.set("madeireira_finance", …)`). Com dois aparelhos abertos, quem salva por último apaga o lançamento do outro.
- Se `/api/getFinance` falhar, o sistema carrega do `localStorage`. **Em um aparelho novo, ele está vazio.** O primeiro lançamento feito nessas condições grava na nuvem uma lista com **um item só** e apaga todo o resto.
- No servidor, `if (financeItems)` aceita lista vazia (`[]` conta como verdadeiro).
- "Importar backup" **substitui** a lista inteira em vez de juntar.
- "Excluir" apaga na hora, sem confirmação e sem como desfazer.

### Outros problemas que encontrei
- **A descrição entra no HTML sem escape** (`innerHTML`, `script.js:405`). Junto com a API aberta, qualquer pessoa pode gravar um texto que roda código na tela do seu pai. Vou corrigir na Fase 0.
- **Os testes no Vercel usam o mesmo banco da produção.** O deploy de teste (Preview) e o site oficial (Production) leem a mesma chave do KV. Na Fase 0, vou separar as chaves por ambiente.

---

## 2. Plano por fases

Cada fase termina com: o que mudou, como testar e um zip ou commit para você publicar.
Os testes usam `node --test`, que já vem com o Node e não exige nenhuma dependência nova. Continua HTML/JS puro com Vercel.

### Fase 0: segurança e dados (itens 15 e 14)
1. **Backup antes de tudo.**
   - Seu pai clica em "💾 Exportar" e guarda o arquivo.
   - Crio `/api/backup`, protegida por senha, que devolve tudo o que está no KV e grava uma cópia em `madeireira_backup_<data>`.
   - As chaves `madeireira_finance` e `madeireira_acumulado` **não são alteradas nem apagadas**.
2. **Senha.**
   - A senha fica na variável de ambiente `SENHA_APP` (configurada no painel da Vercel).
   - Na primeira vez, o aparelho pede a senha e guarda. Toda chamada à API envia a senha, e sem ela a API responde 401.
   - Vale para leitura e gravação.
3. **Salvar lançamento a lançamento.**
   - Os lançamentos passam a ficar num *hash* do Redis (`madeireira_lancamentos`, com o `id` apontando para o lançamento).
   - Novas rotas: `POST /api/lancamento` para criar ou editar, e `DELETE /api/lancamento?id=` para excluir.
   - A exclusão marca o lançamento como `excluido` (com data) em vez de apagar, e pede confirmação.
   - Na primeira leitura, a lista antiga é **copiada** para o hash. O original continua como está.
   - Dois aparelhos ao mesmo tempo deixam de se atrapalhar.
4. **Sem gravação com dados velhos.**
   - Se a nuvem não responder, a tela abre em modo "somente leitura (sem conexão)" e bloqueia novos lançamentos.
   - O `localStorage` passa a ser só cópia de leitura.
   - Importar backup passa a **juntar** os lançamentos pelo `id`, sem apagar nada.
5. **Escapar o texto** das descrições e separar as chaves do KV por ambiente (preview e produção).

**Como testar:**
- Abrir o site em outro navegador, que deve pedir a senha.
- Lançar em dois celulares ao mesmo tempo. Os dois lançamentos devem ficar.
- Desligar a internet e confirmar que a tela não deixa lançar.

### Fase 1: catálogo único e calculadora nova (itens 1 a 7)
1. **`catalogo.js`.** Lê `data/custos.json` e transforma tudo numa lista única de itens com `id` (ex.: `CEDRO_VERMELHO|1x2`), grupo, unidade e custo.
   - Cedro vira dois materiais que usam o mesmo custo.
   - Os roliços saem do eucalipto e passam a ser cobrados por peça.
   - O pinus passa a ser por peça, com o comprimento na medida.
   - Caixilho é cobrado por jogo, e vistas por jogo ou meio jogo.
   - Os itens sem custo (assoalho emendado) aparecem marcados "sem custo".
   - `tabela-precos.js` é removido.
2. **Preços de venda no KV**, em `madeireira_precos_venda` (`id|acabamento → valor ou null`).
   - Tudo começa vazio. Nenhum preço é importado.
   - Uma tela **Admin › Preços** lista todos os itens e acabamentos para seu pai preencher.
3. **Config no KV**, em `madeireira_config`: percentuais de "madeira selecionada" (+%) e "últimas peças" (−%).
4. **`calculo.js` com `calcularItem()`.** Função pura que funciona no navegador e no Node, para o futuro agente de WhatsApp.
   - Recebe item, acabamento, quantidade, comprimento, preço manual, modificadores e ajuste com motivo.
   - Devolve custo, venda unitária, subtotais e margem.
   - Testes: os 3 exemplos do PROMPT, mais o roliço por peça, o meio jogo de vistas e os modificadores.
5. **Calculadora.**
   - O `<select>` de materiais passa a ser gerado a partir do catálogo, com escolha de acabamento.
   - A tabela mostra custo, venda (editável), subtotal de venda e margem. O rodapé mostra custo total, venda total e margem %.
   - Item sem preço cadastrado fica com o campo em destaque para o vendedor digitar.
   - O total digitado não é mais sobrescrito.

**Como testar:**
- `node --test`.
- Montar os exemplos do PROMPT na tela e conferir os números.
- Cadastrar um preço no admin e ver o valor aparecer no pedido.

### Fase 2: financeiro (substitui os itens 8 a 13 pela ESPEC, mais o item 16)
A Fase 2 é grande. Proponho entregar em 3 partes, e cada uma pode ir para o ar sozinha.

**2A: base, migração e DRE.**
- **`financeiro.js`**, com funções puras e testes:
  - alíquota efetiva e DAS (teste: 7,19% e R$ 3.595);
  - provisão de 13º e férias (19,44%);
  - CMV estimado;
  - montagem do DRE mensal e anual;
  - ponto de equilíbrio.
- **Novo lançamento.**
  - Campos: conta do plano de contas, data de competência, data de caixa (preenchida pela forma de pagamento), forma, conta financeira, descrição e cheque.
  - A venda feita pela calculadora grava os itens e o CMV junto e **não cria lançamento de custo**. Isso resolve os itens 8 e 12.
- **Config no admin:**
  - regime e tabela do Simples;
  - taxas e prazos de cartão;
  - provisões e FGTS liga/desliga;
  - depreciação;
  - faturamento dos 12 meses anteriores, para o RBT12.
- **Migração.** É só leitura do antigo e gravação no novo hash.
  - venda → Venda de produtos;
  - funcionario → Salários;
  - despesa → "Despesa geral (a classificar)";
  - custo → "A classificar: compra ou CMV?", com uma **tela de reclassificação em lote** que sugere pela descrição, mas não decide.
  - **Acumulado de agosto → lançamentos de abertura datados (1 a 23/08/2026):**
    - vendas por forma, com R$ 14.103,50 em "forma não informada";
    - custo e despesa "a classificar";
    - funcionários → Salários;
    - gaveta → saldo de abertura da Gaveta.
  - Isso acaba com o `isAgosto2026`. As chaves antigas só saem depois que você aprovar.
- **Tela DRE** do mês e do ano, com % sobre a receita, comparação com o mês anterior e com o mesmo mês do ano anterior, e o aviso "gerencial" no rodapé. A impressão sai em uma página A4.

**2B: caixa.**
- Fluxo de caixa diário e mensal, por conta financeira e consolidado.
- Recebíveis de cartão a D+30 e D+1, já descontada a taxa.
- Cheques a compensar.
- Contas a pagar e a receber (fiado), se existir.
- Fechamento da gaveta: valor contado × valor calculado.
- Projeção de 30 dias.

**2C: painel e limpeza.**
- Painel com os 8 indicadores da ESPEC.
- Correção do item 16 (cores pelas variáveis do tema).
- Remoção do código morto do item 13. A maior parte some sozinha com o código novo.

**Como testar:**
- `node --test`.
- Comparar o DRE de agosto com as contas da ESPEC.
- Reclassificar alguns custos e ver o DRE mudar.
- Lançar uma venda no crédito e conferir que ela aparece no DRE no dia e no caixa em D+30.

### Fase 3 (futura)
- Conferência de estoque (CMV real × calculado).
- Agente de orçamento de WhatsApp, usando `calcularItem()`.

---

## 3. Decisões (14/10/2026)

O sistema é **controle interno gerencial**. A contabilidade oficial fica com o escritório. Tudo o que é fiscal fica simplificado.

**Fase 0**
- Uma senha única para todos os aparelhos.
- Entrega por repositório privado no GitHub ligado à Vercel.

**Calculadora (Fase 1)**
- **Bruto/cepilhado:** vale para as madeiras por metro linear e o pinus. Cada item tem a flag `tem_cepilhado`, porque o eucalipto, por exemplo, pode não ter.
- **Retalho:** valor livre, custo 0, descrição opcional.

**Compras e CMV**
- Compra de material entra como **estoque**. O custo só vai para o resultado como CMV quando a madeira é vendida.
- CMV de venda sem itens: usa a config "margem padrão" (começa em 30%) e fica sempre marcado como **estimado**. Quando houver 3 meses de vendas pela calculadora, passa a usar a média real.

**Impostos**
- O regime padrão é o Simples Nacional, mas é configurável.
- O imposto vem pronto do escritório: conta **"Impostos (DAS)"** para lançar o valor real da guia todo mês.
- A estimativa automática do Simples fica **desligada** por padrão. Há um campo opcional de RBT12 para quem quiser ligar.
- Faturamento dos 12 meses e Anexo I/III: não são necessários.

**Contas financeiras**
- Lista editável. Começa com:
  - **Gaveta:** dinheiro.
  - **Bradesco:** PIX e transferências, inclusive as vendas pelo WhatsApp.
  - **PicPay:** maquininha (débito, crédito e parcelado).
  - **Cheques em carteira:** cheques recebidos e ainda não compensados.
- Cada forma de recebimento aponta para uma conta de destino configurável.
- **"Transferência entre contas"** (ex.: PicPay → Bradesco, depósito de cheque → Bradesco) não conta como receita nem despesa.
- **Pagamentos:** toda saída (compra, despesa, funcionário, imposto, retirada) tem o campo obrigatório **"Pago com"**: Gaveta, Bradesco, PicPay ou Cheque emitido.
  - O sistema sugere a última conta usada para aquela categoria ou fornecedor, e o usuário pode trocar.
  - Bradesco e PicPay pagam contas, mas não há regra automática para escolher entre eles.
- **Cheque emitido:** número, favorecido e data de compensação. Sai do Bradesco **na data de compensação**. Aparece na lista "Cheques emitidos a compensar" e na projeção.
- **Saldos:** cada conta tem saldo inicial e o botão **"Conferir saldo"**. O usuário digita o saldo do extrato e o sistema mostra a diferença em relação ao calculado.
- **Painel:** saldo de cada conta, saldo total e projeção de 30 dias (recebíveis do PicPay, cheques a receber, cheques emitidos e contas a pagar).

**Cartão**
- Taxas e prazos configuráveis por modalidade: débito, crédito à vista e parcelado (por número de parcelas).
- O padrão é 0%, débito em D+1 e crédito em D+30. Seu pai preenche as taxas reais depois.
- Venda parcelada: cada parcela vira um recebível no PicPay, em D+30, D+60…

**Fiado: existe e fica ativo por padrão**
- **Venda fiado:** entra na receita e no CMV na data da venda, mas não no caixa. Gera uma "Conta a receber" com cliente, valor e vencimento.
- **Recebimento**, geralmente em cheque:
  - baixa a conta a receber, inclusive com **pagamento parcial**;
  - o cheque vai para "Cheques em carteira", com número, emissor, banco e data de compensação.
- **Na compensação:** o cheque sai da carteira e entra na conta de depósito (padrão Bradesco, editável).
- **"Cheque devolvido":** reabre a conta a receber do cliente e marca o cheque.
- **Cadastro de clientes:** nome, telefone e observação.
- **Relatórios:**
  - contas a receber por cliente, com dias em atraso;
  - cheques a compensar nos próximos 30 dias;
  - total **"na rua"** (fiado + cheques em carteira) no painel.

## 4. O que preciso de você (versão original, já respondida acima)

**Antes da Fase 0:**
1. **Senha.** Uma senha única para todos os aparelhos serve? (Você vai criar `SENHA_APP` em Vercel › Settings › Environment Variables. Eu passo o passo a passo.)
2. **Como entregar.** Sugiro um repositório **privado** no GitHub ligado à Vercel, para cada mudança gerar um link de teste antes de ir para o ar. Se preferir, entrego zip e você roda `vercel --prod` como hoje.

**Antes da Fase 1:**
3. **Acabamento.** Bruto e cepilhado valem para quais grupos? Proposta: madeiras por metro linear e pinus. Os outros ficam com acabamento único.
4. **Retalho.** Ele é vendido por peça, por lote ou por valor livre?

**Antes da Fase 2:**
5. **Contas financeiras.** Só Gaveta e Bradesco? O PIX cai no Bradesco? A maquininha deposita em qual conta?
6. **Cartão.** Taxas e prazos de crédito e débito. Tem venda parcelada?
7. **RBT12.** Preciso do faturamento dos 12 meses anteriores a agosto/2026. O valor aparece no extrato do último PGDAS, que o contador tem.
8. **CMV estimado.** Que margem bruta usar enquanto não houver 3 meses de vendas pela calculadora?
9. **Fiado.** A madeireira vende fiado ou a prazo?
10. **Anexo do Simples.** Se cobram corte ou cepilhamento à parte, o contador confirma se esse serviço entra no Anexo I ou no III.

**Custos para seu pai confirmar** (mantive os valores, só listando):
- CEDRO 1x8 = 16,24, cerca de 12% acima das outras medidas de cedro;
- CAMBARÁ 3x5 = 30,11, cerca de 17% acima;
- além dos itens que já estão em `duvidas` no `custos.json`.
