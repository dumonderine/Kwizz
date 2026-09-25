import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useMemo } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@react-native-vector-icons/ionicons";

import { apiFetch } from "@/src/api";
import { useAuth } from "@/src/auth";
import { useToast } from "@/src/components/toast";
import { longDate, ymd } from "@/src/dates";
import { usesNativeTabs } from "@/src/navigation";
import { fonts, makeStyles, useTheme } from "@/src/theme";

type JEvent = {
  id: string;
  date: string;
  offset: number;
  label: string;
  folder_id: string;
  folder_name: string;
  topic_name: string;
  color: string;
};

export default function Accueil() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const { user } = useAuth();

  const today = useMemo(() => new Date(), []);

  const anchorEnabled = user?.anchor_enabled !== false;
  const anchorSize = user?.anchor_size ?? 40;
  const bottomChrome = usesNativeTabs ? insets.bottom : 0;

  const anchor = useMutation({
    mutationFn: () => apiFetch<{ id: string }>("/anchor/daily", { body: {} }),
    onSuccess: (quiz) => router.push(`/quiz/play?quizId=${quiz.id}`),
    onError: (e: any) => toast.show(e.message, "error"),
  });

  const todayEventsQ = useQuery({
    queryKey: ["j-events-today", ymd(today)],
    queryFn: () => apiFetch<JEvent[]>(`/j/events?start=${ymd(today)}&end=${ymd(today)}`),
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
          <Ionicons
            name="flame"
            size={26}
            color="#F97316"
            style={{ textShadowColor: "rgba(194,65,12,0.6)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 }}
          />
        )}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.anchorTitle}>Ancrage du jour</Text>
        <Text style={styles.anchorSub}>{anchorSize} QCM tirés au hasard dans toutes vos matières</Text>
      </View>
      <Ionicons name="play-circle" size={30} color="#000" />
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
          <Text style={styles.reviewDate}>{longDate(today)}</Text>

          {todayEventsQ.isLoading ? (
            <ActivityIndicator color={colors.brandPrimary} />
          ) : todayEventsQ.data && todayEventsQ.data.length > 0 ? (
            <View style={{ gap: 12 }}>
              {todayEventsQ.data.map((e) => (
                <View key={e.id} style={styles.reviewRow}>
                  <View style={[styles.reviewBadge, { backgroundColor: e.color }]}>
                    <Text style={styles.reviewBadgeText}>{e.label}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.reviewFolder} numberOfLines={1}>{e.folder_name}</Text>
                    <Text style={styles.reviewTopic} numberOfLines={1}>
                      {e.topic_name} · {e.offset === 0 ? "QCM généré ce jour" : "Revoir le cours"}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.reviewEmpty}>Aucune révision programmée aujourd'hui</Text>
          )}
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
    backgroundColor: "#FEF3C7",
    borderRadius: 18,
    padding: 18,
    minHeight: 170,
  },
  pressed: { opacity: 0.7 },
  anchorIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  anchorTitle: { fontSize: 17, fontFamily: fonts.extrabold, color: colors.onSurface },
  anchorSub: { fontSize: 13, fontFamily: fonts.regular, color: colors.muted, marginTop: 2 },
  reviewCard: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    padding: 24,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 16,
    minHeight: 200,
  },
  reviewDate: { fontSize: 20, fontFamily: fonts.extrabold, color: colors.onSurface, textAlign: "center", textTransform: "capitalize" },
  reviewRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  reviewBadge: { minWidth: 40, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  reviewBadgeText: { fontSize: 13, fontFamily: fonts.extrabold, color: "#ffffff" },
  reviewFolder: { fontSize: 15, fontFamily: fonts.semibold, color: colors.onSurface },
  reviewTopic: { fontSize: 12, fontFamily: fonts.regular, color: colors.muted, marginTop: 1 },
  reviewEmpty: { fontSize: 14, fontFamily: fonts.regular, color: colors.muted, textAlign: "center" },
}));
