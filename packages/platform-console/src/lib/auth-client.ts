import { createAuthClient } from "better-auth/react";
import { adminClient, organizationClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  baseURL:
    typeof window !== "undefined"
      ? window.location.origin
      : (import.meta as any).env?.VITE_BETTER_AUTH_URL || "http://localhost:3000",
  plugins: [
    adminClient(),
    organizationClient(),
  ],
});

export const { useSession, organization } = authClient;
