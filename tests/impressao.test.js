import { test } from "node:test";
import assert from "node:assert/strict";
import { linhasImpressas, documentoDaVenda, documentoDoOrcamento, folhaHtml, nomeForma, lojaDaConfig, faltaNaImpressao } from "../lib/impressao.js";
import { mesclarConfigFinanceiro } from "../lib/planoContas.js";

const loja = lojaDaConfig(mesclarConfigFinanceiro({}));
const semTags = (h) => h.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
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

test("pedido no modelo do cartão: cabeçalho da loja, campos do cliente, colunas, total geral, Pix e assinatura", () => {
  const d = documentoDaVenda(venda, { cadastro: { id: "C1", nome: "João", telefone: "(41) 99999-0000", fixo: "(41) 3333-0000", endereco: "Rua das Araucárias, 210", bairro: "Santa Felicidade", cidade: "Curitiba", uf: "PR", documento: "123.456.789-00", ie: "" } });
  assert.equal(d.numero, "V-0012");
  assert.deepEqual(d.pagamentos.map((p) => p.texto), ["PIX", "Crédito em 3 vezes", "A prazo"]);
  const html = folhaHtml(d, loja, { modo: "duas" });
  const t = semTags(html);
  assert.match(t, /MERCADO DA MADEIRA/);
  assert.match(t, /Avenida Vereador Toaldo Túlio, 968 - Santa Felicidade/);
  assert.match(t, /CEP 82320-010 - Curitiba - Paraná/);
  assert.match(t, /41 3273-4849/); assert.match(t, /41 99899-0191/); assert.match(t, /snicolodi45@gmail\.com/); assert.match(t, /Mercado da Madeira/);
  assert.match(t, /Pix CNPJ: 73\.871\.956\/0001-32 \| Nicolodi e Cia Ltda/);
  assert.match(t, /PEDIDO Nº V-0012/);
  for (const r of ["CLIENTE: João", "ENDEREÇO: Rua das Araucárias, 210", "DATA: 25/10/2026", "BAIRRO: Santa Felicidade", "CIDADE: Curitiba", "ESTADO: PR", "FONE: (41) 99999-0000 / (41) 3333-0000", "CNPJ/CPF: 123.456.789-00", "INSCR. EST.:"]) assert.ok(t.includes(r), r);
  assert.match(t, /Prod\. Quant\. Unid\. Descrição Cep\. Valor Unitário Total/);
  assert.match(t, /TOTAL GERAL R\$ 853,70/);
  assert.match(t, /\* Conferir a mercadoria no ato da entrega\./);
  assert.match(t, /\* Descarregamento somente ao lado do veículo da empresa\./);
  assert.match(t, /\* Não aceitamos devoluções de mercadorias\./);
  assert.equal((t.match(/ASSINATURA:/g) || []).length, 2, "assinatura nas duas vias");
  assert.match(t, /VIA DA LOJA[\s\S]*VIA DO CLIENTE/);
  assert.match(t, /Pagamento: PIX R\$ 300,00 · Crédito em 3 vezes R\$ 400,00 · A prazo R\$ 153,70 · Ref\. orçamento ORC-0005/);
  assert.match(html, /✂/);
  // a coluna Prod. fica em branco; Cep. com ✓ só no cepilhado
  assert.match(html, /<tr><td><\/td><td class="num">15<\/td><td class="centro">m<\/td><td class="pv-desc">Cedro Mesclado 1x2 \(6 pç de 2,50 m\)<\/td><td class="centro">✓<\/td>/);
  assert.match(html, /<tr><td><\/td><td class="num">10<\/td><td class="centro">pç<\/td><td class="pv-desc">Pinus 2x4 × 3,00 m<\/td><td class="centro"><\/td>/);
  // sem cliente: "Consumidor" e os campos em branco
  const c = documentoDaVenda({ ...venda, cliente: "" }).cliente;
  assert.equal(c.nome, "Consumidor");
  assert.equal(c.endereco, "");
  assert.equal(nomeForma({ forma: "debito" }), "Cartão de débito");
});

test("sem logo: nenhum quadro nem texto de exemplo; com logo: a imagem entra antes do nome", () => {
  const sem = folhaHtml(documentoDaVenda(venda), loja);
  assert.doesNotMatch(semTags(sem), /logo|mascote/i);
  assert.doesNotMatch(sem, /<img|pv-logo"/);
  assert.match(sem, /grid-template-columns:1fr auto auto/);
  const png = "data:image/png;base64,iVBORw0KGgo=";
  const com = folhaHtml(documentoDaVenda(venda), { ...loja, logo: png });
  assert.match(com, /grid-template-columns:auto 1fr auto auto/);
  assert.match(com, new RegExp(`<img class="pv-logo" src="${png.replace(/[+/.]/g, "\\$&")}"[^>]*>\\s*<div class="pv-marca">`));
  assert.doesNotMatch(semTags(com), /logo|mascote/i);
});

test("Ajustes › Impressão: o que falta para a via sair completa; formato antigo usa o modelo novo", () => {
  assert.deepEqual(faltaNaImpressao(loja), []);
  assert.deepEqual(faltaNaImpressao(lojaDaConfig({ impressao: { nome: "X", telefone: "", endereco: "", pix: "" } })), ["endereço", "telefone", "linha do Pix"]);
  // configuração salva no formato antigo (nome, telefone, endereço e CNPJ em branco): vale o padrão da loja
  assert.equal(lojaDaConfig(mesclarConfigFinanceiro({ impressao: { nome: "", telefone: "", endereco: "", cnpj: "" } })).nome, "MERCADO DA MADEIRA");
  // no formato novo, o que a pessoa apagou fica apagado
  assert.equal(lojaDaConfig(mesclarConfigFinanceiro({ impressao: { ...mesclarConfigFinanceiro({}).impressao, instagram: "" } })).instagram, "");
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

test("orçamento: ORÇAMENTO Nº, Válido até, aviso de estoque, sem pagamento e sem assinatura", () => {
  const o = { id: "ORC-0005", data: "2026-10-20", validoAte: "2026-10-27", cliente: { nome: "João", telefone: "(47) 99999-0000" }, itens: [{ descricao: "Pinus 2x4 × 3,00 m (bruto)", acabamento: "BRUTO", quantidadeTexto: "10 peças", quantidadeCobrada: 10, unidade: "peça", vendaTotal: 250 }], frete: 0, total: 250 };
  const html = folhaHtml(documentoDoOrcamento(o), loja);
  const t = semTags(html);
  assert.match(t, /ORÇAMENTO Nº ORC-0005/);
  assert.match(t, /VÁLIDO ATÉ: 27\/10\/2026/);
  assert.match(t, /Orçamento sujeito à disponibilidade de estoque\. Preços válidos até a data acima\./);
  assert.doesNotMatch(t, /ASSINATURA|Pagamento:|Conferir a mercadoria/);
  assert.match(html, /<td class="pv-desc">Pinus 2x4 × 3,00 m<\/td><td class="centro"><\/td>/); // o "(bruto)" sai da descrição
});

test("venda rápida sem itens: uma linha com a descrição", () => {
  const d = documentoDaVenda({ id: "X", numero: "V-0003", competencia: "2026-10-25", value: 1000, description: "Venda: balcão", pagamentos: [{ forma: "dinheiro", valor: 1000 }] });
  assert.deepEqual(d.linhas, [{ descricao: "balcão", acabamento: "", cep: false, quantidade: "", quant: "", unid: "", unitario: null, total: 1000 }]);
});
