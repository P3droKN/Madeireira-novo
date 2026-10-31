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
  - **Caixa:** sub-abas Lançar · Saldos · Cheques · **A receber** (2C) · Lançamentos (formulário único; a lista tem Excluir/estornar por linha e o filtro "Fiado e recebimentos").
  - **Relatórios:** barra de mês (Mês/Ano só no DRE) e Imprimir A4; sub-abas Dia · Mês · DRE · A receber · Orçamentos · Formas de pagamento (Dia e Mês têm controles próprios; a barra de mês serve ao DRE e demais).
  - **Ajustes:** Preços · Financeiro · Orçamentos · Saldos (abertura + saldos passados) · Dados (exportar, importar, restaurar, conferir, linha do banco).
- **`script.js`** (clássico): senha, `api()`, `switchTab`, carga dos dados (`window.Caixa`, inclusive `excluir(id)`), backup/importar/restaurar, saldos passados, `registerDirectSale`.
- **Módulos de tela:**
  - `calculadora.js`: aba Vender (pedido, modo balcão) e Ajustes › Preços;
  - `pagamentos.js`: editor de várias formas de pagamento;
  - `orcamentos-ui.js`: aba Orçamentos e Relatórios › Orçamentos;
  - `financeiro-ui.js`: **navegação das sub-abas** (Caixa, Relatórios, Ajustes), Lançar, Lançamentos, DRE, Formas de pagamento, configuração (Financeiro e Orçamentos);
  - `caixa-ui.js`: Saldos, Cheques e Abertura de saldos;
  - `receber-ui.js`: Caixa › A receber (por cliente, Receber, Cobrar, Estornar, cadastro de clientes) e Relatórios › A receber;
  - `clientes.js`: `window.Clientes` (lista, `<datalist id="clientes-lista">`, `garantir(nome)` acha ou cadastra);
  - `conferencia.js`: conferência arquivo × banco.
- **`lib/`:** funções puras, testadas, que rodam no navegador e no Node.
  - `catalogo.js`: catálogo a partir de `data/custos.json`;
  - `calculo.js`: `calcularItem()`, `totalizarPedido`, `distribuirTotal`, `textoWhatsApp`;
  - `planoContas.js`: contas, formas, configuração padrão;
  - `financeiro.js`: DRE, Simples, CMV, estoque;
  - `migracaoV2.js`;
  - `caixa.js`: movimentos, saldos, projeção, fluxo, cheques;
  - `orcamentos.js`: situações (Em aberto/Fechado/Perdido; "aguardando" antigo = em aberto), 🔔, lixeira (30 dias na tela);
  - `receber.js`: contas a receber **recalculadas** dos lançamentos (vendas fiado + cheques devolvidos − recebimentos), atraso, crédito, texto de cobrança;
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
  - `zerar` (virada): POST `{confirmacao: "ZERAR"}`; só com `statusBanco().zerarPermitido`
  - `clientes` (2C): GET lista; POST `{cliente}` cadastra (pelo WhatsApp, ou C1, C2… sem WhatsApp) ou edita (com `id`, mantém a chave)
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
  - `madeireira_orcamentos`, `madeireira_orc_seq`, `madeireira_clientes` e `madeireira_cli_seq` (contador C1, C2…);
  - `madeireira_saldos`.
  - O backup e a restauração cobrem todas.

## 4. Como testar
- **Automáticos:** `npm install && npm test`. São **126 testes** (`node --test`), em `tests/*.test.js`.
- **No navegador:** `bash tests/e2e/rodar.sh` (ou `… rodar.sh fase2b`).
  - São 10 baterias contra um servidor local (`tests/e2e/servidor.mjs`, Redis falso no protocolo REST da Upstash, senha local `pinho123`), **só com dados sintéticos**.
  - Resultado atual: fluxo 31, fase1b 28, lotes 5, trava 8, fase2a 31, orcamentos 57, fase2b 25, frete 23, fiado 31, virada 25, **tudo passando** (10 baterias).
  - O servidor local imita a Vercel: `/api/x` usa `api/x.js` se existir, senão `api/[recurso].js`.
