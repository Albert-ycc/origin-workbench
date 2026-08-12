// Package sanitizer removes writing-taboo patterns from Chinese agent copy.
//
// The rules mirror the hard-coded safety net in personabible.Inject, but run
// after the model emits text: whatever the model produced, the stored copy is
// free of the banned phrasing. Each rule is a hand-rolled rune scan — no
// regexp — so the emphasis-quote rule can look back at preceding context the
// way ReplaceAllStringFunc callbacks cannot.
package sanitizer

import "strings"

// Sanitize removes all writing-taboo patterns from s. Rules run in a fixed
// order; each one feeds the next so compound sentences are cleaned in one
// pass. Rule 7 (heading-level style) is intentionally out of scope for this
// layer — it is enforced by the prompt, not post-hoc text munging.
func Sanitize(s string) string {
	s = applyNotBut(s)
	s = applyDash(s)
	s = applyEmphasisQuote(s)
	s = applyMetaNarrative(s)
	s = applyModalStacking(s)
	s = applyWebNovelEmotion(s)
	return s
}

// Rule 1: 「不是 A，而是 B」→ drop everything from 不是 up to (but not
// including) 而是, keeping the 而是 B half.
func applyNotBut(s string) string {
	runes := []rune(s)
	var b strings.Builder
	for i := 0; i < len(runes); {
		if hasPrefixAt(runes, i, "不是") {
			j := i + 2
			for j < len(runes) && !hasPrefixAt(runes, j, "而是") {
				j++
			}
			if j < len(runes) {
				// j points at 而是; consume both runes and emit the kept half
				// in one go so the loop does not re-print 而 and 是.
				i = j + 2
				b.WriteString("而是")
				continue
			}
		}
		b.WriteRune(runes[i])
		i++
	}
	return b.String()
}

// Rule 2: 破折号「——」becomes a full stop. The replacement follows the
// character right before the dash: ASCII → ". " (English period + space),
// non-ASCII → "。" (Chinese full stop). A dash pair at the very start has no
// predecessor and is treated as Chinese context.
func applyDash(s string) string {
	runes := []rune(s)
	var b strings.Builder
	for i := 0; i < len(runes); i++ {
		if runes[i] == '—' && i+1 < len(runes) && runes[i+1] == '—' {
			var prev rune
			if i > 0 {
				prev = runes[i-1]
			}
			if prev > 0 && prev < 0x80 {
				b.WriteString(". ")
			} else {
				b.WriteString("。")
			}
			i++
			continue
		}
		b.WriteRune(runes[i])
	}
	return b.String()
}

// Rule 3: emphasis quotes 「『…』」are dropped, but kept when they quote
// speech. hasQuoteTrigger decides by scanning backward from the opening
// quote for a speech verb (: / : / 说 / 称 / 表示), stopping at a strong
// clause boundary so a previous sentence's verb never bleeds in.
func applyEmphasisQuote(s string) string {
	runes := []rune(s)
	var b strings.Builder
	for i := 0; i < len(runes); i++ {
		if runes[i] != '『' {
			b.WriteRune(runes[i])
			continue
		}
		end := -1
		for j := i + 1; j < len(runes); j++ {
			if runes[j] == '』' {
				end = j
				break
			}
		}
		if end < 0 {
			b.WriteRune(runes[i])
			continue
		}
		if hasQuoteTrigger(runes, i) {
			b.WriteRune(runes[i])
			continue
		}
		b.WriteString(string(runes[i+1 : end]))
		i = end
	}
	return b.String()
}

func hasQuoteTrigger(runes []rune, idx int) bool {
	const lookback = 20
	for i := idx - 1; i >= 0 && i >= idx-lookback; i-- {
		switch runes[i] {
		case '，', ',', '。', '！', '？', '；', '、', '\n':
			return false
		case '：', ':', '说', '称':
			return true
		case '表':
			if i+1 < idx && runes[i+1] == '示' {
				return true
			}
		}
	}
	return false
}

