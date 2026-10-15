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
    async hmget(k, ...fs) { const h = dados.get(k) || {}; const r = {}; let algum = false; for (const f of fs) { r[f] = f in h ? clone(h[f]) : null; if (f in h) algum = true; } return algum ? r : null; },
    async incr(k) { const v = Number(dados.get(k) || 0) + 1; dados.set(k, v); return v; },
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

test("importar em lotes: continua de onde parou, sem duplicar, e a soma final bate", async () => {
  const kv = kvFalso({});
  const lista = Array.from({ length: 742 }, (_, i) => lanc(`L${i}`, { value: 1 + (i % 7), date: `2026-${String(8 + (i % 3)).padStart(2, "0")}-10` }));
  // Primeira tentativa "para" depois de 2 lotes de 100
  for (let i = 0; i < 200; i += 100) await importar(kv, K, { financeItems: lista.slice(i, i + 100) });
  assert.equal((await lerTudo(kv, K)).financeItems.length, 200);
  // Segunda tentativa: arquivo inteiro de novo, em lotes
  let adicionados = 0, existentes = 0;
  for (let i = 0; i < lista.length; i += 100) {
    const r = await importar(kv, K, { financeItems: lista.slice(i, i + 100) });
    adicionados += r.adicionados; existentes += r.existentes;
  }
  assert.equal(adicionados, 542);
  assert.equal(existentes, 200);
  const banco = await lerTudo(kv, K);
  assert.equal(banco.financeItems.length, 742);
  const a = resumirLancamentos(lista, null), b = resumirLancamentos(banco.financeItems, null);
  assert.equal(compararResumos(a, b).diferencas, 0);
});

test("importar: id repetido dentro do lote conta uma vez; lote grande demais é recusado", async () => {
  const kv = kvFalso({});
  const r = await importar(kv, K, { financeItems: [lanc("x"), lanc("x", { value: 99 })] });
  assert.equal(r.adicionados, 1);
  assert.equal(r.existentes, 1);
  assert.equal((await kv.hget(K.lancamentos, "x")).value, 10);
  await assert.rejects(importar(kv, K, { financeItems: Array.from({ length: 501 }, (_, i) => lanc(`y${i}`)) }), /no máximo 500/);
});

import { validarLancamentoV2, migrarV2, reclassificar, salvarConfigFinanceiro } from "../api/_dados.js";

const v2venda = (id, extra = {}) => ({ id, v: 2, conta: "venda_produtos", value: 100, competencia: "2026-10-01", pagamentos: [{ forma: "pix_bradesco", valor: 100 }], ...extra });
const v2saida = (id, extra = {}) => ({ id, v: 2, conta: "energia", value: 50, competencia: "2026-10-01", pagoCom: "picpay", ...extra });

test("v2: venda com várias formas precisa somar o total; tPag e conta vêm da config", () => {
  const ok = validarLancamentoV2(v2venda("a", { value: 300, nfe: "123", pagamentos: [{ forma: "dinheiro", valor: 100 }, { forma: "pix_picpay", valor: 200 }] }), {});
  assert.deepEqual(ok.pagamentos.map((p) => [p.forma, p.conta, p.tPag]), [["dinheiro", "gaveta", "01"], ["pix_picpay", "picpay", "17"]]);
  assert.equal(ok.nfe, "123");
  assert.equal(ok.category, "venda");
  assert.equal(ok.method, "dinheiro");
  assert.throws(() => validarLancamentoV2(v2venda("b", { value: 300, pagamentos: [{ forma: "dinheiro", valor: 100 }] }), {}), /soma das formas/);
  assert.throws(() => validarLancamentoV2(v2venda("c", { pagamentos: [{ forma: "nao_informada", valor: 100 }] }), {}), /Forma de pagamento inválida/);
  const parc = validarLancamentoV2(v2venda("d", { pagamentos: [{ forma: "credito_parcelado", valor: 100, parcelas: 3 }] }), {});
  assert.equal(parc.pagamentos[0].parcelas, 3);
  assert.throws(() => validarLancamentoV2(v2venda("e", { pagamentos: [{ forma: "credito_parcelado", valor: 100 }] }), {}), /parcelas/);
  const ch = validarLancamentoV2(v2venda("f", { pagamentos: [{ forma: "cheque", valor: 100, cheque: { numero: "9", emissor: "Ana", banco: "BB", compensacao: "2026-11-01" } }] }), {});
  assert.equal(ch.pagamentos[0].conta, "cheques_carteira");
  assert.equal(ch.checkDate, "2026-11-01");
});