- **Importante:** o servidor local precisa ser iniciado **de dentro da pasta do projeto**, porque lê `data/custos.json` pelo `process.cwd()`. O `rodar.sh` já faz isso.

## 5. O que já foi feito (tudo publicado no v2)

| Etapa | Commit | O usuário testou no v2? |
|---|---|---|
| Fase 0: senha, salvamento por lançamento, backup/restaurar, sem conexão = só leitura, escape de HTML | `e484406` e seguintes | sim |
| Importação em lotes com progresso e retomada; conferência arquivo × banco; trava de produção | `feab41e`, `a7bfd92` | sim: **742 lançamentos, "Tudo confere"** |
| Fase 1: catálogo único (19 materiais, 198 itens), calculadora nova, aba Preços, texto para WhatsApp | `7f4b8c7`, `a332730` | sim |
| Fase 2A: plano de contas, lançamento novo, migração v2, reclassificação em lote, DRE | `161de34` | sim: migração ok, "Tudo confere" com abertura × acumulado, sugestões aceitas, venda com duas formas, compra em cheque no DRE |
| Orçamentos | `4f894df` | sim (excluir/restaurar ok) |
| Fase 2B: abertura de saldos, saldos, conferência, projeção de 30 dias, fluxo de caixa, cheques | `4e04bfe` | sim (abertura de teste, saldos, fechar gaveta, projeção) |
| API num roteador único (mesmo comportamento) | `8e329be` | não precisa (testes iguais) |
| Reorganização: 5 abas, formulário único, modo balcão, orçamentos com 3 situações, 🔔, lixeira, Relatórios e Ajustes | `e8900fb` | sim |
| Frete à parte e % sobre o preço digitado | `9c9bb37` | sim |
| **Fase 2C**: fiado, A receber, recebimento parcial/cheque, cheque devolvido reabre, clientes, cobrança, relatório | `b4dc12e` | **ainda não**: aguardando teste (`FASE2C.md`) |

**Guias de cada etapa:**
- `FASE0.md`: inclui restauração, projeto separado, importação e trava;
- `FASE1.md`, `FASE2A.md`, `ORCAMENTOS-ENTREGA.md`, `FASE2B.md`, `REORGANIZACAO-ENTREGA.md`, `FASE2C.md`;
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
  - **motivo opcional** em botões (Selecionada, Últimas peças, Cliente antigo, Urgência, Outro). "Frete/entrega" saiu dos motivos porque o frete virou campo próprio;
  - **item sem preço de tabela:** o % (da linha ou geral) vale **sobre o preço digitado** (`precoBase` na linha), sem acumular; "↺ Voltar" volta ao preço digitado. A venda continua sem "variação sobre tabela" para esses itens;
  - **🚚 Frete (opcional):** valor à parte dos itens. Aparece como linha "Frete / entrega" no pedido, no WhatsApp, na impressão e no orçamento; soma no total e nas formas de pagamento. A venda grava `value` = itens + frete e `frete` separado; o orçamento grava `frete` e `total` com frete (atualizar preços mantém o frete). No DRE fica na receita bruta (info "Frete cobrado dos clientes") e **fica fora da base do CMV estimado e da margem dos produtos**;
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

**Fiado (2C, implementado; detalhes em `FASE2C.md`)**
- Forma "Fiado (a receber)", tPag 05, **ligado por padrão** (Ajustes › Financeiro › Fiado), **prazo padrão 30 dias** (configurável), **vencimento por venda** (decidido por mim; o usuário pode mudar).
- **Venda fiado:** cliente obrigatório e cadastrado (`clienteId`); receita e CMV na data da venda; **não entra no caixa**.
- **Cliente sem WhatsApp** é aceito no fiado (código C1, C2…); orçamento continua exigindo WhatsApp.
- **Recebimento** (`conta: "recebimento"`): total ou **parcial**, em qualquer forma menos fiado; em cheque vai para a carteira. Abate o que já existia na data (a compra indicada primeiro, depois as que vencem antes); sobra vira crédito para as próximas. Não é receita.
- **Cheque devolvido** (de recebimento ou de venda à vista) vira dívida do cliente (ou do emissor) automaticamente.
- **Relatórios:** A receber por cliente com atraso, cheques a compensar em 30 dias, **total na rua** (fiado + cheques em carteira). Cobrança pelo WhatsApp com a lista do que está em aberto.
- Fiado a vencer **não entra na projeção de 30 dias** (pode entrar como "previsto" na 2D, se o usuário quiser).

