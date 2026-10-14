// Aqui você pode editar os custos e os preços de venda para cada material.
// 
// COMO PREENCHER:
// - "custo": O valor que você paga pelo material. Se for algo que você não paga (como Retalho), coloque 0.
// - "venda": O valor base pelo qual você costuma vender. 
//
// O sistema vai puxar esses valores para preencher automaticamente na Calculadora, 
// mas o campo continuará liberado para você editar o preço final da venda na hora (caso seja uma peça selecionada).

const woodData = {
    "CEDRO": { 
        unit: "linear_meters", 
        label: "Metros Lineares", 
        dimensions: { 
            "1x2": { custo: 3.62, venda: 0 }, 
            "1x3": { custo: 5.44, venda: 0 }, 
            "1x4": { custo: 7.25, venda: 0 }, 
            "1x6": { custo: 10.88, venda: 0 }, 
            "1x8": { custo: 16.24, venda: 0 }, 
            "1x10": { custo: 18.13, venda: 0 }, 
            "1x12": { custo: 21.75, venda: 0 }, 
            "2x2": { custo: 7.25, venda: 0 }, 
            "2x4": { custo: 14.5, venda: 0 }, 
            "2x6": { custo: 21.75, venda: 0 }, 
            "2x8": { custo: 29.00, venda: 0 }, 
            "2x10": { custo: 36.25, venda: 0 }, 
            "2x12": { custo: 43.50, venda: 0 }, 
            "3x3": { custo: 16.32, venda: 0 }, 
            "3x4": { custo: 21.75, venda: 0 }, 
            "3x6": { custo: 32.63, venda: 0 }, 
            "3x8": { custo: 43.50, venda: 0 }, 
            "3x10": { custo: 54.38, venda: 0 }, 
            "3x12": { custo: 65.25, venda: 0 } 
        } 
    },
    "CAMBARÁ": { 
        unit: "linear_meters", 
        label: "Metros Lineares", 
        dimensions: { 
            "1x2": { custo: 3.44, venda: 0 }, 
            "1x3": { custo: 5.16, venda: 0 }, 
            "1x4": { custo: 6.88, venda: 0 }, 
            "1x6": { custo: 10.31, venda: 0 }, 
            "1x8": { custo: 13.75, venda: 0 }, 
            "1x10": { custo: 17.19, venda: 0 }, 
            "1x12": { custo: 20.63, venda: 0 }, 
            "2x2": { custo: 6.88, venda: 0 }, 
            "2x4": { custo: 13.75, venda: 0 }, 
            "2x6": { custo: 20.63, venda: 0 }, 
            "2x8": { custo: 27.50, venda: 0 }, 
            "2x10": { custo: 34.38, venda: 0 }, 
            "2x12": { custo: 41.25, venda: 0 }, 
            "3x3": { custo: 15.47, venda: 0 }, 
            "3x4": { custo: 20.63, venda: 0 }, 
            "3x6": { custo: 30.94, venda: 0 }, 
            "3x8": { custo: 41.25, venda: 0 }, 
            "3x10": { custo: 51.56, venda: 0 }, 
            "3x12": { custo: 61.88, venda: 0 } 
        } 
    },
    "PINUS": { 
        unit: "pieces", 
        label: "Número de peças (cada peça = 2,5m)", 
        dimensions: { 
            "1x2": { custo: 2.4, venda: 0 }, 
            "1x3": { custo: 3.6, venda: 0 }, 
            "1x4": { custo: 5.0, venda: 0 }, 
            "1x6": { custo: 7.5, venda: 0 }, 
            "1x8": { custo: 10.0, venda: 0 }, 
            "1x10": { custo: 14.4, venda: 0 }, 
            "1x12": { custo: 23.0, venda: 0 }, 
            "2x4x3,00": { custo: 13.5, venda: 0 }, 
            "2x4x4,00": { custo: 23.0, venda: 0 } 
        } 
    },
    "ITAÚBA": { 
        unit: "linear_meters", 
        label: "Metros Lineares", 
        dimensions: { 
            "1x2": { custo: 7.0, venda: 0 }, 
            "1x3": { custo: 10.5, venda: 0 }, 
            "1x4": { custo: 14.0, venda: 0 }, 
            "1x6": { custo: 21.0, venda: 0 }, 
            "1x8": { custo: 28.0, venda: 0 }, 
            "1x10": { custo: 35.0, venda: 0 }, 
            "1x12": { custo: 42.0, venda: 0 }, 
            "2x2": { custo: 14.0, venda: 0 }, 
            "2x4": { custo: 28.0, venda: 0 }, 
            "2x6": { custo: 42.0, venda: 0 }, 
            "2x8": { custo: 56.0, venda: 0 }, 
            "2x10": { custo: 70.0, venda: 0 }, 
            "2x12": { custo: 84.0, venda: 0 }, 
            "3x3": { custo: 31.0, venda: 0 }, 
            "3x4": { custo: 42.0, venda: 0 }, 
            "3x6": { custo: 63.0, venda: 0 }, 
            "3x8": { custo: 84.0, venda: 0 }, 
            "3x10": { custo: 105.0, venda: 0 }, 
            "3x12": { custo: 126.0, venda: 0 } 
        } 
    },
    "EUCALIPTO": { 
        unit: "linear_meters", 
        label: "Metros Lineares", 
        dimensions: { 
            "1x2": { custo: 1.72, venda: 0 }, 
            "1x10": { custo: 8.57, venda: 0 }, 
            "2x4": { custo: 6.85, venda: 0 }, 
            "2x6": { custo: 10.28, venda: 0 }, 
            "11x13x2,5": { custo: 33.5, venda: 0 }, 
            "14x16x3,00": { custo: 49.5, venda: 0 }, 
            "18x20x4,00": { custo: 165.0, venda: 0 } 
        } 
    },
    "MADEIRITE": { 
        unit: "pieces", 
        label: "Número de chapas", 
        dimensions: { 
            "9m/m": { custo: 37.0, venda: 0 }, 
            "12m/m": { custo: 52.0, venda: 0 }, 
            "14m/m": { custo: 63.0, venda: 0 } 
        } 
    },
    "CAIXILHO": { 
        unit: "pieces", 
        label: "Qtd (Jogos/Unid)", 
        dimensions: { 
            "Largura 10": { custo: 60, venda: 0 }, 
            "Largura 12": { custo: 100, venda: 0 }, 
            "Largura 14": { custo: 120, venda: 0 }, 
            "Largura 15": { custo: 125, venda: 0 }, 
            "Largura 16": { custo: 130, venda: 0 }, 
            "Largura 18": { custo: 150, venda: 0 }, 
            "Largura 20": { custo: 162, venda: 0 }, 
            "Largura 23": { custo: 220, venda: 0 }, 
            "Largura 25": { custo: 240, venda: 0 } 
        } 
    },
    "VISTAS": { 
        unit: "pieces", 
        label: "Qtd (Jogos/Unid)", 
        dimensions: { 
            "Largura 6": { custo: 45, venda: 0 }, 
            "Largura 7": { custo: 55, venda: 0 }, 
            "Largura 10": { custo: 115, venda: 0 } 
        } 
    },
    "PREGOS": { 
        unit: "pieces", 
        label: "Quantidade de sacos", 
        dimensions: { 
            "Medida 12|12": { custo: 12.4, venda: 0 }, 
            "Medida 13|15": { custo: 11.5, venda: 0 }, 
            "Medida 15|21": { custo: 10.1, venda: 0 }, 
            "Medida 16|24": { custo: 9.6, venda: 0 }, 
            "Medida 17|27": { custo: 9.2, venda: 0 }, 
            "Medida 18|36": { custo: 8.8, venda: 0 } 
        } 
    },
    "MEIA_CANA_CEDRO": { 
        unit: "linear_meters", 
        label: "Metros Lineares", 
        dimensions: { 
            "Fina": { custo: 4.8, venda: 0 }, 
            "Grossa": { custo: 7.5, venda: 0 } 
        } 
    },
    "MEIA_CANA_PINUS": { 
        unit: "linear_meters", 
        label: "Metros Lineares", 
        dimensions: { 
            "Grossa": { custo: 2.8, venda: 0 } 
        } 
    },
    "DECK": { 
        unit: "square_meters", 
        label: "Metragem (m²)", 
        dimensions: { 
            "Largura 7cm": { custo: 149, venda: 0 }, 
            "Largura 10cm": { custo: 185, venda: 0 }, 
            "Pinus": { custo: 58, venda: 0 } 
        } 
    },
    "FORRO": { 
        unit: "square_meters", 
        label: "Metragem (m²)", 
        dimensions: { 
            "Cedro Mesclado Curto": { custo: 37, venda: 0 }, 
            "Cedro Mesclado": { custo: 70, venda: 0 }, 
            "Cedro Vermelho Curto": { custo: 75, venda: 0 }, 
            "Cedro Vermelho": { custo: 90, venda: 0 }, 
            "Pinus": { custo: 15, venda: 0 } 
        } 
    },
    "RETALHO": {
        unit: "pieces",
        label: "Número de peças",
        dimensions: {
            "Geral": { custo: 0, venda: 0 }
        }
    }
};

// Torna o objeto global para o script.js enxergar
window.woodData = woodData;
