// Datas sempre no horário de Brasília (America/Sao_Paulo), no servidor (que roda em UTC) e nos aparelhos
// (mesmo se o relógio do aparelho estiver em outro fuso). Uma venda às 22h fica no dia dela.
const FMT = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });

/** AAAA-MM-DD em Brasília de um instante (Date, ISO ou milissegundos). Data pura (AAAA-MM-DD) volta igual. */
export function dataSP(quando = new Date()) {
  if (typeof quando === "string" && /^\d{4}-\d{2}-\d{2}$/.test(quando)) return quando;
  const d = quando instanceof Date ? quando : new Date(quando);
  return Number.isNaN(d.getTime()) ? "" : FMT.format(d);
}

/** Hoje (AAAA-MM-DD) em Brasília. */
export const hojeSP = () => dataSP(new Date());
