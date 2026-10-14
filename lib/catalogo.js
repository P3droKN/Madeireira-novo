// Catálogo da calculadora, montado a partir de data/custos.json (fonte da verdade dos custos).
// Funciona no navegador (import) e no Node (API e testes).

export const UNIDADES = {
  metro_linear: { cobranca: "m", rotuloQtd: "Qtd de peças", pedeComprimento: true, inteiro: true },
  peca: { cobranca: "peça", rotuloQtd: "Qtd de peças", inteiro: true },
  chapa: { cobranca: "chapa", rotuloQtd: "Qtd de chapas", inteiro: true },
  m2: { cobranca: "m²", rotuloQtd: "Metragem (m²)", inteiro: false },
  jogo: { cobranca: "jogo", rotuloQtd: "Qtd de jogos", inteiro: true },
  meio_jogo: { cobranca: "meio jogo", rotuloQtd: "Qtd de meios jogos", inteiro: true },
  saco: { cobranca: "saco", rotuloQtd: "Qtd de sacos", inteiro: true },
  valor_livre: { cobranca: "un", rotuloQtd: "Valor (R$)", inteiro: false },
};

export const ACABAMENTOS = { BRUTO: "Bruto", CEPILHADO: "Cepilhado", UNICO: "Único" };

// Materiais que podem ter acabamento bruto/cepilhado, e o padrão de cada um (editável no admin).
export const CEPILHADO_PADRAO = {
  CEDRO_MESCLADO: true,
  CEDRO_VERMELHO: true,
  CAMBARA: true,
  ITAUBA: true,
  JEQUITIBA: true,
  EUCALIPTO: false,
  PINUS: true,
};

export const CONFIG_PADRAO = {
  modificadores: { selecionadaPct: 0, ultimasPecasPct: 0 },
  temCepilhado: { ...CEPILHADO_PADRAO },
};

export function mesclarConfig(salva) {
  const s = salva && typeof salva === "object" ? salva : {};
  return {
    modificadores: { ...CONFIG_PADRAO.modificadores, ...(s.modificadores || {}) },
    temCepilhado: { ...CONFIG_PADRAO.temCepilhado, ...(s.temCepilhado || {}) },
  };
}

const NOMES = {
  CEDRO_MESCLADO: "Cedro Mesclado",
  CEDRO_VERMELHO: "Cedro Vermelho",
  CAMBARA: "Cambará",
  ITAUBA: "Itaúba",
  JEQUITIBA: "Jequitibá",
  EUCALIPTO: "Eucalipto",
  PINUS: "Pinus",
  EUCALIPTO_ROLICO: "Eucalipto Roliço Autoclavado",
  MADEIRITE: "Madeirite 1,10 × 2,20",
  FORRO: "Forro",
  DECK: "Deck",
  ASSOALHO: "Assoalho",
  MEIA_CANA: "Meia Cana",
  RODAPE: "Rodapé",
  BEIRAL: "Beiral",
  CAIXILHO_TAUARI: "Caixilho Tauari",
  VISTAS_TAUARI: "Vistas Tauari",
  PREGOS: "Pregos",
  RETALHO: "Retalho",
};

const PALAVRAS = { CAMBARA: "cambará", ITAUBA: "itaúba", JEQUITIBA: "jequitibá", RODAPE: "rodapé" };

const decimal = (s) => String(s).replace(/(\d)\.(\d)/g, "$1,$2");

