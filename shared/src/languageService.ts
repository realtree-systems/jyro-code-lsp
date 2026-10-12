/**
 * Jyro Language Service
 *
 * The editor features, worked out from a document's text alone: no LSP
 * connection, no file system, nothing Node-only. The VS Code server wraps it
 * in the Language Server Protocol; jyro.dev registers it with Monaco.
 */

import { DocumentAnalyzer, type DeclarationInfo, type ParamInfo } from './documentAnalyzer';
import { formatJyroDocument } from './format';
import { KEYWORDS, KEYWORD_DOCS, TYPE_KEYWORDS } from './keywords';
import { lex, type Token } from './lexer';
import { firstSentence, STDLIB_FUNCTIONS, type FunctionSignature } from './stdlib';
import { TextIndex } from './text';
import {
    CompletionItemKind,
    InsertTextFormat,
    type CompletionItem,
    type Diagnostic,
    type FormattingOptions,
    type Hover,
    type ParameterInformation,
    type Position,
    type Range,
    type SignatureHelp,
    type TextEdit
} from './types';

export interface ValidationOptions {
    /** Show informational messages when non-standard host functions are referenced */
    warnOnHostFunctions: boolean;
}

/** A parameter as signature help and named-argument completion show it */
interface CallParameter extends ParamInfo {
    optional?: boolean;
    documentation?: string;
}

/** The call an offset is in: its function's name, and the arguments before the offset */
interface CallContext {
    name: string;
    /** The offset of the call's "(" */
    open: number;
    /** The index of the argument the offset is in */
    argumentIndex: number;
    /** The names of the named arguments given, in order, and the one the offset is in */
    namedArgs: string[];
    currentName?: string;
    /** Whether the call's arguments are named (or it has none yet) */
    named: boolean;
    empty: boolean;
}

export class JyroLanguageService {
    // Merged function registry: stdlib + host functions
    private functions: FunctionSignature[] = [...STDLIB_FUNCTIONS];
    private hostFunctions: FunctionSignature[] = [];

    constructor(hostFunctions: FunctionSignature[] = []) {
        this.setHostFunctions(hostFunctions);
    }

    /** Functions the host adds to the standard library */
    setHostFunctions(hostFunctions: FunctionSignature[]): void {
        this.hostFunctions = (hostFunctions || []).map(f => ({ ...f, parameters: f.parameters ?? [] }));
        const hostNames = new Set(this.hostFunctions.map(f => f.name));
        this.functions = [...STDLIB_FUNCTIONS.filter(f => !hostNames.has(f.name)), ...this.hostFunctions];
    }

    /** A standard library or host function by its name, which is case-sensitive */
    getFunction(name: string): FunctionSignature | undefined {
        return this.functions.find(f => f.name === name);
    }

    private analyzer(text: string, warnOnHostFunctions = true): DocumentAnalyzer {
        return new DocumentAnalyzer(text, { warnOnHostFunctions, hostFunctions: this.hostFunctions });
    }

    validate(text: string, options: ValidationOptions = { warnOnHostFunctions: true }): Diagnostic[] {
        return this.analyzer(text, options.warnOnHostFunctions).analyze();
    }

