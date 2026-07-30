interface Props {
  onSubmit: (event: React.SyntheticEvent<HTMLFormElement>) => void;
  disabled?: boolean;
}

export function EmailForm({ onSubmit, disabled = false }: Props) {
  return (
    <form onSubmit={onSubmit}>
      <label>
        Email address
        <input type="email" name="email" required autoComplete="email" disabled={disabled} />
      </label>
      <button type="submit" disabled={disabled}>
        Send code
      </button>
    </form>
  );
}
