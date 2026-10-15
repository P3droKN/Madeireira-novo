import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  normalizarTelefone, linkWhatsApp, preencherModelo, textoParaCliente, situacao, indicadores, ordenar,
  atualizarPrecos, numeroOrcamento, somarDias, CONFIG_ORCAMENTOS_PADRAO,
} from "../lib/orcamentos.js";
import { montarCatalogo } from "../lib/catalogo.js";

const custos = JSON.parse(readFileSync(new URL("../data/custos.json", import.meta.url), "utf8"));
const cat = montarCatalogo(custos);

const orc = (extra = {}) => ({
  id: "ORC-0007", numero: 7, data: "2026-10-10", validoAte: "2026-10-17", status: "aberto", origem: "whatsapp", total: 1650,
  cliente: { nome: "Carlos Souza", telefone: "47999991234" },
  itens: [{ itemId: "PINUS|1x2x2.50", acabamento: "BRUTO", quantidade: 1, descricao: "Pinus 1x2 × 2,50 m", quantidadeTexto: "1 peça", unidade: "peça", precoTabela: 1500, tabelaTotal: 1500, precoUnitario: 1650, vendaTotal: 1650, custoTotal: 2.97, variacaoPct: 10 }],
  ...extra,
});

test("número sequencial ORC-0001", () => {
  assert.equal(numeroOrcamento(1), "ORC-0001");
  assert.equal(numeroOrcamento(123), "ORC-0123");
});

test("WhatsApp com DDD: aceita formatos comuns e recusa inválidos", () => {
  assert.equal(normalizarTelefone("(47) 99999-1234").digitos, "47999991234");
  assert.equal(normalizarTelefone("+55 47 99999-1234").digitos, "47999991234");
  assert.equal(normalizarTelefone("4733334444").formatado, "(47) 3333-4444");
  assert.equal(normalizarTelefone("99999-1234").ok, false); // sem DDD
  assert.equal(normalizarTelefone("(20) 99999-1234").ok, false); // DDD inexistente
  assert.equal(normalizarTelefone("47899991234").ok, false); // celular sem 9
});

test("cobrar: link wa.me com 55 + DDD + número e texto do modelo", () => {
  const texto = preencherModelo(CONFIG_ORCAMENTOS_PADRAO.modelos[0], orc(), "2026-10-13");
  assert.equal(texto, "Olá Carlos, tudo bem? Aqui é da Madeireira. Passando para saber se conseguiu ver o orçamento ORC-0007 de R$ 1.650,00. Qualquer dúvida estou à disposição!");
  const link = linkWhatsApp("(47) 99999-1234", texto);
  assert.ok(link.startsWith("https://wa.me/5547999991234?text="));
  assert.equal(decodeURIComponent(link.split("text=")[1]), texto);
  assert.equal(preencherModelo("{dias} dias, vale até {validade}", orc(), "2026-10-13"), "3 dias, vale até 17/10/2026");
});

test("enviar: texto para o cliente sem custo, margem nem tabela", () => {
  const t = textoParaCliente(orc());
  assert.ok(t.includes("*Orçamento ORC-0007 - 10/10/2026*"));
  assert.ok(t.includes("*Total: R$ 1.650,00*"));
  assert.ok(t.includes("Válido até 17/10/2026"));
  assert.ok(!/custo|margem|tabela/i.test(t));
});

test("validade: vencido fica vermelho; 3 dias sem contato fica amarelo; cobrar a partir de 2 dias", () => {
  assert.deepEqual(
    (({ vencido, cor, cobrarHoje, diasAberto }) => ({ vencido, cor, cobrarHoje, diasAberto }))(situacao(orc(), "2026-10-11")),
    { vencido: false, cor: null, cobrarHoje: false, diasAberto: 1 });
  assert.equal(situacao(orc(), "2026-10-12").cobrarHoje, true);
  assert.equal(situacao(orc(), "2026-10-13").cor, "amarelo");
  assert.equal(situacao(orc({ ultimoContato: "2026-10-12T15:00:00Z" }), "2026-10-13").cor, null);
  assert.equal(situacao(orc(), "2026-10-18").cor, "vermelho");
  assert.equal(situacao(orc(), "2026-10-18").vencido, true);
  assert.equal(situacao(orc({ status: "fechado" }), "2026-10-18").cor, null);
  assert.equal(somarDias("2026-10-28", 7), "2026-11-04");
});

test("atualizar preços: recalcula pela tabela atual mantendo o % e mostra a diferença", () => {
  const r = atualizarPrecos(orc(), (id) => cat.itens.get(id), () => 1600);
  assert.equal(r.itens[0].vendaTotal, 1760); // 1.600 + 10%
  assert.equal(r.diferenca, 110);
  assert.equal(r.totalNovo, 1760);
  const semTabela = atualizarPrecos(orc(), (id) => cat.itens.get(id), () => null);
  assert.equal(semTabela.diferenca, 0); // sem tabela: mantém o preço do orçamento
});

test("indicadores e ordem padrão", () => {
  const lista = [
    orc({ id: "ORC-0001", numero: 1, data: "2026-10-01", status: "fechado", fechadoEm: "2026-10-04", total: 100 }),
    orc({ id: "ORC-0002", numero: 2, data: "2026-10-02", status: "perdido", motivoPerda: "Preço", total: 200, origem: "balcao" }),
    orc({ id: "ORC-0003", numero: 3, data: "2026-10-05", status: "aberto", total: 300 }),
    orc({ id: "ORC-0004", numero: 4, data: "2026-10-03", status: "aguardando", total: 50, origem: "telefone" }),
  ];
  const i = indicadores(lista, "2026-10");
  assert.equal(i.valorAberto, 350);
  assert.equal(i.taxaConversaoMes, 0.25);
  assert.equal(i.tempoMedioFechar, 3);
  assert.deepEqual(i.motivosPerda, { "Preço": 1 });
  assert.deepEqual(i.porOrigem, { whatsapp: 2, balcao: 1, telefone: 1 });
  assert.deepEqual(ordenar(lista, "padrao").map((o) => o.numero), [4, 3, 2, 1]);
  assert.deepEqual(ordenar(lista, "valor").map((o) => o.numero), [3, 2, 1, 4]);
});
