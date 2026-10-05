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
| **總覽** | 專案資料（產品類型 Sub-6 / mmWave、客戶、階段、負責人、備註）、KPI、材料用量彙總（片狀以 pcs、點膠類以 g / cc 計）、**待處理事項**（缺間隙、壓縮不足、壓力超過元件耐壓、單一來源、放置數 ≠ Q'ty、ΔT 超過門檻…）點一下直接跳到該 Item |
| **TIM 清單** | 類 Excel 表格：沿用現行欄位（Location / Item / Used On / Vendor / Model / Size / Q'ty / Delta P/N / Note / 2nd source），**Vendor / Model 從材料庫下拉選取即連結**，可展開「機構 / 熱 / 供應 / 追溯」欄位群組；**「顯示 / 隱藏」個別勾選要顯示的欄與列**（只影響自己的畫面）；鍵盤操作、範圍複製、從 Excel 貼上多列、拖曳排序、Undo / Redo |
| **Item 詳細** | 每個 Item 的完整資料：覆蓋元件（RefDes、封裝尺寸、功耗、頂面散熱 %、**受壓類型**；**RefDes 欄可下拉快選用過的元件，依類別分組**）、**設計間距 ± 公差 ＋ 元件高度公差 → 間隙 → 壓縮率 → 壓力**（逐顆元件對照耐壓）、熱估算、第二來源與驗證狀態、成本 / MOQ / 交期、驗證照片、備註連結、修改歷史 |
| **位置標註** | 在 Bottom / Top case 等 CAD 截圖上標出 TIM 位置：比例尺校正後 pad 以**實際尺寸**放置、可旋轉；標籤自動拉引線到同 Item 的 pad（一個標籤可指多片）；圖片可旋轉 / **裁切**（pad 與比例尺留在原位置）；圖例、放置數與 Q'ty 比對、PNG 匯出 |
| **間隙與壓力檢核** | 每個 Item 的覆蓋元件、壓縮率範圍圖（最小壓縮率以上為綠底）、最大壓力、TIM 溫升 ΔT 排行 |
| **變更紀錄** | 每次修改自動記錄（誰、何時、舊值 → 新值）、手動紀錄 / ECN、Build 基準（EVT / DVT / PVT）與任兩版本差異比較 |
| **材料庫** | 跨專案共用的 TIM 材料（k 值、硬度、溫度範圍、UL…；Gap Filler / Thermal Putty 另選**劑型**：單劑型 / 雙劑型）；**壓力–壓縮曲線**（每個厚度一條，畫成曲線圖）；**匯入材料**（規格書交給 AI，匯入它輸出的 JSON）與**重新匯入**（規格書更新時更新既有材料）；**規格書檔案**（檢視 / 上傳 / 下載 / 刪除 / 清單，可一次多份），Where-used 反查哪些專案在用；Item 連結材料後，材料資料由材料庫帶入 |

### 比原本 Excel 多記錄的項目（摘要）

細節與每個欄位的理由見 SPEC §3。重點：

- **設計間距**（散熱片凸台到元件頂面，就是給機構的間距）**± 公差、元件高度 min / nom / max** → 自動算間隙（最壞情況）與壓縮率；太鬆可能沒接觸（低於最小壓縮率），
  太緊用**材料的壓力–壓縮曲線換算壓力**，對照每顆元件的耐壓判定 Warning / Fail（不再用壓縮率上限）；
  元件依**受壓類型**決定要不要判定耐壓（E-PAD / QFN 類壓力照算、只顯示不判定）
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
變更紀錄用的是 Microsoft 帳號的名字。右上角存檔狀態旁會顯示目前登入的 Microsoft 帳號 ID（綠色人像）；
登入過期或尚未登入時改成黃色「需重新登入 / 未登入 Microsoft」，點一下即可登入。
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

**重新匯入**（規格書改版、或要補壓力曲線時）：打開材料 → 右上「重新匯入」。複製的 AI 指令已寫好要沿用這個材料的
Vendor / Model；把新版規格書交給 AI，貼回它的輸出。預設**覆蓋**這個材料（AI 有填的欄位才更新，沒填的保留；名稱不變），
明細可逐欄核對，同樣是一個 Undo 步驟。

**Item 要連結材料，k 值與壓力曲線才會帶入**：
- TIM 清單的 Vendor / Model 格、Item 詳細的 Vendor / Model 欄：點一下（或 Item 詳細的 ▾、TIM 清單的 Alt+↓）就列出**整個材料庫**，
  即使格子裡已經有字（選錯了直接再點一次重選，不必先清空）；打字會篩選（比對 Vendor、Model、型態）。↑↓ 選擇、Enter 或點一下 → **連結**該材料，
  Vendor / Model 改由材料庫帶入（🔒，✂ 解鎖可改回手動）；Esc 只關閉清單。
