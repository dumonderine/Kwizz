import { Image } from "expo-image";
import { Link, useRouter } from "expo-router";
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@react-native-vector-icons/ionicons";

import { useAuth } from "@/src/auth";
import { Button } from "@/src/components/button";
import { useToast } from "@/src/components/toast";
import { APP_NAME, APP_TAGLINE } from "@/src/config";
import { fonts, makeStyles, useTheme } from "@/src/theme";

export default function Login() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signIn } = useAuth();
  const toast = useToast();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!email.trim() || !password) {
      toast.show("Renseignez votre email et mot de passe", "error");
      return;
    }
    setLoading(true);
    try {
      const u = await signIn(email.trim(), password);
      router.replace(u.onboarded ? "/(tabs)" : "/(auth)/onboarding");
    } catch (e: any) {
      toast.show(e.message || "Connexion impossible", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.brandRow}>
            <View style={styles.logo}>
              <Ionicons name="school" size={26} color={colors.onBrandPrimary} />
            </View>
            <View>
              <Text style={styles.brandTitle}>{APP_NAME}</Text>
              <Text style={styles.brandSub}>{APP_TAGLINE}</Text>
            </View>
          </View>

          <Text style={styles.h1}>Bon retour 👋</Text>
          <Text style={styles.sub}>Connectez-vous pour réviser vos QCM</Text>

          <View style={styles.field}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              testID="login-email-input"
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="vous@exemple.fr"
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Mot de passe</Text>
            <TextInput
              testID="login-password-input"
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              placeholderTextColor={colors.muted}
              secureTextEntry
            />
          </View>

          <View style={{ height: 8 }} />
          <Button title="Se connecter" onPress={submit} loading={loading} testID="login-submit-button" />

          <View style={styles.footer}>
            <Text style={styles.footerText}>Pas encore de compte ? </Text>
            <Link href="/(auth)/register" style={styles.link} testID="go-register-link">
              Créer un compte
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.surface },
  content: { paddingHorizontal: 24, paddingTop: 32, paddingBottom: 40, gap: 4 },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 40 },
  logo: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  brandTitle: { fontSize: 20, fontFamily: fonts.extrabold, color: colors.onSurface },
  brandSub: { fontSize: 12, fontFamily: fonts.regular, color: colors.muted },
  h1: { fontSize: 26, fontFamily: fonts.extrabold, color: colors.onSurface },
  sub: { fontSize: 15, fontFamily: fonts.regular, color: colors.muted, marginBottom: 24 },
  field: { marginBottom: 16 },
  label: { fontSize: 13, fontFamily: fonts.semibold, color: colors.onSurfaceSecondary, marginBottom: 8 },
  input: {
    height: 52,
    borderRadius: 14,
    backgroundColor: colors.surfaceTertiary,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 16,
    fontSize: 16,
    fontFamily: fonts.regular,
    color: colors.onSurface,
  },
  footer: { flexDirection: "row", justifyContent: "center", marginTop: 24 },
  footerText: { fontSize: 14, fontFamily: fonts.regular, color: colors.muted },
  link: { fontSize: 14, fontFamily: fonts.bold, color: colors.brandPrimary },
}));