**Virada (decidida: caminho B, antes da 2D)** — guia em `VIRADA.md`
- O v2 vira o oficial reaproveitando o banco `liked-drum`: **Zerar** (Ajustes › Dados; só com `PERMITIR_ZERAR=sim` + trava ativa + banco ≠ produção; baixa backup; digitar ZERAR; mantém preços, ajustes e config financeira) → importar o export final do antigo → "Tudo confere" → migrar → "Tudo confere" → **abertura** com cheques em carteira **um por um** (`cheque_anterior`, já dentro do saldo da abertura) e **fiado da pasta** (`fiado_anterior`, a receber sem receita, normalmente conta corrente) → trocar o link nos aparelhos.
- `BANCO_PRODUCAO_HOST` **fica** no v2 (aponta para o banco antigo). `PERMITIR_ZERAR` só no dia; apagar depois.
- O antigo fica 2 semanas só para consulta, travado com o token só leitura da Upstash; script de volta: o usuário não quis.
- Ensaio: no preview (branch `ensaio`, prefixo `preview:`), com `PERMITIR_ZERAR` só em Preview.

**Fiado em conta corrente (pedido do usuário antes da virada)**
- Não existe caderno: existe uma **pasta com as vias dos pedidos**, conta corrente de clientes antigos e de confiança, sem vencimento.
- Cadastro do cliente: `contaCorrente` (bool), `alertaLimite` (R$) e `alertaDias` (dias sem pagar); `null` = sem alerta. Salvar cliente pelo orçamento preserva esses campos.
- Na venda: `pagamentos[i].fiado = { contaCorrente: true, vencimento: "" }`; no fiado anterior: `contaCorrente: true`, sem `vencimento`. Quem decide se é conta corrente na tela de A receber é **o cadastro na hora do cálculo** (marcar ou desmarcar vale para o passado).
- `lib/receber.js`: conta corrente nunca fica atrasada (`situacao: "em_aberto"`, `diasEmAberto`), abate as compras mais antigas; por cliente `emAbertoDesde`, `diasEmAberto`, `ultimoPagamento`, `diasSemPagar`, `alertas`; totais `totalContaCorrente`, `totalComVencimento`, `comAlerta`. `recebidoDeFiadoAnterior(lanc, cfg, mes, hoje, clientes)` = quanto dos recebimentos do mês pagou `fiado_anterior` (linha informativa no DRE e no fluxo; não é venda).
- `via.js`: `window.Via.imprimir(lancamento)` imprime 2 vias (loja/pasta e cliente) numa A4, sem custo nem margem. Oferecido depois da venda fiado de conta corrente (Vender e Lançar) e no botão 🖨 Via em A receber.
- E2E: `tests/e2e/contacorrente.mjs`. O servidor de teste aceita `AGORA=...` para fingir a data (usado em `orcamentos`, que dependia do dia em que rodava).

