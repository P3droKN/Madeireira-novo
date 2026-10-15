# CONTEXTO: Sistema Madeireira (leia primeiro)

Arquivo para uma sessão nova continuar sem perguntar de novo. Atualizado em 15/10/2026.
**Não há tokens nem senhas aqui.**

---

## 1. O projeto e como o usuário trabalha
- **O sistema:** controle interno da madeireira do pai do usuário (Pedro). Abas: **Vender · Orçamentos · Caixa · Relatórios · Ajustes** (reorganização de out/2026; ver `REORGANIZACAO-ENTREGA.md`).
  - É **gerencial**: não substitui a contabilidade do escritório, que cuida do fiscal e manda o DAS pronto.
- **Tecnologia:** **HTML/JS puro + funções serverless na Vercel + Upstash Redis (`@vercel/kv`)**. Sem framework (decisão do usuário).
- **Repositório:** `github.com/P3droKN/Madeireira-novo`, branch `main`. **Push na `main` publica sozinho no v2.**
- **Regras de trabalho pedidas pelo usuário:**
  - Responder em português do Brasil, em linguagem simples (o pai não é técnico).
  - **Apresentar o plano antes de programar** quando a fase é nova ou grande.
  - Ao final de cada etapa, dizer **o que mudou, como testar e como voltar atrás**.
  - **Nunca gravar na produção**, nunca usar credenciais da produção e **na dúvida sobre o destino, parar e perguntar**.
  - Dados reais (backups exportados) **nunca** entram no repositório nem na pasta publicada; apagar do ambiente ao terminar.
  - Não inventar valores: preços de venda começam vazios, e os custos duvidosos ficam como estão até o pai confirmar.
  - Commits com a atribuição definida pela sessão. Não criar PR sem pedido.

## 2. Ambientes

| | Produção (o pai usa) | Teste (v2) |
|---|---|---|
| Endereço | https://madereira-caixa.vercel.app | https://madeireirav2.vercel.app |
| Projeto Vercel | `madereira` | `madeireira.v2` (ligado ao GitHub `Madeireira-novo`) |
| Código | **o original antigo** (commit `82d59cf`), sem nenhuma mudança nossa | `main` deste repositório |
| Banco | Upstash `upstash-kv-canary-chair` (variáveis `KV_REST_API_*`) | Upstash **separado**, host `liked-drum-174974.upstash.io` (variáveis `UPSTASH_REDIS_REST_URL/TOKEN`) |
| Senha | não tem (API aberta: é um dos problemas resolvidos no v2) | `SENHA_APP` (Production e Preview) |
| Trava | — | `BANCO_PRODUCAO_HOST` = host do banco de produção → a API recusa gravar se estiver ligada a ele (**ativa**, confirmado pelo usuário) |

**Variáveis de ambiente que o código entende**
- **`SENHA_APP`:** obrigatória. Sem ela, a API responde 500 e a tela abre como "sem conexão".
- **`KV_REST_API_URL`/`KV_REST_API_TOKEN` ou `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN`:** se as duas URLs existirem e apontarem para bancos diferentes, a API recusa tudo.
- **`BANCO_PRODUCAO_HOST`:** só no v2. **Nunca** criar na produção.
- **`KV_PREFIXO`:** opcional, força um prefixo nas chaves. **Não usado** no v2, que tem banco próprio.
- **`VERCEL_ENV`:** em produção usa as chaves sem prefixo; em preview e desenvolvimento usa `preview:`.

**Limitações desta sessão cloud**
- A rede **bloqueia `*.vercel.app` e `vercel.com`**. Não dá para chamar a API do v2 daqui. Para isso, o usuário teria que liberar `madeireirav2.vercel.app` em Allowed domains do ambiente.
- Por isso, os testes de integração rodam contra um servidor local com Redis falso (`tests/e2e/`).
- **Plano Hobby da Vercel: máximo de 12 funções.** Desde a reorganização a API é **uma função só**: `api/[recurso].js` despacha para `ROTAS` em `api/_rotas.js`. **Rota nova = uma entrada nova em `ROTAS`** (não criar arquivo em `api/` sem `_`). As URLs continuam `/api/<nome>`.

