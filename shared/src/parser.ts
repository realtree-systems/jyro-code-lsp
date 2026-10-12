/**
 * Jyro's parser, read as Jyro's own reads a script (Jyro.Parser:
 * ExpressionParser.fs and StatementParser.fs)
 *
 * Jyro stops at the first syntax error. This parser reports that one too,
 * and then carries on from the next line, so that an editor still knows the
 * script's declarations while a line is half typed.
 */

import { lex, RESERVED_KEYWORDS, TYPE_NAMES, type LexicalError, type LexOptions, type Token } from './lexer';

/** A range of offsets into the text: start included, end not */
export interface Span {
    start: number;
    end: number;
}

export type TypeName = 'any' | 'number' | 'string' | 'boolean' | 'object' | 'array' | 'null' | 'function';

export type BinaryOp = '+' | '-' | '*' | '/' | '%' | '&' | '==' | '!=' | '<' | '<=' | '>' | '>=' | 'and' | 'or' | '??';
export type AssignOp = '=' | '+=' | '-=' | '*=' | '/=' | '%=' | '&=';

export interface Name extends Span {
    name: string;
}

interface ExprBase extends Span {
    /** How many pairs of parentheses enclose the node */
    parens: number;
    /** Where the outermost parentheses start and end, when there are any */
    outerStart?: number;
    outerEnd?: number;
}

export interface CallArg {
    name?: Name;
    value: Expr;
}

export interface MatchExprCase extends Span {
    variant: Name;
    bindings: Name[];
    body: Expr;
}

export type Expr = ExprBase & (
    | { kind: 'literal'; type: 'number' | 'string' | 'boolean' | 'null'; text: string }
    | { kind: 'identifier'; name: string }
    | { kind: 'binary'; op: BinaryOp; left: Expr; right: Expr }
    | { kind: 'unary'; op: '-' | 'not'; operand: Expr }
    | { kind: 'ternary'; condition: Expr; whenTrue: Expr; whenFalse: Expr }
    | { kind: 'call'; callee: Name; named: boolean; args: CallArg[]; argsSpan: Span }
    | { kind: 'property'; target: Expr; property: Name }
    | { kind: 'index'; target: Expr; index: Expr }
    | { kind: 'object'; properties: Array<{ key: Name; value: Expr }> }
    | { kind: 'array'; elements: Expr[] }
    | { kind: 'lambda'; params: Name[]; body: Expr }
    | { kind: 'typeCheck'; operand: Expr; type: TypeName; negated: boolean }
    | { kind: 'incDec'; operand: Expr; increment: boolean; prefix: boolean }
    | { kind: 'match'; subject: Expr; cases: MatchExprCase[] }
);

export interface Param extends Name {
    type?: TypeName;
    defaultValue?: Expr;
}

export interface Variant extends Name {
    fields: Array<Name & { type?: TypeName }>;
    /** From the variant's name to the end of its fields */
    span: Span;
}

/** A statement body, and the range it covers: from the end of its head to its closing keyword */
export interface Block {
    statements: Stmt[];
    span: Span;
}

export interface MatchCase extends Span {
    variant: Name;
    bindings: Name[];
    body: Block;
}

interface StmtBase extends Span {
    /** The part of a block statement a diagnostic about the whole statement is placed at */
    head?: Span;
}

export type Stmt = StmtBase & (
    | { kind: 'var'; name: Name; type?: TypeName; init?: Expr }
    | { kind: 'assign'; target: Expr; op: AssignOp; value: Expr; type?: TypeName }
    | { kind: 'if'; condition: Expr; then: Block; elseIfs: Array<{ condition: Expr; body: Block }>; else?: Block }
    | { kind: 'while'; condition: Expr; body: Block }
    | { kind: 'foreach'; variable: Name; collection: Expr; body: Block }
    | { kind: 'for'; variable: Name; from: Expr; to: Expr; step?: Expr; descending: boolean; body: Block }
    | { kind: 'switch'; subject: Expr; cases: Array<{ values: Expr[]; body: Block }>; default?: Block }
    | { kind: 'return' | 'fail' | 'exit'; value?: Expr }
    | { kind: 'func'; name: Name; params: Param[]; body: Block }
    | { kind: 'break' | 'continue' }
    | { kind: 'expr'; expr: Expr }
    | { kind: 'union'; name: Name; variants: Variant[] }
    | { kind: 'match'; subject: Expr; cases: MatchCase[] }
    | { kind: 'delete'; target: Expr }
);