**DRE depois do ensaio (AJUSTES-POS-ENSAIO, item 1)**
- O ensaio mostrou lucro irreal em set/2026 (R$ 40.369): os custos migrados "a classificar" ficavam fora do resultado.
- **Custos a classificar** (`classificar_custo`) agora entram numa linha amarela "(−) Custos a classificar (compra ou CMV?)", descontada antes do lucro bruto, até virarem Compra (estoque) ou CMV.
- **CMV estimado:** aplicado a toda venda sem custo gravado (nova ou migrada), **só quando o mês não tem custo a classificar nem CMV classificado**. Se tiver, esse custo já é o custo das vendas do mês, e a estimativa contaria em dobro. Se o pai classificar tudo do mês como Compra, a estimativa volta a valer.
- **DAS:** sem guia no mês (conta `das`, competência = mês a que se refere), estima pelo Simples, Anexo I, com o RBT12 de Ajustes › Financeiro (não há mais a opção de desligar). A guia lançada substitui a estimativa. Sem RBT12, vira pendência.
- **FGTS e provisão** só sobre salários CLT. Salário tem `vinculo`: `clt` (padrão, inclusive nos dados antigos), `nao_clt`, `pro_labore`. Lançar mostra o campo; Lançamentos tem "Aplicar vínculo" em lote.
- **Avisos:** caixa "Resultado provisório: N pendências" (custos a classificar com quantidade e R$, DAS estimado ou sem RBT12, taxas de cartão em 0% com vendas no cartão); "margem bruta acima de 70%: verifique o CMV"; "Recebido de fiado anterior à virada" também como linha informativa no fim da tabela (não soma).

**Ajustes pós-ensaio (itens 2 a 4) e extras** — DRE aprovado pelo usuário no preview (set R$ 4.983,15; ago −R$ 18.320,48; out −R$ 23.248,70)
- **Via:** número curto `numero` = `V-0001…`, dado pelo servidor (`madeireira_venda_seq`, zerado no Zerar, no backup e no restaurar) a toda `venda_produtos` nova; editar mantém. A via usa `numero` (vendas antigas: o id). Margem zero só durante a impressão da via (um `<style>@page{margin:0}</style>` posto e tirado pelo `via.js`): sem margem o navegador não imprime cabeçalho e rodapé. As 2 vias cabem numa A4.
- **Fiado anterior:** campo `desde` (via mais antiga, ≤ data da abertura); A receber conta "em aberto há X dias" a partir dele. Aviso ao lançar outro para o mesmo cliente ("já tem um Fiado anterior de R$ X. Somar mesmo assim?"). Total no fim da lista.
- **Alerta pelo "Ver"** (Caixa › A receber): conta corrente, limite em R$ e dias sem pagar, salvos no cadastro.
- **Sugestão DAS/FGTS:** `sugestaoDe(l)` em `lib/migracaoV2.js` (calculada na hora para `classificar_despesa`): "DAS", "Simples", "imposto(s)", "guia" → `das`; "FGTS" → `fgts`. Aceitar leva a competência para o último dia do mês anterior (a guia é do mês anterior; guarda `competenciaOriginal`; o caixa continua na data do pagamento), substituindo a estimativa daquele mês.
- **DRE mês em andamento:** aviso "Mês em andamento (até DD/MM)" e comparação com o mesmo pedaço do mês anterior e do ano passado (`montarDRE(..., { ateDia })`).
- **Quanto preciso vender por mês para empatar** (topo de Relatórios): `pontoEquilibrioMedio` = custos fixos médios (pessoal + fixas + operacionais + despesas a classificar) ÷ margem de contribuição em % da receita, nos últimos 3 meses completos com venda.

**PEDIDOS-CONSOLIDADOS, seção A: custo na venda do Caixa**
- Caixa › Lançar › Venda tem o bloco **"Itens vendidos"** (`itens-caixa.js`): material, bitola, acabamento, quantidade (e comprimento), preço da tabela editável. Usa `window.Calculadora.calcularLinha` e `itensDaVenda` (os mesmos do Vender, que chamam `calcularItem`). Com itens, total e CMV saem dos itens (total só leitura, CMV calculado mostrado); sem itens, aviso "Sem itens, o custo será estimado…" e o campo manual do CMV.
- **Margem padrão inicial: 50%** (era 30%). Configuração já salva em Ajustes › Financeiro mantém o valor salvo.
- **DRE:** linha "(−) CMV calculado pelos itens" (vendas com itens), "(−) CMV informado à mão" (com CMV sem itens) e quadro "Custo das vendas (CMV) do mês" com R$ e % de cada origem (`info.cmvOrigem`). A margem média real usa também as vendas do Caixa com itens.
- E2E: `tests/e2e/caixaitens.mjs`.

