import { test } from "node:test";
import assert from "node:assert/strict";
import { dataSP } from "../lib/datas.js";
import { situacao } from "../lib/orcamentos.js";
import { documentoDaVenda } from "../lib/impressao.js";

test("datas em Brasília: 22h50 de 17/10 é 17/10 (o servidor roda em UTC, onde já é 18/10)", () => {
  assert.equal(dataSP("2026-10-18T01:50:00Z"), "2026-10-17");
  assert.equal(dataSP("2026-10-18T03:00:00Z"), "2026-10-18");
  assert.equal(dataSP("2026-11-01T02:30:00Z"), "2026-10-31"); // virada do mês no horário local
  assert.equal(dataSP("2026-10-17"), "2026-10-17");
});

test("orçamento: contato às 22h conta no dia dele (o 🔔 não atrasa um dia)", () => {
  const orc = { id: "ORC-0001", data: "2026-10-10", validoAte: "2026-10-30", status: "aberto", ultimoContato: "2026-10-16T01:00:00Z" }; // 22h de 15/10
  assert.equal(situacao(orc, "2026-10-18", {}).diasSemContato, 3);
});

test("via: \"2ª impressão em DD/MM\" no dia de Brasília", () => {
  const d = documentoDaVenda({ id: "V1", numero: "V-0001", competencia: "2026-10-17", value: 10, impressoEm: "2026-10-17T12:00:00Z" }, { agora: "2026-10-18T01:50:00Z" });
  assert.equal(d.segundaImpressao, "2026-10-17");
});