/** A syntax error: Jyro's codes 2000 (unexpected token), 2001 (end of source) and 2003 (call target) */
export interface SyntaxError {
    code: 2000 | 2001 | 2003;
    start: number;
    end: number;
    token?: string;
}

export interface ParseResult {
    statements: Stmt[];
    tokens: Token[];
    lexicalErrors: LexicalError[];
    /** The first syntax error, which is the one Jyro reports */
    syntaxError?: SyntaxError;
    /** Where each ternary's ":" is, which the formatter spaces as an operator */
    ternaryColons: Set<number>;
    /** Where each prefix "-", "++" and "--" is, which the formatter writes against its operand */
    prefixOperators: Set<number>;
}

class ParseFailure {
    readonly error: SyntaxError;

    constructor(error: SyntaxError) {
        this.error = error;
    }
}

const ASSIGN_OPS: ReadonlySet<string> = new Set(['=', '+=', '-=', '*=', '/=', '%=', '&=']);
const BLOCK_BOUNDARIES: ReadonlySet<string> = new Set(['end', 'elseif', 'else', 'case', 'default']);
const STATEMENT_KEYWORDS: ReadonlySet<string> = new Set([
    'var', 'if', 'while', 'for', 'foreach', 'switch', 'match', 'return', 'exit',
    'fail', 'break', 'continue', 'delete', 'func', 'union'
]);
const EXPRESSION_KEYWORDS: ReadonlySet<string> = new Set(['true', 'false', 'null', 'not', 'match']);

export function parse(text: string, options: LexOptions = {}): ParseResult {
    const { tokens, errors } = lex(text, options);
    const parser = new Parser(tokens);
    const statements = parser.program();
    return {
        statements,
        tokens,
        lexicalErrors: errors,
        syntaxError: parser.firstError,
        ternaryColons: parser.ternaryColons,
        prefixOperators: parser.prefixOperators
    };
}

class Parser {
    private pos = 0;
    firstError?: SyntaxError;
    readonly ternaryColons = new Set<number>();
    readonly prefixOperators = new Set<number>();

    private readonly tokens: Token[];

    constructor(tokens: Token[]) {
        this.tokens = tokens;
    }

    // ----- Tokens -----

    private get token(): Token {
        return this.tokens[this.pos];
    }

    private peek(n = 1): Token {
        return this.tokens[Math.min(this.pos + n, this.tokens.length - 1)];
    }

    private get previousEnd(): number {
        return this.pos > 0 ? this.tokens[this.pos - 1].end : 0;
    }

    private advance(): Token {
        const t = this.token;
        if (t.kind !== 'eof') this.pos++;
        return t;
    }

    private isOp(text: string, t: Token = this.token): boolean {
        return t.kind === 'op' && t.text === text;
    }

    private isKeyword(word: string, t: Token = this.token): boolean {
        return t.kind === 'word' && t.text === word;
    }

    private isIdentifier(t: Token = this.token): boolean {
        return t.kind === 'word' && !RESERVED_KEYWORDS.has(t.text);
    }

    private fail(t: Token = this.token): never {
        throw new ParseFailure(unexpected(t));
    }

    private expectOp(text: string): Token {
        if (!this.isOp(text)) this.fail();
        return this.advance();
    }

    private expectKeyword(word: string): Token {
        if (!this.isKeyword(word)) this.fail();
        return this.advance();
    }

    private identifier(): Name {
        if (!this.isIdentifier()) this.fail();
        const t = this.advance();
        return { name: t.text, start: t.start, end: t.end };
    }

    /** A name where a keyword is a name too: a property, a key, a named argument */
    private anyIdentifier(): Name {
        if (this.token.kind !== 'word') this.fail();
        const t = this.advance();
        return { name: t.text, start: t.start, end: t.end };
    }

