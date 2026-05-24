import assert from "node:assert/strict";
import test from "node:test";
import { normalizeWhisperJson } from "./meeting-asr-whisper.mjs";

test("normalizeWhisperJson converts OpenAI Whisper JSON into meeting ASR segments", () => {
  const output = normalizeWhisperJson({
    segments: [
      { start: 1.25, text: " 预算下周确认 " },
      { start: 3, text: "我们先补方案" },
      { start: 4, text: "   " },
    ],
  });

  assert.deepEqual(output, {
    segments: [
      {
        speaker_label: "录音转写",
        text: "预算下周确认",
        start: 1.25,
      },
      {
        speaker_label: "录音转写",
        text: "我们先补方案",
        start: 3,
      },
    ],
  });
});

test("normalizeWhisperJson rejects empty transcript output", () => {
  assert.throws(
    () => normalizeWhisperJson({ segments: [{ start: 0, text: " " }] }),
    /no usable transcript/,
  );
});
