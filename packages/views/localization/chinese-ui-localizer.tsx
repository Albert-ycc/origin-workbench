"use client";

import { useEffect } from "react";

const TEXT_TRANSLATIONS: Record<string, string> = {
  "Inbox": "收件箱",
  "My Issues": "我的任务",
  "Missions": "任务中枢",
  "Issues": "任务",
  "Issue": "任务",
  "Projects": "项目",
  "Project": "项目",
  "Autopilot": "自动巡航",
  "Agents": "智能体",
  "Agent": "智能体",
  "Runtimes": "运行环境",
  "Runtime": "运行环境",
  "Skills": "技能",
  "Skill": "技能",
  "Settings": "设置",
  "Workspace": "工作区",
  "Workspaces": "工作区",
  "Configure": "配置",
  "Pinned": "固定",
  "Create workspace": "新建工作区",
  "Pending invitations": "待处理邀请",
  "Join": "加入",
  "Decline": "拒绝",
  "Log out": "退出登录",
  "New Issue": "新建任务",
  "New Project": "新建项目",
  "Create manually": "手动创建",
  "Create with agent": "交给智能体创建",
  "Quick create issue": "快速创建任务",
  "Issue created": "任务已创建",
  "Create another": "继续创建",
  "Set parent issue": "设置父任务",
  "Add sub-issue": "添加子任务",
  "Remove parent": "移除父任务",
  "More options": "更多选项",
  "Close": "关闭",
  "Cancel": "取消",
  "Done": "完成",
  "Save": "保存",
  "Delete": "删除",
  "Update": "更新",
  "Create": "创建",
  "Add": "添加",
  "Remove": "移除",
  "Open": "打开",
  "Copy": "复制",
  "Copy link": "复制链接",
  "Search...": "搜索...",
  "Search…": "搜索…",
  "Search runtimes…": "搜索运行环境…",
  "Search skills…": "搜索技能…",
  "Search or type a model ID": "搜索或输入模型 ID",
  "Filter": "筛选",
  "Filter options": "筛选选项",
  "Filter...": "筛选...",
  "Display settings": "显示设置",
  "Back": "返回",
  "Go back": "返回",
  "Go forward": "前进",
  "Continue": "继续",
  "Download": "下载",
  "Help": "帮助",
  "Expand": "展开",
  "Collapse": "收起",
  "Loading…": "正在加载…",
  "Retry": "重试",
  "Try again": "重试",
  "Name": "名称",
  "Description": "描述",
  "Context": "上下文",
  "Slug": "地址标识",
  "General": "基本信息",
  "Profile": "个人资料",
  "Repositories": "代码仓库",
  "Theme": "主题",
  "API Tokens": "API 令牌",
  "Token created": "令牌已创建",
  "Revoke token": "撤销令牌",
  "Copy token": "复制令牌",
  "No expiry": "永不过期",
  "Danger Zone": "危险区",
  "Leave workspace": "离开工作区",
  "Delete workspace": "删除工作区",
  "Inbox Notifications": "收件箱通知",
  "Members": "成员",
  "Member": "成员",
  "Owner": "所有者",
  "Admin": "管理员",
  "Invite member": "邀请成员",
  "Pending": "待处理",
  "No members found.": "没有找到成员。",
  "Feedback": "反馈",
  "Sign in to Multica": "登录 Multica",
  "Sign-in Failed": "登录失败",
  "Login Failed": "登录失败",
  "Signing in...": "正在登录...",
  "Opening Multica": "正在打开 Multica",
  "Authorize CLI": "授权 CLI",
  "Check your email": "查看邮箱",
  "Email": "邮箱",
  "or": "或",
  "Prefer the desktop app?": "更想用桌面版？",
  "Backlog": "待整理",
  "keeps the agent paused": "会让智能体保持暂停",
  "Todo": "待办",
  "starts the agent": "会启动智能体",
  "In Progress": "进行中",
  "In Review": "审核中",
  "Blocked": "受阻",
  "Cancelled": "已取消",
  "Urgent": "紧急",
  "High": "高",
  "Medium": "中",
  "Low": "低",
  "No priority": "无优先级",
  "Priority": "优先级",
  "Status": "状态",
  "Assignee": "负责人",
  "Creator": "创建者",
  "Due date": "截止时间",
  "Created date": "创建时间",
  "Title": "标题",
  "Manual": "手动排序",
  "Labels": "标签",
  "Label": "标签",
  "Sub-issue progress": "子任务进度",
  "Sub-issues": "子任务",
  "Sub-issue of": "父任务",
  "Parent issue": "父任务",
  "Add sub-issues": "添加子任务",
  "Activity": "动态",
  "Subscribe": "订阅",
  "Unsubscribe": "取消订阅",
  "No issues yet": "暂无任务",
  "Create an issue to get started.": "新建一个任务开始。",
  "Issue title": "任务标题",
  "No notifications": "暂无通知",
  "No labels yet.": "暂无标签。",
  "Original input": "原始输入",
  "Removed assignee": "已移除负责人",
  "Removed due date": "已移除截止时间",
  "Mark as done": "标记完成",
  "Archive": "归档",
  "No runtimes yet": "暂无运行环境",
  "Starting local runtime…": "正在启动本地运行环境…",
  "No matches": "无匹配项",
  "No results": "没有结果",
  "No results found": "没有找到结果",
  "No results found.": "没有找到结果。",
  "Online": "在线",
  "Offline": "离线",
  "Recently lost": "刚刚断开",
  "About to GC": "即将清理",
  "Serving": "服务中",
  "Diagnostics": "诊断",
  "Waiting for daemon...": "正在等待守护进程...",
  "Updating...": "正在更新...",
  "Update complete. Daemon is restarting...": "更新完成，守护进程正在重启...",
  "Update failed": "更新失败",
  "Timeout": "超时",
  "unknown": "未知",
  "available": "可更新",
  "Delete runtime": "删除运行环境",
  "Delete Runtime": "删除运行环境",
  "CLI Version:": "CLI 版本：",
  "When this runtime spent": "此运行环境的消耗",
  "Date": "日期",
  "Model": "模型",
  "Input": "输入",
  "Output": "输出",
  "Cache R": "缓存读",
  "Cache W": "缓存写",
  "No usage data yet": "暂无用量数据",
  "Daily": "按天",
  "Hourly": "按小时",
  "Heatmap": "热力图",
  "By agent": "按智能体",
  "By model": "按模型",
  "No autopilots yet": "暂无自动巡航",
  "Schedule recurring tasks for your AI agents. Pick a template or start from scratch.": "为 AI 智能体设置周期性任务。选择模板，或从空白开始。",
  "New autopilot": "新建自动巡航",
  "New Autopilot": "新建自动巡航",
  "Edit autopilot": "编辑自动巡航",
  "Edit Autopilot": "编辑自动巡航",
  "Start from scratch": "从空白开始",
  "Mode": "模式",
  "Last run": "上次运行",
  "Active": "启用",
  "Paused": "暂停",
  "Archived": "已归档",
  "Add Trigger": "添加触发器",
  "Add trigger": "添加触发器",
  "Delete trigger": "删除触发器",
  "Delete autopilot": "删除自动巡航",
  "Properties": "属性",
  "Output mode": "输出方式",
  "Output Mode": "输出方式",
  "Schedule": "计划",
  "Create issue": "创建任务",
  "Create Issue": "创建任务",
  "Run only": "仅运行",
  "Run Only": "仅运行",
  "Every hour": "每小时",
  "Every day": "每天",
  "Every weekday": "每个工作日",
  "Every week": "每周",
  "Custom cron": "自定义 Cron",
  "Weekdays": "工作日",
  "Days": "天",
  "Custom": "自定义",
  "Sunday": "周日",
  "Monday": "周一",
  "Tuesday": "周二",
  "Wednesday": "周三",
  "Thursday": "周四",
  "Friday": "周五",
  "Saturday": "周六",
  "Issue Created": "任务已创建",
  "Running": "运行中",
  "Completed": "已完成",
  "Failed": "失败",
  "Disabled": "已禁用",
  "Recent": "最近",
  "Recent work": "最近工作",
  "Now": "当前",
  "No active work": "暂无进行中的工作",
  "Nothing finished yet": "暂无完成记录",
  "Performance": "表现",
  "Last 30 days": "最近 30 天",
  "No completions in the last 30 days.": "最近 30 天暂无完成记录。",
  "This agent isn't running anything right now.": "这个智能体当前没有运行任务。",
  "This agent hasn't completed anything yet.": "这个智能体还没有完成过任务。",
  "Show more →": "显示更多 →",
  "Chat": "聊天",
  "Quick create": "快速创建",
  "Creating issue": "正在创建任务",
  "Chat session": "聊天会话",
  "Autopilot run": "自动巡航运行",
  "Untracked": "未追踪",
  "Triggered by": "触发来源",
  "Open issue": "打开任务",
  "View transcript": "查看执行记录",
  "Cancel task": "取消任务",
  "Stop agent": "停止智能体",
  "Stop": "停止",
  "Cancelling…": "正在取消…",
  "Agent execution error": "智能体执行错误",
  "Task timed out": "任务超时",
  "Daemon offline": "守护进程离线",
  "Daemon restarted": "守护进程已重启",
  "Cancelled by user": "用户已取消",
  "Pages": "页面",
  "Commands": "命令",
  "Switch Workspace": "切换工作区",
  "Type to search issues and projects": "输入内容搜索任务和项目",
  "Search pages, issues, and projects": "搜索页面、任务和项目",
  "Link copied": "链接已复制",
  "Copy Issue Link": "复制任务链接",
  "Switch to Light Theme": "切换到浅色主题",
  "Switch to Dark Theme": "切换到深色主题",
  "Use System Theme": "跟随系统主题",
  "Current theme": "当前主题",
  "Light": "浅色",
  "Dark": "深色",
  "System": "跟随系统",
  "Chat with your agents": "和智能体对话",
  "Try asking": "试着问",
  "New chat": "新对话",
  "Minimize": "最小化",
  "Chat History": "对话历史",
  "No chat sessions yet": "暂无对话",
  "No agents": "暂无智能体",
  "My agents": "我的智能体",
  "Others": "其他",
  "Show details": "显示详情",
  "Another chat is running": "另一个对话正在运行",
  "Another chat has unread replies": "另一个对话有未读回复",
  "Unread": "未读",
  "Queued": "排队中",
  "Dispatched": "已分发",
  "Starting up": "正在启动",
  "Thinking": "思考中",
  "Tool": "工具",
  "Result": "结果",
  "Error": "错误",
  "Event": "事件",
  "Typing": "输入中",
  "Reconnecting": "正在重连",
  "Agent Execution Transcript": "智能体执行记录",
  "Timeline": "时间线",
  "Clear filters": "清除筛选",
  "Copy filtered": "复制筛选结果",
  "Copy all": "全部复制",
  "Copied": "已复制",
  "Waiting for events...": "正在等待事件...",
  "No execution data recorded.": "暂无执行数据。",
  "View execution log": "查看执行日志",
  "Daemon": "守护进程",
  "CLI Status": "CLI 状态",
  "Updates": "更新",
  "Current version": "当前版本",
  "Check for updates": "检查更新",
  "New version available": "发现新版本",
  "Downloading update...": "正在下载更新...",
  "Update ready": "更新已准备好",
  "Less": "少",
  "More": "多",
  "Agent updated": "智能体已更新",
  "Agent archived": "智能体已归档",
  "Agent restored": "智能体已恢复",
  "Failed to update agent": "更新智能体失败",
  "Failed to archive agent": "归档智能体失败",
  "Failed to restore agent": "恢复智能体失败",
  "Failed to cancel task": "取消任务失败",
  "Failed to cancel tasks": "取消任务失败",
  "Failed to add skill": "添加技能失败",
  "Failed to remove skill": "移除技能失败",
  "Failed to update issue": "更新任务失败",
  "Failed to update issues": "更新任务失败",
  "Failed to delete issues": "删除任务失败",
  "Failed to create issue": "创建任务失败",
  "Failed to create label": "创建标签失败",
  "Failed to update label": "更新标签失败",
  "Failed to delete label": "删除标签失败",
  "Failed to send comment": "发送评论失败",
  "Failed to send reply": "发送回复失败",
  "Failed to update comment": "更新评论失败",
  "Failed to delete comment": "删除评论失败",
  "Failed to copy link": "复制链接失败",
  "Project created": "项目已创建",
  "Project deleted": "项目已删除",
  "Project not found": "未找到项目",
  "No projects yet": "暂无项目",
  "No issues linked": "暂无关联任务",
  "Assign issues to this project from the issue detail page.": "可以在任务详情页把任务分配到这个项目。",
  "Failed to create project": "创建项目失败",
  "Failed to move issue": "移动任务失败",
  "Repository attached": "代码仓库已关联",
  "Resource removed": "资源已移除",
  "Failed to attach": "关联失败",
  "Failed to remove resource": "移除资源失败",
  "Trigger added": "触发器已添加",
  "Trigger deleted": "触发器已删除",
  "Failed to add trigger": "添加触发器失败",
  "Failed to delete trigger": "删除触发器失败",
  "Autopilot created": "自动巡航已创建",
  "Autopilot updated": "自动巡航已更新",
  "Autopilot triggered": "自动巡航已触发",
  "Autopilot deleted": "自动巡航已删除",
  "Autopilot not found": "未找到自动巡航",
  "A recurring AI task": "周期性 AI 任务",
  "Pause autopilot": "暂停自动巡航",
  "Activate autopilot": "启用自动巡航",
  "Run now": "立即运行",
  "Running...": "运行中...",
  "Adding...": "添加中...",
  "Deleting...": "删除中...",
  "Run History": "运行历史",
  "Triggers": "触发器",
  "Prompt": "提示词",
  "No triggers configured. Add a schedule to run automatically.": "暂无触发器。添加计划后即可自动运行。",
  "No runs yet. Click \"Run now\" to trigger manually.": "暂无运行记录。点击“立即运行”可手动触发。",
  "Label (optional)": "标签（可选）",
  "Failed to create autopilot": "创建自动巡航失败",
  "Failed to update autopilot": "更新自动巡航失败",
  "Failed to trigger autopilot": "触发自动巡航失败",
  "Failed to delete autopilot": "删除自动巡航失败",
  "Skill created": "技能已创建",
  "Skill imported": "技能已导入",
  "Skill saved": "技能已保存",
  "Skill deleted": "技能已删除",
  "Failed to save skill": "保存技能失败",
  "Failed to import skill": "导入技能失败",
  "Failed to upload avatar": "上传头像失败",
  "Custom arguments saved": "自定义参数已保存",
  "Failed to save custom arguments": "保存自定义参数失败",
  "Duplicate environment variable keys": "环境变量键名重复",
  "Environment variables saved": "环境变量已保存",
  "Failed to save environment variables": "保存环境变量失败",
  "No active tasks to cancel": "没有可取消的进行中任务",
  "Row actions": "行操作",
  "Archive Agent": "归档智能体",
  "Archive agent?": "归档智能体？",
  "Restore": "恢复",
  "Cancel all tasks": "取消全部任务",
  "Duplicate": "复制",
  "Keep them": "保留任务",
  "Delete comment": "删除评论",
  "Delete label?": "删除标签？",
  "Delete skill?": "删除技能？",
  "Delete project": "删除项目",
  "Change icon": "更换图标",
  "Toggle sidebar": "切换侧栏",
  "Unpin from sidebar": "从侧栏取消固定",
  "Pin to sidebar": "固定到侧栏",
  "Lead": "负责人",
  "No lead": "暂无负责人",
  "Progress": "进度",
  "Discard unsaved changes?": "放弃未保存的修改？",
  "Keep editing": "继续编辑",
  "Discard changes": "放弃修改",
  "Unsaved changes": "有未保存的修改",
  "Edit": "编辑",
  "Edit comment...": "编辑评论...",
  "Leave a comment...": "写下评论...",
  "Leave a reply...": "写下回复...",
  "Edit description": "编辑描述",
  "Rename agent": "重命名智能体",
  "Agent name": "智能体名称",
  "What does this agent do?": "这个智能体做什么？",
  "No description": "暂无描述",
  "Change avatar": "更换头像",
  "Attach a workspace skill": "关联工作区技能",
  "Add skill": "添加技能",
  "Environment": "环境变量",
  "Custom Args": "自定义参数",
  "Instructions": "指令",
  "Workload": "工作负载",
  "Activity (7d)": "7 天动态",
  "Runs": "运行次数",
  "You": "你",
  "Cloud": "云端",
  "Local": "本地",
  "No activity": "暂无动态",
  "Last 7 days": "最近 7 天",
  "Remove argument": "移除参数",
  "Remove variable": "移除变量",
  "Created": "创建时间",
  "Updated": "更新时间",
  "Created by": "创建者",
  "Concurrency": "并发数",
  "Visibility": "可见性",
  "Details": "详情",
  "All": "全部",
  "All issues in this workspace": "这个工作区中的全部任务",
  "Issues assigned to team members": "分配给团队成员的任务",
  "Issues assigned to AI agents": "分配给 AI 智能体的任务",
  "Assigned": "分配给我",
  "Issues assigned to me": "分配给我的任务",
  "Issues I created": "我创建的任务",
  "My Agents": "我的智能体",
  "No assignee": "无负责人",
  "No project": "无项目",
  "Reset all filters": "重置全部筛选",
  "Ordering": "排序",
  "Ascending": "升序",
  "Descending": "降序",
  "Card properties": "卡片属性",
  "Board view": "看板视图",
  "List view": "列表视图",
  "No labels yet": "暂无标签",
  "Remove from project": "从项目中移除",
  "Busiest day": "最忙的一天",
  "Most active weekday": "最活跃的工作日",
  "Quietest weekday": "最空闲的工作日",
  "Runtime not found": "未找到运行环境",
  "Security:": "安全：",
  "Connect a remote machine": "连接远程机器",
  "Waiting for runtime…": "正在等待运行环境…",
  "Runtime connected!": "运行环境已连接！",
  "Workspace settings saved": "工作区设置已保存",
  "Failed to save workspace settings": "保存工作区设置失败",
  "Failed to leave workspace": "离开工作区失败",
  "Failed to delete workspace": "删除工作区失败",
  "Repositories saved": "代码仓库已保存",
  "Failed to save repositories": "保存代码仓库失败",
  "Failed to update notification settings": "更新通知设置失败",
  "Avatar updated": "头像已更新",
  "Profile updated": "个人资料已更新",
  "Failed to update profile": "更新个人资料失败",
  "Invitation sent": "邀请已发送",
  "Invitation revoked": "邀请已撤销",
  "Role updated": "角色已更新",
  "Member removed": "成员已移除",
  "Failed to send invitation": "发送邀请失败",
  "Failed to revoke invitation": "撤销邀请失败",
  "Failed to update member": "更新成员失败",
  "Failed to remove member": "移除成员失败",
  "Revoke invitation": "撤销邀请",
  "Git": "Git",
  "Color": "颜色",
  "Pick a color": "选择颜色",
  "error · not found": "错误 · 未找到",
  "No pending invitations": "暂无待处理邀请",
  "Loading workspace…": "正在加载工作区…",
  "Member unavailable": "成员不可用",
  "This issue does not exist or has been deleted in this workspace.": "这个任务不存在，或已从当前工作区删除。",
  "Back to Issues": "返回任务列表",
  "Token usage": "Token 用量",
  "Cache": "缓存",
  "read": "读",
  "write": "写",
  "Any workspace member can delete issues.": "任何工作区成员都可以删除任务。",
  "Unassigned": "未分配",
  "Add issue": "添加任务",
  "Add label": "添加标签",
  "Manage labels…": "管理标签…",
  "Manage labels": "管理标签",
  "View": "视图",
  "Board": "看板",
  "List": "列表",
  "Bold": "加粗",
  "Italic": "斜体",
  "Strikethrough": "删除线",
  "Code": "代码",
  "Quote": "引用",
  "Link": "链接",
  "URL": "网址",
  "Copy code": "复制代码",
  "View image": "查看图片",
  "Open link": "打开链接",
  "Failed to copy": "复制失败",
  "Created sub-issue": "子任务已创建",
  "Failed to create sub-issue": "创建子任务失败",
  "Rendering diagram…": "正在渲染图表…",
  "Unable to render Mermaid diagram.": "无法渲染 Mermaid 图表。",
  "Mermaid diagram": "Mermaid 图表",
  "Mermaid diagram fullscreen": "Mermaid 图表全屏",
  "Mermaid diagram fullscreen view": "Mermaid 图表全屏视图",
  "Open fullscreen": "全屏打开",
  "Open Mermaid diagram fullscreen": "全屏打开 Mermaid 图表",
  "No skills yet": "暂无技能",
  "Couldn’t load skills": "无法加载技能",
  "No files": "暂无文件",
  "No local skills found": "未找到本地技能",
  "Skill not found": "未找到技能",
  "Delete skill": "删除技能",
  "Add file": "添加文件",
  "Files": "文件",
  "Back to method chooser": "返回选择方式",
  "Try a different name and submit again.": "换个名称后再提交。",
  "— unused": "— 未使用",
  "Runtime deleted": "运行环境已删除",
  "Failed to delete runtime": "删除运行环境失败",
  "Device": "设备",
  "Daemon CLI": "守护进程 CLI",
  "Daemon ID": "守护进程 ID",
  "Cost · 7d": "费用 · 7 天",
  "Update available": "有可用更新",
  "The CLI binary is managed by Multica Desktop — update Desktop to upgrade the CLI.": "CLI 二进制由 Multica 桌面版管理；升级桌面版即可升级 CLI。",
  "Only the runtime owner and workspace admins can delete this runtime": "只有运行环境所有者和工作区管理员可以删除这个运行环境",
  "Cron Expression": "Cron 表达式",
  "Minute": "分钟",
  "Time": "时间",
  "Timezone": "时区",
  "Select agent": "选择智能体",
  "Autopilot created, but schedule failed to save": "自动巡航已创建，但计划保存失败",
  "Autopilot updated, but schedule failed to save": "自动巡航已更新，但计划保存失败",
  "Workspace Name": "工作区名称",
  "Workspace URL": "工作区 URL",
  "Choose a different workspace URL": "请换一个工作区 URL",
  "Failed to create workspace": "创建工作区失败",
  "Assign it an issue": "给它分配任务",
  "@mention in a comment": "在评论里 @提及",
  "Chat one-on-one": "一对一聊天",
  "Put it on Autopilot": "加入自动巡航",
  "Install the Multica CLI": "安装 Multica CLI",
  "Start the daemon": "启动守护进程",
  "Skip for now": "暂时跳过",
  "Install the CLI": "安装 CLI",
  "Cloud runtime": "云端运行环境",
  "Join the cloud runtime waitlist": "加入云端运行环境候补名单",
  "Enter your workspace in read-only mode. Agents can't execute tasks until a runtime connects — but you can still browse, plan, and invite teammates.": "以只读模式进入工作区。连接运行环境之前，智能体不能执行任务，但你仍然可以浏览、规划和邀请队友。",
  "We'll host the runtime for you — no local install, no setup. Not live yet; click to leave your email and get notified.": "我们来托管运行环境，无需本地安装和配置。暂未开放，留下邮箱即可收到通知。",
  "For servers, remote dev boxes, and headless setups. Terminal required.": "适用于服务器、远程开发机和无界面环境。需要终端。",
  "We host the runtime. Not live yet — join the waitlist.": "我们托管运行环境。暂未开放，可加入候补名单。",
  "Retry failed": "重试失败",
  "Starter tasks added — check your sidebar": "已添加入门任务，请查看侧栏",
  "Swap anytime": "随时切换",
  "Add more later": "以后再添加",
  "Assign issues to agents like you would a teammate": "像分配给队友一样，把任务分配给智能体",
  "Chat with any agent without creating an issue": "无需创建任务，也能和任意智能体对话",
  "Invite teammates — they see only this workspace": "邀请队友，他们只会看到这个工作区",
  "Switch to other workspaces anytime from the top-left": "可随时从左上角切换到其他工作区",
  "Create your first agent matched to your role": "创建第一个匹配你角色的智能体",
  "Watch it pick up a starter task and reply": "看它接手入门任务并回复",
  "And more": "更多",
  "Just me": "只有我",
  "My team (2–10 people)": "我的团队（2–10 人）",
  "Software developer": "软件开发者",
  "Product or project lead": "产品或项目负责人",
  "Writer or content creator": "写作者或内容创作者",
  "Founder or operator": "创始人或运营者",
  "Write and ship code": "编写并交付代码",
  "Plan and manage projects": "规划和管理项目",
  "Research or write": "研究或写作",
  "I'm just exploring for now": "我暂时只是看看",
  "A starter project, tailored": "为你定制的入门项目",
  "A head start with agents": "智能体上手起点",
  "Please wait while we complete your login": "请稍候，我们正在完成登录",
};