    private typeName(): TypeName {
        const t = this.token;
        if (t.kind !== 'word' || !TYPE_NAMES.has(t.text)) this.fail();
        this.advance();
        return t.text as TypeName;
    }

    // ----- Statements -----

    program(): Stmt[] {
        const statements = this.blockStatements();
        if (this.token.kind !== 'eof') {
            this.record(new ParseFailure(unexpected(this.token)));
        }
        return statements;
    }

    private record(failure: ParseFailure): void {
        if (!this.firstError) this.firstError = failure.error;
    }

    /** Whether a statement can begin at a token, judged from that token alone */
    private startsStatement(t: Token): boolean {
        switch (t.kind) {
            case 'word':
                return !RESERVED_KEYWORDS.has(t.text) || EXPRESSION_KEYWORDS.has(t.text) || STATEMENT_KEYWORDS.has(t.text);
            case 'number':
            case 'string':
                return true;
            case 'op':
                return ['(', '[', '{', '-', '++', '--'].includes(t.text);
            default:
                return false;
        }
    }

    /**
     * Statements up to the first token that begins none. After a syntax error
     * the rest of the statement is skipped, up to a line that begins a
     * statement or ends a block.
     */
    private blockStatements(): Stmt[] {
        const statements: Stmt[] = [];
        while (this.startsStatement(this.token)) {
            const begin = this.pos;
            try {
                statements.push(this.statement());
            } catch (e) {
                if (!(e instanceof ParseFailure)) throw e;
                this.record(e);
                if (this.pos === begin) this.advance();
                while (this.token.kind !== 'eof' && !(this.token.newline
                    && (this.startsStatement(this.token) || BLOCK_BOUNDARIES.has(this.token.text)))) {
                    this.advance();
                }
            }
        }
        return statements;
    }

    private block(start: number): Block {
        const statements = this.blockStatements();
        return { statements, span: { start, end: this.token.start } };
    }

    private statement(): Stmt {
        const t = this.token;
        if (t.kind === 'word') {
            switch (t.text) {
                case 'func': return this.funcDef();
                case 'union': return this.unionDef();
                case 'var': return this.varDecl();
                case 'if': return this.ifStmt();
                case 'while': return this.whileStmt();
                case 'for': return this.forStmt();
                case 'foreach': return this.foreachStmt();
                case 'switch': return this.switchStmt();
                case 'match': return this.matchStmt();
                case 'return':
                case 'exit':
                case 'fail': return this.terminator(t.text);
                case 'break':
                case 'continue':
                    this.advance();
                    return { kind: t.text as 'break' | 'continue', start: t.start, end: t.end };
                case 'delete': {
                    this.advance();
                    const target = this.expr();
                    return { kind: 'delete', target, start: t.start, end: this.previousEnd };
                }
            }
        }
        return this.assignmentOrExpression();
    }

    private funcDef(): Stmt {
        const start = this.advance().start;
        const name = this.identifier();
        this.expectOp('(');
        const params: Param[] = [];
        if (!this.isOp(')')) {
            do {
                const p: Param = this.identifier();
                if (this.isOp(':')) {
                    this.advance();
                    p.type = this.typeName();
                }
                if (this.isOp('=')) {
                    this.advance();
                    p.defaultValue = this.expr();
                }
                params.push(p);
            } while (this.isOp(',') && this.advance());
        }
        const close = this.expectOp(')');
        const body = this.block(close.end);
        this.expectKeyword('end');
        return { kind: 'func', name, params, body, start, end: this.previousEnd, head: { start, end: close.end } };
    }

    private unionDef(): Stmt {
        const start = this.advance().start;
        const name = this.identifier();
        const variants: Variant[] = [];
        do {
            const variantName = this.identifier();
            const fields: Variant['fields'] = [];
            if (this.isOp('(')) {
                this.advance();
                if (!this.isOp(')')) {
                    do {
                        const field: Name & { type?: TypeName } = this.identifier();
                        if (this.isOp(':')) {
                            this.advance();
                            field.type = this.typeName();
                        }
                        fields.push(field);
                    } while (this.isOp(',') && this.advance());
                }
                this.expectOp(')');
            }
            variants.push({ ...variantName, fields, span: { start: variantName.start, end: this.previousEnd } });
        } while (this.isIdentifier());
        this.expectKeyword('end');
        return { kind: 'union', name, variants, start, end: this.previousEnd, head: { start, end: name.end } };
    }