    complete(text: string, position: Position): CompletionItem[] {
        const offset = new TextIndex(text).offsetAt(position);
        const tokens = lex(text).allTokens;
        if (insideCommentOrString(tokens, offset)) return [];

        const analyzer = this.analyzer(text);

        // After a dot: the properties the script uses on the same path
        const wordStart = startOfWord(text, offset);
        if (text[wordStart - 1] === '.') {
            return this.propertyCompletions(analyzer, text, wordStart - 1);
        }

        const completions: CompletionItem[] = [];

        KEYWORDS.forEach(keyword => {
            completions.push({
                label: keyword,
                kind: CompletionItemKind.Keyword,
                data: { type: 'keyword', value: keyword }
            });
        });

        TYPE_KEYWORDS.forEach(type => {
            completions.push({
                label: type,
                kind: CompletionItemKind.TypeParameter,
                data: { type: 'type', value: type }
            });
        });

        // Standard library and host functions
        this.functions.forEach(func => {
            completions.push({
                label: func.name,
                kind: CompletionItemKind.Function,
                detail: signatureLabel(func),
                documentation: firstSentence(func.description),
                insertText: `${func.name}($1)`,
                insertTextFormat: InsertTextFormat.Snippet,
                data: { type: 'function', name: func.name }
            });
        });

        completions.push({
            label: 'Input',
            kind: CompletionItemKind.Variable,
            detail: 'Script input (read-only)',
            documentation: 'The input the host gives the script. It can be read anywhere, and changed nowhere.',
            data: { type: 'input' }
        });
        if (analyzer.isOutputAccessible(offset)) {
            completions.push({
                label: 'Output',
                kind: CompletionItemKind.Variable,
                detail: 'Script output',
                documentation: 'The output the script gives back to the host. It cannot be used inside a function or a lambda.',
                data: { type: 'output' }
            });
        }

        // The script's own names that can be used here
        const userFunctions = analyzer.getUserFunctions();
        const variants = analyzer.getVariantConstructors();
        for (const d of analyzer.getVisibleDeclarations(offset)) {
            if (d.kind === 'function') {
                const userFunc = userFunctions.get(d.name);
                completions.push({
                    label: d.name,
                    kind: CompletionItemKind.Function,
                    detail: `func ${d.name}(${userFunc ? userFunc.params.map(formatParam).join(', ') : ''})`,
                    documentation: 'User-defined function',
                    insertText: `${d.name}($1)`,
                    insertTextFormat: InsertTextFormat.Snippet,
                    data: { type: 'user-function', name: d.name }
                });
            } else if (d.kind === 'constructor') {
                const variant = variants.get(d.name);
                completions.push({
                    label: d.name,
                    kind: CompletionItemKind.Constructor,
                    detail: `${d.name}(${variant ? variant.fields.map(formatParam).join(', ') : ''})`,
                    documentation: variant ? `Variant constructor of union ${variant.unionName}` : 'Variant constructor',
                    insertText: `${d.name}($1)`,
                    insertTextFormat: InsertTextFormat.Snippet,
                    data: { type: 'variant-constructor', name: d.name }
                });
            } else if (d.kind === 'union') {
                completions.push({
                    label: d.name,
                    kind: CompletionItemKind.Enum,
                    detail: `union ${d.name}`,
                    documentation: 'Discriminated union type',
                    data: { type: 'union', name: d.name }
                });
            } else {
                completions.push({
                    label: d.name,
                    kind: CompletionItemKind.Variable,
                    detail: declarationDetail(d),
                    data: { type: 'variable', name: d.name }
                });
            }
        }

        // Inside a call's parentheses: its parameter names, as named arguments
        const call = findCall(tokens, offset);
        if (call && (call.empty || call.named)) {
            const params = this.callParameters(analyzer, call.name);
            if (params) {
                const used = new Set(call.namedArgs);
                params.forEach((param, idx) => {
                    if (used.has(param.name)) return;
                    completions.push({
                        label: `${param.name}: `,
                        kind: CompletionItemKind.Property,
                        detail: formatParam(param),
                        documentation: param.optional || param.defaultValue
                            ? (param.defaultValue ? `Optional parameter (default: ${param.defaultValue})` : 'Optional parameter')
                            : 'Required parameter',
                        insertText: `${param.name}: $1`,
                        insertTextFormat: InsertTextFormat.Snippet,
                        sortText: `0${String(idx).padStart(3, '0')}`,
                        filterText: param.name,
                        data: { type: 'named-arg', funcName: call.name, paramName: param.name }
                    });
                });
            }
        }

        return completions;
    }

    /** The next names after a dotted path, from the properties the script uses */
    private propertyCompletions(analyzer: DocumentAnalyzer, text: string, dot: number): CompletionItem[] {
        let start = dot;
        while (start > 0 && /[\p{L}\p{Nd}_.]/u.test(text[start - 1])) start--;
        const base = text.substring(start, dot);
        if (!base) return [];
        const names = new Set<string>();
        for (const s of analyzer.getSymbols()) {
            if (s.type === 'property' && s.name.startsWith(base + '.')) {
                names.add(s.name.substring(base.length + 1).split('.')[0]);
            }
        }
        return [...names].map(name => ({
            label: name,
            kind: CompletionItemKind.Property,
            data: { type: 'property', path: `${base}.${name}` }
        }));
    }

    /**
     * Fills in the full documentation of a completion item. Generic so that it
     * takes back the editor's own item type, whose kinds go beyond Jyro's.
     */
    resolveCompletion<T extends Pick<CompletionItem, 'data' | 'documentation'>>(item: T): T {
        if (item.data && item.data.type === 'function') {
            const sig = this.getFunction(item.data.name);
            if (sig) item.documentation = { kind: 'markdown', value: functionMarkdown(sig) };
        }
        return item;
    }

