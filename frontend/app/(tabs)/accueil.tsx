import { useMutation, useQuery } from "@tanstack/react-query";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from "react-native";
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

type AnchorStatus = {
  pool_size: number;
  available: boolean;
  done_today: boolean;
  today_total: number;
  today_remaining: number;
  backlog: number;
  paused: boolean;
  paused_until: string | null;
};

function frDate(iso: string) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("fr-FR");
}

export default function Accueil() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const { user } = useAuth();

  const today = useMemo(() => new Date(), []);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());

  const anchorEnabled = user?.anchor_enabled !== false;
  const anchorSize = user?.anchor_size ?? 40;
  const bottomChrome = usesNativeTabs ? insets.bottom : 0;

  const [showChoice, setShowChoice] = useState(false);

  const statusQ = useQuery({
    queryKey: ["anchor-status"],
    queryFn: () => apiFetch<AnchorStatus>("/anchor/status"),
    enabled: anchorEnabled,
  });
  // Recharge les compteurs à chaque retour sur l'accueil (après une session d'ancrage par exemple).
  useFocusEffect(
    useCallback(() => {
      if (anchorEnabled) statusQ.refetch();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [anchorEnabled]),
  );
  const st = statusQ.data;
  const backlog = st?.backlog ?? 0;
  const paused = !!st?.paused;
  const todayCount = st ? st.today_remaining : anchorSize;
  const doneToday = !!st && !st.paused && st.done_today;

  const anchor = useMutation({
    mutationFn: () => apiFetch<{ id: string }>("/anchor/daily", { body: {} }),
    onSuccess: (quiz) => router.push(`/quiz/play?quizId=${quiz.id}`),
    onError: (e: any) => toast.show(e.message, "error"),
  });

  const backlogQuiz = useMutation({
    mutationFn: () => apiFetch<{ id: string }>("/anchor/backlog", { body: {} }),
    onSuccess: (quiz) => router.push(`/quiz/play?quizId=${quiz.id}`),
    onError: (e: any) => toast.show(e.message, "error"),
  });

  const onAnchorPress = () => {
    if (anchor.isPending || backlogQuiz.isPending) return;
    if (paused) {
      toast.show(`Ancrages suspendus jusqu'au ${frDate(st!.paused_until!)}`, "error");
      return;
    }
    if (doneToday && backlog === 0) {
      toast.show("Bravo, ancrage du jour terminé ! Reviens demain 🎉", "success");
      return;
    }
    if (backlog > 0) setShowChoice(true);
    else anchor.mutate();
  };

  const todayEventsQ = useQuery({
    queryKey: ["j-events-today", ymd(today)],
    queryFn: () => apiFetch<JEvent[]>(`/j/events?start=${ymd(today)}&end=${ymd(today)}`),
  });

  const toggleChecked = (eventId: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(eventId)) next.delete(eventId);
      else next.add(eventId);
      return next;
    });
  };

  const todayEvents = todayEventsQ.data ?? [];
  const allChecked = todayEvents.length > 0 && todayEvents.every((e) => checkedIds.has(e.id));

  const AnchorCard = anchorEnabled ? (
    <Pressable
      testID="anchor-card"
      style={({ pressed }) => [styles.anchorCard, pressed && styles.pressed]}
      onPress={onAnchorPress}
    >
      <View style={styles.anchorIcon}>
        {anchor.isPending || backlogQuiz.isPending ? (
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
        {paused ? (
          <Text style={styles.anchorSub}>Suspendu jusqu'au {frDate(st!.paused_until!)}</Text>
        ) : (
          <>
            {doneToday ? (
              <Text style={styles.anchorDone}>🎉 Bravo, ancrage du jour terminé, reviens demain !</Text>
            ) : (
              <Text style={styles.anchorSub}>{todayCount} QCM du jour</Text>
            )}
            {backlog > 0 ? (
              <Text style={styles.anchorBacklog}>
                + {backlog} QCM de retard
              </Text>
            ) : null}
          </>
        )}
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
              {todayEventsQ.data.map((e) => {
                const checked = checkedIds.has(e.id);
                return (
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
                    <Pressable
                      onPress={() => toggleChecked(e.id)}
                      hitSlop={10}
                      testID={`j-check-${e.id}`}
                      style={[
                        styles.jCheckbox,
                        { borderColor: e.color },
                        checked && { backgroundColor: e.color },
                      ]}
                    >
                      {checked ? <Ionicons name="checkmark" size={16} color="#fff" /> : null}
                    </Pressable>
                  </View>
                );
              })}
              {allChecked ? (
                <View style={styles.celebrate}>
                  <Text style={styles.celebrateText}>🎉 Bravo, tu as fini tes J du jour !</Text>
                </View>
              ) : null}
            </View>
          ) : (
            <Text style={styles.reviewEmpty}>Aucune révision programmée aujourd'hui</Text>
          )}
        </Pressable>
      </ScrollView>

      <Modal visible={showChoice} transparent animationType="fade" onRequestClose={() => setShowChoice(false)}>
        <Pressable style={styles.choiceBackdrop} onPress={() => setShowChoice(false)} />
        <View style={styles.choiceWrap} pointerEvents="box-none">
          <View style={styles.choiceSheet}>
            <Text style={styles.choiceTitle}>Quel ancrage ?</Text>
            <Pressable
              style={styles.choiceBtnRed}
              onPress={() => {
                setShowChoice(false);
                backlogQuiz.mutate();
              }}
              testID="anchor-choice-backlog"
            >
              <Text style={styles.choiceBtnRedText}>Rattraper le retard ({backlog} QCM)</Text>
            </Pressable>
            <Pressable
              style={[styles.choiceBtn, doneToday && { opacity: 0.45 }]}
              disabled={doneToday}
              onPress={() => {
                setShowChoice(false);
                anchor.mutate();
              }}
              testID="anchor-choice-daily"
            >
              <Text style={styles.choiceBtnText}>
                {doneToday ? "Ancrage du jour terminé ✓" : `Ancrage du jour (${todayCount} QCM)`}
              </Text>
            </Pressable>
            <Pressable onPress={() => setShowChoice(false)} style={{ marginTop: 6 }}>
              <Text style={styles.choiceCancel}>Annuler</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
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
  anchorDone: { fontSize: 15, fontFamily: fonts.extrabold, color: colors.onSurface },
  anchorBacklog: { fontSize: 14, fontFamily: fonts.extrabold, color: "#DC2626", marginTop: 4 },
  choiceBackdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(15,23,42,0.45)" },
  choiceWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  choiceSheet: { backgroundColor: colors.surface, borderRadius: 20, padding: 24, width: "100%", maxWidth: 420, gap: 10 },
  choiceTitle: { fontSize: 18, fontFamily: fonts.extrabold, color: colors.onSurface, textAlign: "center", marginBottom: 8 },
  choiceBtn: { backgroundColor: colors.brandPrimary, borderRadius: 14, paddingVertical: 14, alignItems: "center" },
  choiceBtnText: { fontSize: 15, fontFamily: fonts.bold, color: colors.onBrandPrimary },
  choiceBtnRed: { backgroundColor: "#FEE2E2", borderRadius: 14, paddingVertical: 14, alignItems: "center", borderWidth: 1, borderColor: "#DC2626" },
  choiceBtnRedText: { fontSize: 15, fontFamily: fonts.bold, color: "#DC2626" },
  choiceCancel: { textAlign: "center", fontSize: 14, fontFamily: fonts.semibold, color: colors.muted },
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
  jCheckbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  celebrate: {
    marginTop: 4,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    alignItems: "center",
  },
  celebrateText: { fontSize: 14, fontFamily: fonts.bold, color: colors.brandPrimary, textAlign: "center" },
}));
