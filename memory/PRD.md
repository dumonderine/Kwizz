# PRD — Kwizz (working name, to be renamed by user)

## Original problem statement
French student (LAS/PASS/EDN) wants to turn a static neurology QCM (HTML) into a full mobile app.
Users deposit their courses (PDF, photos, pasted text) and past exams ("annales"); an AI generates
interactive EDN/PASS-style QCM (multiple correct answers, "Valider" reveals answer + explanation drawn
from the course). Folder/subfolder organisation (e.g. Neurologie › Chapitre 1) holds the sources; a QCM
can be generated from a subfolder or a whole topic. Wrong questions go into an "À revoir" pool tagged by
their exact subfolder AND available globally. A daily "Ancrage" gives ~40 random QCM from all folders.
Onboarding asks the study field (Médecine ⇒ EDN format). A setting toggles whether the grade is shown.
An AI chat lets students ask follow-up questions about the course.

## Architecture
- Backend: FastAPI + MongoDB (motor), JWT auth (email+password, passlib bcrypt).
- AI: Gemini 3.1 Pro (`gemini-3.1-pro-preview`) via emergentintegrations + EMERGENT_LLM_KEY, multimodal
  (PDF + images via FileContentWithMimeType, text inline). Used for QCM generation and course chat.
- Storage: Emergent Managed Object Storage for uploaded PDFs/photos.
- Frontend: Expo Router (tabs: Dossiers / À revoir / Profil; left rail on tablets ≥768px), react-query,
  reanimated-color-picker, Plus Jakarta Sans, sober medical theme (sky/slate) in src/theme.ts.

## User personas
- Med student (EDN/PASS): dense multi-answer QCM, partial EDN scoring, spaced review.
- Other higher-ed / lycée student: generic exam QCM, can hide the grade.

## Core requirements (static)
- Folders + subfolders with customizable color; subfolders inherit a lighter tint. Full colour picker.
- Sources: PDF, photo, pasted text.
- AI QCM generation (EDN or generic per study field); explanations from the course.
- Interactive player: multi-select, Valider to reveal, progress bar, grade only at the end, review missed.
- EDN partial scoring: 0 discordant item=1pt, 1=0.5, 2=0.2, 3+=0.
- "À revoir" per exact subfolder + global; review quiz builder.
- Daily "Ancrage" = up to 40 random questions from all folders, idempotent per day.
- Onboarding study field; settings toggle to show/hide grade.
- AI course chat.

## Implemented (2026-06)
- Email/password auth + onboarding (study field) — DONE
- Folder/subfolder CRUD, colors + derived tints, full color picker, breadcrumb — DONE
- Text/PDF/photo sources (object storage) — DONE
- Gemini QCM generation (folder incl. descendants), EDN/generic prompt — DONE
- Quiz player with progress bar, per-question EDN feedback, final grade, review-missed — DONE
- EDN scoring + attempts history — DONE (backend 21/21 tests pass)
- Review pool grouped by exact subfolder + global "Tout réviser" — DONE
- Daily Ancrage (40 random, idempotent) — DONE
- AI course chat (folder-context + quiz-context) — DONE
- Settings: show/hide grade; graduation-cap logo; tablet left navigation — DONE

## Backlog / next
- P1: streaming chat responses; markdown rendering in chat/explanations.
- P1: in-app PDF/photo source preview.
- P2: spaced-repetition scheduling for review (intervals), streaks for Ancrage.
- P2: share a QCM / export results.
- P2: final app name + custom app icon & splash.
