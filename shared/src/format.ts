/**
 * Document formatting for Jyro
 *
 * The formatter works on Jyro's tokens and keeps every line break where it
 * is: in Jyro a line end can end a statement, so moving one could change
 * what a script means. It sets each line's indentation from the blocks and
 * brackets open at its start, and the spaces between the tokens on it.
 * Comments and the text of strings are kept as written.
 */

import { lex, RESERVED_KEYWORDS, type Token } from './lexer';
import { parse } from './parser';
import type { FormattingOptions } from './types';

/** A block or bracket that is open, and the line it was opened on */
interface Frame {
    kind: 'block' | 'switch' | 'case' | 'bracket';
    line: number;
}

const BLOCK_STARTS: ReadonlySet<string> = new Set(['if', 'while', 'for', 'foreach', 'func', 'union']);
const SWITCHES: ReadonlySet<string> = new Set(['switch', 'match']);
const OPENERS: ReadonlySet<string> = new Set(['(', '[', '{']);
const CLOSERS: ReadonlySet<string> = new Set([')', ']', '}']);
const VALUE_KEYWORDS: ReadonlySet<string> = new Set(['true', 'false', 'null']);

/** Operators that, first on a line, continue the expression of the line before */
const CONTINUING_OPS: ReadonlySet<string> = new Set([
    '.', '?', ':', '??', '&', '+', '-', '*', '/', '%', '==', '!=', '<', '>', '<=', '>=', '=>'
]);
/** Operators that, last on a line, leave its expression to be continued */
const OPEN_ENDED_OPS: ReadonlySet<string> = new Set([
    '?', ':', '??', '&', '+', '-', '*', '/', '%', '==', '!=', '<', '>', '<=', '>=', '=>',
    '=', '+=', '-=', '*=', '/=', '%=', '&='
]);

export function formatJyroDocument(text: string, options: FormattingOptions): string {
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const indentUnit = options.insertSpaces ? ' '.repeat(options.tabSize) : '\t';
    const tokens = lex(text, { stopStringsAtLineEnd: true }).allTokens;
    const { ternaryColons, prefixOperators } = parse(text, { stopStringsAtLineEnd: true });

    // The tokens of each line, and how many line ends come before it
    const lines: Array<{ tokens: Token[]; breaksBefore: number }> = [];
    let previousEnd = text.charCodeAt(0) === 0xFEFF ? 1 : 0;
    for (const t of tokens) {
        const breaks = countLineEnds(text, previousEnd, t.start);
        if (lines.length === 0 || breaks > 0) lines.push({ tokens: [t], breaksBefore: lines.length === 0 ? 0 : breaks });
        else lines[lines.length - 1].tokens.push(t);
        previousEnd = t.end;
    }

    const stack: Frame[] = [];
    const out: string[] = [];
    let previousLast: Token | undefined;

    lines.forEach((line, lineNumber) => {
        for (let b = 1; b < line.breaksBefore; b++) out.push('');

        let depth = depthOf(closeLeading(line.tokens, stack));
        if (line.tokens[0].kind === 'word' && ['else', 'elseif'].includes(line.tokens[0].text) && isKeywordAt(line.tokens[0], undefined, line.tokens[1])) depth--;
        if (continues(line.tokens[0], previousLast)) depth++;

        out.push(indentUnit.repeat(Math.max(depth, 0)) + renderLine(text, line.tokens, ternaryColons, prefixOperators));

        line.tokens.forEach((t, i) => track(t, line.tokens[i - 1], line.tokens[i + 1], stack, lineNumber));
        const code = line.tokens.filter(t => t.kind !== 'comment');
        if (code.length > 0) previousLast = code[code.length - 1];
    });
    const bom = text.charCodeAt(0) === 0xFEFF ? String.fromCharCode(0xFEFF) : '';
    const trailing = /\r?\n[ \t]*$/.test(text) || text === '' ? eol : '';
    return bom + out.join(eol) + (out.length > 0 ? trailing : '');
}

/** The number of line ends (LF, alone or in CRLF) between two offsets */
function countLineEnds(text: string, from: number, to: number): number {
    let n = 0;
    for (let i = from; i < to; i++) if (text[i] === '\n') n++;
    return n;
}

/** Whether a word token is a keyword here, not a name: not after a ".", and not a key before ":" */
function isKeywordAt(t: Token, before: Token | undefined, after: Token | undefined): boolean {
    if (t.kind !== 'word' || !RESERVED_KEYWORDS.has(t.text)) return false;
    if (before?.kind === 'op' && before.text === '.') return false;
    if (after?.kind === 'op' && after.text === ':' && !VALUE_KEYWORDS.has(t.text)) return false;
    return true;
}

/**
 * The indentation of the blocks and brackets open: one level each, but one
 * for all the brackets a line opens, as in Map(items, x => {
 */
function depthOf(stack: Frame[]): number {
    let depth = 0;
    stack.forEach((f, i) => {
        const previous = stack[i - 1];
        if (!(f.kind === 'bracket' && previous?.kind === 'bracket' && previous.line === f.line)) depth++;
    });
    return depth;
}

