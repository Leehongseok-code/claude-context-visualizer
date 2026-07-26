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

// Coefficients calibrated against real `usage` totals from captured sessions:
// counting only non-whitespace at 0.27/char landed at ~0.47x of the true count.
// Whitespace is not free — newlines and indentation in code/JSON/markdown carry
// tokens — so it is counted at a reduced weight and latin chars were raised.
const CJK_PER_CHAR = 1.0;         // hangul/kana/han are ~1 token per char
const LATIN_PER_CHAR = 0.5;       // ~2 chars per token for prose/code
const WHITESPACE_PER_CHAR = 0.25; // runs of spaces/newlines merge into few tokens

export class HeuristicTokenEstimator implements TokenEstimator {
  readonly name = "heuristic";
  estimate(text: string): number {
    if (!text) return 0;
    let cjk = 0, latin = 0, ws = 0;
    for (const ch of text) {
      const cp = ch.codePointAt(0)!;
      if (isCjk(cp)) cjk++;
      else if (/\s/.test(ch)) ws++;
      else latin++;
    }
    return Math.ceil(cjk * CJK_PER_CHAR + latin * LATIN_PER_CHAR + ws * WHITESPACE_PER_CHAR);
  }
}
