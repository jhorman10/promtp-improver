import type { WebviewApi } from "vscode-webview";

declare function acquireVsCodeApi(): WebviewApi<unknown>;

class VSCodeAPIWrapper {
  private readonly vsCodeApi: WebviewApi<unknown> | undefined;

  constructor() {
    // Check if the acquireVsCodeApi function exists in the current window object
    if (typeof acquireVsCodeApi === "function") {
      this.vsCodeApi = acquireVsCodeApi();
    }
  }

  /**
   * Post a message to the extension
   * @param message The message to send to the extension
   */
  public postMessage(message: unknown) {
    if (this.vsCodeApi) {
      this.vsCodeApi.postMessage(message);
    } else {
      console.log(message);
    }
  }

  /**
   * Get the persistent state stored for this webview
   * @returns The current state or undefined if no state has been set
   */
  public getState(): unknown | undefined {
    if (this.vsCodeApi) {
      return this.vsCodeApi.getState();
    } else {
      const state = localStorage.getItem("vscodeState");
      return state ? JSON.parse(state) : undefined;
    }
  }

  /**
   * Set the persistent state stored for this webview
   * @param newState The new state to store
   */
  public setState<T>(newState: T): T {
    if (this.vsCodeApi) {
      this.vsCodeApi.setState(newState);
    } else {
      localStorage.setItem("vscodeState", JSON.stringify(newState));
    }
    return newState;
  }
}

export const vscode = new VSCodeAPIWrapper();