    private varDecl(): Stmt {
        const start = this.advance().start;
        const name = this.identifier();
        let type: TypeName | undefined;
        let init: Expr | undefined;
        if (this.isOp(':')) {
            this.advance();
            type = this.typeName();
        }
        if (this.isOp('=')) {
            this.advance();
            init = this.expr();
        }
        return { kind: 'var', name, type, init, start, end: this.previousEnd };
    }

    private ifStmt(): Stmt {
        const start = this.advance().start;
        const condition = this.expr();
        const then = this.expectKeyword('then');
        const thenBlock = this.block(then.end);
        const elseIfs: Array<{ condition: Expr; body: Block }> = [];
        while (this.isKeyword('elseif')) {
            this.advance();
            const c = this.expr();
            const t = this.expectKeyword('then');
            elseIfs.push({ condition: c, body: this.block(t.end) });
        }
        let elseBlock: Block | undefined;
        if (this.isKeyword('else')) {
            elseBlock = this.block(this.advance().end);
        }
        this.expectKeyword('end');
        return { kind: 'if', condition, then: thenBlock, elseIfs, else: elseBlock, start, end: this.previousEnd, head: { start, end: then.end } };
    }

    private whileStmt(): Stmt {
        const start = this.advance().start;
        const condition = this.expr();
        const doToken = this.expectKeyword('do');
        const body = this.block(doToken.end);
        this.expectKeyword('end');
        return { kind: 'while', condition, body, start, end: this.previousEnd, head: { start, end: doToken.end } };
    }

    private forStmt(): Stmt {
        const start = this.advance().start;
        const variable = this.identifier();
        this.expectKeyword('in');
        const from = this.expr();
        let descending = false;
        if (this.isKeyword('downto')) {
            descending = true;
            this.advance();
        } else {
            this.expectKeyword('to');
        }
        const to = this.expr();
        let step: Expr | undefined;
        if (this.isKeyword('by')) {
            this.advance();
            step = this.expr();
        }
        const doToken = this.expectKeyword('do');
        const body = this.block(doToken.end);
        this.expectKeyword('end');
        return { kind: 'for', variable, from, to, step, descending, body, start, end: this.previousEnd, head: { start, end: doToken.end } };
    }

    private foreachStmt(): Stmt {
        const start = this.advance().start;
        const variable = this.identifier();
        this.expectKeyword('in');
        const collection = this.expr();
        const doToken = this.expectKeyword('do');
        const body = this.block(doToken.end);
        this.expectKeyword('end');
        return { kind: 'foreach', variable, collection, body, start, end: this.previousEnd, head: { start, end: doToken.end } };
    }

    private switchStmt(): Stmt {
        const start = this.advance().start;
        const subject = this.expr();
        const doToken = this.expectKeyword('do');
        const cases: Array<{ values: Expr[]; body: Block }> = [];
        while (this.isKeyword('case')) {
            this.advance();
            const values = [this.expr()];
            while (this.isOp(',')) {
                this.advance();
                values.push(this.expr());
            }
            const t = this.expectKeyword('then');
            cases.push({ values, body: this.block(t.end) });
        }
        let defaultBlock: Block | undefined;
        if (this.isKeyword('default')) {
            this.advance();
            const t = this.expectKeyword('then');
            defaultBlock = this.block(t.end);
        }
        this.expectKeyword('end');
        return { kind: 'switch', subject, cases, default: defaultBlock, start, end: this.previousEnd, head: { start, end: doToken.end } };
    }

