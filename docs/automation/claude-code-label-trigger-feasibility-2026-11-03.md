# GTEki｜Claude Code 標籤觸發：可行性與最小試行（2026-11-03）

**狀態：研究筆記，尚未啟用任何自動化。** 不新增標籤、金鑰、runner 或執行工作流程；實際方案由現有 Claude Code／Opus 隊長依最新 repo 決定。

## 結論

**可行，但必須先分清兩種 Claude Code。** Anthropic 官方 `claude-code-action@v1` 支援 GitHub Issue 的 `labeled` 事件與 `label_trigger`。它會在 GitHub Actions runner 開啟**新的、獨立的 Claude Code 執行**，**不會自動喚醒目前電腦上長駐的 Opus 5.5 隊長**。若要交給既有本機 session，還需要另外設計受控的通知／佇列橋接，不能把 GitHub Action 等同於現成的本機協調器。

**已核對的 GTEki 現況：**公開倉庫的 `.github/workflows/e2e-smoke.yml` 和 `gis-test.yml` 是既有 CI／手動測試流程；沒有從這兩份檔案看到 Claude Action。**尚未完整列舉全部 workflow、Secrets、GitHub App 權限或本機隊長設定**，因此不能宣稱目前已具備觸發能力，或完全沒有其他自動化。

## 推薦的五步 PoC：先分析，不寫程式

1. **由 Owner 決定啟動。** 先用新標籤 `ai-triage`（而非直接拿 `ai-ready` 全自動實作）在一張低風險、無機密內容的 Open Issue 上試行。
2. **新增獨立 workflow，經 PR 審查後合併至預設分支。** 事件僅監聽 `issues: [labeled]`，以 job 條件同時限定標籤名稱與可信觸發者（例如 Owner）。不監聽所有新 Issue、PR 或留言。
3. **限定為分析回報。** 呼叫官方 `anthropics/claude-code-action@v1`（正式配置建議 pin 經審核的 commit SHA）；固定指令是讀 Issue、現有規格與程式，回報影響範圍、現成 Issues/PR 與待決問題；**不改檔、不 push、不建立 PR、不合併**。由隊長確認 action 在最小 GitHub 權限下能完成此模式。
4. **加上成本和安全閘門。** GitHub Actions secrets／受支援的驗證方式、最小化 `GITHUB_TOKEN` 權限、明確 timeout、`--max-turns`、單一 Issue 的 concurrency、預算與日誌稽核；不開放所有 bot 或無寫入權限的外部使用者觸發。
5. **人工驗證一次試跑。** 檢查是否只觸發一次、能否讀到必要上下文、回報品質、token／runner 成本和安全紀錄。通過後才考慮第二階段 `ai-ready` → 受限實作分支／PR → 原有 CI＋獨立 Review＋既定 merge gate。**不預設自動合併。**

## GTEki 特別注意

- **公開倉與私有資源分開。** GitHub-hosted runner 不會自然擁有 Owner 本機檔案、GPU、KIOXIA 素材或 `gteki-private` 的讀取權；不要為了方便把受限資料和 Secrets 接進公開 workflow。
- **Prompt injection／成本。** 公開 Issue 的文字不可信；要限制觸發者、工具與能寫入的範圍，避免自動評論再觸發下一輪。真正需要視覺 GPU、長時間 scene QA 的工作仍由現有主機流程負責。
- **GitHub 事件限制。** 其他 workflow 使用預設 `GITHUB_TOKEN` 加上的 label，一般不會再觸發 `issues:labeled` workflow；初期以 Owner 手動加標籤驗證。若將來改成「代理人自動加標籤」，需要另行設計授權，不要直接投入高權限 PAT。
- **工程治理。** 這只是現有 Opus 5.5 工作鏈的一個可選入口；避免平行派兩組 agent 接同一票或繞過獨立審查。

**建議下一步：**由 Claude Code 隊長先核對所有既有 workflows／權限／成本與目前的工作佇列，提交**只做分析、不做程式修改**的 PoC workflow PR；尚不啟用 `ai-ready` 自動實作。

## 官方參考

- [Anthropic：Claude Code Action 使用方式與標籤觸發](https://github.com/anthropics/claude-code-action/blob/main/docs/usage.md)
- [Anthropic：安全與觸發者權限](https://github.com/anthropics/claude-code-action/blob/main/docs/security.md)
- [Anthropic：Action FAQ（獨立執行、分支與限制）](https://github.com/anthropics/claude-code-action/blob/main/docs/faq.md)
- [GitHub：labeled 事件與條件觸發](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)
- [GitHub：GITHUB_TOKEN 的事件觸發限制](https://docs.github.com/en/actions/concepts/security/github_token)
