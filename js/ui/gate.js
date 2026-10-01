/* Database gate: pick the database folder (open what is there, or create a database),
 * continue with the last database, or fall back to browser storage. */
(function () {
  'use strict';
  const TIM = window.TIM;
  if (!TIM.ui) return;
  const { html, useState, useEffect, Icon, Modal, openModal } = TIM.ui;
  const { util } = TIM;

  /** Empty folder → ask before creating tim_db.json. Resolves { sample } or null. */
  function CreateDbModal(props) {
    const [sample, setSample] = useState(false);
    const ok = () => props.close({ sample });
    return html`<${Modal} title="建立資料庫" onClose=${() => props.close(null)} onEnter=${ok}
      footer=${html`<button class="btn btn-ghost" onClick=${() => props.close(null)}>取消</button>
        <button class="btn btn-primary" data-enter-ok="1" onClick=${ok}>建立並開啟</button>`}>
      <p>資料夾「<b>${props.folder}</b>」裡還沒有 TIM 資料庫。要在這裡建立 <span class="mono">tim_db.json</span> 嗎？</p>
      <label class="check mt12"><input type="checkbox" checked=${sample} onChange=${e => setSample(e.target.checked)} /> 加入範例專案（虛構資料，可隨時刪除）</label>
    </${Modal}>`;
  }

  /** Several databases in the folder → the user picks one. Resolves the entry or null. */
  function ChooseDbModal(props) {
    return html`<${Modal} title="選擇資料庫" onClose=${() => props.close(null)}
      footer=${html`<button class="btn btn-ghost" onClick=${() => props.close(null)}>取消</button>`}>
      <p style="margin-bottom:10px">資料夾「<b>${props.folder}</b>」裡有 ${props.list.length} 個 TIM 資料庫，要開啟哪一個？</p>
      <div class="db-pick">
        ${props.list.map(c => html`<button class="db-pick-row" key=${c.name} onClick=${() => props.close(c)}>
          <${Icon} name="db" />
          <span class="mono name">${c.name}</span>
          ${c.backup ? html`<span class="tag tag-mute">每日備份</span>` : null}
          <span class="muted meta">${util.fmtDateTime(new Date(c.modified).toISOString())} · ${util.fmtBytes(c.size)}</span>
        </button>`)}
      </div>
    </${Modal}>`;
  }

  TIM.ui.askCreateDatabase = folder => openModal(close => html`<${CreateDbModal} folder=${folder} close=${close} />`).promise;
  TIM.ui.chooseDatabase = (folder, list) => openModal(close => html`<${ChooseDbModal} folder=${folder} list=${list} close=${close} />`).promise;

  function Gate(props) {
    const app = TIM.app;
    const [restore, setRestore] = useState(null);     // { name } when a remembered database needs a click
    const [hasBrowserData, setHasBrowserData] = useState(false);
    const [busy, setBusy] = useState(false);
    const fsOk = TIM.fileBackend.supported() && TIM.fileBackend.folderSupported();

    useEffect(() => {
      (async () => {
        if (fsOk) {
          const r = await TIM.fileBackend.tryRestore();
          if (r.ok && !app.noAutoRestore && !props.error) { await app.attach(TIM.fileBackend, {}); return; }
          if (r.ok || r.needsPermission) setRestore({ name: r.name });
        }
        try { setHasBrowserData(await TIM.browserBackend.exists()); } catch (e) { /* ignore */ }
      })();
    }, []);

    const run = async fn => { if (busy) return; setBusy(true); try { await fn(); } finally { setBusy(false); } };

    return html`<div class="gate">
      <div class="gate-inner">
        <h1 class="gate-title">專案 TIM 管理器</h1>
        <div class="gate-title-en">Project TIM Manager</div>

        ${props.error ? html`<div class="gate-restore" style="border-color:rgba(255,107,94,.6);background:rgba(255,107,94,.1)">
          <${Icon} name="warn" /><div><b>無法開啟資料庫：</b>${props.error}<br/><span style="color:var(--d-200)">檔案未被修改。請選擇其他資料夾，或從備份開啟。</span></div>
        </div>` : null}

        ${restore ? html`<div class="gate-restore">
          <${Icon} name="db" />
          <div style="flex:1">上次使用：<b>${restore.name}</b></div>
          <button class="btn btn-accent" disabled=${busy} onClick=${() => run(() => app.connectFile('reconnect'))}>繼續使用</button>
        </div>` : null}

        ${fsOk ? html`<div class="gate-main">
          <button class="btn btn-accent btn-lg" disabled=${busy} onClick=${() => run(() => app.openFolder())}><${Icon} name="folder" size=${16} /> 選擇資料庫資料夾…</button>
          <p>有資料庫就直接開啟；沒有會詢問是否建立。</p>
        </div>` : html`<p class="gate-note"><b>此瀏覽器不支援直接讀寫本機資料夾。</b>請用 Chrome 或 Edge 開啟本工具；目前只能使用瀏覽器暫存。</p>`}

        <button class="gate-link" disabled=${busy} onClick=${() => run(() => app.connectBrowser({ sample: !hasBrowserData }))}>
          ${hasBrowserData ? '繼續上次的瀏覽器暫存資料' : '改用瀏覽器暫存（試用，含範例專案）'}
        </button>
      </div>
    </div>`;
  }

  TIM.ui.Gate = Gate;
})();
