/**
 * The checks Jyro's compiler makes on a parsed script before it runs: those
 * of its validator (Jyro.Compiler/Validator.fs) and the call checks of its
 * linker (Linker.fs), with the same codes and messages
 *
 * One thing goes beyond the compiler: a call to a function the editor does
 * not know may be one the host provides, so it is a note, not an error.
 *
 * The walk also records each scope and what it declares, which completion and
 * go to definition read.
 */

import type { MessageCode } from './messages';
import { outer, type Block, type Expr, type MatchCase, type MatchExprCase, type Param, type Span, type Stmt, type TypeName, type Variant } from './parser';

/** What the linker needs to know of a function it can call */
export interface CallableSignature {
    name: string;
    parameters: ReadonlyArray<{ name: string; optional?: boolean }>;
}

export interface ValidatorOptions {
    /** The standard library and the host's functions: no script function may take one of their names */
    registered: ReadonlyArray<CallableSignature>;
    /** Note calls to functions the editor does not know, which the host must provide */
    warnOnHostFunctions: boolean;
}

export interface Finding extends Span {
    code?: MessageCode;
    args?: Array<string | number>;
    severity: 'error' | 'warning' | 'information' | 'hint';
    /** A message for a finding with no Jyro code */
    message?: string;
    unnecessary?: boolean;
}

export type DeclarationKind = 'variable' | 'parameter' | 'iterator' | 'lambda-param' | 'match-binding';

export interface Declaration {
    name: string;
    kind: DeclarationKind;
    type?: TypeName;
    /** The name where it is declared */
    span: Span;
    /** The offset from which the name can be used */
    visibleFrom: number;
}

export interface ScopeInfo {
    span: Span;
    parent?: ScopeInfo;
    /** A function body: the scopes around it cannot be seen from inside it */
    isFunction: boolean;
    /** A function or lambda body, where Output cannot be used */
    hidesOutput: boolean;
    declarations: Declaration[];
}

export interface ValidationResult {
    findings: Finding[];
    /** Every scope, the script's own first */
    scopes: ScopeInfo[];
}

let scopeIds = 0;

class Scope {
    readonly variables = new Map<string, Declaration>();
    readonly stringTyped = new Set<string>();
    readonly id = ++scopeIds;
    readonly info: ScopeInfo;
    readonly parent: Scope | undefined;
    readonly inLoop: boolean;

    constructor(info: ScopeInfo, parent: Scope | undefined, inLoop: boolean) {
        this.info = info;
        this.parent = parent;
        this.inLoop = inLoop;
    }

    declare(d: Declaration, isStringTyped = false): void {
        this.variables.set(d.name, d);
        if (isStringTyped) this.stringTyped.add(d.name); else this.stringTyped.delete(d.name);
        this.info.declarations.push(d);
    }

    isDeclared(name: string): boolean {
        return this.declaringScope(name) !== undefined;
    }

    declaringScope(name: string): Scope | undefined {
        if (this.variables.has(name)) return this;
        return this.parent?.declaringScope(name);
    }

    /** Whether the declaration a name resolves to is string-typed (spec 40.2.3) */
    isStringTyped(name: string): boolean {
        if (this.variables.has(name)) return this.stringTyped.has(name);
        return this.parent?.isStringTyped(name) ?? false;
    }
}

export function validate(statements: Stmt[], textLength: number, options: ValidatorOptions): ValidationResult {
    return new Validator(options, textLength).run(statements);
}

class Validator {
    private readonly findings: Finding[] = [];
    private readonly scopes: ScopeInfo[] = [];
    private scope: Scope;
    private readonly definedFunctions = new Set<string>(['Input', 'Output']);
    private readonly unions = new Map<string, Variant[]>();
    private readonly variantToUnion = new Map<string, string>();
    private readonly assignedNames = new Set<string>();
    private readonly registered: Map<string, CallableSignature>;
    private inFunction = false;
    private inLambda = false;
    private nestingDepth = 0;

