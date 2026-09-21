import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@react-native-vector-icons/ionicons";

import { apiFetch } from "@/src/api";
import { useToast } from "@/src/components/toast";
import { usesNativeTabs } from "@/src/navigation";
import { fonts, makeStyles, useTheme } from "@/src/theme";

type Topic = { topic_folder_id: string | null; topic_name: string; count: number };
type TopicsResp = { total: number; topics: Topic[] };

export default function Review() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const bottomChrome = usesNativeTabs ? insets.bottom : 0;

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["review-topics"],
    queryFn: () => apiFetch<TopicsResp>("/review/topics"),
  });

  const startReview = useMutation({
    mutationFn: (topicId: string | null) =>
      apiFetch<{ id: string }>("/review/quiz", { body: topicId ? { topic_folder_id: topicId } : {} }),
    onSuccess: (quiz) => {
      qc.invalidateQueries({ queryKey: ["review-topics"] });
      router.push(`/quiz/play?quizId=${quiz.id}`);
    },
    onError: (e: any) => toast.show(e.message, "error"),
  });

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>MÉMORISATION</Text>
        <Text style={styles.h1}>QCM à revoir</Text>
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.brandPrimary} />
        </View>
      ) : isError ? (
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={48} color={colors.muted} />
          <Text style={styles.emptyText}>Erreur de chargement</Text>
          <Pressable onPress={() => refetch()}>
            <Text style={styles.retry}>Réessayer</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: bottomChrome + 40, gap: 12 }}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.brandPrimary} />}
        >
          {data && data.total > 0 ? (
            <>
              <Pressable
                style={styles.globalCard}
                onPress={() => startReview.mutate(null)}
                testID="review-all"
                disabled={startReview.isPending}
              >
                <View style={styles.globalIcon}>
                  {startReview.isPending && startReview.variables === null ? (
                    <ActivityIndicator color={colors.onBrandPrimary} />
                  ) : (
                    <Ionicons name="refresh-circle" size={28} color={colors.onBrandPrimary} />
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.globalTitle}>Tout réviser</Text>
                  <Text style={styles.globalMeta}>{data.total} question(s) toutes matières confondues</Text>
                </View>
                <Ionicons name="play" size={22} color={colors.onBrandPrimary} />
              </Pressable>

              <Text style={styles.sectionTitle}>Par matière</Text>
              {data.topics.map((t) => (
                <Pressable
                  key={t.topic_folder_id || "general"}
                  style={styles.row}
                  onPress={() => startReview.mutate(t.topic_folder_id)}
                  testID={`review-topic-${t.topic_folder_id || "general"}`}
                  disabled={startReview.isPending}
                >
                  <View style={styles.rowIcon}>
                    <Ionicons name="albums-outline" size={22} color={colors.brandPrimary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{t.topic_name}</Text>
                    <Text style={styles.rowMeta}>{t.count} question(s) à revoir</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={colors.muted} />
                </Pressable>
              ))}
            </>
          ) : (
            <View style={styles.center}>
              <View style={styles.emptyIcon}>
                <Ionicons name="checkmark-done-circle-outline" size={44} color={colors.success} />
              </View>
              <Text style={styles.emptyTitle}>Rien à revoir 🎉</Text>
              <Text style={styles.emptyText}>
                Les questions ratées dans vos QCM apparaîtront ici automatiquement.
              </Text>
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.surfaceSecondary },
  header: { paddingHorizontal: 16, paddingBottom: 8 },
  eyebrow: { fontSize: 12, fontFamily: fonts.bold, color: colors.muted, letterSpacing: 1 },
  h1: { fontSize: 30, fontFamily: fonts.extrabold, color: colors.onSurface },
  center: { alignItems: "center", justifyContent: "center", paddingTop: 80, gap: 12 },
  globalCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: colors.brandPrimary,
    borderRadius: 18,
    padding: 18,
  },
  globalIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center" },
  globalTitle: { fontSize: 18, fontFamily: fonts.extrabold, color: colors.onBrandPrimary },
  globalMeta: { fontSize: 13, fontFamily: fonts.regular, color: "rgba(255,255,255,0.85)", marginTop: 2 },
  sectionTitle: { fontSize: 15, fontFamily: fonts.bold, color: colors.onSurfaceSecondary, marginTop: 12, marginBottom: 2 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  rowTitle: { fontSize: 16, fontFamily: fonts.bold, color: colors.onSurface },
  rowMeta: { fontSize: 13, fontFamily: fonts.regular, color: colors.muted, marginTop: 1 },
  emptyIcon: { width: 88, height: 88, borderRadius: 44, backgroundColor: colors.successSurface, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  emptyTitle: { fontSize: 18, fontFamily: fonts.bold, color: colors.onSurface },
  emptyText: { fontSize: 14, fontFamily: fonts.regular, color: colors.muted, textAlign: "center", paddingHorizontal: 40, lineHeight: 20 },
  retry: { fontSize: 15, fontFamily: fonts.bold, color: colors.brandPrimary },
}));
