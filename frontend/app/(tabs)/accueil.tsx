import { useMutation } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@react-native-vector-icons/ionicons";

import { apiFetch } from "@/src/api";
import { useAuth } from "@/src/auth";
import { useToast } from "@/src/components/toast";
import { usesNativeTabs } from "@/src/navigation";
import { fonts, makeStyles, useTheme } from "@/src/theme";

export default function Accueil() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const { user } = useAuth();

  const anchorEnabled = user?.anchor_enabled !== false;
  const anchorSize = user?.anchor_size ?? 40;
  const bottomChrome = usesNativeTabs ? insets.bottom : 0;

  const anchor = useMutation({
    mutationFn: () => apiFetch<{ id: string }>("/anchor/daily", { body: {} }),
    onSuccess: (quiz) => router.push(`/quiz/play?quizId=${quiz.id}`),
    onError: (e: any) => toast.show(e.message, "error"),
  });

  const AnchorCard = anchorEnabled ? (
    <Pressable
      testID="anchor-card"
      style={({ pressed }) => [styles.anchorCard, pressed && styles.pressed]}
      onPress={() => !anchor.isPending && anchor.mutate()}
    >
      <View style={styles.anchorIcon}>
        {anchor.isPending ? (
          <ActivityIndicator color={colors.onBrandSecondary} />
        ) : (
          <Ionicons name="flame" size={26} color="#F97316" style={{ textShadowColor: "rgba(194,65,12,0.6)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 }} />
        )}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.anchorTitle}>Ancrage du jour</Text>
        <Text style={styles.anchorSub}>{anchorSize} QCM tirés au hasard dans toutes vos matières</Text>
      </View>
      <Ionicons name="play-circle" size={30} color={colors.onBrandSecondary} />
    </Pressable>
  ) : null;

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>BIENVENUE</Text>
          <Text style={styles.h1}>Accueil</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: bottomChrome + 100, gap: 12 }}>
        {AnchorCard}

        <Pressable
          testID="today-review-card"
          style={({ pressed }) => [styles.reviewCard, pressed && styles.pressed]}
          onPress={() => router.push("/calendar")}
        >
          <View style={styles.reviewIcon}>
            <Ionicons name="calendar" size={24} color={colors.brandPrimary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>Révisions du jour</Text>
            <Text style={styles.cardMeta}>Voir votre planning de la semaine</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.muted} />
        </Pressable>
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.surfaceSecondary },
  header: { paddingHorizontal: 16, paddingBottom: 8 },
  eyebrow: { fontSize: 12, fontFamily: fonts.bold, color: colors.muted, letterSpacing: 1 },
  h1: { fontSize: 30, fontFamily: fonts.extrabold, color: colors.onSurface },
  anchorCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: "#c5c8c7",
    borderRadius: 18,
    padding: 18,
    minHeight: 170,
  },
  pressed: { opacity: 0.7 },
  anchorIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  anchorTitle: { fontSize: 17, fontFamily: fonts.extrabold, color: colors.onSurface },
  anchorSub: { fontSize: 13, fontFamily: fonts.regular, color: colors.muted, marginTop: 2 },
  reviewCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  reviewIcon: { width: 46, height: 46, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.brandTertiary },
  cardTitle: { fontSize: 17, fontFamily: fonts.bold, color: colors.onSurface },
  cardMeta: { fontSize: 13, fontFamily: fonts.regular, color: colors.muted, marginTop: 2 },
}));