    hover(text: string, position: Position): Hover | null {
        const index = new TextIndex(text);
        const offset = index.offsetAt(position);
        if (insideCommentOrString(lex(text).allTokens, offset, true)) return null;

        const wordRange = getWordRangeAtPosition(index, position);
        if (!wordRange) {
            return null;
        }
        const wordStart = index.offsetAt(wordRange.start);
        const word = text.substring(wordStart, index.offsetAt(wordRange.end));
        const isProperty = text[wordStart - 1] === '.';
        const markdown = (value: string): Hover => ({ contents: { kind: 'markdown', value }, range: wordRange });

        // A property's name is any word, keywords included
        if (isProperty) return null;

        const analyzer = this.analyzer(text);

        // The script's own declarations come before the library's names. A
        // name before "(" is called, so it names a function, not a variable.
        const isCall = /^[ \t]*\(/.test(text.substring(index.offsetAt(wordRange.end)));
        const declaration = analyzer.getVisibleDeclarations(wordStart)
            .find(d => d.name === word && (!isCall || d.kind === 'function' || d.kind === 'constructor'));
        if (declaration) {
            if (declaration.kind === 'function') {
                const userFunc = analyzer.getUserFunctions().get(word);
                const paramList = userFunc ? userFunc.params.map(formatParam).join(', ') : '';
                return markdown(`**${word}**(${paramList})\n\nUser-defined function`);
            }
            if (declaration.kind === 'constructor') {
                const variant = analyzer.getVariantConstructors().get(word);
                const fieldList = variant ? variant.fields.map(formatParam).join(', ') : '';
                return markdown(`**${word}**(${fieldList})\n\nVariant constructor of union \`${variant?.unionName ?? ''}\``);
            }
            if (declaration.kind === 'union') {
                const union = analyzer.getUnionDefinitions().get(word);
                const variants = union ? union.variants.map(v => `- \`${v.name}(${v.fields.map(formatParam).join(', ')})\``).join('\n') : '';
                return markdown(`**union ${word}**\n\n${variants}`);
            }
            return markdown(`\`\`\`jyro\n${declarationDetail(declaration)}\n\`\`\``);
        }

        const funcSig = this.getFunction(word);
        if (funcSig) {
            return markdown(functionMarkdown(funcSig));
        }

        const keyword = KEYWORD_DOCS.find(k => k.word === word);
        if (keyword) {
            return markdown(`**${keyword.word}**\n\n${keyword.desc}`);
        }

        return null;
    }

    signatureHelp(text: string, position: Position): SignatureHelp | null {
        const offset = new TextIndex(text).offsetAt(position);
        const call = findCall(lex(text).allTokens, offset);
        if (!call) return null;

        const analyzer = this.analyzer(text);
        const params = this.callParameters(analyzer, call.name);
        if (!params) return null;

        let documentation: string | undefined;
        const userFunc = analyzer.getUserFunctions().get(call.name);
        const variant = analyzer.getVariantConstructors().get(call.name);
        if (userFunc) documentation = 'User-defined function';
        else if (variant) documentation = `Variant constructor of union ${variant.unionName}`;
        else documentation = this.getFunction(call.name)?.description;

        // Each parameter's label is its place in the signature's
        let label = `${call.name}(`;
        const parameters: ParameterInformation[] = params.map((p, i) => {
            if (i > 0) label += ', ';
            const start = label.length;
            label += formatParam(p);
            return {
                label: [start, start + p.name.length] as [number, number],
                documentation: { kind: 'markdown', value: parameterDocumentation(p) }
            };
        });
        label += ')';

        let activeParameter = Math.min(call.argumentIndex, Math.max(params.length - 1, 0));
        if (call.named && call.currentName !== undefined) {
            const named = params.findIndex(p => p.name === call.currentName);
            if (named >= 0) activeParameter = named;
        }

        return {
            signatures: [{ label, documentation: documentation && { kind: 'markdown', value: documentation }, parameters }],
            activeSignature: 0,
            activeParameter
        };
    }

    /** The parameters of the function a call names: the script's own, a variant's, or the library's */
    private callParameters(analyzer: DocumentAnalyzer, name: string): CallParameter[] | null {
        const userFunc = analyzer.getUserFunctions().get(name);
        if (userFunc) {
            return userFunc.params.map(p => ({ ...p, optional: p.defaultValue !== undefined, documentation: p.type ? `Type: ${p.type}` : 'Any type' }));
        }
        const variant = analyzer.getVariantConstructors().get(name);
        if (variant) {
            return variant.fields.map(f => ({ ...f, documentation: f.type ? `Type: ${f.type}` : 'Any type' }));
        }
        const func = this.getFunction(name);
        if (func) {
            return func.parameters.map(p => ({
                name: p.name,
                type: typeText(p.type),
                optional: p.optional,
                defaultValue: p.defaultValue,
                documentation: p.description
            }));
        }
        return null;
    }

    /** Where the symbol at the position is declared, in the same document */
    definition(text: string, position: Position): Range | null {
        const index = new TextIndex(text);
        const wordRange = getWordRangeAtPosition(index, position);
        if (!wordRange) return null;
        const wordStart = index.offsetAt(wordRange.start);
        const wordEnd = index.offsetAt(wordRange.end);
        const word = text.substring(wordStart, wordEnd);
        const analyzer = this.analyzer(text);

        // A property: the first assignment of its path, or of the path up to it
        if (text[wordStart - 1] === '.') {
            let start = wordStart;
            while (start > 0 && /[\p{L}\p{Nd}_.]/u.test(text[start - 1])) start--;
            const path = text.substring(start, wordEnd);
            const symbol = analyzer.getSymbols().find(s => s.type === 'property' && s.name === path);
            if (!symbol) return null;
            return {
                start: { line: symbol.line, character: symbol.character },
                end: { line: symbol.line, character: symbol.character + symbol.name.length }
            };
        }

        const declaration = analyzer.findDeclaration(word, wordStart);
        if (!declaration) return null;
        return { start: index.positionAt(declaration.start), end: index.positionAt(declaration.end) };
    }

    /** A single edit that replaces the whole document with its formatted text */
    format(text: string, options: FormattingOptions): TextEdit[] {
        return [{
            range: new TextIndex(text).fullRange(),
            newText: formatJyroDocument(text, options)
        }];
    }
}

function typeText(type: string | string[]): string {
    return Array.isArray(type) ? type.join(' | ') : type;
}

// "name: type = default", leaving out what is not there
function formatParam(p: ParamInfo & { optional?: boolean }): string {
    let s = p.name;
    if (p.optional && !p.defaultValue) s += '?';
    if (p.type) s += `: ${p.type}`;
    if (p.defaultValue) s += ` = ${p.defaultValue}`;
    return s;
}

function signatureLabel(f: FunctionSignature): string {
    const params = f.parameters.map(p => formatParam({ name: p.name, type: typeText(p.type), optional: p.optional, defaultValue: p.defaultValue }));
    return `${f.name}(${params.join(', ')}): ${typeText(f.returnType)}`;
}

function parameterDocumentation(p: CallParameter): string {
    const doc = p.documentation ?? '';
    if (p.defaultValue) return `${doc} (optional, default: ${p.defaultValue})`;
    if (p.optional && !/left out|optional/i.test(doc)) return `${doc} (optional)`;
    return doc;
}

const EFFECT_NOTES: Record<string, string> = {
    NonDeterministic: 'Not pure: a call can give a different result each time.',
    Blocking: 'Blocking: a call pauses the script.',
    Mutating: 'Mutating: a call reads or changes shared state.'
};

/** A function's documentation, for hover and completion */
function functionMarkdown(f: FunctionSignature): string {
    const lines = [
        '```jyro',
        signatureLabel(f),
        '```',
        f.description,
        '',
        `*${f.category} function*`
    ];
    if (f.effect && EFFECT_NOTES[f.effect]) lines.push('', `*${EFFECT_NOTES[f.effect]}*`);
    if (f.parameters.length > 0) {
        lines.push('', '**Parameters**', '');
        for (const p of f.parameters) {
            const optional = p.optional ? ' *(optional)*' : '';
            const type = f.returns === undefined ? ` (${typeText(p.type)})` : '';
            lines.push(`- \`${p.name}\`${type}${optional}: ${p.description}`);
        }
    }
    lines.push('', `**Returns** ${f.returns ?? typeText(f.returnType)}`);
    if (f.remarks) lines.push('', f.remarks);
    const examples = [
        ...(f.exampleText ?? []).map(e => `- ${e}`),
        ...(f.examples ?? []).map(e => `\`\`\`jyro\n${e}\n\`\`\``)
    ];
    if (examples.length > 0) lines.push('', '**Examples**', '', ...examples);
    return lines.join('\n');
}

/** "name: type" as a declaration of it would read */
function declarationDetail(d: DeclarationInfo): string {
    const what: Record<string, string> = {
        variable: 'var',
        parameter: '(parameter)',
        iterator: '(loop variable)',
        'lambda-param': '(lambda parameter)',
        'match-binding': '(match binding)'
    };
    const type = d.type && d.type !== d.kind ? `: ${d.type}` : '';
    return `${what[d.kind] ?? ''} ${d.name}${type}`.trim();
}

/** Whether an offset is inside a comment or a string, where code completion has nothing to offer */
function insideCommentOrString(tokens: Token[], offset: number, inclusiveStart = false): boolean {
    for (const t of tokens) {
        if (t.start > offset) break;
        if (t.kind !== 'comment' && t.kind !== 'string') continue;
        const closed = t.kind === 'string' && t.text.length > 1 && t.text[t.text.length - 1] === t.text[0];
        const after = inclusiveStart ? t.start <= offset : t.start < offset;
        if (after && (offset < t.end || (offset === t.end && !closed))) return true;
    }
    return false;
}

/** The offset where the word that ends at an offset starts */
function startOfWord(text: string, offset: number): number {
    let start = offset;
    while (start > 0 && /[\p{L}\p{Nd}_]/u.test(text[start - 1])) start--;
    return start;
}

/**
 * The call whose parentheses an offset is in: the innermost "(" before the
 * offset that is not closed before it, written straight after a name on the
 * same line
 */
function findCall(tokens: Token[], offset: number): CallContext | null {
    const before = tokens.filter(t => t.kind !== 'comment' && t.end <= offset);
    const stack: number[] = [];
    for (let i = 0; i < before.length; i++) {
        const t = before[i];
        if (t.kind !== 'op') continue;
        if (t.text === '(' || t.text === '[' || t.text === '{') stack.push(i);
        else if ((t.text === ')' || t.text === ']' || t.text === '}') && stack.length > 0) stack.pop();
    }
    for (let s = stack.length - 1; s >= 0; s--) {
        const openIndex = stack[s];
        const open = before[openIndex];
        if (open.text !== '(') return null;
        const callee = before[openIndex - 1];
        if (!callee || callee.kind !== 'word' || open.newline) continue;

        let argumentIndex = 0;
        let depth = 0;
        const namedArgs: string[] = [];
        let currentName: string | undefined;
        let argStart = openIndex + 1;
        for (let i = openIndex + 1; i < before.length; i++) {
            const t = before[i];
            if (t.kind === 'op' && (t.text === '(' || t.text === '[' || t.text === '{')) depth++;
            else if (t.kind === 'op' && (t.text === ')' || t.text === ']' || t.text === '}')) depth--;
            else if (depth === 0 && t.kind === 'op' && t.text === ',') {
                argumentIndex++;
                argStart = i + 1;
                currentName = undefined;
            } else if (depth === 0 && i === argStart && t.kind === 'word' && before[i + 1]?.kind === 'op' && before[i + 1].text === ':') {
                namedArgs.push(t.text);
                currentName = t.text;
            }
        }
        const empty = before.length === openIndex + 1;
        const firstArg = before[openIndex + 1];
        const named = empty || (firstArg?.kind === 'word' && before[openIndex + 2]?.kind === 'op' && before[openIndex + 2].text === ':');
        return { name: callee.text, open: open.start, argumentIndex, namedArgs, currentName, named, empty };
    }
    return null;
}

// Helper function to get word range at position
function getWordRangeAtPosition(index: TextIndex, position: Position): Range | null {
    const text = index.text;
    const offset = index.offsetAt(position);

    let start = offset;
    let end = offset;
    while (start > 0 && /[\p{L}\p{Nd}_]/u.test(text[start - 1])) {
        start--;
    }
    while (end < text.length && /[\p{L}\p{Nd}_]/u.test(text[end])) {
        end++;
    }

    if (start === end) {
        return null;
    }

    return {
        start: index.positionAt(start),
        end: index.positionAt(end)
    };
}
