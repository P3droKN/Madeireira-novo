// Conferência: compara um arquivo de backup com o que está no banco (quantidade,
// totais por mês e acumulado de agosto). Os números precisam bater exatamente.
import { lerArquivoBackup, resumirLancamentos, compararResumos } from "./lib/resumo.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (v, rotulo) => {
  if (v == null) return "—";
  if (/Quantidade|Lançamentos/.test(rotulo)) return String(v);
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
};

window.Conferencia = {
  async abrir(event) {
    const file = event.target.files[0];
    event.target.value = "";
    if (!file) return;
    let doArquivo;
    try {
      const a = lerArquivoBackup(JSON.parse(await file.text()));
      doArquivo = resumirLancamentos(a.lista, a.acumulado);
    } catch (e) {
      alert(`Não consegui ler o arquivo: ${e.message}`);
      return;
    }
    let banco;
    try {
      banco = await window.api("/api/resumo");
    } catch (e) {
      alert(`Não consegui ler o banco: ${e.message}`);
      return;
    }
    const { linhas, diferencas } = compararResumos(doArquivo, banco.resumo);
    const st = banco.status;
    $("conferencia-status").textContent = `Arquivo: ${file.name} · Banco: ${st.bancoHost} (${st.ambiente}${st.prefixo ? ", prefixo " + st.prefixo : ""}) · salvamento seguro ${st.migrado ? "ativo" : "não ativado"}`;
    const ver = $("conferencia-veredito");
    ver.className = "aviso " + (diferencas ? "aviso-erro" : "aviso-ok");
    ver.innerHTML = diferencas
      ? `<strong>${diferencas} ${diferencas > 1 ? "diferenças" : "diferença"}.</strong> As linhas em vermelho não batem.`
      : `<strong>Tudo confere.</strong> ${doArquivo.quantidade} lançamentos, totais por mês e acumulado idênticos.`;
    $("conferencia-body").innerHTML = linhas.map((l) => `<tr class="${l.igual ? "" : "diferente"}">
      <td>${esc(l.grupo)}</td><td>${esc(l.rotulo)}</td>
      <td class="num">${fmt(l.arquivo, l.rotulo)}</td><td class="num">${fmt(l.banco, l.rotulo)}</td>
      <td>${l.igual ? '<span class="ok-sim">✓</span>' : '<span class="ok-nao">✗</span>'}</td></tr>`).join("");
    $("modal-conferencia").style.display = "flex";
  },
  fechar() {
    $("modal-conferencia").style.display = "none";
  },
};