const PLACEHOLDER_TRANSLATIONS: Record<string, string> = {
  "you@example.com": "you@example.com",
  "Search…": "搜索…",
  "Search...": "搜索...",
  "Search skills…": "搜索技能…",
  "Type a command or search...": "输入命令或搜索...",
  "Issue title": "任务标题",
  "Add description...": "添加描述...",
  "Edit comment...": "编辑评论...",
  "Leave a comment...": "写下评论...",
  "Leave a reply...": "写下回复...",
  "Change subscribers...": "调整订阅者...",
  "Assign to...": "分配给...",
  "Find or create a label…": "查找或创建标签…",
  "Filter...": "筛选...",
  "Project title": "项目标题",
  "Assign lead...": "分配负责人...",
  "Agent name": "智能体名称",
  "What does this agent do?": "这个智能体做什么？",
  "Search or type a model ID": "搜索或输入模型 ID",
  "New label name…": "新标签名称…",
  "Skill name": "技能名称",
  "skill-name": "skill-name",
  "e.g. Weekday morning": "例如：工作日上午",
  "Search runtimes…": "搜索运行环境…",
  "Select a local runtime": "选择本地运行环境",
  "Token name (e.g. My CLI)": "令牌名称（例如：我的 CLI）",
  "What does this workspace focus on?": "这个工作区主要做什么？",
  "Background information and context for AI agents working in this workspace": "给这个工作区里的 AI 智能体使用的背景信息和上下文",
  "Tell us about your experience, bugs you've found, or features you'd like to see…": "告诉我们你的使用体验、发现的问题或想要的功能…",
  "Describe the outcome you want the agent team to deliver...": "描述你希望智能体团队交付的结果...",
  "One sentence describing when an agent should use this skill…": "用一句话说明智能体什么时候该使用这个技能…",
  "One sentence on when to assign this skill to an agent.": "用一句话说明什么时候把这个技能分配给智能体。",
  "Optional — describe when an agent should use this skill.": "可选：说明智能体什么时候该使用这个技能。",
  "Write markdown content...": "编写 Markdown 内容...",
  "My Workspace": "我的工作区",
  "Acme Inc, My Lab, Side Projects…": "例如：Acme 公司、我的实验室、副业项目…",
  "e.g. a small community I help run": "例如：我帮忙运营的小社群",
  "e.g. researcher, designer, ops lead": "例如：研究员、设计师、运营负责人",
  "e.g. automate my weekly reports": "例如：自动整理我的周报",
  "e.g. we want agents running 24/7, or my team works across different devices.": "例如：我们希望智能体 24 小时运行，或团队经常跨设备协作。",
  "e.g. review-helper": "例如：review-helper",
  "Autopilot name": "自动巡航名称",
  "https://git.example.com/org/repo.git": "https://git.example.com/org/repo.git",
  "https://github.com/owner/repo": "https://github.com/owner/repo",
  "user@company.com": "user@company.com",
};