- 手動打字時，離開欄位後若 Vendor ＋ Model 與材料庫**剛好一筆**完全相同（全形 / 半形、大小寫、前後空白不計），自動連結。
- 名稱與材料庫相同卻沒連結的 Item（例如舊資料、從 Excel 貼上的列）：TIM 清單上方出現提示列，按「**全部連結**」一次連結
  （一個 Undo 步驟）；總覽的待處理事項與 Item 詳細的間隙區也會提示。沒連結時，壓力無法由材料的壓力曲線換算。

**為什麼用 JSON**：AI 輸出結構化資料最穩定（欄位名固定、數字與單位分開、一份規格書多個型號就是多筆、每個欄位可附依據），
不會有 Excel 欄位錯位、編碼或合併儲存格的問題。格式：

```json
{ "format": "tim-material", "version": 1,
  "materials": [ { "vendor": "Vendor-B", "model": "GF-750", "tim_type": "pad", "k": 7.5, "k_method": "ASTM D5470",
                   "hardness": 45, "hardness_scale": "Shore 00", "temp_min": -40, "temp_max": 200, "...": "...",
                   "pressure_curves": [ { "thickness_mm": 1.0, "points": [[10, 13], [20, 38], [50, 68]] } ],
                   "evidence": { "k": "p.1 Thermal Conductivity 7.5 W/m-K (ASTM D5470)" } } ] }
```

`pressure_curves` 是規格書的 Deflection vs Pressure：每個厚度一條，`points` 為 `[壓力 psi, 壓縮率 %]`；只有曲線圖時由 AI 讀圖取點
（evidence 註明「讀圖」）。材料庫的「壓力–壓縮曲線」也可以手動輸入，或從 Excel 複製兩欄貼上。

欄位、單位與可用選項以「複製 AI 指令」的內容為準（同一份定義也用來讀檔：`js/core/matimport.js`）。
讀檔時會自動整理常見寫法：數字帶單位（`7.5 W/m·K`）、`Shore OO`、`V0`、`Compliant`、`Gap Pad`、劑型的 `1-Part` / `2K` / `A/B` 之類都會轉成工具的選項；
看不懂的值與多出來的欄位會列成提醒，不會匯入。劑型（`parts`）只用在 Gap Filler / Thermal Putty，其他型態帶了也不匯入（列提醒）。

### 3. 把現有的 Excel 搬進來

兩種方式：

- **匯入 Excel**（首頁）：選 `.xlsx` → 自動辨識標題列與欄位（可手動調整對應）→ 預覽 → 匯入成新專案或併入既有專案。
  支援合併儲存格的 Location 欄、`2nd source` 文字解析（例如 `short:甲廠,long:Vendor-C`、`Vendor-A only source`），
  Excel 內的圖片會變成位置標註的視圖，可選擇同時把 Vendor / Model 建成材料庫。
- **直接貼上**：在 TIM 清單按「從 Excel 貼上多列」，或在任一格 Ctrl+V。

### 4. TIM 清單：只看需要的欄與列

工具列「**顯示 / 隱藏**」打開後，左邊勾選要顯示的欄（直行）、右邊勾選要顯示的列（Item，依 Location 分組）；
也可以在欄位標題按右鍵「隱藏此欄」、在列號按右鍵（或列尾「⋯」）「隱藏此列」。有隱藏時工具列會出現黃色的「已隱藏 N 列、N 欄 · 全部顯示」，
各 Location 小計旁也會註明「另有 N 列隱藏」。

- 只影響你這台瀏覽器的畫面（記在瀏覽器裡：欄位設定全部專案共用、隱藏的列每個專案各自記），**不改資料**。
- **匯出 Excel / PDF 會同步**：匯出對話框會列出「不匯出隱藏的 N 列、N 欄」（預設勾選，取消就匯出全部）。
  隱藏的 Item 不出現在任何表格與統計（TIM List、元件 / 第二來源 / 間隙與壓力明細、材料用量、壓縮率檢核、總覽數字），位置標註圖維持原圖；
  隱藏的欄只影響 TIM 清單表格（Excel「TIM List」與 PDF 的 TIM 清單頁）。
