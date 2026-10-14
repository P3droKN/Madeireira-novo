// Resumo dos lançamentos para conferir um arquivo de backup contra o banco.
// Soma em centavos inteiros, para os totais baterem exatamente.

const CATEGORIAS = ["venda", "custo", "despesa", "funcionario"];
const CAMPOS_ACUMULADO = ["venda", "pix", "credito", "debito", "custo", "despesa", "func", "dinheiroCaixa"];

const centavos = (v) => Math.round(Number(v || 0) * 100);
const reais = (c) => c / 100;

// Lista de lançamentos e acumulado de qualquer formato de arquivo do sistema
export function lerArquivoBackup(arquivo) {
  if (Array.isArray(arquivo)) return { lista: arquivo, acumulado: null };
  if (arquivo?.chaves) {
    const hash = arquivo.chaves.madeireira_lancamentos;
    const parse = (v) => (typeof v === "string" ? JSON.parse(v) : v);
    const lista = hash && Object.keys(hash).length ? Object.values(hash).map(parse) : parse(arquivo.chaves.madeireira_finance) || [];
    return { lista, acumulado: parse(arquivo.chaves.madeireira_acumulado) || null };
  }
  if (Array.isArray(arquivo?.financeItems)) return { lista: arquivo.financeItems, acumulado: arquivo.acumulado || null };
  throw new Error("Arquivo de backup não reconhecido.");
}

export function resumirLancamentos(lista, acumulado) {
  const meses = {};
  let quantidade = 0;
  for (const i of lista || []) {
    if (!i || i.excluido) continue;
    quantidade++;
    const mes = String(i.date || "").slice(0, 7) || "sem data";
    const m = (meses[mes] ||= { lancamentos: 0, venda: 0, custo: 0, despesa: 0, funcionario: 0 });
    m.lancamentos++;
    // Mesma regra da tela do caixa: sem categoria, entrada = venda e saída = despesa
    const cat = CATEGORIAS.includes(i.category) ? i.category : i.type === "income" ? "venda" : "despesa";
    m[cat] += centavos(i.value);
  }
  const porMes = Object.keys(meses).sort().map((mes) => ({
    mes,
    lancamentos: meses[mes].lancamentos,
    ...Object.fromEntries(CATEGORIAS.map((c) => [c, reais(meses[mes][c])])),
  }));
  const acc = acumulado
    ? Object.fromEntries(CAMPOS_ACUMULADO.map((c) => [c, reais(centavos(acumulado[c]))]))
    : null;
  return { quantidade, porMes, acumulado: acc };
}

const ROTULOS = { venda: "Vendas", custo: "Custos", despesa: "Despesas", funcionario: "Funcionários" };
const ROTULOS_ACC = { venda: "Vendas", pix: "PIX/Bradesco", credito: "Crédito", debito: "Débito", custo: "Custo", despesa: "Despesas", func: "Funcionários", dinheiroCaixa: "Gaveta" };

// Linhas lado a lado: { grupo, rotulo, arquivo, banco, igual }
export function compararResumos(arquivo, banco) {
  const linhas = [];
  const add = (grupo, rotulo, a, b) => linhas.push({ grupo, rotulo, arquivo: a, banco: b, igual: a === b });
  add("Geral", "Quantidade de lançamentos", arquivo.quantidade, banco.quantidade);
  const meses = [...new Set([...arquivo.porMes, ...banco.porMes].map((m) => m.mes))].sort();
  for (const mes of meses) {
    const a = arquivo.porMes.find((m) => m.mes === mes) || {};
    const b = banco.porMes.find((m) => m.mes === mes) || {};
    add(mes, "Lançamentos", a.lancamentos ?? 0, b.lancamentos ?? 0);
    for (const c of CATEGORIAS) add(mes, ROTULOS[c], a[c] ?? 0, b[c] ?? 0);
  }
  for (const c of CAMPOS_ACUMULADO) {
    add("Acumulado ago/2026", ROTULOS_ACC[c], arquivo.acumulado?.[c] ?? null, banco.acumulado?.[c] ?? null);
  }
  return { linhas, diferencas: linhas.filter((l) => !l.igual).length };
}
