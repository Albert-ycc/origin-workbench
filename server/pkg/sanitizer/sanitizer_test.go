package sanitizer

import "testing"

func TestSanitizeRules(t *testing.T) {
	cases := []struct {
		name  string
		input string
		want  string
	}{
		// Rule 1: 不是 A，而是 B → 而是 B
		{"rule1_not_but", "这不是我想要的，而是我需要的", "这而是我需要的"},
		{"rule1_not_but_no_comma", "我不是去上班而是去开会", "我而是去开会"},
		{"rule1_not_but_multiple", "他不是医生，而是营养师，不是顾问而是教练", "他而是营养师，而是教练"},

		// Rule 2: 破折号按前置字符
		{"rule2_dash_ascii", "hello——world", "hello. world"},
		{"rule2_dash_cjk", "你好——世界", "你好。世界"},
		{"rule2_single_dash_kept", "你好—世界", "你好—世界"},
		{"rule2_dash_at_start", "——开场", "。开场"},

		// Rule 3: 强调引号
		{"rule3_emphasis_stripped", "这就是『重点』", "这就是重点"},
		{"rule3_quote_kept_after_say", "他说『没问题』", "他说『没问题』"},
		{"rule3_quote_kept_after_colon", "他：『没问题』", "他：『没问题』"},
		{"rule3_quote_kept_after_biaoshi", "她表示『可以』", "她表示『可以』"},
		{"rule3_unclosed_quote_kept", "这是『重点", "这是『重点"},

		// Rule 4: 元叙事整句删除
		{"rule4_meta_narrative", "这句话背后其实有个原因。然后继续。", "然后继续。"},
		{"rule4_meta_narrative_direct", "这件事背后是有人推动的。", ""},
		{"rule4_not_meta_kept", "这句话后面有个原因。", "这句话后面有个原因。"},

		// Rule 5: 语气词堆叠合并
		{"rule5_modal_stacking", "我真的真的真的觉得", "我真的觉得"},
		{"rule5_modal_that_really", "其实其实可以", "其实可以"},
		{"rule5_modal_mixed", "确实确实确实不错", "确实不错"},
		{"rule5_single_kept", "我真的很开心", "我真的很开心"},

		// Rule 6: 网文情绪词子句删除
		{"rule6_emotion_clause", "你好，我真的破防了，再见", "你好，再见"},
		{"rule6_emotion_at_end", "这件事让我泪目了。", ""},
		{"rule6_no_emotion_kept", "你好，我很好，再见", "你好，我很好，再见"},

		// Compound: 多规则串行
		{"compound", "我真的真的破防了，这不是重点——好吧", "这不是重点。好吧"},
		{"compound_quote_then_dash", "他说『别急』，你——别慌", "他说『别急』，你。别慌"},

		// Boundaries
		{"empty", "", ""},
		{"ascii_only", "hello world", "hello world"},
		{"newline_preserved", "这句话背后有原因。\n下一行还在", "\n下一行还在"},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := Sanitize(c.input); got != c.want {
				t.Errorf("Sanitize(%q) = %q, want %q", c.input, got, c.want)
			}
		})
	}
}

func TestApplyNotButKeepsBHalf(t *testing.T) {
	if got := applyNotBut("这不是问题，而是机会"); got != "这而是机会" {
		t.Errorf("applyNotBut = %q, want %q", got, "这而是机会")
	}
}
