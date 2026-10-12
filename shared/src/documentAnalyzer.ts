/**
 * Document Analyzer
 *
 * Parses a Jyro document as Jyro's compiler does, reports what the compiler
 * would report before running it, and gives the document's declarations and
 * where each can be seen.
 */

import { codeText, messageText } from './messages';
import { parse, type Expr, type ParseResult, type Span } from './parser';
import { STDLIB_FUNCTIONS, type FunctionSignature } from './stdlib';
import { TextIndex } from './text';
import { DiagnosticSeverity, DiagnosticTag, type Diagnostic } from './types';
import { forEachExprDeep, validate, type CallableSignature, type Declaration, type Finding, type ScopeInfo, type ValidationResult } from './validator';

export interface SymbolInfo {
    name: string;
    type?: string;
    line: number;
    character: number;
}

export interface AnalyzerOptions {
    warnOnHostFunctions: boolean;
    /** The functions the host adds to the standard library */
    hostFunctions?: ReadonlyArray<Pick<FunctionSignature, 'name' | 'parameters'>>;
}

export interface ParamInfo {
    name: string;
    type?: string;
    defaultValue?: string;
}

export interface UserFunctionInfo {
    name: string;
    params: ParamInfo[];
    line: number;
    character: number;
}

export interface UnionInfo {
    name: string;
    variants: Array<{ name: string; fields: ParamInfo[] }>;
    line: number;
}

export interface VariantConstructorInfo {
    variantName: string;
    unionName: string;
    fields: ParamInfo[];
}

/** A name the script declares, with where it is declared */
export interface DeclarationInfo extends SymbolInfo {
    kind: Declaration['kind'] | 'function' | 'union' | 'constructor';
    /** Its declaration's range, as offsets */
    start: number;
    end: number;
}

const SEVERITY = {
    error: DiagnosticSeverity.Error,
    warning: DiagnosticSeverity.Warning,
    information: DiagnosticSeverity.Information,
    hint: DiagnosticSeverity.Hint
} as const;

export class DocumentAnalyzer {
    private readonly text: string;
    private readonly index: TextIndex;
    private readonly options: AnalyzerOptions;
    private parsed?: ParseResult;
    private validated?: ValidationResult;
    private symbols?: SymbolInfo[];
    private userFunctions?: Map<string, UserFunctionInfo>;
    private unionDefinitions?: Map<string, UnionInfo>;
    private variantConstructors?: Map<string, VariantConstructorInfo>;

    constructor(text: string, options: AnalyzerOptions = { warnOnHostFunctions: true }) {
        this.text = text;
        this.index = new TextIndex(text);
        this.options = options;
    }

    /** The document parsed for its declarations: a string with no closing quote ends at its line's end */
    private get parseResult(): ParseResult {
        this.parsed ??= parse(this.text, { stopStringsAtLineEnd: true });
        return this.parsed;
    }

    /** The document parsed as Jyro parses it, for its errors */
    private get compilerParse(): ParseResult {
        const recovered = this.parseResult;
        return recovered.lexicalErrors.some(e => e.code === 1200) ? parse(this.text) : recovered;
    }

    private get validation(): ValidationResult {
        if (!this.validated) {
            // The standard library and the host's functions, a host function
            // taking the place of a standard library one of its name
            const registered = new Map<string, CallableSignature>();
            for (const f of [...STDLIB_FUNCTIONS, ...(this.options.hostFunctions ?? [])]) registered.set(f.name, f);
            this.validated = validate(this.parseResult.statements, this.text.length, {
                registered: [...registered.values()],
                warnOnHostFunctions: this.options.warnOnHostFunctions
            });
        }
        return this.validated;
    }