const TITLE_TRANSLATIONS: Record<string, string> = {
  "Multica — Project Management for Human + Agent Teams":
    "Multica — 人类与智能体团队的项目管理",
  "Issues": "任务",
  "Issue": "任务",
  "Missions": "任务中枢",
  "Projects": "项目",
  "Project": "项目",
  "Autopilot": "自动巡航",
  "My Issues": "我的任务",
  "Runtimes": "运行环境",
  "Runtime": "运行环境",
  "Skills": "技能",
  "Skill": "技能",
  "Agents": "智能体",
  "Agent": "智能体",
  "Inbox": "收件箱",
  "Settings": "设置",
};

const SKIP_SELECTOR = [
  "script",
  "style",
  "textarea",
  "input",
  "select",
  "pre",
  "code",
  "kbd",
  "[contenteditable='true']",
  ".ProseMirror",
  ".rich-text-editor",
  ".prose",
  ".katex",
  "[data-skip-localize]",
].join(",");

const ISSUE_NOUN = "任务";

function translateUnit(unit: string) {
  const lower = unit.toLowerCase();
  if (lower.startsWith("issue")) return ISSUE_NOUN;
  if (lower.startsWith("task")) return "任务";
  if (lower.startsWith("comment")) return "评论";
  if (lower.startsWith("reply")) return "回复";
  if (lower.startsWith("event")) return "事件";
  if (lower.startsWith("line")) return "行";
  if (lower.startsWith("file")) return "文件";
  if (lower.startsWith("run")) return "运行";
  return unit;
}

