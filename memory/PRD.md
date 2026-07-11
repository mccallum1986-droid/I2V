# WanStudio — AI Image-to-Video Studio (PRD)

## Original Problem Statement
Premium cross-platform (iOS/Android) AI Image-to-Video studio. Users upload an
image, enter a prompt, choose an AI model (Wan 2.7 / Wan 2.6 / Wan 2.6 R2V),
generate a video, and manage generated videos. Provider pattern for models,
auth, gallery, queue, progress, results, settings, dark/light premium UI.

## User Choices (gathered)
- Backend: MongoDB (not Postgres/Supabase — platform-native).
- Auth: JWT email/password only.
- Theme: Dark + Light (system default) with toggle.
- Notifications: in-app progress + completion toasts.
- Video engine: no fal.ai key → generation runs in **MOCKED mode** (full provider
  interface built; simulated queued→processing→completed returning sample MP4s).

## Architecture
- **Backend** FastAPI + Motor/MongoDB. `providers.py` = `ImageToVideoProvider`
  ABC + `Wan27Provider`/`Wan26Provider`/`Wan26R2VProvider` (mock), registry +
  `get_provider` routing. `server.py` = JWT auth, models, prompts, generations
  (async background lifecycle task). All routes under `/api`.
- **Frontend** Expo Router + TypeScript. Zustand (auth/theme/toast), React Query
  (data), Axios (interceptor injects bearer). expo-image, expo-video,
  expo-image-picker/manipulator, @react-native-community/slider,
  react-native-keyboard-controller. Theme tokens from design_guidelines.json
  (Glass/Luxe emerald palette, dark+light).

## Personas
- Creator/marketer turning photos into short cinematic clips.
- Hobbyist experimenting with AI motion.

## Core Requirements (static)
Auth (login/register/reset/profile), Home dashboard, Create workflow
(image + prompt + model + per-model settings), Generation queue, Progress,
Results (play/save/share/duplicate/delete/favourite), Gallery (search/sort/
filter/favourites), Settings (theme/default model/notifications/account).

## Implemented (2026-07-03)
- ✅ JWT auth: register, login, me, profile update, forgot/reset (demo code).
- ✅ 3 Wan models via provider pattern; per-model supported-settings filtering.
- ✅ Create Video: upload/camera (+crop), preview, prompt + negative prompt,
  prompt history & favourites, model cards, dynamic settings (duration/res/
  aspect/motion/camera/creativity/fps/guidance/seed), sticky Generate CTA.
- ✅ Generation lifecycle + background progress; queue (cancel/retry), progress
  screen with polling, results with expo-video player + save/share/duplicate/
  delete/favourite.
- ✅ Gallery search/filter/sort/favourites. Settings (theme, default model,
  notifications toggle, edit name, sign out). Dark/Light, toasts, haptics.
- ✅ Backend tested 24/24 pytest; frontend flows verified.

## Backlog
- ✅ DONE: Real fal.ai integration wired. Stays MOCKED until a fal.ai key is
  present (Settings screen → stored in Mongo `app_config`, or `FAL_KEY` env var).
  See `backend/fal_integration.py`; provider→fal slugs on each provider
  (`fal_model`). Confirm slugs on fal.ai if renamed.
- P1: Real email delivery for password reset (currently returns demo code).
- P2: Real push notifications (needs deploy + Firebase build).
- P2: Supabase/object storage for media instead of base64 thumbnails.
- P2: Pagination for very large galleries; batch queue actions.

## Next Tasks
1. Wire fal.ai (or chosen provider) when key is supplied.
2. Add email provider for reset flow.
3. Consider object storage for uploaded images/generated videos.
