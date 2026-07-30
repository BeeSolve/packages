import { useState } from "react";

interface Props {
  onSubmit: (event: React.SyntheticEvent<HTMLFormElement>) => void;
  disabled?: boolean;
  length?: number;
}

export function CodeInput({ onSubmit, disabled = false, length = 6 }: Props) {
  const [value, setValue] = useState("");

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const cleaned = event.target.value.replace(/[^0-9]/g, "").slice(0, length);
    setValue(cleaned);
  }

  return (
    <form onSubmit={onSubmit}>
      <label>
        Verification code
        <input
          type="text"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          minLength={length}
          maxLength={length}
          required
          disabled={disabled}
          value={value}
          onChange={handleChange}
        />
      </label>
      <button type="submit" disabled={disabled}>
        Verify
      </button>
    </form>
  );
}
