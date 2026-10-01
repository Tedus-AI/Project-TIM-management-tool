# Project TIM Management Tool — Claude Code 說明

## 先讀
1. `SPEC.md` — 規格、欄位設計理由、資料模型、檢核規則、開發階段（Phase 1 已完成，Phase 2 / 3 為下一步）
2. `README.md` — 使用方式與快捷鍵（改功能時同步更新，文案必須與實際行為一致）

## 架構
- **純靜態網頁，沒有 build**。`index.html` 依相依順序載入 classic script，全部掛在全域 `TIM` 命名空間。
- `js/core/*.js` 是 UMD：瀏覽器與 Node 單元測試共用，**不可碰 DOM**。
- UI：Preact 10 + htm（`window.htmPreact`，jsDelivr＋SRI，失敗改 unpkg）；ExcelJS 由 `js/io/loader.js` 延遲載入。
  升級 CDN 版本時必須同步更新 SRI hash。
- **所有資料修改都走 `TIM.actions`（`js/ui/actions.js`）** → `TIM.store.mutateProject / mutateMaterials / mutateDb`，
  才會有 undo scope、變更紀錄、自動存檔。UI 不可直接改 `TIM.store.db`。
- 儲存：`js/db/`（資料庫資料夾內的 JSON 檔、每日備份；IndexedDB 只用來記住資料夾 handle）；多人合併規則在 `js/core/merge.js`（以專案 / 材料為單位）。
- 位置標註幾何：`js/core/geom.js` 的 `layout()` 同時給 SVG 編輯器與 canvas 匯出（PNG、Excel 內圖片）使用。
  改標註樣式一律改這裡，編輯器與匯出才會一致。
- Excel「TIM List」工作表的欄位標題必須與使用者現行 Excel 完全相同（Location / Item / Used On / Vendor / Model / Size / Q'ty / Delta Part No. / Note / 2nd source）。

## 指令
```bash
npm test                                   # 單元測試（node:test）
npm ci && npx playwright install chromium  # E2E 前置
npm run test:e2e                           # 全部 E2E；node tests/e2e/run.js grid 只跑檔名含 grid 的
npm run serve                              # http://127.0.0.1:8765
for f in $(git ls-files '*.js'); do node --check "$f"; done   # 語法檢查（CI 也會跑）
```
雲端沙箱沒有對外 CDN 憑證時：把 pinned 的 CDN 檔放在一個資料夾（檔名 = 路徑把 `/` 換成 `_`），
設 `TIM_CDN_CACHE=<資料夾>`，E2E 會從本機提供（SRI 照樣驗證）；全域安裝的 Playwright 用 `NODE_PATH=$(npm root -g)`。
**不可關閉 TLS 驗證。** 壓力測試：`TIM_SLOW_FRAMES=1` 讓 animation frame 變慢（模擬忙碌的 CI 機器）。

## 規則與踩過的坑
1. **Repo 是公開的**：不可 commit 資料庫 JSON、匯出的 Excel、CAD 截圖、真實料號、真實專案的廠商 / 供應策略 / 元件清單。
   範例與測試資料一律用虛構名稱（Vendor-A…D、甲廠、LDO-A / BUCK-B、GF-750…、DEMO-xxxx 料號）。
   工具本身不提供試用模式與範例專案（使用者明確不要）；範例專案只存在測試 fixture。
2. **Preact + htm 事件名稱**：沒有對應 `on*` DOM 屬性的事件要寫小寫（`oncompositionstart`、`oncompositionend`、`onfocusin`），
   寫成 camelCase 不會觸發（曾造成注音 / 倉頡輸入的字消失）。
3. `useEffect` 裡註冊的 window / document listener 要透過 ref 讀最新的 props / state（effect 在 paint 後才跑，closure 會過期）。
   一出現就要接鍵盤的元件（對話框 Enter / Esc）改用 `useLayoutEffect` 註冊，否則開啟瞬間按下的鍵會遺失（CI 上實際發生過）。
4. **TIM 清單的列有 memo**（`GridRow` + `sig`）：列內畫到的任何值都要放進 `sig`；列內 handler 讀會變的父層狀態時，
   要用 `live.current` 或 ref（例如拖曳目標 `dropRef`），否則會拿到舊值。
5. `TextField` 聚焦時用本地 buffer，blur / Enter 才 commit；IME 組字中不可 commit 中間字。輸入中絕不整區重繪。
6. 對話框：Enter / Esc 由 `Modal` 統一處理；Enter 不可重新觸發開啟對話框的按鈕。
7. 儲存安全：壞檔 / 非本工具檔案 → 唯讀，絕不覆寫；孤兒圖片只在沒有任何引用（含 undo 歷史）時清除。
8. 版本號不可手改：`__BUILD_VERSION__` 由 Pages workflow 戳記；本地 JS / CSS 掛 `?v=__BUILD_VERSION__`。
   有新版時 `app.checkVersion` → 不可關閉的倒數視窗 → `app.applyUpdate`：先 blur 正在編輯的欄位、flush 存檔，
   存檔失敗絕不重新載入；用 `?v=<新版>` 重新載入，sessionStorage 擋重整迴圈（同一版本最多 2 次）。
9. 外部 fetch 要有 timeout（AbortController）。
10. 每個 UI 改動都要 headless 驗證（E2E 或 Playwright 腳本）後才 commit，並在 commit message 記錄驗證內容。
    HTML5 拖曳請用合成的 `DragEvent`（Playwright 模擬拖曳會合併 dragover 事件，測不到邊界情況）。
11. 介面文字用繁體中文，技術名詞保留英文；單位 mm、W、°C、°C/W。紅色只用在錯誤 / Fail。

## 測試慣例
- `tests/unit/*.test.js`：純邏輯（parse、calc、geom、store 合併與並發）。
- `tests/e2e/*.e2e.js`：匯出 `[{ name, run(env) }]`；`helpers.start()` 啟動伺服器與 Chromium，
  `openWithDemo(env)` 以記憶體中的假資料庫檔載入範例專案（`tests/e2e/fixtures/sample.js`）；
  起始頁流程用 `gate.e2e.js` 的假資料夾測；瀏覽器 console error 會讓測試失敗。
