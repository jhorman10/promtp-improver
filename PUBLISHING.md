# How to Publish Your VS Code Extension

This guide outlines the steps to publish your extension to the Visual Studio Code Marketplace.

## Prerequisites

1.  **VSCE Tool**: You need the `vsce` command-line tool installed (you likely already have it if you've been packaging the extension).
    ```bash
    npm install -g @vscode/vsce
    ```
2.  **Microsoft Account**: You need a Microsoft account to log in to Azure DevOps and the Marketplace.

## Step 1: Create a Publisher

1.  Go to the [Visual Studio Code Marketplace management page](https://marketplace.visualstudio.com/manage).
2.  Log in with your Microsoft account.
3.  Click **"Create publisher"**.
4.  Enter a unique **Name** (ID) and a **Display Name**.
    - _Note: The "Name" (ID) is what goes in your `package.json`._

## Step 2: Update `package.json`

Open your `package.json` file and update the following fields:

1.  **publisher**: Change `"antigravity"` to the **Name (ID)** of the publisher you created in Step 1.
    ```json
    "publisher": "your-publisher-id",
    ```
2.  **version**: Ensure the version is correct (e.g., `0.0.1`).
3.  **repository**: Update the URL to your actual GitHub repository if you have one.

## Step 3: Get a Personal Access Token (PAT)

To publish from the command line, you need a PAT from Azure DevOps.

1.  Go to [Azure DevOps](https://dev.azure.com/).
2.  Create a new Organization if you don't have one.
3.  Click on the **User Settings** icon (top right, next to your profile photo) -> **Personal access tokens**.
4.  Click **"+ New Token"**.
5.  **Name**: Give it a name (e.g., "VS Code Extension").
6.  **Organization**: Select "All accessible organizations".
7.  **Scopes**: Scroll to the bottom and select **"Marketplace"** -> **"Acquire"** and **"Manage"**.
8.  Click **Create**.
9.  **COPY THE TOKEN**. You won't see it again.

## Step 4: Login with VSCE

In your terminal, run:

```bash
vsce login your-publisher-id
```

It will ask for your Personal Access Token. Paste the token you copied in Step 3.

## Step 5: Package and Publish

### Option A: Publish from Command Line (Recommended)

Run the following command in the root of your project:

```bash
vsce publish
```

This will:

1.  Run the `vscode:prepublish` script (which builds your code).
2.  Package the extension.
3.  Upload it to the Marketplace.

### Option B: Manual Upload

1.  Package the extension into a `.vsix` file:

    ```bash
    vsce package
    ```

    _This creates a file like `prompt-improver-chat-0.0.1.vsix`._

2.  Go to the [Marketplace management page](https://marketplace.visualstudio.com/manage).
3.  Click on your publisher.
4.  Click **"New Extension"** -> **"Visual Studio Code"**.
5.  Upload the `.vsix` file you generated.

## Verification

After publishing, it may take a few minutes for the extension to appear. You can verify it by searching for your extension name in the VS Code Marketplace or inside VS Code's Extensions view.
