// Janela das vias (aparece depois de registrar venda e de salvar orçamento): guarda o texto e fecha.
export async function fecharVias(page, dialogos) {
  await page.waitForSelector("#modal-impressao", { state: "visible", timeout: 10000 });
  const texto = `${await page.textContent("#imp-titulo")}\n${await page.innerText("#imp-mensagem").catch(() => "")}`.replace(/ /g, " ");
  dialogos.push(texto);
  await page.click("#imp-fechar");
  await page.waitForSelector("#modal-impressao", { state: "hidden" });
  return texto;
}

// Cadastro de cliente (Clientes e Orçamentos › Clientes, ou "+ cadastrar novo" de qualquer tela): preenche e salva.
export async function salvarCadastro(page, campos = {}) {
  await page.waitForSelector("#modal-cliente", { state: "visible", timeout: 10000 });
  for (const [id, valor] of Object.entries(campos)) await page.fill(`#cli-${id}`, String(valor));
  await page.click("#cli-salvar");
  await page.waitForSelector("#modal-cliente", { state: "hidden" });
}
// Abre Clientes e Orçamentos › Clientes
export async function irClientes(page) {
  await page.click("#btn-tab-orcamentos");
  await page.click('#co-subtabs .subtab[data-co="clientes"]');
  await page.waitForSelector("#cli-body, .ficha-cliente");
}
// Abre a ficha de um cliente pela lista
export async function abrirFicha(page, nome) {
  await irClientes(page);
  if (await page.locator("#cli-voltar").count()) await page.click("#cli-voltar");
  await page.locator('label:has(input[name="cli-filtro"][value="todos"])').click();
  await page.fill("#cli-busca", nome);
  await page.locator("#cli-body tr", { hasText: nome }).first().click();
  await page.waitForSelector(".ficha-cliente");
}
