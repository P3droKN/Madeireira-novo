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
subir() { parar; (cd "$RAIZ" && env "$@" node "$E/servidor.mjs" "$RAIZ" > "$TMP/servidor.log" 2>&1 &); sleep 1
  for _ in $(seq 1 60); do curl -sf -o /dev/null http://localhost:4321/__pronto && break; sleep 0.5; done; }
rodar() { # nome, env...
  local nome="$1"; shift; subir "$@"
  local arg=""
  local saida; saida=$(cd "$TMP" && timeout 300 node "$E/$nome.mjs" $arg 2>&1)
  echo "== $nome: $(echo "$saida" | grep -c '^OK') ok / $(echo "$saida" | grep -cE 'FALHA|ERRO JS|Error') falhas"
  echo "$saida" | grep -E "FALHA|ERRO JS|Error|at |waiting" | head -${LINHAS:-12}
}
ALVO="${1:-todos}"
[ "$ALVO" = todos -o "$ALVO" = fluxo ] && rodar fluxo X=1
[ "$ALVO" = todos -o "$ALVO" = fase1b ] && rodar fase1b X=1
[ "$ALVO" = todos -o "$ALVO" = trava ] && rodar trava BANCO_PRODUCAO_HOST=localhost PERMITIR_ZERAR=sim
[ "$ALVO" = todos -o "$ALVO" = fase2a ] && rodar fase2a SEED="$E/seed2a.json"
[ "$ALVO" = todos -o "$ALVO" = orcamentos ] && rodar orcamentos AGORA=2026-10-15T13:00:00Z
[ "$ALVO" = todos -o "$ALVO" = fase2b ] && rodar fase2b SEED="$E/seed2a.json"
[ "$ALVO" = todos -o "$ALVO" = frete ] && rodar frete X=1
[ "$ALVO" = todos -o "$ALVO" = fiado ] && rodar fiado X=1
[ "$ALVO" = todos -o "$ALVO" = contacorrente ] && rodar contacorrente X=1
[ "$ALVO" = todos -o "$ALVO" = clientes ] && rodar clientes VAZIO=1
[ "$ALVO" = todos -o "$ALVO" = caixaitens ] && rodar caixaitens VAZIO=1
[ "$ALVO" = todos -o "$ALVO" = impressao ] && rodar impressao VAZIO=1 AGORA=2026-10-25T17:32:00Z
[ "$ALVO" = todos -o "$ALVO" = resumodia ] && rodar resumodia VAZIO=1 AGORA=2026-10-20T22:00:00Z
[ "$ALVO" = todos -o "$ALVO" = criticos ] && rodar criticos VAZIO=1
[ "$ALVO" = todos -o "$ALVO" = teclado ] && rodar teclado VAZIO=1
[ "$ALVO" = todos -o "$ALVO" = ajustes ] && rodar ajustes VAZIO=1
[ "$ALVO" = todos -o "$ALVO" = integracao ] && rodar integracao VAZIO=1 AGORA=2026-10-22T13:00:00Z
[ "$ALVO" = todos -o "$ALVO" = funcionarios ] && rodar funcionarios VAZIO=1
[ "$ALVO" = todos -o "$ALVO" = aparelhos ] && rodar aparelhos VAZIO=1
[ "$ALVO" = todos -o "$ALVO" = pecas ] && rodar pecas VAZIO=1
[ "$ALVO" = todos -o "$ALVO" = fiadoficha ] && rodar fiadoficha VAZIO=1
[ "$ALVO" = todos -o "$ALVO" = cheques ] && rodar cheques VAZIO=1
[ "$ALVO" = todos -o "$ALVO" = virada ] && rodar virada SEED="$E/seed2a.json" BANCO_PRODUCAO_HOST=https://producao-antigo.upstash.io PERMITIR_ZERAR=sim
parar; rm -rf "$TMP"
