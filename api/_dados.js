// Regras de leitura e gravação no KV. Recebe o cliente `kv` e as `chaves` como parâmetro
// para poder ser testado sem banco (ver tests/dados.test.js).

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
  let financeItems;
  if (migrado) {
    const hash = (await kv.hgetall(k.lancamentos)) || {};
    financeItems = Object.values(hash).map(desembrulhar).filter((i) => i && !i.excluido);
  } else {
    financeItems = desembrulhar(await kv.get(k.finance)) || [];
  }
  const acumulado = desembrulhar(await kv.get(k.acumulado)) || null;
  return { migrado, financeItems, acumulado };
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
  const limpos = itens.map(validarLancamento);
  await kv.hset(k.lancamentos, Object.fromEntries(limpos.map((i) => [i.id, i])));
  return { salvos: limpos.length };
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
