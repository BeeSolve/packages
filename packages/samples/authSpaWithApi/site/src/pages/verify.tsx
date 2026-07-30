import { useState } from "react";

import { AuthError, signInComplete } from "../authClient";
import { CodeInput } from "../components/codeInput";

interface Props {
  token: string;
}

export function Verify({ token }: Props) {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function handleSubmit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    const form = event.currentTarget;
    const code = new FormData(form).get("code");

    if (typeof code !== "string") return;

    void (async () => {
      try {
        // signInComplete does window.location.href = redirectTo (full page reload)
        await signInComplete(token, code);
      } catch (e) {
        setLoading(false);
        if (e instanceof AuthError && e.type === "forbidden") {
          setError("Invalid code. Please try again.");
        } else {
          setError("Something went wrong. Please try again.");
        }
      }
    })();
  }

  return (
    <div>
      <h1>Enter code</h1>
      {error && <p style={{ color: "red" }}>{error}</p>}
      <p>Check your email for a verification code.</p>
      <CodeInput onSubmit={handleSubmit} disabled={loading} />
    </div>
  );
}
