const SMALL_NUMBERS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fourty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

const UNIT_WORDS = new Set([
  "cm",
  "centimetre",
  "centimetres",
  "m",
  "metre",
  "metres",
  "km",
  "kilometre",
  "kilometres",
  "mm",
  "millimetre",
  "millimetres",
  "g",
  "gram",
  "grams",
  "kg",
  "kilogram",
  "kilograms",
  "ml",
  "millilitre",
  "millilitres",
  "l",
  "litre",
  "litres",
  "degree",
  "degrees",
]);

function basicAnswerText(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\\text\{([^{}]+)\}/g, "$1")
    .replace(/\\(?:dfrac|frac)\{([^{}]+)\}\{([^{}]+)\}/g, "$1/$2")
    .replace(/[’']/g, "")
    .replace(/[–—]/g, "-")
    .replace(/°/g, " degrees")
    .replace(/\s+/g, " ")
    .trim();
}

function splitAliases(value: string): string[] {
  return value
    .split(/\s+(?:\/|or)\s+/i)
    .map((part) => part.trim())
    .filter(Boolean);
}

function stripTrailingUnits(value: string): string {
  const tokens = value.split(/\s+/).filter(Boolean);
  while (tokens.length > 1 && UNIT_WORDS.has(tokens[tokens.length - 1])) {
    tokens.pop();
  }
  return tokens.join(" ");
}

function normaliseTextMask(value: string): string {
  return value
    .replace(/[^a-z0-9./-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function numericMask(value: number): string {
  return `number:${Number(value.toFixed(8))}`;
}

function parseDigitNumber(value: string): number | null {
  const compact = value.replace(/\s+/g, "");
  const match = compact.match(/^[-+]?\d+(?:\.\d+)?(?:cm|mm|km|m|g|kg|ml|l|degrees?)?$/);
  if (!match) return null;

  const numberMatch = compact.match(/^[-+]?\d+(?:\.\d+)?/);
  if (!numberMatch) return null;
  const parsed = Number(numberMatch[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseNumberWords(value: string): number | null {
  const tokens = stripTrailingUnits(value)
    .replace(/-/g, " ")
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token && token !== "and");
  if (!tokens.length) return null;

  let total = 0;
  let current = 0;
  let sawNumber = false;

  for (const token of tokens) {
    if (Object.prototype.hasOwnProperty.call(SMALL_NUMBERS, token)) {
      current += SMALL_NUMBERS[token];
      sawNumber = true;
      continue;
    }

    if (token === "hundred") {
      if (!sawNumber && current === 0) return null;
      current *= 100;
      sawNumber = true;
      continue;
    }

    if (token === "thousand") {
      if (!sawNumber && current === 0) return null;
      total += current * 1000;
      current = 0;
      sawNumber = true;
      continue;
    }

    return null;
  }

  return sawNumber ? total + current : null;
}

export function answerMasks(value: unknown): Set<string> {
  const masks = new Set<string>();
  const raw = basicAnswerText(value);
  if (!raw) return masks;

  for (const alias of splitAliases(raw)) {
    const stripped = stripTrailingUnits(alias);
    for (const candidate of [alias, stripped]) {
      const normalised = normaliseTextMask(candidate);
      if (normalised) {
        masks.add(`text:${normalised}`);
        masks.add(`compact:${normalised.replace(/\s+/g, "")}`);
      }

      const digitNumber = parseDigitNumber(candidate);
      if (digitNumber !== null) masks.add(numericMask(digitNumber));

      const wordNumber = parseNumberWords(candidate);
      if (wordNumber !== null) masks.add(numericMask(wordNumber));
    }
  }

  return masks;
}

export function answerMaskMatches(expected: unknown, actual: unknown): boolean {
  const expectedMasks = answerMasks(expected);
  const actualMasks = answerMasks(actual);
  for (const mask of actualMasks) {
    if (expectedMasks.has(mask)) return true;
  }
  return false;
}
