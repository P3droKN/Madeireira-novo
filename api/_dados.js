// Regras de leitura e gravação no KV. Recebe o cliente `kv` e as `chaves` como parâmetro
// para poder ser testado sem banco (ver tests/dados.test.js).

import { contaPorId, naturezaDaConta, PAGO_COM, mesclarConfigFinanceiro, CONFIG_FINANCEIRO_PADRAO } from "../lib/planoContas.js";
import { converterLancamento, lancamentosDeAbertura, categoriaLegada, sugestaoDe } from "../lib/migracaoV2.js";
import { numeroOrcamento, normalizarTelefone, somarDias, ORIGENS, MOTIVOS_PERDA } from "../lib/orcamentos.js";

const CATEGORIAS = { venda: "income", custo: "expense", funcionario: "expense", despesa: "expense" };
const METODOS = ["dinheiro", "pix", "bradesco", "debito", "credito", "cheque"];
const CAMPOS_ACUMULADO = ["venda", "pix", "credito", "debito", "custo", "despesa", "func", "dinheiroCaixa"];
const MAX_COPIAS = 30;

function erro(status, message) {
  return Object.assign(new Error(message), { status });
}

// Versões antigas às vezes gravavam o JSON como texto.
function desembrulhar(valor) {
  if (typeof valor !== "string") return valor;
  try { return JSON.parse(valor); } catch { return valor; }
}

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[A-Za-z0-9_-]{1,60}$/;
const texto = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");

// Devolve o lançamento só com os campos conhecidos, ou lança erro 400.
export function validarLancamento(item) {
  if (!item || typeof item !== "object") throw erro(400, "Lançamento inválido.");
  if (typeof item.id !== "string" || !ID.test(item.id)) throw erro(400, "Id inválido.");
  if (!(item.category in CATEGORIAS)) throw erro(400, `Categoria inválida: ${item.category}`);
  if (!METODOS.includes(item.method)) throw erro(400, `Forma de pagamento inválida: ${item.method}`);
  const value = Number(item.value);
  if (!Number.isFinite(value) || value <= 0) throw erro(400, "Valor deve ser maior que zero.");
  if (typeof item.date !== "string" || !DATA.test(item.date)) throw erro(400, "Data inválida.");

  const limpo = {
    id: item.id,
    category: item.category,
    type: CATEGORIAS[item.category],
    value: Math.round(value * 100) / 100,
    date: item.date,
    description: texto(item.description, 500),
    method: item.method,
  };
  if (item.method === "cheque") {
    limpo.checkNumber = texto(item.checkNumber, 40);
    limpo.checkIssuer = texto(item.checkIssuer, 120);
    limpo.checkDate = DATA.test(item.checkDate || "") ? item.checkDate : "";
  }
  // Venda feita pela calculadora: guarda o custo do que foi vendido (CMV) e os itens,
  // em vez de criar um lançamento de custo separado (que contava o custo em dobro).
  if (item.category === "venda" && item.cmv != null) {
    const cmv = Number(item.cmv);
    if (!Number.isFinite(cmv) || cmv < 0) throw erro(400, "CMV inválido.");
    limpo.cmv = Math.round(cmv * 100) / 100;
    limpo.origem = "calculadora";
    if (num(item.tabelaTotal) != null) limpo.tabelaTotal = num(item.tabelaTotal);
    if (num(item.variacao) != null) limpo.variacao = num(item.variacao);
    if (item.motivo) limpo.motivo = texto(item.motivo, 200);
    if (Array.isArray(item.itens)) {
      if (item.itens.length > 100) throw erro(400, "Pedido com itens demais.");
      limpo.itens = item.itens.map(validarItemPedido);
    }
  }
  return limpo;
}

const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 1000) / 1000);

function validarItemPedido(i) {
  if (!i || typeof i !== "object") throw erro(400, "Item do pedido inválido.");
  return {
    itemId: texto(i.itemId, 120),
    descricao: texto(i.descricao, 200),
    acabamento: texto(i.acabamento, 20),
    // como foi pedido (para corrigir a venda e para a via: "6 pç × 2,50 m"), além do cobrado
    quantidade: num(i.quantidade),
    comprimento: num(i.comprimento),
    precoManual: num(i.precoManual),
    totalManual: num(i.totalManual),
    descricaoLivre: texto(i.descricaoLivre, 200),
    quantidadeCobrada: num(i.quantidadeCobrada),
    unidade: texto(i.unidade, 20),
    custoTotal: num(i.custoTotal),
    precoTabela: num(i.precoTabela),
    tabelaTotal: num(i.tabelaTotal),
    precoUnitario: num(i.precoUnitario),
    vendaTotal: num(i.vendaTotal),
    variacaoPct: num(i.variacaoPct),
    motivo: texto(i.motivo, 200),
  };
}

export function validarAcumulado(acc) {
  if (!acc || typeof acc !== "object") throw erro(400, "Acumulado inválido.");
  const limpo = {};
  for (const campo of CAMPOS_ACUMULADO) {
    const v = Number(acc[campo] ?? 0);
    if (!Number.isFinite(v)) throw erro(400, `Valor inválido em ${campo}.`);
    limpo[campo] = v;
  }
  return limpo;
}

async function estaMigrado(kv, k) {
  return Boolean(await kv.get(k.migrado));
}

export async function lerTudo(kv, k) {
  const migrado = await estaMigrado(kv, k);
  const migradoV2 = Boolean(await kv.get(k.migradoV2));
  const configFinanceiro = desembrulhar(await kv.get(k.configFinanceiro)) || {};
  const saldos = desembrulhar(await kv.get(k.saldos)) || { abertura: null, conferencias: [] };
  let financeItems;
  if (migrado) {
    const hash = (await kv.hgetall(k.lancamentos)) || {};
    financeItems = Object.values(hash).map(desembrulhar).filter((i) => i && !i.excluido);
  } else {
    financeItems = desembrulhar(await kv.get(k.finance)) || [];
  }
  const acumulado = desembrulhar(await kv.get(k.acumulado)) || null;
  return { migrado, migradoV2, financeItems, acumulado, configFinanceiro, saldos };
}

// Cópia exata de todas as chaves do sistema, com nomes sem prefixo
// (assim uma cópia da produção pode ser restaurada no preview para ensaio).
export async function montarBackup(kv, k) {
  return {
    app: "madeireira",
    versao: 1,
    ambiente: k.ambiente,
    criadoEm: new Date().toISOString(),
    chaves: {
      madeireira_finance: desembrulhar(await kv.get(k.finance)) ?? null,
      madeireira_acumulado: desembrulhar(await kv.get(k.acumulado)) ?? null,
      madeireira_lancamentos: (await kv.hgetall(k.lancamentos)) ?? null,
      madeireira_migrado_v1: (await kv.get(k.migrado)) ?? null,
      madeireira_precos_venda: (await kv.hgetall(k.precos)) ?? null,
      madeireira_config: desembrulhar(await kv.get(k.config)) ?? null,
      madeireira_config_financeiro: desembrulhar(await kv.get(k.configFinanceiro)) ?? null,
      madeireira_migrado_v2: (await kv.get(k.migradoV2)) ?? null,
      madeireira_orcamentos: (await kv.hgetall(k.orcamentos)) ?? null,
      madeireira_clientes: (await kv.hgetall(k.clientes)) ?? null,
      madeireira_orc_seq: (await kv.get(k.orcSeq)) ?? null,
      madeireira_cli_seq: (await kv.get(k.cliSeq)) ?? null,
      madeireira_venda_seq: (await kv.get(k.vendaSeq)) ?? null,
      madeireira_saldos: desembrulhar(await kv.get(k.saldos)) ?? null,
    },
  };
}

// Guarda uma cópia dentro do próprio KV antes de qualquer operação que substitui dados.
export async function salvarCopia(kv, k, motivo) {
  const backup = await montarBackup(kv, k);
  backup.motivo = motivo;
  const nome = `${k.prefixo}madeireira_backup_${backup.criadoEm.replace(/[:.]/g, "-")}_${motivo}`;
  await kv.set(nome, backup);
  await kv.lpush(k.backups, nome);
  const antigas = await kv.lrange(k.backups, MAX_COPIAS, -1);
  if (antigas && antigas.length) {
    await kv.del(...antigas);
    await kv.ltrim(k.backups, 0, MAX_COPIAS - 1);
  }
  return nome;
}

