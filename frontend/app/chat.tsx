import { useLocalSearchParams, useRouter } from "expo-router";
import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@react-native-vector-icons/ionicons";

import { apiFetch } from "@/src/api";
import { fonts, makeStyles, useTheme } from "@/src/theme";

type Msg = { role: "user" | "ai"; text: string };

const SUGGESTIONS = [
  "Explique-moi ce point plus simplement",
  "Fais-moi un moyen mnémotechnique",
  "Donne un exemple clinique",
];

export default function Chat() {
  const { folderId, context } = useLocalSearchParams<{ folderId?: string; context?: string }>();
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const scrollRef = useRef<ScrollView>(null);

  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || loading) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text: q }]);
    setLoading(true);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    try {
      const res = await apiFetch<{ answer: string }>("/chat", {
        body: { folder_id: folderId || null, question: q, context: context || null },
      });
      setMessages((m) => [...m, { role: "ai", text: res.answer }]);
    } catch (e: any) {
      setMessages((m) => [...m, { role: "ai", text: "❌ " + (e.message || "Erreur, réessayez.") }]);
    } finally {
      setLoading(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    }
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} testID="chat-close">
          <Ionicons name="chevron-down" size={26} color={colors.onSurface} />
        </Pressable>
        <View style={styles.headerTitleWrap}>
          <Ionicons name="sparkles" size={16} color={colors.brandPrimary} />
          <Text style={styles.headerTitle}>Tuteur IA</Text>
        </View>
        <View style={{ width: 26 }} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={0}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 16 }}
          keyboardShouldPersistTaps="handled"
        >
          {messages.length === 0 ? (
            <View style={styles.empty}>
              <View style={styles.emptyIcon}>
                <Ionicons name="chatbubbles" size={32} color={colors.brandPrimary} />
              </View>
              <Text style={styles.emptyTitle}>Posez vos questions</Text>
              <Text style={styles.emptyText}>
                {folderId
                  ? "Je m'appuie sur les cours de ce dossier pour vous répondre."
                  : "Je réponds à vos questions de médecine."}
              </Text>
              <View style={styles.chips}>
                {SUGGESTIONS.map((s) => (
                  <Pressable key={s} style={styles.chip} onPress={() => send(s)} testID={`chat-suggestion`}>
                    <Text style={styles.chipText}>{s}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : (
            messages.map((m, i) => (
              <View
                key={i}
                style={[styles.bubble, m.role === "user" ? styles.bubbleUser : styles.bubbleAI]}
                testID={`chat-msg-${m.role}`}
              >
                <Text style={[styles.bubbleText, m.role === "user" && { color: colors.onBrandPrimary }]}>{m.text}</Text>
              </View>
            ))
          )}
          {loading ? (
            <View style={[styles.bubble, styles.bubbleAI, { flexDirection: "row", gap: 8 }]}>
              <ActivityIndicator color={colors.brandPrimary} />
              <Text style={styles.bubbleText}>Le tuteur réfléchit…</Text>
            </View>
          ) : null}
        </ScrollView>

        <View style={[styles.inputBar, { paddingBottom: insets.bottom + 8 }]}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="Votre question…"
            placeholderTextColor={colors.muted}
            multiline
            testID="chat-input"
          />
          <Pressable
            style={[styles.sendBtn, (!input.trim() || loading) && { opacity: 0.4 }]}
            onPress={() => send(input)}
            disabled={!input.trim() || loading}
            testID="chat-send"
          >
            <Ionicons name="arrow-up" size={22} color={colors.onBrandPrimary} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.surfaceSecondary },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitleWrap: { flexDirection: "row", alignItems: "center", gap: 6 },
  headerTitle: { fontSize: 17, fontFamily: fonts.extrabold, color: colors.onSurface },
  empty: { alignItems: "center", paddingTop: 60, gap: 10 },
  emptyIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  emptyTitle: { fontSize: 18, fontFamily: fonts.bold, color: colors.onSurface },
  emptyText: { fontSize: 14, fontFamily: fonts.regular, color: colors.muted, textAlign: "center", paddingHorizontal: 30, lineHeight: 20 },
  chips: { gap: 8, marginTop: 16, width: "100%" },
  chip: { backgroundColor: colors.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: colors.border },
  chipText: { fontSize: 14, fontFamily: fonts.semibold, color: colors.onSurfaceSecondary },
  bubble: { maxWidth: "88%", borderRadius: 16, padding: 14 },
  bubbleUser: { alignSelf: "flex-end", backgroundColor: colors.brandPrimary, borderBottomRightRadius: 4 },
  bubbleAI: { alignSelf: "flex-start", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 15, fontFamily: fonts.regular, color: colors.onSurface, lineHeight: 22 },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 10,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    minHeight: 44,
    borderRadius: 22,
    backgroundColor: colors.surfaceTertiary,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    fontSize: 15,
    fontFamily: fonts.regular,
    color: colors.onSurface,
  },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
}));
