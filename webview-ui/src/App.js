import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect, useMemo } from "react";
import { vscode } from "./utilities/vscode";
import "./App.css";
// Token estimation: ~4 characters per token (rough approximation)
const estimateTokens = (text) => Math.ceil(text.length / 4);
// Token limits per AI provider
const TOKEN_LIMITS = {
    gemini: 32000, // Gemini version gratuita (32k contexto)
    anthropic: 100000, // Claude limits vary (up to ~200k paid)
    openai: 16000, // GPT-5.1 Instant (16k contexto)
    github: 8000, // Copilot chat window (~8k)
};
const getProviderDisplayName = (provider) => {
    const names = {
        gemini: "Gemini",
        anthropic: "Claude",
        openai: "GPT-4",
        github: "GitHub",
    };
    return names[provider] || provider;
};
function App() {
    const [messages, setMessages] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [settings, setSettings] = useState({
        provider: "gemini",
        geminiApiKey: "",
        anthropicApiKey: "",
        openaiApiKey: "",
        githubToken: "",
    });
    useEffect(() => {
        // Request settings on load
        vscode.postMessage({ type: "getSettings" });
        const handleSettingsMsg = (event) => {
            const message = event.data;
            if (message.type === "settingsData") {
                setSettings(message.value);
            }
            else if (message.type === "signInSuccess") {
                setSettings((prev) => ({ ...prev, provider: message.provider }));
            }
        };
        window.addEventListener("message", handleSettingsMsg);
        return () => window.removeEventListener("message", handleSettingsMsg);
    }, []);
    useEffect(() => {
        const handleMessage = (event) => {
            const message = event.data;
            switch (message.type) {
                case "addMessage":
                    setMessages((prev) => [
                        ...prev,
                        { role: "user", content: message.value },
                    ]);
                    setIsLoading(true);
                    break;
                case "updateMessage": {
                    setIsLoading(false);
                    setMessages((prev) => {
                        // Get the last user message from current state
                        const lastUserMsg = [...prev]
                            .reverse()
                            .find((m) => m.role === "user");
                        return [
                            ...prev,
                            {
                                role: "assistant",
                                content: "",
                                critique: message.critique,
                                improvedPrompt: message.improvedPrompt,
                                originalPrompt: lastUserMsg?.content || "",
                                originalAttachments: lastUserMsg?.originalAttachments,
                                provider: message.provider || "unknown",
                                intent: message.intent,
                                actionPlan: message.actionPlan,
                            },
                        ];
                    });
                    break;
                }
                case "onError":
                    setIsLoading(false);
                    setMessages((prev) => [
                        ...prev,
                        { role: "assistant", content: `Error: ${message.value}` },
                    ]);
                    break;
            }
        };
        window.addEventListener("message", handleMessage);
        return () => window.removeEventListener("message", handleMessage);
    }, []);
    const [inputValue, setInputValue] = useState("");
    const [language, setLanguage] = useState("en");
    const [attachments, setAttachments] = useState([]);
    // Calculate total tokens and get limit for current provider
    const maxTokens = TOKEN_LIMITS[settings.provider] || 8000;
    const tokenCount = useMemo(() => {
        let total = estimateTokens(inputValue);
        for (const att of attachments) {
            total += estimateTokens(att.data);
        }
        return total;
    }, [inputValue, attachments]);
    const isOverLimit = tokenCount > maxTokens;
    const usagePercent = Math.min((tokenCount / maxTokens) * 100, 100);
    const handleSend = () => {
        if (!inputValue.trim() && attachments.length === 0)
            return;
        if (isOverLimit) {
            vscode.postMessage({
                type: "onError",
                value: `Token limit exceeded for ${getProviderDisplayName(settings.provider)} (${tokenCount.toLocaleString()}/${maxTokens.toLocaleString()}). Please reduce your prompt or remove some attachments.`,
            });
            return;
        }
        const userMsg = {
            role: "user",
            content: inputValue,
            originalAttachments: attachments.length > 0 ? [...attachments] : undefined,
        };
        setMessages((prev) => [...prev, userMsg]);
        setIsLoading(true);
        vscode.postMessage({
            type: "userMessage",
            value: inputValue,
            attachments: attachments,
            language: language,
            provider: settings.provider,
        });
        setInputValue("");
        setAttachments([]);
    };
    const handleKeyDown = (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };
    const handlePaste = (e) => {
        const items = e.clipboardData.items;
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf("image") !== -1) {
                const blob = items[i].getAsFile();
                if (blob) {
                    const reader = new FileReader();
                    reader.onload = (event) => {
                        if (event.target?.result) {
                            setAttachments((prev) => [
                                ...prev,
                                {
                                    name: "Pasted Image",
                                    type: "image",
                                    data: event.target.result,
                                },
                            ]);
                        }
                    };
                    reader.readAsDataURL(blob);
                }
            }
        }
    };
    const removeAttachment = (index) => {
        setAttachments((prev) => prev.filter((_, i) => i !== index));
    };
    // Listen for attachment selections from extension
    useEffect(() => {
        const handleAttachmentMsg = (event) => {
            const message = event.data;
            if (message.type === "addContext") {
                setAttachments((prev) => [...prev, ...message.value]);
            }
        };
        window.addEventListener("message", handleAttachmentMsg);
        return () => window.removeEventListener("message", handleAttachmentMsg);
    }, []);
    const handleApply = (text) => {
        vscode.postMessage({ type: "applySuggestion", value: text });
    };
    const handleCopy = (text) => {
        navigator.clipboard.writeText(text);
        vscode.postMessage({ type: "onInfo", value: "Copied to clipboard!" });
    };
    const handleRegenerate = (originalPrompt, originalAttachments) => {
        if (!originalPrompt)
            return;
        // Add the prompt as a new user message
        const userMsg = {
            role: "user",
            content: originalPrompt,
            originalAttachments: originalAttachments,
        };
        setMessages((prev) => [...prev, userMsg]);
        setIsLoading(true);
        // Re-send to AI
        vscode.postMessage({
            type: "userMessage",
            value: originalPrompt,
            attachments: originalAttachments || [],
            language: language,
        });
    };
    const handleSaveSettings = () => {
        vscode.postMessage({
            type: "saveSettings",
            provider: settings.provider,
            apiKey: settings.provider === "gemini"
                ? settings.geminiApiKey
                : settings.provider === "anthropic"
                    ? settings.anthropicApiKey
                    : settings.provider === "openai"
                        ? settings.openaiApiKey
                        : undefined,
            githubToken: settings.githubToken,
        });
        setShowSettings(false);
        vscode.postMessage({
            type: "onInfo",
            value: "Settings saved successfully!",
        });
    };
    const handleSignInGithub = () => {
        vscode.postMessage({ type: "signInWithGithub" });
    };
    return (_jsxs("main", { children: [_jsxs("div", { className: "header", children: [_jsxs("div", { className: "provider-selector", children: [_jsxs("select", { value: settings.provider, onChange: (e) => {
                                    const newProvider = e.target.value;
                                    setSettings({ ...settings, provider: newProvider });
                                    // Save the provider setting immediately
                                    vscode.postMessage({
                                        type: "saveSettings",
                                        provider: newProvider,
                                    });
                                }, className: "header-select", children: [_jsx("option", { value: "gemini", children: "Gemini" }), _jsx("option", { value: "anthropic", children: "Claude" }), _jsx("option", { value: "openai", children: "OpenAI" }), _jsx("option", { value: "github", children: "GitHub" })] }), _jsxs("select", { value: language, onChange: (e) => setLanguage(e.target.value), className: "header-select", title: "Response Language", children: [_jsx("option", { value: "en", children: "\uD83C\uDDFA\uD83C\uDDF8 English" }), _jsx("option", { value: "es", children: "\uD83C\uDDEA\uD83C\uDDF8 Espa\u00F1ol" })] })] }), _jsx("button", { className: "icon-button", onClick: () => setShowSettings(true), title: "Settings", children: "\u2699\uFE0F" })] }), showSettings && (_jsx("div", { className: "settings-modal", children: _jsxs("div", { className: "settings-content", children: [_jsx("h2", { children: "Settings" }), _jsx("div", { className: "form-group", children: _jsxs("label", { children: ["Selected Provider:", " ", _jsx("strong", { children: settings.provider.toUpperCase() })] }) }), settings.provider === "gemini" && (_jsxs("div", { className: "form-group", children: [_jsx("label", { children: "Gemini Authentication" }), _jsx("p", { className: "description", children: "Use your Google account to access models (requires Google Cloud Code extension)." }), _jsx("button", { className: "vscode-button secondary", onClick: () => vscode.postMessage({ type: "signInWithGoogle" }), style: { marginBottom: "0.5rem" }, children: "Sign in with Google \u2197" }), _jsx("div", { className: "separator", children: "OR USE API KEY" }), _jsxs("div", { className: "input-with-link", children: [_jsxs("div", { style: { position: "relative", flex: 1 }, children: [_jsx("input", { type: "password", value: settings.geminiApiKey, onChange: (e) => setSettings({
                                                        ...settings,
                                                        geminiApiKey: e.target.value,
                                                    }), placeholder: "Paste Gemini API Key here", style: { paddingRight: "30px" } }), _jsx("button", { className: "icon-button", style: {
                                                        position: "absolute",
                                                        right: "2px",
                                                        top: "50%",
                                                        transform: "translateY(-50%)",
                                                        padding: "2px",
                                                        fontSize: "0.8rem",
                                                    }, onClick: async () => {
                                                        const text = await navigator.clipboard.readText();
                                                        setSettings({ ...settings, geminiApiKey: text });
                                                    }, title: "Paste", children: "\uD83D\uDCCB" })] }), _jsx("a", { href: "https://aistudio.google.com/app/apikey", target: "_blank", className: "link-button", children: "Get API Key \u2197" })] })] })), settings.provider === "anthropic" && (_jsxs("div", { className: "form-group", children: [_jsx("label", { children: "Anthropic API Key" }), _jsxs("div", { className: "input-with-link", children: [_jsxs("div", { style: { position: "relative", flex: 1 }, children: [_jsx("input", { type: "password", value: settings.anthropicApiKey, onChange: (e) => setSettings({
                                                        ...settings,
                                                        anthropicApiKey: e.target.value,
                                                    }), placeholder: "Enter Anthropic API Key", style: { paddingRight: "30px" } }), _jsx("button", { className: "icon-button", style: {
                                                        position: "absolute",
                                                        right: "2px",
                                                        top: "50%",
                                                        transform: "translateY(-50%)",
                                                        padding: "2px",
                                                        fontSize: "0.8rem",
                                                    }, onClick: async () => {
                                                        const text = await navigator.clipboard.readText();
                                                        setSettings({ ...settings, anthropicApiKey: text });
                                                    }, title: "Paste", children: "\uD83D\uDCCB" })] }), _jsx("a", { href: "https://console.anthropic.com/settings/keys", target: "_blank", className: "link-button", children: "Get Key \u2197" })] })] })), settings.provider === "openai" && (_jsxs("div", { className: "form-group", children: [_jsx("label", { children: "OpenAI API Key" }), _jsxs("div", { className: "input-with-link", children: [_jsxs("div", { style: { position: "relative", flex: 1 }, children: [_jsx("input", { type: "password", value: settings.openaiApiKey, onChange: (e) => setSettings({
                                                        ...settings,
                                                        openaiApiKey: e.target.value,
                                                    }), placeholder: "Enter OpenAI API Key", style: { paddingRight: "30px" } }), _jsx("button", { className: "icon-button", style: {
                                                        position: "absolute",
                                                        right: "2px",
                                                        top: "50%",
                                                        transform: "translateY(-50%)",
                                                        padding: "2px",
                                                        fontSize: "0.8rem",
                                                    }, onClick: async () => {
                                                        const text = await navigator.clipboard.readText();
                                                        setSettings({ ...settings, openaiApiKey: text });
                                                    }, title: "Paste", children: "\uD83D\uDCCB" })] }), _jsx("a", { href: "https://platform.openai.com/api-keys", target: "_blank", className: "link-button", children: "Get Key \u2197" })] })] })), settings.provider === "github" && (_jsxs("div", { className: "form-group", children: [_jsx("label", { children: "GitHub Authentication" }), _jsx("p", { className: "description", children: "Use your GitHub account to access models." }), _jsx("button", { className: "vscode-button secondary", onClick: handleSignInGithub, children: "Sign in with GitHub \u2197" }), _jsx("div", { className: "separator", children: "OR" }), _jsx("label", { children: "Personal Access Token (Optional)" }), _jsx("input", { type: "password", value: settings.githubToken, onChange: (e) => setSettings({ ...settings, githubToken: e.target.value }), placeholder: "Enter GitHub PAT" })] })), _jsxs("div", { className: "actions", children: [_jsx("button", { className: "vscode-button", onClick: handleSaveSettings, children: "Save" }), _jsx("button", { className: "vscode-button secondary", onClick: () => setShowSettings(false), children: "Cancel" })] })] }) })), _jsxs("div", { className: "chat-list", children: [messages.map((msg, index) => (_jsx("div", { className: `message ${msg.role}`, children: msg.role === "user" ? (_jsx("div", { className: "user-content", children: msg.content })) : (_jsxs("div", { className: `message ${msg.role}`, children: [msg.role === "assistant" && msg.critique && (_jsxs("div", { className: "critique", children: [msg.intent && (_jsx("div", { className: `intent-badge ${msg.intent.toLowerCase()}`, children: msg.intent === "EXECUTION"
                                                ? "⚡ Execution"
                                                : msg.intent === "CONTEXT"
                                                    ? "📚 Context"
                                                    : "❓ Question" })), _jsx("h3", { children: "Analysis" }), _jsx("p", { children: msg.critique }), msg.actionPlan && (_jsxs("div", { className: "action-plan", children: [_jsx("h4", { children: "Action Plan:" }), _jsx("p", { children: msg.actionPlan })] }))] })), msg.role === "assistant" && msg.improvedPrompt && (_jsxs("div", { className: "improved", children: [_jsx("h3", { children: "Improved Prompt" }), _jsx("pre", { children: msg.improvedPrompt }), _jsxs("div", { className: "actions", children: [_jsx("button", { className: "vscode-button", onClick: () => handleApply(msg.improvedPrompt), children: "Apply" }), _jsx("button", { className: "vscode-button secondary", onClick: () => handleCopy(msg.improvedPrompt), children: "Copy" }), _jsx("button", { className: "vscode-button secondary", onClick: () => handleRegenerate(msg.originalPrompt, msg.originalAttachments), disabled: isLoading, title: "Generate a new version", children: "\uD83D\uDD04 Regenerate" })] }), msg.provider && (_jsxs("div", { className: "provider-badge", children: ["Generated by", " ", msg.provider === "gemini"
                                                    ? "✨ Gemini"
                                                    : msg.provider === "anthropic"
                                                        ? "🤖 Claude"
                                                        : msg.provider === "openai"
                                                            ? "🧠 OpenAI"
                                                            : msg.provider === "github"
                                                                ? "🐙 GitHub"
                                                                : msg.provider] }))] })), msg.content && (_jsxs("div", { children: [_jsx("p", { children: msg.content }), msg.content.includes("API Key") && (_jsx("button", { className: "vscode-button", onClick: () => setShowSettings(true), style: { marginTop: "0.5rem" }, children: "Open Settings" }))] }))] })) }, index))), isLoading && (_jsxs("div", { className: "loading", children: [_jsx("span", { className: "spinner" }), " Analyzing..."] }))] }), _jsxs("div", { className: "input-area", children: [attachments.length > 0 && (_jsx("div", { className: "attachments-preview", children: attachments.map((att, i) => (_jsxs("div", { className: `attachment-chip ${att.type === "folder" ? "chip-folder" : "chip-file"}`, children: ["@", att.name, _jsx("button", { onClick: () => removeAttachment(i), children: "\u00D7" })] }, i))) })), _jsx("div", { className: "token-info", children: _jsxs("span", { className: `token-counter ${isOverLimit ? "over-limit" : usagePercent > 80 ? "warning" : ""}`, children: [tokenCount.toLocaleString(), "/", maxTokens.toLocaleString(), " tokens (", getProviderDisplayName(settings.provider), ")"] }) }), isOverLimit && (_jsxs("div", { className: "token-warning", children: ["\u26A0\uFE0F Token limit exceeded for", " ", getProviderDisplayName(settings.provider), ". Remove attachments or shorten your prompt."] })), _jsxs("div", { className: "input-container", children: [_jsx("textarea", { className: "vscode-textarea", value: inputValue, onInput: (e) => setInputValue(e.target.value), onKeyDown: handleKeyDown, onPaste: handlePaste, placeholder: "Type your prompt here...", rows: 1 }), _jsxs("div", { className: "input-actions", children: [_jsx("button", { className: "attachment-btn", onClick: () => vscode.postMessage({ type: "openContextPicker" }), title: "Add files or folders as context", children: "@Add Context" }), _jsx("button", { className: "vscode-button", onClick: handleSend, disabled: isLoading ||
                                            isOverLimit ||
                                            (attachments.length === 0 && !inputValue.trim()), children: "Send" })] })] })] })] }));
}
export default App;
