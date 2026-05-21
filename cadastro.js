const { By, until } = require("selenium-webdriver");

const CAMPOS_CSV_OBRIGATORIOS_CADASTRO = [
  "item",
  "peca",
  "lote",
  "dia",
  "preco_contratado",
  "descricao",
  "segunda_descricao",
];

function validarHeaderCSVCadastro(lotes) {
  if (lotes.length === 0) return "O CSV não contém dados.";
  const keys = Object.keys(lotes[0]);
  const faltando = CAMPOS_CSV_OBRIGATORIOS_CADASTRO.filter(
    (c) => !keys.includes(c),
  );
  if (faltando.length > 0) {
    return `Coluna(s) ausente(s) no CSV: ${faltando.join(", ")}. Esperado: ${CAMPOS_CSV_OBRIGATORIOS_CADASTRO.join(", ")}.`;
  }
  return null;
}

async function navegarParaCadastro(driver, comitente) {
  // Usar JS para navegar direto para cad_peca.asp — evita abrir/fechar o submenu
  await driver.executeScript(
    "document.querySelector('#cadastro-peca a').click()",
  );
  await driver.sleep(500);

  // Aguardar a página de cadastro carregar
  await driver.wait(until.elementLocated(By.id("IdC")), 10000);
  await driver.sleep(500);

  // Inserir o comitente
  const inputComitente = await driver.findElement(By.id("IdC"));
  await driver.sleep(200);
  await inputComitente.clear();
  await driver.sleep(200);
  await inputComitente.sendKeys(String(comitente));
  await driver.sleep(500);

  // Clicar em Listar peças
  await driver
    .findElement(By.css('button.btn-yellow[data-func^="listarpecas"]'))
    .click();

  // Aguardar a lista aparecer (botão "Adicionar nova peça")
  await driver.wait(
    until.elementLocated(By.css(`a[data-func^="adicionapeca|${comitente}"]`)),
    15000,
  );
  await driver.sleep(500);
}

function setValor(driver, id, valor) {
  return driver.executeScript(
    `var el = document.getElementById(arguments[0]);
    el.focus();
    el.value = arguments[1];
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.blur();`,
    id,
    String(valor),
  );
}

async function cadastrarPeca(driver, item, comitente) {
  // Clicar em "Adicionar nova peça"
  await driver
    .findElement(By.css(`a[data-func^="adicionapeca|${comitente}"]`))
    .click();
  await driver.sleep(500);

  // Aguardar formulário abrir
  await driver.wait(until.elementLocated(By.id("Item")), 10000);
  await driver.sleep(500);

  // Item (tabindex 1)
  await setValor(driver, "Item", item.item);
  await driver.sleep(500);

  // Peça — título curto (tabindex 2, input #Peca, maxlength 100)
  await setValor(driver, "Peca", item.peca);
  await driver.sleep(500);

  // Lote (tabindex 3)
  await setValor(driver, "Lote", item.lote);
  await driver.sleep(500);

  // Dia (tabindex 5)
  await setValor(driver, "Dia", item.dia);
  await driver.sleep(500);

  // Tipo — Joias (value 18, tabindex 8)
  await driver.executeScript(
    `var sel = document.getElementById('ID_Tipo');
    sel.value = '18';
    sel.dispatchEvent(new Event('change', { bubbles: true }));`,
  );
  await driver.sleep(500);

  // Preço contratado (tabindex 9, id Valor_Contratado)
  await setValor(driver, "Valor_Contratado", item.preco_contratado);
  await driver.sleep(500);

  // Descrição (tabindex 12, textarea #Descricao)
  // concatena referência no final: "descricao | REF:segunda_descricao"
  const descricaoCompleta = item.segunda_descricao
    ? `${item.descricao} | REF:${item.segunda_descricao}`
    : item.descricao;
  await setValor(driver, "Descricao", descricaoCompleta);
  await driver.sleep(500);

  // Segunda Descrição (tabindex 14, textarea #Descricao_2)
  await setValor(driver, "Descricao_2", item.segunda_descricao || "");
  await driver.sleep(500);

  // Taxa (tabindex 17, id Taxa) — 25%
  await setValor(driver, "Taxa", "25");
  await driver.sleep(500);

  // Taxa Leiloeiro (tabindex 18, id Taxa_Leiloeiro) — 5%
  await setValor(driver, "Taxa_Leiloeiro", "5");
  await driver.sleep(500);

  // Desmarcar checkbox Site (tabindex 19)
  const checkboxSite = await driver.findElement(By.id("Site"));
  const marcado = await checkboxSite.isSelected();
  if (marcado) await checkboxSite.click();
  await driver.sleep(500);

  // Gravar Novo
  await driver
    .findElement(By.css('button.btn-grey[data-func^="gravacadpeca"]'))
    .click();

  // Aguardar sucesso OU erro do site
  await driver.wait(
    until.elementLocated(By.css("div.alert-success, div.alert-danger")),
    15000,
  );
  await driver.sleep(500);

  const alertEl = await driver.findElement(
    By.css("div.alert-success, div.alert-danger"),
  );
  const alertClass = await alertEl.getAttribute("class");
  const sucesso = alertClass.includes("alert-success");

  // Fechar sempre (modal não fecha sozinho)
  await driver.findElement(By.css("a.is-backbtn")).click();
  await driver.sleep(500);

  if (!sucesso) {
    const alertTexto = await alertEl.getText();
    throw new Error(alertTexto.trim() || "Site retornou erro ao gravar peça");
  }

  return true;
}

module.exports = {
  validarHeaderCSVCadastro,
  navegarParaCadastro,
  cadastrarPeca,
};
