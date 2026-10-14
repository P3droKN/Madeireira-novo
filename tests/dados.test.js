import { test } from "node:test";
import assert from "node:assert/strict";
import { chaves, senhaConfere } from "../api/_lib.js";
import {
  lerTudo, migrar, salvarLancamentos, excluirLancamento, importar, restaurar,
  montarBackup, salvarAcumulado, listarCopias, validarLancamento,
  salvarPrecos, salvarConfig, lerPrecosEConfig,
} from "../api/_dados.js";

// KV em memória com os mesmos comandos do @vercel/kv usados pelo sistema.
// Os valores são clonados, como se passassem por JSON no Redis.
function kvFalso(inicial = {}) {
  const dados = new Map(Object.entries(structuredClone(inicial)));
  const clone = (v) => (v === undefined ? null : structuredClone(v));
  return {
    dados,
    async get(k) { return clone(dados.get(k)); },
    async set(k, v, opts = {}) {
      if (opts.nx && dados.has(k)) return null;
      dados.set(k, clone(v));
      return "OK";
    },
    async del(...ks) { let n = 0; for (const k of ks) n += dados.delete(k) ? 1 : 0; return n; },
    async hgetall(k) { const h = dados.get(k); return h && Object.keys(h).length ? clone(h) : null; },
    async hget(k, f) { return clone(dados.get(k)?.[f]); },
    async hset(k, obj) { const h = dados.get(k) || {}; Object.assign(h, clone(obj)); dados.set(k, h); return Object.keys(obj).length; },
    async hdel(k, ...fs) { const h = dados.get(k) || {}; let n = 0; for (const f of fs) if (f in h) { delete h[f]; n++; } return n; },
    async hsetnx(k, f, v) { const h = dados.get(k) || {}; if (f in h) return 0; h[f] = clone(v); dados.set(k, h); return 1; },
    async hlen(k) { return Object.keys(dados.get(k) || {}).length; },
    async lpush(k, ...vs) { const l = dados.get(k) || []; l.unshift(...vs.reverse()); dados.set(k, l); return l.length; },
    async lrange(k, a, b) { const l = dados.get(k) || []; return l.slice(a, b === -1 ? undefined : b + 1); },
    async ltrim(k, a, b) { const l = dados.get(k) || []; dados.set(k, l.slice(a, b + 1)); return "OK"; },
  };
}

const K = chaves("production");
const ANTIGOS = [
  { id: "1001", category: "custo", type: "expense", value: 748.41, date: "2026-08-24", description: "", method: "cheque" },
  { id: "1003", category: "venda", type: "income", value: 150, date: "2026-08-24", description: "", method: "bradesco" },
  { id: "1003", category: "venda", type: "income", value: 300, date: "2026-08-24", description: "mesmo id", method: "pix" },
];
const ACUMULADO = { venda: 48866, pix: 12440, credito: 16565, debito: 5757.5, custo: 23422.5, despesa: 28910.55, func: 16160.28, dinheiroCaixa: 0 };

const sistemaAntigo = () => kvFalso({ [K.finance]: ANTIGOS, [K.acumulado]: ACUMULADO });
const lanc = (id, extra = {}) => ({ id, category: "venda", value: 10, date: "2026-10-14", method: "pix", description: "", ...extra });

test("chaves: produção usa os nomes originais; preview e dev usam prefixo", () => {
  assert.equal(chaves("production").finance, "madeireira_finance");
  assert.equal(chaves("preview").finance, "preview:madeireira_finance");
  assert.equal(chaves(undefined).finance, "preview:madeireira_finance");
});

test("chaves: KV_PREFIXO força o prefixo até na produção (projeto de testes)", () => {
  assert.equal(chaves("production", "teste:").finance, "teste:madeireira_finance");
  assert.equal(chaves("preview", "teste:").lancamentos, "teste:madeireira_lancamentos");
});

test("senha: confere só a senha exata, e nunca com senha vazia configurada", () => {
  assert.equal(senhaConfere("abc", "abc"), true);
  assert.equal(senhaConfere("abd", "abc"), false);
  assert.equal(senhaConfere(undefined, "abc"), false);
  assert.equal(senhaConfere("", ""), false);
});

test("antes da migração: lê a lista antiga e recusa gravar", async () => {
  const kv = sistemaAntigo();
  const r = await lerTudo(kv, K);
  assert.equal(r.migrado, false);
  assert.equal(r.financeItems.length, 3);
  await assert.rejects(salvarLancamentos(kv, K, [lanc("x1")]), { status: 409 });
});

