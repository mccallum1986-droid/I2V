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
- Video engine: no A2E token → generation runs in **MOCKED mode** (full provider
  interface built; simulated queued→processing→completed returning sample MP4s).

## Architecture
- **Backend** FastAPI + Motor/MongoDB. `providers.py` = `ImageToVideoProvider`
  ABC + A2E-backed model cards (all `live_capable`; mock until a token is set):
  A2E Faces (userImage2Video), and the Wan family — Wan 2.7 / 2.6 / 2.6-flash /
  2.5 (userWan25). Each provider carries its A2E routing (`a2e_family`,
  `a2e_model`, `a2e_task_type`) and per-model UI options (duration/resolution/
  audio, VIP flag). `server.py` = JWT auth, models, prompts, generations (async
  background lifecycle task) — routes live jobs to `a2e_integration.py` by
  family. The self-hosted GPU path (Studio, `studio.py`) is separate. All routes
  under `/api`.
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
- ✅ DONE: Cloud engine switched from fal.ai to **A2E** (video.a2e.ai), with a
  multi-model picker: A2E Faces + Wan 2.7/2.6/2.6-flash/2.5. Stays MOCKED until
  an A2E token is present (Settings → Mongo `app_config.a2e_api_key`, or the
  `A2E_API_KEY` env var). A2E fetches the source image over HTTPS via
  `GET /api/generations/{id}/source-image`. Two engine families in
  `a2e_integration.py`: `userImage2Video` (A2E Faces — start verified live,
  poll `video/awsList`) and `userWan25` (Wan models — `model=wan2.x-i2v`,
  `task_type=first_frame`; poll `userWan25/allRecords`). Result items carry
  `status`/`process`/`result`. Per-model controls: duration, resolution, seed,
  audio, enhance-prompt. Wan 2.7/2.6 need a VIP A2E plan.
  NOTE: the Wan (`userWan25`) request/response shapes come from A2E's docs but
  aren't yet exercised end to end — verify with one live VIP run.
- P1: Real email delivery for password reset (currently returns demo code).
- P2: Real push notifications (needs deploy + Firebase build).
- P2: Supabase/object storage for media instead of base64 thumbnails.
- P2: Pagination for very large galleries; batch queue actions.

## Next Tasks
1. End-to-end test one live A2E generation with a real token (fields verified;
   just needs a real run to confirm timing/behaviour end to end).
2. Add email provider for reset flow.
3. Consider object storage for uploaded images/generated videos.