/** The blocks and brackets still open once a line's first tokens have closed theirs */
function closeLeading(tokens: Token[], stack: Frame[]): Frame[] {
    const open = stack.slice();
    const first = tokens[0];
    const top = () => open[open.length - 1]?.kind;
    if (isKeywordAt(first, undefined, tokens[1])) {
        if (first.text === 'end') {
            if (top() === 'case') open.pop();
            if (top() !== undefined && top() !== 'bracket') open.pop();
        } else if ((first.text === 'case' || first.text === 'default') && top() === 'case') {
            open.pop();
        }
        return open;
    }
    for (let k = 0; k < tokens.length && tokens[k].kind === 'op' && CLOSERS.has(tokens[k].text) && top() === 'bracket'; k++) {
        open.pop();
    }
    return open;
}
/** Whether a line continues the expression of the line before it */
function continues(first: Token, previousLast: Token | undefined): boolean {
    if (first.kind === 'op' && CONTINUING_OPS.has(first.text)) return true;
    if (first.kind === 'word' && (first.text === 'and' || first.text === 'or' || first.text === 'is')) return true;
    if (!previousLast) return false;
    if (previousLast.kind === 'op' && OPEN_ENDED_OPS.has(previousLast.text)) return true;
    return previousLast.kind === 'word' && ['and', 'or', 'not', 'is'].includes(previousLast.text);
}

/** The blocks and brackets a token opens or closes */
function track(t: Token, before: Token | undefined, after: Token | undefined, stack: Frame[], line: number): void {
    const top = () => stack[stack.length - 1]?.kind;
    if (t.kind === 'op') {
        if (OPENERS.has(t.text)) stack.push({ kind: 'bracket', line });
        else if (CLOSERS.has(t.text) && top() === 'bracket') stack.pop();
        return;
    }
    if (!isKeywordAt(t, before, after)) return;
    if (BLOCK_STARTS.has(t.text)) {
        stack.push({ kind: 'block', line });
    } else if (SWITCHES.has(t.text)) {
        stack.push({ kind: 'switch', line });
    } else if (t.text === 'case' || t.text === 'default') {
        if (top() === 'case') stack.pop();
        if (top() === 'switch') stack.push({ kind: 'case', line });
    } else if (t.text === 'end') {
        if (top() === 'case') stack.pop();
        while (stack.length > 0) {
            if (stack.pop()!.kind !== 'bracket') break;
        }
    }
}

/** A value ends here: what follows a value is an operator, not a prefix */
function endsValue(t: Token | undefined): boolean {
    if (!t) return false;
    if (t.kind === 'number' || t.kind === 'string') return true;
    if (t.kind === 'word') return !RESERVED_KEYWORDS.has(t.text) || VALUE_KEYWORDS.has(t.text);
    return t.kind === 'op' && (CLOSERS.has(t.text) || t.text === '++' || t.text === '--');
}

/** A line's tokens with the spaces between them */
function renderLine(text: string, tokens: Token[], ternaryColons: Set<number>, prefixOperators: Set<number>): string {
    let s = '';
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (i > 0) s += gap(text, tokens[i - 1], t, ternaryColons, prefixOperators);
        s += t.kind === 'comment' ? t.text.replace(/\s+$/, '') : t.text;
    }
    return s;
}

function gap(text: string, a: Token, b: Token, ternaryColons: Set<number>, prefixOperators: Set<number>): string {
    const original = text.substring(a.end, b.start);
    if (b.kind === 'comment') return original.length > 0 ? original : ' ';
    if (a.kind === 'unknown' || b.kind === 'unknown') return original;

    const wanted = spacing(a, b, original, ternaryColons, prefixOperators);
    // Never join two tokens into one that reads differently
    if (wanted === '' && !readsApart(a, b)) return ' ';
    return wanted;
}

function spacing(a: Token, b: Token, original: string, ternaryColons: Set<number>, prefixOperators: Set<number>): string {
    const aOp = a.kind === 'op' ? a.text : '';
    const bOp = b.kind === 'op' ? b.text : '';

    // Punctuation
    if (bOp === ',' || bOp === ')' || bOp === ']' || bOp === '.' || aOp === '.') return '';
    if (aOp === '(' || aOp === '[') return '';
    if (aOp === ',') return ' ';
    // Inside an object's braces, a space or none, as the author wrote it
    if (aOp === '{' || bOp === '}') return original.length > 0 && !(aOp === '{' && bOp === '}') ? ' ' : '';

    // A colon: an operator in a ternary, otherwise after a key, a named argument's name or a typed name
    if (bOp === ':') return ternaryColons.has(b.start) ? ' ' : '';
    if (aOp === ':') return ' ';

    // A prefix operator is written against its operand
    if (prefixOperators.has(a.start)) return '';
    if ((bOp === '++' || bOp === '--') && !prefixOperators.has(b.start)) return '';

    // A call's or an index's bracket follows its target directly
    if (bOp === '(') return a.kind === 'word' && !RESERVED_KEYWORDS.has(a.text) ? '' : ' ';
    if (bOp === '[') return endsValue(a) && !(aOp === '++' || aOp === '--') ? '' : ' ';

    // Every other operator, keyword, name and literal stands apart
    return ' ';
}

/** Whether two tokens written together are still read as the same two tokens */
function readsApart(a: Token, b: Token): boolean {
    const joined = lex(a.text + b.text).tokens;
    return joined.length === 3 && joined[0].text === a.text && joined[1].text === b.text;
}
