import React, { createContext, useCallback, useContext, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { FadeInUp, FadeOutUp } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@react-native-vector-icons/ionicons";

import { fonts, useTheme } from "@/src/theme";

type ToastType = "success" | "error" | "info";
type Toast = { id: number; message: string; type: ToastType };

const ToastContext = createContext<{ show: (m: string, t?: ToastType) => void } | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  const show = useCallback((message: string, type: ToastType = "info") => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 2800);
  }, []);

  const bg = (t: ToastType) =>
    t === "success" ? colors.success : t === "error" ? colors.error : colors.surfaceInverse;
  const icon = (t: ToastType) =>
    t === "success" ? "checkmark-circle" : t === "error" ? "alert-circle" : "information-circle";

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <View pointerEvents="none" style={[styles.wrap, { top: insets.top + 8 }]}>
        {toasts.map((t) => (
          <Animated.View
            key={t.id}
            entering={FadeInUp}
            exiting={FadeOutUp}
            style={[styles.toast, { backgroundColor: bg(t.type) }]}
            testID="app-toast"
          >
            <Ionicons name={icon(t.type) as any} size={18} color="#ffffff" />
            <Text style={styles.text}>{t.message}</Text>
          </Animated.View>
        ))}
      </View>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    gap: 8,
    zIndex: 9999,
    paddingHorizontal: 16,
  },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 14,
    maxWidth: 440,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  text: { color: "#ffffff", fontSize: 14, fontFamily: fonts.semibold, flexShrink: 1 },
});