// Zerar banco (só para a virada): apaga o movimento e mantém os ajustes.
// Só funciona com PERMITIR_ZERAR=sim e com a trava de produção configurada (statusBanco().zerarPermitido).
export const CHAVES_ZERAR = ["finance", "acumulado", "lancamentos", "migrado", "trava", "migradoV2", "orcamentos", "orcSeq", "clientes", "cliSeq", "vendaSeq", "saldos"];
export const CHAVES_MANTIDAS = ["precos", "config", "configFinanceiro", "backups"];

export async function zerarMovimento(kv, k, pedido, permitido) {
  if (!permitido) throw erro(403, "Zerar está desligado. Ele só funciona no dia da virada (PERMITIR_ZERAR=sim na Vercel, com a trava de produção ativa).");
  if (pedido?.confirmacao !== "ZERAR") throw erro(400, 'Digite ZERAR para confirmar.');
  const copia = await salvarCopia(kv, k, "antes-de-zerar");
  await kv.del(...CHAVES_ZERAR.map((c) => k[c]));
  return { copia, apagadas: CHAVES_ZERAR.map((c) => k[c]), mantidas: CHAVES_MANTIDAS.map((c) => k[c]) };
}

export async function listarCopias(kv, k) {
  return (await kv.lrange(k.backups, 0, -1)) || [];
}

export async function lerCopia(kv, k, nome) {
  const nomes = await listarCopias(kv, k);
  if (!nomes.includes(nome)) throw erro(404, "Cópia não encontrada.");
  return kv.get(nome);
}

// Copia a lista antiga para o hash (um campo por lançamento). A lista antiga fica intacta.
export async function migrar(kv, k) {
  if (await estaMigrado(kv, k)) return { jaMigrado: true };
  const travou = await kv.set(k.trava, "1", { nx: true, ex: 60 });
  if (!travou) throw erro(409, "Migração já em andamento. Tente de novo em 1 minuto.");
  try {
    const copia = await salvarCopia(kv, k, "antes-da-migracao");
    const antigos = desembrulhar(await kv.get(k.finance)) || [];
    if (!Array.isArray(antigos)) throw erro(500, "Formato inesperado na lista antiga; nada foi alterado.");

    // Ids repetidos (dois lançamentos no mesmo milissegundo) não podem sumir: ganham sufixo.
    const porId = {};
    for (const item of antigos) {
      let id = String(item.id ?? "");
      if (!id) id = "semid";
      let n = 1;
      while (porId[id]) id = `${String(item.id ?? "semid")}-dup${n++}`;
      porId[id] = { ...item, id };
    }
    const qtd = Object.keys(porId).length;
    if (qtd) await kv.hset(k.lancamentos, porId);
    const gravados = qtd ? await kv.hlen(k.lancamentos) : 0;
    if (gravados < qtd) throw erro(500, `Só ${gravados} de ${qtd} lançamentos foram copiados. Migração não concluída.`);

    await kv.set(k.migrado, { em: new Date().toISOString(), quantidade: qtd, copia });
    return { migrados: qtd, copia };
  } finally {
    await kv.del(k.trava);
  }
}

async function exigirMigracao(kv, k) {
  if (!(await estaMigrado(kv, k))) {
    throw erro(409, "Faça o backup e ative o salvamento seguro antes de lançar.");
  }
}

// Cria ou edita lançamentos, um campo por id: nunca regrava a lista inteira.
export async function salvarLancamentos(kv, k, itens) {
  if (!Array.isArray(itens) || itens.length === 0 || itens.length > 50) {
    throw erro(400, "Envie de 1 a 50 lançamentos.");
  }
  await exigirMigracao(kv, k);
  const cfg = mesclarConfigFinanceiro(desembrulhar(await kv.get(k.configFinanceiro)) || {});
  // Lançamento novo (v2) é validado pelo plano de contas; o antigo continua aceito
  const limpos = itens.map((i) => (i && i.v === 2 ? validarLancamentoV2(i, cfg) : validarLancamento(i)));
  // Venda nova ganha um número curto e sequencial (V-0001…), dado aqui (o contador é atômico: dois
  // aparelhos ao mesmo tempo nunca recebem o mesmo número). Corrigir a venda mantém o número, a hora,
  // a marca de impressão e guarda o histórico ("corrigida em …, antes R$ X").
  const v2 = limpos.filter((i) => i.v === 2);
  const numeros = {};
  const agora = new Date().toISOString();
  if (v2.length) {
    const atuais = (await kv.hmget(k.lancamentos, ...v2.map((i) => String(i.id)))) || {};
    for (const i of v2) {
      const antes = desembrulhar(atuais[i.id]);
      i.criadoEm = antes?.criadoEm || agora;
      if (i.conta !== "venda_produtos") continue;
      i.numero = antes ? antes.numero : numeroVenda(Number(await kv.incr(k.vendaSeq)));
      if (!i.numero) delete i.numero;
      else numeros[i.id] = i.numero;
      if (antes) {
        if (antes.impressoEm) i.impressoEm = antes.impressoEm;
        const mudou = centavosDe(antes.value) !== centavosDe(i.value) || JSON.stringify(antes.itens || null) !== JSON.stringify(i.itens || null)
          || JSON.stringify((antes.pagamentos || []).map((p) => [p.forma, p.valor])) !== JSON.stringify((i.pagamentos || []).map((p) => [p.forma, p.valor]));
        i.historico = [...(antes.historico || []), ...(mudou ? [{ em: agora, valorAntes: antes.value }] : [])].slice(-20);
        if (!i.historico.length) delete i.historico;
      }
    }
  }
  await kv.hset(k.lancamentos, Object.fromEntries(limpos.map((i) => [i.id, i])));
  return { salvos: limpos.length, numeros };
}

export const numeroVenda = (n) => `V-${String(n).padStart(4, "0")}`;

// Primeira impressão das vias: a partir daí, a via reimpressa sai marcada "2ª impressão em DD/MM"
export async function marcarImpresso(kv, k, id) {
  const atual = desembrulhar(await kv.hget(k.lancamentos, String(id)));
  if (!atual) throw erro(404, "Venda não encontrada.");
  if (atual.impressoEm) return { impressoEm: atual.impressoEm, primeira: false };
  const impressoEm = new Date().toISOString();
  await kv.hset(k.lancamentos, { [atual.id]: { ...atual, impressoEm } });
  return { impressoEm, primeira: true };
}

// Exclusão "suave": o lançamento fica guardado com a marca de excluído.
export async function excluirLancamento(kv, k, id) {
  await exigirMigracao(kv, k);
  const atual = desembrulhar(await kv.hget(k.lancamentos, String(id)));
  if (!atual) throw erro(404, "Lançamento não encontrado.");
  await kv.hset(k.lancamentos, { [atual.id]: { ...atual, excluido: true, excluidoEm: new Date().toISOString() } });
  return { excluido: atual.id };
}

// Junta os lançamentos de um arquivo: só adiciona ids que ainda não existem. Não apaga nem altera nada.
export const MAX_LOTE_IMPORTACAO = 500;

function listaDoArquivo(arquivo) {
  if (Array.isArray(arquivo)) return arquivo;
  if (Array.isArray(arquivo?.financeItems)) return arquivo.financeItems;
  if (arquivo?.chaves) {
    const hash = arquivo.chaves.madeireira_lancamentos;
    if (hash) return Object.values(hash).map(desembrulhar);
    return desembrulhar(arquivo.chaves.madeireira_finance) || [];
  }
  return null;
}

function acumuladoDoArquivo(arquivo) {
  if (arquivo?.chaves) return desembrulhar(arquivo.chaves.madeireira_acumulado) || null;
  return arquivo && !Array.isArray(arquivo) ? arquivo.acumulado || null : null;
}

const acumuladoVazio = (a) => !a || Object.values(a).every((v) => !Number(v));