    private readonly options: ValidatorOptions;

    constructor(options: ValidatorOptions, textLength: number) {
        this.options = options;
        this.registered = new Map(options.registered.map(f => [f.name, f]));
        this.scope = this.newScope({ start: 0, end: textLength }, undefined, false, false, false);
    }

    run(statements: Stmt[]): ValidationResult {
        this.declareUnions(statements);
        statements.forEach(s => this.statement(s));
        this.link(statements);
        this.unreachable(statements);
        return { findings: this.findings, scopes: this.scopes };
    }

    // ----- Scopes and findings -----

    private newScope(span: Span, parent: Scope | undefined, inLoop: boolean, isFunction: boolean, hidesOutput: boolean): Scope {
        const info: ScopeInfo = { span, parent: parent?.info, isFunction, hidesOutput, declarations: [] };
        this.scopes.push(info);
        return new Scope(info, parent, inLoop);
    }

    /** A scope inside the current one */
    private append(span: Span, inLoop = this.scope.inLoop): Scope {
        return this.newScope(span, this.scope, inLoop, false, this.scope.info.hidesOutput);
    }

    private error(code: MessageCode, at: Span, ...args: Array<string | number>): void {
        this.findings.push({ code, args, severity: 'error', start: at.start, end: at.end });
    }

    /** Where a diagnostic about a statement is placed: its head, for a block statement */
    private at(s: Stmt): Span {
        return s.head ?? s;
    }

    /** Input and Output are the host's: no script binds either name */
    private checkBoundNames(names: string[], at: Span): void {
        for (const n of new Set(names)) {
            if (n === 'Input' || n === 'Output') this.error(3103, at, n);
        }
    }

    private withScope(scope: Scope, depth: number, body: () => void): void {
        const savedScope = this.scope;
        const savedDepth = this.nestingDepth;
        this.scope = scope;
        this.nestingDepth = depth;
        body();
        this.scope = savedScope;
        this.nestingDepth = savedDepth;
    }

    private block(b: Block, scope: Scope = this.append(b.span)): void {
        this.withScope(scope, this.nestingDepth + 1, () => b.statements.forEach(s => this.statement(s)));
    }

    // ----- Expressions -----

    private isStringOperand(e: Expr): boolean {
        if (e.kind === 'literal') return e.type === 'string';
        if (e.kind === 'identifier') return this.scope.isStringTyped(e.name);
        return false;
    }

    private expr(e: Expr): void {
        switch (e.kind) {
            case 'identifier':
                if (e.name === 'Output' && (this.inFunction || this.inLambda)) {
                    this.error(3504, e);
                } else if (e.name !== 'Input' && e.name !== 'Output' && !this.scope.isDeclared(e.name)) {
                    this.error(3100, e, e.name);
                }
                break;
            case 'literal':
                break;
            case 'binary':
                this.expr(e.left);
                this.expr(e.right);
                if (e.op === '+' && (this.isStringOperand(e.left) || this.isStringOperand(e.right))) this.error(3301, e);
                break;
            case 'unary':
                this.expr(e.operand);
                break;
            case 'ternary':
                this.expr(e.condition);
                this.expr(e.whenTrue);
                this.expr(e.whenFalse);
                break;
            case 'call':
                e.args.forEach(a => this.expr(a.value));
                break;
            case 'property':
                this.expr(e.target);
                break;
            case 'index':
                this.expr(e.target);
                this.expr(e.index);
                break;
            case 'object':
                e.properties.forEach(p => this.expr(p.value));
                break;
            case 'array':
                e.elements.forEach(x => this.expr(x));
                break;
            case 'lambda': {
                const names = e.params.map(p => p.name);
                this.checkBoundNames(names, e);
                for (const n of repeatedNames(names)) this.error(3502, e, n);
                const scope = this.newScope(outer(e.body), this.scope, this.scope.inLoop, false, true);
                for (const p of e.params) scope.declare({ name: p.name, kind: 'lambda-param', span: p, visibleFrom: p.end });
                const savedLambda = this.inLambda;
                this.inLambda = true;
                this.withScope(scope, this.nestingDepth, () => this.expr(e.body));
                this.inLambda = savedLambda;
                break;
            }
            case 'typeCheck':
                this.expr(e.operand);
                break;
            case 'incDec':
                this.expr(e.operand);
                if (e.operand.kind === 'identifier' && this.isStringOperand(e.operand)) this.error(3301, e);
                if (targetRoot(e.operand) === 'Input') this.error(3508, e);
                else if (!isAssignmentTarget(e.operand) || e.operand.parens > 0) this.error(3204, e);
                break;
            case 'match':
                this.expr(e.subject);
                this.matchCases(e, e.cases, c => {
                    const scope = this.append(outer(c.body));
                    this.bindCase(scope, c);
                    this.withScope(scope, this.nestingDepth, () => this.expr(c.body));
                });
                break;
        }
    }

