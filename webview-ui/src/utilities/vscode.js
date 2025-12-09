class VSCodeAPIWrapper {
    vsCodeApi;
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
    postMessage(message) {
        if (this.vsCodeApi) {
            this.vsCodeApi.postMessage(message);
        }
        else {
            console.log(message);
        }
    }
    /**
     * Get the persistent state stored for this webview
     * @returns The current state or undefined if no state has been set
     */
    getState() {
        if (this.vsCodeApi) {
            return this.vsCodeApi.getState();
        }
        else {
            const state = localStorage.getItem("vscodeState");
            return state ? JSON.parse(state) : undefined;
        }
    }
    /**
     * Set the persistent state stored for this webview
     * @param newState The new state to store
     */
    setState(newState) {
        if (this.vsCodeApi) {
            this.vsCodeApi.setState(newState);
        }
        else {
            localStorage.setItem("vscodeState", JSON.stringify(newState));
        }
        return newState;
    }
}
export const vscode = new VSCodeAPIWrapper();