## 3. Estrutura do código
- **`index.html`:** as 5 abas e as janelas. O sistema abre em **Vender**; o **Caixa abre sempre em Lançar**.
  - **Vender:** pedido, Registrar venda / Salvar como orçamento, botão **👁 Modo balcão** (esconde tudo com classe `sigilo`; escolha em `localStorage` `madeireira_modo_balcao`).
  - **Orçamentos:** 3 indicadores (em aberto, conversão do mês, 🔔 para cobrar), abas Em aberto · Fechados · Perdidos, busca, "Mais filtros", ações Enviar/Cobrar/Converter e menu ⋯, Lixeira.
  - **Caixa:** sub-abas Lançar · Saldos · Cheques · Lançamentos (formulário único; a lista tem Excluir/estornar por linha). Na 2C entra "A receber".
  - **Relatórios:** barra de mês (Mês/Ano só no DRE) e Imprimir A4; Resumo do mês (a antiga tabela do Gestor de Caixa), DRE, Fluxo de caixa, Formas de pagamento, Orçamentos.
  - **Ajustes:** Preços · Financeiro · Orçamentos · Saldos (abertura + saldos passados) · Dados (exportar, importar, restaurar, conferir, linha do banco).
- **`script.js`** (clássico): senha, `api()`, `switchTab`, carga dos dados (`window.Caixa`, inclusive `excluir(id)`), backup/importar/restaurar, saldos passados, `registerDirectSale`.
- **Módulos de tela:**
  - `calculadora.js`: aba Vender (pedido, modo balcão) e Ajustes › Preços;
  - `pagamentos.js`: editor de várias formas de pagamento;
  - `orcamentos-ui.js`: aba Orçamentos e Relatórios › Orçamentos;
  - `financeiro-ui.js`: **navegação das sub-abas** (Caixa, Relatórios, Ajustes), Lançar, Lançamentos, Resumo do mês, DRE, Formas de pagamento, configuração (Financeiro e Orçamentos);
  - `caixa-ui.js`: Saldos, Cheques, Fluxo de caixa e Abertura de saldos;
  - `conferencia.js`: conferência arquivo × banco.
- **`lib/`:** funções puras, testadas, que rodam no navegador e no Node.
  - `catalogo.js`: catálogo a partir de `data/custos.json`;
  - `calculo.js`: `calcularItem()`, `totalizarPedido`, `distribuirTotal`, `textoWhatsApp`;
  - `planoContas.js`: contas, formas, configuração padrão;
  - `financeiro.js`: DRE, Simples, CMV, estoque;
  - `migracaoV2.js`;
  - `caixa.js`: movimentos, saldos, projeção, fluxo, cheques;
  - `orcamentos.js`: situações (Em aberto/Fechado/Perdido; "aguardando" antigo = em aberto), 🔔, lixeira (30 dias na tela);
  - `relatorios.js`: resumo do mês (mesmos números da tela antiga) e vendas por forma de pagamento;
  - `resumo.js`: conferência.
- **`api/`:** `[recurso].js` (roteador único), `_rotas.js` (as rotas), `_lib.js` (cliente do banco, chaves, senha, trava), `_dados.js` (toda a lógica de gravação). Rotas:
  - `getFinance`
  - `lancamento`: POST cria; DELETE exclui (suave); PATCH reclassifica em lote ou, com `acao: "cheque"`, altera um cheque
  - `acumulado`
  - `backup`: GET; `?lista=1`; `?copia=`
  - `migrar`: salvamento seguro; `?versao=2` = financeiro novo
  - `importar`: em lotes
  - `restaurar`
  - `catalogo`
  - `precos`
  - `config`: `{config}` calculadora, `{financeiro}`, `{abertura}`, `{conferencia}`
  - `resumo`
  - `orcamentos`: GET; POST `{orcamento}`/`{cliente}`; PATCH `{id, acao}` com `contato`, `perdido`, `fechar`, `reabrir` (perdido, ou fechado cuja venda foi excluída), `precos`, `excluir` (lixeira: marca `excluidoEm`; fechado não pode), `restaurar`
