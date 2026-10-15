# Fase 2C: fiado e contas a receber (entrega)

Vender fiado, saber quem deve quanto e desde quando, receber total ou em parte (inclusive em cheque), cobrar pelo WhatsApp e ver o total "na rua". Tudo dentro do **Caixa › A receber**, como no esboço aprovado.

## O que mudou

### Vender fiado
- Nova forma de pagamento **"Fiado (a receber)"** (tPag 05) em **Vender** e em **Caixa › Lançar › Venda**. Pode ser misturada com outras (ex.: R$ 100 em dinheiro + R$ 400 no fiado).
- Ao escolher Fiado:
  - **cliente obrigatório**. Em Vender aparece o campo do cliente na própria forma; em Lançar vale o campo "Cliente". Se o nome não estiver no cadastro, o sistema pergunta se quer cadastrar e pede o WhatsApp (**opcional**: cliente sem WhatsApp ganha um código C1, C2…);
  - **vencimento** sugerido = data da venda + **prazo padrão (30 dias)**, e pode ser trocado em cada venda.
- Venda de um orçamento convertido já traz o nome do cliente para o fiado.
- **Receita e CMV entram na data da venda** (DRE), mas o fiado **não entra no caixa**: só o dinheiro que entra de verdade mexe nos saldos.

### Caixa › A receber (sub-aba nova)
- No topo: **A receber (fiado)**, **Atrasado**, **Cheques em carteira** e **Total na rua** (fiado + cheques em carteira).
- **A receber por cliente**: em aberto, atrasado, maior atraso em dias e próximo vencimento. Quem tem atraso fica em vermelho. Busca por nome ou telefone; "Mostrar também quem já pagou tudo".
- **Ver ▾**: cada compra no fiado (data, vencimento, valor, pago, em aberto, situação) e os recebimentos, com **Estornar** (a dívida volta).
- **Receber**: valor (já vem com o total; pode ser **parcial**), data, forma (dinheiro, PIX, cartão, cheque… menos fiado) e "Abater em" (automático = as mais antigas primeiro, ou uma compra escolhida).
  - Em **cheque**, ele vai para a **carteira** e aparece em Caixa › Cheques com o nome do cliente; compensa na data como os outros.
  - **Cheque devolvido** (botão "Devolvido" em Cheques) **reabre a dívida sozinho** e aparece no detalhe como "Cheque devolvido nº …". Isso vale também para cheque de venda à vista: o valor passa a ser cobrado do cliente (ou do emissor, se a venda não tinha cliente).
  - Pagou a mais: fica de **crédito** do cliente e abate a próxima compra.
- **Cobrar 💬**: abre o WhatsApp com a lista do que está em aberto e os vencimentos (nada é enviado sozinho). Só aparece para quem tem WhatsApp.
- **Clientes (cadastro)**: lista, **cadastrar** e **editar** (nome, WhatsApp, observação). É o mesmo cadastro dos orçamentos. Editar não muda o código do cliente.

### Outros lugares
- **Relatórios › A receber** (para imprimir): a receber por cliente com atraso, cheques a compensar nos próximos 30 dias e total na rua.
- **Caixa › Lançamentos**: filtro "Fiado e recebimentos"; recebimentos aparecem como "Recebimento de fiado" e ficam fora do "saldo do filtro" (não são receita: a receita entrou na venda).
- **Fluxo de caixa**: entrada nova "Recebimentos de fiado".
- **Ajustes › Financeiro › Fiado**: ligar/desligar a venda fiado e o prazo padrão (1 a 365 dias). Na tabela de formas, o Fiado aparece com destino "Contas a receber" e o tPag editável.

### Por dentro
- Nada é "baixado" no banco: o saldo de cada cliente é **recalculado** a partir das vendas fiado, dos recebimentos e dos cheques devolvidos (`lib/receber.js`). Por isso excluir uma venda, estornar um recebimento ou devolver um cheque já atualiza tudo sozinho.
- Regra de abatimento: cada recebimento abate as compras que **já existiam** na data dele (a escolhida primeiro, depois as que vencem antes); o que sobra vira crédito para as compras seguintes. Assim uma compra nova nunca "reabre" uma que já estava paga.
- Recebimento é um lançamento `conta: "recebimento"` (cliente, formas, compras indicadas). A venda guarda `clienteId` e, na forma fiado, `fiado.vencimento`.
- Rota nova **`/api/clientes`** (GET lista, POST cadastra/edita), já no roteador único (sem função nova na Vercel). Chave nova no banco: `madeireira_cli_seq` (contador C1, C2…), incluída no backup e na restauração.

## Como testar (no v2)
1. **Ajustes › Financeiro**: confira a seção **Fiado** (ligado, 30 dias).
2. **Vender**: monte um pedido, troque a forma para **Fiado (a receber)**, digite um cliente novo (ex.: "Teste Fiado"), confira o vencimento e **Registrar venda**. Aceite cadastrar e deixe o WhatsApp em branco.
3. **Caixa › Lançar › Venda**: lance outra venda fiado para o mesmo cliente, com vencimento **já passado**.
4. **Caixa › A receber**: veja os cartões, o atraso em vermelho e **Ver ▾**.
5. **Receber** uma parte **em cheque**: o atrasado zera (abate a mais antiga) e o cheque aparece em **Caixa › Cheques**. Marque o cheque como **Devolvido**: a dívida volta em A receber.
6. **Estornar** o recebimento no detalhe; depois **Receber** o total em dinheiro: fica quitado e a gaveta sobe em **Caixa › Saldos**.
7. **Clientes (cadastro)**: edite o cliente e coloque um WhatsApp; volte e use **Cobrar 💬**.
8. **Relatórios › A receber** e **Imprimir A4**. No **DRE** do mês, a venda fiado está na receita e o recebimento não aparece de novo.

Testes feitos aqui (dados sintéticos): `npm test` (122 passando) e `bash tests/e2e/rodar.sh` (9 baterias, tudo passando; a nova é `fiado`, 31 verificações).

## Como voltar atrás
- **Vercel**: Instant Rollback para o deploy anterior.
- **Código**: `git revert` do commit da Fase 2C.
- **Dados**: as vendas fiado gravadas continuam válidas na versão anterior (ela só não mostra o A receber: a forma "Fiado" aparece como uma forma sem conta, fora do caixa, como já acontecia com "forma não informada"). Recebimentos (`conta: "recebimento"`) ficam guardados, mas a versão anterior não os reconhece no caixa. Antes de reverter, prefira **Exportar** o backup.

## Decisões tomadas sem perguntar (dá para mudar)
- **Prazo padrão de 30 dias**, configurável em Ajustes, e **vencimento por venda** (cada venda pode ter o seu). Era uma pendência do CONTEXTO.
- Cliente do fiado **pode não ter WhatsApp** (cadastro com código C1, C2…), porque muito cliente antigo de fiado não usa WhatsApp. O orçamento continua exigindo WhatsApp.
- Fiado a vencer **não entra na projeção de 30 dias** dos Saldos (ela mostra só dinheiro que tem data certa: cartão, cheques, contas a pagar). O total aparece em A receber. Se quiser, entra como "previsto" na 2D.