    private matchStmt(): Stmt {
        const start = this.advance().start;
        const subject = this.expr();
        const doToken = this.expectKeyword('do');
        const cases: MatchCase[] = [];
        do {
            const caseStart = this.expectKeyword('case').start;
            // A case names an identifier, which `default` is not
            const variant = this.identifier();
            const bindings = this.bindings();
            const t = this.expectKeyword('then');
            const body = this.block(t.end);
            cases.push({ variant, bindings, body, start: caseStart, end: t.end });
        } while (this.isKeyword('case'));
        this.expectKeyword('end');
        return { kind: 'match', subject, cases, start, end: this.previousEnd, head: { start, end: doToken.end } };
    }

    private bindings(): Name[] {
        const names: Name[] = [];
        if (this.isOp('(')) {
            this.advance();
            if (!this.isOp(')')) {
                do {
                    names.push(this.identifier());
                } while (this.isOp(',') && this.advance());
            }
            this.expectOp(')');
        }
        return names;
    }

    /** return, exit or fail, with a value only when one starts on the same line */
    private terminator(kind: 'return' | 'exit' | 'fail'): Stmt {
        const start = this.advance().start;
        const next = this.token;
        let value: Expr | undefined;
        if (!next.newline && next.kind !== 'eof' && !(next.kind === 'word' && BLOCK_BOUNDARIES.has(next.text))) {
            value = this.expr();
        }
        return { kind, value, start, end: this.previousEnd };
    }

    private assignmentOrExpression(): Stmt {
        const start = this.token.start;
        const target = this.expr();
        let type: TypeName | undefined;
        if (this.isOp(':') && this.peek().kind === 'word' && TYPE_NAMES.has(this.peek().text) && ASSIGN_OPS.has(this.peek(2).text) && this.peek(2).kind === 'op') {
            this.advance();
            type = this.typeName();
        }
        if (this.token.kind === 'op' && ASSIGN_OPS.has(this.token.text)) {
            const op = this.advance().text as AssignOp;
            const value = this.expr();
            return { kind: 'assign', target, op, value, type, start, end: this.previousEnd };
        }
        return { kind: 'expr', expr: target, start, end: this.previousEnd };
    }

    // ----- Expressions -----

    expr(): Expr {
        return this.ternary();
    }

    private ternary(): Expr {
        const condition = this.coalesce();
        if (!this.isOp('?')) return condition;
        this.advance();
        const whenTrue = this.expr();
        this.ternaryColons.add(this.expectOp(':').start);
        const whenFalse = this.expr();
        return { kind: 'ternary', condition, whenTrue, whenFalse, parens: 0, start: outer(condition).start, end: outer(whenFalse).end };
    }

    private coalesce(): Expr {
        const left = this.or();
        if (!this.isOp('??')) return left;
        this.advance();
        const right = this.coalesce();
        return binary('??', left, right);
    }

    private or(): Expr {
        let left = this.and();
        while (this.isKeyword('or')) {
            this.advance();
            left = binary('or', left, this.and());
        }
        return left;
    }

    private and(): Expr {
        let left = this.not();
        while (this.isKeyword('and')) {
            this.advance();
            left = binary('and', left, this.not());
        }
        return left;
    }

    private not(): Expr {
        if (this.isKeyword('not')) {
            const start = this.advance().start;
            const operand = this.not();
            return { kind: 'unary', op: 'not', operand, parens: 0, start, end: outer(operand).end };
        }
        return this.typeCheck();
    }

    private typeCheck(): Expr {
        const operand = this.equality();
        if (!this.isKeyword('is')) return operand;
        this.advance();
        let negated = false;
        if (this.isKeyword('not')) {
            this.advance();
            negated = true;
        }
        const type = this.typeName();
        // A type check is not a name, so a call cannot follow it
        if (this.isOp('(') && !this.token.newline) this.callTargetNotName();
        return { kind: 'typeCheck', operand, type, negated, parens: 0, start: outer(operand).start, end: this.previousEnd };
    }

    private chain(next: () => Expr, ops: readonly string[]): Expr {
        let left = next();
        while (this.token.kind === 'op' && ops.includes(this.token.text)) {
            // "&&" is not "&" twice: the first "&" is where Jyro stops
            if (this.token.text === '&' && this.isOp('&', this.peek()) && this.peek().start === this.token.end) break;
            const op = this.advance().text as BinaryOp;
            left = binary(op, left, next());
        }
        return left;
    }

