# Changelog

## 2.0.0

- Brought up to the finalised Jyro language: the parser, validator, highlighting, snippets and editing rules follow the language as Jyro's compiler now implements it.
- Diagnostics use Jyro's own error codes (JM2000 and so on) and messages.
- The standard library's signatures and documentation are generated from Jyro itself, so they match the compiler.
- Completion, hover and signature help are scope-aware, with named arguments, the script's own functions and union variants.
- The language features now live in a browser-safe shared language service.
- Unreachable code after `return`, `fail`, `exit`, `break` or `continue` is faded.
- Moved to the new [jyro-code-lsp](https://github.com/RealTree-Systems/jyro-code-lsp) repository.

## 1.2.0

- The last release from the previous repository.
