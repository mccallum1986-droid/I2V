import { Ionicons } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system/legacy";
import { Image } from "expo-image";
import * as MediaLibrary from "expo-media-library";
import * as Sharing from "expo-sharing";
import { useVideoPlayer, VideoView } from "expo-video";
import { useLocalSearchParams, useRouter, Redirect } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  useCancelGeneration,
  useDeleteGeneration,
  useDuplicateGeneration,
  useGeneration,
  useRetryGeneration,
  useToggleGenerationFav,
} from "@/src/api/hooks";
import { dataUri } from "@/src/components/cards";
import { Button, DisplayText, ProgressBar, StatusPill } from "@/src/components/ui";
import { useAuthStore } from "@/src/store/auth";
import { toast } from "@/src/store/toast";
import { radius, spacing, useTheme } from "@/src/theme";

function ActionButton({ icon, label, onPress, color, testID }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; color?: string; testID?: string }) {
  const { colors } = useTheme();
  return (
    <Pressable testID={testID} onPress={onPress} style={{ alignItems: "center", gap: 6, flex: 1 }}>
      <View style={{ width: 52, height: 52, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" }}>
        <Ionicons name={icon} size={22} color={color ?? colors.onSurface} />
      </View>
      <Text style={{ color: colors.onSurfaceSecondary, fontSize: 11, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}

export default function GenerationDetail() {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const authStatus = useAuthStore((s) => s.status);

  const { data: gen, isLoading, isError } = useGeneration(authStatus === "authed" ? id : undefined, true);
  const cancel = useCancelGeneration();
  const retry = useRetryGeneration();
  const duplicate = useDuplicateGeneration();
  const toggleFav = useToggleGenerationFav();
  const del = useDeleteGeneration();
  const [busy, setBusy] = useState(false);
  const [localVideoUri, setLocalVideoUri] = useState<string | null>(null);
  const [videoLoading, setVideoLoading] = useState(false);

  useEffect(() => {
    if (!gen?.video_url) { setLocalVideoUri(null); return; }
    // Stream the video directly (like a browser) instead of pre-downloading it to
    // a cache file — the pre-download step could hang or save a bad file for
    // larger clips, leaving the player stuck at 0:00. Resolve relative proxy URLs
    // (e.g. "/api/studio/...") against the backend host.
    const base = (process.env.EXPO_PUBLIC_BACKEND_URL ?? "").replace(/\/$/, "");
    const remoteUrl = gen.video_url.startsWith("/") ? `${base}${gen.video_url}` : gen.video_url;
    setLocalVideoUri(remoteUrl);
    setVideoLoading(false);
  }, [gen?.video_url]);

  const player = useVideoPlayer(localVideoUri, (p) => {
    p.loop = true;
    p.play();
  });

  if (authStatus === "guest") {
    return <Redirect href="/(auth)/login" />;
  }

  if (authStatus === "idle" || (isLoading && !gen)) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={colors.brandPrimary} />
      </View>
    );
  }

  if (!gen) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.md }}>
        <Ionicons name="alert-circle-outline" size={44} color={colors.error} />
        <Text style={{ color: colors.onSurfaceSecondary, textAlign: "center" }}>
          {isError ? "Couldn't load this generation." : "Generation not found."}
        </Text>
        <Button testID="detail-back-button" title="Go Back" variant="secondary" size="md" onPress={() => router.back()} />
      </View>
    );
  }

  const isActive = gen.status === "queued" || gen.status === "processing";
  const isDone = gen.status === "completed";
  const isFailed = gen.status === "failed" || gen.status === "cancelled";

  const eta = Math.max(0, Math.round(gen.est_seconds * (1 - gen.progress / 100)));

  const download = async () => {
    if (!gen.video_url) return;
    if (Platform.OS === "web") {
      Linking.openURL(gen.video_url);
      return;
    }
    setBusy(true);
    try {
      const perm = await MediaLibrary.requestPermissionsAsync();
      if (!perm.granted) {
        toast.error("Media permission denied");
        if (!perm.canAskAgain) Linking.openSettings();
        return;
      }
      const local = FileSystem.documentDirectory + `wanstudio_${gen.id}.mp4`;
      const res = await FileSystem.downloadAsync(gen.video_url, local);
      await MediaLibrary.saveToLibraryAsync(res.uri);
      toast.success("Saved to your library");
    } catch (e) {
      toast.error("Download failed");
    } finally {
      setBusy(false);
    }
  };

  const share = async () => {
    if (!gen.video_url) return;
    if (Platform.OS === "web") {
      Linking.openURL(gen.video_url);
      return;
    }
    setBusy(true);
    try {
      const local = FileSystem.documentDirectory + `wanstudio_${gen.id}.mp4`;
      const res = await FileSystem.downloadAsync(gen.video_url, local);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(res.uri);
      } else {
        toast.error("Sharing unavailable");
      }
    } catch (e) {
      toast.error("Share failed");
    } finally {
      setBusy(false);
    }
  };

  const onDuplicate = async () => {
    const res: any = await duplicate.mutateAsync(gen.id);
    toast.success("Duplicated & queued");
    if (res?.id) router.replace(`/generation/${res.id}`);
  };

  const onDelete = async () => {
    await del.mutateAsync(gen.id);
    toast.success("Deleted");
    router.back();
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      {/* header */}
      <View style={{ paddingTop: insets.top + spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Pressable testID="back-button" onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <StatusPill status={gen.status} />
        <Pressable testID="detail-fav-button" onPress={() => toggleFav.mutate(gen.id)} hitSlop={10}>
          <Ionicons name={gen.is_favourite ? "heart" : "heart-outline"} size={24} color={gen.is_favourite ? colors.error : colors.onSurface} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xl }} showsVerticalScrollIndicator={false}>
        {/* Media area */}
        {isDone && gen.video_url ? (
          localVideoUri && !videoLoading ? (
            <VideoView testID="video-player" player={player} style={{ width: "100%", aspectRatio: 16 / 9, borderRadius: radius.lg, backgroundColor: "#000" }} allowsFullscreen nativeControls contentFit="contain" />
          ) : (
            <View style={{ width: "100%", aspectRatio: 16 / 9, borderRadius: radius.lg, backgroundColor: "#000", alignItems: "center", justifyContent: "center" }}>
              <ActivityIndicator color={colors.brandPrimary} />
            </View>
          )
        ) : (
          <View style={{ width: "100%", aspectRatio: 16 / 9, borderRadius: radius.lg, overflow: "hidden", backgroundColor: colors.surfaceTertiary }}>
            <Image source={{ uri: dataUri(gen.thumbnail_base64) }} style={{ flex: 1, opacity: 0.5 }} contentFit="cover" blurRadius={isActive ? 8 : 0} />
            <View style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0, alignItems: "center", justifyContent: "center" }}>
              {isActive ? (
                <ActivityIndicator size="large" color={colors.brandPrimary} />
              ) : (
                <Ionicons name={gen.status === "cancelled" ? "close-circle" : "alert-circle"} size={48} color={colors.error} />
              )}
            </View>
          </View>
        )}

        {/* Progress panel */}
        {isActive && (
          <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={{ color: colors.onSurface, fontWeight: "600" }}>{gen.stage}</Text>
              <Text style={{ color: colors.brandPrimary, fontWeight: "700" }}>{Math.round(gen.progress)}%</Text>
            </View>
            <ProgressBar progress={gen.progress} />
            <Text style={{ color: colors.onSurfaceTertiary, fontSize: 12 }}>~{eta}s remaining · {gen.model_name}</Text>
            <Button testID="cancel-generation-button" title="Cancel" variant="ghost" size="md" icon="stop-circle-outline" onPress={() => cancel.mutate(gen.id)} style={{ marginTop: spacing.sm }} />
          </View>
        )}

        {/* Failed panel */}
        {isFailed && (
          <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
            <Text style={{ color: colors.onSurface, fontWeight: "600", fontSize: 16 }}>
              {gen.status === "cancelled" ? "Generation cancelled" : "Generation failed"}
            </Text>
            {gen.error && <Text style={{ color: colors.onSurfaceTertiary, fontSize: 13 }}>{gen.error}</Text>}
            <Button testID="retry-generation-button" title="Retry" icon="refresh" onPress={() => { retry.mutate(gen.id); toast.info("Retrying..."); }} style={{ marginTop: spacing.sm }} />
          </View>
        )}

        {/* Result actions */}
        <View style={{ flexDirection: "row", marginTop: spacing.xl, gap: spacing.sm }}>
          {isDone && gen.video_url && (
            <>
              <ActionButton testID="download-button" icon="download-outline" label="Save" onPress={download} />
              <ActionButton testID="share-button" icon="share-social-outline" label="Share" onPress={share} />
              <ActionButton testID="duplicate-button" icon="copy-outline" label="Duplicate" onPress={onDuplicate} />
            </>
          )}
          <ActionButton testID="delete-button" icon="trash-outline" label="Delete" color={colors.error} onPress={onDelete} />
        </View>

        {busy && <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.md }} />}

        {/* Details */}
        <DisplayText style={{ fontSize: 20, marginTop: spacing.xl, marginBottom: spacing.sm }}>Prompt</DisplayText>
        <Text style={{ color: colors.onSurface, fontSize: 15, lineHeight: 22 }}>{gen.prompt}</Text>
        {!!gen.negative_prompt && (
          <>
            <Text style={{ color: colors.onSurfaceTertiary, fontSize: 12, fontWeight: "700", marginTop: spacing.md }}>NEGATIVE</Text>
            <Text style={{ color: colors.onSurfaceSecondary, fontSize: 14, marginTop: 2 }}>{gen.negative_prompt}</Text>
          </>
        )}

        <DisplayText style={{ fontSize: 20, marginTop: spacing.xl, marginBottom: spacing.sm }}>Settings</DisplayText>
        <View style={{ backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 }}>
            <Text style={{ color: colors.onSurfaceTertiary }}>Model</Text>
            <Text style={{ color: colors.onSurface, fontWeight: "600" }}>{gen.model_name}</Text>
          </View>
          {Object.entries(gen.settings).map(([k, v]) => (
            <View key={k} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.divider }}>
              <Text style={{ color: colors.onSurfaceTertiary, textTransform: "capitalize" }}>{k.replace(/_/g, " ")}</Text>
              <Text style={{ color: colors.onSurface, fontWeight: "600" }}>{typeof v === "number" ? (Number.isInteger(v) ? v : v.toFixed(2)) : String(v)}</Text>
            </View>
          ))}
        </View>

        <Button testID="generate-another-button" title="Generate Another" icon="add" variant="secondary" onPress={() => router.push("/(tabs)/create")} style={{ marginTop: spacing.xl }} />
      </ScrollView>
    </View>
  );
}
