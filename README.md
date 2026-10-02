# 專案 TIM 管理工具（Project TIM Management Tool）

管理每個專案的 TIM（Thermal Interface Material）使用清單、機台內實際位置、機構間隙與壓縮率、
TIM 溫升估算、第二來源、成本與變更紀錄。用來取代「一個專案一張 Excel」的做法，
同時保留現行 Excel 的欄位與格式：可以直接貼上 / 匯入舊表，也能匯出成同樣版面的 Excel。

> 完整規格（欄位設計理由、資料模型、檢核規則、開發階段）見 [SPEC.md](SPEC.md)。

---

## 功能一覽

| 頁面 | 內容 |
|---|---|
| **首頁** | 專案列表（階段、負責人 TH / ME、規模、健康度、位置圖片數、最後更新與熱流負責人）；跨專案搜尋（Item / Vendor / Model / Delta P/N / Vendor P/N / 覆蓋元件與 RefDes / 2nd source / 加工廠 / 備註）；匯入 Excel、匯入分享檔 |
| **總覽** | 專案資料（產品類型 Sub-6 / mmWave、客戶、階段、負責人、備註）、KPI、材料用量彙總（片狀以 pcs、點膠類以 g / cc 計）、**待處理事項**（缺間隙、壓縮率超出建議、單一來源、放置數 ≠ Q'ty、ΔT 超過門檻…）點一下直接跳到該 Item |
| **TIM 清單** | 類 Excel 表格：沿用現行欄位（Location / Item / Used On / Vendor / Model / Size / Q'ty / Delta P/N / Note / 2nd source），可展開「機構 / 熱 / 供應 / 追溯」欄位群組；鍵盤操作、範圍複製、從 Excel 貼上多列、拖曳排序、Undo / Redo |
| **Item 詳細** | 每個 Item 的完整資料：覆蓋元件（RefDes、封裝尺寸、功耗、頂面散熱 %）、間隙 min / nom / max 與壓縮率、熱估算、第二來源與驗證狀態、成本 / MOQ / 交期、驗證照片、備註連結、修改歷史 |
| **位置標註** | 在 Bottom / Top case 等 CAD 截圖上標出 TIM 位置：比例尺校正後 pad 以**實際尺寸**放置、可旋轉；標籤自動拉引線到同 Item 的 pad（一個標籤可指多片）；圖例、放置數與 Q'ty 比對、PNG 匯出 |
| **間隙與熱檢核** | 每個 Item 的壓縮率範圍圖（含建議範圍）、TIM 溫升 ΔT 排行 |
| **變更紀錄** | 每次修改自動記錄（誰、何時、舊值 → 新值）、手動紀錄 / ECN、Build 基準（EVT / DVT / PVT）與任兩版本差異比較 |
| **材料庫** | 跨專案共用的 TIM 材料（k 值、硬度、溫度範圍、UL…；Gap Filler / Thermal Putty 另選**劑型**：單劑型 / 雙劑型）；**匯入材料**（規格書交給 AI，匯入它輸出的 JSON）；**規格書檔案**（檢視 / 上傳 / 下載 / 刪除 / 清單，可一次多份），Where-used 反查哪些專案在用；Item 連結材料後，材料資料由材料庫帶入 |

### 比原本 Excel 多記錄的項目（摘要）

細節與每個欄位的理由見 SPEC §3。重點：

- **機構間隙 min / nom / max** → 自動算壓縮率範圍，對照建議壓縮率（太鬆可能沒接觸、太緊壓壞元件或撐開殼）
- **覆蓋元件的 RefDes、封裝尺寸、功耗、頂面散熱比例** → 估算經過 TIM 的溫升，找出「TIM 本身是瓶頸」的位置
- **第二來源的驗證狀態**（未評估 / 送樣中 / 驗證通過 / 不採用）而不只是一個名字；單一來源自動標示風險
- **TIM 型式**（pad / gap filler / grease / PCM…）、**離型膜 / 背膠 / 方向**、點膠量與 BLT
- **成本、MOQ、交期、加工廠**；**AVL 狀態**；**驗證照片**（拆機壓痕照）
- **變更紀錄與 Build 基準**：EVT → DVT 改了哪些 TIM，一鍵比較

---

## 開始使用

### 1. 開啟工具

建議使用 **Chrome 或 Edge**。三種開法擇一：

- **直接開檔**：雙擊 `index.html`（`file://` 也能用，已驗證）。
- **本機伺服器**：`npm run serve` → 開 <http://127.0.0.1:8765>
- **GitHub Pages**：見下方〈部署〉。

