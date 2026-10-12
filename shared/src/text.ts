/**
 * Converting between offsets and 0-based positions in a document's text,
 * the way vscode-languageserver-textdocument does: \r\n, \r and \n each end a
 * line, and characters are UTF-16 code units.
 */

import type { Position, Range } from './types';

export class TextIndex {
    readonly text: string;
    private readonly lineStarts: number[];

    constructor(text: string) {
        this.text = text;
        this.lineStarts = [0];
        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            if (ch === '\r' || ch === '\n') {
                if (ch === '\r' && text[i + 1] === '\n') i++;
                this.lineStarts.push(i + 1);
            }
        }
    }

    get lineCount(): number {
        return this.lineStarts.length;
    }

    offsetAt(position: Position): number {
        if (position.line >= this.lineStarts.length) return this.text.length;
        if (position.line < 0) return 0;
        const lineStart = this.lineStarts[position.line];
        const lineEnd = this.lineEnd(position.line);
        return Math.max(Math.min(lineStart + position.character, lineEnd), lineStart);
    }

    positionAt(offset: number): Position {
        offset = Math.max(Math.min(offset, this.text.length), 0);
        let low = 0;
        let high = this.lineStarts.length;
        while (low < high) {
            const mid = Math.floor((low + high) / 2);
            if (this.lineStarts[mid] > offset) high = mid;
            else low = mid + 1;
        }
        const line = low - 1;
        return { line, character: offset - this.lineStarts[line] };
    }

    /** The whole of the text, as a range */
    fullRange(): Range {
        const last = this.lineCount - 1;
        return {
            start: { line: 0, character: 0 },
            end: { line: last, character: this.lineEnd(last) - this.lineStarts[last] }
        };
    }

    /** The offset of the end of a line, before its line break */
    private lineEnd(line: number): number {
        let end = line + 1 < this.lineStarts.length ? this.lineStarts[line + 1] : this.text.length;
        while (end > this.lineStarts[line] && (this.text[end - 1] === '\n' || this.text[end - 1] === '\r')) end--;
        return end;
    }
}