export async function importar(kv, k, arquivo) {
  const lista = listaDoArquivo(arquivo);
  if (!Array.isArray(lista)) throw erro(400, "Arquivo sem lançamentos reconhecíveis.");

  // Banco ainda no formato antigo: ativa o salvamento seguro antes (a migração guarda cópia)
  let migrou = false;
  if (!(await estaMigrado(kv, k))) {
    await migrar(kv, k);
    migrou = true;
  }
  // Acumulado do arquivo só entra se o banco ainda não tiver um (nunca substitui)
  let acumuladoImportado = false;
  const accArquivo = acumuladoDoArquivo(arquivo);
  if (accArquivo && !acumuladoVazio(accArquivo) && acumuladoVazio(desembrulhar(await kv.get(k.acumulado)))) {
    await kv.set(k.acumulado, validarAcumulado(accArquivo));
    acumuladoImportado = true;
  }

  if (lista.length > MAX_LOTE_IMPORTACAO) {
    throw erro(400, `Lote grande demais (${lista.length}). Envie no máximo ${MAX_LOTE_IMPORTACAO} lançamentos por vez.`);
  }
  // Valida e tira ids repetidos dentro do próprio lote (fica o primeiro)
  let invalidos = 0;
  const porId = new Map();
  for (const item of lista) {
    try {
      // Excluídos entram como estão (histórico); os demais passam pela validação.
      const limpo = item?.excluido && ID.test(String(item.id)) ? { ...item } : validarLancamento(item);
      if (!porId.has(limpo.id)) porId.set(limpo.id, limpo);
    } catch {
      invalidos++;
    }
  }
  // Uma leitura e uma gravação por lote (antes era uma ida ao banco por lançamento,
  // o que estourava o tempo da função com centenas de lançamentos).
  const ids = [...porId.keys()];
  const atuais = ids.length ? (await kv.hmget(k.lancamentos, ...ids)) || {} : {};
  const novos = ids.filter((id) => atuais[id] == null);
  if (novos.length) await kv.hset(k.lancamentos, Object.fromEntries(novos.map((id) => [id, porId.get(id)])));
  const adicionados = novos.length;
  const existentes = ids.length - novos.length + (lista.length - invalidos - ids.length);
  return { adicionados, existentes, invalidos, migrou, acumuladoImportado };
}

// Volta o sistema exatamente ao estado do arquivo. Antes, guarda uma cópia do estado atual.
// Aceita o arquivo novo (/api/backup) e o antigo (botão "Exportar": { financeItems, acumulado }).
export async function restaurar(kv, k, arquivo) {
  let alvo;
  if (arquivo?.app === "madeireira" && arquivo.chaves) {
    alvo = { ...arquivo.chaves };
  } else if (Array.isArray(arquivo?.financeItems) || Array.isArray(arquivo)) {
    // Arquivo do sistema antigo: representa o estado antes da migração.
    alvo = {
      madeireira_finance: Array.isArray(arquivo) ? arquivo : arquivo.financeItems,
      madeireira_acumulado: Array.isArray(arquivo) ? undefined : arquivo.acumulado,
      madeireira_lancamentos: null,
      madeireira_migrado_v1: null,
    };
  } else {
    throw erro(400, "Arquivo de backup não reconhecido.");
  }
  const f = desembrulhar(alvo.madeireira_finance);
  if (f != null && !Array.isArray(f)) throw erro(400, "madeireira_finance deveria ser uma lista.");
  const l = alvo.madeireira_lancamentos;
  if (l != null && (typeof l !== "object" || Array.isArray(l))) throw erro(400, "madeireira_lancamentos inválido.");

  const copia = await salvarCopia(kv, k, "antes-de-restaurar");

  const gravar = async (chave, valor) => (valor == null ? kv.del(chave) : kv.set(chave, valor));
  await gravar(k.finance, f);
  if (alvo.madeireira_acumulado !== undefined) await gravar(k.acumulado, alvo.madeireira_acumulado);
  await kv.del(k.lancamentos);
  if (l && Object.keys(l).length) await kv.hset(k.lancamentos, l);
  await gravar(k.migrado, alvo.madeireira_migrado_v1);
  // Preços e config só existem em backups a partir da Fase 1; backups antigos não mexem neles.
  if ("madeireira_precos_venda" in alvo) {
    const precos = alvo.madeireira_precos_venda;
    await kv.del(k.precos);
    if (precos && Object.keys(precos).length) await kv.hset(k.precos, precos);
  }
  if ("madeireira_config" in alvo) await gravar(k.config, alvo.madeireira_config);
  if ("madeireira_config_financeiro" in alvo) await gravar(k.configFinanceiro, alvo.madeireira_config_financeiro);
  if ("madeireira_migrado_v2" in alvo) await gravar(k.migradoV2, alvo.madeireira_migrado_v2);
  for (const [nome, chave] of [["madeireira_orcamentos", k.orcamentos], ["madeireira_clientes", k.clientes]]) {
    if (!(nome in alvo)) continue;
    await kv.del(chave);
    if (alvo[nome] && Object.keys(alvo[nome]).length) await kv.hset(chave, alvo[nome]);
  }
  if ("madeireira_orc_seq" in alvo) await gravar(k.orcSeq, alvo.madeireira_orc_seq);
  if ("madeireira_cli_seq" in alvo) await gravar(k.cliSeq, alvo.madeireira_cli_seq);
  if ("madeireira_venda_seq" in alvo) await gravar(k.vendaSeq, alvo.madeireira_venda_seq);
  if ("madeireira_saldos" in alvo) await gravar(k.saldos, alvo.madeireira_saldos);

  return {
    copia,
    lancamentos: l ? Object.keys(l).length : 0,
    listaAntiga: Array.isArray(f) ? f.length : 0,
    migrado: Boolean(alvo.madeireira_migrado_v1),
  };
}

export async function salvarAcumulado(kv, k, acumulado) {
  const limpo = validarAcumulado(acumulado);
  await salvarCopia(kv, k, "antes-de-alterar-acumulado");
  await kv.set(k.acumulado, limpo);
  return limpo;
}

// --- Preços de venda e configuração (Fase 1) ---

export async function lerPrecosEConfig(kv, k) {
  const precos = (await kv.hgetall(k.precos)) || {};
  const config = desembrulhar(await kv.get(k.config)) || {};
  return { precos, config };
}

// alteracoes: { "<item>|<acabamento>": número > 0 | null (apaga) }
export async function salvarPrecos(kv, k, alteracoes, chaveValida) {
  if (!alteracoes || typeof alteracoes !== "object" || Array.isArray(alteracoes)) throw erro(400, "Envie as alterações de preço.");
  const entradas = Object.entries(alteracoes);
  if (entradas.length === 0 || entradas.length > 1000) throw erro(400, "Envie de 1 a 1000 preços.");
  const gravar = {}, apagar = [];
  for (const [chave, valor] of entradas) {
    if (!chaveValida(chave)) throw erro(400, `Item não existe no catálogo: ${chave}`);
    if (valor == null || valor === "") { apagar.push(chave); continue; }
    const v = Number(valor);
    if (!Number.isFinite(v) || v <= 0 || v > 1e6) throw erro(400, `Preço inválido em ${chave}.`);
    gravar[chave] = Math.round(v * 100) / 100;
  }
  if (Object.keys(gravar).length) await kv.hset(k.precos, gravar);
  if (apagar.length) await kv.hdel(k.precos, ...apagar);
  return { salvos: Object.keys(gravar).length, removidos: apagar.length };
}

const PCT = (v, nome) => {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n) || n < 0 || n > 100) throw erro(400, `Percentual inválido: ${nome}.`);
  return n;
};

export async function salvarConfig(kv, k, config, materiaisComCepilhado) {
  if (!config || typeof config !== "object") throw erro(400, "Config inválida.");
  const limpa = {
    modificadores: {
      selecionadaPct: PCT(config.modificadores?.selecionadaPct, "madeira selecionada"),
      ultimasPecasPct: PCT(config.modificadores?.ultimasPecasPct, "últimas peças"),
    },
    temCepilhado: {},
  };
  for (const id of materiaisComCepilhado) {
    if (config.temCepilhado && id in config.temCepilhado) limpa.temCepilhado[id] = Boolean(config.temCepilhado[id]);
  }
  await kv.set(k.config, limpa);
  return limpa;
}


// --- Financeiro v2 (Fase 2A) ---

const PAGO_COM_IDS = PAGO_COM.map((p) => p.id);
const dataOk = (d) => typeof d === "string" && DATA.test(d);
const centavosDe = (v) => Math.round(Number(v) * 100);

// Campos antigos derivados, para a tela antiga do caixa continuar certa até a Fase 2D
const METODO_LEGADO = {
  dinheiro: "dinheiro", pix_bradesco: "pix", pix_picpay: "pix", transferencia: "bradesco",
  debito: "debito", credito: "credito", credito_parcelado: "credito", cheque: "cheque", nao_informada: "", fiado: "",
  gaveta: "dinheiro", bradesco: "bradesco", picpay: "bradesco", cheque_emitido: "cheque",
};

