import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Linking,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { KeyboardAwareScrollView, KeyboardStickyView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiError } from "@/src/api/client";
import {
  GpuState,
  useCreateStudioGeneration,
  useGpuStart,
  useGpuStatus,
  useGpuStop,
  useStudioConfig,
  useStudioGenerations,
  useVastaiAccount,
} from "@/src/api/hooks";
import { Button, DisplayText, TextField } from "@/src/components/ui";
import { toast } from "@/src/store/toast";
import { radius, spacing, useTheme } from "@/src/theme";

// ---------------------------------------------------------------------------
// GPU status badge
// ---------------------------------------------------------------------------
const GPU_STATE_LABEL: Record<GpuState, string> = {
  unconfigured: "Not configured",
  off: "GPU off",
  starting: "GPU starting…",
  ready: "GPU ready",
  error: "Error",
  unknown: "Unknown",
};

const GPU_STATE_COLOR: Record<GpuState, string> = {
  unconfigured: "#888",
  off: "#888",
  starting: "#f59e0b",
  ready: "#22c55e",
  error: "#ef4444",
  unknown: "#888",
};

function GpuBadge({ state, gpuName, dph }: { state: GpuState; gpuName?: string; dph?: number }) {
  const { colors } = useTheme();
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (state === "starting") {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 0.3, duration: 700, useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        ])
      ).start();
    } else {
      pulse.setValue(1);
    }
  }, [state]);

  const color = GPU_STATE_COLOR[state];
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
      <Animated.View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color, opacity: pulse }} />
      <Text style={{ color: colors.onSurface, fontWeight: "700", fontSize: 15 }}>
        {GPU_STATE_LABEL[state]}
        {gpuName ? `  ·  ${gpuName}` : ""}
      </Text>
      {dph !== undefined && dph > 0 && (
        <Text style={{ color: colors.onSurfaceTertiary, fontSize: 12 }}>${dph.toFixed(3)}/hr</Text>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Recent generation card
// ---------------------------------------------------------------------------
function StudioGenCard({ gen }: { gen: any }) {
  const { colors } = useTheme();
  const router = useRouter();
  const isActive = gen.status === "queued" || gen.status === "processing";
  return (
    <Pressable
      onPress={() => gen.video_url && router.push(`/generation/${gen.id}`)}
      style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border }}
    >
      <View style={{ width: 48, height: 48, borderRadius: radius.sm, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" }}>
        {isActive ? (
          <ActivityIndicator size="small" color={colors.brandPrimary} />
        ) : gen.status === "completed" ? (
          <Ionicons name="checkmark-circle" size={24} color={colors.success ?? "#22c55e"} />
        ) : (
          <Ionicons name="alert-circle" size={24} color={colors.error} />
        )}
      </View>
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ color: colors.onSurface, fontWeight: "600", fontSize: 14 }}>{gen.prompt}</Text>
        <Text style={{ color: colors.onSurfaceTertiary, fontSize: 12, marginTop: 2 }}>
          {isActive ? `${gen.stage} · ${Math.round(gen.progress)}%` : gen.status}
        </Text>
      </View>
      {gen.status === "completed" && <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceTertiary} />}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------
export default function Studio() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const gpuStatus = useGpuStatus(true);
  const gpuStart = useGpuStart();
  const gpuStop = useGpuStop();
  const createGen = useCreateStudioGeneration();
  const studioGens = useStudioGenerations();
  const studioCfg = useStudioConfig();
  const account = useVastaiAccount(studioCfg.data?.configured ?? false);

  const [imageB64, setImageB64] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [negative, setNegative] = useState("");
  const [duration, setDuration] = useState(5);
  const [resolution, setResolution] = useState("720p");

  const gpu = gpuStatus.data;
  const state: GpuState = gpu?.state ?? "unconfigured";
  const isReady = state === "ready";
  const isStarting = state === "starting";
  const isOff = state === "off";
  const isUnconfigured = state === "unconfigured";

  // Auto-start GPU when tab opens and it's off
  const autoStarted = useRef(false);
  useEffect(() => {
    if (autoStarted.current) return;
    if (state === "off") {
      autoStarted.current = true;
      gpuStart.mutate();
      toast.success("GPU auto-starting…");
    }
  }, [state]);

  const pickImage = async () => {
    const perm = await ImagePicker.getMediaLibraryPermissionsAsync();
    let s = perm.status;
    if (s !== "granted") {
      if (!perm.canAskAgain) { toast.error("Photo access blocked. Enable in Settings."); Linking.openSettings(); return; }
      s = (await ImagePicker.requestMediaLibraryPermissionsAsync()).status;
    }
    if (s !== "granted") { toast.error("Photo library permission denied"); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: false, quality: 0.9 });
    if (!result.canceled) await processImage(result.assets[0].uri);
  };

  const takePhoto = async () => {
    const perm = await ImagePicker.getCameraPermissionsAsync();
    let s = perm.status;
    if (s !== "granted") {
      if (!perm.canAskAgain) { toast.error("Camera access blocked. Enable in Settings."); Linking.openSettings(); return; }
      s = (await ImagePicker.requestCameraPermissionsAsync()).status;
    }
    if (s !== "granted") { toast.error("Camera permission denied"); return; }
    const result = await ImagePicker.launchCameraAsync({ allowsEditing: false, quality: 0.9 });
    if (!result.canceled) await processImage(result.assets[0].uri);
  };

  const processImage = async (uri: string) => {
    try {
      const manip = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: 1280 } }], {
        compress: 0.85,
        format: ImageManipulator.SaveFormat.JPEG,
        base64: true,
      });
      setImageB64(manip.base64 ?? null);
    } catch {
      toast.error("Could not process image");
    }
  };

  const onStart = async () => {
    try {
      await gpuStart.mutateAsync();
      toast.success("GPU starting — ready in 2-4 minutes");
    } catch (e) {
      toast.error(apiError(e, "Failed to start GPU"));
    }
  };

  const onStop = async () => {
    try {
      await gpuStop.mutateAsync();
      toast.success("GPU stopped — billing paused");
    } catch (e) {
      toast.error(apiError(e, "Failed to stop GPU"));
    }
  };

  const onGenerate = async () => {
    if (!imageB64) return toast.error("Add an image first");
    if (!prompt.trim()) return toast.error("Enter a prompt");
    if (!isReady) return toast.error("GPU must be running");
    try {
      await createGen.mutateAsync({
        prompt: prompt.trim(),
        negative_prompt: negative.trim(),
        image_base64: imageB64,
        settings: { duration, resolution },
      });
      toast.success("Generation started!");
      setPrompt("");
      setImageB64(null);
    } catch (e) {
      toast.error(apiError(e, "Generation failed"));
    }
  };

  const recentGens = studioGens.data ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      {/* Header */}
      <View style={{ paddingTop: insets.top + spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider }}>
        <DisplayText style={{ fontSize: 24 }}>Studio</DisplayText>
        <Text style={{ color: colors.onSurfaceTertiary, fontSize: 13, marginTop: 2 }}>Self-hosted · No restrictions</Text>
      </View>

      <KeyboardAwareScrollView bottomOffset={90} contentContainerStyle={{ padding: spacing.lg, paddingBottom: 130, gap: spacing.xl }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

        {/* GPU Status Card */}
        <View style={{ backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, gap: spacing.md }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
              <Ionicons name="hardware-chip-outline" size={20} color={colors.brandPrimary} />
              <Text style={{ color: colors.onSurface, fontWeight: "700", fontSize: 16 }}>GPU Instance</Text>
            </View>
            <Pressable onPress={() => gpuStatus.refetch()}>
              <Ionicons name="refresh-outline" size={20} color={colors.onSurfaceTertiary} />
            </Pressable>
          </View>

          {gpuStatus.isLoading ? (
            <ActivityIndicator color={colors.brandPrimary} />
          ) : (
            <GpuBadge state={state} gpuName={gpu?.gpu_name} dph={gpu?.dph_total} />
          )}

          {isUnconfigured && (
            <Text style={{ color: colors.onSurfaceSecondary, fontSize: 13, lineHeight: 19 }}>
              Add your Vast.ai API key and instance ID in Settings → Studio to get started.
            </Text>
          )}

          {(isOff || state === "unknown") && (
            <Button title="Start GPU" icon="play-circle-outline" onPress={onStart} loading={gpuStart.isPending} />
          )}

          {isStarting && (
            <Text style={{ color: colors.warning ?? "#f59e0b", fontSize: 13 }}>
              Booting up — this usually takes 2-4 minutes. Cost starts now.
            </Text>
          )}

          {isReady && (
            <View style={{ flexDirection: "row", gap: spacing.md }}>
              <View style={{ flex: 1 }}>
                <Button title="Stop GPU" icon="stop-circle-outline" variant="secondary" onPress={onStop} loading={gpuStop.isPending} />
              </View>
            </View>
          )}

          {gpu?.error && (
            <Text style={{ color: colors.error, fontSize: 12 }}>{gpu.error}</Text>
          )}
        </View>

        {/* Vast.ai balance card */}
        {studioCfg.data?.configured && (
          <View style={{ backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, gap: spacing.sm }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.xs }}>
              <Ionicons name="wallet-outline" size={18} color={colors.brandPrimary} />
              <Text style={{ color: colors.onSurface, fontWeight: "700", fontSize: 15 }}>Vast.ai Account</Text>
            </View>
            {account.isLoading ? (
              <ActivityIndicator size="small" color={colors.brandPrimary} />
            ) : account.data ? (
              <View style={{ gap: spacing.xs }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text style={{ color: colors.onSurfaceSecondary, fontSize: 14 }}>Balance remaining</Text>
                  <Text style={{ color: account.data.balance < 2 ? colors.error : colors.success ?? "#22c55e", fontWeight: "700", fontSize: 18 }}>
                    ${account.data.balance.toFixed(2)}
                  </Text>
                </View>
                {isReady && gpu?.dph_total && (
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <Text style={{ color: colors.onSurfaceTertiary, fontSize: 13 }}>Current burn rate</Text>
                    <Text style={{ color: colors.warning ?? "#f59e0b", fontWeight: "600", fontSize: 13 }}>
                      ${gpu.dph_total.toFixed(3)}/hr  ·  ${(gpu.dph_total / 60).toFixed(4)}/min
                    </Text>
                  </View>
                )}
                {isReady && gpu?.dph_total && account.data.balance > 0 && (
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <Text style={{ color: colors.onSurfaceTertiary, fontSize: 13 }}>Time left at current rate</Text>
                    <Text style={{ color: colors.onSurfaceSecondary, fontWeight: "600", fontSize: 13 }}>
                      {(account.data.balance / gpu.dph_total).toFixed(1)} hrs
                    </Text>
                  </View>
                )}
                {account.data.balance < 2 && (
                  <Text style={{ color: colors.error, fontSize: 12, marginTop: spacing.xs }}>
                    Low balance — top up at vast.ai before generating
                  </Text>
                )}
              </View>
            ) : (
              <Text style={{ color: colors.onSurfaceTertiary, fontSize: 13 }}>Could not load balance</Text>
            )}
          </View>
        )}

        {/* Generate section — only show when GPU ready */}
        {!isUnconfigured && (
          <>
            {/* Image picker */}
            <View>
              <Text style={{ color: colors.onSurfaceSecondary, fontSize: 13, fontWeight: "600", marginBottom: spacing.sm }}>Source image</Text>
              {imageB64 ? (
                <View style={{ borderRadius: radius.lg, overflow: "hidden" }}>
                  <Image source={{ uri: `data:image/jpeg;base64,${imageB64}` }} style={{ width: "100%", height: 220 }} contentFit="contain" />
                  <Pressable onPress={() => setImageB64(null)} style={{ position: "absolute", top: spacing.sm, right: spacing.sm, width: 34, height: 34, borderRadius: 17, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name="close" size={20} color="#fff" />
                  </Pressable>
                </View>
              ) : (
                <View style={{ flexDirection: "row", gap: spacing.md }}>
                  <Pressable onPress={pickImage} style={{ flex: 1, height: 120, borderRadius: radius.lg, borderWidth: 1.5, borderStyle: "dashed", borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: colors.surfaceSecondary }}>
                    <Ionicons name="image-outline" size={26} color={colors.brandPrimary} />
                    <Text style={{ color: colors.onSurface, fontWeight: "600", fontSize: 13 }}>Upload</Text>
                  </Pressable>
                  <Pressable onPress={takePhoto} style={{ flex: 1, height: 120, borderRadius: radius.lg, borderWidth: 1.5, borderStyle: "dashed", borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: colors.surfaceSecondary }}>
                    <Ionicons name="camera-outline" size={26} color={colors.brandPrimary} />
                    <Text style={{ color: colors.onSurface, fontWeight: "600", fontSize: 13 }}>Camera</Text>
                  </Pressable>
                </View>
              )}
            </View>

            {/* Prompt */}
            <View style={{ gap: spacing.sm }}>
              <Text style={{ color: colors.onSurfaceSecondary, fontSize: 13, fontWeight: "600" }}>Prompt</Text>
              <TextField placeholder="Describe the motion, mood, and scene…" value={prompt} onChangeText={setPrompt} multiline style={{ minHeight: 88, textAlignVertical: "top", paddingVertical: 12 }} />
              <Text style={{ color: colors.onSurfaceSecondary, fontSize: 13, fontWeight: "600", marginTop: spacing.sm }}>Negative prompt (optional)</Text>
              <TextField placeholder="What to avoid…" value={negative} onChangeText={setNegative} multiline style={{ minHeight: 56, textAlignVertical: "top", paddingVertical: 12 }} />
            </View>

            {/* Quick settings */}
            <View style={{ gap: spacing.md }}>
              <Text style={{ color: colors.onSurfaceSecondary, fontSize: 13, fontWeight: "600" }}>Duration</Text>
              <View style={{ flexDirection: "row", gap: spacing.sm }}>
                {[3, 5, 8, 10, 15, 20].map((d) => (
                  <Pressable key={d} onPress={() => setDuration(d)} style={{ flex: 1, paddingVertical: spacing.sm, borderRadius: radius.sm, borderWidth: 1, borderColor: duration === d ? colors.brandPrimary : colors.border, backgroundColor: duration === d ? colors.brandTertiary : "transparent", alignItems: "center" }}>
                    <Text style={{ color: duration === d ? colors.brandPrimary : colors.onSurface, fontWeight: "600", fontSize: 12 }}>{d}s</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={{ color: colors.onSurfaceSecondary, fontSize: 13, fontWeight: "600" }}>Resolution</Text>
              <View style={{ flexDirection: "row", gap: spacing.sm }}>
                {["480p", "720p", "1080p"].map((r) => (
                  <Pressable key={r} onPress={() => setResolution(r)} style={{ flex: 1, paddingVertical: spacing.sm, borderRadius: radius.sm, borderWidth: 1, borderColor: resolution === r ? colors.brandPrimary : colors.border, backgroundColor: resolution === r ? colors.brandTertiary : "transparent", alignItems: "center" }}>
                    <Text style={{ color: resolution === r ? colors.brandPrimary : colors.onSurface, fontWeight: "600", fontSize: 12 }}>{r}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          </>
        )}

        {/* Recent studio generations */}
        {recentGens.length > 0 && (
          <View style={{ gap: spacing.sm }}>
            <Text style={{ color: colors.onSurfaceSecondary, fontSize: 13, fontWeight: "600" }}>Recent</Text>
            {recentGens.slice(0, 5).map((g) => <StudioGenCard key={g.id} gen={g} />)}
          </View>
        )}
      </KeyboardAwareScrollView>

      {/* Sticky generate button */}
      {!isUnconfigured && (
        <KeyboardStickyView offset={{ closed: 0, opened: 0 }}>
          <View style={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.md, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.divider }}>
            {!isReady ? (
              <View style={{ padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, alignItems: "center" }}>
                <Text style={{ color: colors.onSurfaceSecondary, fontSize: 14 }}>
                  {isStarting ? "Waiting for GPU to boot…" : "Start the GPU above to generate"}
                </Text>
              </View>
            ) : (
              <Button title="Generate (Unrestricted)" icon="flash" onPress={onGenerate} loading={createGen.isPending} />
            )}
          </View>
        </KeyboardStickyView>
      )}
    </View>
  );
}
