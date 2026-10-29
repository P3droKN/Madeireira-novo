// Janela das vias (aparece depois de registrar venda e de salvar orçamento): guarda o texto e fecha.
export async function fecharVias(page, dialogos) {
  await page.waitForSelector("#modal-impressao", { state: "visible", timeout: 10000 });
  const texto = `${await page.textContent("#imp-titulo")}\n${await page.innerText("#imp-mensagem").catch(() => "")}`.replace(/ /g, " ");
  dialogos.push(texto);
  await page.click("#imp-fechar");
  await page.waitForSelector("#modal-impressao", { state: "hidden" });
  return texto;
}