function translateDynamic(value: string) {
  let match = value.match(/^Updated (\d+) (\w+)s?$/);
  if (match?.[1] && match[2]) return `已更新 ${match[1]} 个${translateUnit(match[2])}`;

  match = value.match(/^Deleted (\d+) (\w+)s?$/);
  if (match?.[1] && match[2]) return `已删除 ${match[1]} 个${translateUnit(match[2])}`;

  match = value.match(/^Cancelled (\d+) tasks?$/);
  if (match?.[1]) return `已取消 ${match[1]} 个任务`;

  match = value.match(/^Added (.+) as sub-issue$/);
  if (match?.[1]) return `已将 ${match[1]} 添加为子任务`;

  match = value.match(/^Set (.+) as parent issue$/);
  if (match?.[1]) return `已将 ${match[1]} 设置为父任务`;

  match = value.match(/^Copied (\d+) lines?$/);
  if (match?.[1]) return `已复制 ${match[1]} 行`;

  match = value.match(/^Showing (\d+) of (\d+)$/);
  if (match?.[1] && match[2]) return `正在显示 ${match[1]} / ${match[2]}`;

  match = value.match(/^(\d+) selected$/);
  if (match?.[1]) return `已选 ${match[1]} 项`;

  match = value.match(/^(\d+) issues?$/);
  if (match?.[1]) return `${match[1]} 个任务`;

  match = value.match(/^(\d+) of (\d+)$/);
  if (match?.[1] && match[2]) return `${match[1]} / ${match[2]}`;

  match = value.match(/^(\d+) latest$/);
  if (match?.[1]) return `最近 ${match[1]} 条`;

  match = value.match(/^(\d+) active tasks?$/);
  if (match?.[1]) return `${match[1]} 个进行中任务`;

  match = value.match(/^(\d+) runs?$/);
  if (match?.[1]) return `${match[1]} 次运行`;

  match = value.match(/^(\d+)% success$/);
  if (match?.[1]) return `成功率 ${match[1]}%`;

  match = value.match(/^avg (.+)$/);
  if (match?.[1]) return `平均 ${match[1]}`;

  match = value.match(/^(\d+) failed$/);
  if (match?.[1]) return `${match[1]} 次失败`;

  match = value.match(/^Started (.+)$/);
  if (match?.[1]) return `${match[1]}开始`;

  match = value.match(/^Dispatched (.+)$/);
  if (match?.[1]) return `${match[1]}分发`;

  match = value.match(/^Queued (.+)$/);
  if (match?.[1]) return `${match[1]}排队`;

  match = value.match(/^(\d+)(m|h|d) ago(开始|分发|排队)$/);
  if (match?.[1] && match[2] && match[3]) {
    const unit = match[2] === "m" ? "分钟" : match[2] === "h" ? "小时" : "天";
    return `${match[1]} ${unit}前${match[3]}`;
  }

  match = value.match(/^just now(开始|分发|排队)$/);
  if (match?.[1]) return `刚刚${match[1]}`;

  match = value.match(/^Created (.+)$/);
  if (match?.[1]) return `${match[1]}创建`;

  match = value.match(/^Created (today|.+ ago)$/);
  if (match?.[1]) return match[1] === "today" ? "今天创建" : `${match[1]}创建`;

  match = value.match(/^No (.+) match "(.+)"\.$/);
  if (match?.[1] && match[2]) return `没有匹配“${match[2]}”的${translateUnit(match[1])}。`;

  match = value.match(/^No archived agents match "(.+)"\.$/);
  if (match?.[1]) return `没有匹配“${match[1]}”的已归档智能体。`;

  match = value.match(/^Delete (\d+) issues?\?$/);
  if (match?.[1]) return `删除 ${match[1]} 个任务？`;

  match = value.match(/^Cancel all tasks for “(.+)”\?$/);
  if (match?.[1]) return `取消“${match[1]}”的全部任务？`;

  match = value.match(/^Archive “(.+)”\?$/);
  if (match?.[1]) return `归档“${match[1]}”？`;

  match = value.match(/^\+(\d+) more$/);
  if (match?.[1]) return `还有 ${match[1]} 项`;

  match = value.match(/^(\d+) replies$/);
  if (match?.[1]) return `${match[1]} 条回复`;

  match = value.match(/^(\d+) reply$/);
  if (match?.[1]) return `${match[1]} 条回复`;

  match = value.match(/^Updated (.+)$/);
  if (match?.[1]) return `${translateTimeAgo(match[1]) ?? match[1]}更新`;

  match = value.match(/^Next: (.+)$/);
  if (match?.[1]) return `下次运行：${match[1]}`;

  match = value.match(/^Delete "(.+)"\?$/);
  if (match?.[1]) return `删除“${match[1]}”？`;

  match = value.match(/^Remove (.+)$/);
  if (match?.[1]) return `移除 ${match[1]}`;

  match = value.match(/^Create "(.+)"$/);
  if (match?.[1]) return `创建“${match[1]}”`;

  match = value.match(/^Use “(.+)”$/);
  if (match?.[1]) return `使用“${match[1]}”`;

  return null;
}

