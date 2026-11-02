# Virada ZERADA: do sistema antigo para o v2

O v2 (`madeireirav2.vercel.app`, banco `liked-drum`) vira o sistema oficial **começando do zero**: nada do histórico do sistema antigo é importado. O antigo (`madereira-caixa.vercel.app`, banco `canary-chair`) fica só para consulta por 30 dias e depois é aposentado.

## O que o Zerar faz (Ajustes › Dados)
- **Apaga:** lançamentos (vendas, despesas, fiado anterior), lista antiga e acumulado ("Saldos passados"), clientes, orçamentos, abertura de saldos, conferências da gaveta e os contadores. A próxima venda é **V-0001** e o próximo orçamento **ORC-0001**.
- **Mantém:** catálogo e custos (`data/custos.json`, com o beiral novo), preços de venda, ajustes da calculadora, configuração financeira (formas, taxas, fiado) e **Ajustes › Impressão** (cabeçalho, avisos, Pix, logo).
- **Depois de zerar:** o sistema fica pronto para lançar (sem "salvamento seguro" nem migração). As cópias automáticas antigas saem do banco; fica só a **`antes-de-zerar`**.
- **Proteções:**
  - só aparece com `PERMITIR_ZERAR=sim` **e** a trava de produção (`BANCO_PRODUCAO_HOST`) **e** o banco não sendo o do sistema antigo (lá, nem com a variável: a rota recusa);
  - é obrigatório **baixar o backup** pelo próprio botão e depois digitar **ZERAR** (maiúsculo);
  - só apaga as chaves do próprio ambiente: zerar no **preview** (prefixo `preview:`) não toca na produção do v2.
- Enquanto está ligado, a linha do banco (Ajustes › Dados) mostra **"⚠️ ZERAR LIGADO"**. Ela também mostra sempre a **próxima venda** e o **próximo orçamento**, para conferir sem gastar número com teste.

## Passo a passo do dia (Production do v2)

### 1. Antes de ligar
1. Confirme que a última versão da `main` já está publicada na Production do v2 (Vercel › projeto do v2 › Deployments: o mais recente de Production está **Ready**).
2. Abra `madeireirav2.vercel.app` e confira em **Vender** o **Beiral cedro** (13, 19, 23, 29 cm) e o **Beiral pinus** (14, 19 cm), e em **Ajustes › Preços** os preços deles.

### 2. Ligar o PERMITIR_ZERAR só na Production
3. Vercel › **projeto do v2** (o que publica `madeireirav2.vercel.app`, **não** o `madereira`) › **Settings › Environment Variables**.
4. **Add New:** Key `PERMITIR_ZERAR`, Value `sim`. Em *Environments*, deixe marcado **só Production** (desmarque Preview e Development). **Save**.
5. **Deployments** › o deploy mais recente de **Production** › menu **⋯** › **Redeploy** › confirmar. Espere ficar **Ready** (a variável só vale depois do redeploy).

### 3. Zerar
6. Abra **`madeireirav2.vercel.app`** (não o preview, não o `madereira-caixa`) › **Ajustes › Dados**. A linha do banco deve mostrar `ambiente: production`, **sem** `prefixo: preview:`, `trava de produção: ativa` e `⚠️ ZERAR LIGADO`.
   - **Pare e me chame** se aparecer `⛔ GRAVAÇÃO BLOQUEADA` (seria o banco do sistema antigo) ou se o bloco Zerar não aparecer (confira se `BANCO_PRODUCAO_HOST` existe na Production do v2).
7. No bloco **⚠️ Zerar banco**: **💾 Baixar o backup agora** (guarde o arquivo) › digite `ZERAR` › **Zerar banco**. Deve aparecer "Banco zerado." com o que foi apagado e o que foi mantido.

### 4. Desligar de novo
8. Vercel › projeto do v2 › **Settings › Environment Variables** › `PERMITIR_ZERAR` › **⋯ › Remove**.
9. **Deployments** › o deploy mais recente de Production › **⋯ › Redeploy**. Espere ficar **Ready**.
10. **Não remova `BANCO_PRODUCAO_HOST`** do v2: ela impede o v2 de gravar no banco antigo.

### 5. Conferir
11. Em `madeireirav2.vercel.app` › **Ajustes › Dados**: a linha do banco **sem** "ZERAR LIGADO", **sem** o bloco Zerar, e com **"próxima venda: V-0001 · próximo orçamento: ORC-0001"**.
12. **Vender:** o catálogo completo, com o Beiral cedro e o Beiral pinus. **Ajustes › Preços:** os preços continuam. **Ajustes › Impressão:** cabeçalho, avisos e Pix continuam (botão "Ver exemplo").
13. **Caixa › Lançamentos** vazio; **Relatórios › DRE** do mês anterior aparece vazio, sem erro.

### 6. Abertura do dia (Ajustes › Saldos)
14. Gaveta (contada), Bradesco e PicPay (extrato do dia), cheques em carteira **um por um** e o **fiado da pasta** (um lançamento por cliente, com Conta corrente marcado para os clientes de confiança). Salvar.
15. A primeira venda real sai como **V-0001** e o primeiro orçamento como **ORC-0001**.

### 7. Sistema antigo
16. Fica só para consulta por 30 dias. Para travar a gravação nele: no projeto antigo da Vercel, trocar o token de escrita do banco pelo de leitura (Upstash) e fazer o Redeploy; teste com R$ 0,01 (tem que dar erro). Se a Vercel não deixar editar, avise o pai e tire o atalho antigo dos aparelhos.

## Ensaio no preview (antes do dia)
O preview do v2 usa o mesmo banco `liked-drum` com as chaves separadas (prefixo `preview:`), então o ensaio não mexe na produção.
1. Vercel › projeto do v2 › Settings › Environment Variables: `PERMITIR_ZERAR` = `sim` marcando **só Preview**. Redeploy do deploy da branch `ensaio`.
2. Na URL do preview, Ajustes › Dados deve mostrar `prefixo: preview:` e `⚠️ ZERAR LIGADO`. **Se não mostrar `preview:`, pare.**
3. Faça os passos 7 e 11 a 15 com valores de exemplo.
4. **Apagar os dados do ensaio:** zere o preview de novo (mesmo botão) e depois remova `PERMITIR_ZERAR` do Preview e faça o Redeploy.

## Testes
- `npm test` (178) e `bash tests/e2e/rodar.sh` (17 baterias). A bateria **`virada`** faz o dia inteiro: dados de teste → backup → Zerar → pronto para lançar, sem migrar → só a cópia `antes-de-zerar` → preços, beiral e Impressão mantidos → abertura com cheque e fiado da pasta → V-0001 e ORC-0001 → DRE do mês anterior vazio. A **`criticos`** confirma que, sem `PERMITIR_ZERAR`, o bloco some e o servidor recusa; a **`trava`** confirma que o banco do sistema antigo não pode ser zerado.

## Como voltar atrás
- **Antes de zerar:** basta não ligar a variável.
- **Depois de zerar:** Ajustes › Dados › Restaurar com o backup baixado no passo 7 (ou a cópia `antes-de-zerar` guardada no banco) volta tudo como estava.
- **Código do Zerar novo:** `git revert` do commit "Virada zerada" (ver `git log`). O Zerar volta a apagar e pedir importação/migração.
