# STATUS

## 当前状态
v0.1.0 已发布 GitHub（public）：https://github.com/zhan-tz/dsh-plugin-runbook
开发态装在 `~/.dsh/profiles/web/node_modules/dsh-plugin-runbook/`（热重载直改那边，改完同步回本仓库 `lib/` 再提交）。

## 如何运行
```bash
# 安装（用户侧）
dsh plugin --profile web add zhan-tz/dsh-plugin-runbook
# 开发：dsh web 起着，直改 profiles 里的 lib/，dev_reload_package 热重载，浏览器 Cmd+Shift+R
node --check lib/client.js && node --check lib/index.js   # 每次改动必过
```

## 下一步
- [ ] 提交节点上直接 `git show`（paperlab 式"改-验-交"闭环）
- [ ] 文件版本代际（同文件重写 N 次 → N 节点，dsh-science 式溯源）
- [ ] 全局"这个会话干了什么"一段话总结
- [ ] 被 oh-my-dsh 目录收录（已打 `dsh-plugin` topic，目录按 topic 自动索引）

## 已知坑
- ✨ 解释备用模型长 prompt ~30s：已做并发竞速 + 秒表计时，但别删竞速逻辑
- 会话主模型可能 200 + 空 text：空文本必须视为失败（写进了竞速逻辑）
- `buildFileGraph` 依赖 `git.cwd` 字段：路由响应必须带 cwd，否则 git 吸收段静默全跳过
- 重跑 `script --out data.csv` 天然成环：布局有环防护，消费边跳过产生边的反向
- a-git save 前别把 >10MB 文件放进仓库（截图 105KB 安全）

## 完成记录
- 2026-08-16 v0.1.0 首发公开版：回合滑杆回放 DAG + git 提交节点 + 子 agent 交接边 + 持久账本 + 悬停 👁/▶/✨ + 孤儿收纳
