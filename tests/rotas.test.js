import test from "node:test";
import assert from "node:assert/strict";
import { ROTAS } from "../api/_rotas.js";
import handler from "../api/[recurso].js";

function resposta() {
  const r = { statusCode: 200, corpo: null, headers: {} };
  r.status = (s) => { r.statusCode = s; return r; };
  r.json = (o) => { r.corpo = o; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  return r;
}

test("roteador único: as 12 rotas de antes continuam com o mesmo nome (+ clientes, da 2C)", () => {
  assert.deepEqual(Object.keys(ROTAS).sort(), ["acumulado", "backup", "catalogo", "clientes", "config", "getFinance", "importar", "lancamento", "migrar", "orcamentos", "precos", "restaurar", "resumo", "zerar"]);
});

test("roteador único: rota inexistente dá 404; nomes do protótipo não viram rota", async () => {
  for (const nome of ["naoexiste", "toString", "__proto__", "constructor", ""]) {
    const res = resposta();
    await handler({ query: { recurso: nome }, headers: {}, method: "GET" }, res);
    assert.equal(res.statusCode, 404, nome);
  }
});

test("roteador único: entrega para a rota, pede senha e tira o parâmetro do caminho", async () => {
  const antes = { ...process.env };
  Object.assign(process.env, { SENHA_APP: "certa", KV_REST_API_URL: "http://127.0.0.1:1", KV_REST_API_TOKEN: "t" });
  try {
    const req = { query: { recurso: "getFinance", id: "1" }, headers: {}, method: "GET" };
    const res = resposta();
    await handler(req, res);
    assert.equal(res.statusCode, 401);
    assert.deepEqual(req.query, { id: "1" });
    const res2 = resposta();
    await handler({ query: { recurso: "acumulado" }, headers: { "x-senha": "certa" }, method: "GET" }, res2);
    assert.equal(res2.statusCode, 405, "método não aceito continua 405");
  } finally {
    process.env = antes;
  }
});

test("zerar: a rota recusa sem PERMITIR_ZERAR e sem trava de produção", async () => {
  const antes = { ...process.env };
  Object.assign(process.env, { SENHA_APP: "certa", KV_REST_API_URL: "http://127.0.0.1:1", KV_REST_API_TOKEN: "t" });
  delete process.env.PERMITIR_ZERAR;
  delete process.env.BANCO_PRODUCAO_HOST;
  try {
    const { statusBanco } = await import("../api/_lib.js");
    assert.equal(statusBanco().zerarPermitido, false);
    process.env.PERMITIR_ZERAR = "sim";
    assert.equal(statusBanco().zerarPermitido, false, "sem trava não zera");
    process.env.BANCO_PRODUCAO_HOST = "https://127.0.0.1:1";
    assert.equal(statusBanco().zerarPermitido, false, "banco de produção: nunca zera");
    process.env.BANCO_PRODUCAO_HOST = "https://outro-banco.upstash.io";
    assert.equal(statusBanco().zerarPermitido, true);
    delete process.env.PERMITIR_ZERAR;
    const res = resposta();
    await handler({ query: { recurso: "zerar" }, headers: { "x-senha": "certa" }, method: "POST", body: { confirmacao: "ZERAR" } }, res);
    assert.equal(res.statusCode, 403);
  } finally {
    process.env = antes;
  }
});