function validarPagamento(p, cfg, permitirMigracao) {
  if (!p || typeof p !== "object") throw erro(400, "Pagamento inválido.");
  const forma = String(p.forma || "");
  if (!(forma in cfg.formas) || (forma === "nao_informada" && !permitirMigracao)) throw erro(400, `Forma de pagamento inválida: ${forma}`);
  const valor = Number(p.valor);
  if (!Number.isFinite(valor) || valor <= 0) throw erro(400, "Valor de pagamento inválido.");
  const limpo = { forma, conta: cfg.formas[forma].conta ?? null, valor: Math.round(valor * 100) / 100, tPag: texto(p.tPag || cfg.formas[forma].tPag, 3) };
  if (forma === "credito_parcelado") {
    const n = Number(p.parcelas);
    if (!Number.isInteger(n) || n < 2 || n > 12) throw erro(400, "Crédito parcelado: informe de 2 a 12 parcelas.");
    limpo.parcelas = n;
  }
  if (forma === "cheque") {
    const c = p.cheque || {};
    limpo.cheque = { numero: texto(c.numero, 40), emissor: texto(c.emissor, 120), banco: texto(c.banco, 60), compensacao: dataOk(c.compensacao) ? c.compensacao : "" };
    if (["bradesco", "picpay"].includes(c.contaDeposito)) limpo.cheque.contaDeposito = c.contaDeposito;
    if (dataOk(c.devolvidoEm)) limpo.cheque.devolvidoEm = c.devolvidoEm;
  }
  // Fiado: vira conta a receber; o vencimento combinado fica no pagamento (vazio = prazo padrão)
  // Conta corrente: sem vencimento (o cliente paga quando o valor acumula)
  if (forma === "fiado") {
    limpo.fiado = p.fiado?.contaCorrente === true ? { contaCorrente: true, vencimento: "" } : { vencimento: dataOk(p.fiado?.vencimento) ? p.fiado.vencimento : "" };
  }
  return limpo;
}

const CLIENTE_ID = /^[A-Za-z0-9_-]{1,40}$/;

// Cliente da venda ou do recebimento (id do cadastro + nome do momento).
// Venda fiado exige o cadastro (id); recebimento exige pelo menos o nome (cheque devolvido de quem não tem cadastro).
function clienteDoLancamento(item, { exigeId = false, exigeNome = false } = {}) {
  const id = item.clienteId == null || item.clienteId === "" ? null : String(item.clienteId);
  const nome = texto(item.cliente, 120).trim();
  if (id && !CLIENTE_ID.test(id)) throw erro(400, "Cliente inválido.");
  if ((exigeId && (!id || !nome)) || (exigeNome && !nome)) throw erro(400, "Fiado e recebimento precisam do cliente (escolha ou cadastre o cliente).");
  return { id, nome };
}

export function validarLancamentoV2(item, cfgSalva) {
  const cfg = mesclarConfigFinanceiro(cfgSalva);
  if (!item || typeof item !== "object") throw erro(400, "Lançamento inválido.");
  if (typeof item.id !== "string" || !ID.test(item.id)) throw erro(400, "Id inválido.");
  const valor = Number(item.value);
  if (!Number.isFinite(valor) || valor <= 0) throw erro(400, "Valor deve ser maior que zero.");
  const competencia = item.competencia || item.date;
  if (!dataOk(competencia)) throw erro(400, "Data inválida.");
  const base = {
    id: item.id, v: 2, value: Math.round(valor * 100) / 100, date: competencia, competencia,
    description: texto(item.description, 500),
  };
  for (const k of ["migrado", "abertura"]) if (item[k]) base[k] = true;

  // Transferência entre contas: não é receita nem despesa
  if (item.conta === "transferencia") {
    const contas = ["gaveta", "bradesco", "picpay", "cheques_carteira"];
    if (!contas.includes(item.de) || !contas.includes(item.para) || item.de === item.para) throw erro(400, "Transferência: escolha duas contas diferentes.");
    return { ...base, conta: "transferencia", de: item.de, para: item.para, category: "transferencia", type: "transfer", method: "" };
  }

  // Recebimento de fiado: o cliente paga (total ou parte) o que deve. Não é receita (ela entrou na venda):
  // só traz o dinheiro para a conta da forma usada (cheque vai para a carteira).
  if (item.conta === "recebimento") {
    const cli = clienteDoLancamento(item, { exigeNome: true });
    const pags = Array.isArray(item.pagamentos) ? item.pagamentos : [];
    if (pags.length < 1 || pags.length > 10) throw erro(400, "Informe de 1 a 10 formas de pagamento.");
    const pagamentos = pags.map((p) => validarPagamento(p, cfg, false));
    if (pagamentos.some((p) => p.forma === "fiado")) throw erro(400, "Recebimento não pode ser em fiado.");
    const soma = pagamentos.reduce((s, p) => s + centavosDe(p.valor), 0);
    if (soma !== centavosDe(base.value)) throw erro(400, `A soma das formas de pagamento (${(soma / 100).toFixed(2)}) é diferente do valor recebido (${base.value.toFixed(2)}).`);
    const r = { ...base, conta: "recebimento", category: "recebimento", type: "transfer", method: "", clienteId: cli.id, cliente: cli.nome, pagamentos };
    const ids = Array.isArray(item.vendaIds) ? item.vendaIds.filter((x) => typeof x === "string" && ID.test(x)).slice(0, 50) : [];
    if (ids.length) r.vendaIds = ids;
    return r;
  }

  // Abertura (virada): o que o cliente já devia (vias da pasta). Vira conta a receber, sem receita nem CMV
  // (a venda aconteceu antes do sistema) e sem mexer no caixa.
  if (item.conta === "fiado_anterior") {
    const cli = clienteDoLancamento(item, { exigeId: true });
    // Conta corrente: sem vencimento
    const contaCorrente = item.contaCorrente === true;
    const vencimento = contaCorrente ? "" : dataOk(item.vencimento) ? item.vencimento : somarDias(competencia, cfg.fiado.prazoDias);
    const r = { ...base, conta: "fiado_anterior", category: "fiado_anterior", type: "transfer", method: "", clienteId: cli.id, cliente: cli.nome, vencimento,
      description: base.description || "Fiado anterior (pasta)" };
    if (contaCorrente) r.contaCorrente = true;
    // "Desde": data da via mais antiga do cliente na pasta (para "em aberto há X dias"); não pode ser depois da abertura
    if (item.desde) {
      if (!dataOk(item.desde) || item.desde > competencia) throw erro(400, "Data \"desde\" inválida: deve ser a da via mais antiga, até a data da abertura.");
      r.desde = item.desde;
    }
    return r;
  }

  // Abertura (virada): cheque que já estava na gaveta e não veio do sistema antigo. Ele já está dentro do
  // saldo "Cheques em carteira" da abertura; daqui para frente compensa (ou volta) como qualquer cheque.
  if (item.conta === "cheque_anterior") {
    const cli = clienteDoLancamento(item, {});
    const p = validarPagamento({ ...(item.pagamentos?.[0] || {}), forma: "cheque" }, cfg, false);
    if (centavosDe(p.valor) !== centavosDe(base.value)) throw erro(400, "Valor do cheque diferente do lançamento.");
    if (!p.cheque.compensacao) throw erro(400, "Informe a data de compensação do cheque.");
    const r = { ...base, conta: "cheque_anterior", category: "cheque_anterior", type: "transfer", method: "", pagamentos: [p],
      description: base.description || `Cheque em carteira na abertura${p.cheque.numero ? ` nº ${p.cheque.numero}` : ""}` };
    if (cli.nome) r.cliente = cli.nome;
    if (cli.id) r.clienteId = cli.id;
    return r;
  }

  const conta = contaPorId[item.conta];
  if (!conta) throw erro(400, `Conta inválida: ${item.conta}`);
  const natureza = naturezaDaConta(conta.id);
  const limpo = { ...base, conta: conta.id, category: categoriaLegada(conta.id), type: natureza === "entrada" ? "income" : "expense" };
  if (item.classificar) limpo.classificar = conta.id.startsWith("classificar_");
  if (item.sugestao && typeof item.sugestao === "object") {
    limpo.sugestao = { conta: texto(item.sugestao.conta, 40), vendaId: texto(item.sugestao.vendaId, 60), motivo: texto(item.sugestao.motivo, 200) };
  }
  if (item.contaOriginal) limpo.contaOriginal = texto(item.contaOriginal, 40);

  if (natureza === "entrada" && ["venda_produtos", "frete_cobrado", "servicos"].includes(conta.id)) {
    const pags = Array.isArray(item.pagamentos) ? item.pagamentos : [];
    if (pags.length < 1 || pags.length > 10) throw erro(400, "Informe de 1 a 10 formas de pagamento.");
    limpo.pagamentos = pags.map((p) => validarPagamento(p, cfg, Boolean(item.migrado)));
    const soma = limpo.pagamentos.reduce((s, p) => s + centavosDe(p.valor), 0);
    if (soma !== centavosDe(limpo.value)) throw erro(400, `A soma das formas de pagamento (${(soma / 100).toFixed(2)}) é diferente do total (${limpo.value.toFixed(2)}).`);
    limpo.method = METODO_LEGADO[limpo.pagamentos[0].forma] ?? "";
    if (limpo.method === "cheque") {
      const c = limpo.pagamentos[0].cheque || {};
      Object.assign(limpo, { checkNumber: c.numero || "", checkIssuer: c.emissor || "", checkDate: c.compensacao || "" });
    }
    if (item.nfe) limpo.nfe = texto(item.nfe, 20);
    // Com fiado, o cliente é obrigatório e o vencimento vazio vira data + prazo padrão
    const temFiado = limpo.pagamentos.some((p) => p.forma === "fiado");
    const cli = clienteDoLancamento(item, { exigeId: temFiado });
    if (cli.nome) limpo.cliente = cli.nome;
    if (cli.id) limpo.clienteId = cli.id;
    for (const p of limpo.pagamentos) {
      if (p.forma === "fiado" && !p.fiado.vencimento && !p.fiado.contaCorrente) p.fiado.vencimento = somarDias(competencia, cfg.fiado.prazoDias);
    }
    if (item.cmv != null && item.cmv !== "") {
      const cmv = Number(item.cmv);
      if (!Number.isFinite(cmv) || cmv < 0) throw erro(400, "CMV inválido.");
      limpo.cmv = Math.round(cmv * 100) / 100;
    }
    if (item.origem === "calculadora") limpo.origem = "calculadora";
    if (/^ORC-\d{4,}$/.test(String(item.orcamento || ""))) limpo.orcamento = item.orcamento;
    if (Array.isArray(item.itens)) limpo.itens = item.itens.slice(0, 100).map(validarItemPedido);
    if (num(item.tabelaTotal) != null) limpo.tabelaTotal = num(item.tabelaTotal);
    // Frete cobrado junto com a venda (opcional): já está dentro do valor e das formas de pagamento
    if (item.frete != null && item.frete !== "" && Number(item.frete) !== 0) {
      const frete = Math.round(Number(item.frete) * 100) / 100;
      if (!Number.isFinite(frete) || frete < 0 || frete >= limpo.value) throw erro(400, "Frete inválido: precisa ser maior que zero e menor que o total da venda.");
      limpo.frete = frete;
    }
    if (num(item.variacao) != null) limpo.variacao = num(item.variacao);
    if (item.motivo) limpo.motivo = texto(item.motivo, 200);
    return limpo;
  }

  // Saídas (e entradas sem pagamento, como rendimentos e aporte): "Pago com" obrigatório
  if (!item.abertura) {
    if (!PAGO_COM_IDS.includes(item.pagoCom)) throw erro(400, 'Escolha "Pago com" (Gaveta, Bradesco, PicPay ou Cheque emitido).');
    limpo.pagoCom = item.pagoCom;
    limpo.dataPagamento = dataOk(item.dataPagamento) ? item.dataPagamento : competencia;
    limpo.method = METODO_LEGADO[item.pagoCom];
    if (item.pagoCom === "cheque_emitido") {
      const c = item.chequeEmitido || {};
      const contaCheque = ["bradesco", "picpay"].includes(c.conta) ? c.conta : "bradesco";
      limpo.chequeEmitido = { numero: texto(c.numero, 40), favorecido: texto(c.favorecido, 120), compensacao: dataOk(c.compensacao) ? c.compensacao : limpo.dataPagamento, conta: contaCheque };
      Object.assign(limpo, { checkNumber: limpo.chequeEmitido.numero, checkIssuer: limpo.chequeEmitido.favorecido, checkDate: limpo.chequeEmitido.compensacao });
    }
  } else {
    limpo.method = "";
  }
  if (item.fornecedor) limpo.fornecedor = texto(item.fornecedor, 120);
  if (conta.id === "investimento" && item.vidaUtilMeses) {
    const n = Number(item.vidaUtilMeses);
    if (!Number.isInteger(n) || n < 1 || n > 600) throw erro(400, "Vida útil inválida (meses).");
    limpo.vidaUtilMeses = n;
  }
  // Salário: vínculo CLT (padrão), não CLT ou pró-labore (FGTS e provisão só sobre CLT)
  if (conta.id === "salarios") limpo.vinculo = VINCULOS_SALARIO.includes(item.vinculo) ? item.vinculo : "clt";
  // Compras: itens opcionais, para ligar estoque por item no futuro
  if (["compra_material", "frete_compras"].includes(conta.id) && Array.isArray(item.itens)) limpo.itens = item.itens.slice(0, 100).map(validarItemPedido);
  return limpo;
}

