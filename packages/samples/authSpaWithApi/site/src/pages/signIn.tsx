import { useState } from "react";

import { signInRequest } from "../authClient";
import { EmailForm } from "../components/emailForm";

interface Props {
  onSuccess: (token: string) => void;
}

export function SignIn({ onSuccess }: Props) {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function handleSubmit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    const form = event.currentTarget;
    const email = new FormData(form).get("email");

    if (typeof email !== "string") return;

    void (async () => {
      try {
        const data = await signInRequest(email);
        onSuccess(data.token);
      } catch {
        setLoading(false);
        setError("Something went wrong. Please try again.");
      }
    })();
  }

  return (
    <div>
      <h1>Sign in</h1>
      {error && <p style={{ color: "red" }}>{error}</p>}
      <EmailForm onSubmit={handleSubmit} disabled={loading} />
      <p>Enter your email to receive a sign-in code.</p>
    </div>
  );
}
