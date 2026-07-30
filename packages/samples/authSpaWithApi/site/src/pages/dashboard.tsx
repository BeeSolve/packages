import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { signOut } from "../authClient";
import { trpc } from "../trpc";

interface Props {
  onUnauthorized: () => void;
}

export function Dashboard({ onUnauthorized }: Props) {
  const identityQuery = useQuery(trpc.identity.queryOptions());

  useEffect(() => {
    if (identityQuery.error != null) {
      onUnauthorized();
    }
  }, [identityQuery.error, onUnauthorized]);

  function handleSignOut() {
    void signOut();
  }

  if (identityQuery.isLoading) return <p>Loading...</p>;
  if (identityQuery.error != null) return null;

  return (
    <div>
      <h1>Dashboard</h1>
      <p>Signed in as: {identityQuery.data?.userId}</p>
      <button type="button" onClick={handleSignOut}>
        Sign out
      </button>
    </div>
  );
}