test("migração: copia tudo (inclusive id repetido), guarda cópia e não mexe na lista antiga", async () => {
  const kv = sistemaAntigo();
  const r = await migrar(kv, K);
  assert.equal(r.migrados, 3);
  assert.deepEqual(await kv.get(K.finance), ANTIGOS);
  const ids = Object.keys(await kv.hgetall(K.lancamentos)).sort();
  assert.deepEqual(ids, ["1001", "1003", "1003-dup1"]);
  const copias = await listarCopias(kv, K);
  assert.equal(copias.length, 1);
  assert.deepEqual((await kv.get(copias[0])).chaves.madeireira_finance, ANTIGOS);
  assert.deepEqual(await migrar(kv, K), { jaMigrado: true });
});

test("dois aparelhos lançando ao mesmo tempo: nenhum lançamento some", async () => {
  const kv = sistemaAntigo();
  await migrar(kv, K);
  await Promise.all([salvarLancamentos(kv, K, [lanc("celular1")]), salvarLancamentos(kv, K, [lanc("celular2")])]);
  const { financeItems } = await lerTudo(kv, K);
  assert.equal(financeItems.length, 5);
});

test("excluir marca como excluído, some da tela e continua guardado", async () => {
  const kv = sistemaAntigo();
  await migrar(kv, K);
  await excluirLancamento(kv, K, "1001");
  assert.equal((await lerTudo(kv, K)).financeItems.some((i) => i.id === "1001"), false);
  assert.equal((await kv.hget(K.lancamentos, "1001")).excluido, true);
});

test("importar junta: adiciona só o que falta e não altera os existentes", async () => {
  const kv = sistemaAntigo();
  await migrar(kv, K);
  const r = await importar(kv, K, { financeItems: [{ ...ANTIGOS[0], value: 1 }, lanc("novo"), { id: "ruim" }], acumulado: {} });
  assert.deepEqual(r, { adicionados: 1, existentes: 1, invalidos: 1, migrou: false, acumuladoImportado: false });
  assert.equal((await kv.hget(K.lancamentos, "1001")).value, 748.41);
  const vazio = await importar(kv, K, { financeItems: [] });
  assert.equal(vazio.adicionados, 0);
  assert.equal((await lerTudo(kv, K)).financeItems.length, 4);
});

test("restaurar o backup feito antes da migração volta ao estado original", async () => {
  const kv = sistemaAntigo();
  const antes = await montarBackup(kv, K);
  await migrar(kv, K);
  await salvarLancamentos(kv, K, [lanc("depois")]);

  const r = await restaurar(kv, K, antes);
  assert.equal(r.migrado, false);
  assert.deepEqual(await kv.get(K.finance), ANTIGOS);
  assert.deepEqual(await kv.get(K.acumulado), ACUMULADO);
  assert.equal(await kv.hgetall(K.lancamentos), null);
  assert.equal(await kv.get(K.migrado), null);
  // A cópia guardada antes de restaurar ainda tem o lançamento "depois"
  const copia = await kv.get(r.copia);
  assert.ok(copia.chaves.madeireira_lancamentos.depois);
});

test("restaurar aceita o arquivo do botão Exportar antigo", async () => {
  const kv = kvFalso({});
  await restaurar(kv, K, { financeItems: ANTIGOS, acumulado: ACUMULADO });
  const r = await lerTudo(kv, K);
  assert.equal(r.migrado, false);
  assert.equal(r.financeItems.length, 3);
  assert.deepEqual(r.acumulado, ACUMULADO);
});

test("restaurar um backup depois da migração devolve o estado migrado", async () => {
  const kv = sistemaAntigo();
  await migrar(kv, K);
  await salvarLancamentos(kv, K, [lanc("a")]);
  const backup = await montarBackup(kv, K);
  await salvarLancamentos(kv, K, [lanc("b")]);
  await restaurar(kv, K, backup);
  const ids = (await lerTudo(kv, K)).financeItems.map((i) => i.id);
  assert.ok(ids.includes("a"));
  assert.ok(!ids.includes("b"));
});

test("backup da produção pode ser restaurado no preview sem tocar na produção", async () => {
  const P = chaves("preview");
  const kv = sistemaAntigo();
  const backupProd = await montarBackup(kv, K);
  await restaurar(kv, P, backupProd);
  await migrar(kv, P);
  assert.deepEqual(await kv.get(K.finance), ANTIGOS);
  assert.equal(await kv.get(K.migrado), null);
  assert.equal((await lerTudo(kv, P)).financeItems.length, 3);
});