- Item 欄固定顯示。機構 / 熱 / 供應 / 追溯欄位用「欄位」按鈕展開後，也能在面板裡個別隱藏。
- 複製 / 貼上依完整欄序：框選畫面上相鄰的兩欄時，中間隱藏的欄也會一起複製；從 Excel 貼上整列時，隱藏的欄照樣收到它那一格（提示會註明幾格寫入隱藏欄），
  不會因為隱藏欄位而錯位。Delete 清除與 Ctrl+D 向下填滿只作用在看得到的欄。

### 5. 覆蓋元件：用過的元件快選（RefDes 欄下拉）

同一顆元件只要在任何專案填過一次，之後同案或他案再用到都可以從 **RefDes 欄的下拉清單**快選帶入：

- **Item 詳細 › 覆蓋元件**：按「新增元件」後游標直接在 RefDes 欄，下方列出用過的元件，**依類別分組**
  （RF / DIGI / PWR / DDR / OPT / Other，沒填類別的放最後「未分類」）；每個元件顯示名稱（RefDes，另有元件料號時一併顯示）、
  功耗、封裝、高度、耐壓與來源 Item。已有內容的欄位按右側 ▾ 也能打開。
- 在 RefDes 欄輸入幾個字就會篩選（比對 RefDes 與元件料號、不分大小寫，`trx1235` 也找得到 `TRX-1235`）。
  ↑↓ 選擇、Enter 或點一下帶入，Esc 只關閉清單；只有名稱完全相同時才會預先選取，所以輸入新名稱按 Enter 不會被換掉。
- 帶入的是 **RefDes、元件料號、類別、受壓類型、功耗、頂面 %、封裝 L×W、高度 min / nom / max、耐壓＋單位**；數量、備註每個設計不同，不帶。
  選取會覆寫該列這些欄位（Ctrl+Z 一次就復原，變更紀錄會記一筆「元件快選」）。
- 只有在下拉清單選取才會帶入：在元件料號欄打字、TIM 清單的 Note 欄、貼上或匯入 Excel 都不會自動帶入。
- 同一個元件（RefDes ＋ 元件料號相同）在不同地方的值不一樣時，取最近更新的專案的值，清單上會標示「功耗各處不同」等字樣，記得確認。
- 不必另外維護元件庫：清單直接取自所有專案的覆蓋元件；在某個 Item 修正數值，之後的快選就會用新的值。

**受壓類型**（Item 詳細 › 間隙與壓縮的元件高度表）：決定這顆元件要不要判定耐壓。壓力每一顆都照算、照樣顯示。

| 受壓類型 | 判定耐壓 | 理由 |
|---|---|---|
| BGA / CSP（錫球） | 是 | 錫球長時間受壓會潛變（creep），加上溫度循環易疲勞 |
| 裸晶 / 無蓋 flip-chip | 是 | die 直接受壓，可能裂開或崩角 |
| 空腔 / 有蓋 / 遮蔽罩 | 是 | air-cavity、SAW / BAW、晶振、遮蔽罩模組的蓋子可能被壓變形 |
| E-PAD / QFN / LGA / 引腳 | 否 | 焊點低而寬，負載由本體與大面積焊墊分散；耐壓顯示「不需」，壓力只顯示、不判定 |
| 未指定（預設） | 有填耐壓才判定 | 既有元件維持原本的行為 |

選了需要判定的類型卻沒填耐壓時，Item 詳細的間隙區會提示「需檢核耐壓：請填元件規格書的 max static load」。

### 6. 標註 TIM 位置（位置標註頁）

1. **新增視圖**：Ctrl+V 貼上 CAD 截圖，或把圖片拖進來（每張圖 = 一個視圖，例如 Bottom case / Top case）。
2. **比例尺（C）**：在圖上點兩個已知距離的點（按住 Shift 鎖水平 / 垂直），輸入實際長度（mm）。
3. **放置 TIM（P）**：左側調色盤選 Item → 在圖上點擊，pad 依 Item 的 L × W 以實際尺寸放上；
   R 旋轉 90°、Shift+R 旋轉 45°。尚未校正比例尺時改用拖曳畫範圍。
4. **標籤（L）**：點擊放置標籤，引線自動指向同 Item 最近的 pad；同一 Item 有多個標籤時，每片 pad 會分給最近的標籤。
   也可在右側面板手動指定引線目標。
5. 右側面板可調整字級、引線與引線顏色、填色透明度、比例尺條；「圖例與片數檢核」比對各 Item 放置片數與 Q'ty，不一致時按「Q'ty=n」一鍵更新。
6. 圖片：右側「視圖」可更換、旋轉 90°、**裁切**（在圖上拖曳框出要保留的範圍；範圍外的 pad 會先列出再移除，
   其餘 pad、標籤與比例尺留在圖上的原位置，可 Ctrl+Z 復原）。