// Migração para o financeiro novo: converte os lançamentos antigos e cria a abertura de agosto.
// Não apaga nada: os campos antigos continuam em cada lançamento e há cópia antes.
export async function migrarV2(kv, k) {
  await exigirMigracao(kv, k);
  const ja = await kv.get(k.migradoV2);
  if (ja) return { jaMigrado: true, ...desembrulhar(ja) };
  const travou = await kv.set(k.trava, "2", { nx: true, ex: 120 });
  if (!travou) throw erro(409, "Migração já em andamento. Tente de novo em 2 minutos.");
  try {
    const copia = await salvarCopia(kv, k, "antes-da-migracao-v2");
    const cfg = mesclarConfigFinanceiro(desembrulhar(await kv.get(k.configFinanceiro)) || {});
    const hash = (await kv.hgetall(k.lancamentos)) || {};
    const itens = Object.values(hash).map(desembrulhar).filter(Boolean);
    const idsVenda = new Set(itens.filter((i) => i.category === "venda").map((i) => String(i.id)));
    const convertidos = {};
    for (const i of itens) if (i.v !== 2) convertidos[i.id] = converterLancamento(i, cfg.formas, idsVenda);
    const abertura = lancamentosDeAbertura(desembrulhar(await kv.get(k.acumulado)));
    for (const a of abertura) if (!(a.id in hash)) convertidos[a.id] = a;
    if (Object.keys(convertidos).length) await kv.hset(k.lancamentos, convertidos);
    const resumo = { em: new Date().toISOString(), convertidos: Object.keys(convertidos).length - abertura.length, abertura: abertura.length, copia };
    await kv.set(k.migradoV2, resumo);
    return resumo;
  } finally {
    await kv.del(k.trava);
  }
}

// Reclassificação em lote: muda a conta (ou aceita a sugestão) e, em vendas, a forma de pagamento.
const VINCULOS_SALARIO = ["clt", "nao_clt", "pro_labore"];

