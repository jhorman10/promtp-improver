declare class VSCodeAPIWrapper {
    private readonly vsCodeApi;
    constructor();
    /**
     * Post a message to the extension
     * @param message The message to send to the extension
     */
    postMessage(message: unknown): void;
    /**
     * Get the persistent state stored for this webview
     * @returns The current state or undefined if no state has been set
     */
    getState(): unknown | undefined;
    /**
     * Set the persistent state stored for this webview
     * @param newState The new state to store
     */
    setState<T>(newState: T): T;
}
export declare const vscode: VSCodeAPIWrapper;
export {};