    // ----- Match -----

    private bindCase(scope: Scope, c: MatchCase | MatchExprCase): void {
        for (const b of c.bindings) scope.declare({ name: b.name, kind: 'match-binding', span: b, visibleFrom: b.end });
    }

    private matchCases<C extends MatchCase | MatchExprCase>(at: Span, cases: C[], body: (c: C) => void): void {
        // The union of a match: that of its first case naming a declared variant
        const unionName = cases.map(c => c.variant.name)
            .filter(n => n !== 'default')
            .map(n => this.variantToUnion.get(n))
            .find(u => u !== undefined);
        const seen = new Set<string>();
        for (const c of cases) {
            this.caseHead(unionName, seen, c);
            body(c);
        }
        if (unionName !== undefined) {
            const variants = this.unions.get(unionName);
            if (variants) {
                const covered = new Set(cases.map(c => c.variant.name).filter(n => n !== 'default'));
                const missing = variants.map(v => v.name).filter(n => !covered.has(n)).sort();
                if (missing.length > 0) this.error(3602, at, unionName, missing.join(' '));
            }
        }
    }

    private caseHead(unionName: string | undefined, seen: Set<string>, c: MatchCase | MatchExprCase): void {
        const at: Span = { start: c.start, end: c.bindings.length > 0 ? c.bindings[c.bindings.length - 1].end + 1 : c.variant.end };
        const variantName = c.variant.name;
        const names = c.bindings.map(b => b.name);
        const variantOf = (filterByUnion: boolean) => {
            const u = this.variantToUnion.get(variantName);
            if (u === undefined || (filterByUnion && unionName !== undefined && u !== unionName)) return undefined;
            return this.unions.get(u)?.find(v => v.name === variantName);
        };
        const checkBindings = () => {
            for (const n of repeatedNames(names)) this.error(3611, at, n, variantName);
        };

        if (variantName === 'default') {
            this.error(3607, at);
            this.checkBoundNames(names, at);
        } else if (seen.has(variantName)) {
            this.error(3603, at, variantName);
            this.checkBoundNames(names, at);
            const v = variantOf(false);
            if (v && v.fields.length === names.length) checkBindings();
        } else {
            seen.add(variantName);
            const v = variantOf(true);
            if (!v) {
                this.error(3606, at, variantName);
                this.checkBoundNames(names, at);
            } else if (v.fields.length !== names.length) {
                this.error(3604, at, variantName, names.length, v.fields.length);
                this.checkBoundNames(names, at);
            } else {
                this.checkBoundNames(names, at);
                checkBindings();
            }
        }
    }

    // ----- Statements -----

