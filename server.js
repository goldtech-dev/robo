const express = require("express");
const multer = require("multer");
const path = require("path");
const {
  lerCSVBuffer,
  validarHeaderCSV,
  criarDriver,
  fazerLogin,
  processarLote,
  DELAY_ENTRE_ITENS,
} = require("./index");

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(express.static(path.join(__dirname, "public")));

// SSE — clientes conectados aguardando progresso
let sseClients = [];

app.get("/progresso", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  sseClients.push(res);
  req.on("close", () => {
    sseClients = sseClients.filter((c) => c !== res);
  });
});

function emit(data) {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach((c) => c.write(payload));
}

// Etapa 1 — valida CSV e retorna preview antes de iniciar o Chrome
app.post("/validar", upload.single("csv"), (req, res) => {
  const { username, password, numeroLeilao } = req.body;

  if (!req.file || !username || !password || !numeroLeilao) {
    return res
      .status(400)
      .json({ erro: "Preencha todos os campos e envie o CSV." });
  }

  let lotes;
  try {
    lotes = lerCSVBuffer(req.file.buffer);
  } catch (e) {
    return res
      .status(400)
      .json({ erro: "Não foi possível ler o CSV: " + e.message });
  }

  const erroHeader = validarHeaderCSV(lotes);
  if (erroHeader) {
    return res.status(400).json({ erro: erroHeader });
  }

  // Armazena temporariamente para /iniciar usar sem novo upload
  req.app.locals.pendente = { username, password, numeroLeilao, lotes };

  res.json({ ok: true, total: lotes.length });
});

// Etapa 2 — usuário confirmou no front, inicia o Chrome
app.post("/iniciar", (req, res) => {
  const pendente = req.app.locals.pendente;

  if (!pendente) {
    return res.status(400).json({
      erro: "Nenhuma sessão pendente. Faça o upload do CSV primeiro.",
    });
  }

  req.app.locals.pendente = null;
  res.json({ ok: true });

  const { username, password, numeroLeilao, lotes } = pendente;

  (async () => {
    const resultados = { sucesso: [], erro: [] };
    let driver;

    try {
      emit({ tipo: "status", msg: "Iniciando Chrome..." });
      driver = await criarDriver();

      emit({ tipo: "status", msg: "Fazendo login..." });
      await fazerLogin(driver, username, password, numeroLeilao);
      emit({ tipo: "status", msg: "Login OK. Processando lotes..." });

      for (let i = 0; i < lotes.length; i++) {
        const item = lotes[i];
        emit({
          tipo: "progresso",
          indice: i + 1,
          total: lotes.length,
          descricao: item.MiniDescrição,
        });

        try {
          const sucesso = await processarLote(driver, item);
          if (sucesso) {
            resultados.sucesso.push(item);
            emit({
              tipo: "lote",
              indice: i + 1,
              total: lotes.length,
              descricao: item.MiniDescrição,
              status: "sucesso",
            });
          } else {
            resultados.erro.push({ ...item, motivo: "servidor retornou erro" });
            emit({
              tipo: "lote",
              indice: i + 1,
              total: lotes.length,
              descricao: item.MiniDescrição,
              status: "erro",
              motivo: "servidor retornou erro",
            });
          }
        } catch (e) {
          resultados.erro.push({ ...item, motivo: e.message });
          emit({
            tipo: "lote",
            indice: i + 1,
            total: lotes.length,
            descricao: item.MiniDescrição,
            status: "erro",
            motivo: e.message,
          });
        }

        await driver.sleep(DELAY_ENTRE_ITENS);
      }
    } catch (e) {
      emit({ tipo: "erro_fatal", msg: e.message });
    } finally {
      if (driver) await driver.quit();
    }

    const linhas = [
      "Status,Lote,MiniDescrição,NumeroLeilao,Motivo",
      ...resultados.sucesso.map(
        (r) => `sucesso,${r.Lote},${r.MiniDescrição},${r.NumeroLeilao},`,
      ),
      ...resultados.erro.map(
        (r) =>
          `erro,${r.Lote},${r.MiniDescrição},${r.NumeroLeilao},"${r.motivo}"`,
      ),
    ];

    emit({
      tipo: "fim",
      sucesso: resultados.sucesso.length,
      erros: resultados.erro.length,
      relatorioCSV: linhas.join("\n"),
    });
  })();
});

const PORT = 4000;
app.listen(PORT, () => {
  console.log(`Robô Leilão rodando em http://localhost:${PORT}`);
});
