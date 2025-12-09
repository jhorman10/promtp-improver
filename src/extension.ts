import * as vscode from "vscode";
import { ChatViewProvider } from "./views/ChatViewProvider";
import { ContextService } from "./services/context";
import { AIService } from "./services/ai";

export function activate(context: vscode.ExtensionContext) {
  const provider = new ChatViewProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      ChatViewProvider.viewType,
      provider
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "promptImprover.analyzePrompt",
      async (
        userPrompt: string,
        attachments: any[] = [],
        language: string = "en"
      ) => {
        // 1. Gather Context
        const editor = vscode.window.activeTextEditor;
        let contextData = "";
        if (editor) {
          contextData = await ContextService.gather(editor);
        }

        // Process attachments (mock)
        const attachmentNames = attachments.map((a: any) => a.name).join(", ");
        const hasAttachments = attachments.length > 0;

        // 2. Call AI (Mocked for now with 4-part framework logic)
        try {
          // Get current provider
          const config = vscode.workspace.getConfiguration("promptImprover");
          const currentProvider = config.get<string>("provider") || "gemini";

          // 2. Call AI
          try {
            const result = await AIService.analyze(
              userPrompt,
              contextData,
              attachments,
              language
            );
            await provider.updateLastMessage(
              result.critique,
              result.improvedPrompt,
              currentProvider,
              result.intent,
              result.actionPlan
            );
          } catch (error: any) {
            vscode.window.showErrorMessage(error.message);
            await provider.updateLastMessage(
              `Error: ${error.message}`,
              "",
              currentProvider
            );

            if (error.message.includes("API Key")) {
              const selection = await vscode.window.showErrorMessage(
                error.message,
                "Open Settings"
              );
              if (selection === "Open Settings") {
                vscode.commands.executeCommand(
                  "workbench.action.openSettings",
                  "promptImprover"
                );
              }
            }
          }
        } catch (error: any) {
          await provider.sendError(error.message);
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "promptImprover.improvePrompt",
      async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          vscode.window.showErrorMessage("No active editor found");
          return;
        }

        const selection = editor.selection;
        const text = editor.document.getText(selection);

        if (!text) {
          vscode.window.showErrorMessage("Please select a prompt to improve");
          return;
        }

        // 2. Trigger analysis
        vscode.commands.executeCommand("promptImprover.analyzePrompt", text);
      }
    )
  );

  // Register URI Handler
  context.subscriptions.push(
    vscode.window.registerUriHandler({
      handleUri(uri: vscode.Uri) {
        if (uri.path === "/auth") {
          const query = new URLSearchParams(uri.query);
          const provider = query.get("provider");
          const key = query.get("key");

          if (provider && key) {
            const config = vscode.workspace.getConfiguration("promptImprover");
            config
              .update("provider", provider, vscode.ConfigurationTarget.Global)
              .then(() => {
                if (provider === "github") {
                  return config.update(
                    "githubToken",
                    key,
                    vscode.ConfigurationTarget.Global
                  );
                } else {
                  return config.update(
                    `${provider}ApiKey`,
                    key,
                    vscode.ConfigurationTarget.Global
                  );
                }
              })
              .then(() => {
                vscode.window.showInformationMessage(
                  `Successfully authenticated with ${provider}`
                );
                // We rely on the configuration change event or manual reload for now.
              });
          }
        }
      },
    })
  );
}

export function deactivate() {}