- **`data/custos.json`:** fonte da verdade dos custos. É lido pela API (`vercel.json` › includeFiles) e o acesso direto a `/data/*` é redirecionado.
- **`.vercelignore`:** não publica `dados-iniciais.json`, `*.md`, `tests`, `scripts`.
- **Chaves no banco** (com prefixo conforme o ambiente):
  - `madeireira_finance`: lista antiga, **nunca é alterada** depois da migração;
  - `madeireira_acumulado`;
  - `madeireira_lancamentos`: hash por id;
  - `madeireira_migrado_v1` e `madeireira_migrado_v2`;
  - `madeireira_backups`, mais as cópias `madeireira_backup_*` (até 30 automáticas);
  - `madeireira_precos_venda`;
  - `madeireira_config` e `madeireira_config_financeiro`;
  - `madeireira_orcamentos`, `madeireira_orc_seq` e `madeireira_clientes`;
  - `madeireira_saldos`.
  - O backup e a restauração cobrem todas.

## 4. Como testar
- **Automáticos:** `npm install && npm test`. São **105 testes** (`node --test`), em `tests/*.test.js`.
- **No navegador:** `bash tests/e2e/rodar.sh` (ou `… rodar.sh fase2b`).
  - São 7 baterias contra um servidor local (`tests/e2e/servidor.mjs`, Redis falso no protocolo REST da Upstash, senha local `pinho123`), **só com dados sintéticos**.
  - Resultado atual: fluxo 31, fase1b 28, lotes 5, trava 6, fase2a 31, orcamentos 57, fase2b 25, **tudo passando**.
  - O servidor local imita a Vercel: `/api/x` usa `api/x.js` se existir, senão `api/[recurso].js`.
- **Importante:** o servidor local precisa ser iniciado **de dentro da pasta do projeto**, porque lê `data/custos.json` pelo `process.cwd()`. O `rodar.sh` já faz isso.

## 5. O que já foi feito (tudo publicado no v2)

| Etapa | Commit | O usuário testou no v2? |
|---|---|---|
| Fase 0: senha, salvamento por lançamento, backup/restaurar, sem conexão = só leitura, escape de HTML | `e484406` e seguintes | sim |
| Importação em lotes com progresso e retomada; conferência arquivo × banco; trava de produção | `feab41e`, `a7bfd92` | sim: **742 lançamentos, "Tudo confere"** |
| Fase 1: catálogo único (19 materiais, 198 itens), calculadora nova, aba Preços, texto para WhatsApp | `7f4b8c7`, `a332730` | sim |
| Fase 2A: plano de contas, lançamento novo, migração v2, reclassificação em lote, DRE | `161de34` | sim: migração ok, "Tudo confere" com abertura × acumulado, sugestões aceitas, venda com duas formas, compra em cheque no DRE |
| **Orçamentos** | `4f894df` | **ainda não**: entregue, aguardando teste |
| **Fase 2B**: abertura de saldos, saldos, conferência, projeção de 30 dias, fluxo de caixa, cheques | `4e04bfe` | **ainda não**: entregue, aguardando teste |
| API num roteador único (mesmo comportamento) | `8e329be` | não precisa (testes iguais) |
| **Reorganização**: 5 abas, formulário único, modo balcão, orçamentos com 3 situações, 🔔, lixeira, Relatórios e Ajustes | `e8900fb` | **ainda não**: aguardando teste (`REORGANIZACAO-ENTREGA.md`) |

**Guias de cada etapa:**
- `FASE0.md`: inclui restauração, projeto separado, importação e trava;
- `FASE1.md`, `FASE2A.md`, `ORCAMENTOS-ENTREGA.md`, `FASE2B.md`, `REORGANIZACAO-ENTREGA.md`;
- plano geral em `PLANO.md` e `FASE2-PLANO.md`; especificações originais em `PROMPT-claude-code.md`, `ESPEC-financeiro.md` e (orçamentos) na seção do plano.