**Contabilidade simplificada (AJUSTES-B-C-CONTABIL, item 2)**
- `estimativasContabeis` na config financeira, **desligado por padrão** (Ajustes › Financeiro › "Estimativas contábeis"). Desligado: sem DAS estimado (e sem pendência de RBT12), sem FGTS estimado e sem provisão de 13º/férias; o 13º/férias pago entra no mês em que foi pago; o campo Vínculo do salário e o "Aplicar vínculo" ficam escondidos (o gravado é mantido). Guias reais (DAS, FGTS), salários, despesas, CMV, taxas de cartão e custos a classificar contam sempre. Ligado: volta como antes, com a configuração guardada.
- Rodapé do DRE (mês e ano, tela e impressão): "Estimativas contábeis ligadas/desligadas". O "quanto vender para empatar" usa o mesmo modo.
- Motivo: a madeireira terá escritório de contabilidade novo cuidando da parte fiscal.

**Seção B: impressão em vias (pedidos e orçamentos)**: layout aprovado pelo usuário (exemplo em PDF)
- `lib/impressao.js` (puro): `documentoDaVenda`, `documentoDoOrcamento`, `linhasImpressas` (unitário final com 2 casas, linha = qtd × unitário, centavos de diferença na última linha para fechar com o total), `folhaHtml(doc, loja, { modo: "duas"|"loja"|"cliente", paginaInteira })` e `CSS_FOLHA`. Nunca entra custo, margem, tabela, %, motivo, conta corrente.
- `impressao-ui.js`: janela única (`window.Impressao.abrir({ venda | orcamento, titulo, mensagem })`) com 2 vias / só loja / só cliente (lembrada no aparelho, `madeireira_vias_modo`), prévia, 🖨 Imprimir (A4, `@page { margin: 0 }` só durante a impressão: sem cabeçalho/rodapé do navegador) e ⬇ Baixar PDF (html2canvas + jsPDF guardados em `vendor/`, carregados só quando pedem o PDF). Pedido que não cabe em meia folha: uma via por página, com aviso. `window.Via.imprimir` continua (abre a janela).
- Onde aparece: Vender (🖨 Imprimir 2 vias, rascunho sem número), depois de registrar venda (Vender e Caixa › Lançar: "Venda V-0012 registrada"), depois de salvar orçamento, menu ⋯ dos orçamentos, Caixa › Lançamentos (🖨 Vias), A receber › Ver (🖨 Vias).
- Numeração: o servidor dá `numero` V-0001… a toda `venda_produtos` nova (contador atômico `madeireira_venda_seq`); corrigir mantém; estorno é exclusão suave (o número fica). Lançamentos novos ganham `criadoEm` (hora na via). Primeira impressão grava `impressoEm` (PATCH /api/lancamento `{acao:"impresso"}`); as seguintes saem "2ª impressão em DD/MM".
- Corrigir venda: com itens, `Calculadora.carregarVenda` (itens com o preço vendido, frete, data, NF-e, formas) e o Registrar vira "Salvar correção da V-0001"; sem itens, o Caixa › Lançar volta preenchido. O servidor guarda `historico: [{ em, valorAntes }]`. Os itens gravados agora têm `quantidade`, `comprimento`, `precoManual`, `totalManual`, `descricaoLivre`.
- Ajustes › Impressão: `configFinanceiro.impressao` { nome, telefone, endereco, cnpj }.
- Lançamentos: coluna Nº, busca por "V-0012", "v12" ou "12", botões 🖨 Vias, Corrigir e Estornar nas vendas.
- E2E: `tests/e2e/impressao.mjs` (PDF real no Chrome: 5 itens = 1 página; 15 itens = 2) e `tests/e2e/janela.mjs` (fecha a janela nas outras baterias).

