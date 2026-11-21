"use client";
// 临时调试页面：验证第二步「数据结构与本机缓存层」的完整链路
// （保存配置 → 推送一条测试记忆 → 从仓库拉取同步 → 读本机缓存展示）。
// 验证通过后会删除此文件，不是正式功能。

import { useState } from "react";
import type { FloatmarkRepoConfig, FloatmarkIndexEntry, FloatmarkMemory } from "@/lib/floatmark-types";
import { saveFloatmarkRepoConfig, loadFloatmarkRepoConfig } from "@/lib/floatmark-config-storage";
import { pushNewMemory, pullIndexIfNewer, getMemoryBody } from "@/lib/floatmark-sync";
import { loadMemoryIndex } from "@/lib/floatmark-storage";
import { testConnection } from "@/lib/floatmark-github-client";

const TEST_CHARACTER_ID = "floatmark_debug_character";

export default function FloatmarkDebugPage() {
    const [owner, setOwner] = useState("");
    const [repo, setRepo] = useState("");
    const [token, setToken] = useState("");
    const [log, setLog] = useState<string[]>(["等待操作…"]);
    const [cachedEntries, setCachedEntries] = useState<FloatmarkIndexEntry[]>([]);

    function appendLog(msg: string) {
        setLog(prev => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev]);
    }

    function getConfig(): FloatmarkRepoConfig {
        const now = Date.now();
        return {
            characterId: TEST_CHARACTER_ID,
            owner: owner.trim(),
            repo: repo.trim(),
            branch: "main",
            token: token.trim(),
            enabled: true,
            createdAt: now,
            updatedAt: now,
        };
    }

    async function handleSaveAndTest() {
        try {
            const config = getConfig();
            saveFloatmarkRepoConfig(config);
            appendLog("配置已保存到本机，测试连接中…");
            const result = await testConnection(config);
            appendLog(result.ok ? "连接成功，仓库可访问" : `连接失败: ${result.error}`);
        } catch (e) {
            appendLog("出错: " + (e instanceof Error ? e.message : String(e)));
        }
    }

    async function handlePushTestMemory() {
        try {
            const config = loadFloatmarkRepoConfig(TEST_CHARACTER_ID) || getConfig();
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
                summary: "这是一条浮痕测试记忆",
            };
            const memory: FloatmarkMemory = {
                id,
                createdAt: now,
                type: "long_term",
                content: "这是第二步缓存层验证时写入的测试记忆正文。",
                reflection: "（测试数据，没有真实心境）",
                trigger: "spontaneous",
                sourceEvent: "debug",
            };
            appendLog("推送测试记忆中…");
            const result = await pushNewMemory(config, entry, memory, "浮痕调试");
            appendLog(result.ok ? `推送成功，当前索引共 ${result.pulledCount} 条` : `推送失败: ${result.error}`);
        } catch (e) {
            appendLog("出错: " + (e instanceof Error ? e.message : String(e)));
        }
    }

    async function handlePullAndShowCache() {
        try {
            const config = loadFloatmarkRepoConfig(TEST_CHARACTER_ID) || getConfig();
            appendLog("拉取仓库最新索引中…");
            const result = await pullIndexIfNewer(config, 0); // 0 强制拉取，便于测试
            if (!result.ok) {
                appendLog("拉取失败: " + result.error);
                return;
            }
            appendLog(`拉取完成，共 ${result.pulledCount} 条`);
            const entries = await loadMemoryIndex(TEST_CHARACTER_ID);
            setCachedEntries(entries);
            appendLog("本机缓存已刷新，见下方列表");
        } catch (e) {
            appendLog("出错: " + (e instanceof Error ? e.message : String(e)));
        }
    }

    async function handleReadBody(id: string) {
        try {
            const config = loadFloatmarkRepoConfig(TEST_CHARACTER_ID) || getConfig();
            appendLog(`读取记忆正文 ${id}…`);
            const body = await getMemoryBody(config, id);
            appendLog(body ? `正文: ${body.content}\n心境: ${body.reflection}` : "未找到正文");
        } catch (e) {
            appendLog("出错: " + (e instanceof Error ? e.message : String(e)));
        }
    }

    return (
        <div style={{
            minHeight: "100dvh",
            padding: "24px 16px",
            background: "#0b0d12",
            color: "#e8eaf0",
            fontFamily: "-apple-system, sans-serif",
            fontSize: 14,
        }}>
            <h1 style={{ fontSize: 16, color: "#9fb4ff" }}>浮痕 · 第二步缓存层调试</h1>
            <p style={{ fontSize: 12, color: "#8a90a2" }}>临时页面，验证完会删除。</p>

            <label style={{ display: "block", fontSize: 12, color: "#aab0c2", margin: "12px 0 4px" }}>仓库 owner</label>
            <input value={owner} onChange={e => setOwner(e.target.value)} style={inputStyle} />

            <label style={{ display: "block", fontSize: 12, color: "#aab0c2", margin: "12px 0 4px" }}>仓库 repo</label>
            <input value={repo} onChange={e => setRepo(e.target.value)} style={inputStyle} />

            <label style={{ display: "block", fontSize: 12, color: "#aab0c2", margin: "12px 0 4px" }}>token</label>
            <input type="password" value={token} onChange={e => setToken(e.target.value)} style={inputStyle} />

            <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
                <button onClick={handleSaveAndTest} style={btnStyle}>保存配置并测试连接</button>
                <button onClick={handlePushTestMemory} style={btnStyle}>推送测试记忆</button>
                <button onClick={handlePullAndShowCache} style={btnStyle}>拉取同步并查看本机缓存</button>
            </div>

            <div style={{ marginTop: 16 }}>
                <h2 style={{ fontSize: 13, color: "#aab0c2" }}>本机缓存索引（{cachedEntries.length} 条）</h2>
                {cachedEntries.map(entry => (
                    <div key={entry.id} style={{ padding: 8, border: "1px solid #2a2f3d", borderRadius: 8, marginTop: 6 }}>
                        <div>{entry.summary}（重要度 {entry.importance} / 情绪 {entry.emotionIntensity}）</div>
                        <button onClick={() => handleReadBody(entry.id)} style={{ ...btnStyle, marginTop: 6, flex: "none" }}>查看正文</button>
                    </div>
                ))}
            </div>

            <pre style={{
                marginTop: 16,
                padding: 10,
                borderRadius: 8,
                background: "#0e1016",
                border: "1px solid #222632",
                fontSize: 11,
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
                maxHeight: "40vh",
                overflowY: "auto",
            }}>
                {log.join("\n\n")}
            </pre>
        </div>
    );
}

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
