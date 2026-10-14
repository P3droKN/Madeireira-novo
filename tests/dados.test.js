import { test } from "node:test";
import assert from "node:assert/strict";
import { chaves, senhaConfere } from "../api/_lib.js";
import {
  lerTudo, migrar, salvarLancamentos, excluirLancamento, importar, restaurar,
  montarBackup, salvarAcumulado, listarCopias, validarLancamento,
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
  assert.deepEqual(r, { adicionados: 1, existentes: 1, invalidos: 1 });
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
