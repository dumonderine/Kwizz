// Local "Méthode des J" reminders scheduled on the device (no push server).
// Web preview: no-op. Requires a real build to actually fire on device.
import { Alert, Linking, Platform } from "react-native";

import { apiFetch } from "@/src/api";

type Upcoming = {
  reminder_hour: number;
  events: { id: string; date: string; label: string; folder_id: string; folder_name: string; topic_name: string }[];
};

function lib(): typeof import("expo-notifications") | null {
  if (Platform.OS === "web") return null;
  try {
    return require("expo-notifications");
  } catch {
    return null;
  }
}

export async function hasReminderPermission(): Promise<boolean> {
  const N = lib();
  if (!N) return false;
  try {
    const s = await N.getPermissionsAsync();
    return s.granted;
  } catch {
    return false;
  }
}

// Contextual request: explain first, request at most once more, then point to settings.
export async function requestReminderPermission(): Promise<boolean> {
  const N = lib();
  if (!N) return false;
  try {
    const current = await N.getPermissionsAsync();
    if (current.granted) return true;
    if (!current.canAskAgain) {
      Alert.alert(
        "Notifications désactivées",
        "Pour recevoir vos rappels J, autorisez les notifications de Kwizz dans les réglages.",
        [{ text: "Plus tard", style: "cancel" }, { text: "Ouvrir les réglages", onPress: () => Linking.openSettings() }],
      );
      return false;
    }
    const ok = await new Promise<boolean>((resolve) =>
      Alert.alert(
        "Activer les rappels J ?",
        "Kwizz vous enverra une notification le jour de chaque J (J1, J3, J7…) pour revoir le chapitre.",
        [
          { text: "Pas maintenant", style: "cancel", onPress: () => resolve(false) },
          { text: "Activer", onPress: () => resolve(true) },
        ],
      ),
    );
    if (!ok) return false;
    const res = await N.requestPermissionsAsync();
    return res.granted;
  } catch {
    return false;
  }
}

// Re-schedule every upcoming reminder from the server (idempotent).
export async function syncReminders(): Promise<void> {
  const N = lib();
  if (!N) return;
  try {
    if (!(await hasReminderPermission())) return;
    if (Platform.OS === "android") {
      await N.setNotificationChannelAsync("j-reminders", {
        name: "Rappels J",
        importance: N.AndroidImportance.HIGH,
      });
    }
    const data = await apiFetch<Upcoming>("/j/upcoming");
    await N.cancelAllScheduledNotificationsAsync();
    const now = Date.now();
    for (const ev of data.events) {
      const [y, m, d] = ev.date.split("-").map(Number);
      const when = new Date(y, m - 1, d, data.reminder_hour, 0, 0);
      if (when.getTime() <= now) continue;
      await N.scheduleNotificationAsync({
        content: {
          title: `${ev.label} · ${ev.topic_name}`,
          body: `C'est le jour de revoir « ${ev.folder_name} » 🎓`,
          data: { folder_id: ev.folder_id },
          sound: "default",
        },
        trigger: {
          type: N.SchedulableTriggerInputTypes.DATE,
          date: when,
          ...(Platform.OS === "android" ? { channelId: "j-reminders" } : {}),
        } as any,
      });
    }
  } catch {
    // Expo Go / unsupported platform: reminders silently unavailable.
  }
}

export function setupNotificationHandler() {
  const N = lib();
  if (!N) return;
  try {
    N.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
  } catch {
    // ignore
  }
}
