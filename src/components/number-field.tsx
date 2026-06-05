"use client";

import { useEffect, useRef, useState } from "react";
import { parseNumberInput, clampNumber } from "@/lib/number-input";

type NumberFieldProps = {
  value: number | null;
  onChange: (value: number | null) => void;
  min?: number;
  max?: number;
  allowDecimal?: boolean;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  id?: string;
  name?: string;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
  autoFocus?: boolean;
};

// App-wide numeric input. Empty by default (so there's no leading value to
// delete), selects its contents on focus (so typing replaces), and reports null
// when blank so callers can require a value before submit. Clamps to min/max on
// blur — never mid-keystroke.
export function NumberField({
  value,
  onChange,
  min,
  max,
  allowDecimal = false,
  placeholder,
  className,
  disabled,
  id,
  name,
  autoFocus,
  ...aria
}: NumberFieldProps) {
  // Local text buffer: lets the field be empty or mid-typed without the parent
  // forcing it back to a number. Synced from `value` only while not focused.
  const [text, setText] = useState(value == null ? "" : String(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(value == null ? "" : String(value));
  }, [value]);

  return (
    <input
      id={id}
      name={name}
      type="text"
      inputMode={allowDecimal ? "decimal" : "numeric"}
      autoComplete="off"
      disabled={disabled}
      autoFocus={autoFocus}
      value={text}
      placeholder={placeholder}
      className={className}
      onFocus={(e) => {
        focused.current = true;
        e.target.select();
      }}
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw);
        onChange(parseNumberInput(raw, { allowDecimal }));
      }}
      onBlur={() => {
        focused.current = false;
        const parsed = parseNumberInput(text, { allowDecimal });
        if (parsed == null) {
          setText("");
          onChange(null);
          return;
        }
        const clamped = clampNumber(parsed, { min, max });
        setText(String(clamped));
        if (clamped !== parsed) onChange(clamped);
      }}
      {...aria}
    />
  );
}
