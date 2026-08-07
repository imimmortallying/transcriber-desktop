const { spawn } = require("node:child_process");
const { readFile } = require("node:fs/promises");
const path = require("node:path");

const pipelineDirectory = path.resolve(__dirname, "../../pipeline");
const pythonExecutable = process.env.ASR_PYTHON
  || path.join(pipelineDirectory, ".venv", "Scripts", "python.exe");
const pipelineConfig = path.join(pipelineDirectory, "config.json");

function runPython(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonExecutable, args, {
      cwd: pipelineDirectory,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", (error) => {
      reject(new Error(`Не удалось запустить Python: ${error.message}`));
    });
    child.once("close", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }

      reject(new Error(stderr.trim() || `Python-процесс завершился с кодом ${code}.`));
    });
  });
}

function readCliValue(output, name) {
  const match = output.match(new RegExp(`^${name}=(.+)$`, "m"));
  if (!match) {
    throw new Error(`Python-пайплайн не вернул поле ${name}.`);
  }
  return match[1].trim();
}

function normalizeSegment(segment) {
  return {
    text: typeof segment.text === "string" ? segment.text : "",
    start: Number.isFinite(segment.start) ? segment.start : null,
    end: Number.isFinite(segment.end) ? segment.end : null,
    confidence: Number.isFinite(segment.confidence) ? segment.confidence : null,
  };
}

async function runRecognition(inputPath, { onProgress = () => {} } = {}) {
  onProgress("Подготавливаю аудио…");
  const preprocessOutput = await runPython([
    "-m",
    "asr_pipeline.cli",
    "--config",
    pipelineConfig,
    "preprocess",
    inputPath,
  ]);
  const runId = readCliValue(preprocessOutput, "run_id");

  onProgress("Распознаю речь…");
  const asrOutput = await runPython([
    "-m",
    "asr_pipeline.cli",
    "--config",
    pipelineConfig,
    "asr",
    runId,
  ]);
  const transcriptPath = readCliValue(asrOutput, "transcript");
  const [transcript, rawSegments] = await Promise.all([
    readFile(transcriptPath, "utf8"),
    readFile(path.join(path.dirname(transcriptPath), "segments_asr.json"), "utf8"),
  ]);
  const parsedSegments = JSON.parse(rawSegments);

  return {
    transcript,
    segments: Array.isArray(parsedSegments) ? parsedSegments.map(normalizeSegment) : [],
  };
}

module.exports = { runRecognition };