export async function reclassificar(kv, k, pedido) {
  const { ids, conta, forma, aceitarSugestao, vinculo } = pedido || {};
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 1000) throw erro(400, "Selecione de 1 a 1000 lançamentos.");
  if (!conta && !forma && !aceitarSugestao && !vinculo) throw erro(400, "Escolha a conta, a forma de pagamento, o vínculo ou aceitar as sugestões.");
  if (vinculo && !VINCULOS_SALARIO.includes(vinculo)) throw erro(400, `Vínculo inválido: ${vinculo}`);
  if (conta && !contaPorId[conta]) throw erro(400, `Conta inválida: ${conta}`);
  const cfg = mesclarConfigFinanceiro(desembrulhar(await kv.get(k.configFinanceiro)) || {});
  if (forma && (!(forma in cfg.formas) || forma === "nao_informada")) throw erro(400, `Forma inválida: ${forma}`);
  if (!(await kv.get(k.migradoV2))) throw erro(409, "Faça primeiro a migração para o financeiro novo.");

  const atuais = (await kv.hmget(k.lancamentos, ...ids.map(String))) || {};
  const alterados = {};
  const ignorados = [];
  for (const id of ids.map(String)) {
    const item = desembrulhar(atuais[id]);
    if (!item || item.excluido) { ignorados.push({ id, motivo: "não encontrado" }); continue; }
    if (["recebimento", "fiado_anterior", "cheque_anterior"].includes(item.conta)) { ignorados.push({ id, motivo: "recebimento ou item da abertura" }); continue; }
    if (forma === "fiado" || (forma && (item.pagamentos || []).some((p) => p.forma === "fiado"))) { ignorados.push({ id, motivo: "fiado não se troca em lote" }); continue; }
    const novo = { ...item };
    if (vinculo) {
      if (item.conta !== "salarios") { ignorados.push({ id, motivo: "não é salário" }); continue; }
      alterados[id] = { ...novo, vinculo };
      continue;
    }
    const sug = aceitarSugestao ? sugestaoDe(item) : null;
    const destino = aceitarSugestao ? sug?.conta : conta;
    if (destino) {
      if (item.conta === "transferencia") { ignorados.push({ id, motivo: "transferência" }); continue; }
      const eraEntrada = naturezaDaConta(item.conta) === "entrada";
      if (eraEntrada !== (naturezaDaConta(destino) === "entrada")) { ignorados.push({ id, motivo: "entrada e saída não se trocam" }); continue; }
      if (!novo.contaOriginal) novo.contaOriginal = item.conta;
      novo.conta = destino;
      novo.category = categoriaLegada(destino);
      novo.classificar = destino.startsWith("classificar_");
      if (!novo.classificar) delete novo.classificar;
      // Guia de DAS/FGTS: competência no mês a que a guia se refere (o caixa fica na data do pagamento)
      if (sug?.competencia && sug.competencia !== item.competencia) {
        if (!novo.competenciaOriginal) novo.competenciaOriginal = item.competencia;
        novo.competencia = sug.competencia;
        if (!novo.dataPagamento) novo.dataPagamento = item.competencia;
      }
    } else if (aceitarSugestao) {
      ignorados.push({ id, motivo: "sem sugestão" });
      continue;
    }
    if (forma) {
      if (!Array.isArray(item.pagamentos) || item.pagamentos.length !== 1) { ignorados.push({ id, motivo: "não é venda com uma só forma" }); continue; }
      const p = item.pagamentos[0];
      if (!novo.formaOriginal) novo.formaOriginal = p.forma;
      novo.pagamentos = [{ ...p, forma, conta: cfg.formas[forma].conta, tPag: cfg.formas[forma].tPag }];
      novo.method = METODO_LEGADO[forma] ?? "";
    }
    alterados[id] = novo;
  }
  if (Object.keys(alterados).length) {
    await salvarCopia(kv, k, "antes-de-reclassificar");
    await kv.hset(k.lancamentos, alterados);
  }
  return { alterados: Object.keys(alterados).length, ignorados };
}

const pct = (v, nome) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 100) throw erro(400, `Percentual inválido: ${nome}.`);
  return n;
};
const dias = (v, nome) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 365) throw erro(400, `Prazo inválido: ${nome}.`);
  return n;
};

export async function salvarConfigFinanceiro(kv, k, config) {
  const c = mesclarConfigFinanceiro(config);
  const limpa = structuredClone(CONFIG_FINANCEIRO_PADRAO);
  const contasValidas = ["gaveta", "bradesco", "picpay", "cheques_carteira", null];
  for (const id of Object.keys(limpa.formas)) {
    const f = c.formas[id] || {};
    if (!contasValidas.includes(f.conta ?? null)) throw erro(400, `Conta de destino inválida para ${id}.`);
    if (!/^\d{2}$/.test(String(f.tPag))) throw erro(400, `Código tPag inválido para ${id} (2 dígitos).`);
    limpa.formas[id] = { conta: f.conta ?? null, tPag: String(f.tPag) };
  }
  limpa.cartao.debito = { taxaPct: pct(c.cartao.debito.taxaPct, "débito"), prazoDias: dias(c.cartao.debito.prazoDias, "débito") };
  limpa.cartao.credito = { taxaPct: pct(c.cartao.credito.taxaPct, "crédito"), prazoDias: dias(c.cartao.credito.prazoDias, "crédito") };
  for (const n of Object.keys(limpa.cartao.parcelado.taxaPctPorParcelas)) {
    limpa.cartao.parcelado.taxaPctPorParcelas[n] = pct(c.cartao.parcelado.taxaPctPorParcelas[n], `parcelado ${n}x`);
  }
  limpa.cartao.parcelado.prazoDias = dias(c.cartao.parcelado.prazoDias, "parcelado");
  limpa.cmv.margemPadraoPct = pct(c.cmv.margemPadraoPct, "margem padrão");
  limpa.cmv.mesesMedia = Math.min(12, Math.max(1, Math.round(Number(c.cmv.mesesMedia) || 3)));
  limpa.pessoal = {
    provisao13FeriasLigada: Boolean(c.pessoal.provisao13FeriasLigada),
    provisaoPct: pct(c.pessoal.provisaoPct, "provisão"),
    fgtsPct: pct(c.pessoal.fgtsPct, "FGTS"),
    estimarFgts: Boolean(c.pessoal.estimarFgts),
  };
  limpa.impostos.regime = ["simples_nacional", "lucro_presumido", "outro"].includes(c.impostos.regime) ? c.impostos.regime : "simples_nacional";
  limpa.impostos.estimarSimples = Boolean(c.impostos.estimarSimples);
  limpa.impostos.rbt12 = c.impostos.rbt12 == null || c.impostos.rbt12 === "" ? null : Number(c.impostos.rbt12);
  if (limpa.impostos.rbt12 != null && !(limpa.impostos.rbt12 > 0)) throw erro(400, "RBT12 inválido.");
  if (Array.isArray(c.impostos.tabelaSimples) && c.impostos.tabelaSimples.every((f) => Array.isArray(f) && f.length === 3 && f.every((x) => Number.isFinite(Number(x))))) {
    limpa.impostos.tabelaSimples = c.impostos.tabelaSimples.map((f) => f.map(Number));
  }
  limpa.depreciacaoLigada = Boolean(c.depreciacaoLigada);
  limpa.estimativasContabeis = c.estimativasContabeis === true;
  // Cabeçalho das vias (Ajustes › Impressão)
  limpa.impressao = { nome: texto(c.impressao?.nome, 80).trim(), telefone: texto(c.impressao?.telefone, 60).trim(), endereco: texto(c.impressao?.endereco, 160).trim(), cnpj: texto(c.impressao?.cnpj, 25).trim() };
  limpa.estoque = {
    inicial: Number(c.estoque.inicial) || 0,
    dataInicial: dataOk(c.estoque.dataInicial) ? c.estoque.dataInicial : null,
    porItem: false, // reservado para o estoque por item (fase futura)
  };
  const o = c.orcamentos;
  const inteiro = (v, min, max, nome) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) throw erro(400, `Valor inválido: ${nome}.`);
    return n;
  };
  limpa.orcamentos = {
    validadeDias: inteiro(o.validadeDias, 1, 90, "validade do orçamento"),
    diasParaCobrar: inteiro(o.diasParaCobrar, 1, 60, "dias para cobrar"),
    diasAmarelo: inteiro(o.diasAmarelo, 1, 60, "dias para ficar amarelo"),
    modelos: (Array.isArray(o.modelos) ? o.modelos : []).map((m) => texto(m, 600).trim()).filter(Boolean).slice(0, 5),
  };
  if (!limpa.orcamentos.modelos.length) throw erro(400, "Deixe pelo menos um modelo de mensagem de cobrança.");
  limpa.cheques = { contaDeposito: ["bradesco", "picpay"].includes(c.cheques?.contaDeposito) ? c.cheques.contaDeposito : "bradesco" };
  limpa.fiado = { ligado: c.fiado?.ligado !== false, prazoDias: inteiro(c.fiado?.prazoDias ?? 30, 1, 365, "prazo do fiado (1 a 365 dias)") };
  await kv.set(k.configFinanceiro, limpa);
  return limpa;
}


// --- Orçamentos e clientes ---

function itemOrcamento(i) {
  if (!i || typeof i !== "object") throw erro(400, "Item do orçamento inválido.");
  return {
    itemId: texto(i.itemId, 120),
    acabamento: texto(i.acabamento, 20),
    quantidade: num(i.quantidade),
    comprimento: num(i.comprimento),
    descricao: texto(i.descricao, 200),
    descricaoLivre: texto(i.descricaoLivre, 120),
    quantidadeTexto: texto(i.quantidadeTexto, 80),
    unidade: texto(i.unidade, 20),
    precoTabela: num(i.precoTabela),
    tabelaTotal: num(i.tabelaTotal),
    precoUnitario: num(i.precoUnitario),
    vendaTotal: num(i.vendaTotal),
    custoTotal: num(i.custoTotal),
    variacaoPct: num(i.variacaoPct),
    motivo: texto(i.motivo, 200),
  };
}

