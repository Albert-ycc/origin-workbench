#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export function normalizeWhisperJson(input) {
  const rawSegments = Array.isArray(input?.segments) ? input.segments : [];
  const segments = rawSegments
    .map((segment) => {
      const text = String(segment?.text ?? "").trim();
      if (!text) return null;
      const out = {
        speaker_label: String(segment?.speaker_label ?? segment?.speaker ?? "录音转写").trim() || "录音转写",
        text,
      };
      const start = Number(segment?.start);
      if (Number.isFinite(start) && start >= 0) out.start = start;
      const confidence = Number(segment?.confidence);
      if (Number.isFinite(confidence) && confidence >= 0 && confidence <= 1) out.confidence = confidence;
      return out;
    })
    .filter(Boolean);

  if (segments.length === 0) {
    throw new Error("Whisper output contained no usable transcript segments");
  }
  return { segments };
}

function readWhisperJson(outputDir) {
  const jsonFile = readdirSync(outputDir).find((name) => name.endsWith(".json"));
  if (!jsonFile) {
    throw new Error("Whisper command did not produce a JSON output file");
  }
  return JSON.parse(readFileSync(join(outputDir, jsonFile), "utf8"));
}

function buildWhisperArgs(audioPath, outputDir) {
  const args = [
    audioPath,
    "--output_format",
    "json",
    "--output_dir",
    outputDir,
    "--verbose",
    "False",
  ];
  const model = process.env.MEETING_ASR_WHISPER_MODEL?.trim();
  if (model) args.push("--model", model);
  const language = process.env.MEETING_ASR_WHISPER_LANGUAGE?.trim();
  if (language) args.push("--language", language);
  return args;
}

export function runWhisper(audioPath) {
  if (!audioPath) {
    throw new Error("usage: meeting-asr-whisper.mjs <audio-file>");
  }
  const command = process.env.MEETING_ASR_WHISPER_COMMAND?.trim() || "whisper";
  const outputDir = mkdtempSync(join(tmpdir(), "origin-meeting-whisper-"));
  try {
    const result = spawnSync(command, buildWhisperArgs(audioPath, outputDir), {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      shell: false,
    });
    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0) {
      const stderr = String(result.stderr ?? "").trim();
      throw new Error(stderr || `Whisper command exited with status ${result.status}`);
    }
    return normalizeWhisperJson(readWhisperJson(outputDir));
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
}

function main() {
  try {
    const audioPath = process.argv.at(-1);
    const result = runWhisper(audioPath);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`meeting-asr-whisper: ${message}\n`);
    process.exitCode = message.includes("ENOENT") ? 127 : 1;
  }
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entry) {
  main();
}
