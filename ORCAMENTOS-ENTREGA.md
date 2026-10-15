# Orçamentos: entrega

## O que mudou
- **Calculadora:** botão **"💾 Salvar como orçamento"** ao lado de "Registrar venda".
  - Pede: nome, WhatsApp com DDD (validado na hora: DDD existente, 10 ou 11 dígitos, celular começando com 9), origem (Balcão / WhatsApp / Telefone), observação e validade (padrão 7 dias).
  - Número sequencial: **ORC-0001, ORC-0002…**
  - Grava os itens com os preços do dia, o % aplicado, o total, o custo e a margem (custo e margem só para uso interno).
- **Cadastro de clientes:** nome, WhatsApp e observação. É o mesmo cadastro que vai servir ao fiado na 2C.
  - A chave é o telefone: o mesmo número é o mesmo cliente.
  - Ao digitar o nome, aparecem sugestões; ao digitar um telefone já cadastrado, o nome é preenchido.
- **Aba "Orçamentos":**
  - colunas: nº, cliente, data, dias em aberto, valor, origem, status e último contato;
  - status: Aberto → Aguardando cliente → Fechado (virou venda) ou Perdido;
  - "Perdido" pede o motivo em botões: Preço, Comprou em outro lugar, Desistiu, Sem resposta, Outro;
  - filtros por status, período e cliente (nome ou telefone);
  - ordem padrão: os mais antigos em aberto primeiro, ou por maior valor;
  - cores: **amarelo** com 3 ou mais dias sem contato, **vermelho** quando vence ("preços podem ter mudado" e o botão **Atualizar preços**).
- **Botões de cada orçamento:**
  - **Enviar** e **Cobrar no WhatsApp:**
    - abrem `wa.me/55DDDNÚMERO` com a mensagem pronta e editável;
    - a mensagem leva os itens e o total, **sem custo, margem nem preço de tabela**;
    - a cobrança usa os modelos editáveis, com `{nome} {numero} {valor} {dias} {validade}`;
    - o clique registra o último contato.
  - **Converter em venda:** você escolhe os preços do orçamento ou os de hoje. O pedido vai para a Calculadora e, ao registrar a venda, o orçamento fica **Fechado** com vínculo para a venda.
  - **Atualizar preços:** recalcula pela tabela de hoje, mantendo o % de cada item, mostra a diferença por item e no total, e renova a validade ao aplicar.
  - **Duplicar** (gera número novo), **Editar** (mantém o número), **Imprimir** (sem custo e margem) e **Reabrir** um perdido.
- **Lembrete:** no topo da aba aparece "X orçamentos para cobrar hoje" (em aberto há 2 ou mais dias sem contato), e há um contador na própria aba. **Nada é enviado sozinho.**
- **Indicadores:** valor em aberto, conversão do mês, tempo médio até fechar, motivos de perda e orçamentos por origem.
- **Financeiro › Configuração › Orçamentos:** validade padrão, dias para cobrar, dias para ficar amarelo e até 3 modelos de cobrança.
- O preço continua vindo da mesma função da Calculadora (`calcularItem`).

## Como testar no v2
1. **Calculadora:**
   - monte um pedido e mude o % de um item;
   - clique em **Salvar como orçamento**;
   - teste um telefone sem DDD (deve recusar) e depois um válido;
   - origem WhatsApp → salvar.
2. **Orçamentos:**
   - **Enviar:** confira a mensagem e clique em "Abrir no WhatsApp". A coluna "Último contato" é preenchida e o status vira "Aguardando cliente";
   - **Cobrar:** troque o modelo e confira nome, número, valor e validade.
3. **Atualizar preços:** mude o preço de tabela do item na aba Preços e use "Mais ▾ › Atualizar preços" para ver a diferença.
4. **Converter em venda** › "Com os preços do orçamento" › **Registrar venda**. O orçamento vira **Fechado** e a venda aparece no Financeiro.
5. Marque outro como **Perdido** › "Preço" e veja os indicadores.
6. **Duplicar**, **Editar** (o número continua o mesmo) e **Imprimir**.
7. Os amarelos e vermelhos aparecem com o passar dos dias. Para ver na hora, crie um orçamento com validade de 1 dia e abra a aba no dia seguinte.

## Como voltar atrás
- **Código:** Vercel › madeireira.v2 › Deployments › deploy anterior ("Fase 2A…") › **Instant Rollback**. Ou, no GitHub, reverta o commit "Orçamentos…".
- **Dados:**
  - os orçamentos e os clientes ficam em chaves novas (`madeireira_orcamentos`, `madeireira_clientes`, `madeireira_orc_seq`) e **não mexem nos lançamentos**;
  - a única mudança em lançamentos é o campo `orcamento` nas vendas convertidas;
  - o backup (💾 Exportar) inclui as chaves novas, e ♻️ Restaurar volta tudo, inclusive o contador.
  - Restaurar um backup antigo, de antes dos orçamentos, **não apaga** os orçamentos.

## Testes
- **Automáticos:** 81 (`npm test`), incluindo:
  - telefone com DDD;
  - link wa.me `55DDDNÚMERO` com o texto correto;
  - modelos;
  - validade e cores;
  - atualizar preços com o mesmo %;
  - indicadores e ordem;
  - número sequencial e cliente pelo telefone;
  - contato, perdido, reabrir, editar, fechar com venda e backup.
- **No navegador:** 30 passos com o relógio controlado, passando por salvar, enviar, cobrar, lembrete, amarelo, vencido, atualizar preços, converter, perdido, indicadores, duplicar, editar e imprimir. As baterias anteriores continuam passando.