**Seção C: Relatórios › Resumo do dia** (o fechamento do balcão)
- Primeira sub-aba de Relatórios e a que abre por padrão, sempre no dia de hoje (o Mês fica ao lado). ◀ ▶, Hoje e "Período" (de/até). Atalho em Caixa › Saldos, no quadro da gaveta: "Ver resumo do dia".
- `lib/resumoDia.js` (`resumoDoDia`), sobre as mesmas funções do DRE (`montarDRE` com `deDia`/`ateDia`; a regra do CMV estimado é decidida pelo mês inteiro) e do fluxo (`movimentos`): a soma dos dias fecha com o mês (testado).
- Panorama do caixa por conta (início, entradas, saídas, transferências/compensação de cheque, fim; recebíveis de cartão; gaveta esperado × contado da última contagem do dia); quadros (vendido, entrou no caixa = dinheiro que entrou em gaveta/Bradesco/PicPay, saiu, saldo, fiado vendido, recebido de fiado e quanto foi de fiado anterior); entradas por forma (total = vendido + recebimentos); saídas pagas no dia por grupo, com "Pago com"; lista em ordem de hora (`criadoEm`) com Nº, filtros, 🖨 Vias e estornados riscados (o servidor manda `estornados` dos últimos 120 dias); cheques; orçamentos (criados, convertidos, perdidos); resultado (vendas − CMV), que some no modo balcão.
- Imprimir fechamento: 1 página A4 (a lista vai junto até 8 lançamentos; mais que isso, numa página extra), com "Conferido por" e a opção "imprimir sem custo e margem".
- E2E: `tests/e2e/resumodia.mjs`.

**Entrega final, etapa 1a: correções críticas da varredura** (plano aprovado: página "Entrega final da virada")
- Lançamentos v2 têm `versao` (sobe a cada gravação), `criadoEm`, `atualizadoEm`. Correção de venda manda `versaoBase`: se mudou em outro aparelho, 409. Venda estornada não volta por correção (409). Venda não troca de tipo numa correção.
- Telas travam o botão durante a gravação; a nova tentativa usa o mesmo id (Vender: só se for o mesmo pedido). Mesmo id sem `versaoBase` = nova tentativa (não duplica).
- Venda com `orcamento`: o servidor confere o orçamento antes e fecha na mesma gravação (`orcamentosFechados`); o PATCH separado saiu. Estornar a venda reabre o orçamento (`orcamentoReaberto`).
- `salvarConfigFinanceiro` junta a alteração com a configuração salva (`juntarConfig`): salvar Financeiro não apaga Impressão.
- Cheque: data de compensação obrigatória (tela e servidor). Transferência de/para `cheques_carteira` recusada.
- Taxa de cartão: `taxaCartaoCentavos` (planoContas) usada pelo caixa e pelo DRE, em todo pagamento em cartão (vendas, serviços, frete, recebimento de fiado), arredondada por pagamento. CMV estimado arredondado por venda: soma dos dias = mês ao centavo.
- Conferências (fechar gaveta, extrato) num hash próprio (`madeireira_conferencias`): duas ao mesmo tempo não se apagam (backup, restaurar e Zerar incluem a chave).
- "Selecionar todos" em Lançamentos marca só o que está na tela; a busca limpa a seleção. A cópia local no aparelho não derruba mais a conexão se a memória encher. Abertura refeita não soma cheques já compensados.
- E2E: `tests/e2e/criticos.mjs`.