    private equality(): Expr {
        return this.chain(() => this.relational(), ['==', '!=']);
    }

    private relational(): Expr {
        return this.chain(() => this.concat(), ['<=', '>=', '<', '>']);
    }

    private concat(): Expr {
        return this.chain(() => this.additive(), ['&']);
    }

    private additive(): Expr {
        return this.chain(() => this.multiplicative(), ['+', '-']);
    }

    private multiplicative(): Expr {
        return this.chain(() => this.unary(), ['*', '/', '%']);
    }

    private unary(): Expr {
        const t = this.token;
        if (this.isOp('++') || this.isOp('--')) {
            this.prefixOperators.add(this.advance().start);
            const operand = this.postfix();
            return { kind: 'incDec', operand, increment: t.text === '++', prefix: true, parens: 0, start: t.start, end: outer(operand).end };
        }
        if (this.isOp('-')) {
            this.prefixOperators.add(this.advance().start);
            const operand = this.unary();
            return { kind: 'unary', op: '-', operand, parens: 0, start: t.start, end: outer(operand).end };
        }
        return this.postfix();
    }

    private callTargetNotName(): never {
        const t = this.token;
        throw new ParseFailure({ code: 2003, start: t.start, end: t.end });
    }

    private postfix(): Expr {
        let expr = this.primary();
        // Only a name written without parentheses can be called
        let isName = expr.kind === 'identifier' && expr.parens === 0;
        for (;;) {
            const t = this.token;
            if (this.isOp('(') && !t.newline) {
                if (!isName || expr.kind !== 'identifier') this.callTargetNotName();
                const callee: Name = { name: expr.name, start: expr.start, end: expr.end };
                expr = this.callArgs(callee);
            } else if (this.isOp('.')) {
                this.advance();
                const property = this.anyIdentifier();
                expr = { kind: 'property', target: expr, property, parens: 0, start: outer(expr).start, end: property.end };
            } else if (this.isOp('[') && !t.newline) {
                this.advance();
                const index = this.expr();
                const close = this.expectOp(']');
                expr = { kind: 'index', target: expr, index, parens: 0, start: outer(expr).start, end: close.end };
            } else if ((this.isOp('++') || this.isOp('--')) && !t.newline) {
                this.advance();
                expr = { kind: 'incDec', operand: expr, increment: t.text === '++', prefix: false, parens: 0, start: outer(expr).start, end: t.end };
            } else {
                return expr;
            }
            isName = false;
        }
    }

    private callArgs(callee: Name): Expr {
        const open = this.advance();
        const args: CallArg[] = [];
        // A first argument that begins "name :" makes them all named
        const named = this.token.kind === 'word' && this.isOp(':', this.peek());
        if (named) {
            do {
                const name = this.anyIdentifier();
                this.expectOp(':');
                args.push({ name, value: this.expr() });
            } while (this.isOp(',') && this.advance());
        } else if (!this.isOp(')')) {
            do {
                args.push({ value: this.expr() });
            } while (this.isOp(',') && this.advance());
        }
        const close = this.expectOp(')');
        return { kind: 'call', callee, named, args, argsSpan: { start: open.start, end: close.end }, parens: 0, start: callee.start, end: close.end };
    }

    /** Whether a lambda begins here: its parameters and "=>" */
    private lambdaAhead(): boolean {
        if (this.isIdentifier() && this.isOp('=>', this.peek())) return true;
        if (!this.isOp('(')) return false;
        let n = 1;
        if (this.isOp(')', this.peek(n))) return this.isOp('=>', this.peek(n + 1));
        for (;;) {
            if (!this.isIdentifier(this.peek(n))) return false;
            n++;
            if (this.isOp(')', this.peek(n))) return this.isOp('=>', this.peek(n + 1));
            if (!this.isOp(',', this.peek(n))) return false;
            n++;
        }
    }

