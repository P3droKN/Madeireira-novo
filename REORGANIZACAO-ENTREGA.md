# Reorganização: 5 abas claras (entrega)

O sistema funciona igual, só que com cada coisa num lugar só. **Nenhum dado foi apagado nem convertido** e todas as funções antigas continuam, no lugar novo. A única gravação nova é a marca "excluído em" quando alguém exclui um orçamento (o orçamento continua guardado).

## O que mudou

### Abas
| Antes | Agora |
|---|---|
| Calculadora | **Vender** (o sistema abre aqui) |
| Orçamentos | **Orçamentos** |
| Gestor de Caixa + Financeiro (dois "Novo lançamento") | **Caixa** › Lançar · Saldos · Cheques · Lançamentos (abre sempre em **Lançar**) |
| DRE e resumos espalhados | **Relatórios** › Resumo do mês · DRE · Fluxo de caixa · Formas de pagamento · Orçamentos |
| Preços + configurações espalhadas | **Ajustes** › Preços · Financeiro · Orçamentos · Saldos · Dados |

### Vender
- O pedido termina em **Salvar como orçamento** e **Registrar venda**, como antes.
- **👁 Modo balcão:** esconde as colunas Custo e Margem, os quadros de custo e margem, o custo na lista de medidas e na prévia do item. Clicar de novo mostra tudo. A escolha fica guardada **no aparelho** (o computador do balcão pode ficar sempre ligado e o do escritório, desligado).

### Caixa
- **Lançar:** só existe o formulário novo (Venda / Saída / Outra entrada / Transferência). **O formulário antigo (Categoria / Valor / Método) saiu.**
- **Saldos:** saldo de hoje por conta, "Conferir com o extrato", "Fechar gaveta" e a projeção de 30 dias. Sem abertura de saldos, aparece um aviso com o botão para Ajustes › Saldos.
- **Cheques:** recebidos e emitidos, com Devolvido e Desfazer (igual à 2B).
- **Lançamentos:** a lista com filtros e ações em lote, agora com o botão **Excluir** em cada linha (o mesmo "excluir" de antes, com confirmação; o lançamento continua guardado com a marca de excluído). Ela substitui o "Histórico de Movimentações" antigo.
- Saíram os quadros repetidos ("Dinheiro Físico", "Saldo do Mês", "Total Mês Pix/Crédito/Débito" e "Monitoramento Detalhado para Declaração"). A gaveta está em Saldos; o resto foi para Relatórios.

### Relatórios
- Uma barra com o **mês** (e **Mês/Ano** no DRE) e **🖨️ Imprimir A4**, que imprime só a seção aberta.
- **Resumo do mês:** a antiga tabela "Monitoramento detalhado para declaração" (lançado no dia, acumulado e total), com o dia de referência. **Dá exatamente os mesmos números** da tela antiga (há um teste que compara as duas contas). Vendas novas (feitas pelo Vender ou pelo Lançar) agora entram certinhas nas linhas PIX/Crédito/Débito pelas formas de pagamento.
- **DRE**, **Fluxo de caixa** (veio do Caixa da 2B) e **Orçamentos** (tempo médio até fechar, motivos de perda, origem).
- **Formas de pagamento** (novo, versão simples): total do mês por forma, com tPag, quantidade e %. O CSV para o escritório fica para a 2D, como estava no plano.

### Ajustes
- **Preços:** a aba Preços inteira.
- **Financeiro:** formas de pagamento e contas (tPag), cartão, margem padrão, FGTS/provisões, Simples, depreciação, estoque, cheques.
- **Orçamentos:** validade padrão, dias para o 🔔 e os modelos de mensagem do WhatsApp.
- **Saldos:** Abertura de saldos (fazer/refazer) e **Saldos passados** (o antigo "Lançar acumulado").
- **Dados:** Exportar, Importar, Restaurar, Conferir com arquivo e a linha "Banco: … · trava de produção". Os avisos importantes (sem conexão, salvamento seguro, banco travado) continuam no alto de qualquer aba.

### Orçamentos
- **Só 3 situações:** Em aberto → Fechado (virou venda) ou Perdido. Não existe mais "Aguardando cliente" nem o seletor na linha: os orçamentos que estavam "aguardando" aparecem em **Em aberto** (o dado gravado não foi mexido). Enviar/Cobrar só registram o contato.
- A situação muda **pelas ações**: Converter em venda → Fechado; Marcar como perdido (motivo em botões) → Perdido; **Reabrir** (em Perdido, ou em Fechado cuja venda foi estornada) → Em aberto.
- **Vencido é só aviso:** selo vermelho "vencido – preços podem ter mudado" e o botão Atualizar preços. O orçamento **continua em aberto**.
- **🔔** na linha quando está em aberto há 3 ou mais dias sem contato (configurável). No topo, "🔔 Para cobrar hoje": clicar mostra só esses. A aba Orçamentos mostra "🔔 N".
- Lista com **3 abas rápidas** (Em aberto · Fechados · Perdidos) e busca por nome ou telefone. Datas e ordenação ficam em "Mais filtros".
- Ações visíveis: **Enviar**, **Cobrar**, **Converter em venda**. No menu **⋯**: Editar, Duplicar, Imprimir, Atualizar preços, Marcar como perdido, Reabrir, **Excluir**.
- **Excluir** (novo): pede "Excluir ORC-0001 de Cláudio?". Perdido = cliente não fechou (conta nos indicadores); Excluir = erro ou teste (some da lista e dos indicadores). O excluído vai para a **🗑 Lixeira** (link no rodapé), de onde dá para **Restaurar**. Depois de 30 dias ele sai da Lixeira, **mas continua guardado no banco e nos backups**. Orçamento convertido em venda **não pode ser excluído** (o menu explica: estorne a venda no Caixa).
- Topo com **só 3 indicadores**: Em aberto (R$ e quantidade), Conversão do mês e 🔔 Para cobrar hoje.

