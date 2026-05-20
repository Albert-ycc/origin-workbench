"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@multica/ui/lib/utils";
import { ContentEditor, type ContentEditorRef } from "../../editor";
import { SubmitButton } from "@multica/ui/components/common/submit-button";
import { useChatStore, DRAFT_NEW_SESSION } from "@multica/core/chat";
import { useWorkspaceId } from "@multica/core/hooks";
import { skillListOptions } from "@multica/core/workspace/queries";
import type { Skill } from "@multica/core/types";
import { createLogger } from "@multica/core/logger";
import {
  findSlashSkillTrigger,
  filterSlashSkills,
  removeSlashSkillTrigger,
  type SlashSkillTrigger,
} from "./skill-slash";
import { SelectedSkillChips, SkillSlashMenu } from "./skill-slash-menu";

const logger = createLogger("chat.ui");

interface ChatSendOptions {
  skillIds?: string[];
}

interface SlashSkillState extends SlashSkillTrigger {
  selectedIndex: number;
}

interface ChatInputProps {
  onSend: (content: string, options?: ChatSendOptions) => void;
  onStop?: () => void;
  isRunning?: boolean;
  disabled?: boolean;
  /** True when the user has no agent available — disables the editor and
   *  surfaces a distinct placeholder. Kept separate from `disabled` so
   *  archived-session copy stays untouched. */
  noAgent?: boolean;
  /** Name of the currently selected agent, used in the placeholder. */
  agentName?: string;
  /** Rendered at the bottom-left of the input bar — typically the agent picker. */
  leftAdornment?: ReactNode;
  /** Rendered just before the submit button — used for context-anchor action. */
  rightAdornment?: ReactNode;
  /** Rendered inside the rounded container, above the editor — attached
   *  context cards, drafts, etc. */
  topSlot?: ReactNode;
}

