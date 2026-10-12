/**
 * Jyro's tokens, read as Jyro's lexer reads them (Jyro.Parser/Lexer.fs)
 *
 * Offsets are UTF-16 code units into the text. A line ends at an LF, alone or
 * as the end of a CRLF; a CR alone is white space. Comments are kept as
 * tokens, for the formatter; the parser skips them.
 */

/** The reserved keywords: none of them can name a variable or a function */
export const RESERVED_KEYWORDS: ReadonlySet<string> = new Set([
    'var', 'if', 'then', 'elseif', 'else', 'end', 'switch', 'do', 'case', 'default',
    'while', 'for', 'foreach', 'in', 'return', 'fail', 'break', 'continue',
    'and', 'or', 'not', 'is', 'true', 'false', 'null',
    'number', 'string', 'boolean', 'object', 'array',
    'to', 'downto', 'by', 'func', 'exit',
    'union', 'match', 'delete'
]);

/**
 * The type names of a type hint or an `is` test. `any` and `function` are
 * read as types only there, and stay usable as names everywhere else.
 */
export const TYPE_NAMES: ReadonlySet<string> = new Set([
    'any', 'number', 'string', 'boolean', 'object', 'array', 'null', 'function'
]);

export type TokenKind = 'word' | 'number' | 'string' | 'op' | 'comment' | 'unknown' | 'eof';

export interface Token {
    kind: TokenKind;
    /** The token's text as written */
    text: string;
    start: number;
    end: number;
    /** A line end lies between the token before (comments aside) and this one */
    newline: boolean;
    /** For a string: its value, escapes read */
    value?: string;
}

/** A lexical error: Jyro reports every one of them, beside one syntax error */
export interface LexicalError {
    code: 1200 | 1201 | 2200 | 5918;
    start: number;
    end: number;
    /** What the message names */
    arg?: string | number;
}

export interface LexResult {
    /** The tokens the parser reads: no comments, ending with an eof token */
    tokens: Token[];
    /** Every token, comments included, without the eof token */
    allTokens: Token[];
    errors: LexicalError[];
}

const IDENTIFIER_START = /[\p{L}_]/u;
const IDENTIFIER_CHAR = /[\p{L}\p{Nd}_]/u;
/** White_Space: every code point with that Unicode property */
const WHITE_SPACE = new Set([0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20, 0x85, 0xA0, 0x1680, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000]);
function isWhiteSpace(ch: string): boolean {
    const c = ch.charCodeAt(0);
    return WHITE_SPACE.has(c) || (c >= 0x2000 && c <= 0x200A);
}

// Longest first, so that "==" is read before "="
const OPERATORS = [
    '??', '=>', '==', '!=', '<=', '>=', '+=', '-=', '*=', '/=', '%=', '&=', '++', '--',
    '+', '-', '*', '/', '%', '&', '<', '>', '=', '?', ':', '.', ',', '(', ')', '[', ']', '{', '}'
];