## 6. Decisões do usuário (não perguntar de novo)

**Calculadora e preços**
- Custos: `data/custos.json`. Preços de venda: no banco, **começam vazios**; o pai preenche aos poucos na aba Preços.
- Cedro Mesclado e Cedro Vermelho: mesmo custo (CEDRO), preços separados.
- Bruto/Cepilhado vale para as madeiras por metro linear e o pinus, com a flag `tem_cepilhado` por material. O **eucalipto começa sem**.
- Retalho: valor livre, custo 0, descrição opcional.
- **Regra de preço do pedido:**
  - sempre parte da tabela;
  - o vendedor ajusta por **%** ou pelo **preço**, e os dois ficam sincronizados (por item e no total);
  - o total editado é distribuído proporcionalmente entre os itens, sem mudar o CMV;
  - **motivo opcional** em botões (Selecionada, Últimas peças, Cliente antigo, Frete/entrega, Urgência, Outro);
  - "Selecionada" e "Últimas peças" aplicam o % padrão da aba Preços;
  - "Voltar ao preço de tabela" por item e no total.
- Texto para WhatsApp **sem custo, margem nem tabela**. Impressão do pedido sem custo e margem.

**Financeiro**
- Sistema gerencial. **Compra de material = estoque.** O custo só vai para o resultado como **CMV** quando vende.
- CMV:
  - da calculadora, exato;
  - venda sem itens: margem padrão de **30%**, sempre marcado "estimado", passando para a média real quando houver 3 meses de vendas pela calculadora;
  - vendas antigas (migradas) não recebem estimativa: o CMV delas vem dos custos classificados.
- **Estoque só em R$** (compras − CMV), com o campo pronto para ligar estoque por item no futuro (`estoque.porItem`, compras aceitam itens).
- **Impostos:**
  - o regime padrão é o Simples Nacional, mas é configurável;
  - **o imposto vem pronto do escritório**: conta "Impostos (DAS)" com o valor real da guia;
  - a estimativa do Simples fica **desligada**, com RBT12 opcional;
  - faturamento dos 12 meses e Anexo I/III: não precisa.
- FGTS de 8%, estimado até a guia ser lançada. Provisão de 13º e férias de 19,44%, ligada. Depreciação opcional.
- **Contas financeiras:**
  - Gaveta (dinheiro);
  - Bradesco (PIX e transferências, inclusive vendas pelo WhatsApp);
  - PicPay (maquininha: débito, crédito e parcelado);
  - Cheques em carteira.
  - A lista é editável, e cada forma aponta para uma conta de destino configurável.
- **Formas de pagamento** (cada venda grava a forma e a conta separadas; **pode ter várias formas**, e a soma tem que ser igual ao total; campo opcional Nº da NF-e):

  | Forma | Conta de destino | tPag |
  |---|---|---|
  | Dinheiro | Gaveta | 01 |
  | **PIX Bradesco** (chave pelo WhatsApp) | Bradesco | **20** (estático) |
  | **PIX PicPay** (QR na maquininha) | PicPay | **17** (dinâmico) |
  | Transferência/TED | Bradesco | 18 |
  | Débito | PicPay | 04 |
  | Crédito à vista | PicPay | 03 |
  | Crédito parcelado (Nx) | PicPay | 03 |
  | Cheque | Cheques em carteira | 02 |
  | Fiado | Contas a receber | 05 |

  Os tPag são editáveis na configuração; **o escritório ainda vai confirmar**.
- **Saídas:** "Pago com" obrigatório (Gaveta, Bradesco, PicPay ou Cheque emitido), sugerindo a última conta usada para o fornecedor ou a conta. Bradesco e PicPay pagam contas por escolha do usuário, sem regra automática.
- **Cheque emitido:** padrão Bradesco, com a **conta escolhida em cada cheque**. Sai do saldo na **data de compensação**.
- **Cartão:**
  - taxas e prazos por modalidade, com padrão de **0%**, débito em **D+1** e crédito em **D+30**;
  - parcelado: cada parcela cai a cada 30 dias no PicPay;
  - o pai preenche as taxas reais depois.
