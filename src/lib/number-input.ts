// Pure, DOM-free helpers for numeric text inputs. The <NumberField> component
// (src/components/number-field.tsx) is the thin DOM glue around these. Keeping
// the parsing/clamping here makes the real behavior testable without jsdom.

/**
 * Parse what the user typed into a number, or null if the field is blank or not
 * yet a valid number. Does NOT clamp — that's `clampNumber`, applied on blur so
 * values aren't yanked around mid-keystroke.
 *
 * - blank / whitespace → null (a real "not entered" state, distinct from 0)
 * - non-numeric or malformed → null
 * - decimals rejected unless `allowDecimal`
 */
export function parseNumberInput(
  text: string,
  opts: { allowDecimal?: boolean } = {},
): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;

  const pattern = opts.allowDecimal ? /^-?\d*\.?\d+$/ : /^-?\d+$/;
  if (!pattern.test(trimmed)) return null;

  const num = Number(trimmed);
  if (Number.isNaN(num)) return null;
  if (!opts.allowDecimal && !Number.isInteger(num)) return null;

  return num;
}

/** Clamp a number into [min, max]; either bound may be omitted. */
export function clampNumber(n: number, opts: { min?: number; max?: number }): number {
  let result = n;
  if (opts.min != null && result < opts.min) result = opts.min;
  if (opts.max != null && result > opts.max) result = opts.max;
  return result;
}
