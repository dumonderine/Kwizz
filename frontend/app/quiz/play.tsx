import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@react-native-vector-icons/ionicons";

import { storage } from "@/src/utils/storage";
import { useAuth } from "@/src/auth";
import { Button } from "@/src/components/button";
import { useToast } from "@/src/components/toast";
import { fonts, makeStyles, useTheme } from "@/src/theme";

type Question = {
  id: string;
  q: string;
  options: Record<string, string>;
  correct: string[];
  explanation: string;
};
type Quiz = { id: string; title: string; kind: string; folder_id: string | null; questions: Question[] };
type SubmitResult = {
  total_points: number;
  max_points: number;
  grade_on_20: number;
  review_added: number;
  results: { question_id: string; selected: string[]; correct: string[]; points: number; discordance: number }[];
};

function discordanceCount(sel: string[], cor: string[], letters: string[]) {
  const s = new Set(sel);
  const c = new Set(cor);
  return letters.filter((l) => s.has(l) !== c.has(l)).length;
}
function pointsFor(d: number) {
  return d === 0 ? 1 : d === 1 ? 0.5 : d === 2 ? 0.2 : 0;
}
function fmt(n: number) {
  return Number.isInteger(n) ? `${n}` : n.toFixed(1).replace(".", ",");
}
function shuffleOptions(q: Question): Question {
  const letters = Object.keys(q.options);
  const texts = letters.map((l) => q.options[l]);
  const correctTexts = new Set(q.correct.map((l) => q.options[l]));
  for (let i = texts.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [texts[i], texts[j]] = [texts[j], texts[i]];
  }
  const options: Record<string, string> = {};
  const correct: string[] = [];
  letters.forEach((l, i) => {
    options[l] = texts[i];
    if (correctTexts.has(texts[i])) correct.push(l);
  });
  return { ...q, options, correct };
}
function progressKey(id: string) {
  return `quiz_progress_${id}`;
}

