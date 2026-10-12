/**
 * Jyro Language Server
 * Implements the Language Server Protocol for Jyro scripting language.
 * The language features themselves are in the shared JyroLanguageService,
 * which jyro.dev also uses; this file connects them to VS Code.
 */

import {
    createConnection,
    TextDocuments,
    ProposedFeatures,
    InitializeParams,
    DidChangeConfigurationNotification,
    CompletionItem,
    TextDocumentPositionParams,
    TextDocumentSyncKind,
    InitializeResult,
    HoverParams,
    Hover,
    SignatureHelpParams,
    SignatureHelp,
    DefinitionParams,
    Definition,
    DocumentFormattingParams,
    TextEdit
} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument';
import { FunctionSignature, JyroLanguageService } from '../../shared';

// Create a connection for the server using Node's IPC
const connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

// The language features, with the stdlib plus host functions from configuration
const service = new JyroLanguageService();

// Settings interface
interface JyroSettings {
    maxNumberOfProblems: number;
    warnOnHostFunctions: boolean;
    hostFunctions: FunctionSignature[];
    trace: {
        server: string;
    };
}

// Default settings
const defaultSettings: JyroSettings = {
    maxNumberOfProblems: 100,
    warnOnHostFunctions: true,
    hostFunctions: [],
    trace: { server: 'off' }
};
let globalSettings: JyroSettings = defaultSettings;

// Cache the settings of all open documents
const documentSettings: Map<string, Thenable<JyroSettings>> = new Map();

let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;

connection.onInitialize((params: InitializeParams) => {
    connection.console.log('Jyro Language Server initializing...');
    const capabilities = params.capabilities;

    // Check client capabilities
    hasConfigurationCapability = !!(
        capabilities.workspace && !!capabilities.workspace.configuration
    );
    hasWorkspaceFolderCapability = !!(
        capabilities.workspace && !!capabilities.workspace.workspaceFolders
    );

    const result: InitializeResult = {
        capabilities: {
            textDocumentSync: TextDocumentSyncKind.Incremental,
            completionProvider: {
                resolveProvider: true,
                triggerCharacters: ['.', '(']
            },
            hoverProvider: true,
            signatureHelpProvider: {
                triggerCharacters: ['(', ',']
            },
            definitionProvider: true,
            documentFormattingProvider: true
        }
    };

    if (hasWorkspaceFolderCapability) {
        result.capabilities.workspace = {
            workspaceFolders: {
                supported: true
            }
        };
    }

    connection.console.log('Server capabilities: ' + JSON.stringify(result.capabilities));
    return result;
});

connection.onInitialized(() => {
    if (hasConfigurationCapability) {
        // Register for all configuration changes
        connection.client.register(DidChangeConfigurationNotification.type, undefined);
        // Load initial host functions
        connection.workspace.getConfiguration({ section: 'jyro' }).then((settings: JyroSettings) => {
            service.setHostFunctions(settings.hostFunctions || []);
        });
    }
    if (hasWorkspaceFolderCapability) {
        connection.workspace.onDidChangeWorkspaceFolders(_event => {
            connection.console.log('Workspace folder change event received.');
        });
    }
});

connection.onDidChangeConfiguration(change => {
    if (hasConfigurationCapability) {
        // Reset all cached document settings
        documentSettings.clear();
        // Rebuild effective functions from updated configuration
        connection.workspace.getConfiguration({ section: 'jyro' }).then((settings: JyroSettings) => {
            service.setHostFunctions(settings.hostFunctions || []);
        });
    } else {
        globalSettings = <JyroSettings>(
            (change.settings.jyro || defaultSettings)
        );
        service.setHostFunctions(globalSettings.hostFunctions || []);
    }

    // Revalidate all open text documents
    documents.all().forEach(validateTextDocument);
});

function getDocumentSettings(resource: string): Thenable<JyroSettings> {
    if (!hasConfigurationCapability) {
        return Promise.resolve(globalSettings);
    }
    let result = documentSettings.get(resource);
    if (!result) {
        result = connection.workspace.getConfiguration({
            scopeUri: resource,
            section: 'jyro'
        });
        documentSettings.set(resource, result);
    }
    return result;
}

// Only keep settings for open documents
documents.onDidClose(e => {
    documentSettings.delete(e.document.uri);
});

// The content of a text document has changed
documents.onDidChangeContent(change => {
    validateTextDocument(change.document);
});

async function validateTextDocument(textDocument: TextDocument): Promise<void> {
    const settings = await getDocumentSettings(textDocument.uri);
    const diagnostics = service.validate(textDocument.getText(), {
        warnOnHostFunctions: settings.warnOnHostFunctions
    });

    // Limit the number of problems
    const limitedDiagnostics = diagnostics.slice(0, settings.maxNumberOfProblems);

    // Send the computed diagnostics to VSCode
    connection.sendDiagnostics({ uri: textDocument.uri, diagnostics: limitedDiagnostics });
}

// This handler provides completion items
connection.onCompletion((params: TextDocumentPositionParams): CompletionItem[] => {
    const document = documents.get(params.textDocument.uri);
    return document ? service.complete(document.getText(), params.position) : [];
});

// This handler resolves additional information for completion items
connection.onCompletionResolve((item: CompletionItem): CompletionItem => {
    return service.resolveCompletion(item);
});

// Hover provider
connection.onHover((params: HoverParams): Hover | null => {
    const document = documents.get(params.textDocument.uri);
    return document ? service.hover(document.getText(), params.position) : null;
});

// Signature help provider
connection.onSignatureHelp((params: SignatureHelpParams): SignatureHelp | null => {
    const document = documents.get(params.textDocument.uri);
    return document ? service.signatureHelp(document.getText(), params.position) : null;
});

// Definition provider - Go to Definition (Ctrl+Click)
connection.onDefinition((params: DefinitionParams): Definition | null => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
        return null;
    }
    const range = service.definition(document.getText(), params.position);
    return range ? { uri: params.textDocument.uri, range } : null;
});

// Document formatting handler
connection.onDocumentFormatting((params: DocumentFormattingParams): TextEdit[] => {
    connection.console.log('Document formatting requested');
    const document = documents.get(params.textDocument.uri);
    if (!document) {
        connection.console.log('Document not found');
        return [];
    }
    return service.format(document.getText(), {
        tabSize: params.options.tabSize,
        insertSpaces: params.options.insertSpaces
    });
});

// Make the text document manager listen on the connection
documents.listen(connection);

// Listen on the connection
connection.listen();