    private primary(): Expr {
        const t = this.token;

        if (this.lambdaAhead()) {
            const params: Name[] = [];
            if (this.isOp('(')) {
                this.advance();
                while (!this.isOp(')')) {
                    params.push(this.identifier());
                    if (this.isOp(',')) this.advance();
                }
                this.advance();
            } else {
                params.push(this.identifier());
            }
            this.expectOp('=>');
            const body = this.expr();
            return { kind: 'lambda', params, body, parens: 0, start: t.start, end: outer(body).end };
        }

        switch (t.kind) {
            case 'number':
                this.advance();
                return { kind: 'literal', type: 'number', text: t.text, parens: 0, start: t.start, end: t.end };
            case 'string':
                this.advance();
                return { kind: 'literal', type: 'string', text: t.value ?? '', parens: 0, start: t.start, end: t.end };
            case 'word':
                if (t.text === 'true' || t.text === 'false') {
                    this.advance();
                    return { kind: 'literal', type: 'boolean', text: t.text, parens: 0, start: t.start, end: t.end };
                }
                if (t.text === 'null') {
                    this.advance();
                    return { kind: 'literal', type: 'null', text: t.text, parens: 0, start: t.start, end: t.end };
                }
                if (t.text === 'match') return this.matchExpr();
                if (this.isIdentifier()) {
                    this.advance();
                    return { kind: 'identifier', name: t.text, parens: 0, start: t.start, end: t.end };
                }
                return this.fail();
            case 'op':
                if (t.text === '[') {
                    this.advance();
                    const elements: Expr[] = [];
                    if (!this.isOp(']')) {
                        do {
                            elements.push(this.expr());
                        } while (this.isOp(',') && this.advance());
                    }
                    const close = this.expectOp(']');
                    return { kind: 'array', elements, parens: 0, start: t.start, end: close.end };
                }
                if (t.text === '{') {
                    this.advance();
                    const properties: Array<{ key: Name; value: Expr }> = [];
                    if (!this.isOp('}')) {
                        do {
                            const k = this.token;
                            let key: Name;
                            if (k.kind === 'string') {
                                this.advance();
                                key = { name: k.value ?? '', start: k.start, end: k.end };
                            } else {
                                key = this.anyIdentifier();
                            }
                            this.expectOp(':');
                            properties.push({ key, value: this.expr() });
                        } while (this.isOp(',') && this.advance());
                    }
                    const close = this.expectOp('}');
                    return { kind: 'object', properties, parens: 0, start: t.start, end: close.end };
                }
                if (t.text === '(') {
                    this.advance();
                    const inner = this.expr();
                    this.expectOp(')');
                    // The node keeps its own range; its text runs over the parentheses
                    inner.parens++;
                    inner.outerStart = t.start;
                    inner.outerEnd = this.previousEnd;
                    return inner;
                }
                return this.fail();
            default:
                return this.fail();
        }
    }

    private matchExpr(): Expr {
        const start = this.advance().start;
        const subject = this.expr();
        this.expectKeyword('do');
        const cases: MatchExprCase[] = [];
        do {
            const caseStart = this.expectKeyword('case').start;
            // Any word, so that "case default" parses, for the validator to refuse
            const variant = this.anyIdentifier();
            const bindings = this.bindings();
            this.expectKeyword('then');
            const body = this.expr();
            cases.push({ variant, bindings, body, start: caseStart, end: outer(body).end });
        } while (this.isKeyword('case'));
        this.expectKeyword('end');
        return { kind: 'match', subject, cases, parens: 0, start, end: this.previousEnd };
    }
}

/** The range of an expression's text, its parentheses included */
export function outer(e: Expr): Span {
    return { start: e.outerStart ?? e.start, end: e.outerEnd ?? e.end };
}

/** The syntax error of a token Jyro could read no further at */
function unexpected(t: Token): SyntaxError {
    return t.kind === 'eof'
        ? { code: 2001, start: t.start, end: t.start }
        : { code: 2000, start: t.start, end: t.end, token: t.text };
}

function binary(op: BinaryOp, left: Expr, right: Expr): Expr {
    return { kind: 'binary', op, left, right, parens: 0, start: outer(left).start, end: outer(right).end };
}