- **Cheque de venda à vista:** a receita entra na data da venda e o cheque fica em carteira até compensar.
- **Transferência entre contas** (PicPay → Bradesco, depósito de cheque): não é receita nem despesa.
- **Saldos:** saldo inicial **no dia da troca**, conferido com os extratos do Bradesco e do PicPay e com a contagem da gaveta (tela "Abertura de saldos", feita na 2B). Cada conta tem o botão "Conferir saldo".
- **Migração dos dados antigos:**
  - `pix` → **PIX Bradesco**;
  - `bradesco` → **Transferência Bradesco**;
  - tudo marcado como "migrado", com reclassificação em lote;
  - custo → "a classificar: compra ou CMV?", com sugestão, e **o usuário decide**;
  - despesa → "a classificar"; funcionário → Salários;
  - acumulado de agosto/2026 → 7 lançamentos de abertura (DRE sim, caixa não);
  - a gaveta do acumulado (R$ 2.871,65) não vira lançamento.

**Orçamentos** (especificação completa no `ORCAMENTOS.md` que o usuário enviou; implementada)
- Número ORC-0001…; cliente com WhatsApp com DDD validado; origem Balcão/WhatsApp/Telefone; validade padrão de 7 dias.
- **Só 3 situações** (reorganização): Em aberto → Fechado (virou venda) ou Perdido. **Sem "Aguardando cliente"** e sem seletor de status: a situação muda pelas ações (Converter, Marcar como perdido, Reabrir). A perda tem motivo: Preço, Comprou em outro lugar, Desistiu, Sem resposta, Outro.
- **Vencido é só aviso** (selo vermelho + Atualizar preços): o orçamento continua Em aberto até fechar, perder ou excluir.
- **🔔** quando está em aberto há X dias sem contato (**padrão 3**, configurável em Ajustes › Orçamentos); "🔔 N para cobrar hoje" no topo filtra.
- **Excluir** (menu ⋯, com confirmação) = erro ou teste: some da lista e dos indicadores e vai para a **Lixeira** (restaura; some da tela depois de 30 dias, **mas continua guardado no banco e nos backups** — decisão do usuário). Perdido = cliente não fechou (conta nos indicadores). Convertido em venda não pode ser excluído (estornar a venda no Caixa, depois Reabrir).
- Indicadores no topo: só em aberto, conversão do mês e 🔔. Tempo médio, motivos de perda e origem ficam em Relatórios › Orçamentos.
- Enviar/Cobrar por `wa.me/55DDDNÚMERO`, com os modelos editáveis (`{nome} {numero} {valor} {dias} {validade}`). O clique registra o contato. **Nada é enviado sozinho.**
- Converter em venda (preços do orçamento ou de hoje), Duplicar, Editar (mesmo número), Imprimir, Atualizar preços (mesmo % sobre a tabela nova, renova a validade).
- O cadastro de clientes (nome, WhatsApp, observação, chave = telefone) é **o mesmo que o fiado vai usar**.

**Fiado (2C)**
- Existe e fica **ativo por padrão**.
- **Venda fiado:**
  - receita e CMV entram na data da venda;
  - não entra no caixa;
  - gera uma "Conta a receber" com cliente, valor e vencimento combinado.
- **Recebimento:**
  - quase sempre em **cheque** (clientes antigos);
  - baixa a conta a receber, e o cheque vai para a carteira com número, emissor, banco e data de compensação;
  - **pagamento parcial** é possível.
- **Cheque devolvido:** reabre a conta a receber do cliente e marca o cheque. Na 2B ele já sai do saldo e aparece em "Devolvidos (cobrar do cliente)"; falta ligar à conta a receber.
- **Relatórios:**
  - a receber por cliente, com dias em atraso;
  - cheques a compensar nos próximos 30 dias (já existe na 2B);
  - **total "na rua"** (fiado + cheques em carteira) no painel.

