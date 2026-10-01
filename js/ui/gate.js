/* Database gate: open an existing JSON database, create a new one, or try it in the browser. */
(function () {
  'use strict';
  const TIM = window.TIM;
  if (!TIM.ui) return;
  const { html, useState, useEffect, Icon } = TIM.ui;

  function Gate(props) {
    const app = TIM.app;
    const [restore, setRestore] = useState(null);     // { name } when a remembered file needs a click
    const [hasBrowserData, setHasBrowserData] = useState(false);
    const [user, setUser] = useState(app.getUserName());
    const [withSample, setWithSample] = useState(true);
    const [busy, setBusy] = useState(false);
    const fsOk = TIM.fileBackend.supported();

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

    const saveUser = () => app.setUserName(user.trim());
    const run = async fn => { if (busy) return; setBusy(true); saveUser(); try { await fn(); } finally { setBusy(false); } };

    return html`<div class="gate">
      <div class="gate-inner">
        <div class="eyebrow" style="color:var(--d-300)">DELTA · THERMAL · TIM MANAGEMENT</div>
        <h1 style="margin-top:10px">每個專案的 <em>TIM</em>，<br/>用在哪、多大、幾片、誰能替代。</h1>
        <p class="lead">管理 TIM 使用清單、機台內位置標註、間隙壓縮與熱阻估算、第二來源與變更紀錄。
          資料存在你指定的 JSON 檔（可放網路磁碟與同事共用），不經過任何伺服器。</p>

        ${props.error ? html`<div class="gate-restore" style="border-color:rgba(255,107,94,.6);background:rgba(255,107,94,.1)">
          <${Icon} name="warn" /><div><b>無法開啟資料庫：</b>${props.error}<br/><span style="color:var(--d-200)">檔案未被修改。請選擇其他檔案，或從備份資料夾開啟。</span></div>
        </div>` : null}

        ${restore ? html`<div class="gate-restore">
          <${Icon} name="db" />
          <div style="flex:1">上次使用的資料庫：<b>${restore.name}</b><br/><span style="color:var(--d-200)">瀏覽器需要你點一下才能再次讀寫此檔案。</span></div>
          <button class="btn btn-accent" disabled=${busy} onClick=${() => run(() => app.connectFile('reconnect'))}>恢復連線</button>
        </div>` : null}

        <div class="field" style="max-width:360px;margin-top:28px">
          <label style="color:var(--d-200)">你的名字（寫入變更紀錄，之後可在設定修改）</label>
          <input class="inp" value=${user} placeholder="例如：Tedus" onInput=${e => setUser(e.target.value)} onBlur=${saveUser} />
        </div>

        <div class="gate-options">
          <div class="gate-opt">
            <span class="gate-num">01 · 開啟</span>
            <h3><${Icon} name="folder" /> 開啟既有資料庫</h3>
            <p>選擇一個 TIM 資料庫 JSON 檔（例如放在部門網路磁碟的 <span class="mono">tim_db.json</span>）。多人同時使用時，存檔會自動合併，不會互相覆蓋。</p>
            <button class="btn btn-accent" disabled=${!fsOk || busy} onClick=${() => run(() => app.connectFile('open'))}>開啟 JSON 檔…</button>
          </div>
          <div class="gate-opt">
            <span class="gate-num">02 · 新建</span>
            <h3><${Icon} name="plus" /> 建立新資料庫</h3>
            <p>選一個位置存成新的 JSON 檔，從零開始，或直接用「匯入 Excel」把現在的 TIM 清單搬進來。</p>
            <label class="check" style="color:var(--d-200)"><input type="checkbox" checked=${withSample} onChange=${e => setWithSample(e.target.checked)} /> 同時加入範例專案</label>
            <button class="btn btn-dark" disabled=${!fsOk || busy} onClick=${() => run(() => app.connectFile('create', { sample: withSample }))}>建立新檔…</button>
          </div>
          <div class="gate-opt">
            <span class="gate-num">03 · 試用</span>
            <h3><${Icon} name="eye" /> 瀏覽器暫存（試用）</h3>
            <p>不用選檔，資料存在這個瀏覽器裡。<b style="color:#F2C14E">清除瀏覽器資料就會消失</b>，正式使用請改用 JSON 檔（之後可匯出搬移）。</p>
            <button class="btn btn-dark" disabled=${busy} onClick=${() => run(() => app.connectBrowser({ sample: !hasBrowserData }))}>
              ${hasBrowserData ? '繼續上次的試用資料' : '開始試用（含範例專案）'}
            </button>
          </div>
        </div>

        ${!fsOk ? html`<p class="gate-note"><b>此瀏覽器不支援直接讀寫本機檔案</b>（File System Access API）。請使用 Chrome 或 Edge 開啟本工具；目前只能使用瀏覽器暫存模式。</p>` : null}
        <p class="gate-note">提示：本工具與 <b>Thermal Test Report Builder</b> 使用相同的本機資料庫機制與設計語言。
          GitHub repo 為公開，<b>請勿把資料庫檔或機殼圖面放進 repo</b>。</p>
      </div>
    </div>`;
  }

  TIM.ui.Gate = Gate;
})();
