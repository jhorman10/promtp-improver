import * as vscode from "vscode";

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "promptImprover.chatView";
  private _view?: vscode.WebviewView;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        case "onInfo":
          vscode.window.showInformationMessage(data.value);
          break;
        case "onError":
          vscode.window.showErrorMessage(data.value);
          break;
        case "applySuggestion": {
          const editor = vscode.window.activeTextEditor;
          if (editor && data.value) {
            const selection = editor.selection;
            editor.edit((editBuilder) => {
              editBuilder.replace(selection, data.value);
            });
          }
          break;
        }
        case "saveSettings": {
          const config = vscode.workspace.getConfiguration("promptImprover");
          await config.update(
            "provider",
            data.provider,
            vscode.ConfigurationTarget.Global
          );
          if (data.apiKey) {
            await config.update(
              `${data.provider}ApiKey`,
              data.apiKey,
              vscode.ConfigurationTarget.Global
            );
          }
          if (data.githubToken) {
            await config.update(
              "githubToken",
              data.githubToken,
              vscode.ConfigurationTarget.Global
            );
          }
          break;
        }
        case "getSettings": {
          const config = vscode.workspace.getConfiguration("promptImprover");
          const provider = config.get<string>("provider") || "gemini";
          const geminiApiKey = config.get<string>("geminiApiKey") || "";
          const anthropicApiKey = config.get<string>("anthropicApiKey") || "";
          const openaiApiKey = config.get<string>("openaiApiKey") || "";
          const githubToken = config.get<string>("githubToken") || "";

          this._view?.webview.postMessage({
            type: "settingsData",
            value: {
              provider,
              geminiApiKey,
              anthropicApiKey,
              openaiApiKey,
              githubToken,
            },
          });
          break;
        }
        case "signInWithGithub": {
          try {
            const session = await vscode.authentication.getSession(
              "github",
              ["read:user", "user:email"],
              { createIfNone: true }
            );
            if (session) {
              // We don't save the token in settings, we just use the session
              // But for the UI to know we are signed in, we can send back a success message
              // Or we can save it if we really want to, but session is better.
              // For this implementation, let's just notify success and maybe save it if needed for the AI service
              // Actually, AI service should probably use getSession too.
              // For now, let's just save it to configuration so AI service can pick it up easily if we want to support manual token too.
              // BUT, using session in AI service is more robust.
              // Let's just send back the token to the UI so it can fill the field (optional) or just say "Signed In"

              // Better approach: Just tell UI we are signed in.
              // And in AI service, we try to get session if provider is github.

              vscode.window.showInformationMessage(
                `Signed in as ${session.account.label}`
              );

              // We can also update the config to use 'github' provider
              const config =
                vscode.workspace.getConfiguration("promptImprover");
              await config.update(
                "provider",
                "github",
                vscode.ConfigurationTarget.Global
              );

              this._view?.webview.postMessage({
                type: "signInSuccess",
                provider: "github",
                user: session.account.label,
              });
            }
          } catch (e: any) {
            vscode.window.showErrorMessage(`Sign in failed: ${e.message}`);
          }
          break;
        }
        case "signInWithGoogle": {
          try {
            // 1. Try silent sign-in first
            let session = await vscode.authentication.getSession(
              "google",
              [
                "https://www.googleapis.com/auth/generative-language",
                "email",
                "profile",
              ],
              { createIfNone: false }
            );

            // 2. If no session, try interactive sign-in
            if (!session) {
              session = await vscode.authentication.getSession(
                "google",
                [
                  "https://www.googleapis.com/auth/generative-language",
                  "email",
                  "profile",
                ],
                { createIfNone: true }
              );
            }

            if (session) {
              vscode.window.showInformationMessage(
                `Signed in with Google as ${session.account.label}`
              );

              const config =
                vscode.workspace.getConfiguration("promptImprover");
              await config.update(
                "provider",
                "gemini",
                vscode.ConfigurationTarget.Global
              );

              this._view?.webview.postMessage({
                type: "signInSuccess",
                provider: "gemini",
                user: session.account.label,
              });
            }
          } catch (e: any) {
            // Check for common Cloud Code errors that might be confusing
            let errorMessage = e.message;
            if (
              errorMessage.includes("Invalid resource field value") ||
              errorMessage.includes("Error listing clusters")
            ) {
              errorMessage =
                "Google Cloud Code is having trouble listing resources, but you might still be signed in. Please try clicking 'Sign in' again.";
            }

            const message = `Google Sign-In failed: ${errorMessage}. Ensure 'Google Cloud Code' is installed and you are signed in via the Status Bar.`;
            const selection = await vscode.window.showErrorMessage(
              message,
              "Install Extension",
              "Get API Key Instead"
            );

            if (selection === "Install Extension") {
              vscode.commands.executeCommand(
                "workbench.extensions.search",
                "Google Cloud Code"
              );
            } else if (selection === "Get API Key Instead") {
              vscode.env.openExternal(
                vscode.Uri.parse("https://aistudio.google.com/app/apikey")
              );
            }
          }
          break;
        }
        case "userMessage": {
          vscode.commands.executeCommand(
            "promptImprover.analyzePrompt",
            data.value,
            data.attachments,
            data.language || "en"
          );
          break;
        }
        case "selectContext": {
          // Show quick pick to choose between files and folders from workspace
          const workspaceFolders = vscode.workspace.workspaceFolders;
          if (!workspaceFolders) {
            vscode.window.showWarningMessage("No workspace folder open.");
            break;
          }

          const options: vscode.OpenDialogOptions = {
            canSelectMany: true,
            openLabel: "Attach as Context",
            canSelectFiles: true,
            canSelectFolders: true,
            defaultUri: workspaceFolders[0].uri,
          };

          const fileUris = await vscode.window.showOpenDialog(options);
          if (fileUris && fileUris.length > 0) {
            const attachments: { name: string; type: string; data: string }[] =
              [];

            for (const uri of fileUris) {
              const stat = await vscode.workspace.fs.stat(uri);

              if (stat.type === vscode.FileType.File) {
                // Read file content
                try {
                  const content = await vscode.workspace.fs.readFile(uri);
                  const textContent = new TextDecoder().decode(content);
                  attachments.push({
                    name: uri.fsPath.split("/").pop() || "file",
                    type: "file",
                    data: textContent.slice(0, 50000), // Limit to 50k chars
                  });
                } catch (e) {
                  attachments.push({
                    name: uri.fsPath.split("/").pop() || "file",
                    type: "file",
                    data: `[Could not read file: ${uri.fsPath}]`,
                  });
                }
              } else if (stat.type === vscode.FileType.Directory) {
                // List folder contents
                const files = await vscode.workspace.fs.readDirectory(uri);
                const fileList = files
                  .map(
                    ([name, type]) =>
                      `${
                        type === vscode.FileType.Directory ? "📁" : "📄"
                      } ${name}`
                  )
                  .join("\n");
                attachments.push({
                  name: uri.fsPath.split("/").pop() || "folder",
                  type: "folder",
                  data: `Folder: ${uri.fsPath}\nContents:\n${fileList}`,
                });
              }
            }

            this._view?.webview.postMessage({
              type: "addContext",
              value: attachments,
            });
          }
          break;
        }
        case "selectOpenFiles": {
          // Get all open tabs from all tab groups (matches "Open Editors" section)
          const allTabs: { label: string; uri: vscode.Uri }[] = [];

          for (const tabGroup of vscode.window.tabGroups.all) {
            for (const tab of tabGroup.tabs) {
              if (tab.input instanceof vscode.TabInputText) {
                const uri = tab.input.uri;
                if (uri.scheme === "file") {
                  allTabs.push({
                    label: tab.label,
                    uri: uri,
                  });
                }
              }
            }
          }

          if (allTabs.length === 0) {
            vscode.window.showWarningMessage(
              "No files are currently open in the editor."
            );
            break;
          }

          const items = allTabs.map((tab) => ({
            label: tab.label,
            description: tab.uri.fsPath,
            picked: false,
            uri: tab.uri,
          }));

          const selected = await vscode.window.showQuickPick(items, {
            canPickMany: true,
            placeHolder: "Select files to use as context",
            title: "Open Editors",
          });

          if (selected && selected.length > 0) {
            const attachments: { name: string; type: string; data: string }[] =
              [];

            for (const item of selected) {
              try {
                const content = await vscode.workspace.fs.readFile(item.uri);
                const textContent = new TextDecoder().decode(content);
                attachments.push({
                  name: item.label,
                  type: "file",
                  data: textContent.slice(0, 50000), // Limit to 50k chars
                });
              } catch (e) {
                attachments.push({
                  name: item.label,
                  type: "file",
                  data: `[Could not read file: ${item.uri.fsPath}]`,
                });
              }
            }

            this._view?.webview.postMessage({
              type: "addContext",
              value: attachments,
            });
          }
          break;
        }
      }
    });
  }

  public async addMessageToChat(message: string) {
    if (this._view) {
      this._view.show?.(true); // Show the view
      await this._view.webview.postMessage({
        type: "addMessage",
        value: message,
      });
    }
  }

  public async updateLastMessage(
    critique: string,
    improvedPrompt: string,
    provider?: string,
    intent?: string,
    actionPlan?: string
  ) {
    if (this._view) {
      await this._view.webview.postMessage({
        type: "updateMessage",
        critique,
        improvedPrompt,
        provider,
        intent,
        actionPlan,
      });
    }
  }

  public async sendError(errorMessage: string) {
    if (this._view) {
      await this._view.webview.postMessage({
        type: "onError",
        value: errorMessage,
      });
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "media", "assets", "index.js")
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "media", "assets", "index.css")
    );

    return `<!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'unsafe-inline';">
        <link rel="stylesheet" type="text/css" href="${styleUri}">
        <title>Prompt Improver Chat</title>
      </head>
      <body>
        <div id="root"></div>
        <script type="module" src="${scriptUri}"></script>
      </body>
      </html>`;
  }
}
