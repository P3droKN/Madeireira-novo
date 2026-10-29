import { test } from "node:test";
import assert from "node:assert/strict";
import { linhasImpressas, documentoDaVenda, documentoDoOrcamento, folhaHtml, nomeForma, lojaDaConfig } from "../lib/impressao.js";

const loja = lojaDaConfig({ impressao: { nome: "Madeireira Teste", telefone: "(47) 0000-0000", endereco: "Rua A, 1", cnpj: "" } });
// pedido com −3% (preço final com centavos quebrados) e um item de valor livre
const itens = [
  { descricao: "Pinus 2x4 × 3,00 m", acabamento: "BRUTO", quantidadeCobrada: 10, unidade: "peça", vendaTotal: 242.5, custoTotal: 183.6, precoTabela: 25, tabelaTotal: 250, variacaoPct: -3, motivo: "Cliente antigo" },
  { descricao: "Cedro Mesclado 1x2", acabamento: "CEPILHADO", quantidade: 6, comprimento: 2.5, quantidadeCobrada: 15, unidade: "m", vendaTotal: 128.04, custoTotal: 54.3, precoTabela: 8.8, variacaoPct: -3 },
  { descricao: "Forro", acabamento: "UNICO", quantidadeCobrada: 12.5, unidade: "m²", vendaTotal: 423.16, custoTotal: 300 },
  { descricao: "Retalho - sobra de obra", acabamento: "UNICO", quantidadeCobrada: 1, unidade: "un", vendaTotal: 20 },
];
const venda = { id: "V1", numero: "V-0012", conta: "venda_produtos", competencia: "2026-10-25", criadoEm: "2026-10-25T17:32:00Z", value: 853.7, frete: 40, cliente: "João", clienteId: "C1", contaCorrente: true,
  itens, cmv: 537.9, tabelaTotal: 900, motivo: "Selecionada", orcamento: "ORC-0005",
  pagamentos: [{ forma: "pix_bradesco", valor: 300 }, { forma: "credito_parcelado", valor: 400, parcelas: 3 }, { forma: "fiado", valor: 153.7, fiado: { contaCorrente: true } }] };

test("linhas impressas: unitário final com 2 casas e a soma fecha com o total (centavos na última linha)", () => {
  const l = linhasImpressas(itens, 813.7);
  assert.deepEqual(l.map((x) => x.unitario), [24.25, 8.54, 33.85, null]);
  assert.equal(l.reduce((s, x) => s + Math.round(x.total * 100), 0), 81370);
  assert.equal(l[1].quantidade, "6 pç × 2,50 m = 15,00 m");
  assert.equal(l[0].quantidade, "10 peças");
  assert.equal(l[2].quantidade, "12,50 m²");
  assert.deepEqual([l[0].acabamento, l[1].acabamento, l[2].acabamento], ["Bruto", "Cepilhado", ""]);
  // 10 × 24,25 + 15 × 8,54 + 12,5 × 33,85 + 20 = 813,73: os 3 centavos a mais saem da última linha
  assert.deepEqual(l.map((x) => x.total), [242.5, 128.1, 423.13, 19.97]);
});

test("pedido: número, data e hora, cliente, forma de pagamento simples, ref. do orçamento e assinaturas", () => {
  const d = documentoDaVenda(venda);
  assert.equal(d.numero, "V-0012");
  assert.equal(d.hora, "14:32");
  assert.deepEqual(d.pagamentos.map((p) => p.texto), ["PIX", "Crédito em 3 vezes", "A prazo"]);
  const html = folhaHtml(d, loja, { modo: "duas" });
  assert.match(html, /PEDIDO Nº V-0012/);
  assert.match(html, /VIA DA LOJA[\s\S]*Assinatura do cliente[\s\S]*VIA DO CLIENTE[\s\S]*Assinatura da loja/);
  assert.match(html, /Ref\. orçamento ORC-0005/);
  assert.match(html, /✂/);
  assert.match(html, /Madeireira Teste/);
  assert.equal(documentoDaVenda({ ...venda, cliente: "" }).cliente.nome, "Consumidor");
  assert.equal(nomeForma({ forma: "debito" }), "Cartão de débito");
});

test("nunca aparece controle interno: custo, margem, tabela, %, motivo, conta corrente", () => {
  const texto = folhaHtml(documentoDaVenda(venda), loja).replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ");
  for (const proibido of [/custo/i, /margem/i, /tabela/i, /%/, /cliente antigo/i, /selecionada/i, /conta corrente/i, /183/, /537/]) assert.doesNotMatch(texto, proibido, String(proibido));
});

test("1 via: só a da loja ou só a do cliente; reimpressão marcada; estornada marcada", () => {
  const d = documentoDaVenda(venda);
  const loja1 = folhaHtml(d, loja, { modo: "loja" });
  assert.match(loja1, /VIA DA LOJA/);
  assert.doesNotMatch(loja1, /VIA DO CLIENTE|✂/);
  assert.match(folhaHtml(d, loja, { modo: "cliente" }), /VIA DO CLIENTE/);
  assert.match(folhaHtml(documentoDaVenda({ ...venda, impressoEm: "2026-10-25T18:00:00Z" }, { agora: "2026-10-28T12:00:00Z" }), loja), /2ª impressão em 28\/10\/2026/);
  assert.doesNotMatch(folhaHtml(d, loja), /2ª impressão/);
  assert.match(folhaHtml(documentoDaVenda({ ...venda, excluido: true }), loja), /VENDA ESTORNADA/);
});

test("orçamento: Válido até, rodapé de estoque, sem forma de pagamento e sem assinatura", () => {
  const o = { id: "ORC-0005", data: "2026-10-20", validoAte: "2026-10-27", cliente: { nome: "João", telefone: "(47) 99999-0000" }, itens: [{ descricao: "Pinus 2x4 × 3,00 m (bruto)", acabamento: "BRUTO", quantidadeTexto: "10 peças", quantidadeCobrada: 10, unidade: "peça", vendaTotal: 250 }], frete: 0, total: 250 };
  const html = folhaHtml(documentoDoOrcamento(o), loja);
  assert.match(html, /ORÇAMENTO Nº ORC-0005/);
  assert.match(html, /Válido até 27\/10\/2026/);
  assert.match(html, /Orçamento sujeito à disponibilidade de estoque\. Preços válidos até a data acima\./);
  assert.doesNotMatch(html, /Assinatura|Forma de pagamento/);
  assert.match(html, /<td>Pinus 2x4 × 3,00 m<\/td><td>Bruto<\/td>/); // o "(bruto)" vai para a coluna Acabamento
});

test("venda rápida sem itens: uma linha com a descrição", () => {
  const d = documentoDaVenda({ id: "X", numero: "V-0003", competencia: "2026-10-25", value: 1000, description: "Venda: balcão", pagamentos: [{ forma: "dinheiro", valor: 1000 }] });
  assert.deepEqual(d.linhas, [{ descricao: "balcão", acabamento: "", quantidade: "", unitario: null, total: 1000 }]);
});
