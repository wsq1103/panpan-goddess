/**
 * GitHub Data Manager - 前后端数据同步引擎
 * 后台CRUD → 写入GitHub仓库JSON文件 → 前台读取实时更新
 */
const GITHUB = {
    owner: 'wsq1103',
    repo: 'panpan-goddess',
    branch: 'main',
    // Token 从 localStorage 读取，管理员在后台设置页面配置
    get token() {
        return localStorage.getItem('panpan_github_token') || '';
    },
    set token(val) {
        localStorage.setItem('panpan_github_token', val);
    },
    get rawBase() {
        return `https://raw.githubusercontent.com/${this.owner}/${this.repo}/${this.branch}/data`;
    },
    get apiBase() {
        return `https://api.github.com/repos/${this.owner}/${this.repo}/contents/data`;
    }
};

// ===== 读取数据（前台 + 后台通用） =====
async function loadData(filename) {
    const url = `${GITHUB.rawBase}/${filename}`;
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`读取 ${filename} 失败: ${res.status}`);
    return await res.json();
}

// ===== 读取数据并缓存SHA（后台写入用） =====
let fileShaCache = {};
async function loadDataWithSha(filename) {
    if (!GITHUB.token) throw new Error('请先在后台系统设置中配置 GitHub Token');
    const url = `${GITHUB.apiBase}/${filename}`;
    const res = await fetch(url, {
        headers: { Authorization: `token ${GITHUB.token}` }
    });
    if (!res.ok) throw new Error(`读取 ${filename} 失败: ${res.status}`);
    const data = await res.json();
    // GitHub API 返回的 content 是 base64 编码的
    const content = JSON.parse(atob(data.content));
    fileShaCache[filename] = data.sha;
    return content;
}

// ===== 写入数据（后台用） =====
async function saveData(filename, data) {
    if (!GITHUB.token) throw new Error('请先在后台系统设置中配置 GitHub Token');

    const content = btoa(unescape(encodeURIComponent(JSON.stringify(data, null, 2))));
    const body = {
        message: `update ${filename}`,
        content: content,
        branch: GITHUB.branch
    };

    // 如果有缓存的 SHA，带上以实现覆盖更新
    if (fileShaCache[filename]) {
        body.sha = fileShaCache[filename];
    } else {
        // 先获取 SHA
        try {
            const check = await fetch(`${GITHUB.apiBase}/${filename}`, {
                headers: { Authorization: `token ${GITHUB.token}` }
            });
            if (check.ok) {
                const meta = await check.json();
                body.sha = meta.sha;
            }
        } catch(e) {}
    }

    const res = await fetch(`${GITHUB.apiBase}/${filename}`, {
        method: 'PUT',
        headers: {
            Authorization: `token ${GITHUB.token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });

    if (!res.ok) {
        const err = await res.json();
        throw new Error(`保存失败: ${err.message || res.status}`);
    }

    const result = await res.json();
    // 更新 SHA 缓存
    fileShaCache[filename] = result.content.sha;
    return true;
}

// ===== CRUD 快捷操作 =====
class DataStore {
    constructor(filename) {
        this.filename = filename;
        this.data = [];
        this._nextId = 100;
    }

    async load() {
        this.data = await loadData(this.filename);
        this._nextId = Math.max(...this.data.map(d => d.id), 0) + 1;
        return this.data;
    }

    async loadForEdit() {
        this.data = await loadDataWithSha(this.filename);
        this._nextId = Math.max(...this.data.map(d => d.id), 0) + 1;
        return this.data;
    }

    getAll() { return this.data; }
    getById(id) { return this.data.find(d => d.id === id); }

    async add(item) {
        item.id = this._nextId++;
        this.data.push(item);
        await saveData(this.filename, this.data);
        return item;
    }

    async update(id, changes) {
        const idx = this.data.findIndex(d => d.id === id);
        if (idx === -1) throw new Error('未找到数据');
        this.data[idx] = { ...this.data[idx], ...changes };
        await saveData(this.filename, this.data);
        return this.data[idx];
    }

    async remove(id) {
        this.data = this.data.filter(d => d.id !== id);
        await saveData(this.filename, this.data);
    }
}