function valoresOrcamento(d) {
  if (!Array.isArray(d.itens) || d.itens.length < 1 || d.itens.length > 100) throw erro(400, "O orçamento precisa ter de 1 a 100 itens.");
  const itens = d.itens.map(itemOrcamento);
  if (itens.some((i) => i.vendaTotal == null)) throw erro(400, "Há item sem preço no orçamento.");
  const total = Number(d.total);
  if (!Number.isFinite(total) || total <= 0) throw erro(400, "Total do orçamento inválido.");
  // Frete opcional, à parte dos itens; o total já inclui o frete
  const frete = d.frete == null || d.frete === "" ? 0 : Math.round(Number(d.frete) * 100) / 100;
  if (!Number.isFinite(frete) || frete < 0 || frete >= total) throw erro(400, "Frete do orçamento inválido.");
  return {
    itens,
    total: Math.round(total * 100) / 100,
    frete,
    custo: num(d.custo),
    margem: num(d.margem),
    tabelaTotal: num(d.tabelaTotal),
    variacao: num(d.variacao),
    motivoGeral: texto(d.motivoGeral, 200),
  };
}

const dataDe = (d) => (dataOk(d) ? d : new Date().toISOString().slice(0, 10));

async function salvarClienteDoOrcamento(kv, k, nome, telefone) {
  const t = normalizarTelefone(telefone);
  const atual = desembrulhar(await kv.hget(k.clientes, t.digitos));
  const agora = new Date().toISOString();
  // Mantém o que o cadastro já tinha (obs, conta corrente, alertas); o orçamento só atualiza nome e telefone
  const cliente = { ...(atual || {}), id: t.digitos, nome, telefone: t.formatado, obs: atual?.obs || "", criadoEm: atual?.criadoEm || agora, atualizadoEm: agora };
  await kv.hset(k.clientes, { [t.digitos]: cliente });
  return cliente;
}

export async function listarOrcamentos(kv, k) {
  const orcamentos = Object.values((await kv.hgetall(k.orcamentos)) || {}).map(desembrulhar).filter(Boolean);
  const clientes = Object.values((await kv.hgetall(k.clientes)) || {}).map(desembrulhar).filter(Boolean);
  return { orcamentos, clientes };
}

// Cria (número novo) ou edita (mesmo número) um orçamento
export async function salvarOrcamento(kv, k, d, cfgSalva) {
  if (!d || typeof d !== "object") throw erro(400, "Orçamento inválido.");
  const cfg = mesclarConfigFinanceiro(cfgSalva);
  const nome = texto(d.cliente?.nome, 120).trim();
  if (!nome) throw erro(400, "Informe o nome do cliente.");
  const tel = normalizarTelefone(d.cliente?.telefone);
  if (!tel.ok) throw erro(400, tel.erro);
  if (!(d.origem in ORIGENS)) throw erro(400, "Escolha a origem: Balcão, WhatsApp ou Telefone.");
  const validadeDias = Number(d.validadeDias ?? cfg.orcamentos.validadeDias);
  if (!Number.isInteger(validadeDias) || validadeDias < 1 || validadeDias > 90) throw erro(400, "Validade inválida (1 a 90 dias).");
  const hoje = dataDe(d.hoje);
  const valores = valoresOrcamento(d);
  const cliente = await salvarClienteDoOrcamento(kv, k, nome, tel.formatado);
  const agora = new Date().toISOString();

  if (d.id) {
    const atual = desembrulhar(await kv.hget(k.orcamentos, String(d.id)));
    if (!atual) throw erro(404, "Orçamento não encontrado.");
    if (atual.status === "fechado") throw erro(409, "Orçamento fechado (virou venda) não pode ser editado. Use Duplicar.");
    if (atual.excluidoEm) throw erro(409, "Orçamento está na lixeira. Restaure antes de editar.");
    const editado = {
      ...atual, ...valores,
      cliente: { id: cliente.id, nome: cliente.nome, telefone: cliente.telefone },
      origem: d.origem, obs: texto(d.obs, 500), validadeDias, validoAte: somarDias(hoje, validadeDias),
      editadoEm: agora,
      historico: [...(atual.historico || []), { em: agora, evento: "editado", total: valores.total }].slice(-50),
    };
    await kv.hset(k.orcamentos, { [editado.id]: editado });
    return editado;
  }

  const numero = Number(await kv.incr(k.orcSeq));
  const orc = {
    id: numeroOrcamento(numero), numero, data: hoje, criadoEm: agora, ...valores,
    cliente: { id: cliente.id, nome: cliente.nome, telefone: cliente.telefone },
    origem: d.origem, obs: texto(d.obs, 500), validadeDias, validoAte: somarDias(hoje, validadeDias),
    status: "aberto", contatos: [], historico: [{ em: agora, evento: "criado", total: valores.total }],
  };
  if (d.duplicadoDe) orc.duplicadoDe = texto(d.duplicadoDe, 20);
  await kv.hset(k.orcamentos, { [orc.id]: orc });
  return orc;
}

// Situações: Em aberto -> Fechado (virou venda) ou Perdido. Quem muda a situação são as ações:
// contato, perdido, fechar, reabrir, precos (atualizar pela tabela), excluir e restaurar (lixeira).
// "aguardando" (dados antigos) conta como Em aberto.
export async function atualizarOrcamento(kv, k, p) {
  const orc = desembrulhar(await kv.hget(k.orcamentos, String(p?.id || "")));
  if (!orc) throw erro(404, "Orçamento não encontrado.");
  const agora = new Date().toISOString();
  const novo = { ...orc, atualizadoEm: agora };
  const hist = (evento, extra = {}) => { novo.historico = [...(orc.historico || []), { em: agora, evento, ...extra }].slice(-50); };
  if (orc.excluidoEm && p.acao !== "restaurar") throw erro(409, "Orçamento está na lixeira. Restaure antes.");
  switch (p.acao) {
    case "contato": {
      const tipo = p.tipo === "cobrar" ? "cobrar" : "enviar";
      novo.contatos = [...(orc.contatos || []), { em: agora, tipo }].slice(-100);
      novo.ultimoContato = agora;
      break;
    }
    case "excluir":
      if (orc.status === "fechado") throw erro(409, "Orçamento convertido em venda não pode ser excluído. Para desfazer, estorne a venda no Caixa.");
      novo.excluidoEm = agora;
      hist("excluído (lixeira)");
      break;
    case "restaurar":
      if (!orc.excluidoEm) throw erro(409, "Orçamento não está na lixeira.");
      delete novo.excluidoEm;
      hist("restaurado da lixeira");
      break;
    case "perdido":
      if (orc.status === "fechado") throw erro(409, "Orçamento já virou venda.");
      if (!MOTIVOS_PERDA.includes(p.motivo) && !String(p.motivo || "").startsWith("Outro")) throw erro(400, "Escolha o motivo da perda.");
      novo.status = "perdido";
      novo.motivoPerda = MOTIVOS_PERDA.includes(p.motivo) ? p.motivo : "Outro";
      if (novo.motivoPerda === "Outro") novo.motivoPerdaTexto = texto(String(p.motivo).replace(/^Outro:?\s*/, ""), 200);
      novo.perdidoEm = agora;
      hist("perdido", { motivo: novo.motivoPerda });
      break;
    case "reabrir": {
      if (orc.status !== "perdido" && orc.status !== "fechado") throw erro(409, "Só orçamento perdido ou fechado sem venda pode ser reaberto.");
      if (orc.status === "fechado" && orc.vendaId) {
        const venda = desembrulhar(await kv.hget(k.lancamentos, String(orc.vendaId)));
        if (venda && !venda.excluido) throw erro(409, `Orçamento virou a venda ${orc.vendaId}. Para reabrir, estorne (exclua) a venda no Caixa antes.`);
        novo.vendaIdAnterior = orc.vendaId;
      }
      novo.status = "aberto";
      for (const c of ["motivoPerda", "motivoPerdaTexto", "perdidoEm", "vendaId", "fechadoEm"]) delete novo[c];
      hist("reaberto");
      break;
    }
    case "fechar":
      if (!ID.test(String(p.vendaId || ""))) throw erro(400, "Venda inválida.");
      novo.status = "fechado";
      novo.vendaId = String(p.vendaId);
      novo.fechadoEm = dataDe(p.hoje);
      hist("fechado", { vendaId: novo.vendaId });
      break;
    case "precos": {
      if (orc.status === "fechado") throw erro(409, "Orçamento já virou venda.");
      const valores = valoresOrcamento({ ...p, frete: p.frete ?? orc.frete }); // o frete continua o mesmo
      const hoje = dataDe(p.hoje);
      Object.assign(novo, valores, { validoAte: somarDias(hoje, orc.validadeDias), precosAtualizadosEm: agora });
      hist("preços atualizados", { de: orc.total, para: valores.total });
      break;
    }
    default:
      throw erro(400, "Ação inválida.");
  }
  await kv.hset(k.orcamentos, { [novo.id]: novo });
  return novo;
}

