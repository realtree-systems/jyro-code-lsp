/**
 * Shared type definitions for the Jyro language
 *
 * Everything here has to run in a browser as well as in Node: the language
 * service is used by the VS Code server and by the Monaco editor on jyro.dev.
 * So there are no enums (const objects instead, which TypeScript can strip),
 * and the shapes follow the Language Server Protocol, 0-based positions
 * included, so the server can hand them over as they are.
 */

/**
 * Jyro value types
 */
export const JyroType = {
    Null: 'null',
    Number: 'number',
    String: 'string',
    Boolean: 'boolean',
    Object: 'object',
    Array: 'array',
    Function: 'function',
    Any: 'any'
} as const;
export type JyroType = typeof JyroType[keyof typeof JyroType];

/**
 * Symbol kinds in Jyro
 */
export const SymbolKind = {
    Variable: 'variable',
    Function: 'function',
    Parameter: 'parameter',
    Property: 'property'
} as const;
export type SymbolKind = typeof SymbolKind[keyof typeof SymbolKind];

/**
 * Symbol information
 */
export interface Symbol {
    name: string;
    kind: SymbolKind;
    type?: JyroType;
    location: Location;
    scope: string;
}

/**
 * Location in source code
 */
export interface Location {
    uri: string;
    range: Range;
}

/**
 * Range in source code
 */
export interface Range {
    start: Position;
    end: Position;
}

/**
 * Position in source code, 0-based
 */
export interface Position {
    line: number;
    character: number;
}

/**
 * Diagnostic severity, with the LSP's values
 */
export const DiagnosticSeverity = {
    Error: 1,
    Warning: 2,
    Information: 3,
    Hint: 4
} as const;
export type DiagnosticSeverity = typeof DiagnosticSeverity[keyof typeof DiagnosticSeverity];

/**
 * Diagnostic tags, with the LSP's values
 */
export const DiagnosticTag = {
    Unnecessary: 1,
    Deprecated: 2
} as const;
export type DiagnosticTag = typeof DiagnosticTag[keyof typeof DiagnosticTag];

/**
 * Diagnostic message
 */
export interface Diagnostic {
    range: Range;
    severity: DiagnosticSeverity;
    message: string;
    /** Jyro's code, as in JM3100, when the compiler reports the same */
    code?: string | number;
    source?: string;
    tags?: DiagnosticTag[];
}

/**
 * Completion item kinds, with the LSP's values (only the ones Jyro uses)
 */
export const CompletionItemKind = {
    Function: 3,
    Constructor: 4,
    Variable: 6,
    Property: 10,
    Enum: 13,
    Keyword: 14,
    TypeParameter: 25
} as const;
export type CompletionItemKind = typeof CompletionItemKind[keyof typeof CompletionItemKind];

/**
 * Insert text formats, with the LSP's values
 */
export const InsertTextFormat = {
    PlainText: 1,
    Snippet: 2
} as const;
export type InsertTextFormat = typeof InsertTextFormat[keyof typeof InsertTextFormat];

export interface MarkupContent {
    kind: 'plaintext' | 'markdown';
    value: string;
}

export interface CompletionItem {
    label: string;
    kind?: CompletionItemKind;
    detail?: string;
    documentation?: string | MarkupContent;
    insertText?: string;
    insertTextFormat?: InsertTextFormat;
    sortText?: string;
    filterText?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data?: any;
}

export interface Hover {
    contents: MarkupContent;
    range?: Range;
}

export interface ParameterInformation {
    /** The parameter's text, or its start and end offsets in the signature's label */
    label: string | [number, number];
    documentation?: string | MarkupContent;
}

export interface SignatureInformation {
    label: string;
    documentation?: string | MarkupContent;
    parameters?: ParameterInformation[];
}

export interface SignatureHelp {
    signatures: SignatureInformation[];
    activeSignature?: number;
    activeParameter?: number;
}

export interface TextEdit {
    range: Range;
    newText: string;
}

export interface FormattingOptions {
    tabSize: number;
    insertSpaces: boolean;
}
