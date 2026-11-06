"use strict";

const PDFDocument = require("pdfkit");

/**
 * Relatório de desempenho do jogador em PDF (A4).
 * O PDF é montado em memória e só depois enviado: se algo falhar no
 * meio, a API ainda consegue responder com um erro JSON.
 */

const PHASE_TITLES = {
  1: "O Mistério da Bússola",
  2: "Paisagens pelo Brasil",
  3: "Clima na Expedição",
  4: "Biomas e Sustentabilidade"
};

const AVATAR_NAMES = { ae: "Aê (tucano)", onca: "Jagu (onça)", tartaruga: "Tuca (tartaruga)" };

const GREEN = "#07543d";
const INK = "#222222";
const MUTED = "#666666";

function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(total / 60);
  const secs = total % 60;

  return `${minutes}min ${String(secs).padStart(2, "0")}s`;
}

/** Remove caracteres que as fontes padrão do PDF não desenham (ex.: emoji). */
function safePdfText(value) {
  return String(value ?? "").replace(/[^\x20-\x7EÀ-ÿ]/g, "");
}

function reportFilename(nickname) {
  const safe = String(nickname || "jogador")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .toLowerCase();

  return `relatorio-rota-brasil-${safe}.pdf`;
}

function heading(doc, text) {
  doc.moveDown(0.6).fontSize(16).fillColor(GREEN).text(text);
  doc.moveDown(0.4).fontSize(11).fillColor(INK);
}

function buildPerformancePdf({ player, progress, results }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 50,
      info: {
        Title: "Relatório de Desempenho - Rota Brasil",
        Author: "Rota Brasil: A Expedição de Aê",
        Subject: "Relatório de desempenho do jogador"
      }
    });

    const chunks = [];

    doc.on("data", chunk => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(24).fillColor(GREEN).text("ROTA BRASIL", { align: "center" });
    doc.fontSize(16).fillColor("#18332c").text("A Expedição de Aê", { align: "center" });
    doc.moveDown();
    doc.fontSize(18).fillColor(GREEN).text("RELATÓRIO DE DESEMPENHO", { align: "center" });
    doc.moveDown();

    doc.fontSize(12).fillColor(INK);
    doc.text(`Jogador: ${safePdfText(player.nickname || "Explorador")}`);
    doc.text(`Companheiro: ${safePdfText(AVATAR_NAMES[player.avatar] || player.avatar || "Aê")}`);
    doc.text(`Fase atual: ${progress.currentPhase || 1}`);

    heading(doc, "RESUMO DA EXPEDIÇÃO");
    doc.fontSize(12);
    doc.text(`Pontuação: ${progress.score || 0} pontos`);
    doc.text(`Estrelas: ${progress.stars || 0}`);
    doc.text(`Fases concluídas: ${(progress.completedPhases || []).length} de 4`);
    doc.text(
      `Fase bônus: ${
        progress.bonusCompleted
          ? `concluída (selo ${progress.bonusSeal === "gold" ? "dourado" : "prateado"})`
          : "ainda não concluída"
      }`
    );
    doc.text(`Tempo total: ${formatDuration(progress.totalTimeSeconds)}`);

    heading(doc, "RESULTADOS POR FASE");

    if (!results.length) {
      doc.fillColor("#555555").text("Ainda não existem resultados detalhados registrados.");
    } else {
      const playsByPhase = {};

      results.forEach(result => {
        playsByPhase[result.phase] = (playsByPhase[result.phase] || 0) + 1;

        const title = PHASE_TITLES[result.phase] ? ` - ${PHASE_TITLES[result.phase]}` : "";
        const play = playsByPhase[result.phase] > 1 ? ` (partida ${playsByPhase[result.phase]})` : "";

        doc.fontSize(13).fillColor(GREEN).text(`Fase ${result.phase}${title}${play}`);
        doc
          .fontSize(11)
          .fillColor(INK)
          .text(
            `${result.completed ? "Concluída" : "Não concluída"}  |  Pontos: ${result.score || 0}  |  ` +
              `Estrelas: ${result.stars || 0}  |  Tentativas: ${result.attempts || 0}  |  ` +
              `Erros: ${result.errors || 0}  |  Tempo: ${formatDuration(result.timeSeconds)}`
          );
        doc.moveDown(0.6);
      });
    }

    heading(doc, "ACESSIBILIDADE UTILIZADA");

    const accessibility = progress.accessibility || {};
    const onOff = (value, female = false) =>
      value ? (female ? "Ativada" : "Ativado") : female ? "Desativada" : "Desativado";

    doc.text(`Narração: ${onOff(accessibility.narration, true)}`);
    doc.text(`Alto contraste: ${onOff(accessibility.highContrast)}`);
    doc.text(`Movimentos reduzidos: ${onOff(accessibility.reducedMotion)}`);
    doc.text(`Fonte para dislexia: ${onOff(accessibility.dyslexiaFont, true)}`);

    doc.moveDown(2);
    doc
      .fontSize(9)
      .fillColor(MUTED)
      .text(
        `Relatório gerado em ${new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })} pelo sistema Rota Brasil.`,
        { align: "center" }
      );

    doc.end();
  });
}

module.exports = { buildPerformancePdf, reportFilename, formatDuration };
