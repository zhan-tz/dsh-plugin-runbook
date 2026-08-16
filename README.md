# dsh-plugin-runbook

DeepSeek Harness (DSH) Web UI 插件：给 agent 会话一个 **Jupyter 式活体运行本**。

一个视图回答三个问题：**这个 agent 到底产出了什么？每个文件是怎么来的？现在从头到尾怎么流动的？**

![runbook](docs/screenshot.png)

## 它是什么

打开 Runbook 标签页，整个会话变成一张**可回放的数据流 DAG**：

- **回合滑杆** 从第一回合拖到最新一页，图从前向后像树一样生长（不是播片动画，是结构性的生长——缩放、平移、节点交互全程可用）；
- 每个节点是一个**真实文件**：脚本 / 数据 / 图 / PDF / 文档，按种类着色；
- 边是**真实数据流**：`data.csv → plot.py → fig.png`，从工具调用与命令行参数中重建，不是猜的；
- **金色提交节点**：git 历史成为图的一等公民——每次提交是一个节点，按时间链成链，该提交动过的文件挂在其下。历史项目的文件靠它获得出处，不再是一堆孤儿；
- **紫色 BOT 节点**：子 agent 会话（跨会话执行）也进图——它跑过什么脚本、写过什么文件、任务交接时吃掉了主会话的哪些产物，全部可见；
- **持久账本**：runs 落盘到 `~/.dsh/dsh-plugin-runbook/ledger.jsonl`，会话被压缩、重启、换会话都不丢边。
- **磁盘扫描 + 静态 IO 推断**：宿主直接走真实目录树（含未提交文件），静态解析每个脚本的输入/输出——三层精度：显式 IO 调用（`read_csv/to_csv/savefig`）→ CLI 旗标邻接（`arg("--out", "data.csv")`）→ mtime 时序推断。**没跑过、没推送、没进会话记录的研究代码照样自动进图并连出数据流**。

### 节点上的操作（悬停即出）

| 芯片 | 作用 |
|---|---|
| 👁 | 预览文件（图片/PDF/文本在页面内打开） |
| ▶ | **重跑脚本**（py / sh / R / js），输出浮层实时显示 |
| ✨ | **LLM 解释**：这句话级的"这个文件在流水线里干嘛的、怎么来的" |

✨ 采用**并发竞速**：会话主模型与备用模型同时请求，先回非空者胜——主模型经常返回空文本，备模型长 prompt 要 30 秒，竞速保证 2–6 秒内基本总有答案。

### 孤儿文件收纳

没参与任何数据流、只是在工具输出里被回显过的文件（`ls` 洪水、系统文件……）**默认收起**在左下角一条胶囊里：`📎 背景文件 24 · 展开`。展开后按**目录分组**摆放。主流水线永远是视口的主角。

## 安装

```bash
dsh plugin --profile web add zhan-tz/dsh-plugin-runbook
```

或手动挂载（profile 的 `cordis.patch.yml`，参考 [cordis.patch.yml](cordis.patch.yml)）：

```yaml
- insert:
    - id: runbook
      name: dsh-plugin-runbook
```

要求：DSH Web UI（`dsh web`）。纯本地运行，唯一可选的出网请求是 ✨ 解释（走你已配置的 LLM provider）。

## 工作原理

```
会话时间线 ──┐
git 历史账本 ─┼──► buildFileGraph ──► 分层 DAG 布局 ──► SVG（缩放/平移/回放）
子会话日志  ──┤         ▲
持久账本    ──┤         └─ 宿主路由（zstd 解压、正则抽取、环防护）
磁盘扫描    ──┘
```

- 宿主端（`lib/index.js`）注册 6 个本地路由：`/agent-fileview` `/agent-explain` `/agent-run` `/agent-git` `/agent-subruns` `/agent-ledger` `/agent-scan`；
- 客户端（`lib/client.js`）从会话 artifact + 上述路由重建图；布局带**环防护**（重跑脚本 `--out data.csv` 会天然成环）；
- 子 agent 的 runs 通过解压其独立会话日志挖掘（含脚本源码中引用的输入文件 → 交接边）。

## 已知边界（诚实清单）

- ✨ 解释的备用模型在超长 prompt 下可能要 ~30 秒（有秒表计时，不会假死）；
- 账本只保住**从安装起**的边——更早的历史会话靠 git 提交节点撑结构；
- 超大仓库（>60 提交）按近 60 条采掘。

## Roadmap

- [ ] 提交节点上直接 `git show`（paperlab 式"改-验-交"闭环）
- [ ] 文件版本代际（同一文件重写 N 次 → N 个节点，dsh-science 式溯源）
- [ ] 全局"这个会话干了什么"的一段话总结

## License

MIT
