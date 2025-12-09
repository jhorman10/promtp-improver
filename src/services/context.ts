import * as vscode from "vscode";
import * as path from "path";

export class ContextService {
  static async gather(activeEditor: vscode.TextEditor): Promise<string> {
    const document = activeEditor.document;
    const filename = path.basename(document.fileName);
    const content = document.getText();
    const language = document.languageId;

    // Get diagnostics (errors/warnings)
    const diagnostics = vscode.languages.getDiagnostics(document.uri);
    const diagnosticsText = diagnostics
      .map(
        (d) =>
          `Line ${d.range.start.line + 1}: [${
            d.severity === vscode.DiagnosticSeverity.Error ? "Error" : "Warning"
          }] ${d.message}`
      )
      .join("\n");

    // Get open file names (approximation of project context)
    const openFiles = vscode.workspace.textDocuments
      .map((doc) => path.basename(doc.fileName))
      .filter((name) => name !== filename && !name.startsWith("Extension:"))
      .join(", ");

    return `
Context Information:
- Active File: ${filename} (${language})
- Open Files: ${openFiles}
- Diagnostics/Errors in Active File:
${diagnosticsText || "None"}

File Content:
\`\`\`${language}
${content}
\`\`\`
`;
  }
}
