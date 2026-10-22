import { useEffect, useState, useCallback } from "react";
import type { Identity } from "@icp-sdk/core/agent";
import { authClient, currentIdentity, login, logout } from "../lib/auth";

export interface UseAuth {
  identity: Identity | undefined;
  isAuthenticated: boolean;
  isLoading: boolean;
  principal: string | undefined;
  error: string | undefined;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

export function useAuth(): UseAuth {
  const [identity, setIdentity] = useState<Identity | undefined>(undefined);
  const [isLoading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    const restore = () => {
      currentIdentity().then((id) => {
        if (!cancelled) setIdentity(id);
      }).catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }).finally(() => { if (!cancelled) setLoading(false); });
    };
    restore();
    const unsubscribe = authClient.subscribe(restore);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const signIn = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const id = await login();
      setIdentity(id);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await logout();
      setIdentity(undefined);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  return {
    identity,
    isAuthenticated: !!identity && !identity.getPrincipal().isAnonymous(),
    isLoading,
    error,
    principal: identity?.getPrincipal().toText(),
    signIn,
    signOut,
  };
}