test("restaurar recusa arquivo desconhecido sem alterar nada", async () => {
  const kv = sistemaAntigo();
  await assert.rejects(restaurar(kv, K, { qualquer: 1 }), { status: 400 });
  assert.deepEqual(await kv.get(K.finance), ANTIGOS);
});

test("validação: rejeita valor zero, data e forma inválidas; remove campos estranhos", () => {
  assert.throws(() => validarLancamento(lanc("a", { value: 0 })), { status: 400 });
  assert.throws(() => validarLancamento(lanc("a", { date: "14/10/2026" })), { status: 400 });
  assert.throws(() => validarLancamento(lanc("a", { method: "boleto" })), { status: 400 });
  assert.throws(() => validarLancamento(lanc("<script>")), { status: 400 });
  const ok = validarLancamento(lanc("a", { type: "expense", hack: 1 }));
  assert.equal(ok.type, "income");
  assert.equal(ok.hack, undefined);
});

test("acumulado: guarda cópia antes de alterar", async () => {
  const kv = sistemaAntigo();
  await salvarAcumulado(kv, K, { venda: 1 });
  assert.equal((await kv.get(K.acumulado)).venda, 1);
  const [copia] = await listarCopias(kv, K);
  assert.deepEqual((await kv.get(copia)).chaves.madeireira_acumulado, ACUMULADO);
});

const valida = (c) => /^[A-Z_]+\|[^|]+\|(BRUTO|CEPILHADO|UNICO)$/.test(c);

test("preços: grava, apaga com null e recusa item fora do catálogo", async () => {
  const kv = kvFalso({});
  await salvarPrecos(kv, K, { "CAMBARA|1x2|BRUTO": 6.5, "CAMBARA|1x2|CEPILHADO": "7.25" }, valida);
  assert.deepEqual((await lerPrecosEConfig(kv, K)).precos, { "CAMBARA|1x2|BRUTO": 6.5, "CAMBARA|1x2|CEPILHADO": 7.25 });
  await salvarPrecos(kv, K, { "CAMBARA|1x2|CEPILHADO": null }, valida);
  assert.deepEqual((await lerPrecosEConfig(kv, K)).precos, { "CAMBARA|1x2|BRUTO": 6.5 });
  await assert.rejects(salvarPrecos(kv, K, { "x": 1 }, valida), { status: 400 });
  await assert.rejects(salvarPrecos(kv, K, { "CAMBARA|1x2|BRUTO": -1 }, valida), { status: 400 });
});

test("config: percentuais entre 0 e 100 e só materiais conhecidos", async () => {
  const kv = kvFalso({});
  const c = await salvarConfig(kv, K, { modificadores: { selecionadaPct: 10, ultimasPecasPct: "15" }, temCepilhado: { EUCALIPTO: true, OUTRO: true } }, ["EUCALIPTO", "PINUS"]);
  assert.deepEqual(c, { modificadores: { selecionadaPct: 10, ultimasPecasPct: 15 }, temCepilhado: { EUCALIPTO: true } });
  await assert.rejects(salvarConfig(kv, K, { modificadores: { selecionadaPct: 150 } }, []), { status: 400 });
});

test("backup e restauração incluem preços e config; backup antigo não apaga preços", async () => {
  const kv = sistemaAntigo();
  const antigo = await montarBackup(kv, K);
  delete antigo.chaves.madeireira_precos_venda;
  delete antigo.chaves.madeireira_config;
  await salvarPrecos(kv, K, { "CAMBARA|1x2|BRUTO": 6.5 }, valida);
  const novo = await montarBackup(kv, K);
  assert.deepEqual(novo.chaves.madeireira_precos_venda, { "CAMBARA|1x2|BRUTO": 6.5 });
  await restaurar(kv, K, antigo);
  assert.equal((await lerPrecosEConfig(kv, K)).precos["CAMBARA|1x2|BRUTO"], 6.5);
  await salvarPrecos(kv, K, { "CAMBARA|1x2|BRUTO": 9 }, valida);
  await restaurar(kv, K, novo);
  assert.equal((await lerPrecosEConfig(kv, K)).precos["CAMBARA|1x2|BRUTO"], 6.5);
});