**Entrega final, etapa 1b: importantes da varredura e integração**
- `lib/datas.js` (`dataSP`, `hojeSP`): datas sempre em America/Sao_Paulo (servidor em UTC e aparelhos em qualquer fuso). Usado no 🔔 de orçamento, lixeira, Resumo do dia (perdido/convertido), "2ª impressão", datas padrão do servidor, nome do backup e `getLocalDateString`.
- Senha: depois de 10 erros do mesmo endereço em 15 min, 429 com espera (`autorizar` agora é assíncrona). Botão "Sair" no topo apaga senha e cópia local do aparelho.
- Celular: todas as telas cabem em 390px (seletor de opções corrigido, cartões em 1–2 colunas, menu ⋯ dos orçamentos abre por baixo da tela, Lançamentos vira fichas).
- Desempenho: `normalizar` guarda o resultado enquanto a lista não muda; busca de Lançamentos espera a digitação parar (180 ms); lista de 300 em 300 com "Mostrar mais".
- Fechar gaveta recarrega os dados antes (esperado atualizado) e usa janela própria (`perguntar`), como a data do cheque devolvido. Corrigir venda mantém o custo gravado de cada item (`custoUnitarioGravado`).
- Resumo do dia: início = abertura no próprio dia da abertura e em período que começa antes; orçamentos da lixeira fora; outras entradas pela data do pagamento; cheque compensado e depois devolvido conta nos compensados.
- Termos: forma "Fiado" (a via do cliente continua dizendo "A prazo"), tela "A receber"; "Data" no Lançar; "Custo dos produtos"; sem tPag e "Fase 2D" em Relatórios; "🖨 Imprimir relatório" e "🖨 Imprimir vias".
- Servidor: rotas de leitura só aceitam GET; orçamento recusado não mexe no cadastro do cliente.
- E2E: `tests/e2e/integracao.mjs` (fluxos da tabela 1.1 e regras de consistência sobre os dados gravados).

## 7. Próximos passos
1. **Virada** (antes da 2D): ensaio no preview e depois o dia, conforme `VIRADA.md` e o checklist. 2C testada (ok), prazo 30 dias, fiado da pasta em conta corrente (entregue). Pendentes do usuário: resultado do ensaio no preview, nome do endereço e as datas.
2. ~~Fase 2C~~ (entregue).
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
- **Custos "a classificar" (compra ou CMV) dos dados antigos:** o pai precisa classificar. Enquanto não classifica, entram como custo na linha amarela e o DRE fica "provisório".
- **RBT12** para o DAS estimado: pedir ao escritório e preencher em Ajustes › Financeiro.
- **Fiado:** prazo padrão de 30 dias confirmado. Clientes da pasta usam conta corrente (sem vencimento).
- **A virada (A ou B)** ainda não foi decidida.
- **Resumo do mês e Fluxo de caixa antigos:** removidos na etapa 2 da entrega final; Relatórios › Mês (mesmo layout do Dia, período = mês) e a projeção de 30 dias em Caixa › Saldos ocupam o lugar.

**Entrega final, etapa 2: Relatórios**
- Sub-abas: Dia · Mês · DRE · A receber · Orçamentos · Formas de pagamento. Dia e Mês usam a mesma tela (`#rel-dia-sec`, `resumo-dia-ui.js`); `mostrarSub` esconde todas e depois mostra a escolhida (por isso Dia e Mês podem dividir a seção).
- Ordem da tela: 3 números (Vendeu N pedidos · Entrou no caixa ⓘ · Saiu) + linha "Fiado vendido · Recebido de fiado" → Caixa por conta (gaveta: contado/faltou/sobrou ou botão Fechar gaveta) → Entradas por forma | Saídas por conta → "Ver os N movimentos" (recolhido) → Mês: "Dia a dia do mês" (recolhido) → "Mais detalhes" (cheques, orçamentos, resultado; o resultado some no modo balcão).
- Mês: quadro "Quanto preciso vender por mês para empatar" no topo; caixa por conta do mês até hoje (o que vence depois fica na projeção de 30 dias de Caixa › Saldos).
- DRE: linhas zeradas escondidas ("mostrar linhas zeradas"), um só bloco amarelo de avisos.
- Imprimir: "Imprimir fechamento" (Dia) / "Imprimir relatório do mês" na mesma ordem da tela.

**Varredura, complemento (antes da etapa 3):** trava curta por lançamento (`comTrava` em api/_dados.js, chave `<trava>:lanc:<id>`, expira em 15 s) em salvar/corrigir, marcar impressão, atualizar cheque e estornar: com dois aparelhos ao mesmo tempo, uma gravação espera a outra e lê o que ela gravou (teste "dois aparelhos no mesmo lançamento" em tests/dados.test.js). Teste e2e da memória do aparelho cheia em tests/e2e/criticos.mjs.