const DECIMAL = /^(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$/;
const HEX = /^0[xX][0-9A-Fa-f]+$/;
const BINARY = /^0[bB][01]+$/;

export function isIdentifierStart(ch: string): boolean {
    return IDENTIFIER_START.test(ch);
}

export function isIdentifierChar(ch: string): boolean {
    return IDENTIFIER_CHAR.test(ch);
}

/** The code point at an offset, as a string of one or two code units */
function codePointAt(text: string, offset: number): string {
    const cp = text.codePointAt(offset);
    return cp === undefined ? '' : String.fromCodePoint(cp);
}

export interface LexOptions {
    /**
     * End a string that has no closing quote at the end of its line, not of
     * the text, so that the lines after it are still read as code
     */
    stopStringsAtLineEnd?: boolean;
}

export function lex(text: string, options: LexOptions = {}): LexResult {
    const tokens: Token[] = [];
    const allTokens: Token[] = [];
    const errors: LexicalError[] = [];
    let i = 0;
    let newline = false;

    // A U+FEFF at the very start is ignored
    if (text.charCodeAt(0) === 0xFEFF) i = 1;

    const push = (token: Token) => {
        allTokens.push(token);
        if (token.kind !== 'comment') {
            tokens.push(token);
            newline = false;
        }
    };

    while (i < text.length) {
        const ch = text[i];

        if (ch === '\n') {
            newline = true;
            i++;
            continue;
        }
        if (isWhiteSpace(ch)) {
            i++;
            continue;
        }

        const start = i;

        if (ch === '#') {
            while (i < text.length && text[i] !== '\n') i++;
            // The CR of a CRLF is not part of the comment's text
            const end = text[i - 1] === '\r' ? i - 1 : i;
            push({ kind: 'comment', text: text.substring(start, end), start, end, newline });
            continue;
        }

        if (ch === '"' || ch === '\'') {
            push(readString(text, start, ch, newline, errors, options.stopStringsAtLineEnd ?? false));
            i = allTokens[allTokens.length - 1].end;
            continue;
        }

        if (ch >= '0' && ch <= '9') {
            i = readNumberToken(text, start);
            const numberText = text.substring(start, i);
            if (!isNumberLiteral(numberText)) {
                errors.push({ code: 2200, start, end: i, arg: numberText });
            }
            push({ kind: 'number', text: numberText, start, end: i, newline });
            continue;
        }

        const cp = codePointAt(text, i);
        if (isIdentifierStart(cp)) {
            i += cp.length;
            while (i < text.length) {
                const next = codePointAt(text, i);
                if (!isIdentifierChar(next)) break;
                i += next.length;
            }
            push({ kind: 'word', text: text.substring(start, i), start, end: i, newline });
            continue;
        }

        const op = OPERATORS.find(o => text.startsWith(o, i));
        if (op) {
            i += op.length;
            push({ kind: 'op', text: op, start, end: i, newline });
            continue;
        }

        i += cp.length || 1;
        push({ kind: 'unknown', text: text.substring(start, i), start, end: i, newline });
    }

    tokens.push({ kind: 'eof', text: '', start: text.length, end: text.length, newline });
    return { tokens, allTokens, errors };
}

/**
 * The end of the number token at `start`: the longest run of identifier
 * characters and dots, with a + or - straight after an e or E unless the
 * token starts 0x or 0b. So 12abc is one token, and 0xE+1 is 0xE then +.
 */
function readNumberToken(text: string, start: number): number {
    const radix = text[start] === '0' && /[xXbB]/.test(text[start + 1] ?? '');
    let i = start;
    let previous = '';
    while (i < text.length) {
        const c = text[i];
        if (c === '.' || ((c === '+' || c === '-') && !radix && (previous === 'e' || previous === 'E'))) {
            i++;
            previous = c;
            continue;
        }
        const cp = codePointAt(text, i);
        if (!isIdentifierChar(cp)) break;
        i += cp.length;
        previous = cp.length === 1 ? cp : '';
    }
    return i;
}

/** Whether a number token is a literal Jyro accepts, its value in range */
function isNumberLiteral(token: string): boolean {
    if (HEX.test(token)) return BigInt(token) <= 0x7FFFFFFFFFFFFFFFn;
    if (BINARY.test(token)) return BigInt(token) <= 0x7FFFFFFFFFFFFFFFn;
    return DECIMAL.test(token) && Number.isFinite(Number(token));
}

/**
 * A string literal. It may run over several lines. Its errors are placed at
 * the whole token, as Jyro places them. One with no closing quote runs to the
 * end of the text, as Jyro reads it, or with `stopAtLineEnd` to the end of
 * its line, so that an editor still reads the lines after it as code.
 */
function readString(text: string, start: number, quote: string, newline: boolean, errors: LexicalError[], stopAtLineEnd: boolean): Token {
    // The end of the token: after its closing quote, or where it is cut off
    let i = start + 1;
    while (i < text.length && text[i] !== quote) i += text[i] === '\\' ? 2 : 1;
    const closed = i < text.length;
    let end = closed ? i + 1 : text.length;
    if (!closed && stopAtLineEnd) {
        const lineEnd = text.indexOf('\n', start);
        if (lineEnd >= 0) end = text[lineEnd - 1] === '\r' ? lineEnd - 1 : lineEnd;
    }
    const contentEnd = closed ? end - 1 : end;
    const tokenErrors: LexicalError[] = [];

    let value = '';
    for (let j = start + 1; j < contentEnd;) {
        const c = text[j];
        if (c !== '\\') {
            value += c;
            j++;
            continue;
        }
        if (j + 1 >= contentEnd) {
            // A backslash at the end of an unterminated literal escapes nothing
            j++;
            continue;
        }
        const e = text[j + 1];
        const simple: Record<string, string> = { n: '\n', r: '\r', t: '\t', '\\': '\\', '"': '"', '\'': '\'', '0': '\0' };
        if (e in simple) {
            value += simple[e];
            j += 2;
        } else if (e === 'u') {
            const digits = text.substring(j + 2, Math.min(j + 6, contentEnd));
            if (/^[0-9A-Fa-f]{4}$/.test(digits)) {
                value += String.fromCharCode(parseInt(digits, 16));
                j += 6;
            } else {
                // The escape as written, up to the first code unit that is not a hex digit
                tokenErrors.push({ code: 1201, start, end, arg: '\\u' + /^[0-9A-Fa-f]*/.exec(digits)![0] });
                j += 2;
            }
        } else {
            const width = codePointAt(text, j + 1).length;
            tokenErrors.push({ code: 1201, start, end, arg: '\\' + text.substring(j + 1, j + 1 + width) });
            j += 1 + width;
        }
    }

    // A surrogate of the value that is not half of a high-then-low pair
    for (let j = 0; j < value.length; j++) {
        const u = value.charCodeAt(j);
        if (u >= 0xD800 && u <= 0xDBFF && j + 1 < value.length && value.charCodeAt(j + 1) >= 0xDC00 && value.charCodeAt(j + 1) <= 0xDFFF) {
            j++;
        } else if (u >= 0xD800 && u <= 0xDFFF) {
            tokenErrors.push({ code: 5918, start, end, arg: j });
            break;
        }
    }
    if (!closed) tokenErrors.push({ code: 1200, start, end });

    errors.push(...tokenErrors);
    return { kind: 'string', text: text.substring(start, end), start, end, newline, value };
}