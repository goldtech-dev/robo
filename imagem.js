const { By, until } = require("selenium-webdriver");
const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");
const os = require("os");
require("dotenv").config();

// Colunas obrigatórias + opcionais do CSV
// mini_descricao, key_principal, key_extra_1..5
const CAMPOS_CSV_IMAGEM = ["mini_descricao", "key_principal"];

function validarHeaderCSVImagem(lotes) {
  if (lotes.length === 0) return "O CSV não contém dados.";
  const keys = Object.keys(lotes[0]);
  const faltando = CAMPOS_CSV_IMAGEM.filter((c) => !keys.includes(c));
  if (faltando.length > 0) {
    return `Coluna(s) ausente(s) ou com nome errado no CSV: ${faltando.join(", ")}. Obrigatórias: ${CAMPOS_CSV_IMAGEM.join(", ")}.`;
  }
  return null;
}

function extrasDoCsvItem(item) {
  return [1, 2, 3, 4, 5]
    .map((n) => item[`key_extra_${n}`])
    .filter((k) => k && k.trim() !== "");
}

function criarS3Client() {
  return new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
}

async function baixarDoR2(s3, key) {
  const cmd = new GetObjectCommand({
    Bucket: process.env.R2_BUCKET,
    Key: key,
  });
  const resp = await s3.send(cmd);
  const chunks = [];
  for await (const chunk of resp.Body) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function processAndResizeImage(
  inputBuffer,
  maxDimension = 1200,
  maxSizeMb = 1.8,
) {
  const maxSizeInBytes = maxSizeMb * 1024 * 1024;
  const imagePipeline = sharp(inputBuffer).rotate().resize({
    width: maxDimension,
    height: maxDimension,
    fit: "inside",
    withoutEnlargement: true,
  });

  let quality = 90;
  let finalBuffer;

  do {
    if (quality < 20)
      throw new Error(
        "Não foi possível redimensionar a imagem para o tamanho desejado.",
      );
    finalBuffer = await imagePipeline
      .jpeg({ quality, progressive: true, mozjpeg: true })
      .toBuffer();
    quality -= 10;
  } while (finalBuffer.byteLength > maxSizeInBytes);

  return finalBuffer;
}

async function salvarTmp(buffer, nomeBase) {
  const nomeSanitizado =
    nomeBase.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/\.(jpeg|jpg)$/i, "") +
    ".jpg";
  const tmpPath = path.join(
    os.tmpdir(),
    `robo_img_${Date.now()}_${nomeSanitizado}`,
  );
  await fs.promises.writeFile(tmpPath, buffer);
  return tmpPath;
}

async function limparArquivos(caminhos) {
  for (const p of caminhos) {
    try {
      await fs.promises.unlink(p);
    } catch (_) {}
  }
}

async function fecharResponseModal(driver) {
  // Aguarda o modal aparecer e clica no X via JS
  try {
    await driver.sleep(2500);
    await driver.executeScript(`
      var btn = document.querySelector('#responsemodal .close[data-dismiss="modal"]');
      if (btn) btn.click();
    `);
    await driver.sleep(600);
  } catch (_) {}
}