> 介面框架（Preact）、Excel / PDF 函式庫與 Microsoft 登入（MSAL.js）由 CDN 載入並以 SRI 驗證，第一次開啟需要網路。

### 2. 選擇資料庫

起始頁有兩種資料庫，擇一：

**SharePoint 共用資料庫**（建議，多人共用）：按「SharePoint 共用資料庫」→ 以公司 Microsoft 帳號登入（彈出視窗）→
開啟 `Thermal-Spec-DB` 網站上的 `TIM_Manager/Database/tim_db.json`；還沒有時會詢問是否建立。
規格書存在同一層的 `TIM_Manager/Datasheets/`。登入過一次之後，下次開啟會自動進入；
登入過期時畫面上會出現「重新登入 Microsoft」按鈕（不會遺失尚未寫入的修改）。
變更紀錄用的是 Microsoft 帳號的名字。
**熱流 / 機構負責人**是下拉選單：列出 SharePoint 清單 `Project_Members`（AI Thermal 工具維護的那一份）裡
Function = TH/ME、IsActive 的人員（同一人只列一次），新增專案時熱流負責人預設為自己（以 e-mail 比對）；
名單裡沒有的人選「手動輸入…」。沒有登入或讀不到清單時是一般文字欄位。
已經在用本機資料夾的資料庫：開啟後到「設定 → 搬到 SharePoint…」，會把資料庫與規格書上傳並改用 SharePoint
（SharePoint 上已經有資料庫時不會覆蓋）。

**本機資料夾**：按「本機資料夾…」，選放資料庫的資料夾：

| 資料夾內容 | 結果 |
|---|---|
| 有 `tim_db.json` | 直接開啟並進入工具 |
| 沒有 `tim_db.json`，但有一個 TIM 資料庫 JSON | 直接開啟它 |
| 有好幾個 TIM 資料庫（例如每日備份） | 列出來讓你選一個 |
| 沒有任何 TIM 資料庫 | 詢問是否建立 `tim_db.json`，建立後直接進入 |

資料夾裡其他不是 TIM 資料庫的 JSON 檔不會被讀寫；規格書存在資料夾內的 `Datasheets/`。
下次開啟會顯示「上次使用」，按「繼續使用」即可。工具內右上角的資料庫按鈕（「切換」）會先存檔，再回到這個選擇畫面。

### SharePoint 為主、本機副本只寫不讀

| 你在用的 | 每次存檔（自動：修改後約 0.8 秒；或 Ctrl+S） |
|---|---|
| **SharePoint**（平常） | 寫入 SharePoint；有設定「本機副本」時，再把 SharePoint 的最新內容寫一份到那個資料夾的 `tim_db.json`（只寫不讀）。別人的修改每 15 秒同步進來時，本機副本也跟著更新 |
| **本機資料夾**（不小心開到） | 寫入本機資料夾，**同時合併寫入 SharePoint**（以專案 / 材料為單位，不覆蓋別人的修改；兩邊都改了同一個專案時，SharePoint 的版本保留、你的另存「衝突副本」）；本機新上傳的規格書也一起上傳 |

- **本機副本**：SharePoint 模式下到「設定 → 設定本機副本資料夾…」。重新開瀏覽器後可能要按一次「授權」。
  那個資料夾裡的 `tim_db.json` 若在別處被改過（不是工具最後寫的那份），會先另存為 `tim_db_local_日期時間.json` 再寫入，不會覆蓋；
  資料夾裡的 `tim_db.json` 不是 TIM 資料庫時不會寫入。規格書檔案不複製（都在 SharePoint）。
- **在本機資料夾作業時**：頂端一直有提醒列與「切換到 SharePoint」按鈕；開啟時、以及之後每隔 10 分鐘以上的存檔，會跳出
  「目前在本機資料夾作業」視窗。寫入 SharePoint 失敗（斷線、未登入）時立即跳出「未同步到 SharePoint」警告，
  修改先留在本機並記住，之後自動重試、下次開啟這個資料夾、或改開 SharePoint 時（資料夾還能存取）會自動補寫。

**設定**（右上角齒輪）：新專案預設 Location（下拉：Bottom Case + Top Case / Bottom Case / Top Case）——
「新增專案」時預先帶入，決定 TIM 清單的分組與 Excel 的 Location 欄，建立後仍可在專案總覽增減、改名；預設幣別；
資料庫位置、備份、本機副本（SharePoint 模式）或同步狀態（本機模式）。

### SharePoint 設定（一次性）