7. 匯出：工具列下載 PNG，或匯出 Excel 時自動附在「TIM List」工作表下方。

### 7. 匯出

- **匯出 Excel**（專案頁右上）：「TIM List」工作表與現行 Excel 版面相同（Location 合併直書、
  單一來源粉紅底、未驗證來源黃底）、下方附位置圖；另有元件（含 Load type）、第二來源、間隙與熱（Gap & Thermal）、逐顆元件壓力（Pressure，E-PAD 類耐壓「不需」、判定「不檢核」）、變更紀錄、專案資訊等工作表。
  檔名：`<專案>_TIM_<階段>_<YYYYMMDD>.xlsx`。
- **匯出 PDF**（「匯出 Excel」旁邊）：A4 橫式報告，可勾選要包含的頁面——總覽（專案資訊與狀態）、
  TIM 清單（與 Excel「TIM List」相同欄位與底色，太長時自動分頁並重複表頭）、位置標註圖（每張視圖一頁，含圖例與片數）、
  材料用量彙總、壓縮率與壓力檢核（兩者可分開勾選；檢核表在 Location 與材料之間列出覆蓋元件）。頁框與 Thermal Test Report Builder 相同；檔名：`<專案>_TIM_<階段>_<YYYYMMDD>.pdf`。
- TIM 清單有用「顯示 / 隱藏」藏起欄或列時，Excel 與 PDF 都會同步不匯出（見 §4，匯出對話框可取消勾選改為匯出全部）。
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
| | 右鍵 / 列尾「⋯」 | 插入、複製為尺寸變體、移到其他 Location、隱藏此列、刪除 |
| | 欄位標題右鍵 | 隱藏此欄 / 顯示全部欄位 |
| Item 詳細 › 覆蓋元件 RefDes | ↓ / ↑、Enter、Esc | 開啟並選擇用過的元件、帶入、只關閉清單 |
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
| 間隙（設計間距） | 設計間距 G = 凸台到元件頂面（元件高度 nom 時）。g<sub>min</sub> = (G − 下公差) − (h<sub>max</sub> − h<sub>nom</sub>)；g<sub>nom</sub> = G；g<sub>max</sub> = (G + 上公差) + (h<sub>nom</sub> − h<sub>min</sub>)。沒填元件高度時只算間距公差；一片 pad 蓋多顆元件時 G 以最高（nom）的元件為準，較矮的元件加上高度差。沒填設計間距時用手動間隙 |
| 壓縮率 | C = (T − g) / T × 100%；C<sub>min</sub> 用最大間隙、C<sub>max</sub> 用最小間隙 |
| 最小壓縮率 | 預設 10%（pad / absorber；經驗值），Item 可手動調整。C min 低於 → **Fail**（接觸可能不足，壓縮率 min 以紅字標示）；最大間隙 ≥ T → Fail |
| 壓力 | 材料的壓力–壓縮曲線在 C<sub>max</sub> 的壓力（同厚度直接查；兩個厚度之間線性內插；超出範圍用最接近的曲線並註明） |
| 過壓判定 | 壓力 > 元件耐壓 → Fail；≥ 耐壓的 80% → Warning。耐壓填力（N / kgf / lbf）時以 min(pad 面積, 封裝 L × W) 換算成壓力；受力 = 壓力 × 該面積。受壓類型 E-PAD / QFN / LGA / 引腳不判定（壓力照算、只顯示） |
| TIM 熱阻 | R = t<sub>c</sub>[mm] × 1000 / (k × A<sub>eff</sub>[mm²])　[°C/W] |
| 壓縮後厚度 | t<sub>c</sub> = min(間隙 nom, T)；無間隙資料時用 T（保守）；點膠類用 BLT |
| 有效面積 | A<sub>eff</sub> = min(pad 面積, 元件頂面面積) |
| 溫升 | ΔT = P<sub>TIM</sub> × R，P<sub>TIM</sub> = 單顆功耗 × 頂面散熱 %（空白 = 100%） |

ΔT 為 bulk k 估算，不含接觸熱阻與擴散熱阻，用於排序與找出風險位置，不取代模擬或實測；ΔT ≥ 10 °C 列入待處理事項。
壓力為估算：廠商曲線是標準樣品、等速壓縮的量測值，實際 pad 面積、組裝速度（瞬間峰值較高）與長時間應力鬆弛都會不同，
接近耐壓的位置請以壓力感測紙或 load cell 實測確認。

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
