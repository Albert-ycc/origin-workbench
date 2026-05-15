import { describe, expect, it } from "vitest";
import { collectFinalTranscript } from "./live-transcription";

describe("collectFinalTranscript", () => {
  it("joins final speech recognition alternatives from resultIndex onward", () => {
    const event = {
      resultIndex: 1,
      results: [
        { isFinal: true, 0: { transcript: "忽略旧结果" } },
        { isFinal: false, 0: { transcript: "临时文本" } },
        { isFinal: true, 0: { transcript: "这个版本既要月底上线" } },
        { isFinal: true, 0: { transcript: "又要风险清零" } },
      ],
    };

    expect(collectFinalTranscript(event)).toBe("这个版本既要月底上线 又要风险清零");
  });
});
