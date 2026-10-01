/* Database gate: the shared SharePoint database (Microsoft sign-in) or a local database
 * folder (open what is there, or create a database); or continue with the last database. */
(function () {
  'use strict';
  const TIM = window.TIM;
  if (!TIM.ui) return;
  const { html, useState, useEffect, Icon, Modal, openModal } = TIM.ui;
  const { util } = TIM;

  /** Empty folder → ask before creating tim_db.json. Resolves true / false. */
  function CreateDbModal(props) {
    const ok = () => props.close(true);
    return html`<${Modal} title="建立資料庫" onClose=${() => props.close(false)} onEnter=${ok}
      footer=${html`<button class="btn btn-ghost" onClick=${() => props.close(false)}>取消</button>
        <button class="btn btn-primary" data-enter-ok="1" onClick=${ok}>建立並開啟</button>`}>
      <p>資料夾「<b>${props.folder}</b>」裡還沒有 TIM 資料庫。要在這裡建立 <span class="mono">tim_db.json</span> 嗎？</p>
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

  /** SharePoint has no database yet → ask before creating tim_db.json there. */
  function CreateSpModal(props) {
    const ok = () => props.close(true);
    return html`<${Modal} title="建立 SharePoint 資料庫" onClose=${() => props.close(false)} onEnter=${ok}
      footer=${html`<button class="btn btn-ghost" onClick=${() => props.close(false)}>取消</button>
        <button class="btn btn-primary" data-enter-ok="1" onClick=${ok}>建立並開啟</button>`}>
      <p>SharePoint 上還沒有 TIM 資料庫。要建立嗎？</p>
      <p class="mono" style="margin-top:8px;font-size:12px">${props.where}</p>
      <p class="muted" style="margin-top:8px;font-size:12px">資料夾不存在時會自動建立；規格書存到同一層的 Datasheets 資料夾。</p>
    </${Modal}>`;
  }

  TIM.ui.askCreateSharePoint = where => openModal(close => html`<${CreateSpModal} where=${where} close=${close} />`).promise;
  TIM.ui.askCreateDatabase = folder => openModal(close => html`<${CreateDbModal} folder=${folder} close=${close} />`).promise;
  TIM.ui.chooseDatabase = (folder, list) => openModal(close => html`<${ChooseDbModal} folder=${folder} list=${list} close=${close} />`).promise;

  function Gate(props) {
    const app = TIM.app;
    const sp = TIM.spBackend;
    const [restore, setRestore] = useState(null);     // { kind: 'folder' | 'sharepoint', name, state } when the last database needs a click
    const [busy, setBusy] = useState(false);
    const fsOk = TIM.fileBackend.supported();

    useEffect(() => {
      (async () => {
        if (app.dbMode() === 'sharepoint') {
          const r = await sp.tryRestore();
          if (r.ok && !app.noAutoRestore && !props.error) { if (await app.attach(sp)) return; }
          setRestore({ kind: 'sharepoint', name: r.name || '', state: r.ok ? 'ok' : r.needsLogin ? 'login' : r.reason === 'missing' ? 'missing' : 'error', error: r.error });
          return;
        }
        if (!fsOk) return;
        const r = await TIM.fileBackend.tryRestore();
        if (r.ok && !app.noAutoRestore && !props.error) { await app.attach(TIM.fileBackend); return; }
        if (r.ok || r.needsPermission) setRestore({ kind: 'folder', name: r.name });
      })();
    }, []);

    const run = async fn => { if (busy) return; setBusy(true); try { await fn(); } finally { setBusy(false); } };
    const continueSp = () => run(async () => {
      if (restore.state === 'ok' && await app.attach(sp)) { app.noAutoRestore = false; TIM.ui.toast('已開啟 SharePoint 資料庫', 'ok'); return; }
      await app.openSharePoint();
    });

    return html`<div class="gate">
      <div class="gate-inner">
        <h1 class="gate-title">專案 TIM 管理器</h1>
        <div class="gate-title-en">Project TIM Manager</div>

        ${props.error ? html`<div class="gate-restore" style="border-color:rgba(255,107,94,.6);background:rgba(255,107,94,.1)">
          <${Icon} name="warn" /><div><b>無法開啟資料庫：</b>${props.error}<br/><span style="color:var(--d-200)">檔案未被修改。請選擇其他資料夾，或從備份開啟。</span></div>
        </div>` : null}

        ${restore && restore.kind === 'folder' ? html`<div class="gate-restore">
          <${Icon} name="db" />
          <div style="flex:1">上次使用：<b>${restore.name}</b></div>
          <button class="btn btn-accent" disabled=${busy} onClick=${() => run(() => app.reconnect())}>繼續使用</button>
        </div>` : null}
        ${restore && restore.kind === 'sharepoint' ? html`<div class="gate-restore">
          <${Icon} name="cloud" />
          <div style="flex:1">上次使用：<b>SharePoint 共用資料庫</b>${restore.name ? html`<span class="gate-acc">（${restore.name}）</span>` : null}
            ${restore.state === 'login' ? html`<div class="gate-sub">需要重新登入 Microsoft 帳號</div>`
              : restore.state === 'missing' ? html`<div class="gate-sub">SharePoint 上找不到資料庫檔案</div>`
              : restore.state === 'error' ? html`<div class="gate-sub">${restore.error}</div>` : null}</div>
          <button class="btn btn-accent" disabled=${busy} onClick=${continueSp}>${restore.state === 'login' ? '登入並繼續' : '繼續使用'}</button>
        </div>` : null}

        <div class="gate-main gate-choices">
          <div class="gate-choice" onPointerEnter=${() => sp.preload()} onfocusin=${() => sp.preload()}>
            <button class="btn btn-accent btn-lg" disabled=${busy} onClick=${() => run(() => app.openSharePoint())}><${Icon} name="cloud" size=${16} /> SharePoint 共用資料庫</button>
            <p>以公司 Microsoft 帳號登入，開啟 ${sp.config.siteName} 上的共用資料庫；規格書也存在那裡。
              ${restore && restore.kind === 'sharepoint' && restore.name ? html` <button class="gate-link" disabled=${busy} onClick=${() => run(() => app.openSharePoint({ select: true }))}>改用其他帳號</button>` : null}</p>
          </div>
          ${fsOk ? html`<div class="gate-choice">
            <button class="btn btn-dark btn-lg" disabled=${busy} onClick=${() => run(() => app.openFolder())}><${Icon} name="folder" size=${16} /> 本機資料夾…</button>
            <p>選擇資料庫資料夾：有資料庫就直接開啟，沒有會詢問是否建立。</p>
          </div>` : html`<div class="gate-choice"><p><b>此瀏覽器不支援直接讀寫本機資料夾</b>（請用 Chrome 或 Edge）。</p></div>`}
        </div>
      </div>
      <div class="gate-version" title="目前版本">${app.version}</div>
    </div>`;
  }

  TIM.ui.Gate = Gate;
})();
