export interface TokenEstimator {
  readonly name: string;
  estimate(text: string): number;
}

function isCjk(cp: number): boolean {
  return (
    (cp >= 0x3040 && cp <= 0x30ff) ||   // hiragana/katakana
    (cp >= 0x3400 && cp <= 0x4dbf) ||   // CJK ext A
    (cp >= 0x4e00 && cp <= 0x9fff) ||   // CJK unified
    (cp >= 0xac00 && cp <= 0xd7a3) ||   // Hangul syllables
    (cp >= 0xf900 && cp <= 0xfaff)      // CJK compat
  );
}

export class HeuristicTokenEstimator implements TokenEstimator {
  readonly name = "heuristic";
  estimate(text: string): number {
    if (!text) return 0;
    let cjk = 0, other = 0;
    for (const ch of text) {
      const cp = ch.codePointAt(0)!;
      if (isCjk(cp)) cjk++;
      else if (!/\s/.test(ch)) other++;
    }
    return Math.ceil(cjk * 0.7 + other * 0.27);
  }
}