1. 在 `Thermal-Spec-DB` 網站的「文件」底下建立資料夾（資料夾不存在時工具也會自動建立）：
   ```
   TIM_Manager/
   ├── Database/      tim_db.json（資料庫）＋ Backup/（每日備份，自動建立）
   └── Datasheets/    <Vendor>/<Model>/<規格書檔案>（上傳時自動建立）
   ```
2. Azure 應用程式（與 AI Thermal pad & stud 工具共用同一個）：**Microsoft Entra ID → 應用程式註冊 → 驗證 →
   單頁應用程式（SPA）的重新導向 URI** 加上 `https://tedus-ai.github.io/Project-TIM-management-tool/auth.html`。
   權限沿用 `Files.ReadWrite.All`、`Sites.Read.All`、`Sites.ReadWrite.All`。
3. 使用者需要該網站的編輯權限。網站、資料夾路徑在 `js/db/sharepoint.js` 的 `CONFIG`。

### 材料庫：規格書交給 AI，匯入就建好材料

材料庫右上「匯入材料」：
1. 按「複製 AI 指令」，把指令連同廠商規格書（PDF）一起交給 AI（Claude、ChatGPT、Copilot…）。
2. AI 輸出 `tim-material` 格式的 JSON；把檔案拖進來，或直接貼上 AI 的回覆（前後有說明文字、包在 ```json 裡都可以）。
   規格書 PDF 也可以一起拖進來，匯入時附到材料上（需以 SharePoint 或資料夾開啟資料庫）。
3. 預覽每一種材料：Vendor + Model 跟材料庫相同的會標「已在材料庫」，預設**只補空白欄位**（可改「覆蓋」或「略過」）；
   新的標「新材料」。「明細」列出每個欄位的匯入值、材料庫目前值，以及 AI 附上的**規格書原文與頁碼**，方便核對。
4. 「匯入」是一個 Undo 步驟（材料庫 Ctrl+Z 復原）。

**為什麼用 JSON**：AI 輸出結構化資料最穩定（欄位名固定、數字與單位分開、一份規格書多個型號就是多筆、每個欄位可附依據），
不會有 Excel 欄位錯位、編碼或合併儲存格的問題。格式：

```json
{ "format": "tim-material", "version": 1,
  "materials": [ { "vendor": "Vendor-B", "model": "GF-750", "tim_type": "pad", "k": 7.5, "k_method": "ASTM D5470",
                   "hardness": 45, "hardness_scale": "Shore 00", "temp_min": -40, "temp_max": 200, "...": "...",
                   "evidence": { "k": "p.1 Thermal Conductivity 7.5 W/m-K (ASTM D5470)" } } ] }
