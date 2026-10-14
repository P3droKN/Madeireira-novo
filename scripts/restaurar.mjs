// Restaura um backup sem usar a tela (para quando a página não abrir).
// Uso:  SENHA_APP=suasenha node scripts/restaurar.mjs https://madereira-caixa.vercel.app arquivo.json
import { readFileSync } from "node:fs";

const [site, arquivo] = process.argv.slice(2);
const senha = process.env.SENHA_APP;
if (!site || !arquivo || !senha) {
  console.error("Uso: SENHA_APP=suasenha node scripts/restaurar.mjs <endereço do site> <arquivo.json>");
  process.exit(1);
}

const res = await fetch(new URL("/api/restaurar", site), {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-senha": senha },
  body: JSON.stringify({ confirmacao: "RESTAURAR", arquivo: JSON.parse(readFileSync(arquivo, "utf8")) }),
});
console.log(res.status, await res.text());
