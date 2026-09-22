import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Modal, Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@react-native-vector-icons/ionicons";

import { apiFetch } from "@/src/api";
import { useAuth } from "@/src/auth";
import { Button } from "@/src/components/button";
import { DEFAULT_J_OFFSETS, JSeriesPicker, seriesLabel } from "@/src/components/j-series-picker";
import { useToast } from "@/src/components/toast";
import { APP_NAME } from "@/src/config";
import { usesNativeTabs } from "@/src/navigation";
import { syncReminders } from "@/src/notifications";
import { fonts, makeStyles, useTheme } from "@/src/theme";

type Attempt = { id: string; title: string; grade_on_20: number; max_points: number; created_at: string };

const HOURS = [7, 8, 9, 12, 18, 20, 21];
const ANCHOR_SIZES = [10, 20, 30, 40, 60, 80, 100];

function fmt(n: number) {
  return Number.isInteger(n) ? `${n}` : n.toFixed(1).replace(".", ",");
}

export default function Profile() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, signOut, updateProfile, refreshUser } = useAuth();
  const toast = useToast();
  const bottomChrome = usesNativeTabs ? insets.bottom : 0;
  const [showPreset, setShowPreset] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [presetOffsets, setPresetOffsets] = useState<number[]>(DEFAULT_J_OFFSETS);

  const patch = (data: Parameters<typeof updateProfile>[0]) =>
    updateProfile(data).then(
      () => undefined,
      (e) => toast.show(e.message, "error"),
    );

  const addPreset = useMutation({
    mutationFn: () => apiFetch("/j/presets", { body: { name: presetName.trim() || seriesLabel(presetOffsets), offsets: presetOffsets } }),
    onSuccess: async () => {
      await refreshUser();
      setShowPreset(false);
      setPresetName("");
      setPresetOffsets(DEFAULT_J_OFFSETS);
      toast.show("Série enregistrée", "success");
    },
    onError: (e: any) => toast.show(e.message, "error"),
  });

  const delPreset = useMutation({
    mutationFn: (pid: string) => apiFetch(`/j/presets/${pid}`, { method: "DELETE" }),
    onSuccess: () => refreshUser(),
  });

  const { data: attempts } = useQuery({
    queryKey: ["attempts"],
    queryFn: () => apiFetch<Attempt[]>("/attempts"),
  });

  const avg =
    attempts && attempts.length
      ? attempts.reduce((a, b) => a + b.grade_on_20, 0) / attempts.length
      : null;

  const logout = async () => {
    await signOut();
    router.replace("/(auth)/login");
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: bottomChrome + 40, gap: 16 }}>
        <View style={styles.profileCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{(user?.name || user?.email || "?")[0].toUpperCase()}</Text>
          </View>
          <Text style={styles.name}>{user?.name || "Étudiant"}</Text>
          <Text style={styles.email}>{user?.email}</Text>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{attempts?.length ?? 0}</Text>
            <Text style={styles.statLabel}>Sessions</Text>
          </View>
          {user?.show_grade !== false ? (
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{avg != null ? fmt(Math.round(avg * 10) / 10) : "–"}</Text>
              <Text style={styles.statLabel}>Moyenne /20</Text>
            </View>
          ) : null}
        </View>

        <Text style={styles.sectionTitle}>Réglages</Text>
        <View style={styles.settingsCard}>
          <View style={styles.settingRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.settingTitle}>Afficher la note</Text>
              <Text style={styles.settingSub}>Voir votre score /20 à la fin des sessions</Text>
            </View>
            <Switch
              testID="toggle-show-grade"
              value={user?.show_grade !== false}
              onValueChange={(v) => patch({ show_grade: v })}
              trackColor={{ true: colors.brandPrimary, false: colors.borderStrong }}
            />
          </View>
          <View style={styles.settingDivider} />
          <View style={styles.settingRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.settingTitle}>Domaine d'études</Text>
              <Text style={styles.settingSub}>{user?.study_field || "Non défini"}</Text>
            </View>
            <Pressable onPress={() => router.push("/(auth)/onboarding")} testID="change-field" hitSlop={8}>
              <Ionicons name="pencil" size={20} color={colors.brandPrimary} />
            </Pressable>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Ancrage du jour</Text>
        <View style={styles.settingsCard}>
          <View style={styles.settingRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.settingTitle}>Activer l'Ancrage</Text>
              <Text style={styles.settingSub}>Carte « Ancrage du jour » sur l'écran Dossiers</Text>
            </View>
            <Switch
              testID="toggle-anchor"
              value={user?.anchor_enabled !== false}
              onValueChange={(v) => patch({ anchor_enabled: v })}
              trackColor={{ true: colors.brandPrimary, false: colors.borderStrong }}
            />
          </View>
          {user?.anchor_enabled !== false ? (
            <>
              <View style={styles.settingDivider} />
              <View style={styles.settingCol}>
                <Text style={styles.settingTitle}>Nombre de QCM par Ancrage</Text>
                <Text style={styles.settingSub}>Tirés au hasard automatiquement chaque jour</Text>
                <View style={styles.chipRow}>
                  {ANCHOR_SIZES.map((n) => {
                    const active = (user?.anchor_size ?? 40) === n;
                    return (
                      <Pressable
                        key={n}
                        style={[styles.chip, active && styles.chipActive]}
                        onPress={() => patch({ anchor_size: n })}
                        testID={`anchor-size-${n}`}
                      >
                        <Text style={[styles.chipText, active && styles.chipTextActive]}>{n}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            </>
          ) : null}
        </View>

        <Text style={styles.sectionTitle}>Méthode des J</Text>
        <View style={styles.settingsCard}>
          <View style={styles.settingCol}>
            <Text style={styles.settingTitle}>Heure des rappels</Text>
            <Text style={styles.settingSub}>Notification le jour de chaque J</Text>
            <View style={styles.chipRow}>
              {HOURS.map((h) => {
                const active = (user?.reminder_hour ?? 9) === h;
                return (
                  <Pressable
                    key={h}
                    style={[styles.chip, active && styles.chipActive]}
                    onPress={() => patch({ reminder_hour: h }).then(() => syncReminders())}
                    testID={`reminder-hour-${h}`}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{h}h</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
          <View style={styles.settingDivider} />
          <View style={styles.settingCol}>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.settingTitle}>Mes séries de J</Text>
                <Text style={styles.settingSub}>Réutilisables sur chaque chapitre</Text>
              </View>
              <Pressable onPress={() => setShowPreset(true)} hitSlop={8} testID="add-preset">
                <Ionicons name="add-circle" size={26} color={colors.brandPrimary} />
              </Pressable>
            </View>
            {user?.j_presets && user.j_presets.length > 0 ? (
              <View style={{ gap: 8, marginTop: 8 }}>
                {user.j_presets.map((p) => (
                  <View key={p.id} style={styles.presetRow} testID={`preset-${p.id}`}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.presetName}>{p.name}</Text>
                      <Text style={styles.presetOffsets}>{seriesLabel(p.offsets)}</Text>
                    </View>
                    <Pressable onPress={() => delPreset.mutate(p.id)} hitSlop={8} testID={`del-preset-${p.id}`}>
                      <Ionicons name="trash-outline" size={20} color={colors.error} />
                    </Pressable>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={[styles.hint, { marginTop: 8 }]}>Aucune série enregistrée. Par défaut : {seriesLabel(DEFAULT_J_OFFSETS)}</Text>
            )}
          </View>
        </View>

        <Text style={styles.sectionTitle}>Historique des sessions</Text>
        {attempts && attempts.length > 0 ? (
          attempts.map((a) => (
            <View key={a.id} style={styles.attemptRow} testID={`attempt-${a.id}`}>
              <View style={styles.attemptIcon}>
                <Ionicons name="document-text-outline" size={20} color={colors.brandPrimary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.attemptTitle} numberOfLines={1}>
                  {a.title}
                </Text>
                <Text style={styles.attemptMeta}>{new Date(a.created_at).toLocaleDateString("fr-FR")}</Text>
              </View>
              <Text style={styles.attemptGrade}>{fmt(a.grade_on_20)}/20</Text>
            </View>
          ))
        ) : (
          <Text style={styles.hint}>Aucune session pour le moment.</Text>
        )}

        <View style={{ height: 8 }} />
        <Button title="Se déconnecter" variant="outline" icon="log-out-outline" onPress={logout} testID="logout-button" />
      </ScrollView>

      <Modal visible={showPreset} transparent animationType="slide" onRequestClose={() => setShowPreset(false)}>
        <Pressable style={styles.backdrop} onPress={() => setShowPreset(false)} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.sheetTitle}>Nouvelle série de J</Text>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
            <TextInput
              style={styles.input}
              value={presetName}
              onChangeText={setPresetName}
              placeholder="Nom (ex : Ma méthode)"
              placeholderTextColor={colors.muted}
              testID="preset-name"
            />
            <JSeriesPicker value={presetOffsets} onChange={setPresetOffsets} allowSave={false} />
            <View style={{ height: 4 }} />
            <Button
              title="Enregistrer la série"
              onPress={() => addPreset.mutate()}
              loading={addPreset.isPending}
              disabled={presetOffsets.length === 0}
              testID="preset-submit"
            />
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.surfaceSecondary },
  profileCard: { backgroundColor: colors.surface, borderRadius: 20, padding: 24, alignItems: "center", borderWidth: 1, borderColor: colors.border },
  avatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  avatarText: { fontSize: 30, fontFamily: fonts.extrabold, color: colors.onBrandPrimary },
  name: { fontSize: 20, fontFamily: fonts.extrabold, color: colors.onSurface },
  email: { fontSize: 14, fontFamily: fonts.regular, color: colors.muted, marginTop: 2 },
  statsRow: { flexDirection: "row", gap: 12 },
  statCard: { flex: 1, backgroundColor: colors.surface, borderRadius: 16, padding: 18, alignItems: "center", borderWidth: 1, borderColor: colors.border },
  statValue: { fontSize: 28, fontFamily: fonts.extrabold, color: colors.brandPrimary },
  statLabel: { fontSize: 13, fontFamily: fonts.regular, color: colors.muted, marginTop: 2 },
  sectionTitle: { fontSize: 16, fontFamily: fonts.bold, color: colors.onSurface, marginTop: 8 },
  settingsCard: { backgroundColor: colors.surface, borderRadius: 16, paddingHorizontal: 16, borderWidth: 1, borderColor: colors.border },
  settingRow: { flexDirection: "row", alignItems: "center", paddingVertical: 16, gap: 12 },
  settingTitle: { fontSize: 15, fontFamily: fonts.semibold, color: colors.onSurface },
  settingSub: { fontSize: 13, fontFamily: fonts.regular, color: colors.muted, marginTop: 2 },
  settingDivider: { height: 1, backgroundColor: colors.divider },
  settingCol: { paddingVertical: 16, gap: 2 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  chip: { minWidth: 48, height: 38, paddingHorizontal: 12, borderRadius: 12, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { fontSize: 14, fontFamily: fonts.bold, color: colors.onSurfaceSecondary },
  chipTextActive: { color: colors.onBrandPrimary },
  presetRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 12, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  presetName: { fontSize: 14, fontFamily: fonts.semibold, color: colors.onSurface },
  presetOffsets: { fontSize: 12, fontFamily: fonts.regular, color: colors.muted, marginTop: 1 },
  backdrop: { flex: 1, backgroundColor: "rgba(15,23,42,0.4)" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 24, paddingTop: 12, paddingBottom: 32, maxHeight: "88%" },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, alignSelf: "center", marginBottom: 16 },
  sheetTitle: { fontSize: 20, fontFamily: fonts.extrabold, color: colors.onSurface, marginBottom: 16 },
  input: { height: 52, borderRadius: 14, backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 16, fontSize: 16, fontFamily: fonts.regular, color: colors.onSurface },
  attemptRow: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.surface, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: colors.border },
  attemptIcon: { width: 40, height: 40, borderRadius: 10, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  attemptTitle: { fontSize: 15, fontFamily: fonts.semibold, color: colors.onSurface },
  attemptMeta: { fontSize: 12, fontFamily: fonts.regular, color: colors.muted, marginTop: 1 },
  attemptGrade: { fontSize: 16, fontFamily: fonts.extrabold, color: colors.brandPrimary },
  hint: { fontSize: 14, fontFamily: fonts.regular, color: colors.muted },
}));