```

欄位、單位與可用選項以「複製 AI 指令」的內容為準（同一份定義也用來讀檔：`js/core/matimport.js`）。
讀檔時會自動整理常見寫法：數字帶單位（`7.5 W/m·K`）、`Shore OO`、`V0`、`Compliant`、`Gap Pad`、劑型的 `1-Part` / `2K` / `A/B` 之類都會轉成工具的選項；
看不懂的值與多出來的欄位會列成提醒，不會匯入。劑型（`parts`）只用在 Gap Filler / Thermal Putty，其他型態帶了也不匯入（列提醒）。

### 3. 把現有的 Excel 搬進來

兩種方式：

- **匯入 Excel**（首頁）：選 `.xlsx` → 自動辨識標題列與欄位（可手動調整對應）→ 預覽 → 匯入成新專案或併入既有專案。
  支援合併儲存格的 Location 欄、`2nd source` 文字解析（例如 `short:甲廠,long:Vendor-C`、`Vendor-A only source`），
  Excel 內的圖片會變成位置標註的視圖，可選擇同時把 Vendor / Model 建成材料庫。
- **直接貼上**：在 TIM 清單按「從 Excel 貼上多列」，或在任一格 Ctrl+V。

### 4. 標註 TIM 位置（位置標註頁）

1. **新增視圖**：Ctrl+V 貼上 CAD 截圖，或把圖片拖進來（每張圖 = 一個視圖，例如 Bottom case / Top case）。
2. **比例尺（C）**：在圖上點兩個已知距離的點（按住 Shift 鎖水平 / 垂直），輸入實際長度（mm）。
3. **放置 TIM（P）**：左側調色盤選 Item → 在圖上點擊，pad 依 Item 的 L × W 以實際尺寸放上；
   R 旋轉 90°、Shift+R 旋轉 45°。尚未校正比例尺時改用拖曳畫範圍。
4. **標籤（L）**：點擊放置標籤，引線自動指向同 Item 最近的 pad；同一 Item 有多個標籤時，每片 pad 會分給最近的標籤。
   也可在右側面板手動指定引線目標。
5. 右側面板可調整字級、引線與引線顏色、填色透明度、比例尺條；「圖例與片數檢核」比對各 Item 放置片數與 Q'ty，不一致時按「Q'ty=n」一鍵更新。
6. 匯出：工具列下載 PNG，或匯出 Excel 時自動附在「TIM List」工作表下方。

### 5. 匯出

- **匯出 Excel**（專案頁右上）：「TIM List」工作表與現行 Excel 版面相同（Location 合併直書、
  單一來源粉紅底、未驗證來源黃底）、下方附位置圖；另有元件、第二來源、間隙與熱、變更紀錄、專案資訊等工作表。
  檔名：`<專案>_TIM_<階段>_<YYYYMMDD>.xlsx`。
- **匯出 PDF**（「匯出 Excel」旁邊）：A4 橫式報告，可勾選要包含的頁面——總覽（專案資訊、狀態、待處理事項）、
  TIM 清單（與 Excel「TIM List」相同欄位與底色，太長時自動分頁並重複表頭）、位置標註圖（每張視圖一頁，含圖例與片數）、
  材料用量彙總與壓縮率檢核。頁框與 Thermal Test Report Builder 相同；檔名：`<專案>_TIM_<階段>_<YYYYMMDD>.pdf`。
- **分享檔（JSON）**：單一專案匯出給同事；匯入時重新配發內部 ID（不會和既有資料衝突），相同的材料直接沿用材料庫中的那一筆。

---

## 快捷鍵

| 範圍 | 按鍵 | 動作 |
|---|---|---|
| 全域 | Ctrl+S | 立即存檔 |
| | Ctrl+Z / Ctrl+Shift+Z、Ctrl+Y | 復原 / 重做（專案、材料庫各自獨立） |
| TIM 清單 | 方向鍵、Tab、Enter | 移動儲存格 |
| | F2 / 直接打字 | 編輯；Esc 取消這次修改 |
| | Shift + 方向鍵、拖曳 | 選取範圍；Ctrl+C 複製、Ctrl+V 貼上、Delete 清除 |
| | Ctrl+D | 向下填滿 |
| | 右鍵 / 列尾「⋯」 | 插入、複製為尺寸變體、移到其他 Location、刪除 |
| 位置標註 | V / P / L / C | 選取 / 放置 TIM / 標籤 / 比例尺 |
| | R、Shift+R | 旋轉 90°、45° |
| | 方向鍵（Shift ×10） | 微調位置 |
| | Shift+點擊、Ctrl+D、Delete | 多選、複製、刪除選取 |
| | 空白鍵 + 拖曳、滾輪、0、+ / − | 平移、縮放、適合畫面 |
| 對話框 | Enter / Esc | 確定 / 取消 |

---

## 計算公式

| 項目 | 公式 |
|---|---|
| 壓縮率 | C = (T − g) / T × 100%；C<sub>min</sub> 用最大間隙、C<sub>max</sub> 用最小間隙 |
| 建議壓縮率來源 | Item 手動 → 一般建議值（依 TIM 類型；pad / absorber 10–30%） |
| TIM 熱阻 | R = t<sub>c</sub>[mm] × 1000 / (k × A<sub>eff</sub>[mm²])　[°C/W] |
| 壓縮後厚度 | t<sub>c</sub> = min(間隙 nom, T)；無間隙資料時用 T（保守）；點膠類用 BLT |
| 有效面積 | A<sub>eff</sub> = min(pad 面積, 元件頂面面積) |
| 溫升 | ΔT = P<sub>TIM</sub> × R，P<sub>TIM</sub> = 單顆功耗 × 頂面散熱 %（空白 = 100%） |

ΔT 為 bulk k 估算，不含接觸熱阻與擴散熱阻，用於排序與找出風險位置，不取代模擬或實測；ΔT ≥ 10 °C 列入待處理事項。

---

## 資料存放與安全

- **單一 JSON 檔**就是整個資料庫（含圖片），放在 SharePoint（或本機 / 網路磁碟的資料夾）多人共用；規格書是另外的檔案，資料庫只記路徑。
- **自動存檔**：修改後約 0.8 秒寫入；每 15 秒檢查檔案是否被別人改過，有的話自動合併。
- **並發保護**：每個專案與材料各有版本號。不同人改不同專案（或不同材料）→ 自動合併；
  兩人同時改同一個專案 → 保留對方的版本，你的版本另存為「專案名 (衝突副本 M/D HH:MM)」並在畫面上提示，不會互相覆蓋。
  SharePoint 上每次寫入都帶 eTag（If-Match）：在「讀取 → 寫入」之間有人剛存過，SharePoint 會拒絕（412），工具重新讀取、合併後再寫，
  連線逾時但其實已寫入的情況也不會被當成衝突。
- **壞檔 / 非本工具的檔案**：進入唯讀，絕不覆寫。
- **每日自動備份**：SharePoint 自動存到 `TIM_Manager/Database/Backup/`；本機資料夾則在「設定」指定備份資料夾。
  開啟時、每 3 小時與切換視窗時檢查，每天存一份 `tim_db_backup_YYYY-MM-DD.json`，保留 30 份。
- **規格書刪除**：從清單刪除後，存檔成功且沒有任何材料再引用時才刪實體檔（SharePoint 會進資源回收筒，可還原）；
  同檔名上傳會取代那一份（SharePoint 保留版本歷程）。
- 圖片只存在資料庫內；刪除視圖或 Item 時會一併清掉不再使用的圖片。

> ⚠️ **這個 repository 是公開的。** 請不要把資料庫 JSON、匯出的 Excel、CAD 截圖或任何實際專案資料 commit 進來。
> `.gitignore` 已排除 `*.json`（設定檔除外）、`*.xlsx`、`backups/`、`data/`、`drawings/`。
> 測試用的範例資料（`tests/e2e/fixtures/sample.js`）全部為虛構資料，不會出現在工具裡。

---

## 部署（GitHub Pages）

網址：<https://tedus-ai.github.io/Project-TIM-management-tool/>

1. 一次性設定：Repository **Settings → Pages → Build and deployment → Source** 選 **GitHub Actions**。
   部署內容：`index.html`、`auth.html`（Microsoft 登入的重新導向頁，空白頁）、`version.json`、`css/`、`js/`、`assets/`。
2. 之後每次 push 到 `main` 自動部署；也可到 **Actions → Deploy to GitHub Pages → Run workflow** 手動部署。
3. 部署時 CI 會把 `__BUILD_VERSION__` 換成 `日期時間-commit`。目前版本顯示在起始頁右下角、左上角標誌的提示，以及「設定」裡。

**自動更新**：工具開啟時、每 5 分鐘、切回分頁時都會檢查網站上的版本。有新版時跳出「有新版本」視窗，
倒數 10 秒（起始頁 3 秒）或按「立即更新」後：先把正在編輯的欄位寫入、儲存資料庫，再載入新版本（網址帶版本參數，
瀏覽器與 CDN 都不會給舊頁面）。存檔失敗時不會更新，會顯示錯誤並等你處理後「重試」。
同一個新版本重新載入兩次仍沒生效（例如 CDN 還沒更新）時，改為右下角提示，不會一直重整。

網站只包含程式本身；資料存在你選的位置（公司 SharePoint 或本機資料夾），不會傳到其他地方。

---

## 開發

不需要 build：純靜態網頁（Preact + htm，以 classic script 載入），`js/core/` 的邏輯同時給瀏覽器與 Node 單元測試使用。

```
index.html            進入點（載入順序即相依順序）
css/app.css           設計 token 與元件樣式
js/core/              schema、parse（Excel 文字解析）、calc（壓縮 / 熱 / 檢核）、geom（標註幾何）、merge、store（undo / 存檔 / 合併）、
                      matimport（材料匯入格式、AI 指令、解析）
js/db/                SharePoint（Microsoft Graph + MSAL，eTag）、本機資料夾（File System Access API）、每日備份、
                      sync.js（SharePoint → 本機副本；本機資料夾 → 合併寫入 SharePoint）
js/io/                Excel 匯出 / 匯入、圖片處理、視圖繪製、分享檔
js/ui/                各頁面與共用元件
tests/unit/           Node 單元測試（node --test）
tests/e2e/            Playwright 瀏覽器測試（fixtures/sample.js：測試用虛構專案）
```

```bash
npm test                  # 單元測試
npm ci                    # 安裝 Playwright（E2E 需要）
npx playwright install chromium
npm run test:e2e          # 瀏覽器 E2E（可帶檔名過濾，例如 node tests/e2e/run.js grid）
npm run serve             # http://127.0.0.1:8765
```

GitHub Actions（`.github/workflows/ci.yml`）在每次 push / PR 執行語法檢查、單元測試與 E2E。
