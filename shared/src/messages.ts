/**
 * The diagnostics Jyro's compiler gives before a script runs, with its codes
 * and its English messages (Jyro.Core/Diagnostics.fs), so that the editor
 * says what the compiler will
 */

const TEMPLATES = {
    // Lexer
    1200: 'Unterminated string literal',
    1201: 'Invalid escape sequence in string literal: {0}',
    // Parser
    2000: 'Syntax error: unexpected {0}',
    2001: 'Syntax error: unexpected end of source',
    2003: 'A call must be made on a function name, not on another expression',
    2200: "Invalid number format: '{0}'",
    // Validator
    3100: "Undeclared variable '{0}'",
    3101: "Variable '{0}' is already declared",
    3103: "Cannot bind '{0}'; Input and Output are supplied by the host",
    3200: 'Invalid assignment target',
    3201: 'Invalid delete target',
    3202: 'Type hint is not allowed on a compound assignment',
    3203: "Type hint on '{0}' must appear on its first assignment",
    3204: 'Invalid increment or decrement target',
    3301: "The '+' operator does not accept a string operand",
    3302: "Typed variable '{0}' must have an initializer",
    3400: "'{0}' statement outside of loop",
    3402: 'Value of type {0} is not iterable',
    3500: "Function '{0}' must be declared at the top level",
    3501: 'Function declarations cannot be nested inside other functions',
    3502: "Duplicate parameter '{0}' {1}",
    3504: 'Cannot access Output inside a function or lambda body',
    3505: "'return' is only valid inside a function",
    3506: "Required parameter '{0}' cannot follow optional parameter '{1}' in function '{2}'",
    3507: "Default value for parameter '{0}' in function '{1}' must be a literal",
    3508: 'Cannot modify Input.',
    3600: "Union '{0}' must be declared at the top level",
    3601: "Variant '{0}' is already defined in union '{1}'",
    3602: "Match on union '{0}' is not exhaustive; missing case(s): {1}",
    3603: "Duplicate case '{0}' in match statement",
    3604: "Case '{0}' has {1} binding(s) but variant '{0}' has {2} field(s)",
    3605: 'Union declarations cannot be inside functions',
    3606: "Unknown variant '{0}' in match case",
    3607: "'default' is not allowed in a match",
    3608: "Union '{0}' is already defined",
    3609: "Field name '_variant' in variant '{0}' is reserved for the variant tag",
    3610: "Field '{0}' is declared more than once in variant '{1}'",
    3611: "Name '{0}' is bound more than once in case '{1}'",
    // Linker
    4100: "Undefined function '{0}'",
    4101: "Function '{0}' is already defined",
    4102: "Function '{0}' overrides a built-in function",
    4200: "Function '{0}' requires at least {1} arguments, but {2} were provided",
    4201: "Function '{0}' accepts at most {1} arguments, but {2} were provided",
    4202: "Duplicate named argument '{0}' in call to '{1}'",
    4203: "Unknown parameter '{0}' in call to '{1}'",
    4204: "Required parameter '{0}' not provided in call to '{1}'",
    4300: "Variant constructor '{0}' shadows built-in function '{0}'",
    4301: "Function '{0}' shadows variant constructor '{0}'",
    // Runtime band, but reported as the script is parsed
    5918: 'An unpaired surrogate at index {0} has no UTF-8 form'
} as const;

export type MessageCode = keyof typeof TEMPLATES;

/** The message of a code, its arguments put in; an argument not given is left out */
export function messageText(code: MessageCode, args: ReadonlyArray<string | number> = []): string {
    return TEMPLATES[code]
        .replace(/\{(\d+)\}/g, (_m, n: string) => String(args[Number(n)] ?? ''))
        .replace(/ +$/, '');
}

/** The code as Jyro writes it, as in JM3100 */
export function codeText(code: MessageCode): string {
    return `JM${code}`;
}