    /**
     * Analyze the document and return diagnostics: every lexical error, the
     * first syntax error, and the checks of Jyro's validator and linker
     */
    public analyze(): Diagnostic[] {
        const { lexicalErrors, syntaxError } = this.compilerParse;
        const findings: Finding[] = [];
        for (const e of lexicalErrors) {
            // A string with no closing quote runs to the end of the text; it is marked to the end of its line
            let end = e.end;
            if (e.code === 1200) {
                const lineEnd = this.text.indexOf('\n', e.start);
                if (lineEnd >= 0) end = Math.min(end, this.text[lineEnd - 1] === '\r' ? lineEnd - 1 : lineEnd);
            }
            findings.push({ code: e.code, args: e.arg !== undefined ? [e.arg] : [], severity: 'error', start: e.start, end });
        }
        if (syntaxError) {
            findings.push({ code: syntaxError.code, args: syntaxError.token !== undefined ? [syntaxError.token] : [], severity: 'error', start: syntaxError.start, end: syntaxError.end });
        }
        // Jyro checks a script only once it parses
        if (lexicalErrors.length === 0 && !syntaxError) {
            findings.push(...this.validation.findings);
        }

        findings.sort((a, b) => a.start - b.start);
        const seen = new Set<string>();
        const diagnostics: Diagnostic[] = [];
        for (const f of findings) {
            const message = f.code !== undefined ? messageText(f.code, f.args) : f.message ?? '';
            const key = `${f.code}|${f.start}|${f.end}|${message}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const diagnostic: Diagnostic = {
                severity: SEVERITY[f.severity],
                range: { start: this.index.positionAt(f.start), end: this.index.positionAt(f.end) },
                message,
                source: 'jyro'
            };
            if (f.code !== undefined) diagnostic.code = codeText(f.code);
            if (f.unnecessary) diagnostic.tags = [DiagnosticTag.Unnecessary];
            diagnostics.push(diagnostic);
        }
        return diagnostics;
    }

    /**
     * Every name the document declares, and the first assignment of each
     * property path (Output.total), which go to definition takes as its
     * declaration
     */
    public getSymbols(): SymbolInfo[] {
        if (this.symbols) return this.symbols;
        const symbols: SymbolInfo[] = this.globalDeclarations().map(stripDeclaration);
        for (const scope of this.validation.scopes) {
            for (const d of scope.declarations) symbols.push(stripDeclaration(this.declarationInfo(d)));
        }
        const seenPaths = new Set<string>();
        forEachExprDeep(this.parseResult.statements, e => {
            if (e.kind !== 'property') return;
            const path = dottedPath(e);
            if (path === undefined || seenPaths.has(path)) return;
            seenPaths.add(path);
            symbols.push({ name: path, type: 'property', ...this.index.positionAt(e.start) });
        });
        this.symbols = symbols;
        return symbols;
    }

    /** The names that can be used at an offset, the nearest declaration of each name first */
    public getVisibleDeclarations(offset: number): DeclarationInfo[] {
        const result: DeclarationInfo[] = [];
        const seen = new Set<string>();
        for (let scope: ScopeInfo | undefined = this.scopeAt(offset); scope; scope = scope.isFunction ? undefined : scope.parent) {
            for (const d of [...scope.declarations].reverse()) {
                if (d.visibleFrom > offset || seen.has(d.name)) continue;
                seen.add(d.name);
                result.push(this.declarationInfo(d));
            }
        }
        for (const g of this.globalDeclarations()) {
            if (!seen.has(g.name)) {
                seen.add(g.name);
                result.push(g);
            }
        }
        return result;
    }

    /** Whether Output can be used at an offset: not in a function or lambda body */
    public isOutputAccessible(offset: number): boolean {
        return !this.scopeAt(offset).hidesOutput;
    }

    /** The declaration a name at an offset refers to */
    public findDeclaration(name: string, offset: number): DeclarationInfo | undefined {
        return this.getVisibleDeclarations(offset).find(d => d.name === name);
    }

    /** Functions, unions and variant constructors, which every part of a script can name */
    private globalDeclarations(): DeclarationInfo[] {
        const result: DeclarationInfo[] = [];
        for (const s of this.parseResult.statements) {
            if (s.kind === 'func') {
                result.push(this.info(s.name.name, 'function', s.name));
            } else if (s.kind === 'union') {
                result.push(this.info(s.name.name, 'union', s.name));
                for (const v of s.variants) result.push(this.info(v.name, 'constructor', v));
            }
        }
        return result;
    }

    private info(name: string, kind: DeclarationInfo['kind'], span: Span, type?: string): DeclarationInfo {
        return { name, kind, type: type ?? kind, start: span.start, end: span.end, ...this.index.positionAt(span.start) };
    }

    private declarationInfo(d: Declaration): DeclarationInfo {
        return this.info(d.name, d.kind, d.span, d.type ?? d.kind);
    }

    /** The innermost scope an offset is in */
    private scopeAt(offset: number): ScopeInfo {
        let best = this.validation.scopes[0];
        for (const s of this.validation.scopes) {
            if (s.span.start <= offset && offset <= s.span.end && s.span.end - s.span.start <= best.span.end - best.span.start) {
                best = s;
            }
        }
        return best;
    }

    /**
     * Get user-defined functions
     */
    public getUserFunctions(): Map<string, UserFunctionInfo> {
        if (!this.userFunctions) {
            this.userFunctions = new Map();
            for (const s of this.parseResult.statements) {
                if (s.kind !== 'func' || this.userFunctions.has(s.name.name)) continue;
                this.userFunctions.set(s.name.name, {
                    name: s.name.name,
                    params: s.params.map(p => ({
                        name: p.name,
                        type: p.type,
                        defaultValue: p.defaultValue ? this.text.substring(p.defaultValue.outerStart ?? p.defaultValue.start, p.defaultValue.outerEnd ?? p.defaultValue.end) : undefined
                    })),
                    ...this.index.positionAt(s.name.start)
                });
            }
        }
        return this.userFunctions;
    }

    /**
     * Get union definitions
     */
    public getUnionDefinitions(): Map<string, UnionInfo> {
        if (!this.unionDefinitions) {
            this.unionDefinitions = new Map();
            for (const s of this.parseResult.statements) {
                if (s.kind !== 'union' || this.unionDefinitions.has(s.name.name)) continue;
                this.unionDefinitions.set(s.name.name, {
                    name: s.name.name,
                    variants: s.variants.map(v => ({ name: v.name, fields: v.fields.map(f => ({ name: f.name, type: f.type })) })),
                    line: this.index.positionAt(s.name.start).line
                });
            }
        }
        return this.unionDefinitions;
    }

    /**
     * Get variant constructors (maps variant name -> info)
     */
    public getVariantConstructors(): Map<string, VariantConstructorInfo> {
        if (!this.variantConstructors) {
            this.variantConstructors = new Map();
            for (const union of this.getUnionDefinitions().values()) {
                for (const v of union.variants) {
                    if (!this.variantConstructors.has(v.name)) {
                        this.variantConstructors.set(v.name, { variantName: v.name, unionName: union.name, fields: v.fields });
                    }
                }
            }
        }
        return this.variantConstructors;
    }

    /**
     * Parse function call arguments to detect named argument usage.
     * Returns info about each argument including whether it's a named arg.
     * Named args use colon syntax: FuncName(paramName: value)
     */
    parseCallArguments(argsText: string): {
        isNamed: boolean;
        isPositional: boolean;
        isMixed: boolean;
        isEmpty: boolean;
        args: Array<{ name?: string; valueText: string; nameStart: number; nameEnd: number }>;
    } {
        if (!argsText.trim()) {
            return { isNamed: false, isPositional: false, isMixed: false, isEmpty: true, args: [] };
        }

        // Split on commas at depth 0, respecting strings and nesting
        const segments = splitArgsAtDepthZero(argsText);
        const args: Array<{ name?: string; valueText: string; nameStart: number; nameEnd: number }> = [];
        let namedCount = 0;
        let positionalCount = 0;

        for (const seg of segments) {
            const trimmed = seg.text.trim();
            if (!trimmed) continue;

            // A named argument: a name, then a colon that is not a ternary's
            const namedMatch = trimmed.match(/^([\p{L}_][\p{L}\p{Nd}_]*)\s*:/u);
            if (namedMatch && !hasQuestionMarkAtDepthZero(trimmed.substring(0, namedMatch[0].length))) {
                const name = namedMatch[1];
                const nameStart = seg.offset + seg.text.indexOf(name);
                args.push({ name, valueText: trimmed.substring(namedMatch[0].length).trim(), nameStart, nameEnd: nameStart + name.length });
                namedCount++;
                continue;
            }

            args.push({ valueText: trimmed, nameStart: seg.offset, nameEnd: seg.offset });
            positionalCount++;
        }

        return {
            isNamed: namedCount > 0 && positionalCount === 0,
            isPositional: positionalCount > 0 && namedCount === 0,
            isMixed: namedCount > 0 && positionalCount > 0,
            isEmpty: false,
            args
        };
    }
}


function stripDeclaration(d: DeclarationInfo): SymbolInfo {
    return { name: d.name, type: d.type, line: d.line, character: d.character };
}

/** "a.b.c" for a property access on a name, or nothing for any other target */
function dottedPath(e: Expr): string | undefined {
    if (e.kind === 'identifier') return e.name;
    if (e.kind === 'property') {
        const base = dottedPath(e.target);
        return base === undefined ? undefined : `${base}.${e.property.name}`;
    }
    return undefined;
}

/** Split argument text on commas at depth zero (respecting nesting and strings) */
function splitArgsAtDepthZero(text: string): Array<{ text: string; offset: number }> {
    const segments: Array<{ text: string; offset: number }> = [];
    let depth = 0;
    let inString: false | '"' | "'" = false;
    let segStart = 0;

    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (inString) {
            if (char === '\\') i++;
            else if (char === inString) inString = false;
            continue;
        }
        if (char === '"' || char === "'") inString = char;
        else if (char === '(' || char === '[' || char === '{') depth++;
        else if (char === ')' || char === ']' || char === '}') depth--;
        else if (char === ',' && depth === 0) {
            segments.push({ text: text.substring(segStart, i), offset: segStart });
            segStart = i + 1;
        }
    }

    if (segStart < text.length) {
        segments.push({ text: text.substring(segStart), offset: segStart });
    }
    return segments;
}

/** Whether a string contains a ? at depth zero (for ternary detection) */
function hasQuestionMarkAtDepthZero(text: string): boolean {
    let depth = 0;
    let inString: false | '"' | "'" = false;
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (inString) {
            if (char === '\\') i++;
            else if (char === inString) inString = false;
            continue;
        }
        if (char === '"' || char === "'") inString = char;
        else if (char === '(' || char === '[' || char === '{') depth++;
        else if (char === ')' || char === ']' || char === '}') depth--;
        else if (char === '?' && text[i + 1] !== '?' && depth === 0) return true;
    }
    return false;
}
