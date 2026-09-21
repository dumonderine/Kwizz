import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@react-native-vector-icons/ionicons";

import { apiFetch } from "@/src/api";
import { DEFAULT_FOLDER_COLOR, tintBg } from "@/src/colors";
import { FolderFormModal } from "@/src/components/folder-form-modal";
import { useToast } from "@/src/components/toast";
import { usesNativeTabs } from "@/src/navigation";
import { fonts, makeStyles, useTheme } from "@/src/theme";

type Folder = {
  id: string;
  name: string;
  color?: string;
  subfolder_count: number;
  source_count: number;
};

export default function Dossiers() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);

  const bottomChrome = usesNativeTabs ? insets.bottom : 0;

  const { data: folders, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["folders", null],
    queryFn: () => apiFetch<Folder[]>("/folders"),
  });

  const anchor = useMutation({
    mutationFn: () => apiFetch<{ id: string }>("/anchor/daily", { body: {} }),
    onSuccess: (quiz) => router.push(`/quiz/play?quizId=${quiz.id}`),
    onError: (e: any) => toast.show(e.message, "error"),
  });

  const AnchorCard = (
    <Pressable
      testID="anchor-card"
      style={({ pressed }) => [styles.anchorCard, pressed && styles.pressed]}
      onPress={() => !anchor.isPending && anchor.mutate()}
    >
      <View style={styles.anchorIcon}>
        {anchor.isPending ? (
          <ActivityIndicator color={colors.onBrandSecondary} />
        ) : (
          <Ionicons name="flame" size={26} color={colors.onBrandSecondary} />
        )}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.anchorTitle}>Ancrage du jour</Text>
        <Text style={styles.anchorSub}>40 QCM tirés au hasard dans toutes vos matières</Text>
      </View>
      <Ionicons name="play-circle" size={30} color={colors.onBrandSecondary} />
    </Pressable>
  );

  const create = useMutation({
    mutationFn: (vars: { name: string; color: string }) =>
      apiFetch("/folders", { body: { name: vars.name, color: vars.color } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["folders", null] });
      toast.show("Dossier créé", "success");
    },
    onError: (e: any) => toast.show(e.message, "error"),
  });

  const renderItem = ({ item }: { item: Folder }) => {
    const color = item.color || DEFAULT_FOLDER_COLOR;
    return (
      <Pressable
        testID={`folder-card-${item.id}`}
        style={({ pressed }) => [styles.card, { borderLeftColor: color }, pressed && styles.pressed]}
        onPress={() => router.push(`/folder/${item.id}`)}
      >
        <View style={[styles.iconWell, { backgroundColor: tintBg(color) }]}>
          <Ionicons name="folder" size={24} color={color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={styles.cardMeta}>
            {item.subfolder_count} sous-dossier{item.subfolder_count > 1 ? "s" : ""} · {item.source_count}{" "}
            source{item.source_count > 1 ? "s" : ""}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.muted} />
      </Pressable>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>MES MATIÈRES</Text>
          <Text style={styles.h1}>Dossiers</Text>
        </View>
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.brandPrimary} />
        </View>
      ) : isError ? (
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={48} color={colors.muted} />
          <Text style={styles.emptyText}>Erreur de chargement des dossiers</Text>
          <Pressable onPress={() => refetch()} testID="retry-folders">
            <Text style={styles.retry}>Réessayer</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={folders}
          keyExtractor={(f) => f.id}
          renderItem={renderItem}
          ListHeaderComponent={AnchorCard}
          contentContainerStyle={{ padding: 16, paddingBottom: bottomChrome + 100, gap: 12 }}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.brandPrimary} />}
          ListEmptyComponent={
            <View style={styles.center}>
              <View style={styles.emptyIcon}>
                <Ionicons name="documents-outline" size={40} color={colors.brandPrimary} />
              </View>
              <Text style={styles.emptyTitle}>Aucun dossier</Text>
              <Text style={styles.emptyText}>Créez votre première matière pour commencer.</Text>
            </View>
          }
        />
      )}

      <Pressable
        testID="create-folder-fab"
        style={[styles.fab, { bottom: bottomChrome + 16 }]}
        onPress={() => setShowCreate(true)}
      >
        <Ionicons name="add" size={28} color={colors.onBrandPrimary} />
        <Text style={styles.fabText}>Nouveau dossier</Text>
      </Pressable>

      <FolderFormModal
        visible={showCreate}
        onClose={() => setShowCreate(false)}
        onSubmit={(name, color) => create.mutateAsync({ name, color })}
        title="Nouveau dossier"
        defaultColor={DEFAULT_FOLDER_COLOR}
      />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.surfaceSecondary },
  header: { paddingHorizontal: 16, paddingBottom: 8 },
  eyebrow: { fontSize: 12, fontFamily: fonts.bold, color: colors.muted, letterSpacing: 1 },
  h1: { fontSize: 30, fontFamily: fonts.extrabold, color: colors.onSurface },
  center: { alignItems: "center", justifyContent: "center", paddingTop: 80, gap: 12 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 14,
    borderLeftWidth: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pressed: { opacity: 0.7 },
  anchorCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: colors.brandSecondary,
    borderRadius: 18,
    padding: 18,
  },
  anchorIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  anchorTitle: { fontSize: 17, fontFamily: fonts.extrabold, color: colors.onBrandSecondary },
  anchorSub: { fontSize: 13, fontFamily: fonts.regular, color: "rgba(255,255,255,0.8)", marginTop: 2 },
  iconWell: { width: 46, height: 46, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  cardTitle: { fontSize: 17, fontFamily: fonts.bold, color: colors.onSurface },
  cardMeta: { fontSize: 13, fontFamily: fonts.regular, color: colors.muted, marginTop: 2 },
  emptyIcon: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: colors.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  emptyTitle: { fontSize: 18, fontFamily: fonts.bold, color: colors.onSurface },
  emptyText: { fontSize: 14, fontFamily: fonts.regular, color: colors.muted, textAlign: "center", paddingHorizontal: 40 },
  retry: { fontSize: 15, fontFamily: fonts.bold, color: colors.brandPrimary, marginTop: 4 },
  fab: {
    position: "absolute",
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.brandPrimary,
    paddingLeft: 14,
    paddingRight: 20,
    height: 54,
    borderRadius: 27,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  fabText: { color: colors.onBrandPrimary, fontFamily: fonts.bold, fontSize: 15 },
}));