    private statement(s: Stmt): void {
        switch (s.kind) {
            case 'var': {
                if (s.init) this.expr(s.init);
                this.checkBoundNames([s.name.name], s);
                if (s.type && s.type !== 'any' && !s.init) this.error(3302, s, s.name.name);
                if (this.scope.variables.has(s.name.name)) {
                    this.error(3101, s, s.name.name);
                } else {
                    const isString = s.type === 'string' || (s.init?.kind === 'literal' && s.init.type === 'string');
                    this.scope.declare({ name: s.name.name, kind: 'variable', type: s.type, span: s.name, visibleFrom: s.end }, isString);
                }
                break;
            }
            case 'assign':
                this.assignment(s);
                break;
            case 'if': {
                this.expr(s.condition);
                this.block(s.then);
                for (const e of s.elseIfs) {
                    this.expr(e.condition);
                    this.block(e.body);
                }
                if (s.else) this.block(s.else);
                break;
            }
            case 'while':
                this.expr(s.condition);
                this.block(s.body, this.append(s.body.span, true));
                break;
            case 'foreach': {
                this.checkBoundNames([s.variable.name], this.at(s));
                this.expr(s.collection);
                const c = s.collection;
                if (c.kind === 'literal' && (c.type === 'null' || c.type === 'number' || c.type === 'boolean')) {
                    this.error(3402, c, c.type);
                }
                const scope = this.append(s.body.span, true);
                scope.declare({ name: s.variable.name, kind: 'iterator', span: s.variable, visibleFrom: s.body.span.start });
                this.block(s.body, scope);
                break;
            }
            case 'for': {
                this.checkBoundNames([s.variable.name], this.at(s));
                this.expr(s.from);
                this.expr(s.to);
                if (s.step) this.expr(s.step);
                const scope = this.append(s.body.span, true);
                scope.declare({ name: s.variable.name, kind: 'iterator', type: 'number', span: s.variable, visibleFrom: s.body.span.start });
                this.block(s.body, scope);
                break;
            }
            case 'switch':
                this.expr(s.subject);
                for (const c of s.cases) {
                    c.values.forEach(v => this.expr(v));
                    this.block(c.body);
                }
                if (s.default) this.block(s.default);
                break;
            case 'func':
                this.funcDef(s);
                break;
            case 'return':
                if (!this.inFunction) this.error(3505, s);
                if (s.value) this.expr(s.value);
                break;
            case 'exit':
            case 'fail':
                if (s.value) this.expr(s.value);
                break;
            case 'break':
            case 'continue':
                if (!this.scope.inLoop) this.error(3400, s, s.kind);
                break;
            case 'delete':
                this.expr(s.target);
                if (targetRoot(s.target) === 'Input') this.error(3508, s);
                else if (!(s.target.kind === 'property' || s.target.kind === 'index') || s.target.parens > 0) this.error(3201, s);
                break;
            case 'expr':
                this.expr(s.expr);
                break;
            case 'union':
                if (this.inFunction) this.error(3605, this.at(s));
                else if (this.nestingDepth > 0) this.error(3600, this.at(s), s.name.name);
                break;
            case 'match':
                this.expr(s.subject);
                this.matchCases(this.at(s), s.cases, c => {
                    const scope = this.append(c.body.span);
                    this.bindCase(scope, c);
                    this.block(c.body, scope);
                });
                break;
        }
    }

    private assignment(s: Extract<Stmt, { kind: 'assign' }>): void {
        const { target, value } = s;
        this.expr(target);
        this.expr(value);
        if (s.op === '+=' && (this.isStringOperand(target) || this.isStringOperand(value))) this.error(3301, s);
        if (s.type && s.op !== '=') this.error(3202, s);

        const grouped = target.parens > 0;
        // The property `prop` of the variable `variable`, named by the scope that declares it
        const propertyKey = (variable: string, prop: string): string | undefined => {
            const owner = this.scope.declaringScope(variable);
            if (owner) return `${owner.id}:${variable}.${prop}`;
            if (variable === 'Output' || variable === 'Input') return `${variable}.${prop}`;
            return undefined;
        };
        let hintedName: string | undefined;
        let propKey: string | undefined;
        let shown = '';
        if (!grouped) {
            if (target.kind === 'identifier') {
                hintedName = target.name;
            } else if (target.kind === 'property' && target.target.kind === 'identifier') {
                propKey = propertyKey(target.target.name, target.property.name);
                shown = `${target.target.name}.${target.property.name}`;
            } else if (target.kind === 'index' && target.target.kind === 'identifier'
                && target.index.kind === 'literal' && target.index.type === 'string') {
                propKey = propertyKey(target.target.name, target.index.text);
                shown = `${target.target.name}.${target.index.text}`;
            }
        }
        if (s.type && hintedName !== undefined && this.scope.isDeclared(hintedName)) {
            this.error(3203, s, hintedName);
        } else if (s.type && propKey !== undefined && this.assignedNames.has(propKey)) {
            this.error(3203, s, shown);
        }
        if (propKey !== undefined) this.assignedNames.add(propKey);

        if (targetRoot(target) === 'Input') this.error(3508, s);
        else if (!isAssignmentTarget(target) || grouped) this.error(3200, s);
    }

