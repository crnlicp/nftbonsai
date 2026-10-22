import { createContext, useContext, type ReactNode } from "react";
import { useAuth, type UseAuth } from "../hooks/useAuth";

const Ctx = createContext<UseAuth | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  return <Ctx.Provider value={auth}>{children}</Ctx.Provider>;
}

export function useAuthContext(): UseAuth {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuthContext outside AuthProvider");
  return v;
}