test("v2: saída exige 'Pago com'; cheque emitido com conta escolhida (padrão Bradesco)", () => {
  assert.throws(() => validarLancamentoV2(v2saida("a", { pagoCom: undefined }), {}), /Pago com/);
  const ch = validarLancamentoV2(v2saida("b", { conta: "compra_material", pagoCom: "cheque_emitido", chequeEmitido: { numero: "55", favorecido: "Serraria", compensacao: "2026-11-10" } }), {});
  assert.equal(ch.chequeEmitido.conta, "bradesco");
  assert.equal(ch.category, "custo");
  const pic = validarLancamentoV2(v2saida("c", { pagoCom: "cheque_emitido", chequeEmitido: { conta: "picpay" } }), {});
  assert.equal(pic.chequeEmitido.conta, "picpay");
  assert.equal(validarLancamentoV2(v2saida("d"), {}).method, "bradesco");
  const tr = validarLancamentoV2({ id: "t", v: 2, conta: "transferencia", de: "picpay", para: "bradesco", value: 500, competencia: "2026-10-02" }, {});
  assert.equal(tr.type, "transfer");
  assert.throws(() => validarLancamentoV2({ id: "t2", v: 2, conta: "transferencia", de: "picpay", para: "picpay", value: 5, competencia: "2026-10-02" }, {}), /duas contas/);
  assert.throws(() => validarLancamentoV2(v2saida("x", { conta: "nao_existe" }), {}), /Conta inválida/);
});

test("migração v2: converte, cria abertura, é idempotente e a conferência continua batendo", async () => {
  const kv = sistemaAntigo();
  const arquivo = await montarBackup(kv, K);
  await assert.rejects(migrarV2(kv, K), { status: 409 }); // precisa do salvamento seguro antes
  await migrar(kv, K);
  const r = await migrarV2(kv, K);
  assert.equal(r.convertidos, 3);
  assert.equal(r.abertura, 7);
  assert.equal((await migrarV2(kv, K)).jaMigrado, true);
  const banco = await lerTudo(kv, K);
  assert.equal(banco.migradoV2, true);
  assert.ok(banco.financeItems.every((i) => i.v === 2));
  const a = lerArquivoBackup(arquivo);
  const cmp = compararResumos(resumirLancamentos(a.lista, a.acumulado), resumirLancamentos(banco.financeItems, banco.acumulado));
  assert.equal(cmp.diferencas, 0);
  assert.ok(cmp.linhas.some((l) => l.grupo === "Abertura × acumulado" && l.rotulo === "Vendas" && l.banco === 48866));
  assert.ok((await listarCopias(kv, K)).some((c) => c.includes("antes-da-migracao-v2")));
});

test("reclassificar em lote: conta, sugestão, forma; entrada e saída não se trocam", async () => {
  const kv = kvFalso({ [K.finance]: [
    { id: "7V", category: "venda", type: "income", value: 100, date: "2026-09-01", method: "pix" },
    { id: "7C", category: "custo", type: "expense", value: 60, date: "2026-09-01", method: "cheque", description: "Custo Extraído: X" },
    { id: "8", category: "despesa", type: "expense", value: 30, date: "2026-09-01", method: "bradesco" },
  ] });
  await migrar(kv, K);
  await assert.rejects(reclassificar(kv, K, { ids: ["8"], conta: "energia" }), { status: 409 });
  await migrarV2(kv, K);
  assert.equal((await reclassificar(kv, K, { ids: ["7C"], aceitarSugestao: true })).alterados, 1);
  const c = await kv.hget(K.lancamentos, "7C");
  assert.equal(c.conta, "cmv");
  assert.equal(c.contaOriginal, "classificar_custo");
  assert.equal(c.classificar, undefined);
  const r = await reclassificar(kv, K, { ids: ["8", "7V"], conta: "energia" });
  assert.equal(r.alterados, 1);
  assert.deepEqual(r.ignorados, [{ id: "7V", motivo: "entrada e saída não se trocam" }]);
  await reclassificar(kv, K, { ids: ["7V"], forma: "pix_picpay" });
  const v = await kv.hget(K.lancamentos, "7V");
  assert.deepEqual([v.pagamentos[0].forma, v.pagamentos[0].conta, v.pagamentos[0].tPag, v.formaOriginal], ["pix_picpay", "picpay", "17", "pix_bradesco"]);
});

