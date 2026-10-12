# Jyro Language Support for VS Code

Full-featured Language Server Protocol (LSP) implementation for the [Jyro](https://www.jyro.dev) scripting language.

## Features

### Syntax Highlighting
- Complete syntax highlighting for all Jyro keywords, operators, and constructs
- Specialized highlighting for the `Input` and `Output` root objects
- Highlighting for function calls
- String escape sequence highlighting
- Number literal highlighting

### IntelliSense & Auto-Completion
- **Keyword completion**: All Jyro keywords (var, if, while, foreach, match, etc.)
- **Type completion**: Type hints (number, string, boolean, object, array, any, function)
- **Function completion**: All standard library functions with signatures
- **Variable completion**: The variables, parameters and loop variables in scope where you type; a function body sees only its own
- **Named arguments**: Parameter names inside a call's parentheses
- **Property completion**: After `Output.` and other paths, the properties the script already uses
- **Snippet completion**: Common patterns and control structures

### Hover Information
- The standard library's own documentation: what each function does, each parameter, what it returns and when that is null, remarks and examples
- Which functions are not pure (the clock, random values, waiting)
- Keyword explanations
- The script's own functions, union variants and variables

### Signature Help
- Real-time parameter hints while typing function calls, named arguments included
- Current parameter highlighting
- Parameter documentation

### Diagnostics & Error Detection
The extension parses and checks a script as Jyro's compiler does, and reports the same errors, with Jyro's codes (JM2000 and so on) and messages:
- **Lexical and syntax errors**: unterminated strings, invalid escapes and numbers, and the first syntax error
- **Validation errors**: undeclared and redeclared variables, `Input` changed, `Output` used in a function or lambda, `break`, `continue` and `return` out of place, function and union declarations, `match` cases and exhaustiveness
- **Call errors**: too few or too many arguments, unknown, missing or repeated named arguments
- **Host functions**: a call to a function the editor does not know is noted, since the host may provide it
- **Unreachable code** after `return`, `fail`, `exit`, `break` or `continue` is faded

### Standard Library
The standard library's signatures and documentation are generated from Jyro itself, so they match the compiler. To regenerate them from a Jyro checkout (by default `../jyro`):

```powershell
npm run generate:stdlib -- C:\path\to\jyro
```

### Code Snippets
40+ pre-built snippets for:
- Variable declarations
- Control structures (if/while/foreach/switch)
- Function calls
- Data manipulation
- Common patterns

### Additional Features
- Document symbols and outline
- Smart indentation
- Auto-closing pairs for brackets, quotes
- Code folding for control structures
- Comment toggling

## Installation

### From Source

1. Clone this repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Build the extension:
   ```bash
   npm run compile && npm run compile:esbuild
   ```
4. Press F5 to open a new VS Code window with the extension loaded

## Configuration

Configure the extension in VS Code settings:

```json
{
  "jyro.trace.server": "off",           // Server trace level
  "jyro.maxNumberOfProblems": 100,      // Max diagnostics
  "jyro.format.indentSize": 4,          // Indent size
  "jyro.format.useTabs": false          // Use tabs
}
```

## Requirements

- VS Code 1.85.0 or higher
- Node.js 20.x or higher

## Development

### Building from Source

```powershell
# Install dependencies
npm install

# Type-check and bundle
npm run compile && npm run compile:esbuild

# Watch for changes (auto-rebuilds dist/ on save)
npm run watch

# Lint
npm run lint
```

### Publishing

Publishing needs [`vsce`](https://github.com/microsoft/vscode-vsce) and a personal access token for the `RealTree-Systems` publisher (`vsce login RealTree-Systems`). Raise `version` in `package.json`, then:

```powershell
npx vsce package    # build the .vsix to check it
npx vsce publish    # build and publish to the Marketplace
```

### Project Structure

```
jyro-code-lsp/
├── client/              # VS Code extension client
├── server/              # Language server implementation
├── shared/              # Browser-safe language service (lexer, parser, validator, completion, hover)
├── syntaxes/            # TextMate grammar
├── snippets/            # Code snippets
├── tools/               # Standard library generator
└── package.json         # Extension manifest
```

## About Jyro

Jyro is a secure, sandboxed imperative scripting language designed for .NET 8+ that specializes in:
- Data transformation and ETL operations
- Business rule evaluation
- Safe execution of user-provided scripts
- Integration with .NET applications

Learn more at [jyro.dev](https://www.jyro.dev) or [support.realtree.cloud/articles/jyro/overview](https://support.realtree.cloud/articles/jyro/overview)

## License

MIT License - Copyright (c) 2025-2026 RealTree Systems

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Support

For information, issues and feature requests, please visit:
- [GitHub Issues](https://github.com/RealTree-Systems/jyro-code-lsp/issues)
- [Jyro Documentation](https://support.realtree.cloud/articles/jyro/overview)
- [Jyro Website](https://www.jyro.dev)