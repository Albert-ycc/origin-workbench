import { describe, expect, it } from "vitest";
import {
  runtimeDangerConfirmations,
  runtimePageSubtitle,
  runtimePrimarySurface,
  runtimeStatusFilterCopy,
} from "./runtimes-page";
import { runtimeRowMenuLabels } from "./runtime-columns";

describe("RuntimesPage IA", () => {
  it("keeps the runtime page focused on operational scanning", () => {
    expect(runtimePrimarySurface).toEqual({
      title: "能力池",
      primaryCta: "添加能力来源",
      controls: ["搜索", "范围", "状态筛选"],
    });
  });

  it("keeps runtime status explanation short and filter-oriented", () => {
    expect(runtimePageSubtitle.length).toBeLessThanOrEqual(42);
    expect(runtimePageSubtitle).toBe("扫描本机和外部能力来源，按状态快速定位。");
    expect(runtimeStatusFilterCopy).toEqual(["全部", "在线", "刚刚断开", "离线", "即将清理"]);
  });

  it("uses an explicit row more menu for runtime actions", () => {
    expect(runtimeRowMenuLabels).toEqual({
      trigger: "能力来源行操作",
      createAgent: "创建智能体",
      delete: "删除",
    });
  });

  it("keeps runtime delete behind confirmation", () => {
    expect(runtimeDangerConfirmations).toEqual({
      runtimeDelete: "alert-dialog",
    });
  });
});
