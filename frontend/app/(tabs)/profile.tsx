import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@react-native-vector-icons/ionicons";

import { apiFetch } from "@/src/api";
import { useAuth } from "@/src/auth";
import { Button } from "@/src/components/button";
import { useToast } from "@/src/components/toast";
import { APP_NAME } from "@/src/config";
import { usesNativeTabs } from "@/src/navigation";
import { fonts, makeStyles, useTheme } from "@/src/theme";

type Attempt = { id: string; title: string; grade_on_20: number; max_points: number; created_at: string };

function fmt(n: number) {
  return Number.isInteger(n) ? `${n}` : n.toFixed(1).replace(".", ",");
}

export default function Profile() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { updateProfile } = useAuth();
  const toast = useToast();
  const bottomChrome = usesNativeTabs ? insets.bottom : 0;

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
              onValueChange={(v) => updateProfile({ show_grade: v }).catch((e) => toast.show(e.message, "error"))}
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
  attemptRow: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.surface, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: colors.border },
  attemptIcon: { width: 40, height: 40, borderRadius: 10, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  attemptTitle: { fontSize: 15, fontFamily: fonts.semibold, color: colors.onSurface },
  attemptMeta: { fontSize: 12, fontFamily: fonts.regular, color: colors.muted, marginTop: 1 },
  attemptGrade: { fontSize: 16, fontFamily: fonts.extrabold, color: colors.brandPrimary },
  hint: { fontSize: 14, fontFamily: fonts.regular, color: colors.muted },
}));
