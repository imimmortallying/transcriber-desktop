const { spawn } = require("node:child_process");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const { getCurrentRuntime, validateRuntime } = require("../runtime/resolveRuntime");
const runAsrPipelineCli = [
  "import runpy, sys",
  "sys.path.insert(0, sys.argv.pop(1))",
  "sys.argv[0] = 'asr_pipeline.cli'",
  "runpy.run_module('asr_pipeline.cli', run_name='__main__')",
].join("; ");

function runPython(runtime, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(runtime.pythonExecutable, [
      "-c",
      runAsrPipelineCli,
      runtime.pipelineDirectory,
      ...args,
    ], {
      cwd: runtime.pipelineDirectory,
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

function probePythonImport(runtime, moduleName) {
  return new Promise((resolve) => {
    let settled = false;
    let timeout;
    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };
    let child;
    try {
      child = spawn(runtime.pythonExecutable, [
        "-c",
        `import importlib; module = importlib.import_module(${JSON.stringify(moduleName)}); print(getattr(module, '__version__', 'loaded'))`,
      ], {
        cwd: runtime.pipelineDirectory,
        windowsHide: true,
      });
    } catch (error) {
      finish({ name: moduleName, ok: false, detail: error.message });
      return;
    }

    timeout = setTimeout(() => {
      child.kill();
      finish({ name: moduleName, ok: false, detail: "Import probe timed out after 10 seconds." });
    }, 10_000);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", (error) => {
      finish({ name: moduleName, ok: false, detail: error.message });
    });
    child.once("close", (code) => {
      finish({
        name: moduleName,
        ok: code === 0,
        detail: code === 0 ? stdout.trim() : (stderr.trim() || `Python exited with code ${code}.`),
      });
    });
  });
}

async function probeRecognitionRuntime(runtime) {
  const checks = [];
  for (const moduleName of ["torch", "torchaudio", "soundfile", "onnxruntime"]) {
    checks.push(await probePythonImport(runtime, moduleName));
  }
  return checks;
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
    speaker: typeof segment.speaker === "string" ? segment.speaker : null,
  };
}

async function readSavedSegments(segmentsPath) {
  const rawSegments = await readFile(segmentsPath, "utf8");
  let parsedSegments;
  try {
    parsedSegments = JSON.parse(rawSegments);
  } catch {
    throw new Error("Файл segments_asr.json содержит некорректный JSON.");
  }

  if (!Array.isArray(parsedSegments)) {
    throw new Error("Файл segments_asr.json должен содержать массив сегментов.");
  }

  return parsedSegments.map(normalizeSegment);
}

async function runRecognition(inputPath, { dataDirectory, onProgress = () => {} } = {}) {
  if (typeof dataDirectory !== "string" || !dataDirectory) {
    throw new Error("Не задана папка для результатов распознавания.");
  }

  const runtime = await validateRuntime(getCurrentRuntime());
  const configArguments = ["--config", runtime.pipelineConfigPath, "--data-dir", dataDirectory];
  onProgress("Подготавливаю аудио…");
  const preprocessOutput = await runPython(runtime, [
    ...configArguments,
    "preprocess",
    inputPath,
  ]);
  const runId = readCliValue(preprocessOutput, "run_id");

  onProgress("Распознаю речь…");
  const asrOutput = await runPython(runtime, [
    ...configArguments,
    "asr",
    runId,
  ]);
  const transcriptPath = readCliValue(asrOutput, "transcript");
  const segmentsPath = path.join(path.dirname(transcriptPath), "segments_asr.json");
  const [transcript, segments] = await Promise.all([
    readFile(transcriptPath, "utf8"),
    readSavedSegments(segmentsPath),
  ]);

  return {
    runId,
    transcript,
    segments,
    segmentsPath,
  };
}

module.exports = { probeRecognitionRuntime, readSavedSegments, runRecognition };
