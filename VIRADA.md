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

### Abertura de saldos com cheques e fiado da pasta (Ajustes › Saldos)
- **Cheques em carteira, um por um:** a lista mostra os que **vieram do sistema antigo** (recebidos antes da data, compensam depois) e os **lançados na abertura** (os que estão na gaveta e não estavam no sistema: nº, emissor, banco, valor, data de compensação, cliente opcional). O saldo "Cheques em carteira" da abertura passa a ser **a soma da lista** (não se digita mais). Cada cheque lançado aparece em Caixa › Cheques e compensa ou volta como qualquer outro; se voltar, vira dívida do cliente (ou do emissor) em A receber.
- **Fiado anterior (pasta):** cliente (cadastra na hora; WhatsApp opcional), valor devido, **Conta corrente** (vem marcado: sem vencimento, e o cliente fica marcado como conta corrente no cadastro; desmarcando, pede o vencimento) e observação. Vai para Caixa › A receber e é abatido nos recebimentos, **sem contar como venda** (nem receita, nem CMV, nem caixa). Dá para lançar mais depois da virada, se lembrar de alguém.
- O que já foi digitado nos saldos não se perde ao lançar cheque ou fiado.

### Fiado em conta corrente (a pasta de vias)
Não existe caderno: existe uma **pasta com as vias dos pedidos**, que funciona como conta corrente de clientes antigos e de confiança, sem vencimento combinado.
- **Cadastro** (Caixa › A receber › Clientes): marcação **"Conta corrente (sem vencimento)"** e alertas opcionais **limite em R$** e/ou **dias sem pagar** (em branco = sem alerta). Clientes sem a marcação continuam como antes (vencimento padrão de 30 dias).
- **Vendas fiado** desses clientes não têm vencimento e **nunca ficam atrasadas**: a tela mostra **"em aberto há X dias"**, o valor acumulado, o último pagamento e os alertas. Os recebimentos abatem as compras mais antigas primeiro.
- **Caixa › A receber** e **Relatórios › A receber**: separados em **"Conta corrente"** e **"Fiado com vencimento"**. O cartão "Atrasado" só conta o fiado com vencimento.
- **2 vias para a pasta:** ao registrar uma venda fiado de conta corrente (Vender ou Caixa › Lançar), o sistema pergunta se quer imprimir. Sai uma folha A4 com a **via da loja (pasta)** e a **via do cliente**: data, cliente, itens, frete, total e assinatura, **sem custo nem margem**. Dá para reimprimir pelo botão **🖨 Via** no detalhe do cliente.
- **Recebido de fiado anterior à virada:** o recebimento entra no caixa normalmente, mas não é venda. O **DRE** (quadro de informações) e o **Fluxo de caixa** mostram uma linha separada só como informação, para não parecer que a venda caiu.
- Marcar ou desmarcar conta corrente vale também para o que já foi lançado (o sistema recalcula; nada fica gravado na venda além da marca).

### Testes
- `npm test`: 128 passando (zerar com e sem permissão, o que apaga e o que mantém, validação do fiado anterior e do cheque da abertura, carteira sem contar duas vezes, cheque da abertura compensando e voltando, conta corrente sem atraso, alertas, recebido de fiado anterior).
- `bash tests/e2e/rodar.sh`: 12 baterias passando. A **`virada`** (26 verificações) faz o dia inteiro: dados de teste → zerar → importar um export no formato do antigo → "Tudo confere" → migrar → "Tudo confere" → abertura com cheques e fiado da pasta → saldos e A receber certos. A nova **`contacorrente`** (31) cobre cadastro com alertas, fiado anterior marcando o cliente, venda sem vencimento nas duas telas, 2 vias, A receber separado, linha informativa no DRE e no fluxo e desmarcar a conta corrente. A **`trava`** confirma que o banco de produção não pode ser zerado nem com a variável ligada.

### Ajustes depois do ensaio
- **DRE:** custos a classificar no resultado (linha amarela), CMV estimado sem contar em dobro, DAS estimado até a guia ser lançada, FGTS e provisão só sobre CLT, "Resultado provisório", margem acima de 70%, mês em andamento comparado com o mesmo período.
- **Sugestões em lote:** despesas antigas com DAS/Simples/imposto/guia → Impostos (DAS); com FGTS → FGTS, já no mês a que a guia se refere. Depois da virada: Caixa › Lançamentos › filtro "Com sugestão" › selecionar › Aceitar sugestões.
- **Via:** número V-0001, V-0002…; sem cabeçalho e rodapé do navegador; as 2 vias numa folha.
- **Fiado anterior:** campo "Desde" (data da via mais antiga do cliente), aviso de cliente repetido e total no fim da lista para conferir com a soma da pasta.
- **A receber › Ver:** editar conta corrente e alertas ali mesmo.
- **Relatórios:** quadro "Quanto preciso vender por mês para empatar".

