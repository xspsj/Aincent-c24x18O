"use client";
// 浮痕 · 测试壁炉页面
//
// 这不是最终 UI（没有 3D 记忆球、没有开场动画），是一个常驻的功能验证场所：
// 选真实角色 → 配置/启用该角色的浮痕仓库 → 推送/拉取记忆 → 查看列表。
// 后续「存量迁移」「活跃度算法」「预设接入」做完后都在这个页面里加操作按钮验证，
// 验证稳定后再把这个页面升级成正式的三页式 UI（空状态/选择页/记忆球）。

import { useEffect, useState } from "react";
import type { Character } from "@/lib/character-types";
import { loadCharacters } from "@/lib/character-storage";
import type { FloatmarkRepoConfig, FloatmarkIndexEntry, FloatmarkMemory } from "@/lib/floatmark-types";
import { saveFloatmarkRepoConfig, loadFloatmarkRepoConfig } from "@/lib/floatmark-config-storage";
import { pushNewMemory, pullIndexIfNewer, getMemoryBody } from "@/lib/floatmark-sync";
import { loadMemoryIndex } from "@/lib/floatmark-storage";
import { testConnection } from "@/lib/floatmark-github-client";
import { hydrateKvDb } from "@/lib/kv-db";

export default function FloatmarkHearthPage() {
    const [hydrated, setHydrated] = useState(false);
    const [characters, setCharacters] = useState<Character[]>([]);
    const [selectedId, setSelectedId] = useState<string>("");
    const [owner, setOwner] = useState("");
    const [repo, setRepo] = useState("");
    const [branch, setBranch] = useState("main");
    const [token, setToken] = useState("");
    const [log, setLog] = useState<string[]>(["正在加载本机数据…"]);
    const [entries, setEntries] = useState<FloatmarkIndexEntry[]>([]);
    const [bodyPreview, setBodyPreview] = useState<string>("");

    // 这个页面是独立路由，不经过 MainApp 入口，所以要自己等一次 kv 水合完成，
    // 否则 loadCharacters() 读到的内存缓存还是空的（角色数据实际在 IndexedDB 里，
    // 水合完成前同步读取拿不到）。
    useEffect(() => {
        hydrateKvDb().finally(() => {
            const chars = loadCharacters();
            setCharacters(chars);
            if (chars.length > 0) setSelectedId(chars[0].id);
            setHydrated(true);
            setLog(prev => [`已加载 ${chars.length} 个角色。`, ...prev]);
        });
    }, []);

    useEffect(() => {
        if (!selectedId) return;
        const existing = loadFloatmarkRepoConfig(selectedId);
        if (existing) {
            setOwner(existing.owner);
            setRepo(existing.repo);
            setBranch(existing.branch || "main");
            // token 不回填展示，和产品定下的"仓库 token 不可见"原则保持一致——
            // 测试壁炉里也不回显明文，需要改配置时重新输入即可。
        } else {
            setOwner("");
            setRepo("");
            setBranch("main");
        }
        setToken("");
        loadMemoryIndex(selectedId).then(setEntries);
        setLog(prev => [`[${new Date().toLocaleTimeString()}] 已切换角色`, ...prev]);
    }, [selectedId]);

    function appendLog(msg: string) {
        setLog(prev => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev]);
    }

    function currentCharacterName(): string {
        return characters.find(c => c.id === selectedId)?.name || selectedId;
    }

    function buildConfig(): FloatmarkRepoConfig {
        const existing = loadFloatmarkRepoConfig(selectedId);
        const now = Date.now();
        return {
            characterId: selectedId,
            owner: owner.trim(),
            repo: repo.trim(),
            branch: branch.trim() || "main",
            token: token.trim() || existing?.token || "",
            enabled: existing?.enabled ?? false,
            migratedAt: existing?.migratedAt,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
        };
    }

    async function handleSaveConfig() {
        if (!selectedId) return appendLog("请先选择角色");
        const config = buildConfig();
        if (!config.owner || !config.repo || !config.token) {
            return appendLog("owner / repo / token 不能为空");
        }
        saveFloatmarkRepoConfig(config);
        appendLog(`已保存 ${currentCharacterName()} 的仓库配置，测试连接中…`);
        const result = await testConnection(config);
        appendLog(result.ok ? "连接成功，仓库可访问" : `连接失败: ${result.error}`);
    }

    async function handleToggleEnabled() {
        const existing = loadFloatmarkRepoConfig(selectedId);
        if (!existing) return appendLog("请先保存一次配置再启用");
        const next = { ...existing, enabled: !existing.enabled, updatedAt: Date.now() };
        saveFloatmarkRepoConfig(next);
        appendLog(`${currentCharacterName()} 的浮痕接管已${next.enabled ? "启用" : "关闭"}`);
    }

    async function handlePushTestMemory() {
        const config = loadFloatmarkRepoConfig(selectedId);
        if (!config || !config.token) return appendLog("请先保存配置");
        const id = "mem_" + Date.now().toString(36);
        const now = Date.now();
        const entry: FloatmarkIndexEntry = {
            id,
            createdAt: now,
            type: "long_term",
            importance: 8,
            emotionIntensity: 5,
            emotionLock: false,
            accessCount: 0,
            lastRecalledAt: now,
            tags: ["测试"],
            relatedTo: [],
            trigger: "spontaneous",
            summary: `壁炉测试记忆 · ${new Date(now).toLocaleString()}`,
        };
        const memory: FloatmarkMemory = {
            id,
            createdAt: now,
            type: "long_term",
            content: "这是在浮痕测试壁炉里手动推送的一条记忆正文。",
            reflection: "（测试数据，没有真实心境）",
            trigger: "spontaneous",
            sourceEvent: "debug",
        };
        appendLog("推送测试记忆中…");
        const result = await pushNewMemory(config, entry, memory, "浮痕壁炉测试");
        if (result.ok) {
            appendLog(`推送成功，当前索引共 ${result.pulledCount} 条`);
            loadMemoryIndex(selectedId).then(setEntries);
        } else {
            appendLog("推送失败: " + result.error);
        }
    }

    async function handlePull() {
        const config = loadFloatmarkRepoConfig(selectedId);
        if (!config || !config.token) return appendLog("请先保存配置");
        appendLog("拉取仓库最新索引中…");
        const result = await pullIndexIfNewer(config, 0);
        if (!result.ok) return appendLog("拉取失败: " + result.error);
        appendLog(`拉取完成，共 ${result.pulledCount} 条`);
        loadMemoryIndex(selectedId).then(setEntries);
    }

    async function handleViewBody(id: string) {
        const config = loadFloatmarkRepoConfig(selectedId);
        if (!config) return;
        const body = await getMemoryBody(config, id);
        setBodyPreview(body ? `${body.content}\n\n心境：${body.reflection}` : "未找到正文");
    }

    return (
        <div style={{
            minHeight: "100dvh",
            padding: "24px 16px 40px",
            background: "#0b0d12",
            color: "#e8eaf0",
            fontFamily: "-apple-system, sans-serif",
            fontSize: 14,
        }}>
            <h1 style={{ fontSize: 16, color: "#9fb4ff", margin: 0 }}>浮痕 · 测试壁炉</h1>
            <p style={{ fontSize: 12, color: "#8a90a2", marginTop: 4 }}>
                常驻验证页面，后续功能都在这里加按钮测试。
            </p>

            <label style={labelStyle}>选择角色</label>
            <select value={selectedId} onChange={e => setSelectedId(e.target.value)} style={inputStyle}>
                {!hydrated && <option value="">加载中…</option>}
                {hydrated && characters.length === 0 && <option value="">（没有找到任何角色，请先在聊天里创建一个角色）</option>}
                {characters.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                ))}
            </select>

            <label style={labelStyle}>仓库 owner</label>
            <input value={owner} onChange={e => setOwner(e.target.value)} style={inputStyle} />

            <label style={labelStyle}>仓库 repo</label>
            <input value={repo} onChange={e => setRepo(e.target.value)} style={inputStyle} />

            <label style={labelStyle}>分支</label>
            <input value={branch} onChange={e => setBranch(e.target.value)} style={inputStyle} />

            <label style={labelStyle}>token（不回显明文，改配置需重新输入）</label>
            <input type="password" value={token} onChange={e => setToken(e.target.value)} style={inputStyle} placeholder="已保存的 token 不会显示在这里" />

            <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
                <button onClick={handleSaveConfig} style={btnStyle}>保存配置并测试连接</button>
                <button onClick={handleToggleEnabled} style={btnStyle}>切换启用状态</button>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                <button onClick={handlePushTestMemory} style={btnStyle}>推送测试记忆</button>
                <button onClick={handlePull} style={btnStyle}>拉取同步</button>
            </div>

            <div style={{ marginTop: 16 }}>
                <h2 style={{ fontSize: 13, color: "#aab0c2" }}>本机缓存索引（{entries.length} 条）</h2>
                {entries.map(entry => (
                    <div key={entry.id} style={{ padding: 8, border: "1px solid #2a2f3d", borderRadius: 8, marginTop: 6 }}>
                        <div>{entry.summary}</div>
                        <div style={{ fontSize: 11, color: "#8a90a2" }}>
                            重要度 {entry.importance} · 情绪 {entry.emotionIntensity} · 触发 {entry.trigger}
                        </div>
                        <button onClick={() => handleViewBody(entry.id)} style={{ ...btnStyle, marginTop: 6, flex: "none", minHeight: 32 }}>
                            查看正文
                        </button>
                    </div>
                ))}
            </div>

            {bodyPreview && (
                <div style={{ marginTop: 12, padding: 10, border: "1px solid #2a2f3d", borderRadius: 8, whiteSpace: "pre-wrap" }}>
                    {bodyPreview}
                </div>
            )}

            <pre style={logStyle}>{log.join("\n\n")}</pre>
        </div>
    );
}

const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: 12,
    color: "#aab0c2",
    margin: "12px 0 4px",
};

const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: 10,
    borderRadius: 8,
    border: "1px solid #2a2f3d",
    background: "#151823",
    color: "#e8eaf0",
    fontSize: 14,
};

const btnStyle: React.CSSProperties = {
    flex: 1,
    minHeight: 44,
    border: "none",
    borderRadius: 8,
    background: "#3a4a8a",
    color: "#fff",
    fontSize: 14,
    fontWeight: 600,
};

const logStyle: React.CSSProperties = {
    marginTop: 16,
    padding: 10,
    borderRadius: 8,
    background: "#0e1016",
    border: "1px solid #222632",
    fontSize: 11,
    whiteSpace: "pre-wrap",
    wordBreak: "break-all",
    maxHeight: "30vh",
    overflowY: "auto",
};
