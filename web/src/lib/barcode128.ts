const BARS = [
  11011001100, 11001101100, 11001100110, 10010011000, 10010001100,
  10001001100, 10011001000, 10011000100, 10001100100, 11001001000,
  11001000100, 11000100100, 10110011100, 10011011100, 10011001110,
  10111001100, 10011101100, 10011100110, 11001110010, 11001011100,
  11001001110, 11011100100, 11001110100, 11101101110, 11101001100,
  11100101100, 11100100110, 11101100100, 11100110100, 11100110010,
  11011011000, 11011000110, 11000110110, 10100011000, 10001011000,
  10001000110, 10110001000, 10001101000, 10001100010, 11010001000,
  11000101000, 11000100010, 10110111000, 10110001110, 10001101110,
  10111011000, 10111000110, 10001110110, 11101110110, 11010001110,
  11000101110, 11011101000, 11011100010, 11011101110, 11101011000,
  11101000110, 11100010110, 11101101000, 11101100010, 11100011010,
  11101111010, 11001000010, 11110001010, 10100110000, 10100001100,
  10010110000, 10010000110, 10000101100, 10000100110, 10110010000,
  10110000100, 10011010000, 10011000010, 10000110100, 10000110010,
  11000010010, 11001010000, 11110111010, 11000010100, 10001111010,
  10100111100, 10010111100, 10010011110, 10111100100, 10011110100,
  10011110010, 11110100100, 11110010100, 11110010010, 11011011110,
  11011110110, 11110110110, 10101111000, 10100011110, 10001011110,
  10111101000, 10111100010, 11110101000, 11110100010, 10111011110,
  10111101110, 11101011110, 11110101110, 11010000100, 11010010000,
  11010011100, 1100011101011
];

const MODULO = 103;
const START_B = 104;
const START_C = 105;
const QUIET_MODULES = 12;

function pattern(code: number): string {
  return code.toString(2).padStart(11, "0");
}

export function code128Bits(value: string): string {
  const clean = String(value ?? "");
  if (!clean) return "";
  const useC = /^[0-9]{2,}$/.test(clean) && clean.length % 2 === 0;
  const start = useC ? START_C : START_B;
  const symbols: number[] = useC
    ? Array.from({ length: clean.length / 2 }, (_, i) => Number(clean.slice(i * 2, i * 2 + 2)))
    : Array.from(clean, (ch) => {
        const code = ch.charCodeAt(0);
        if (code >= 32 && code <= 127) return code - 32;
        return 31;
      });
  const checksum = symbols.reduce((acc, val, idx) => acc + (idx + 1) * val, start) % MODULO;
  let bits = pattern(start);
  for (const s of symbols) bits += pattern(s);
  bits += pattern(checksum);
  bits += "1100011101011";
  return bits;
}

export interface Code128Options {
  moduleWidth?: number;
  height?: number;
  quietModules?: number;
  color?: string;
  bg?: string;
}

export function code128Svg(value: string, opts: Code128Options = {}): string {
  const { moduleWidth = 1.4, height = 46, quietModules = QUIET_MODULES, color = "#0a0a0a", bg = "#ffffff" } = opts;
  const bits = code128Bits(value);
  const total = (bits.length + quietModules * 2) * moduleWidth;
  let rects = "";
  for (let i = 0; i < bits.length; i++) {
    if (bits[i] === "1") {
      let j = i;
      while (j < bits.length && bits[j] === "1") j++;
      const x = (i + quietModules) * moduleWidth;
      const w = (j - i) * moduleWidth;
      rects += `<rect x="${x.toFixed(2)}" y="0" width="${w.toFixed(2)}" height="${height}" fill="${color}"/>`;
      i = j - 1;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total.toFixed(2)} ${height}" width="${total.toFixed(2)}" height="${height}" shape-rendering="crispEdges" role="img" aria-label="Código de barras ${value}"><rect width="100%" height="100%" fill="${bg}"/>${rects}</svg>`;
}

export function code128ModuleCount(value: string): number {
  return code128Bits(value).length + QUIET_MODULES * 2;
}