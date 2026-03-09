const { Builder, By, until } = require("selenium-webdriver");
const chrome = require("selenium-webdriver/chrome");
const fs = require("fs");
require("chromedriver");

const URL_LOGIN = "https://leiloesbr.com.br/painel_lbr/";
const DELAY_ENTRE_ITENS = 2000;

function lerCSV(path) {
  const content = fs
    .readFileSync(path, "utf-8")
    .replace(/^\uFEFF/, "") // remove BOM UTF-8
    .replace(/\r/g, ""); // normaliza quebras de linha Windows
  const lines = content.trim().split("\n");
  const headers = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const values = line.split(",");
    return Object.fromEntries(headers.map((h, i) => [h, values[i]?.trim()]));
  });
}

function lerCSVBuffer(buffer) {
  const content = buffer
    .toString("utf-8")
    .replace(/^\uFEFF/, "")
    .replace(/\r/g, "");
  const lines = content.trim().split("\n");
  const headers = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const values = line.split(",");
    return Object.fromEntries(headers.map((h, i) => [h, values[i]?.trim()]));
  });
}

function criarDriver() {
  const options = new chrome.Options();
  options.setChromeBinaryPath(
    "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe",
  );
  options.addArguments("--start-maximized");
  options.addArguments("--window-position=0,0");
  options.addArguments("--window-size=1920,1080");
  return new Builder().forBrowser("chrome").setChromeOptions(options).build();
}

async function fazerLogin(driver, username, password, numeroLeilao) {
  await driver.get(URL_LOGIN);
  await driver.findElement(By.id("usuario")).sendKeys(username);
  await driver.findElement(By.id("senha")).sendKeys(password);
  await driver.findElement(By.id("leilao")).sendKeys(String(numeroLeilao));
  await driver
    .findElement(By.css("button[type=submit], input[type=submit], .btn-yellow"))
    .click();
  await driver.wait(until.urlContains("default.asp"), 15000);
  await driver.wait(
    until.elementLocated(By.css('a[href*="listar_pecas.asp"]')),
    10000,
  );
  await driver.executeScript(
    "document.querySelector('a[href*=\"listar_pecas.asp\"]').click()",
  );
  await driver.wait(until.elementLocated(By.id("Descricao")), 10000);
}

async function processarLote(driver, item) {
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

  // 4. Clicar no botão exportar (seta verde)
  const exportBtn = await driver.findElement(
    By.css('a.is-color6[data-func^="exportapeca"]'),
  );
  await exportBtn.click();

  // 5. Aguardar modal abrir
  await driver.wait(until.elementLocated(By.id("expleilao")), 8000);
  await driver.sleep(300);

  // 6. Preencher campos do modal
  const inputLeilao = await driver.findElement(By.id("expleilao"));
  await inputLeilao.clear();
  await inputLeilao.sendKeys(String(item.numero_leilao));

  const inputLote = await driver.findElement(By.id("explote"));
  await inputLote.clear();
  await inputLote.sendKeys(String(item.lote));

  const inputDia = await driver.findElement(By.id("expdia"));
  await inputDia.clear();
  await inputDia.sendKeys(String(item.dia));

  // 7. Confirmar exportação
  await driver
    .findElement(By.css('button.btn-grey[data-func^="exportaleilao"]'))
    .click();

  // 8. Aguardar resposta do servidor (sucesso ou erro)
  await driver.wait(
    until.elementLocated(By.css("div.alert-success, div.alert-danger")),
    10000,
  );

  const alertEl = await driver.findElement(
    By.css("div.alert-success, div.alert-danger"),
  );
  const alertClass = await alertEl.getAttribute("class");
  const sucesso = alertClass.includes("alert-success");

  // 9. Fechar o modal manualmente
  await driver
    .findElement(By.css('button.close[data-dismiss="modal"]'))
    .click();

  // 10. Aguardar modal sumir completamente
  await driver.wait(until.stalenessOf(inputLeilao), 8000);
  await driver.wait(async () => {
    const backdrops = await driver.findElements(By.css(".modal-backdrop"));
    return backdrops.length === 0;
  }, 5000);

  return sucesso;
}

const CAMPOS_CSV_OBRIGATORIOS = [
  "lote",
  "dia",
  "mini_descricao",
  "numero_leilao",
];

function validarHeaderCSV(lotes) {
  if (lotes.length === 0) return "O CSV não contém dados.";
  const keys = Object.keys(lotes[0]);
  const faltando = CAMPOS_CSV_OBRIGATORIOS.filter((c) => !keys.includes(c));
  if (faltando.length > 0) {
    return `Coluna(s) ausente(s) ou com nome errado no CSV: ${faltando.join(", ")}. Esperado: ${CAMPOS_CSV_OBRIGATORIOS.join(", ")}.`;
  }
  return null;
}

module.exports = {
  lerCSV,
  lerCSVBuffer,
  validarHeaderCSV,
  criarDriver,
  fazerLogin,
  processarLote,
  DELAY_ENTRE_ITENS,
};