    private funcDef(s: Extract<Stmt, { kind: 'func' }>): void {
        const at = this.at(s);
        const name = s.name.name;
        if (this.inFunction) this.error(3501, at);
        else if (this.nestingDepth > 0) this.error(3500, at, name);

        const seen = new Set<string>();
        const reported = new Set<string>();
        for (const p of s.params) {
            if (seen.has(p.name)) {
                if (!reported.has(p.name)) {
                    this.error(3502, at, p.name, name);
                    reported.add(p.name);
                }
            } else {
                if (p.name === 'Input' || p.name === 'Output') this.checkBoundNames([p.name], at);
                seen.add(p.name);
            }
        }

        let lastOptional: string | undefined;
        for (const p of s.params) {
            if (p.defaultValue) lastOptional = p.name;
            else if (lastOptional !== undefined) this.error(3506, at, p.name, lastOptional, name);
        }

        for (const p of s.params) {
            if (p.defaultValue && !isLiteralDefault(p.defaultValue)) this.error(3507, at, p.name, name);
        }

        if (this.registered.has(name)) this.error(4102, at, name);

        if (name === 'Input' || name === 'Output') this.checkBoundNames([name], at);
        else if (this.definedFunctions.has(name)) this.error(4101, at, name);
        else this.definedFunctions.add(name);

        // A function sees its parameters, and nothing of the script around it
        const scope = this.newScope(s.body.span, undefined, false, true, true);
        for (const p of s.params) {
            scope.declare({ name: p.name, kind: 'parameter', type: p.type, span: p, visibleFrom: s.body.span.start }, p.type === 'string');
        }
        const saved = { inFunction: this.inFunction, inLambda: this.inLambda };
        this.inFunction = true;
        this.withScope(scope, 0, () => s.body.statements.forEach(st => this.statement(st)));
        this.inFunction = saved.inFunction;
        this.inLambda = saved.inLambda;
    }

    /** The union pre-pass: each top-level union's checks, and its registration */
    private declareUnions(statements: Stmt[]): void {
        for (const s of statements) {
            if (s.kind !== 'union') continue;
            const at = this.at(s);
            const pairs = new Set<string>();
            for (const v of s.variants) {
                for (const f of repeatedNames(v.fields.map(x => x.name))) {
                    const key = `${f}\u0000${v.name}`;
                    if (!pairs.has(key)) {
                        pairs.add(key);
                        this.error(3610, at, f, v.name);
                    }
                }
            }
            const repeatedUnion = this.unions.has(s.name.name);
            if (repeatedUnion) this.error(3608, at, s.name.name);
            this.checkBoundNames(s.variants.map(v => v.name), at);
            for (const v of new Set(s.variants.filter(v => v.fields.some(f => f.name === '_variant')).map(v => v.name))) {
                this.error(3609, at, v);
            }
            const seenHere = new Set<string>();
            for (const v of s.variants) {
                const existing = this.variantToUnion.get(v.name);
                if (existing !== undefined) this.error(3601, v.span, v.name, existing);
                else if (seenHere.has(v.name)) this.error(3601, v.span, v.name, s.name.name);
                else seenHere.add(v.name);
            }
            if (!repeatedUnion) {
                this.unions.set(s.name.name, s.variants);
                for (const v of s.variants) {
                    if (!this.variantToUnion.has(v.name)) this.variantToUnion.set(v.name, s.name.name);
                }
            }
        }
    }

