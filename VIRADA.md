# Virada: do sistema antigo para o v2

O v2 (`madeireirav2.vercel.app`, banco `liked-drum`) vira o sistema oficial. O antigo (`madereira-caixa.vercel.app`, banco `canary-chair`) fica 2 semanas só para consulta, travado, e depois é aposentado. Checklist de 1 página para o dia: artifact "Checklist da Virada".

## O que foi construído para a virada

### Zerar banco (Ajustes › Dados)
- **Apaga:** lançamentos, lista antiga, acumulado, abertura de saldos, marcas de migração, clientes e orçamentos (com os contadores).
- **Mantém:** preços de venda, ajustes da calculadora e configuração financeira (formas, tPag, taxas, fiado). As cópias automáticas também ficam.
- **Proteções:**
  - só aparece com a variável `PERMITIR_ZERAR=sim` **e** a trava de produção configurada (`BANCO_PRODUCAO_HOST`) **e** este banco não sendo o de produção (no banco de produção, mesmo com a variável, não aparece e a rota responde 423);
  - antes, é obrigatório **baixar o backup** pelo próprio botão; depois, digitar **ZERAR** (maiúsculo);
  - o servidor guarda uma cópia `antes-de-zerar` no próprio banco antes de apagar;
  - só apaga as chaves do próprio ambiente: zerar no **preview** (prefixo `preview:`) não toca nos dados da produção do v2.
- Enquanto está ligado, a linha do banco mostra **"⚠️ ZERAR LIGADO (desligar depois da virada)"**.

### Abertura de saldos com cheques e fiado do caderno (Ajustes › Saldos)
- **Cheques em carteira, um por um:** a lista mostra os que **vieram do sistema antigo** (recebidos antes da data, compensam depois) e os **lançados na abertura** (os que estão na gaveta e não estavam no sistema: nº, emissor, banco, valor, data de compensação, cliente opcional). O saldo "Cheques em carteira" da abertura passa a ser **a soma da lista** (não se digita mais). Cada cheque lançado aparece em Caixa › Cheques e compensa ou volta como qualquer outro; se voltar, vira dívida do cliente (ou do emissor) em A receber.
- **Fiado anterior (caderno):** cliente (cadastra na hora; WhatsApp opcional), valor devido, vencimento (sugestão: data da abertura + prazo do fiado) e observação. Vai para Caixa › A receber e é abatido nos recebimentos, **sem contar como venda** (nem receita, nem CMV, nem caixa). Dá para lançar mais depois da virada, se lembrar de alguém.
- O que já foi digitado nos saldos não se perde ao lançar cheque ou fiado.

### Testes
- `npm test`: 126 passando (zerar com e sem permissão, o que apaga e o que mantém, validação do fiado anterior e do cheque da abertura, carteira sem contar duas vezes, cheque da abertura compensando e voltando).
- `bash tests/e2e/rodar.sh`: 10 baterias passando. A nova **`virada`** (25 verificações) faz o dia inteiro: dados de teste → zerar → importar um export no formato do antigo → "Tudo confere" → migrar → "Tudo confere" → abertura com cheques e fiado do caderno → saldos e A receber certos. A **`trava`** confirma que o banco de produção não pode ser zerado nem com a variável ligada.

## Ensaio no preview (pelo menos 3 dias antes)
O preview do v2 usa o mesmo banco `liked-drum`, mas com as chaves separadas (prefixo `preview:`). O ensaio não mexe em nada da produção do v2 nem no antigo.

1. **Vercel › projeto madeireira.v2 › Settings › Environment Variables:** adicionar `PERMITIR_ZERAR` = `sim` marcando **só "Preview"** (não marque Production ainda). Confira se `BANCO_PRODUCAO_HOST` também vale para Preview (deve apontar para o banco antigo).
2. **Abrir o preview:** usar a branch `ensaio` (já criada no GitHub com o mesmo código) › em Deployments, abrir o deploy dela e clicar **Redeploy** (para pegar a variável). Abrir a URL do preview.
3. **Ajustes › Dados:** a linha do banco deve mostrar `prefixo: preview:`, `trava de produção: ativa` e `⚠️ ZERAR LIGADO`. **Se não mostrar `preview:`, pare** e me chame.
4. **No sistema antigo:** 💾 Exportar (só leitura, não muda nada). Guarde o arquivo.
5. **No preview, siga os passos 3 a 9 do checklist:** backup, Zerar, Importar, Conferir ("Tudo confere"), Migrar, Conferir de novo, abertura com os cheques um por um e o fiado do caderno (pode ser com valores de exemplo).
6. **Anote:** quantos lançamentos o arquivo tinha, quantos foram adicionados, quanto tempo levou e qualquer coisa estranha. Me mande.
7. **No fim:** apagar `PERMITIR_ZERAR` do Preview (ou deixar até o dia, se for repetir o ensaio).

## No dia
Seguir o checklist (13 passos). Pontos de atenção:
- `PERMITIR_ZERAR=sim` em **Production** na véspera (e Redeploy). **Apagar logo depois da abertura** (passo 10) e fazer o Redeploy: o botão some, e o banco do v2 passa a ser o oficial.
- **Não remover `BANCO_PRODUCAO_HOST` do v2:** ela impede o v2 de gravar no banco antigo e é exigida pelo Zerar.
- **Travar o antigo:** no projeto antigo da Vercel, trocar o `KV_REST_API_TOKEN` pelo valor do `KV_REST_API_READ_ONLY_TOKEN` (Upstash) e fazer o Redeploy. Teste com R$ 0,01: tem que dar erro. Se a Vercel não deixar editar (variável presa à integração), plano B: avisar o pai e tirar o atalho antigo dos aparelhos.
- **Endereço mais simples:** projeto madeireira.v2 › Settings › Domains › Add › `nome.vercel.app` (se estiver livre, vira produção na hora; o `madeireirav2.vercel.app` continua). No endereço novo a senha é pedida uma vez e o modo balcão é ligado de novo.

## Como voltar atrás
- **Primeira semana:** ver o quadro "Se der problema" no checklist (corrigir no v2 primeiro; voltar ao antigo só se impedir de vender: exportar o v2, devolver o token normal no antigo, relançar à mão o que foi feito desde a virada).
- **Código desta etapa:** `git revert` do commit "Virada: Zerar banco…". O Zerar some; cheques e fiado já lançados na abertura continuam no banco (a versão anterior só não sabe mostrá-los).