## Ensaio no preview (pelo menos 3 dias antes)
O preview do v2 usa o mesmo banco `liked-drum`, mas com as chaves separadas (prefixo `preview:`). O ensaio não mexe em nada da produção do v2 nem no antigo.

1. **Vercel › projeto madeireira.v2 › Settings › Environment Variables:** adicionar `PERMITIR_ZERAR` = `sim` marcando **só "Preview"** (não marque Production ainda). Confira se `BANCO_PRODUCAO_HOST` também vale para Preview (deve apontar para o banco antigo).
2. **Abrir o preview:** usar a branch `ensaio` (já criada no GitHub com o mesmo código) › em Deployments, abrir o deploy dela e clicar **Redeploy** (para pegar a variável). Abrir a URL do preview.
3. **Ajustes › Dados:** a linha do banco deve mostrar `prefixo: preview:`, `trava de produção: ativa` e `⚠️ ZERAR LIGADO`. **Se não mostrar `preview:`, pare** e me chame.
4. **No sistema antigo:** 💾 Exportar (só leitura, não muda nada). Guarde o arquivo.
5. **No preview, siga os passos 3 a 9 do checklist:** backup, Zerar, Importar, Conferir ("Tudo confere"), Migrar, Conferir de novo, abertura com os cheques um por um e o fiado da pasta, com Conta corrente marcado (pode ser com valores de exemplo). Depois: uma venda fiado para um desses clientes (deve perguntar das 2 vias) e um recebimento (deve aparecer a linha "Recebido de fiado anterior à virada" no DRE e no Fluxo de caixa).
6. **Anote:** quantos lançamentos o arquivo tinha, quantos foram adicionados, quanto tempo levou e qualquer coisa estranha. Me mande.
7. **No fim:** apagar `PERMITIR_ZERAR` do Preview (ou deixar até o dia, se for repetir o ensaio).

## No dia
Seguir o checklist (13 passos). Pontos de atenção:
- **Véspera:** somar as vias em aberto da pasta **por cliente** e trazer a lista pronta (cliente, total, se é conta corrente). No dia, um lançamento de fiado anterior por cliente.
- `PERMITIR_ZERAR=sim` em **Production** na véspera (e Redeploy). **Apagar logo depois da abertura** (passo 10) e fazer o Redeploy: o botão some, e o banco do v2 passa a ser o oficial.
- **Não remover `BANCO_PRODUCAO_HOST` do v2:** ela impede o v2 de gravar no banco antigo e é exigida pelo Zerar.
- **Travar o antigo:** no projeto antigo da Vercel, trocar o `KV_REST_API_TOKEN` pelo valor do `KV_REST_API_READ_ONLY_TOKEN` (Upstash) e fazer o Redeploy. Teste com R$ 0,01: tem que dar erro. Se a Vercel não deixar editar (variável presa à integração), plano B: avisar o pai e tirar o atalho antigo dos aparelhos.
- **Endereço mais simples:** projeto madeireira.v2 › Settings › Domains › Add › `nome.vercel.app` (se estiver livre, vira produção na hora; o `madeireirav2.vercel.app` continua). No endereço novo a senha é pedida uma vez e o modo balcão é ligado de novo.

## Como voltar atrás
- **Primeira semana:** ver o quadro "Se der problema" no checklist (corrigir no v2 primeiro; voltar ao antigo só se impedir de vender: exportar o v2, devolver o token normal no antigo, relançar à mão o que foi feito desde a virada).
- **Ajustes pós-ensaio (via, fiado anterior, alerta, sugestões, mês em andamento, empate):** `git revert 82339d4`. O DRE corrigido é o `9f328d4`.
- **Conta corrente:** `git revert 48be372`. Volta o fiado com vencimento para todos (as vendas de conta corrente passam a vencer em data + 30 dias); as marcas no cadastro ficam guardadas, só não são usadas.
- **Zerar e abertura com cheques/fiado:** `git revert 5cbc305`. O Zerar some; cheques e fiado já lançados na abertura continuam no banco (a versão anterior só não sabe mostrá-los).