    // ----- Link -----

    private link(statements: Stmt[]): void {
        const functions = new Map<string, CallableSignature>(this.registered);
        const userFunctions = new Set<string>();
        const variants = new Set<string>();

        for (const s of statements) {
            if (s.kind === 'func') {
                const name = s.name.name;
                if (this.registered.has(name) || userFunctions.has(name)) continue;
                if (variants.has(name)) {
                    this.error(4301, this.at(s), name);
                    continue;
                }
                userFunctions.add(name);
                functions.set(name, signatureOfFunction(name, s.params));
            } else if (s.kind === 'union') {
                for (const v of s.variants) {
                    if (this.registered.has(v.name)) {
                        this.error(4300, this.at(s), v.name);
                    } else if (userFunctions.has(v.name)) {
                        this.error(4301, this.at(s), v.name);
                        if (!variants.has(v.name)) {
                            variants.add(v.name);
                            functions.set(v.name, signatureOfVariant(v));
                        }
                    } else if (!variants.has(v.name)) {
                        variants.add(v.name);
                        functions.set(v.name, signatureOfVariant(v));
                    }
                }
            }
        }

        forEachCall(statements, call => this.checkCall(call, functions.get(call.callee.name)));
    }

    private checkCall(call: Extract<Expr, { kind: 'call' }>, f: CallableSignature | undefined): void {
        const name = call.callee.name;
        const at = call.callee;
        if (!f) {
            if (this.options.warnOnHostFunctions) {
                this.findings.push({
                    severity: 'information',
                    message: `Referenced function "${name}" will need to be made available at runtime`,
                    start: at.start,
                    end: at.end
                });
            }
            return;
        }
        const min = f.parameters.filter(p => !p.optional).length;
        const max = f.parameters.length;
        if (!call.named) {
            const n = call.args.length;
            if (n < min) this.error(4200, at, name, min, n);
            else if (n > max) this.error(4201, at, name, max, n);
            return;
        }
        const provided = call.args.map(a => a.name?.name ?? '');
        for (const d of repeatedNames(provided)) this.error(4202, at, d, name);
        const paramNames = new Set(f.parameters.map(p => p.name));
        for (const u of [...new Set(provided)].filter(p => !paramNames.has(p)).sort()) this.error(4203, at, u, name);
        const providedSet = new Set(provided);
        for (const m of f.parameters.filter(p => !p.optional && !providedSet.has(p.name)).map(p => p.name).sort()) {
            this.error(4204, at, m, name);
        }
    }

    // ----- Unreachable code -----

    /** Statements after a return, fail, exit, break or continue in the same block */
    private unreachable(statements: Stmt[]): void {
        const visit = (list: Stmt[]) => {
            const i = list.findIndex(s => ['return', 'fail', 'exit', 'break', 'continue'].includes(s.kind));
            if (i >= 0 && i < list.length - 1) {
                this.findings.push({
                    severity: 'hint',
                    message: 'Unreachable code',
                    unnecessary: true,
                    start: list[i + 1].start,
                    end: list[list.length - 1].end
                });
            }
            for (const s of list) forEachBlock(s, b => visit(b.statements));
        };
        visit(statements);
    }
}

// ----- Helpers -----

/** The names that occur more than once, each once, in the order their second occurrence is reached */
function repeatedNames(names: string[]): string[] {
    const seen = new Set<string>();
    const reported = new Set<string>();
    const result: string[] = [];
    for (const n of names) {
        if (seen.has(n) && !reported.has(n)) {
            reported.add(n);
            result.push(n);
        }
        seen.add(n);
    }
    return result;
}

function isAssignmentTarget(e: Expr): boolean {
    return e.kind === 'identifier' || e.kind === 'property' || e.kind === 'index';
}

