'use strict';
// In-page stand-in for File System Access folders (sub-folders, files, isSameEntry, removeEntry).
// installFakeFs(page) defines window.__fs:
//   __fs.dir(name)               → a new folder handle
//   __fs.read(dir, 'a/b.json')   → text or null;  __fs.write(dir, 'a/b.json', text);  __fs.names(dir) → file names
//   __fs.open(dir)               → open it as the local database folder (tim_db.json inside)

async function installFakeFs(page) {
  await page.evaluate(() => {
    const notFound = () => Object.assign(new Error('not found'), { name: 'NotFoundError' });
    const file = name => {
      const f = {
        name, kind: 'file', blob: new Blob([]), lastModified: Date.now(),
        async getFile() { return new File([f.blob], name, { lastModified: f.lastModified }); },
        async createWritable() { const parts = []; return { async write(x) { parts.push(x); }, async close() { f.blob = new Blob(parts); f.lastModified = Date.now(); } }; },
        async queryPermission() { return 'granted'; }, async requestPermission() { return 'granted'; },
        async isSameEntry(o) { return o === f; },
      };
      return f;
    };
    const dir = name => {
      const d = {
        name, kind: 'directory', children: new Map(), permission: 'granted',
        async getDirectoryHandle(n, o) { let c = d.children.get(n); if (!c) { if (!(o && o.create)) throw notFound(); c = dir(n); d.children.set(n, c); } return c; },
        async getFileHandle(n, o) { let c = d.children.get(n); if (!c) { if (!(o && o.create)) throw notFound(); c = file(n); d.children.set(n, c); } return c; },
        async removeEntry(n) { if (!d.children.delete(n)) throw notFound(); },
        async *entries() { for (const e of d.children) yield e; },
        async queryPermission() { return d.permission; }, async requestPermission() { d.permission = 'granted'; return 'granted'; },
        async isSameEntry(o) { return o === d; },
      };
      return d;
    };
    async function walk(root, path, create) {
      const parts = path.split('/'); const n = parts.pop(); let d = root;
      for (const s of parts) { d = create ? await d.getDirectoryHandle(s, { create: true }) : d.children.get(s); if (!d) return null; }
      return { d, n };
    }
    window.__fs = {
      dir,
      async read(root, path) { const w = await walk(root, path, false); const f = w && w.d.children.get(w.n); return f ? f.blob.text() : null; },
      async write(root, path, text) { const w = await walk(root, path, true); const f = await w.d.getFileHandle(w.n, { create: true }); f.blob = new Blob([text]); },
      names(root) { return Array.from(root.children.keys()).sort(); },
      async open(root) {
        TIM.fileBackend.__setHandleForTest(await root.getFileHandle('tim_db.json', { create: true }), root);
        return TIM.app.attach(TIM.fileBackend);
      },
    };
  });
}

module.exports = { installFakeFs };