// Rule 4: meta-narrative sentences「(这句话|这件事)背后(其实)?(有|是)…」are
// deleted whole, from the previous sentence boundary through the closing
// full stop (the newline itself is preserved so line structure survives).
func applyMetaNarrative(s string) string {
	runes := []rune(s)
	var b strings.Builder
	i := 0
	for i < len(runes) {
		start := findMetaNarrativeStart(runes, i)
		if start < 0 {
			b.WriteString(string(runes[i:]))
			break
		}
		sentStart := prevSentenceBoundary(runes, start)
		b.WriteString(string(runes[i:sentStart]))
		i = nextSentenceEnd(runes, start)
	}
	return b.String()
}

func findMetaNarrativeStart(runes []rune, from int) int {
	for i := from; i < len(runes); i++ {
		if !hasPrefixAt(runes, i, "这句话") && !hasPrefixAt(runes, i, "这件事") {
			continue
		}
		k := i + 3
		if !hasPrefixAt(runes, k, "背后") {
			continue
		}
		k += 2
		if hasPrefixAt(runes, k, "其实") {
			k += 2
		}
		if k < len(runes) && (runes[k] == '有' || runes[k] == '是') {
			return i
		}
	}
	return -1
}

func prevSentenceBoundary(runes []rune, idx int) int {
	for i := idx - 1; i >= 0; i-- {
		switch runes[i] {
		case '。', '！', '？', '\n':
			return i + 1
		}
	}
	return 0
}

func nextSentenceEnd(runes []rune, idx int) int {
	for i := idx; i < len(runes); i++ {
		switch runes[i] {
		case '。', '！', '？':
			return i + 1
		case '\n':
			return i
		}
	}
	return len(runes)
}

// Rule 5: stacked modal particles「真的 / 其实 / 确实」appearing two or more
// times in a row collapse to a single occurrence.
func applyModalStacking(s string) string {
	runes := []rune(s)
	var b strings.Builder
	for i := 0; i < len(runes); {
		word, wlen := modalWordAt(runes, i)
		if wlen == 0 {
			b.WriteRune(runes[i])
			i++
			continue
		}
		b.WriteString(word)
		i += wlen
		for i < len(runes) {
			if _, wl := modalWordAt(runes, i); wl > 0 {
				i += wl
			} else {
				break
			}
		}
	}
	return b.String()
}

func modalWordAt(runes []rune, i int) (string, int) {
	for _, w := range []string{"真的", "其实", "确实"} {
		if hasPrefixAt(runes, i, w) {
			return w, len([]rune(w))
		}
	}
	return "", 0
}

// Rule 6: web-novel emotion words「破防了 / 刺穿了 / 泪目了」delete their whole
// clause (comma-delimited segment) including the trailing delimiter.
func applyWebNovelEmotion(s string) string {
	runes := []rune(s)
	var b strings.Builder
	segStart := 0
	for i := 0; i < len(runes); i++ {
		if isClauseDelim(runes[i]) {
			if !containsEmotion(runes[segStart:i]) {
				b.WriteString(string(runes[segStart : i+1]))
			}
			segStart = i + 1
		}
	}
	if segStart < len(runes) && !containsEmotion(runes[segStart:]) {
		b.WriteString(string(runes[segStart:]))
	}
	return b.String()
}

func isClauseDelim(r rune) bool {
	switch r {
	case '，', ',', '。', '！', '？', '；', '、', '\n':
		return true
	}
	return false
}

func containsEmotion(runes []rune) bool {
	for _, w := range []string{"破防了", "刺穿了", "泪目了"} {
		for i := 0; i < len(runes); i++ {
			if hasPrefixAt(runes, i, w) {
				return true
			}
		}
	}
	return false
}

func hasPrefixAt(runes []rune, i int, prefix string) bool {
	pr := []rune(prefix)
	if i+len(pr) > len(runes) {
		return false
	}
	for j, r := range pr {
		if runes[i+j] != r {
			return false
		}
	}
	return true
}
