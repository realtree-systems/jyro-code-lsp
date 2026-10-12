/**
 * Jyro's keywords, as completion and hover offer them
 */

/** Keywords offered as completions: every reserved word that is not a type name */
export const KEYWORDS = [
    'var', 'if', 'then', 'else', 'elseif', 'end', 'switch', 'do', 'case', 'default',
    'while', 'for', 'foreach', 'in', 'to', 'downto', 'by', 'return', 'fail', 'break', 'continue',
    'true', 'false', 'null', 'and', 'or', 'not', 'is',
    'func', 'union', 'match', 'exit', 'delete'
];

/**
 * Type names offered as completions, for a type hint or an `is` test. `any`
 * and `function` are types only there; elsewhere they are ordinary names.
 */
export const TYPE_KEYWORDS = ['number', 'string', 'boolean', 'object', 'array', 'any', 'function'];

/** What hover says about each keyword, and about Input and Output */
export const KEYWORD_DOCS: ReadonlyArray<{ word: string; desc: string }> = [
    { word: 'var', desc: 'Declares a variable in the current block: `var name`, `var name = value` or `var name: type = value`. A variable with a type hint other than `any` needs a value, and each value it is given is converted to that type, or refused when it cannot be.' },
    { word: 'if', desc: 'Runs a block when a condition is truthy: `if condition then ... elseif condition then ... else ... end`.' },
    { word: 'then', desc: 'Ends the condition of an `if` or `elseif`, and the head of a `case` or `default`, and starts its body.' },
    { word: 'else', desc: 'The branch of an `if` that runs when no condition before it was truthy.' },
    { word: 'elseif', desc: 'A further condition of an `if`: `elseif condition then ...`.' },
    { word: 'end', desc: 'Ends an `if`, `while`, `for`, `foreach`, `switch`, `match`, `func` or `union`. A `case` has no `end` of its own.' },
    { word: 'while', desc: 'Runs a block for as long as a condition is truthy: `while condition do ... end`.' },
    { word: 'do', desc: 'Starts the body of a `while`, `for`, `foreach`, `switch` or `match`.' },
    { word: 'for', desc: 'Counts over a range: `for i in 0 to 10 do ... end`, `for i in 10 downto 0 do ... end`, with an optional `by step`. The end of the range is excluded.' },
    { word: 'foreach', desc: 'Runs a block for each element of an array, each character of a string, or each value of an object: `foreach item in collection do ... end`.' },
    { word: 'in', desc: 'Separates the loop variable of a `for` or `foreach` from its range or collection.' },
    { word: 'to', desc: 'Counts upwards in a `for` range, up to and excluding its end: `for i in 0 to 10 do`.' },
    { word: 'downto', desc: 'Counts downwards in a `for` range, down to and excluding its end: `for i in 10 downto 0 do`.' },
    { word: 'by', desc: 'The step of a `for` range, a positive number: `for i in 0 to 10 by 2 do`.' },
    { word: 'switch', desc: 'Runs the block of the first case whose value equals the subject: `switch subject do case 1, 2 then ... default then ... end`.' },
    { word: 'case', desc: 'In a `switch`, the values a block runs for: `case 1, 2 then ...`. In a `match`, the variant a block runs for, with its fields bound to names: `case Circle(r) then ...`. A case has no `end` of its own.' },
    { word: 'default', desc: 'The block of a `switch` that runs when no case matched: `default then ...`. A `match` has no default: its cases cover every variant.' },
    { word: 'break', desc: 'Leaves the innermost `while`, `for` or `foreach` loop.' },
    { word: 'continue', desc: 'Goes on to the next iteration of the innermost `while`, `for` or `foreach` loop.' },
    { word: 'return', desc: 'Leaves a function, giving its value: `return` or `return value`. Valid only inside a `func`; use `exit` to end the script.' },
    { word: 'fail', desc: 'Stops the script as a failure, with an optional message: `fail` or `fail "message"`.' },
    { word: 'exit', desc: 'Ends the script successfully, from anywhere in it, with an optional value: `exit` or `exit value`.' },
    { word: 'func', desc: 'Declares a function at the top level of the script: `func Name(a, b: number, c = 1) ... end`. A function can be called before its declaration. Its body sees its parameters and `Input`, but not the script\'s variables or `Output`.' },
    { word: 'union', desc: 'Declares a discriminated union at the top level: `union Shape Circle(radius: number) Square(side: number) end`. Each variant is a constructor function, `Circle(2)`, that makes an object whose `_variant` is the variant\'s name.' },
    { word: 'match', desc: 'Branches on the variant of a union value, binding its fields: `match shape do case Circle(r) then ... case Square(s) then ... end`. The cases must cover every variant. As an expression, each case gives a value: `case Circle(r) then r * r`.' },
    { word: 'delete', desc: 'Removes a property from an object: `delete obj.name` or `delete obj["name"]`. To remove an element of an array, use `RemoveAt`.' },
    { word: 'and', desc: 'Logical and: truthy when both operands are, evaluating the right one only when the left is truthy.' },
    { word: 'or', desc: 'Logical or: truthy when either operand is, evaluating the right one only when the left is falsy.' },
    { word: 'not', desc: 'Logical not: `not condition`. It binds more loosely than comparison, so `not a == b` is `not (a == b)`.' },
    { word: 'is', desc: 'Tests a value\'s type: `value is number`, `value is not null`. The types are `number`, `string`, `boolean`, `object`, `array`, `null`, `function` and `any`.' },
    { word: 'true', desc: 'The boolean true.' },
    { word: 'false', desc: 'The boolean false.' },
    { word: 'null', desc: 'The null value, and the type of `value is null`.' },
    { word: 'number', desc: 'The number type, in a type hint or an `is` test.' },
    { word: 'string', desc: 'The string type, in a type hint or an `is` test.' },
    { word: 'boolean', desc: 'The boolean type, in a type hint or an `is` test.' },
    { word: 'object', desc: 'The object type, in a type hint or an `is` test.' },
    { word: 'array', desc: 'The array type, in a type hint or an `is` test.' },
    { word: 'Input', desc: 'The input the host gives the script, read-only: read `Input.property`, but no assignment, `delete` or `++` may change it. It can be read in a function too.' },
    { word: 'Output', desc: 'The output the script gives back to the host: assign to `Output.property`, or to `Output` itself. It cannot be used inside a function or a lambda; pass values in and return them instead.' }
];
