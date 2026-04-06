const { By, until } = require("selenium-webdriver");

const CAMPOS_CSV_TRANSFERENCIA = ["lote", "dia", "mini_descricao", "numero_leilao", "novo_valor"];

function validarHeaderCSVTransferencia(lotes) {
  if (lotes.length === 0) return "O CSV não contém dados.";
  const keys = Object.keys(lotes[0]);
  const faltando = CAMPOS_CSV_TRANSFERENCIA.filter((c) => !keys.includes(c));
  if (faltando.length > 0) {
    return `Coluna(s) ausente(s) ou com nome errado no CSV: ${faltando.join(", ")}. Esperado: ${CAMPOS_CSV_TRANSFERENCIA.join(", ")}.`;
  }
  return null;
}

async function transferirComValor(driver, item) {
  // 1. Pesquisar pela MiniDescrição
  const campoBusca = await driver.findElement(By.id("Descricao"));
  await driver.sleep(200);
  await campoBusca.clear();
  await driver.sleep(200);
  await campoBusca.sendKeys(item.mini_descricao);
  await driver.sleep(500);

  // 2. Clicar em Pesquisar
  await driver
    .findElement(By.css('button.btn-yellow[data-func^="pesquisapeca"]'))
    .click();

  // 3. Aguardar resultados
  await driver.wait(until.elementLocated(By.css("table tbody tr")), 8000);
  await driver.sleep(1000);

  // 4. Clicar no botão exportar (seta verde)
  const exportBtn = await driver.findElement(
    By.css('a.is-color6[data-func^="exportapeca"]'),
  );
  await driver.sleep(200);
  await exportBtn.click();

  // 5. Aguardar modal abrir
  await driver.wait(until.elementLocated(By.id("expleilao")), 8000);
  await driver.sleep(500);

  // 6. Preencher campos do modal
  const inputLeilao = await driver.findElement(By.id("expleilao"));
  await inputLeilao.clear();
  await driver.sleep(200);
  await inputLeilao.sendKeys(String(item.numero_leilao));
  await driver.sleep(300);

  const inputLote = await driver.findElement(By.id("explote"));
  await inputLote.clear();
  await driver.sleep(200);
  await inputLote.sendKeys(String(item.lote));
  await driver.sleep(300);

  const inputDia = await driver.findElement(By.id("expdia"));
  await inputDia.clear();
  await driver.sleep(200);
  await inputDia.sendKeys(String(item.dia));
  await driver.sleep(300);

  // 7. Preencher Valor Base
  const inputValor = await driver.findElement(By.id("expvalor"));
  await inputValor.clear();
  await driver.sleep(200);
  await inputValor.sendKeys(String(item.novo_valor));
  await driver.sleep(300);

  // 8. Confirmar exportação
  await driver
    .findElement(By.css('button.btn-grey[data-func^="exportaleilao"]'))
    .click();

  // 9. Aguardar resposta do servidor (sucesso ou erro)
  await driver.wait(
    until.elementLocated(By.css("div.alert-success, div.alert-danger")),
    10000,
  );

  const alertEl = await driver.findElement(
    By.css("div.alert-success, div.alert-danger"),
  );
  const alertClass = await alertEl.getAttribute("class");
  const sucesso = alertClass.includes("alert-success");

  // 10. Fechar o modal
  await driver
    .findElement(By.css('button.close[data-dismiss="modal"]'))
    .click();

  // 11. Aguardar modal sumir completamente
  await driver.wait(until.stalenessOf(inputLeilao), 8000);
  await driver.wait(async () => {
    const backdrops = await driver.findElements(By.css(".modal-backdrop"));
    return backdrops.length === 0;
  }, 5000);

  return sucesso;
}

module.exports = {
  validarHeaderCSVTransferencia,
  transferirComValor,
};
