#!/usr/bin/env bash
# Ensaios no navegador contra um servidor local com Redis falso (sem banco real, sem dados reais).
# Uso: bash tests/e2e/rodar.sh            (roda todos)
#      bash tests/e2e/rodar.sh fase2b      (só um)
# Requer Playwright em /opt/node-tools e Chromium em /opt/pw-browsers (ambiente cloud do Claude Code).
set -u
RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
E="$RAIZ/tests/e2e"
TMP="$(mktemp -d)"
parar() { for pid in $(pgrep -f "^node .*servidor.mjs"); do kill "$pid" 2>/dev/null; done; sleep 0.5; }
subir() { parar; (cd "$RAIZ" && env "$@" node "$E/servidor.mjs" "$RAIZ" > "$TMP/servidor.log" 2>&1 &); sleep 1; }
node -e '
const l = Array.from({ length: 742 }, (_, i) => ({ id: String(1760000000000 + i), category: ["venda","custo","despesa","funcionario"][i % 4], type: i % 4 ? "expense" : "income", value: 10 + i, date: `2026-${String(8 + (i % 3)).padStart(2, "0")}-10`, description: "t" + i, method: ["pix","cheque","debito","dinheiro"][i % 4] }));
require("fs").writeFileSync(process.argv[1], JSON.stringify({ financeItems: l, acumulado: { venda: 1000, pix: 100, credito: 200, debito: 300, custo: 400, despesa: 500, func: 600, dinheiroCaixa: 70.5 } }));' "$TMP/sintetico.json"
rodar() { # nome, env...
  local nome="$1"; shift; subir "$@"
  local arg=""; [ "$nome" = lotes ] && arg="$TMP/sintetico.json"
  local saida; saida=$(cd "$TMP" && timeout 300 node "$E/$nome.mjs" $arg 2>&1)
  echo "== $nome: $(echo "$saida" | grep -c '^OK') ok / $(echo "$saida" | grep -cE 'FALHA|ERRO JS|Error') falhas"
  echo "$saida" | grep -E "FALHA|ERRO JS|Error|at |waiting" | head -${LINHAS:-12}
}
ALVO="${1:-todos}"
[ "$ALVO" = todos -o "$ALVO" = fluxo ] && rodar fluxo X=1
[ "$ALVO" = todos -o "$ALVO" = fase1b ] && rodar fase1b X=1
[ "$ALVO" = todos -o "$ALVO" = lotes ] && rodar lotes VAZIO=1 FALHAR_IMPORTAR=3,4,5
[ "$ALVO" = todos -o "$ALVO" = trava ] && rodar trava BANCO_PRODUCAO_HOST=localhost PERMITIR_ZERAR=sim
[ "$ALVO" = todos -o "$ALVO" = fase2a ] && rodar fase2a SEED="$E/seed2a.json"
[ "$ALVO" = todos -o "$ALVO" = orcamentos ] && rodar orcamentos AGORA=2026-10-15T13:00:00Z
[ "$ALVO" = todos -o "$ALVO" = fase2b ] && rodar fase2b SEED="$E/seed2a.json"
[ "$ALVO" = todos -o "$ALVO" = frete ] && rodar frete X=1
[ "$ALVO" = todos -o "$ALVO" = fiado ] && rodar fiado X=1
[ "$ALVO" = todos -o "$ALVO" = contacorrente ] && rodar contacorrente X=1
[ "$ALVO" = todos -o "$ALVO" = caixaitens ] && rodar caixaitens VAZIO=1
[ "$ALVO" = todos -o "$ALVO" = impressao ] && rodar impressao VAZIO=1 AGORA=2026-10-25T17:32:00Z
[ "$ALVO" = todos -o "$ALVO" = resumodia ] && rodar resumodia VAZIO=1 AGORA=2026-10-20T22:00:00Z
[ "$ALVO" = todos -o "$ALVO" = criticos ] && rodar criticos VAZIO=1
[ "$ALVO" = todos -o "$ALVO" = integracao ] && rodar integracao VAZIO=1 AGORA=2026-10-22T13:00:00Z
[ "$ALVO" = todos -o "$ALVO" = virada ] && rodar virada SEED="$E/seed2a.json" BANCO_PRODUCAO_HOST=https://producao-antigo.upstash.io PERMITIR_ZERAR=sim
parar; rm -rf "$TMP"
