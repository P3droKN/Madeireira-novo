// Relatórios: resumo do mês (a antiga tabela "Monitoramento detalhado para declaração")
// e vendas por forma de pagamento. Funções puras, sem tela.
import { FORMAS_PADRAO } from "./planoContas.js";
import { mesDe } from "./financeiro.js";

const centavos = (v) => Math.round((Number(v) || 0) * 100);
const reais = (c) => c / 100;

// Forma de pagamento antiga (method) -> linha do resumo
const LINHA_DO_METODO = { pix: "pix", bradesco: "pix", credito: "cred", debito: "deb" };
// Forma nova -> linha do resumo (PIX e transferência juntos, como era "PIX / Bradesco")
const LINHA_DA_FORMA = { pix_bradesco: "pix", pix_picpay: "pix", transferencia: "pix", credito: "cred", credito_parcelado: "cred", debito: "deb" };

const LINHAS = ["vendas", "pix", "cred", "deb", "custos", "despesas", "funcionarios"];
const zeros = () => Object.fromEntries(LINHAS.map((l) => [l, 0]));

/**
 * Resumo do mês até o dia escolhido, igual à tela antiga do Gestor de Caixa:
 * "dia" = lançado exatamente no dia; "acumulado" = dias anteriores do mesmo mês (+ o acumulado manual
 * de agosto/2026); "total" = os dois juntos. O resultado é vendas − custos − despesas (como era).
 * Lançamentos de abertura e transferências ficam de fora (a abertura de agosto é o próprio acumulado).
 * @param {object[]} itens lançamentos como vêm do banco (antigos e novos; os novos já trazem category/type)
 * @param {object} acumulado "Saldos passados"
 * @param {string} dia AAAA-MM-DD
 */
export function resumoDoMes(itens, acumulado, dia) {
  const mes = dia.slice(0, 7);
  const doDia = zeros(), antes = zeros();
  for (const item of itens) {
    if (!item || item.excluido || item.abertura || item.conta === "transferencia") continue;
    const data = item.date || item.competencia || "";
    if (!data.startsWith(mes) || data > dia) continue;
    const alvo = data === dia ? doDia : antes;
    const entrada = item.type === "income";
    const cat = item.category || (entrada ? "venda" : "despesa");
    const v = centavos(item.value);
    if (cat === "venda") {
      alvo.vendas += v;
      if (Array.isArray(item.pagamentos) && item.pagamentos.length) {
        for (const p of item.pagamentos) {
          const l = LINHA_DA_FORMA[p.forma];
          if (l) alvo[l] += centavos(p.valor);
        }
      } else {
        const l = LINHA_DO_METODO[item.method];
        if (l) alvo[l] += v;
      }
    } else if (cat === "custo") alvo.custos += v;
    else if (cat === "funcionario") alvo.funcionarios += v;
    else if (cat === "despesa") alvo.despesas += v;
  }
  // O acumulado manual era só de 01 a 23/08/2026: não entra nos outros meses
  if (mes === "2026-08" && acumulado) {
    const a = acumulado;
    antes.vendas += centavos(a.venda); antes.pix += centavos(a.pix); antes.cred += centavos(a.credito); antes.deb += centavos(a.debito);
    antes.custos += centavos(a.custo); antes.despesas += centavos(a.despesa); antes.funcionarios += centavos(a.func);
  }
  const total = Object.fromEntries(LINHAS.map((l) => [l, doDia[l] + antes[l]]));
  const resultado = (x) => x.vendas - x.custos - x.despesas;
  const emReais = (x) => ({ ...Object.fromEntries(LINHAS.map((l) => [l, reais(x[l])])), resultado: reais(resultado(x)) });
  return { mes, dia, doDia: emReais(doDia), acumulado: emReais(antes), total: emReais(total) };
}

/**
 * Vendas do mês (competência) por forma de pagamento, com código tPag e quantidade de vendas.
 * @param {object[]} lista lançamentos normalizados (normalizar)
 * @param {string} mes AAAA-MM
 * @param {object} cfg configuração financeira mesclada (para o tPag)
 */
export function vendasPorForma(lista, mes, cfg) {
  const porForma = {};
  let total = 0, vendas = 0;
  for (const l of lista) {
    if (l.conta !== "venda_produtos" && l.conta !== "frete_cobrado" && l.conta !== "servicos") continue;
    if (mesDe(l) !== mes) continue;
    vendas++;
    const pags = Array.isArray(l.pagamentos) && l.pagamentos.length ? l.pagamentos : [{ forma: "nao_informada", valor: l.value }];
    for (const p of pags) {
      const f = porForma[p.forma] || (porForma[p.forma] = { forma: p.forma, valor: 0, quantidade: 0 });
      f.valor += centavos(p.valor);
      f.quantidade++;
      total += centavos(p.valor);
    }
  }
  const ordem = FORMAS_PADRAO.map((f) => f.id);
  const linhas = Object.values(porForma)
    .sort((a, b) => (ordem.indexOf(a.forma) + 1 || 99) - (ordem.indexOf(b.forma) + 1 || 99))
    .map((f) => {
      const def = FORMAS_PADRAO.find((x) => x.id === f.forma);
      return { forma: f.forma, nome: def?.nome || f.forma, tPag: cfg?.formas?.[f.forma]?.tPag ?? def?.tPag ?? "", quantidade: f.quantidade, valor: reais(f.valor), pct: total ? f.valor / total : 0 };
    });
  return { mes, linhas, total: reais(total), vendas };
}
