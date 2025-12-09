import { useState, useEffect, useMemo } from "react";
import { vscode } from "./utilities/vscode";
import "./App.css";

// Token estimation: ~4 characters per token (rough approximation)
const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

// Token limits per AI provider
const TOKEN_LIMITS: Record<string, number> = {
  gemini: 32000, // Gemini version gratuita (32k contexto)
  anthropic: 100000, // Claude limits vary (up to ~200k paid)
  openai: 16000, // GPT-5.1 Instant (16k contexto)
  github: 8000, // Copilot chat window (~8k)
};

const getProviderDisplayName = (provider: string): string => {
  const names: Record<string, string> = {
    gemini: "Gemini",
    anthropic: "Claude",
    openai: "GPT-4",
    github: "GitHub",
  };
  return names[provider] || provider;
};

interface Message {
  role: "user" | "assistant";
  content: string;
  critique?: string;
  improvedPrompt?: string;
  originalPrompt?: string;
  originalAttachments?: {
    name: string;
    type: "file" | "image" | "folder";
    data: string;
  }[];
  provider?: string;
  intent?: "EXECUTION" | "CONTEXT" | "QUESTION";
  actionPlan?: string;
}

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
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

    const handleSettingsMsg = (event: MessageEvent) => {
      const message = event.data;
      if (message.type === "settingsData") {
        setSettings(message.value);
      } else if (message.type === "signInSuccess") {
        setSettings((prev) => ({ ...prev, provider: message.provider }));
      }
    };
    window.addEventListener("message", handleSettingsMsg);
    return () => window.removeEventListener("message", handleSettingsMsg);
  }, []);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
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
  const [attachments, setAttachments] = useState<
    { name: string; type: "file" | "folder" | "image"; data: string }[]
  >([]);

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
    if (!inputValue.trim() && attachments.length === 0) return;

    if (isOverLimit) {
      vscode.postMessage({
        type: "onError",
        value: `Token limit exceeded for ${getProviderDisplayName(
          settings.provider
        )} (${tokenCount.toLocaleString()}/${maxTokens.toLocaleString()}). Please reduce your prompt or remove some attachments.`,
      });
      return;
    }

    const userMsg: Message = {
      role: "user",
      content: inputValue,
      originalAttachments:
        attachments.length > 0 ? [...attachments] : undefined,
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
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
                  data: event.target!.result as string,
                },
              ]);
            }
          };
          reader.readAsDataURL(blob);
        }
      }
    }
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  // Listen for attachment selections from extension
  useEffect(() => {
    const handleAttachmentMsg = (event: MessageEvent) => {
      const message = event.data;
      if (message.type === "addContext") {
        setAttachments((prev) => [...prev, ...message.value]);
      }
    };
    window.addEventListener("message", handleAttachmentMsg);
    return () => window.removeEventListener("message", handleAttachmentMsg);
  }, []);

  const handleApply = (text: string) => {
    vscode.postMessage({ type: "applySuggestion", value: text });
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    vscode.postMessage({ type: "onInfo", value: "Copied to clipboard!" });
  };

  const handleRegenerate = (
    originalPrompt: string,
    originalAttachments?: {
      name: string;
      type: "file" | "image" | "folder";
      data: string;
    }[]
  ) => {
    if (!originalPrompt) return;

    // Add the prompt as a new user message
    const userMsg: Message = {
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
      apiKey:
        settings.provider === "gemini"
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

  return (
    <main>
      <div className="header">
        <div className="provider-selector">
          <select
            value={settings.provider}
            onChange={(e) => {
              const newProvider = e.target.value;
              setSettings({ ...settings, provider: newProvider });
              // Save the provider setting immediately
              vscode.postMessage({
                type: "saveSettings",
                provider: newProvider,
              });
            }}
            className="header-select"
          >
            <option value="gemini">Gemini</option>
            <option value="anthropic">Claude</option>
            <option value="openai">OpenAI</option>
            <option value="github">GitHub</option>
          </select>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="header-select"
            title="Response Language"
          >
            <option value="en">🇺🇸 English</option>
            <option value="es">🇪🇸 Español</option>
          </select>
        </div>
        <button
          className="icon-button"
          onClick={() => setShowSettings(true)}
          title="Settings"
        >
          ⚙️
        </button>
      </div>

      {showSettings && (
        <div className="settings-modal">
          <div className="settings-content">
            <h2>Settings</h2>

            {/* Provider selection moved to header, but we can keep it here or remove it. 
                Let's keep the specific config for the selected provider here. */}

            <div className="form-group">
              <label>
                Selected Provider:{" "}
                <strong>{settings.provider.toUpperCase()}</strong>
              </label>
            </div>

            {settings.provider === "gemini" && (
              <div className="form-group">
                <label>Gemini Authentication</label>
                <p className="description">
                  Use your Google account to access models (requires Google
                  Cloud Code extension).
                </p>
                <button
                  className="vscode-button secondary"
                  onClick={() =>
                    vscode.postMessage({ type: "signInWithGoogle" })
                  }
                  style={{ marginBottom: "0.5rem" }}
                >
                  Sign in with Google ↗
                </button>
                <div className="separator">OR USE API KEY</div>
                <div className="input-with-link">
                  <div style={{ position: "relative", flex: 1 }}>
                    <input
                      type="password"
                      value={settings.geminiApiKey}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          geminiApiKey: e.target.value,
                        })
                      }
                      placeholder="Paste Gemini API Key here"
                      style={{ paddingRight: "30px" }}
                    />
                    <button
                      className="icon-button"
                      style={{
                        position: "absolute",
                        right: "2px",
                        top: "50%",
                        transform: "translateY(-50%)",
                        padding: "2px",
                        fontSize: "0.8rem",
                      }}
                      onClick={async () => {
                        const text = await navigator.clipboard.readText();
                        setSettings({ ...settings, geminiApiKey: text });
                      }}
                      title="Paste"
                    >
                      📋
                    </button>
                  </div>
                  <a
                    href="https://aistudio.google.com/app/apikey"
                    target="_blank"
                    className="link-button"
                  >
                    Get API Key ↗
                  </a>
                </div>
              </div>
            )}

            {settings.provider === "anthropic" && (
              <div className="form-group">
                <label>Anthropic API Key</label>
                <div className="input-with-link">
                  <div style={{ position: "relative", flex: 1 }}>
                    <input
                      type="password"
                      value={settings.anthropicApiKey}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          anthropicApiKey: e.target.value,
                        })
                      }
                      placeholder="Enter Anthropic API Key"
                      style={{ paddingRight: "30px" }}
                    />
                    <button
                      className="icon-button"
                      style={{
                        position: "absolute",
                        right: "2px",
                        top: "50%",
                        transform: "translateY(-50%)",
                        padding: "2px",
                        fontSize: "0.8rem",
                      }}
                      onClick={async () => {
                        const text = await navigator.clipboard.readText();
                        setSettings({ ...settings, anthropicApiKey: text });
                      }}
                      title="Paste"
                    >
                      📋
                    </button>
                  </div>
                  <a
                    href="https://console.anthropic.com/settings/keys"
                    target="_blank"
                    className="link-button"
                  >
                    Get Key ↗
                  </a>
                </div>
              </div>
            )}

            {settings.provider === "openai" && (
              <div className="form-group">
                <label>OpenAI API Key</label>
                <div className="input-with-link">
                  <div style={{ position: "relative", flex: 1 }}>
                    <input
                      type="password"
                      value={settings.openaiApiKey}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          openaiApiKey: e.target.value,
                        })
                      }
                      placeholder="Enter OpenAI API Key"
                      style={{ paddingRight: "30px" }}
                    />
                    <button
                      className="icon-button"
                      style={{
                        position: "absolute",
                        right: "2px",
                        top: "50%",
                        transform: "translateY(-50%)",
                        padding: "2px",
                        fontSize: "0.8rem",
                      }}
                      onClick={async () => {
                        const text = await navigator.clipboard.readText();
                        setSettings({ ...settings, openaiApiKey: text });
                      }}
                      title="Paste"
                    >
                      📋
                    </button>
                  </div>
                  <a
                    href="https://platform.openai.com/api-keys"
                    target="_blank"
                    className="link-button"
                  >
                    Get Key ↗
                  </a>
                </div>
              </div>
            )}

            {settings.provider === "github" && (
              <div className="form-group">
                <label>GitHub Authentication</label>
                <p className="description">
                  Use your GitHub account to access models.
                </p>
                <button
                  className="vscode-button secondary"
                  onClick={handleSignInGithub}
                >
                  Sign in with GitHub ↗
                </button>
                <div className="separator">OR</div>
                <label>Personal Access Token (Optional)</label>
                <input
                  type="password"
                  value={settings.githubToken}
                  onChange={(e) =>
                    setSettings({ ...settings, githubToken: e.target.value })
                  }
                  placeholder="Enter GitHub PAT"
                />
              </div>
            )}

            <div className="actions">
              <button className="vscode-button" onClick={handleSaveSettings}>
                Save
              </button>
              <button
                className="vscode-button secondary"
                onClick={() => setShowSettings(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="chat-list">
        {messages.map((msg, index) => (
          <div key={index} className={`message ${msg.role}`}>
            {msg.role === "user" ? (
              <div className="user-content">
                {msg.content}
                {/* We could render attachment previews here in history too */}
              </div>
            ) : (
              <div className={`message ${msg.role}`}>
                {msg.role === "assistant" && msg.critique && (
                  <div className="critique">
                    {msg.intent && (
                      <div
                        className={`intent-badge ${msg.intent.toLowerCase()}`}
                      >
                        {msg.intent === "EXECUTION"
                          ? "⚡ Execution"
                          : msg.intent === "CONTEXT"
                          ? "📚 Context"
                          : "❓ Question"}
                      </div>
                    )}
                    <h3>Analysis</h3>
                    <p>{msg.critique}</p>
                    {msg.actionPlan && (
                      <div className="action-plan">
                        <h4>Action Plan:</h4>
                        <p>{msg.actionPlan}</p>
                      </div>
                    )}
                  </div>
                )}
                {msg.role === "assistant" && msg.improvedPrompt && (
                  <div className="improved">
                    <h3>Improved Prompt</h3>
                    <pre>{msg.improvedPrompt}</pre>
                    <div className="actions">
                      <button
                        className="vscode-button"
                        onClick={() => handleApply(msg.improvedPrompt!)}
                      >
                        Apply
                      </button>
                      <button
                        className="vscode-button secondary"
                        onClick={() => handleCopy(msg.improvedPrompt!)}
                      >
                        Copy
                      </button>
                      <button
                        className="vscode-button secondary"
                        onClick={() =>
                          handleRegenerate(
                            msg.originalPrompt!,
                            msg.originalAttachments
                          )
                        }
                        disabled={isLoading}
                        title="Generate a new version"
                      >
                        🔄 Regenerate
                      </button>
                    </div>
                    {msg.provider && (
                      <div className="provider-badge">
                        Generated by{" "}
                        {msg.provider === "gemini"
                          ? "✨ Gemini"
                          : msg.provider === "anthropic"
                          ? "🤖 Claude"
                          : msg.provider === "openai"
                          ? "🧠 OpenAI"
                          : msg.provider === "github"
                          ? "🐙 GitHub"
                          : msg.provider}
                      </div>
                    )}
                  </div>
                )}
                {msg.content && (
                  <div>
                    <p>{msg.content}</p>
                    {msg.content.includes("API Key") && (
                      <button
                        className="vscode-button"
                        onClick={() => setShowSettings(true)}
                        style={{ marginTop: "0.5rem" }}
                      >
                        Open Settings
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        {isLoading && (
          <div className="loading">
            <span className="spinner"></span> Analyzing...
          </div>
        )}
      </div>

      <div className="input-area">
        {/* Context attachments */}
        {attachments.length > 0 && (
          <div className="attachments-preview">
            {attachments.map((att, i) => (
              <div
                key={i}
                className={`attachment-chip ${
                  att.type === "folder" ? "chip-folder" : "chip-file"
                }`}
              >
                @{att.name}
                <button onClick={() => removeAttachment(i)}>×</button>
              </div>
            ))}
          </div>
        )}

        {/* Token counter - above chat box, aligned right */}
        <div className="token-info">
          <span
            className={`token-counter ${
              isOverLimit ? "over-limit" : usagePercent > 80 ? "warning" : ""
            }`}
          >
            {tokenCount.toLocaleString()}/{maxTokens.toLocaleString()} tokens (
            {getProviderDisplayName(settings.provider)})
          </span>
        </div>

        {/* Warning if over limit */}
        {isOverLimit && (
          <div className="token-warning">
            ⚠️ Token limit exceeded for{" "}
            {getProviderDisplayName(settings.provider)}. Remove attachments or
            shorten your prompt.
          </div>
        )}

        {/* Chat input box */}
        <div className="input-container">
          <textarea
            className="vscode-textarea"
            value={inputValue}
            onInput={(e) =>
              setInputValue((e.target as HTMLTextAreaElement).value)
            }
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder="Type your prompt here..."
            rows={1}
          />
          <div className="input-actions">
            <button
              className="attachment-btn"
              onClick={() => vscode.postMessage({ type: "openContextPicker" })}
              title="Add files or folders as context"
            >
              @Add Context
            </button>
            <button
              className="vscode-button"
              onClick={handleSend}
              disabled={
                isLoading ||
                isOverLimit ||
                (attachments.length === 0 && !inputValue.trim())
              }
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}

export default App;