function translateTimeAgo(value: string) {
  if (value === "Today") return "今天";
  if (value === "just now") return "刚刚";
  const match = value.match(/^(\d+)(m|h|d) ago$/);
  if (!match?.[1] || !match[2]) return null;
  const unit = match[2] === "m" ? "分钟" : match[2] === "h" ? "小时" : "天";
  return `${match[1]} ${unit}前`;
}

function translateValue(value: string, dict: Record<string, string>) {
  return dict[value] ?? translateDynamic(value) ?? translateTimeAgo(value) ?? value;
}

function translateTextNode(node: Text) {
  const parent = node.parentElement;
  if (!parent || parent.closest(SKIP_SELECTOR)) return;

  const value = node.nodeValue ?? "";
  const trimmed = value.trim();
  if (!trimmed) return;

  const translated = translateValue(trimmed, TEXT_TRANSLATIONS);
  if (translated === trimmed) return;

  const prefix = value.match(/^\s*/)?.[0] ?? "";
  const suffix = value.match(/\s*$/)?.[0] ?? "";
  node.nodeValue = `${prefix}${translated}${suffix}`;
}

function translateElementAttributes(element: Element) {
  if (!(element instanceof HTMLElement)) return;
  if (element.closest(SKIP_SELECTOR)) {
    if (element.tagName !== "INPUT" && element.tagName !== "TEXTAREA") return;
  }

  const placeholder = element.getAttribute("placeholder");
  if (placeholder) {
    const translated = translateValue(placeholder, PLACEHOLDER_TRANSLATIONS);
    if (translated !== placeholder) element.setAttribute("placeholder", translated);
  }

  for (const attr of ["aria-label", "title"]) {
    const value = element.getAttribute(attr);
    if (!value) continue;
    const translated = translateValue(value, TEXT_TRANSLATIONS);
    if (translated !== value) element.setAttribute(attr, translated);
  }
}