test("config financeira: valida taxas, prazos e tPag; guarda tudo", async () => {
  const kv = kvFalso({});
  const c = await salvarConfigFinanceiro(kv, K, { cartao: { debito: { taxaPct: 1.5 } }, formas: { pix_bradesco: { tPag: "17" } }, impostos: { estimarSimples: true, rbt12: 600000 } });
  assert.equal(c.cartao.debito.taxaPct, 1.5);
  assert.equal(c.cartao.credito.prazoDias, 30);
  assert.equal(c.formas.pix_bradesco.tPag, "17");
  assert.equal(c.impostos.rbt12, 600000);
  await assert.rejects(salvarConfigFinanceiro(kv, K, { cartao: { debito: { taxaPct: 150 } } }), /Percentual/);
  await assert.rejects(salvarConfigFinanceiro(kv, K, { formas: { dinheiro: { tPag: "1" } } }), /tPag/);
  assert.equal((await lerTudo(kv, K)).configFinanceiro.cartao.debito.taxaPct, 1.5);
});

import { salvarOrcamento, atualizarOrcamento, listarOrcamentos, salvarCliente } from "../api/_dados.js";

const novoOrc = (extra = {}) => ({
  cliente: { nome: "Carlos Souza", telefone: "(47) 99999-1234" }, origem: "whatsapp", obs: "", hoje: "2026-10-10",
  itens: [{ itemId: "PINUS|1x2x2.50", acabamento: "BRUTO", quantidade: 1, descricao: "Pinus", unidade: "peça", precoTabela: 1500, tabelaTotal: 1500, precoUnitario: 1650, vendaTotal: 1650, custoTotal: 2.97, variacaoPct: 10 }],
  total: 1650, custo: 2.97, margem: 0.998, tabelaTotal: 1500, variacao: 150, ...extra,
});

test("orçamento: número sequencial, validade, cliente cadastrado pelo telefone", async () => {
  const kv = kvFalso({});
  const a = await salvarOrcamento(kv, K, novoOrc(), {});
  const b = await salvarOrcamento(kv, K, novoOrc({ cliente: { nome: "Carlos S.", telefone: "47999991234" } }), {});
  assert.equal(a.id, "ORC-0001");
  assert.equal(b.id, "ORC-0002");
  assert.equal(a.validoAte, "2026-10-17");
  assert.equal(a.status, "aberto");
  const { clientes, orcamentos } = await listarOrcamentos(kv, K);
  assert.equal(clientes.length, 1); // mesmo telefone = mesmo cliente
  assert.equal(clientes[0].nome, "Carlos S.");
  assert.equal(clientes[0].telefone, "(47) 99999-1234");
  assert.equal(orcamentos.length, 2);
  await assert.rejects(salvarOrcamento(kv, K, novoOrc({ cliente: { nome: "X", telefone: "9999-1234" } }), {}), /DDD/);
  await assert.rejects(salvarOrcamento(kv, K, novoOrc({ origem: "email" }), {}), /origem/);
  const c = await salvarOrcamento(kv, K, novoOrc({ validadeDias: 3 }), { orcamentos: { validadeDias: 7 } });
  assert.equal(c.validoAte, "2026-10-13");
});