### Por dentro (API)
- As 12 rotas viraram **uma função só** na Vercel (`api/[recurso].js` + `api/_rotas.js`). Os endereços (`/api/getFinance`, `/api/lancamento`…) e o comportamento são os mesmos; os testes deram os mesmos resultados antes e depois. Assim a 2C e a 2D podem ganhar rotas sem esbarrar no limite de 12 funções do plano gratuito.
- Orçamentos ganharam as ações `excluir` e `restaurar`; `reabrir` passou a aceitar fechado sem venda ativa; `contato` não muda mais a situação; a ação `status` (do seletor) saiu.

## Como testar (no v2: https://madeireirav2.vercel.app)
1. **Abrir o site:** deve abrir em **Vender**. As abas são Vender · Orçamentos · Caixa · Relatórios · Ajustes.
2. **Modo balcão:** monte um pedido, clique em **👁 Modo balcão**. Custo e margem somem (colunas, quadros, lista de medidas). Recarregue a página: continua escondido. Clique de novo: volta.
3. **Caixa:** clique em Caixa, deve abrir em **Lançar** com o formulário Venda / Saída / Outra entrada / Transferência (e nenhum outro "Novo lançamento"). Lance uma saída de teste, vá em **Lançamentos**, ache a linha e use **Excluir**.
4. **Saldos e Cheques:** confira se os saldos, a projeção e os cheques estão como estavam na 2B. A abertura de saldos agora fica em **Ajustes › Saldos**.
5. **Relatórios › Resumo do mês:** escolha agosto/2026, dia 31: compare com o que a tela antiga mostrava (devem ser os mesmos valores). Veja DRE, Fluxo de caixa, Formas de pagamento e Orçamentos, e teste **Imprimir A4**.
6. **Orçamentos:**
   - salve um orçamento de teste pela aba Vender; ele aparece em **Em aberto**;
   - clique em **⋯ › Excluir**, confirme: some da lista e dos números do topo; abra **🗑 Lixeira** e **Restaurar**;
   - **⋯ › Marcar como perdido**: vai para a aba Perdidos; lá, **⋯ › Reabrir** volta para Em aberto;
   - converta um em venda: ele vai para Fechados e o ⋯ não oferece Excluir.
7. **Ajustes › Dados:** a linha do banco deve mostrar o host do v2 e "trava de produção: ativa". Exportar continua baixando o backup completo.

Testes automáticos (feitos aqui, com dados sintéticos): `npm test` (105 passando) e `bash tests/e2e/rodar.sh` (fluxo 31, fase1b 28, lotes 5, trava 6, fase2a 31, orcamentos 57, fase2b 25: tudo passando). Inclui os pedidos: excluir e restaurar da lixeira, vencido continua em aberto, convertido não pode ser excluído, modo balcão esconde custo e margem, só existe um formulário de lançamento.

## Como voltar atrás
- **Rápido (Vercel):** no projeto `madeireira.v2` › Deployments, escolha o deploy anterior a esta entrega e use **Instant Rollback** (ou "Promote to Production").
- **Pelo código:** são dois commits independentes:
  - a reorganização das telas (`e8900fb`): `git revert e8900fb` volta as telas antigas;
  - a API em roteador único (`8e329be`): `git revert 8e329be` volta os 12 arquivos em `api/`. Dá para voltar só as telas e manter a API nova, porque os endereços são os mesmos.
- **Dados:** nada precisa ser desfeito. Os orçamentos "aguardando" continuam gravados como estavam; um orçamento excluído só tem a marca `excluidoEm`, que a versão antiga ignora (ele simplesmente aparece de novo na lista antiga).

## Ajuste depois da entrega: % geral e frete
- **% geral não fazia nada nos itens sem preço de tabela** (quase todos hoje, porque os preços começam vazios): o campo voltava vazio, sem aviso. Agora o % (geral, da linha e dos botões Selecionada/Últimas peças) vale **sobre o preço digitado** quando o item não tem tabela. Aplicar de novo não acumula, e "↺ Voltar" volta ao preço digitado. Itens com tabela continuam sobre a tabela.
- **🚚 Frete / entrega (opcional)**, logo abaixo do % geral. Quando preenchido:
  - o pedido mostra a linha "Frete / entrega" e "Total (itens + frete)"; o total a cobrar e as formas de pagamento já incluem o frete;
  - o texto do WhatsApp mostra "Itens", "Frete/entrega" e o total; a impressão também;
  - o orçamento guarda o frete (a lista mostra "com frete") e ele volta junto ao converter em venda; "Atualizar preços" mantém o frete;
  - a venda grava o valor total e o frete separado; em Caixa › Lançamentos aparece "inclui frete"; no DRE fica na receita, com a linha "Frete cobrado dos clientes", e **não entra na margem nem no CMV estimado dos produtos**.
- O botão "Frete/entrega" saiu da lista de motivos do %, para não confundir com o frete de verdade.
- **Como testar:** em Vender, adicione um item sem preço de tabela, digite o preço, ponha 10 no "% geral" e aperte Enter ou clique fora: o total sobe 10%. Preencha o frete com 50: aparece a linha do frete e o total a cobrar soma os R$ 50. Salve como orçamento, converta em venda e confira em Caixa › Lançamentos e no DRE.
- **Voltar atrás:** `git revert` do commit "Frete à parte no pedido e % sobre o preço digitado" (vendas e orçamentos já gravados com frete continuam válidos; a versão anterior só não mostra o frete separado).
