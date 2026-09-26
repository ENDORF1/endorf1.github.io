import { CONTENT_INDEX, docFilePath, buildPublish, emptyPub } from '../shared/site.js';
import { importPublishedSite } from '../shared/import-pages.js';
import { collectImageSrcs } from './images.js';

const dec = new TextDecoder();

function parseHTML(html) {
  return new DOMParser().parseFromString(html, 'text/html');
}

async function sameOrigin(path) {
  try {
    const res = await fetch(`/${encodeURI(path)}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/**
 * Reads published content from the repo when a token is configured, and from the
 * live site otherwise (read-only).
 */
export class Remote {
  constructor(gh) {
    this.gh = gh;
  }

  get canWrite() { return !!(this.gh && this.gh.ready); }

  async readDoc(id) {
    if (this.canWrite) return this.gh.readText(docFilePath(id));
    return sameOrigin(docFilePath(id));
  }

  /** Returns { pub, commit, importedBodies? } describing what is live now. */
  async fetchPublished({ knownCommit, onProgress = () => {} } = {}) {
    if (this.canWrite) {
      const head = await this.gh.head();
      if (!head.commit) return { pub: emptyPub(), commit: null, empty: true };
      if (knownCommit && head.commit === knownCommit) return { upToDate: true, commit: head.commit };
      const tree = await this.gh.tree(head.tree);
      const text = await this.gh.readTextAtTree(tree, CONTENT_INDEX);
      if (text) return { pub: JSON.parse(text), commit: head.commit };
      onProgress('首次使用：正在从网站页面导入内容…');
      const res = await importPublishedSite({ readText: p => this.gh.readTextAtTree(tree, p), parse: parseHTML, doc: document, onProgress });
      return { pub: res.pub, commit: head.commit, importedBodies: res.bodies, report: res.report };
    }
    const text = await sameOrigin(CONTENT_INDEX);
    if (text) {
      const pub = JSON.parse(text);
      if (knownCommit && knownCommit === `site:${pub.rev}`) return { upToDate: true };
      return { pub, commit: `site:${pub.rev}` };
    }
    const probe = await sameOrigin('blog/index.html');
    if (!probe) return { pub: null, commit: null, offline: true };
    onProgress('首次使用：正在从网站页面导入内容…');
    const res = await importPublishedSite({ readText: sameOrigin, parse: parseHTML, doc: document, onProgress });
    return { pub: res.pub, commit: 'site:0', importedBodies: res.bodies, report: res.report };
  }
}

function commitMessage(data, ids, unpublishIds, rebuildAll) {
  const title = id => {
    const f = data.find(id) || data.ws.trash.find(t => t.id === id);
    return (f && f.meta.title) || '无标题';
  };
  const lines = [];
  for (const id of ids) lines.push(`- ${title(id)}`);
  for (const id of unpublishIds) lines.push(`- 撤下：${title(id)}`);
  let subject;
  if (rebuildAll && !ids.length && !unpublishIds.length) subject = 'rebuild: all pages';
  else if (ids.length === 1 && !unpublishIds.length) subject = `publish: ${title(ids[0])}`;
  else if (!ids.length && unpublishIds.length === 1) subject = `unpublish: ${title(unpublishIds[0])}`;
  else if (!ids.length && !unpublishIds.length) subject = 'update: list pages';
  else subject = `publish: ${ids.length + unpublishIds.length} changes`;
  return lines.length > 1 ? `${subject}\n\n${lines.join('\n')}` : subject;
}

/**
 * Publishes the given drafts (and takedowns) in a single commit, uploading any
 * images they reference that only exist locally so far.
 */
export async function publishChanges({ data, gh, images, css, ids = [], unpublishIds = [], rebuildAll = false, onProgress = () => {} }) {
  await data.flush();
  const bodies = new Map();
  for (const id of ids) bodies.set(id, await data.getBody(id));
  let outcome = null;
  const res = await gh.commit({
    message: commitMessage(data, ids, unpublishIds, rebuildAll),
    onProgress,
    prepare: async (head, tree) => {
      onProgress('生成页面…');
      const indexText = await gh.readTextAtTree(tree, CONTENT_INDEX);
      const firstMigration = !indexText;
      const basePub = indexText ? JSON.parse(indexText) : (data.pub || emptyPub());
      const homepageHTML = await gh.readTextAtTree(tree, 'index.html');
      const pubBody = async id => {
        const sha = tree.get(docFilePath(id));
        if (sha) return JSON.parse(dec.decode(await gh.blobBytes(sha))).doc;
        return data.pubBody(id);
      };
      const { next, files, warnings } = await buildPublish({
        basePub, draft: data.ws, publish: ids, unpublish: unpublishIds,
        draftBody: id => bodies.get(id), pubBody, rebuildAll, homepageHTML, css, doc: document,
      });
      if (firstMigration) {
        for (const d of [...next.posts, ...next.works, ...next.gallery.flatMap(c => c.items), ...(next.about ? [next.about] : [])]) {
          const p = docFilePath(d.id);
          if (files.has(p)) continue;
          const body = await data.pubBody(d.id);
          if (body) files.set(p, JSON.stringify({ id: d.id, doc: body }) + '\n');
        }
      }
      const imagePaths = new Set();
      for (const id of ids) {
        const found = data.find(id);
        if (!found) continue;
        for (const src of collectImageSrcs(data.fullMeta(found), bodies.get(id))) {
          if (images.isPending(src)) imagePaths.add(images.pathOf(src));
        }
      }
      for (const p of imagePaths) {
        if (tree.has(p)) continue;
        const blob = await images.getBlob(p);
        if (blob) files.set(p, new Uint8Array(await blob.arrayBuffer()));
      }
      outcome = { next, warnings, imagePaths: [...imagePaths] };
      return files;
    },
  });
  await data.applyPublished(outcome.next, res.commit, ids, bodies);
  if (outcome.imagePaths.length) {
    await images.markUploaded(outcome.imagePaths);
    images.purge(outcome.imagePaths);
  }
  return { ...outcome, commit: res.commit, noop: !!res.noop };
}
