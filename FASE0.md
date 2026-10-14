# Fase 0: segurança e dados

## O que mudou

| Antes | Agora |
|---|---|
| A API não pedia senha, e qualquer pessoa com o link lia ou apagava tudo. | Toda rota exige a senha `SENHA_APP`. Cada aparelho pede a senha uma vez e guarda. |
| Cada lançamento regravava a lista inteira, e dois aparelhos se apagavam. | Cada lançamento é gravado sozinho (hash `madeireira_lancamentos`). |
| Sem internet, um aparelho podia gravar dados velhos por cima da nuvem. | Sem internet, a tela fica **só para consulta** e não grava nada. |
| "Importar" substituía tudo. | "📂 Importar" **junta**: só adiciona o que falta e não apaga nada. |
| Não havia como voltar atrás. | "♻️ Restaurar" volta exatamente ao estado de um backup, e antes guarda uma cópia do estado atual. |
| "Excluir" apagava na hora, sem perguntar. | Pede confirmação e só **marca** como excluído (continua guardado no backup). |
| A descrição podia rodar código na tela. | O texto aparece sempre como texto. |
| Testes no preview mexiam nos dados reais. | O preview usa chaves separadas (`preview:…`). A produção continua com os nomes originais. |

A lista antiga (`madeireira_finance`) **não é alterada nem apagada**. Depois da migração, ela fica parada como cópia de segurança.
Antes de cada operação que substitui dados (migração, restauração, alteração do acumulado e download de backup), o servidor guarda uma cópia automática no KV. As 30 mais recentes ficam guardadas.

Os cálculos, as telas e os relatórios continuam como estavam. Isso muda nas Fases 1 e 2.

---

## Como restaurar o backup

Há três formas, da mais simples para a de emergência.

### A) Pela tela
1. Gestor de Caixa › **♻️ Restaurar**.
2. Escolha o arquivo `.json` do backup.
3. Digite `RESTAURAR` para confirmar.

Funciona com os dois tipos de arquivo:
- o backup novo ("💾 Exportar" ou "1. Baixar backup");
- o arquivo do **"Exportar" antigo** (`madeireira_backup_AAAA-MM-DD.json`).

O aviso no fim mostra o nome da cópia do estado anterior. Ou seja, **restaurar também pode ser desfeito**.

Restaurar o backup feito **antes** da migração deixa o sistema exatamente como era: lista antiga, acumulado e salvamento seguro desligado.

### B) Pela linha de comando (se a página não abrir)
```bash
SENHA_APP=suasenha node scripts/restaurar.mjs https://madereira-caixa.vercel.app madeireira_backup_production_2026-10-14.json
```

### C) Emergência: voltar o código
Vercel › projeto **madereira** › Deployments › escolha o deploy anterior (o de hoje) › **Instant Rollback**.

O código antigo volta a ler `madeireira_finance` e `madeireira_acumulado`, que a nova versão nunca alterou. O que for lançado **depois** da migração fica no hash `madeireira_lancamentos` e não aparece no código antigo. Para recuperar esses lançamentos, use a forma A.

### Cópias automáticas guardadas no KV
- Listar: `GET /api/backup?lista=1`
- Baixar uma delas: `GET /api/backup?copia=<nome>`

Os dois pedidos precisam do cabeçalho `x-senha`. Depois de baixar, restaure pela forma A.

---

## Projeto de testes separado (recomendado até tudo estar 100%)

O site atual (`madereira-caixa.vercel.app`) **não é alterado**. Seu pai continua usando normalmente.
O sistema novo vai para outro projeto na Vercel, com **outro banco de dados**.

### 1. Criar o projeto novo
- **Com GitHub (recomendado):** Vercel › **Add New… › Project** › importe o repositório › nome, por exemplo, `madeireira-novo` › Deploy. A cada push, a Vercel publica sozinha.
- **Sem GitHub:**
  1. Descompacte o zip numa **pasta nova**. Não use a pasta do projeto atual, porque nela a pasta `.vercel` aponta para o site em uso.
  2. Rode `vercel` nessa pasta.
  3. Em "Link to existing project?", responda **N** e dê o nome `madeireira-novo`.

### 2. Banco de dados próprio (obrigatório)
Projeto `madeireira-novo` › **Storage** › **Create Database** › **Upstash (Redis)**, no plano gratuito › crie um banco **novo** (ex.: `madeireira-testes`) › Connect.

**Não** conecte o banco que o site atual usa.

### 3. Variáveis
Projeto `madeireira-novo` › Settings › Environment Variables:

| Nome | Valor | Para quê |
|---|---|---|
| `SENHA_APP` | uma senha (pode ser diferente da oficial) | proteger a API |
| `KV_PREFIXO` | `teste:` | segunda proteção: mesmo ligado ao banco errado, só grava em chaves `teste:…` |

Marque Production e Preview nas duas variáveis. Depois, em Deployments, clique em **Redeploy** para valerem.

### 4. Levar uma cópia dos dados reais para o teste
1. No site atual: Gestor de Caixa › **💾 Exportar**. Isso só baixa o arquivo e não altera nada.
2. No site novo: digite a senha › **♻️ Restaurar** › escolha o arquivo › digite `RESTAURAR`.
3. Teste à vontade: ativar o salvamento seguro, lançar, excluir, restaurar de novo. Nada disso chega ao site atual.

Para atualizar a cópia com dados mais recentes, repita os passos 1 e 2. O teste volta a ficar igual ao site atual.

