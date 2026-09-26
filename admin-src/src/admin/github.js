import { bytesToBase64, base64ToBytes, gitBlobSha } from './crypto.js';

const API = 'https://api.github.com';
const enc = new TextEncoder();
const dec = new TextDecoder();

export class GitHubError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

function explain(status, body, what) {
  const msg = (body && body.message) || '';
  if (status === 401) return 'GitHub 令牌无效或已过期，请在设置里重新填写';
  if (status === 403 && /rate limit/i.test(msg)) return 'GitHub 接口调用太频繁，请稍后再试';
  if (status === 403) return 'GitHub 令牌没有写入这个仓库的权限（需要 Contents: Read and write）';
  if (status === 404) return `找不到${what || '资源'}，请检查用户名和仓库名`;
  if (status === 409) return '仓库是空的或正在变更，请稍后重试';
  if (status === 422) return msg || 'GitHub 拒绝了这次提交';
  return msg ? `GitHub：${msg}` : `GitHub 请求失败（${status}）`;
}

export class GitHub {
  constructor({ user, repo, token, branch = 'main' }) {
    this.user = user;
    this.repo = repo;
    this.token = token;
    this.branch = branch;
  }

  get ready() { return !!(this.user && this.repo && this.token); }

  async req(method, path, body, what) {
    const res = await fetch(`${API}/repos/${this.user}/${this.repo}${path}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
    let data = null;
    const text = await res.text();
    if (text) { try { data = JSON.parse(text); } catch { data = text; } }
    if (!res.ok) throw new GitHubError(explain(res.status, data, what), res.status, data);
    return data;
  }

  async checkAccess() {
    const info = await this.req('GET', '', null, '仓库');
    if (info.permissions && !info.permissions.push) throw new GitHubError('令牌对这个仓库只有读取权限', 403);
    return info;
  }

  async head() {
    try {
      const ref = await this.req('GET', `/git/ref/heads/${this.branch}`, null, `分支 ${this.branch}`);
      const commit = await this.req('GET', `/git/commits/${ref.object.sha}`);
      return { commit: ref.object.sha, tree: commit.tree.sha };
    } catch (e) {
      if (e.status === 409 || e.status === 404) {
        const info = await this.req('GET', '', null, '仓库');
        if (info.size === 0) return { commit: null, tree: null };
      }
      throw e;
    }
  }

  async tree(treeSha) {
    if (!treeSha) return new Map();
    const t = await this.req('GET', `/git/trees/${treeSha}?recursive=1`);
    const map = new Map();
    for (const e of t.tree) if (e.type === 'blob') map.set(e.path, e.sha);
    if (t.truncated) map.truncated = true;
    return map;
  }

  async blobBytes(sha) {
    const b = await this.req('GET', `/git/blobs/${sha}`);
    return base64ToBytes(b.content.replace(/\n/g, ''));
  }

  async readText(path, ref) {
    try {
      const f = await this.req('GET', `/contents/${encodeURI(path)}?ref=${encodeURIComponent(ref || this.branch)}`);
      if (Array.isArray(f)) return null;
      if (f.content) return dec.decode(base64ToBytes(f.content.replace(/\n/g, '')));
      if (f.sha) return dec.decode(await this.blobBytes(f.sha));
      return '';
    } catch (e) {
      if (e.status === 404) return null;
      throw e;
    }
  }

  async readTextAtTree(treeMap, path) {
    const sha = treeMap.get(path);
    if (!sha) return null;
    return dec.decode(await this.blobBytes(sha));
  }

  /**
   * One atomic commit. `files` maps path → string | Uint8Array | null (null deletes).
   * Unchanged files are skipped by comparing git blob hashes with the base tree.
   * Retries on a moved branch by re-running `prepare` against the new head.
   */
  async commit({ message, prepare, onProgress = () => {} }) {
    for (let attempt = 0; attempt < 3; attempt++) {
      onProgress('读取仓库当前版本…');
      const head = await this.head();
      const treeMap = await this.tree(head.tree);
      const files = await prepare(head, treeMap);
      const entries = [];
      let changed = 0;
      const list = [...files.entries()];
      for (let i = 0; i < list.length; i++) {
        const [path, content] = list[i];
        if (content == null) {
          if (treeMap.has(path)) { entries.push({ path, mode: '100644', type: 'blob', sha: null }); changed++; }
          continue;
        }
        const bytes = typeof content === 'string' ? enc.encode(content) : content;
        const sha = await gitBlobSha(bytes);
        if (treeMap.get(path) === sha) continue;
        onProgress(`上传文件 ${i + 1}/${list.length}：${path}`);
        const blob = await this.req('POST', '/git/blobs', { content: bytesToBase64(bytes), encoding: 'base64' });
        entries.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
        changed++;
      }
      if (!changed) return { commit: head.commit, noop: true, files };
      onProgress('生成提交…');
      const tree = await this.req('POST', '/git/trees', head.tree ? { base_tree: head.tree, tree: entries } : { tree: entries.filter(e => e.sha) });
      const commit = await this.req('POST', '/git/commits', { message, tree: tree.sha, parents: head.commit ? [head.commit] : [] });
      try {
        if (head.commit) await this.req('PATCH', `/git/refs/heads/${this.branch}`, { sha: commit.sha, force: false });
        else await this.req('POST', '/git/refs', { ref: `refs/heads/${this.branch}`, sha: commit.sha });
        return { commit: commit.sha, files, changed };
      } catch (e) {
        if (e.status === 422 && attempt < 2) { onProgress('仓库刚被更新，正在基于最新版本重试…'); continue; }
        throw e;
      }
    }
    throw new GitHubError('仓库一直在变化，发布没有完成，请稍后重试', 409);
  }
}