## 7. Próximos passos
1. **O usuário testa no v2** a reorganização (`REORGANIZACAO-ENTREGA.md`), que já inclui Orçamentos e 2B nos lugares novos, e **faz a abertura de saldos** (Ajustes › Saldos) com os extratos.
2. **Fase 2C: fiado e clientes**
   - forma "Fiado" na venda: cliente obrigatório e vencimento;
   - contas a receber, com recebimento total ou parcial em cheque ou outra forma;
   - cheque devolvido reabrindo a conta a receber;
   - tela de clientes (cadastro já existe no banco: `madeireira_clientes`);
   - relatórios e total "na rua".
   - Rotas: novas entradas em `ROTAS` (`api/_rotas.js`); o limite de funções não é mais problema.
   - Tela: "A receber" entra como mais uma sub-aba do Caixa.
3. **Fase 2D: relatórios, painel e limpeza**
   - "Vendas por forma de pagamento": a versão simples do mês já existe em Relatórios; falta dia/ano, por conta e o **CSV** com data, Nº NF-e, forma, tPag e valor para o escritório;
   - **painel inicial**: faturamento do mês e do ano, lucro e margem líquida, margem bruta com alerta de queda de 5 pontos, ponto de equilíbrio e quanto falta, ticket médio, saldos e projeção, % de fixas e pessoal, top 5 materiais por margem, total na rua, indicadores de orçamentos;
   - o painel entra em Relatórios; limpar código morto que sobrar (item 13 do PROMPT). A tela antiga "Gestor de Caixa" já saiu na reorganização.
4. **Virada para a produção** (ainda não decidido; perguntar ao usuário qual caminho):
   - **A)** publicar este código no projeto `madereira`, usando o banco de produção e a mesma `SENHA_APP` forte nova;
   - **B)** passar o pai para o projeto v2, com os dados reais restaurados e o domínio trocado.
   - **Antes, em qualquer caminho:**
     1. Exportar o backup da produção.
     2. Ensaiar.
     3. Ativar o salvamento seguro.
     4. Migrar a v2 com conferência ("Tudo confere").
     5. Fazer a abertura de saldos no dia.
     6. **Remover `BANCO_PRODUCAO_HOST`** do projeto que virar produção, porque ela bloquearia as gravações.
   - Plano de volta: Instant Rollback, já que o código novo nunca altera `madeireira_finance` nem `madeireira_acumulado`.

## 8. Pendências e dúvidas em aberto
- **Custos a confirmar com o pai** (os valores foram mantidos, sem inventar):
  - os itens do campo `duvidas` em `data/custos.json`: cedro 3x3, base da itaúba, eucalipto 1x5/1x6/2x3, roliços antigos, madeirite 9 × 10 mm, assoalho emendado sem custo, medidas do beiral, caixilho 15/23/25 sem vistas;
  - mais dois achados: **CEDRO 1x8 = 16,24** (cerca de 12% acima da curva) e **CAMBARÁ 3x5 = 30,11** (cerca de 17% acima).
- **Códigos tPag:** o escritório precisa confirmar (principalmente o PIX 17 × 20).
- **Taxas reais do cartão:** o pai preenche em Ajustes › Financeiro. Hoje estão em 0%.
- **Preços de venda:** todos vazios até o pai preencher.
- **Custos "a classificar" (compra ou CMV) dos dados antigos:** o pai precisa classificar no v2 e depois na produção. Enquanto não classifica, o DRE avisa que o lucro pode estar superestimado.
- **Na 2C**, decidir com o usuário o **prazo padrão do fiado** e se o vencimento é por venda ou por cliente. Ainda não foi perguntado.
- **A virada (A ou B)** ainda não foi decidida.
- **Resumo do mês (antiga tela do Gestor de Caixa, agora em Relatórios):** mesmos números de antes (provado em `tests/relatorios.test.js`), ignorando abertura e transferências. O "resultado" dele é vendas − custos − despesas, **sem funcionários** (sempre foi assim); perguntar ao usuário se quer incluir.
