const { By, until } = require("selenium-webdriver");

const CAMPOS_CSV_PRECO = ["mini_descricao", "novo_valor"];

function validarHeaderCSVPreco(lotes) {
  if (lotes.length === 0) return "O CSV não contém dados.";
  const keys = Object.keys(lotes[0]);
  const faltando = CAMPOS_CSV_PRECO.filter((c) => !keys.includes(c));
  if (faltando.length > 0) {
    return `Coluna(s) ausente(s) ou com nome errado no CSV: ${faltando.join(", ")}. Esperado: ${CAMPOS_CSV_PRECO.join(", ")}.`;
  }
  return null;
}

async function atualizarPreco(driver, item) {
  // 1. Pesquisar pela MiniDescrição
  const campoBusca = await driver.findElement(By.id("Descricao"));
  await campoBusca.clear();
  await campoBusca.sendKeys(item.mini_descricao);

  // 2. Clicar em Pesquisar
  await driver
    .findElement(By.css('button.btn-yellow[data-func^="pesquisapeca"]'))
    .click();

  // 3. Aguardar resultados
  await driver.wait(until.elementLocated(By.css("table tbody tr")), 8000);
  await driver.sleep(500);

  // 4. Clicar no botão editar (lápis)
  const editBtn = await driver.findElement(
    By.css('a.is-color3[data-func^="editapeca"]'),
  );
  await editBtn.click();

  // 5. Aguardar tela de edição carregar (campo Valor_Contratado)
  await driver.wait(until.elementLocated(By.id("Valor_Contratado")), 12000);
  await driver.sleep(800);

  // 6. Preencher o novo valor
  const inputValor = await driver.findElement(By.id("Valor_Contratado"));
  await inputValor.clear();
  await inputValor.sendKeys(String(item.novo_valor));

  // 7. Clicar em Atualizar peça
  await driver
    .findElement(By.css('button.btn-yellow[data-func^="gravacadpeca"]'))
    .click();

  // 8. Aguardar resposta
  await driver.wait(
    until.elementLocated(By.css("div.alert-success, div.alert-danger")),
    10000,
  );

  const alertEl = await driver.findElement(
    By.css("div.alert-success, div.alert-danger"),
  );
  const alertClass = await alertEl.getAttribute("class");
  const sucesso = alertClass.includes("alert-success");

  // 9. Fechar a tela de edição (botão "Fechar")
  await driver
    .findElement(By.css("a.is-backbtn"))
    .click();

  // 10. Aguardar voltar para a listagem (campo de busca visível)
  await driver.wait(until.elementLocated(By.id("Descricao")), 10000);
  await driver.sleep(300);

  return sucesso;
}

module.exports = {
  validarHeaderCSVPreco,
  atualizarPreco,
};