export default function QuizPlay() {
  const { quizId } = useLocalSearchParams<{ quizId: string }>();
  const styles = useStyles();
  const { colors } = useTheme();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();

  const { data: quiz, isLoading, isError } = useQuery({
    queryKey: ["quiz", quizId],
    queryFn: () => apiFetch<Quiz>(`/quizzes/${quizId}`),
  });

  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [answered, setAnswered] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [finished, setFinished] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [showMissed, setShowMissed] = useState(false);
  const [flagged, setFlagged] = useState<Record<string, boolean>>({});
  const flagReview = useMutation({
    mutationFn: (questionId: string) =>
      apiFetch("/quizzes/flag-review", { body: { quiz_id: quizId, question_id: questionId } }),
    onSuccess: (_data, questionId) => {
      setFlagged((prev) => ({ ...prev, [questionId]: true }));
      qc.invalidateQueries({ queryKey: ["review-topics"] });
    },
    onError: (e: any) => toast.show(e.message || "Erreur", "error"),
  });

    const questions = useMemo(() => (quiz?.questions || []).map(shuffleOptions), [quiz?.id]);

  useEffect(() => {
    if (!quiz) return;
    (async () => {
      const raw = await storage.getItem<string>(progressKey(quiz.id), "");
      if (!raw) return;
      try {
        const saved = JSON.parse(raw) as { index: number; answers: Record<string, string[]> };
        if (saved.index > 0 && saved.index < quiz.questions.length) {
          setIndex(saved.index);
          setAnswers(saved.answers || {});
        }
      } catch {}
    })();
  }, [quiz?.id]);

  const current = questions[index];
  const letters = useMemo(() => (current ? Object.keys(current.options) : []), [current]);
  const total = questions.length;

  const toggle = (letter: string) => {
    if (answered) return;
    Haptics.selectionAsync().catch(() => {});
    setSelected((prev) => (prev.includes(letter) ? prev.filter((l) => l !== letter) : [...prev, letter]));
  };

    const validate = () => {
    if (selected.length === 0 || !current) return;
    setAnswered(true);
    const newAnswers = { ...answers, [current.id]: selected };
    setAnswers(newAnswers);
    storage.setItem(progressKey(quizId!), JSON.stringify({ index: index + 1, answers: newAnswers })).catch(() => {});
    const d = discordanceCount(selected, current.correct, letters);
    if (d === 0) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    else Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    apiFetch("/quizzes/answer", { body: { quiz_id: quizId, question_id: current.id, selected } }).catch(() => {});
  };

  const submitAll = async (finalAnswers: Record<string, string[]>) => {
    setSubmitting(true);
    try {
      const res = await apiFetch<SubmitResult>("/quizzes/submit", { body: { quiz_id: quizId, answers: finalAnswers } });
      setResult(res);
      setFinished(true);
      qc.invalidateQueries({ queryKey: ["review-topics"] });
            qc.invalidateQueries({ queryKey: ["attempts"] });
      storage.removeItem(progressKey(quizId!)).catch(() => {});
    } catch (e: any) {
      toast.show(e.message || "Erreur d'enregistrement", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const next = () => {
    if (index + 1 < total) {
      setIndex((i) => i + 1);
      setSelected([]);
      setAnswered(false);
    } else {
      submitAll({ ...answers, [current.id]: selected });
    }
  };

  const askAI = () => {
    if (!current) return;
    const ctx = `Question: ${current.q}\n${letters.map((l) => `${l}. ${current.options[l]}`).join("\n")}`;
    router.push(`/chat?folderId=${quiz?.folder_id || ""}&context=${encodeURIComponent(ctx)}`);
  };

  if (isLoading || submitting) {
    return (
      <View style={styles.centerScreen}>
        <ActivityIndicator size="large" color={colors.brandPrimary} />
        <Text style={styles.loadingText}>{submitting ? "Calcul de la note…" : "Chargement…"}</Text>
      </View>
    );
  }
  if (isError || !quiz || total === 0) {
    return (
      <View style={styles.centerScreen}>
        <Ionicons name="alert-circle-outline" size={48} color={colors.muted} />
        <Text style={styles.loadingText}>Erreur de chargement du QCM</Text>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.retry}>Retour</Text>
        </Pressable>
      </View>
    );
  }

  // ---------- RESULTS SCREEN ----------
  if (finished && result) {
    const pct = result.max_points ? (result.total_points / result.max_points) * 100 : 0;
    const showGrade = user?.show_grade !== false;
    const perfect = result.results.filter((r) => r.points === 1).length;
    const feedback =
      pct >= 85
        ? "Excellent ! Vous maîtrisez ce chapitre. 👏"
        : pct >= 50
        ? "Bon travail, encore quelques pièges à consolider. 👍"
        : "Des révisions sont conseillées pour maîtriser les pièges. 💪";
    const missed = result.results.filter((r) => r.points < 1);
    const byId: Record<string, Question> = Object.fromEntries(questions.map((q) => [q.id, q]));

    return (
      <View style={styles.container}>
        <ScrollView contentContainerStyle={{ padding: 24, paddingTop: insets.top + 24, paddingBottom: insets.bottom + 120, gap: 16 }}>
          <View style={styles.resultHero}>
            <Text style={styles.resultLabel}>SESSION TERMINÉE</Text>
            {showGrade ? (
              <>
                <Text style={styles.grade} testID="final-grade">
                  {fmt(result.grade_on_20)}
                  <Text style={styles.gradeMax}> / 20</Text>
                </Text>
                <Text style={styles.resultPoints}>
                  {fmt(result.total_points)} / {result.max_points} points
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.grade} testID="final-grade">
                  {perfect}
                  <Text style={styles.gradeMax}> / {result.max_points}</Text>
                </Text>
                <Text style={styles.resultPoints}>questions parfaites</Text>
              </>
            )}
          </View>
          {showGrade ? <Text style={styles.feedback}>{feedback}</Text> : null}

          {result.review_added > 0 ? (
            <View style={styles.reviewBanner} testID="review-banner">
              <Ionicons name="refresh-circle" size={22} color={colors.warning} />
              <Text style={styles.reviewText}>
                {result.review_added} question{result.review_added > 1 ? "s" : ""} ajoutée
                {result.review_added > 1 ? "s" : ""} aux « QCM à revoir »
              </Text>
            </View>
          ) : null}

          {missed.length > 0 ? (
            <Pressable style={styles.toggleMissed} onPress={() => setShowMissed((v) => !v)} testID="toggle-missed">
              <Ionicons name={showMissed ? "eye-off-outline" : "eye-outline"} size={20} color={colors.brandPrimary} />
              <Text style={styles.toggleMissedText}>
                {showMissed ? "Masquer" : "Revoir"} les {missed.length} question(s) ratée(s)
              </Text>
            </Pressable>
          ) : null}

          {showMissed
            ? missed.map((r) => {
                const q = byId[r.question_id];
                if (!q) return null;
                const ql = Object.keys(q.options);
                return (
                  <View key={r.question_id} style={styles.missedCard}>
                    <Text style={styles.missedPts}>{fmt(r.points)} pt</Text>
                    <Text style={styles.missedQ}>{q.q}</Text>
                    {ql.map((l) => {
                      const isCorrect = q.correct.includes(l);
                      const wasSel = r.selected.includes(l);
                      return (
                        <View key={l} style={styles.missedOpt}>
                          <Ionicons
                            name={isCorrect ? "checkmark-circle" : wasSel ? "close-circle" : "ellipse-outline"}
                            size={16}
                            color={isCorrect ? colors.success : wasSel ? colors.error : colors.muted}
                          />
                          <Text style={[styles.missedOptText, isCorrect && { color: colors.success, fontFamily: fonts.semibold }]}>
                            {l}. {q.options[l]}
                          </Text>
                        </View>
                      );
                    })}
                    <Text style={styles.missedExp}>{q.explanation}</Text>
                  </View>
                );
              })
            : null}
        </ScrollView>
        <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]}>
          <Button title="Terminer" onPress={() => router.back()} testID="finish-button" />
        </View>
      </View>
    );
  }

  // ---------- PLAYER SCREEN ----------
  const progress = ((answered ? index + 1 : index) / total) * 100;
  const dCount = answered ? discordanceCount(selected, current.correct, letters) : 0;
  const earned = answered ? pointsFor(dCount) : 0;
  const showGrade = user?.show_grade !== false;
  const ptTxt = showGrade ? ` · +${fmt(earned)} pt` : "";

  const optStyle = (letter: string) => {
    if (!answered) return selected.includes(letter) ? styles.optSelected : styles.opt;
    const isCorrect = current.correct.includes(letter);
    const isSel = selected.includes(letter);
    if (isCorrect && isSel) return styles.optSuccess;
    if (!isCorrect && isSel) return styles.optError;
    if (isCorrect && !isSel) return styles.optWarning;
    return styles.optMuted;
  };

  return (
    <View style={styles.container}>
      {/* Header + progress */}
      <View style={[styles.playerHeader, { paddingTop: insets.top + 8 }]}>
        <View style={styles.playerTopRow}>
          <Pressable onPress={() => router.back()} hitSlop={10} testID="quiz-close">
            <Ionicons name="close" size={26} color={colors.onSurface} />
          </Pressable>
          <Text style={styles.progressLabel}>
            Question {index + 1} / {total}
          </Text>
          <View style={{ width: 26 }} />
        </View>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress}%` }]} testID="progress-fill" />
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 200 }} showsVerticalScrollIndicator={false}>
        <Text style={styles.question} testID="question-text">
          {current.q}
        </Text>

        <View style={{ gap: 10, marginTop: 16 }}>
          {letters.map((l) => (
            <Pressable key={l} style={optStyle(l)} onPress={() => toggle(l)} testID={`option-${l}`}>
              <View style={styles.optRow}>
                <View style={[styles.checkbox, selected.includes(l) && styles.checkboxOn]}>
                  {selected.includes(l) ? <Ionicons name="checkmark" size={14} color="#000" /> : null}
                </View>
                <Text style={styles.optLetter}>{l}.</Text>
                <Text style={styles.optText}>{current.options[l]}</Text>
              </View>
            </Pressable>
          ))}
        </View>

        {answered ? (
          <View style={[styles.explBox, dCount === 0 ? styles.explSuccess : styles.explWarning]}>
            <Text style={[styles.explHeader, { color: dCount === 0 ? colors.success : colors.warning }]}>
              {dCount === 0
                ? `✅ Bonne réponse${ptTxt}`
                : `⚠️ ${dCount} discordance${dCount > 1 ? "s" : ""}${ptTxt} (attendu : ${current.correct.join(", ")})`}
            </Text>
            <Text style={styles.explText}>{current.explanation}</Text>
              {dCount === 0 ? (
              <Pressable
                style={styles.askAI}
                onPress={() => !flagged[current.id] && flagReview.mutate(current.id)}
                disabled={flagged[current.id] || flagReview.isPending}
                testID="flag-review"
              >
                <Ionicons
                  name={flagged[current.id] ? "checkmark-circle" : "add-circle-outline"}
                  size={16}
                  color={colors.brandPrimary}
                />
                <Text style={styles.askAIText}>
                  {flagged[current.id] ? "Ajoutée aux QCM à revoir" : "Ajouter quand même aux QCM à revoir"}
                </Text>
              </Pressable>
            ) : null}
            <Pressable style={styles.askAI} onPress={askAI} testID="ask-ai-inline">
              <Ionicons name="sparkles" size={16} color={colors.brandPrimary} />
              <Text style={styles.askAIText}>Demander plus d'explications à l'IA</Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>

      {/* Sticky CTA */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]}>
        {!answered ? (
          <Button
            title="Valider la réponse"
            onPress={validate}
            disabled={selected.length === 0}
            testID="validate-button"
          />
        ) : (
          <Button
            title={index + 1 < total ? "Question suivante" : "Voir la note finale"}
            icon="arrow-forward"
            onPress={next}
            testID="next-button"
          />
        )}
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.surfaceSecondary },
  centerScreen: { flex: 1, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", gap: 14 },
  loadingText: { fontSize: 15, fontFamily: fonts.semibold, color: colors.muted },
  retry: { fontSize: 15, fontFamily: fonts.bold, color: colors.brandPrimary },

  playerHeader: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  playerTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  progressLabel: { fontSize: 13, fontFamily: fonts.bold, color: colors.onSurfaceSecondary },
  progressTrack: { height: 8, borderRadius: 4, backgroundColor: colors.surfaceTertiary, overflow: "hidden" },
  progressFill: { height: 8, borderRadius: 4, backgroundColor: colors.brandPrimary },

  question: { fontSize: 19, fontFamily: fonts.bold, color: colors.onSurface, lineHeight: 27 },

  opt: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 2,
    borderColor: colors.border,
  },
  optSelected: {
    backgroundColor: colors.brandTertiary,
    borderRadius: 14,
    padding: 14,
    borderWidth: 2,
    borderColor: colors.brandPrimary,
  },
  optSuccess: { backgroundColor: colors.successSurface, borderRadius: 14, padding: 14, borderWidth: 2, borderColor: colors.success },
  optError: { backgroundColor: colors.errorSurface, borderRadius: 14, padding: 14, borderWidth: 2, borderColor: colors.error },
  optWarning: { backgroundColor: colors.successSurface, borderRadius: 14, padding: 14, borderWidth: 2, borderColor: colors.warning, borderStyle: "dashed" },
  optMuted: { backgroundColor: colors.surface, borderRadius: 14, padding: 14, borderWidth: 2, borderColor: colors.border, opacity: 0.55 },
  optRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  checkboxOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  optLetter: { fontSize: 15, fontFamily: fonts.extrabold, color: colors.brandSecondary },
  optText: { flex: 1, fontSize: 15, fontFamily: fonts.regular, color: colors.onSurface, lineHeight: 21 },

  explBox: { marginTop: 20, borderRadius: 16, padding: 16, borderWidth: 1 },
  explSuccess: { backgroundColor: colors.successSurface, borderColor: colors.success },
  explWarning: { backgroundColor: colors.warningSurface, borderColor: colors.warning },
  explHeader: { fontSize: 15, fontFamily: fonts.extrabold, marginBottom: 8 },
  explText: { fontSize: 14, fontFamily: fonts.regular, color: colors.onSurface, lineHeight: 21 },
  askAI: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 14 },
  askAIText: { fontSize: 14, fontFamily: fonts.bold, color: colors.brandPrimary },

  bottomBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },

  resultHero: {
    backgroundColor: colors.brandSecondary,
    borderRadius: 24,
    padding: 28,
    alignItems: "center",
  },
  resultLabel: { fontSize: 12, fontFamily: fonts.bold, color: "rgba(255,255,255,0.7)", letterSpacing: 1.5 },
  grade: { fontSize: 56, fontFamily: fonts.extrabold, color: "#fff", marginTop: 8 },
  gradeMax: { fontSize: 26, fontFamily: fonts.bold, color: "rgba(255,255,255,0.7)" },
  resultPoints: { fontSize: 15, fontFamily: fonts.semibold, color: "rgba(255,255,255,0.85)", marginTop: 4 },
  feedback: { fontSize: 16, fontFamily: fonts.regular, color: colors.onSurfaceSecondary, textAlign: "center", lineHeight: 23 },
  reviewBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.warningSurface,
    borderRadius: 14,
    padding: 14,
  },
  reviewText: { flex: 1, fontSize: 14, fontFamily: fonts.semibold, color: colors.warning },
  toggleMissed: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 8 },
  toggleMissedText: { fontSize: 15, fontFamily: fonts.bold, color: colors.brandPrimary },
  missedCard: { backgroundColor: colors.surface, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.border, gap: 6 },
  missedPts: { fontSize: 12, fontFamily: fonts.bold, color: colors.warning },
  missedQ: { fontSize: 15, fontFamily: fonts.bold, color: colors.onSurface, lineHeight: 21, marginBottom: 4 },
  missedOpt: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  missedOptText: { flex: 1, fontSize: 13, fontFamily: fonts.regular, color: colors.onSurfaceSecondary, lineHeight: 19 },
  missedExp: { fontSize: 13, fontFamily: fonts.regular, color: colors.muted, fontStyle: "italic", marginTop: 6, lineHeight: 19 },
}));