test("orçamento: contato não muda a situação (continua em aberto); perdido pede motivo; editar mantém o número", async () => {
  const kv = kvFalso({});
  const o = await salvarOrcamento(kv, K, novoOrc(), {});
  const c = await atualizarOrcamento(kv, K, { id: o.id, acao: "contato", tipo: "cobrar" });
  assert.equal(c.status, "aberto");
  await assert.rejects(atualizarOrcamento(kv, K, { id: o.id, acao: "status", status: "aguardando" }), /Ação inválida/);
  assert.ok(c.ultimoContato);
  assert.equal(c.contatos[0].tipo, "cobrar");
  await assert.rejects(atualizarOrcamento(kv, K, { id: o.id, acao: "perdido", motivo: "qualquer" }), /motivo/);
  const p = await atualizarOrcamento(kv, K, { id: o.id, acao: "perdido", motivo: "Preço" });
  assert.equal(p.motivoPerda, "Preço");
  const r = await atualizarOrcamento(kv, K, { id: o.id, acao: "reabrir" });
  assert.equal(r.status, "aberto");
  const e = await salvarOrcamento(kv, K, novoOrc({ id: o.id, total: 1700, itens: [{ ...novoOrc().itens[0], vendaTotal: 1700 }], hoje: "2026-10-12" }), {});
  assert.equal(e.id, "ORC-0001");
  assert.equal(e.total, 1700);
  assert.equal(e.validoAte, "2026-10-19");
});

test("orçamento: converter em venda fecha com vínculo; fechado não edita; atualizar preços renova a validade", async () => {
  const kv = kvFalso({});
  const o = await salvarOrcamento(kv, K, novoOrc(), {});
  const pr = await atualizarOrcamento(kv, K, { id: o.id, acao: "precos", ...novoOrc({ total: 1760, itens: [{ ...novoOrc().itens[0], vendaTotal: 1760 }] }), hoje: "2026-10-20" });
  assert.equal(pr.total, 1760);
  assert.equal(pr.validoAte, "2026-10-27");
  const f = await atualizarOrcamento(kv, K, { id: o.id, acao: "fechar", vendaId: "1760V", hoje: "2026-10-21" });
  assert.equal(f.status, "fechado");
  assert.equal(f.vendaId, "1760V");
  assert.equal(f.fechadoEm, "2026-10-21");
  await assert.rejects(salvarOrcamento(kv, K, novoOrc({ id: o.id }), {}), /Duplicar/);
  const venda = validarLancamentoV2({ id: "1760V", v: 2, conta: "venda_produtos", value: 1760, competencia: "2026-10-21", pagamentos: [{ forma: "dinheiro", valor: 1760 }], orcamento: "ORC-0001" }, {});
  assert.equal(venda.orcamento, "ORC-0001");
});

test("orçamento: excluir vai para a lixeira e restaura; convertido não pode ser excluído", async () => {
  const kv = kvFalso({});
  const o = await salvarOrcamento(kv, K, novoOrc(), {});
  const x = await atualizarOrcamento(kv, K, { id: o.id, acao: "excluir" });
  assert.ok(x.excluidoEm);
  assert.equal(x.status, "aberto"); // situação não muda: só sai da lista
  assert.equal((await listarOrcamentos(kv, K)).orcamentos.length, 1); // continua guardado
  await assert.rejects(atualizarOrcamento(kv, K, { id: o.id, acao: "contato" }), /lixeira/);
  await assert.rejects(salvarOrcamento(kv, K, novoOrc({ id: o.id }), {}), /lixeira/);
  const r = await atualizarOrcamento(kv, K, { id: o.id, acao: "restaurar" });
  assert.equal(r.excluidoEm, undefined);
  await assert.rejects(atualizarOrcamento(kv, K, { id: o.id, acao: "restaurar" }), /não está na lixeira/);
  await atualizarOrcamento(kv, K, { id: o.id, acao: "fechar", vendaId: "1760V", hoje: "2026-10-21" });
  await assert.rejects(atualizarOrcamento(kv, K, { id: o.id, acao: "excluir" }), /convertido em venda não pode ser excluído/);
});

test("orçamento: reabrir fechado só se a venda foi estornada; perdido reabre", async () => {
  const kv = kvFalso({});
  const o = await salvarOrcamento(kv, K, novoOrc(), {});
  await atualizarOrcamento(kv, K, { id: o.id, acao: "fechar", vendaId: "1760V", hoje: "2026-10-21" });
  await kv.hset(K.lancamentos, { "1760V": { id: "1760V", v: 2, conta: "venda_produtos", value: 1650 } });
  await assert.rejects(atualizarOrcamento(kv, K, { id: o.id, acao: "reabrir" }), /estorne/);
  await kv.hset(K.lancamentos, { "1760V": { id: "1760V", v: 2, conta: "venda_produtos", value: 1650, excluido: true } });
  const r = await atualizarOrcamento(kv, K, { id: o.id, acao: "reabrir" });
  assert.equal(r.status, "aberto");
  assert.equal(r.vendaId, undefined);
  assert.equal(r.vendaIdAnterior, "1760V");
  // fechado sem venda vinculada (dado antigo) também reabre
  const o2 = await salvarOrcamento(kv, K, novoOrc(), {});
  await kv.hset(K.orcamentos, { [o2.id]: { ...o2, status: "fechado" } });
  assert.equal((await atualizarOrcamento(kv, K, { id: o2.id, acao: "reabrir" })).status, "aberto");
});