export function ChatInput({
  onSend,
  onStop,
  isRunning,
  disabled,
  noAgent,
  agentName,
  leftAdornment,
  rightAdornment,
  topSlot,
}: ChatInputProps) {
  const wsId = useWorkspaceId();
  const editorRef = useRef<ContentEditorRef>(null);
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const selectedAgentId = useChatStore((s) => s.selectedAgentId);
  // Scope the new-chat draft by agent:
  //   1. Switching agents while composing a brand-new chat gives each
  //      agent its own draft (no cross-agent leakage).
  //   2. Tiptap's Placeholder extension is only applied at mount; this
  //      key changes on agent switch so the editor remounts and the
  //      `Tell {agent} what to do…` placeholder refreshes.
  const draftKey =
    activeSessionId ?? `${DRAFT_NEW_SESSION}:${selectedAgentId ?? ""}`;
  // Select a primitive — empty-string fallback keeps referential stability.
  const inputDraft = useChatStore((s) => s.inputDrafts[draftKey] ?? "");
  const setInputDraft = useChatStore((s) => s.setInputDraft);
  const clearInputDraft = useChatStore((s) => s.clearInputDraft);
  const [isEmpty, setIsEmpty] = useState(!inputDraft.trim());
  const [isFocused, setIsFocused] = useState(false);
  const { data: workspaceSkills = [] } = useQuery(skillListOptions(wsId));
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);
  const [skillSlash, setSkillSlash] = useState<SlashSkillState | null>(null);

  const selectedSkills = useMemo(() => {
    const byId = new Map(workspaceSkills.map((skill) => [skill.id, skill]));
    return selectedSkillIds
      .map((id) => byId.get(id))
      .filter((skill): skill is Skill => !!skill);
  }, [selectedSkillIds, workspaceSkills]);

  const slashOptions = useMemo(() => {
    if (!skillSlash) return [] as Skill[];
    const selected = new Set(selectedSkillIds);
    return filterSlashSkills(
      workspaceSkills.filter((skill) => !selected.has(skill.id)),
      skillSlash.query,
    ).slice(0, 8);
  }, [skillSlash, selectedSkillIds, workspaceSkills]);

  useEffect(() => {
    setSelectedSkillIds([]);
    setSkillSlash(null);
  }, [draftKey]);

  useEffect(() => {
    if (
      !skillSlash ||
      slashOptions.length === 0 ||
      skillSlash.selectedIndex < slashOptions.length
    ) {
      return;
    }
    setSkillSlash((state) =>
      state
        ? {
            ...state,
            selectedIndex: Math.max(0, slashOptions.length - 1),
          }
        : state,
    );
  }, [skillSlash, slashOptions.length]);

  const handleSend = () => {
    const content = editorRef.current?.getMarkdown()?.replace(/(\n\s*)+$/, "").trim();
    if (!content || isRunning || disabled || noAgent) {
      logger.debug("input.send skipped", {
        emptyContent: !content,
        isRunning,
        disabled,
        noAgent,
      });
      return;
    }
    // Capture draft key BEFORE onSend — creating a new session mutates
    // activeSessionId synchronously, so reading it after onSend would point
    // at the new session and leave the old draft orphaned.
    const keyAtSend = draftKey;
    logger.info("input.send", { contentLength: content.length, draftKey: keyAtSend });
    const skillIdsAtSend = selectedSkillIds;
    onSend(
      content,
      skillIdsAtSend.length ? { skillIds: skillIdsAtSend } : undefined,
    );
    editorRef.current?.clearContent();
    // Drop focus so the caret doesn't keep blinking under the StatusPill /
    // streaming reply that's about to take over the user's attention. The
    // input is also `disabled` once isRunning flips, and a focused-but-
    // disabled editor reads as a stale cursor. We deliberately don't auto-
    // refocus on completion — that would interrupt the user if they're
    // selecting text from the assistant reply; one click to refocus is
    // a fair price for not stealing focus mid-action.
    editorRef.current?.blur();
    clearInputDraft(keyAtSend);
    setIsEmpty(true);
    setIsFocused(false);
    setSelectedSkillIds([]);
    setSkillSlash(null);
  };

  const updateSlashState = (markdown: string) => {
    const trigger = findSlashSkillTrigger(markdown, markdown.length);
    if (!trigger) {
      setSkillSlash(null);
      return;
    }
    setSkillSlash((prev) => ({
      ...trigger,
      selectedIndex:
        prev?.triggerStart === trigger.triggerStart ? prev.selectedIndex : 0,
    }));
  };

  const acceptSkill = (skill: Skill) => {
    if (!skillSlash) return;
    const currentDraft = editorRef.current?.getMarkdown() ?? inputDraft;
    const next = removeSlashSkillTrigger(currentDraft, skillSlash);
    setSelectedSkillIds((ids) =>
      ids.includes(skill.id) ? ids : [...ids, skill.id],
    );
    setInputDraft(draftKey, next);
    setIsEmpty(!next.trim());
    setSkillSlash(null);
    editorRef.current?.setPlainText(next);
    requestAnimationFrame(() => editorRef.current?.focus());
  };

  const handleEditorKeyDown = (event: KeyboardEvent): boolean => {
    if (skillSlash && slashOptions.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSkillSlash((state) =>
          state
            ? {
                ...state,
                selectedIndex: (state.selectedIndex + 1) % slashOptions.length,
              }
            : state,
        );
        return true;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSkillSlash((state) =>
          state
            ? {
                ...state,
                selectedIndex:
                  (state.selectedIndex - 1 + slashOptions.length) %
                  slashOptions.length,
              }
            : state,
        );
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        acceptSkill(slashOptions[skillSlash.selectedIndex]!);
        return true;
      }
    }
    if (event.key === "Escape" && skillSlash) {
      event.preventDefault();
      setSkillSlash(null);
      return true;
    }
    return false;
  };

  const placeholder = noAgent
    ? "创建智能体后即可开始对话"
    : disabled
      ? "这个会话已归档"
      : agentName
        ? `嗯… 想对 ${agentName} 说点什么吗`
        : "嗯… 想说点什么吗";

  return (
    <div
      className={cn(
        "px-5 pb-3 pt-0",
        noAgent && "cursor-not-allowed",
      )}
    >
      <div
        className={cn(
          // 默认收起态：高度 36-40px，圆角条；获得焦点后展开成多行
          "relative mx-auto w-full max-w-4xl flex flex-col rounded-lg bg-card border transition-colors",
          isFocused || !isEmpty
            ? "min-h-16 max-h-40 pb-9 border-brand"
            : "min-h-9 max-h-9 pb-0 border-border cursor-text",
          noAgent && "pointer-events-none opacity-60",
        )}
        aria-disabled={noAgent || undefined}
        onClick={() => {
          if (!isFocused && !noAgent) {
            setIsFocused(true);
            requestAnimationFrame(() => editorRef.current?.focus());
          }
        }}
      >
        {skillSlash && slashOptions.length > 0 && (
          <SkillSlashMenu
            skills={slashOptions}
            selectedIndex={skillSlash.selectedIndex}
            onPick={acceptSkill}
            className="left-3"
          />
        )}
        {/* 收起态：只显示 placeholder 文字，不渲染编辑器 */}
        {!isFocused && isEmpty && (
          <div className="flex items-center h-9 px-3 text-sm text-muted-foreground/70 select-none">
            {placeholder}
          </div>
        )}
        {/* 展开态 */}
        {(isFocused || !isEmpty) && (
          <>
            {topSlot}
            <SelectedSkillChips
              skills={selectedSkills}
              onRemove={(skillId) =>
                setSelectedSkillIds((ids) => ids.filter((id) => id !== skillId))
              }
              className="px-3 pt-2"
            />
            <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2">
              <ContentEditor
                key={draftKey}
                ref={editorRef}
                defaultValue={inputDraft}
                placeholder={placeholder}
                onUpdate={(md) => {
                  setIsEmpty(!md.trim());
                  setInputDraft(draftKey, md);
                  updateSlashState(md);
                }}
                onSubmit={handleSend}
                onKeyDown={handleEditorKeyDown}
                onBlur={() => {
                  // 有内容时保持展开，无内容时收起
                  if (isEmpty) setIsFocused(false);
                }}
                debounceMs={100}
                showBubbleMenu={false}
                submitOnEnter
              />
            </div>
          </>
        )}
        {leftAdornment && (isFocused || !isEmpty) && (
          <div className="absolute bottom-1.5 left-2 flex items-center">
            {leftAdornment}
          </div>
        )}
        {(isFocused || !isEmpty) && (
          <div className="absolute bottom-1 right-1.5 flex items-center gap-2">
            {rightAdornment}
            <SubmitButton
              onClick={handleSend}
              disabled={isEmpty || !!disabled || !!noAgent}
              running={isRunning}
              onStop={onStop}
            />
          </div>
        )}
      </div>
    </div>
  );
}
