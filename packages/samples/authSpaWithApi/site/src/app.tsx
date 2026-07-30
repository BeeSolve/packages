import { QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

import { Dashboard } from "./pages/dashboard";
import { SignIn } from "./pages/signIn";
import { Verify } from "./pages/verify";
import { queryClient, TRPCProvider, trpcClient } from "./trpc";

type Page = "signIn" | "verify" | "dashboard";

export function App() {
  const [page, setPage] = useState<Page>("dashboard");
  const [token, setToken] = useState("");

  function handleSignInSuccess(newToken: string) {
    setToken(newToken);
    setPage("verify");
  }

  function handleUnauthorized() {
    setPage("signIn");
  }

  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        {page === "signIn" && <SignIn onSuccess={handleSignInSuccess} />}
        {page === "verify" && <Verify token={token} />}
        {page === "dashboard" && <Dashboard onUnauthorized={handleUnauthorized} />}
      </TRPCProvider>
    </QueryClientProvider>
  );
}