function localizeDocumentTitle() {
  const translated = TITLE_TRANSLATIONS[document.title];
  if (translated) document.title = translated;
}

function localize(root: ParentNode) {
  localizeDocumentTitle();

  if (root instanceof Element) {
    translateElementAttributes(root);
  }

  const elementWalker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let element = elementWalker.nextNode();
  while (element) {
    translateElementAttributes(element as Element);
    element = elementWalker.nextNode();
  }

  const textWalker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let text = textWalker.nextNode();
  while (text) {
    translateTextNode(text as Text);
    text = textWalker.nextNode();
  }
}

export function ChineseUiLocalizer() {
  useEffect(() => {
    let frame = 0;
    const schedule = (root: ParentNode = document.body) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => localize(root));
    };

    schedule();

    const observer = new MutationObserver((mutations) => {
      let root: ParentNode | null = null;
      for (const mutation of mutations) {
        if (mutation.type === "characterData") {
          const parent = mutation.target.parentElement;
          if (parent && !parent.closest(SKIP_SELECTOR)) {
            translateTextNode(mutation.target as Text);
          }
          continue;
        }
        if (mutation.type === "attributes") {
          translateElementAttributes(mutation.target as Element);
          continue;
        }
        if (mutation.addedNodes.length > 0) {
          root = document.body;
        }
      }
      if (root) schedule(root);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["placeholder", "aria-label", "title"],
    });

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  return null;
}