/** The name an assignment or delete target is rooted at: Input.a.b[0] roots at Input */
function targetRoot(e: Expr): string | undefined {
    if (e.kind === 'identifier') return e.name;
    if (e.kind === 'property' || e.kind === 'index') return targetRoot(e.target);
    return undefined;
}

/** A literal, or a minus before a number literal, written without parentheses (spec 80.4.5) */
function isLiteralDefault(e: Expr): boolean {
    if (e.parens > 0) return false;
    if (e.kind === 'literal') return true;
    return e.kind === 'unary' && e.op === '-' && e.operand.kind === 'literal' && e.operand.type === 'number' && e.operand.parens === 0;
}

function signatureOfFunction(name: string, params: Param[]): CallableSignature {
    return { name, parameters: params.map(p => ({ name: p.name, optional: p.defaultValue !== undefined })) };
}

function signatureOfVariant(v: Variant): CallableSignature {
    return { name: v.name, parameters: v.fields.map(f => ({ name: f.name })) };
}

/** Each block a statement holds directly */
export function forEachBlock(s: Stmt, f: (b: Block) => void): void {
    switch (s.kind) {
        case 'if':
            f(s.then);
            s.elseIfs.forEach(e => f(e.body));
            if (s.else) f(s.else);
            break;
        case 'while':
        case 'foreach':
        case 'for':
        case 'func':
            f(s.body);
            break;
        case 'switch':
            s.cases.forEach(c => f(c.body));
            if (s.default) f(s.default);
            break;
        case 'match':
            s.cases.forEach(c => f(c.body));
            break;
    }
}

/** Each expression a statement holds directly */
export function forEachExpr(s: Stmt, f: (e: Expr) => void): void {
    switch (s.kind) {
        case 'var': if (s.init) f(s.init); break;
        case 'assign': f(s.target); f(s.value); break;
        case 'if': f(s.condition); s.elseIfs.forEach(e => f(e.condition)); break;
        case 'while': f(s.condition); break;
        case 'foreach': f(s.collection); break;
        case 'for': f(s.from); f(s.to); if (s.step) f(s.step); break;
        case 'switch': f(s.subject); s.cases.forEach(c => c.values.forEach(f)); break;
        case 'return': case 'fail': case 'exit': if (s.value) f(s.value); break;
        case 'func': s.params.forEach(p => { if (p.defaultValue) f(p.defaultValue); }); break;
        case 'expr': f(s.expr); break;
        case 'match': f(s.subject); break;
        case 'delete': f(s.target); break;
    }
}

/** Each expression an expression holds directly */
export function childExprs(e: Expr): Expr[] {
    switch (e.kind) {
        case 'binary': return [e.left, e.right];
        case 'unary': return [e.operand];
        case 'ternary': return [e.condition, e.whenTrue, e.whenFalse];
        case 'call': return e.args.map(a => a.value);
        case 'property': return [e.target];
        case 'index': return [e.target, e.index];
        case 'object': return e.properties.map(p => p.value);
        case 'array': return e.elements;
        case 'lambda': return [e.body];
        case 'typeCheck': return [e.operand];
        case 'incDec': return [e.operand];
        case 'match': return [e.subject, ...e.cases.map(c => c.body)];
        default: return [];
    }
}

/** Every expression of a list of statements, at any depth */
export function forEachExprDeep(statements: Stmt[], f: (e: Expr) => void): void {
    const visitExpr = (e: Expr) => {
        f(e);
        childExprs(e).forEach(visitExpr);
    };
    const visitStmt = (s: Stmt) => {
        forEachExpr(s, visitExpr);
        forEachBlock(s, b => b.statements.forEach(visitStmt));
    };
    statements.forEach(visitStmt);
}

function forEachCall(statements: Stmt[], f: (call: Extract<Expr, { kind: 'call' }>) => void): void {
    forEachExprDeep(statements, e => {
        if (e.kind === 'call') f(e);
    });
}
