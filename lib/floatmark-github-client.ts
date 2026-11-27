// lib/floatmark-github-client.ts
// 对 GitHub Contents API 的薄封装。
//
// 关键规则（第一步调试页面里实测确认）：文件已存在时，PUT 必须带上当前文件的 sha，
// 否则 GitHub 返回 422 "sha wasn't supplied"。putFile() 内部会自动先 GET 一次取 sha，
// 调用方不需要关心"这是创建还是更新"。
//
// 这是宿主内置代码（不是跑在 iframe 沙盒里的自定义 APP），直接用标准 fetch()，
// 不需要经过 AiPhone.network.fetch 那层 SDK 封装，也不受 allowedDomains 白名单限制。

import type { FloatmarkRepoConfig } from "./floatmark-types";

export type GithubFileResult = {
    ok: boolean;
    status: number;
    sha?: string;
    content?: string;   // 解码后的 UTF-8 文本，读取成功时才有
    error?: string;
};

function b64EncodeUtf8(str: string): string {
    return btoa(unescape(encodeURIComponent(str)));
}

function b64DecodeUtf8(b64: string): string {
    return decodeURIComponent(escape(atob(b64.replace(/\n/g, ""))));
}

function contentsUrl(config: FloatmarkRepoConfig, path: string): string {
    return `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${path}`;
}

function authHeaders(config: FloatmarkRepoConfig): Record<string, string> {
    return {
        "Authorization": `Bearer ${config.token}`,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    };
}

/** 读取文件内容与 sha。ok=false 且 status=404 表示"文件还不存在"，不是异常。 */
export async function readFile(config: FloatmarkRepoConfig, path: string): Promise<GithubFileResult> {
    try {
        const url = contentsUrl(config, path) + (config.branch ? `?ref=${encodeURIComponent(config.branch)}` : "");
        const res = await fetch(url, {
            method: "GET",
            headers: authHeaders(config),
        });
        const json = await res.json().catch(() => null);
        if (res.ok && json) {
            const decoded = json.content ? b64DecodeUtf8(json.content) : "";
            return { ok: true, status: res.status, sha: json.sha, content: decoded };
        }
        return { ok: false, status: res.status, error: json?.message || "读取失败" };
    } catch (e) {
        return { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) };
    }
}

/**
 * 创建或更新文件。内部会先尝试读取当前 sha（文件已存在时必须带上，见文件头说明）。
 */
export async function putFile(
    config: FloatmarkRepoConfig,
    path: string,
    content: string,
    commitMessage: string,
): Promise<GithubFileResult> {
    try {
        const existing = await readFile(config, path);
        const body: Record<string, unknown> = {
            message: commitMessage,
            content: b64EncodeUtf8(content),
        };
        if (config.branch) body.branch = config.branch;
        if (existing.ok && existing.sha) body.sha = existing.sha;

        const res = await fetch(contentsUrl(config, path), {
            method: "PUT",
            headers: { ...authHeaders(config), "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        const json = await res.json().catch(() => null);
        if (res.ok) {
            return { ok: true, status: res.status, sha: json?.content?.sha };
        }
        return { ok: false, status: res.status, error: json?.message || "写入失败" };
    } catch (e) {
        return { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) };
    }
}

export async function deleteFile(
    config: FloatmarkRepoConfig,
    path: string,
    commitMessage: string,
): Promise<GithubFileResult> {
    try {
        const existing = await readFile(config, path);
        if (!existing.ok || !existing.sha) {
            return { ok: false, status: existing.status, error: "文件不存在，无法删除" };
        }
        const body: Record<string, unknown> = { message: commitMessage, sha: existing.sha };
        if (config.branch) body.branch = config.branch;

        const res = await fetch(contentsUrl(config, path), {
            method: "DELETE",
            headers: { ...authHeaders(config), "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        if (res.ok) return { ok: true, status: res.status };
        const json = await res.json().catch(() => null);
        return { ok: false, status: res.status, error: json?.message || "删除失败" };
    } catch (e) {
        return { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) };
    }
}

/** 快速校验仓库是否可访问、token 权限是否够用（配置页"测试连接"按钮用）。 */
export async function testConnection(config: FloatmarkRepoConfig): Promise<{ ok: boolean; error?: string }> {
    try {
        const res = await fetch(`https://api.github.com/repos/${config.owner}/${config.repo}`, {
            method: "GET",
            headers: authHeaders(config),
        });
        if (res.ok) return { ok: true };
        const json = await res.json().catch(() => null);
        return { ok: false, error: json?.message || `仓库不可访问（status ${res.status}）` };
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
}