async function uploadImagem(driver, item) {
  const s3 = criarS3Client();
  const tmpFiles = [];

  try {
    const keyPrincipal = item.key_principal && item.key_principal.trim();
    const keysExtras = extrasDoCsvItem(item);

    if (!keyPrincipal && keysExtras.length === 0) {
      throw new Error("Nenhuma key de imagem informada no CSV para esta peça.");
    }

    // 1. Garantir que está na tela de listagem — aguarda preload sumir e campo ser um input
    await driver.wait(
      until.elementLocated(By.css('button.btn-yellow[data-func^="pesquisapeca"]')),
      10000,
    );
    // Aguarda div de preload desaparecer antes de interagir
    await driver.wait(async () => {
      const preloads = await driver.findElements(By.css("div.preload-fix"));
      for (const el of preloads) {
        const visible = await el.isDisplayed().catch(() => false);
        if (visible) return false;
      }
      return true;
    }, 10000).catch(() => {});

    const campoBusca = await driver.wait(
      until.elementLocated(By.id("Descricao")),
      5000,
    );
    // Se #Descricao for textarea, ainda está na tela de edição — aguarda navegação
    const tagName = await campoBusca.getTagName();
    if (tagName.toLowerCase() !== "input") {
      // Tenta clicar em voltar e aguardar a listagem
      await driver.findElement(By.css("a.is-backbtn")).click().catch(() => {});
      await driver.wait(
        until.elementLocated(By.css('button.btn-yellow[data-func^="pesquisapeca"]')),
        10000,
      );
      await driver.wait(async () => {
        const preloads = await driver.findElements(By.css("div.preload-fix"));
        for (const el of preloads) {
          const visible = await el.isDisplayed().catch(() => false);
          if (visible) return false;
        }
        return true;
      }, 8000).catch(() => {});
    }

    const campoBuscaFinal = await driver.findElement(By.id("Descricao"));
    await campoBuscaFinal.clear();
    await driver.sleep(200);
    await campoBuscaFinal.sendKeys(item.mini_descricao);
    await driver.sleep(500);

    // 2. Clicar em Pesquisar
    await driver
      .findElement(By.css('button.btn-yellow[data-func^="pesquisapeca"]'))
      .click();

    // 3. Aguardar resultados e preload sumir
    await driver.wait(until.elementLocated(By.css("table tbody tr")), 8000);
    await driver.wait(async () => {
      const preloads = await driver.findElements(By.css("div.preload-fix"));
      for (const el of preloads) {
        const visible = await el.isDisplayed().catch(() => false);
        if (visible) return false;
      }
      return true;
    }, 8000).catch(() => {});
    await driver.sleep(300);

    // 4. Clicar no botão editar via JS (evita intercepção por preload residual)
    const btnEditar = await driver.findElement(
      By.css('a.is-color3[data-func^="editapeca"]'),
    );
    await driver.executeScript("arguments[0].click();", btnEditar);

    // 5. Aguardar tela de edição carregar
    await driver.wait(
      until.elementLocated(By.css('a[data-func^="subirimgpeca"]')),
      12000,
    );
    // Aguarda preload da tela de edição sumir antes de interagir
    await driver.wait(async () => {
      const preloads = await driver.findElements(By.css("div.preload-fix"));
      for (const el of preloads) {
        const visible = await el.isDisplayed().catch(() => false);
        if (visible) return false;
      }
      return true;
    }, 10000).catch(() => {});

    // === UPLOAD IMAGEM PRINCIPAL ===
    if (keyPrincipal) {
      const buffer = await baixarDoR2(s3, keyPrincipal);
      const bufferResized = await processAndResizeImage(buffer);
      const nomeBase = path.basename(keyPrincipal);
      const tmpPath = await salvarTmp(bufferResized, nomeBase);
      tmpFiles.push(tmpPath);

      const btnSubirImg = await driver.findElement(
        By.css('a[data-func^="subirimgpeca"]'),
      );
      await driver.executeScript("arguments[0].click();", btnSubirImg);
      await driver.sleep(2000);

      const inputFilePrincipal = await driver.wait(
        until.elementLocated(By.css(".modal input[type=file]")),
        10000,
      );
      await driver.sleep(200);
      await driver.executeScript(
        "arguments[0].style.display='block'; arguments[0].style.opacity='1'; arguments[0].style.visibility='visible';",
        inputFilePrincipal,
      );
      await inputFilePrincipal.sendKeys(tmpPath);
      await driver.sleep(1500);

      await driver
        .findElement(By.css('a.fileinput-upload[href*="img_pecas"]'))
        .click();

      await driver
        .wait(
          until.stalenessOf(
            await driver
              .findElement(By.css(".modal-backdrop"))
              .catch(() => ({ isStale: () => true })),
          ),
          15000,
        )
        .catch(() => {});

      // Fechar modal de sucesso clicando no X via JS
      await fecharResponseModal(driver);
    }

    // === UPLOAD IMAGENS EXTRAS ===
    if (keysExtras.length > 0) {
      const tmpPaths = [];
      for (const key of keysExtras) {
        const buffer = await baixarDoR2(s3, key);
        const bufferResized = await processAndResizeImage(buffer);
        const nomeBase = path.basename(key);
        const tmpPath = await salvarTmp(bufferResized, nomeBase);
        tmpFiles.push(tmpPath);
        tmpPaths.push(tmpPath);
      }

      // Abrir modal de extras uma vez e enviar todos os arquivos
      const botoesExtras = await driver.findElements(
        By.css('a[data-func^="geremimgpeca"]'),
      );
      const btnExtra = botoesExtras[botoesExtras.length - 1];
      await driver.executeScript(
        "arguments[0].scrollIntoView({block:'center'}); arguments[0].click();",
        btnExtra,
      );
      await driver.sleep(2000);

      const inputFileExtra = await driver.wait(
        until.elementLocated(By.css(".modal input[type=file]")),
        10000,
      );
      await driver.executeScript(
        "arguments[0].style.display='block'; arguments[0].style.opacity='1'; arguments[0].style.visibility='visible';",
        inputFileExtra,
      );

      // sendKeys múltiplas vezes no mesmo input acumula os arquivos
      for (const tmpPath of tmpPaths) {
        await inputFileExtra.sendKeys(tmpPath);
        await driver.sleep(300);
      }
      await driver.sleep(500);

      await driver
        .findElement(By.css('a.fileinput-upload[href*="img_pecas_extras"]'))
        .click();

      await driver.sleep(2000);
      await fecharResponseModal(driver);
    }

    // === ATIVAR NO SITE ===
    const valorContratado = await driver
      .findElement(By.id("Valor_Contratado"))
      .getAttribute("value")
      .catch(() => "");

    const valorNumerico = parseFloat(
      (valorContratado || "").replace(/\./g, "").replace(",", "."),
    );
    const temPreco = !isNaN(valorNumerico) && valorNumerico > 0;

    if (temPreco) {
      const checkboxSite = await driver
        .findElement(By.id("Site"))
        .catch(() =>
          driver.findElement(
            By.xpath('//label[contains(text(),"Site")]/../input'),
          ),
        );

      const isChecked = await checkboxSite.isSelected();
      if (!isChecked) {
        await checkboxSite.click();
      }
    }

    await driver
      .findElement(By.css('button.btn-yellow[data-func^="gravacadpeca"]'))
      .click();

    await driver.wait(
      until.elementLocated(By.css("div.alert-success, div.alert-danger")),
      8000,
    );

    const alertEl = await driver.findElement(
      By.css("div.alert-success, div.alert-danger"),
    );
    const alertClass = await alertEl.getAttribute("class");
    const sucesso = alertClass.includes("alert-success");

    // Aguarda o botão voltar ficar visível e clicável (após animação do alert terminar)
    const backBtn = await driver.wait(
      until.elementIsVisible(
        await driver.findElement(By.css("a.is-backbtn")),
      ),
      8000,
    );
    await driver.wait(until.elementIsEnabled(backBtn), 3000);
    await backBtn.click();
    await driver.wait(until.elementLocated(By.id("Descricao")), 10000);

    return sucesso;
  } finally {
    await limparArquivos(tmpFiles);
  }
}

module.exports = {
  validarHeaderCSVImagem,
  uploadImagem,
};