### 5. Quando estiver 100%: a troca
Escolha uma das duas formas (eu ajudo na hora):
- **A) Publicar o código novo no projeto atual.** Siga o "Passo a passo para publicar" abaixo. O banco real continua o mesmo.
- **B) Passar a usar o projeto novo.**
  1. Exporte os dados do site atual.
  2. Remova o `KV_PREFIXO`.
  3. Restaure o arquivo no site novo.
  4. Mude o domínio na Vercel, ou passe o link novo para seu pai.

---

## Passo a passo para publicar

### 1. Backup agora, ainda no sistema antigo
Abra https://madereira-caixa.vercel.app › Gestor de Caixa › **💾 Exportar**. Guarde o arquivo em dois lugares (por exemplo, no computador e no e-mail).

### 2. Criar a senha na Vercel (antes do deploy)
Vercel › projeto **madereira** › Settings › Environment Variables:
- Name: `SENHA_APP`
- Value: a senha escolhida
- Environments: **Production** e **Preview**

Confira na mesma tela se as variáveis `KV_REST_API_URL` e `KV_REST_API_TOKEN` (ou `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN`) também estão marcadas para **Preview**. Se não estiverem, o preview abre como "sem conexão".

Se publicar sem a `SENHA_APP`, nada se perde: a API recusa tudo e a tela abre como "sem conexão".

### 3. Ensaio no preview (recomendado, não toca na produção)
1. Publique um preview: push para um branch no GitHub, ou `vercel` (sem `--prod`) na pasta do projeto.
2. Abra o link do preview e digite a senha. Ele começa **vazio**, porque usa as chaves `preview:`.
3. **♻️ Restaurar** › escolha o arquivo do passo 1. Os dados de agosto aparecem.
4. **1. Baixar backup** › **2. Ativar salvamento seguro**. Faça lançamentos, exclua um e teste em dois celulares.
5. **♻️ Restaurar** de novo com o arquivo do passo 1. Tudo volta ao que era.

### 4. Produção
1. Publique: merge na `main`, ou `vercel --prod`.
2. **Recarregue a página em todos os aparelhos.** Uma aba antiga aberta tenta gravar na rota que não existe mais, mostra "não foram salvos" e não grava nada.
3. Gestor de Caixa › aviso amarelo › **1. Baixar backup** › **2. Ativar salvamento seguro**.

Entre o deploy e o passo 3, a tela não deixa lançar. Faça os dois em seguida.

---

## Como testar

### Automático
```bash
npm install
npm test
```
São 15 testes das regras do servidor (`tests/dados.test.js`):
- migração com id repetido;
- dois aparelhos lançando ao mesmo tempo;
- exclusão que só marca;
- importação que só junta;
- restauração antes e depois da migração e com o arquivo antigo;
- separação entre preview e produção;
- validação dos lançamentos;
- senha.

### No navegador
Rodei um teste completo contra um banco simulado, com os dados de `dados-iniciais.json`. Todos os 23 passos passaram:
- senha certa e errada;
- bloqueio antes da migração;
- download do backup e migração (10 lançamentos copiados, lista antiga intacta);
- texto com HTML;
- lançamento vindo de outro aparelho;
- exclusão com confirmação;
- restauração voltando ao estado original;
- modo sem conexão sem gravar nada.

### Manual depois do deploy
- Abrir o site numa janela anônima. Deve pedir a senha.
- Lançar em dois celulares quase ao mesmo tempo e recarregar. Os dois lançamentos devem aparecer.
- Ativar o modo avião e recarregar. Deve aparecer o aviso vermelho e não deve ser possível lançar.

---

## Copiar os dados reais para o projeto de testes (v2) e conferir

Site de testes: **https://madeireirav2.vercel.app** (banco Upstash próprio, separado da produção).

1. **No site original** (`madereira-caixa.vercel.app`): Gestor de Caixa › **💾 Exportar**. Isso só baixa o arquivo.
2. **No v2:** Gestor de Caixa. Confira a linha cinza abaixo do título, `Banco: …`. Ela precisa mostrar o host do banco de **teste**, e não o da produção.
3. Escolha **um** dos caminhos:
   - **♻️ Restaurar** › arquivo › digite `RESTAURAR`. Depois, no aviso amarelo: **1. Baixar backup** › **2. Ativar salvamento seguro**.
   - **📂 Importar** › arquivo. Num banco que ainda não foi migrado, ele também ativa o salvamento seguro e traz o acumulado de agosto.
4. **🔍 Conferir com arquivo** › o mesmo arquivo. A tela compara arquivo × banco:
   - a quantidade de lançamentos;
   - vendas, custos, despesas e funcionários de cada mês;
   - o acumulado de agosto/2026.

   Deve aparecer **"Tudo confere"**. As linhas em vermelho mostram o que não bate.

Se algo falhar, o aviso vermelho agora mostra o **motivo** (senha, banco, configuração).

### Trava contra o banco de produção (só no v2)
1. Descubra o host do banco de produção: projeto **madereira** › Storage › `upstash-kv-canary-chair`. O host aparece na REST URL, algo como `xxxx.upstash.io`. Você também encontra o valor da `KV_REST_API_URL` em Settings › Environment Variables desse projeto.
2. No projeto **madeireira.v2** › Settings › Environment Variables: `BANCO_PRODUCAO_HOST` = esse host (Production e Preview) › **Redeploy**.
3. A linha `Banco: …` passa a mostrar "trava de produção: ativa".
4. Se o v2 for ligado por engano ao banco de produção, toda gravação é recusada e aparece "⛔ GRAVAÇÃO BLOQUEADA".
5. **Nunca** crie essa variável no projeto de produção.

Outras proteções:
- Se o projeto tiver `KV_REST_API_URL` e `UPSTASH_REDIS_REST_URL` apontando para bancos diferentes, a API recusa tudo em vez de escolher um.