// Cadastro de clientes (orçamentos e fiado). A chave é o WhatsApp (DDD + número);
// cliente sem WhatsApp (comum no fiado) ganha um código C1, C2… Editar mantém a chave.
export async function salvarCliente(kv, k, c) {
  const nome = texto(c?.nome, 120).trim();
  if (!nome) throw erro(400, "Informe o nome do cliente.");
  const telTexto = String(c?.telefone || "").trim();
  const t = telTexto ? normalizarTelefone(telTexto) : null;
  if (t && !t.ok) throw erro(400, t.erro);
  const agora = new Date().toISOString();
  let id;
  if (c?.id) {
    id = String(c.id);
    if (!(await kv.hget(k.clientes, id))) throw erro(404, "Cliente não encontrado.");
  } else if (t) {
    id = t.digitos;
  } else {
    id = `C${Number(await kv.incr(k.cliSeq))}`;
  }
  const atual = desembrulhar(await kv.hget(k.clientes, id));
  // Conta corrente: fiado sem vencimento (nunca "atrasado"); alertas opcionais por limite em R$ e/ou dias sem pagar
  const opcional = (v, min, max, nome, inteiro) => {
    if (v === undefined) return undefined;
    if (v === null || v === "") return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < min || n > max || (inteiro && !Number.isInteger(n))) throw erro(400, `Alerta inválido: ${nome}.`);
    return inteiro ? n : Math.round(n * 100) / 100;
  };
  const limite = opcional(c.alertaLimite, 0.01, 1e7, "limite em R$", false);
  const dias = opcional(c.alertaDias, 1, 3650, "dias sem pagar", true);
  const cliente = {
    id, nome, telefone: t ? t.formatado : "", obs: texto(c.obs ?? atual?.obs, 500),
    contaCorrente: c.contaCorrente === undefined ? Boolean(atual?.contaCorrente) : c.contaCorrente === true,
    alertaLimite: limite === undefined ? (atual?.alertaLimite ?? null) : limite,
    alertaDias: dias === undefined ? (atual?.alertaDias ?? null) : dias,
    criadoEm: atual?.criadoEm || agora, atualizadoEm: agora,
  };
  await kv.hset(k.clientes, { [id]: cliente });
  return cliente;
}

export async function listarClientes(kv, k) {
  return { clientes: Object.values((await kv.hgetall(k.clientes)) || {}).map(desembrulhar).filter(Boolean).sort((a, b) => a.nome.localeCompare(b.nome)) };
}


// --- Contas e saldos (Fase 2B) ---

const CONTAS_SALDO = ["gaveta", "bradesco", "picpay", "cheques_carteira"];

async function lerSaldos(kv, k) {
  return desembrulhar(await kv.get(k.saldos)) || { abertura: null, conferencias: [], aberturasAnteriores: [] };
}

// Abertura de saldos: saldo de cada conta no início do dia da troca (extratos e contagem da gaveta)
export async function salvarAbertura(kv, k, a) {
  if (!a || !dataOk(a.data)) throw erro(400, "Informe a data da abertura.");
  const contas = {};
  for (const c of CONTAS_SALDO) {
    const v = Number(a.contas?.[c] ?? 0);
    if (!Number.isFinite(v) || Math.abs(v) > 1e9) throw erro(400, `Saldo inválido: ${c}.`);
    contas[c] = Math.round(v * 100) / 100;
  }
  const atual = await lerSaldos(kv, k);
  const nova = { data: a.data, contas, obs: texto(a.obs, 300), em: new Date().toISOString() };
  const salvo = {
    ...atual,
    abertura: nova,
    aberturasAnteriores: [...(atual.aberturasAnteriores || []), ...(atual.abertura ? [atual.abertura] : [])].slice(-20),
  };
  await kv.set(k.saldos, salvo);
  return salvo;
}

// Conferência de saldo (extrato ou contagem da gaveta): guarda informado, calculado e a diferença
export async function registrarConferencia(kv, k, c) {
  if (!c || !CONTAS_SALDO.includes(c.conta)) throw erro(400, "Conta inválida.");
  if (!dataOk(c.data)) throw erro(400, "Data inválida.");
  const informado = Number(c.informado), calculado = Number(c.calculado);
  if (!Number.isFinite(informado) || !Number.isFinite(calculado)) throw erro(400, "Informe o saldo real.");
  const atual = await lerSaldos(kv, k);
  const conf = {
    id: `conf-${Date.now().toString(36)}`, data: c.data, conta: c.conta,
    informado: Math.round(informado * 100) / 100, calculado: Math.round(calculado * 100) / 100,
    diferenca: Math.round((informado - calculado) * 100) / 100, obs: texto(c.obs, 300), em: new Date().toISOString(),
  };
  const salvo = { ...atual, conferencias: [...(atual.conferencias || []), conf].slice(-500) };
  await kv.set(k.saldos, salvo);
  return conf;
}

// Cheques: devolvido (ou desfazer), data de compensação e conta de depósito/saída
export async function atualizarCheque(kv, k, p) {
  const l = desembrulhar(await kv.hget(k.lancamentos, String(p?.id || "")));
  if (!l || l.excluido) throw erro(404, "Lançamento não encontrado.");
  const novo = { ...l };
  const agora = new Date().toISOString();
  if (p.tipo === "recebido") {
    const i = Number(p.pagamento);
    const pag = Array.isArray(l.pagamentos) ? l.pagamentos[i] : null;
    if (!pag || pag.forma !== "cheque") throw erro(400, "Esse pagamento não é um cheque.");
    const ch = { ...(pag.cheque || {}) };
    if ("devolvidoEm" in p) {
      if (p.devolvidoEm === null) delete ch.devolvidoEm;
      else if (dataOk(p.devolvidoEm)) ch.devolvidoEm = p.devolvidoEm;
      else throw erro(400, "Data de devolução inválida.");
    }
    if (p.compensacao !== undefined) {
      if (!dataOk(p.compensacao)) throw erro(400, "Data de compensação inválida.");
      ch.compensacao = p.compensacao;
    }
    if (p.contaDeposito !== undefined) {
      if (!["bradesco", "picpay"].includes(p.contaDeposito)) throw erro(400, "Conta de depósito inválida.");
      ch.contaDeposito = p.contaDeposito;
    }
    novo.pagamentos = l.pagamentos.map((x, n) => (n === i ? { ...x, cheque: ch } : x));
    if (i === 0) Object.assign(novo, { checkDate: ch.compensacao || novo.checkDate });
  } else if (p.tipo === "emitido") {
    if (l.pagoCom !== "cheque_emitido") throw erro(400, "Esse lançamento não é um cheque emitido.");
    const ch = { ...(l.chequeEmitido || {}) };
    if (p.compensacao !== undefined) {
      if (!dataOk(p.compensacao)) throw erro(400, "Data de compensação inválida.");
      ch.compensacao = p.compensacao;
    }
    if (p.conta !== undefined) {
      if (!["bradesco", "picpay"].includes(p.conta)) throw erro(400, "Conta inválida.");
      ch.conta = p.conta;
    }
    novo.chequeEmitido = ch;
    novo.checkDate = ch.compensacao;
  } else {
    throw erro(400, "Tipo de cheque inválido.");
  }
  novo.historicoCheque = [...(l.historicoCheque || []), { em: agora, ...Object.fromEntries(Object.entries(p).filter(([key]) => !["id"].includes(key))) }].slice(-20);
  await kv.hset(k.lancamentos, { [novo.id]: novo });
  return novo;
}
