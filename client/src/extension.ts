/**
 * Jyro VS Code Extension Client
 * Activates and manages the Jyro language server
 */

import * as path from 'path';
import { workspace, ExtensionContext } from 'vscode';

import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind
} from 'vscode-languageclient/node';

let client: LanguageClient;

export function activate(context: ExtensionContext) {
    // The server is implemented in node (bundled with esbuild)
    const serverModule = context.asAbsolutePath(
        path.join('dist', 'server.js')
    );

    // The debug options for the server
    // --inspect=6009: runs the server in Node's Inspector mode so VS Code can attach to the server for debugging
    const debugOptions = { execArgv: ['--nolazy', '--inspect=6009'] };

    // If the extension is launched in debug mode then the debug server options are used
    // Otherwise the run options are used
    const serverOptions: ServerOptions = {
        run: { module: serverModule, transport: TransportKind.ipc },
        debug: {
            module: serverModule,
            transport: TransportKind.ipc,
            options: debugOptions
        }
    };

    // Options to control the language client
    const clientOptions: LanguageClientOptions = {
        // Register the server for Jyro documents
        documentSelector: [
            { scheme: 'file', language: 'jyro' },
            { scheme: 'realtree', language: 'jyro' }
        ],
        synchronize: {
            // Notify the server about file changes to '.jyro files contained in the workspace
            fileEvents: workspace.createFileSystemWatcher('**/.jyro')
        }
    };

    // Create the language client and start the client
    client = new LanguageClient(
        'jyroLanguageServer',
        'Jyro Language Server',
        serverOptions,
        clientOptions
    );

    // Start the client. This will also launch the server
    client.start().then(() => {
        console.log('Jyro Language Server started successfully');
    }).catch((error) => {
        console.error('Failed to start Jyro Language Server:', error);
    });

    console.log('Jyro Language Server is now active!');
    console.log('Server module path:', serverModule);
}

export function deactivate(): Thenable<void> | undefined {
    if (!client) {
        return undefined;
    }
    return client.stop();
}
