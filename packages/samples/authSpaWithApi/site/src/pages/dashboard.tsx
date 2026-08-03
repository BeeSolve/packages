import { useQuery } from "@tanstack/react-query";

import { signOut } from "../authClient";
import { trpc } from "../trpc";

interface Props {
  onUnauthorized: () => void;
}

export function Dashboard({ onUnauthorized }: Props) {
  const identityQuery = useQuery({ ...trpc.identity.queryOptions(), retry: false });

  if (identityQuery.isLoading) return <p>Loading...</p>;

  if (identityQuery.error != null) {
    onUnauthorized();
    return null;
  }

  function handleSignOut() {
    void signOut();
  }

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
