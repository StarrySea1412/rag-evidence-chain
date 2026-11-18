# 给 RAG 装一条证据链 · 造物手记 VOL.18

一次关于「出处」的解剖：一台本机工作台的知识库检索如何把 RAG 当取证来做——切块、打分、配给、指纹、台账，每一环都留下可核对的痕迹。

**在线阅读：https://starrysea1412.github.io/rag-evidence-chain/**

![AI 技术栈全景图](docs/tech-stack.png)

## 标本

hermes-agent-workbench 后端的 `rag_service.py`（315 行）+ FileChunk 表 + 注入端 `chat_service.py` + 32 个测试：
自研混合检索（无 faiss/langchain），256 维哈希词法向量真算 + 0.65/0.35 混合评分、双阈值 0.15/0.08、TOP_K 6 / 单文件配额 2 / 2600 字符配给、`b"RAG\x01"` + SHA256 模型指纹封装、rag_sources 三点一线落账。

## 六章 · 六互动（全部确定性、可重放）

| 章 | 互动 | 真算口径 |
|---|---|---|
| 01 证据链的哲学 | 断链对照台 | 三种断链 × 测试断言对照 |
| 02 编目 | 编目真算台 | 切块算法完整移植：900/160、标题铁边界、行边界守卫 |
| 03 混合打分 | 打分真算台 | MD5 哈希向量余弦与标本 Python 逐位一致（对拍通过） |
| 04 阈值与配给 | 配给真算台 | 配额跳过 + 预算截断 + 停机条件 |
| 05 指纹与降级 | 指纹判定台 | `_stored_semantic_score` 条件序逐组判定 |
| 06 落地与台账 | 全链走查台 | query → 编目 → 盖印 → 打分 → 配给 → 注入 → 台账 |

零依赖：单 HTML + 一 CSS + 一 JS + 字体子集，无框架、无构建、无外部 API。

## 前身

本册由 2026-11-09 的施工图草稿长成：那版设想是「从问答到逐条留证」的实验设计——拒答优先、Wilson 显著性、四档实验矩阵（完整保留在 [draft-v13.html](https://starrysea1412.github.io/rag-evidence-chain/draft-v13.html)，其中 Wilson 区间小样为真实可复算）。正式版改为解剖真实标本：315 行 rag_service + 32 个测试，六枚小样全部真算。

## 系列

造物手记 VOL.18 · 前一册：[VOL.17 把危险关进笼子](https://starrysea1412.github.io/agent-sandbox/) · [全系列目录](https://starrysea1412.github.io/makers-notebook/)