test("backup e restauração incluem orçamentos, clientes e o contador", async () => {
  const kv = kvFalso({});
  await salvarOrcamento(kv, K, novoOrc(), {});
  const b = await montarBackup(kv, K);
  assert.ok(b.chaves.madeireira_orcamentos["ORC-0001"]);
  await salvarOrcamento(kv, K, novoOrc(), {});
  await restaurar(kv, K, b);
  const { orcamentos } = await listarOrcamentos(kv, K);
  assert.equal(orcamentos.length, 1);
  assert.equal((await salvarOrcamento(kv, K, novoOrc(), {})).id, "ORC-0002"); // contador voltou junto
  const cli = await salvarCliente(kv, K, { nome: "Ana", telefone: "48 3222-1111", obs: "paga em cheque" });
  assert.equal(cli.obs, "paga em cheque");
});

import { salvarAbertura, registrarConferencia, atualizarCheque } from "../api/_dados.js";

test("abertura de saldos guarda as anteriores; conferência registra a diferença", async () => {
  const kv = kvFalso({});
  await salvarAbertura(kv, K, { data: "2026-11-01", contas: { gaveta: 300, bradesco: 5000.5, picpay: 120, cheques_carteira: 800 } });
  const s2 = await salvarAbertura(kv, K, { data: "2026-11-02", contas: { gaveta: 310 } });
  assert.equal(s2.abertura.data, "2026-11-02");
  assert.equal(s2.aberturasAnteriores[0].contas.bradesco, 5000.5);
  await assert.rejects(salvarAbertura(kv, K, { data: "x" }), /data/);
  const c = await registrarConferencia(kv, K, { data: "2026-11-05", conta: "gaveta", informado: 295.5, calculado: 310 });
  assert.equal(c.diferenca, -14.5);
  assert.equal((await lerTudo(kv, K)).saldos.conferencias.length, 1);
  assert.ok((await montarBackup(kv, K)).chaves.madeireira_saldos.abertura);
});

test("cheque recebido: devolvido, desfazer e conta de depósito; cheque emitido: nova compensação", async () => {
  const kv = kvFalso({ [K.migrado]: { em: "x" } });
  await salvarLancamentos(kv, K, [
    { id: "v1", v: 2, conta: "venda_produtos", value: 500, competencia: "2026-11-02", pagamentos: [{ forma: "cheque", valor: 500, cheque: { numero: "12", compensacao: "2026-11-20" } }] },
    { id: "s1", v: 2, conta: "compra_material", value: 900, competencia: "2026-11-02", pagoCom: "cheque_emitido", chequeEmitido: { numero: "77", compensacao: "2026-11-25" } },
  ]);
  let l = await atualizarCheque(kv, K, { id: "v1", tipo: "recebido", pagamento: 0, devolvidoEm: "2026-11-21", contaDeposito: "picpay" });
  assert.deepEqual([l.pagamentos[0].cheque.devolvidoEm, l.pagamentos[0].cheque.contaDeposito], ["2026-11-21", "picpay"]);
  l = await atualizarCheque(kv, K, { id: "v1", tipo: "recebido", pagamento: 0, devolvidoEm: null });
  assert.equal(l.pagamentos[0].cheque.devolvidoEm, undefined);
  l = await atualizarCheque(kv, K, { id: "s1", tipo: "emitido", compensacao: "2026-12-01" });
  assert.equal(l.chequeEmitido.compensacao, "2026-12-01");
  assert.equal(l.historicoCheque.length, 1);
  await assert.rejects(atualizarCheque(kv, K, { id: "s1", tipo: "recebido", pagamento: 0 }), /não é um cheque/);
});
