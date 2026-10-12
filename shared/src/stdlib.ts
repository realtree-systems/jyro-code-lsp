/**
 * Jyro's standard library: each function's signature and documentation
 *
 * The table is generated from Jyro itself (stdlib.generated.ts, made by
 * `npm run generate:stdlib`): the signatures from StdlibRegistry, the text
 * from the Jyro.Stdlib.xml documentation file. Host functions, which an
 * extension contributes through the jyro.hostFunctions setting, have the same
 * shape with fewer fields.
 */

import { GENERATED_STDLIB_FUNCTIONS } from './stdlib.generated';
import type { JyroType } from './types';

/** How observable a function's effect is, from least to most */
export type FunctionEffect = 'Pure' | 'NonDeterministic' | 'Blocking' | 'Mutating';

export interface FunctionParameter {
    /** The name, which a named-argument call uses */
    name: string;
    type: JyroType | JyroType[];
    /** A call may leave it out */
    optional?: boolean;
    /** What a call that leaves it out gets, as Jyro text */
    defaultValue?: string;
    /** Markdown */
    description: string;
}

export interface FunctionSignature {
    name: string;
    category: string;
    parameters: FunctionParameter[];
    returnType: JyroType | JyroType[];
    /** Markdown; its first sentence stands alone */
    description: string;
    /** Jyro code */
    examples?: string[];
    /** What it returns, and when that is null: Markdown */
    returns?: string;
    /** Markdown */
    remarks?: string;
    /** Examples written as sentences, with the code in backticks: Markdown */
    exampleText?: string[];
    /** The fewest and most arguments a call may give, when they are known */
    minArgs?: number;
    maxArgs?: number;
    effect?: FunctionEffect;
}

/** Every standard library function */
export const STDLIB_FUNCTIONS: FunctionSignature[] = GENERATED_STDLIB_FUNCTIONS;

/** The categories the functions are grouped in */
export const FUNCTION_CATEGORIES = [...new Set(STDLIB_FUNCTIONS.map(f => f.category))];

/** A standard library function by its name, which is case-sensitive */
export function getFunctionSignature(name: string): FunctionSignature | undefined {
    return STDLIB_FUNCTIONS.find(f => f.name === name);
}

export function getAllFunctionNames(): string[] {
    return STDLIB_FUNCTIONS.map(f => f.name);
}

export function getFunctionsByCategory(category: string): FunctionSignature[] {
    return STDLIB_FUNCTIONS.filter(f => f.category === category);
}

/** The first sentence of a description, for a one-line summary */
export function firstSentence(text: string): string {
    const match = /^.*?[.!?](?=\s|$)/.exec(text);
    return match ? match[0] : text;
}