test("venda da calculadora guarda CMV e itens no próprio lançamento", () => {
  const v = validarLancamento(lanc("v1", { value: 90, cmv: 61.92, tabelaTotal: 99, variacao: -9, motivo: "Cliente antigo",
    itens: [{ itemId: "CAMBARA|1x2", custoTotal: 61.92, precoTabela: 5.5, tabelaTotal: 99, vendaTotal: 90, variacaoPct: -9.09, motivo: "Cliente antigo", hack: 1 }] }));
  assert.equal(v.tabelaTotal, 99);
  assert.equal(v.variacao, -9);
  assert.equal(v.motivo, "Cliente antigo");
  assert.equal(v.itens[0].precoTabela, 5.5);
  assert.equal(v.itens[0].variacaoPct, -9.09);
  assert.equal(v.cmv, 61.92);
  assert.equal(v.origem, "calculadora");
  assert.equal(v.itens[0].custoTotal, 61.92);
  assert.equal(v.itens[0].hack, undefined);
  assert.equal(validarLancamento(lanc("v2")).cmv, undefined);
  assert.throws(() => validarLancamento(lanc("v3", { cmv: -1 })), { status: 400 });
});

import { lerArquivoBackup, resumirLancamentos, compararResumos } from "../lib/resumo.js";
import { hostDe, gravacaoBloqueada, bancoHost } from "../api/_lib.js";

test("importar num banco vazio: ativa o salvamento seguro, traz o acumulado e os totais batem", async () => {
  const kv = kvFalso({});
  const arquivo = { financeItems: ANTIGOS.slice(0, 2), acumulado: ACUMULADO };
  const r = await importar(kv, K, arquivo);
  assert.equal(r.migrou, true);
  assert.equal(r.acumuladoImportado, true);
  assert.equal(r.adicionados, 2);
  const banco = await lerTudo(kv, K);
  const doArquivo = lerArquivoBackup(arquivo);
  const cmp = compararResumos(resumirLancamentos(doArquivo.lista, doArquivo.acumulado), resumirLancamentos(banco.financeItems, banco.acumulado));
  assert.equal(cmp.diferencas, 0);
});

test("importar não substitui um acumulado que já existe", async () => {
  const kv = sistemaAntigo();
  const r = await importar(kv, K, { financeItems: [], acumulado: { ...ACUMULADO, venda: 1 } });
  assert.equal(r.acumuladoImportado, false);
  assert.equal((await kv.get(K.acumulado)).venda, 48866);
});

test("conferência: restaurar arquivo antigo + migrar dá zero diferenças; diferença é apontada", async () => {
  const kv = kvFalso({});
  const arquivo = { financeItems: ANTIGOS, acumulado: ACUMULADO };
  await restaurar(kv, K, arquivo);
  await migrar(kv, K);
  const banco = await lerTudo(kv, K);
  const a = lerArquivoBackup(arquivo);
  const resA = resumirLancamentos(a.lista, a.acumulado);
  assert.equal(compararResumos(resA, resumirLancamentos(banco.financeItems, banco.acumulado)).diferencas, 0);
  assert.equal(resA.quantidade, 3); // o id repetido não some
  const outro = resumirLancamentos(banco.financeItems.slice(1), banco.acumulado);
  assert.ok(compararResumos(resA, outro).diferencas > 0);
});

test("resumo soma em centavos (sem erro de arredondamento)", () => {
  const lista = Array.from({ length: 10 }, (_, i) => ({ id: String(i), category: "venda", value: 0.1, date: "2026-09-01" }));
  assert.equal(resumirLancamentos(lista, null).porMes[0].venda, 1);
});

test("trava: recusa gravar quando o banco em uso é o da produção", () => {
  const antes = { ...process.env };
  try {
    process.env.UPSTASH_REDIS_REST_URL = "https://teste-123.upstash.io";
    delete process.env.KV_REST_API_URL;
    process.env.BANCO_PRODUCAO_HOST = "canary-chair.upstash.io";
    assert.equal(bancoHost(), "teste-123.upstash.io");
    assert.equal(gravacaoBloqueada(), false);
    process.env.BANCO_PRODUCAO_HOST = "https://TESTE-123.upstash.io/";
    assert.equal(gravacaoBloqueada(), true);
    process.env.KV_REST_API_URL = "https://outro.upstash.io";
    assert.throws(() => bancoHost(), /duas configurações/);
  } finally {
    for (const k of ["UPSTASH_REDIS_REST_URL", "KV_REST_API_URL", "BANCO_PRODUCAO_HOST"]) {
      if (antes[k] === undefined) delete process.env[k]; else process.env[k] = antes[k];
    }
  }
  assert.equal(hostDe("abc.upstash.io"), "abc.upstash.io");
});
