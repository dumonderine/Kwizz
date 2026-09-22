import React, { createContext, useContext, useEffect, useState, useCallback } from "react";

import { apiFetch, getToken, TOKEN_KEY } from "@/src/api";
import { storage } from "@/src/utils/storage";

export type User = {
  id: string;
  email: string;
  name?: string | null;
  study_field?: string | null;
  show_grade: boolean;
  reminder_hour: number;
  j_presets: { id: string; name: string; offsets: number[] }[];
  anchor_enabled: boolean;
  anchor_size: number;
  onboarded: boolean;
};

type ProfilePatch = {
  study_field?: string;
  show_grade?: boolean;
  reminder_hour?: number;
  anchor_enabled?: boolean;
  anchor_size?: number;
};

type AuthState = {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<User>;
  signUp: (email: string, password: string, name?: string) => Promise<User>;
  signOut: () => Promise<void>;
  updateProfile: (data: ProfilePatch) => Promise<User>;
  refreshUser: () => Promise<User>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const bootstrap = useCallback(async () => {
    const token = await getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    try {
      const me = await apiFetch<User>("/auth/me");
      setUser(me);
    } catch {
      await storage.secureRemove(TOKEN_KEY);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  const persist = async (token: string, u: User) => {
    await storage.secureSet(TOKEN_KEY, token);
    setUser(u);
    return u;
  };

  const signIn = async (email: string, password: string) => {
    const res = await apiFetch<{ token: string; user: User }>("/auth/login", { body: { email, password } });
    return persist(res.token, res.user);
  };

  const signUp = async (email: string, password: string, name?: string) => {
    const res = await apiFetch<{ token: string; user: User }>("/auth/register", { body: { email, password, name } });
    return persist(res.token, res.user);
  };

  const signOut = async () => {
    await storage.secureRemove(TOKEN_KEY);
    setUser(null);
  };

  const updateProfile = async (data: ProfilePatch) => {
    const updated = await apiFetch<User>("/auth/profile", { method: "PATCH", body: data });
    setUser(updated);
    return updated;
  };

  const refreshUser = async () => {
    const me = await apiFetch<User>("/auth/me");
    setUser(me);
    return me;
  };

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signUp, signOut, updateProfile, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