// "CEDRO_MESCLADO_CURTO" -> "Cedro mesclado curto"; "CEDRO_1.5pol_4.0cm" -> "Cedro 1,5" 4,0 cm"
export function rotular(chave) {
  const texto = String(chave)
    .split("_")
    .map((p) => PALAVRAS[p] || p.toLowerCase())
    .join(" ")
    .replace(/(\d)pol\b/g, '$1"')
    .replace(/(\d)(cm|mm)\b/g, "$1 $2");
  const t = decimal(texto);
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// Ordena "1x2" < "1x10" < "1.5x2" < "2x2" pelos números
function compararDimensoes(a, b) {
  const na = (a.match(/\d+(\.\d+)?/g) || []).map(Number);
  const nb = (b.match(/\d+(\.\d+)?/g) || []).map(Number);
  for (let i = 0; i < Math.max(na.length, nb.length); i++) {
    const d = (na[i] ?? -1) - (nb[i] ?? -1);
    if (d) return d;
  }
  return a.localeCompare(b);
}

const entradas = (obj) => Object.entries(obj || {}).filter(([k]) => !k.startsWith("_"));

export function montarCatalogo(custos, configSalva) {
  const config = mesclarConfig(configSalva);
  const materiais = [];
  const itens = new Map();

  function material(id, grupo, extra = {}) {
    const ehMadeira = grupo === "madeira";
    const temCepilhado = ehMadeira && Boolean(config.temCepilhado[id]);
    const m = {
      id,
      nome: NOMES[id] || rotular(id),
      grupo,
      temCepilhado,
      acabamentos: ehMadeira ? (temCepilhado ? ["BRUTO", "CEPILHADO"] : ["BRUTO"]) : ["UNICO"],
      itens: [],
      ...extra,
    };
    materiais.push(m);
    return m;
  }

  function item(m, dimensao, rotuloDimensao, unidade, custo, extra = {}) {
    const it = {
      id: `${m.id}|${dimensao}`,
      materialId: m.id,
      material: m.nome,
      dimensao,
      rotuloDimensao,
      unidade,
      custo: typeof custo === "number" ? custo : null,
      ...extra,
    };
    m.itens.push(it);
    itens.set(it.id, it);
  }

  const ordenadas = (obj) => entradas(obj).sort(([a], [b]) => compararDimensoes(a, b));

  // Madeiras por metro linear (cedro vira mesclado e vermelho, com o mesmo custo)
  for (const [mat, dados] of entradas(custos.madeiras_metro_linear)) {
    const ids = mat === "CEDRO" ? ["CEDRO_MESCLADO", "CEDRO_VERMELHO"] : [mat];
    for (const id of ids) {
      const m = material(id, "madeira", { custoDe: mat });
      for (const [dim, custo] of ordenadas(dados.dimensoes)) item(m, dim, decimal(dim), "metro_linear", custo);
    }
  }

  // Pinus: por peça, com o comprimento na medida
  if (custos.pinus_por_peca) {
    const m = material("PINUS", "madeira");
    for (const [dim, custo] of ordenadas(custos.pinus_por_peca.dimensoes)) {
      const [a, b, c] = dim.split("x");
      item(m, dim, `${decimal(a)}x${decimal(b)} × ${decimal(c)} m`, "peca", custo);
    }
  }

  // Eucalipto roliço: por peça (diâmetro em cm × comprimento em m)
  if (custos.eucalipto_rolico_autoclavado_por_peca) {
    const m = material("EUCALIPTO_ROLICO", "outros");
    for (const [dim, custo] of ordenadas(custos.eucalipto_rolico_autoclavado_por_peca.dimensoes)) {
      const [diam, comp] = dim.split("x");
      item(m, dim, `Ø ${diam.replace("a", " a ")} cm × ${decimal(comp)} m`, "peca", custo);
    }
  }

  // Chapas
  for (const [chapa, dims] of entradas(custos.chapas)) {
    const id = chapa.startsWith("MADEIRITE") ? "MADEIRITE" : chapa;
    const m = material(id, "outros");
    for (const [dim, custo] of ordenadas(dims)) item(m, dim, rotular(dim), "chapa", custo);
  }

  // Metro quadrado: forro, deck, assoalho
  for (const [mat, tipos] of entradas(custos.metro_quadrado)) {
    const m = material(mat, "outros");
    for (const [tipo, custo] of entradas(tipos)) item(m, tipo, rotular(tipo), "m2", custo);
  }

  // Metro linear: meia cana, rodapé, beiral
  for (const [mat, tipos] of entradas(custos.metro_linear_acabamentos)) {
    const m = material(mat, "outros");
    for (const [tipo, custo] of entradas(tipos)) item(m, tipo, rotular(tipo), "metro_linear", custo);
  }

  // Jogos: caixilho (jogo completo com vistas) e vistas (jogo ou meio jogo)
  for (const [mat, modos] of entradas(custos.jogos)) {
    const m = material(mat, "outros");
    for (const modo of ["jogo", "meio_jogo"]) {
      for (const [larg, custo] of ordenadas(modos[modo])) {
        const sufixo = mat.startsWith("CAIXILHO") ? "jogo completo (com vistas)"
          : modo === "jogo" ? "jogo (4 peças)" : "meio jogo";
        item(m, `${modo}:${larg}`, `${rotular(larg)} — ${sufixo}`, modo, custo);
      }
    }
  }

  // Pregos: por saco
  if (custos.pregos_por_saco) {
    const m = material("PREGOS", "outros");
    for (const [medida, custo] of ordenadas(custos.pregos_por_saco)) item(m, medida, medida.replace("x", " × "), "saco", custo);
  }

  // Retalho: valor livre, custo 0
  if (custos.retalho) {
    const m = material("RETALHO", "outros");
    item(m, "LIVRE", "Valor livre", "valor_livre", custos.retalho.custo ?? 0);
  }

  return { materiais, itens, config };
}

// Chave do preço de venda no banco: "<id do item>|<acabamento>"
export const chavePreco = (itemId, acabamento) => `${itemId}|${acabamento}`;

// Confere se a chave existe no catálogo. Aceita BRUTO e CEPILHADO em toda madeira
// (mesmo com o cepilhado desligado, para o preço não se perder ao religar).
export function chavePrecoValida(catalogo, chave) {
  const i = String(chave).lastIndexOf("|");
  if (i < 0) return false;
  const item = catalogo.itens.get(chave.slice(0, i));
  const acab = chave.slice(i + 1);
  if (!item || item.unidade === "valor_livre") return false;
  const m = catalogo.materiais.find((x) => x.id === item.materialId);
  return m.grupo === "madeira" ? acab === "BRUTO" || acab === "CEPILHADO" : acab === "UNICO";
}
