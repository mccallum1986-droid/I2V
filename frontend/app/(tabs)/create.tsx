import Slider from "@react-native-community/slider";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  Keyboard,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  Switch,
  Text,
  View,
} from "react-native";
import { KeyboardAwareScrollView, KeyboardStickyView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  Model,
  useA2eBalance,
  useCreateGeneration,
  useDeletePrompt,
  useModels,
  usePrompts,
  useSavePrompt,
  useTogglePromptFav,
} from "@/src/api/hooks";
import { apiError } from "@/src/api/client";
import { ModelCard } from "@/src/components/cards";
import { Button, Chip, DisplayText, IconButton, Segmented, TextField } from "@/src/components/ui";
import { useAuthStore } from "@/src/store/auth";
import { toast } from "@/src/store/toast";
import { radius, spacing, useTheme } from "@/src/theme";

const RES = ["480p", "720p", "1080p"];
const ASPECT = ["16:9", "9:16", "1:1"];
const CAMERA = ["static", "pan", "zoom", "orbit"];
const FPS = ["24", "30"];
const DURATION = [5, 10, 15, 20];

function Label({ children }: { children: string }) {
  const { colors } = useTheme();
  return <Text style={{ color: colors.onSurfaceSecondary, fontSize: 13, fontWeight: "600", marginBottom: spacing.sm }}>{children}</Text>;
}

function SliderRow({ label, value, min, max, step, onChange, format }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; format?: (v: number) => string }) {
  const { colors } = useTheme();
  return (
    <View style={{ marginBottom: spacing.lg }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 2 }}>
        <Label>{label}</Label>
        <Text style={{ color: colors.brandPrimary, fontWeight: "700", fontSize: 13 }}>{format ? format(value) : value.toFixed(2)}</Text>
      </View>
      <Slider
        style={{ width: "100%", height: 34 }}
        minimumValue={min}
        maximumValue={max}
        step={step}
        value={value}
        onValueChange={onChange}
        minimumTrackTintColor={colors.brandPrimary}
        maximumTrackTintColor={colors.border}
        thumbTintColor={colors.brandPrimary}
      />
    </View>
  );
}

export default function Create() {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ model?: string }>();
  const user = useAuthStore((s) => s.user);

  const models = useModels();
  const createGen = useCreateGeneration();
  const savePrompt = useSavePrompt();
  const prompts = usePrompts();
  const togglePromptFav = useTogglePromptFav();
  const deletePrompt = useDeletePrompt();

  const [imageB64, setImageB64] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [negative, setNegative] = useState("");
  const [modelId, setModelId] = useState<string>("");
  const [showPrompts, setShowPrompts] = useState(false);
  const [showSettings, setShowSettings] = useState(true);
  // Hide the sticky "Generate" footer while the keyboard is open so it can never
  // cover the prompt inputs; it reappears when the keyboard is dismissed.
  const [kbVisible, setKbVisible] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", () => setKbVisible(true));
    const hide = Keyboard.addListener("keyboardDidHide", () => setKbVisible(false));
    return () => { show.remove(); hide.remove(); };
  }, []);

  const defaults = user?.settings?.generation ?? {};
  const [settings, setSettings] = useState<Record<string, any>>({
    duration: defaults.duration ?? 5,
    resolution: defaults.resolution ?? "720p",
    aspect_ratio: defaults.aspect_ratio ?? "16:9",
    motion_strength: defaults.motion_strength ?? 0.5,
    camera_movement: defaults.camera_movement ?? "static",
    creativity: defaults.creativity ?? 0.5,
    fps: defaults.fps ?? 24,
    guidance_scale: defaults.guidance_scale ?? 7,
    seed: "",
    audio: defaults.audio ?? false,
    enhance_prompt: defaults.enhance_prompt ?? true,
  });

  // preselect model from home / default
  useEffect(() => {
    if (!models.data) return;
    const initial = params.model || user?.settings?.default_model || models.data[0]?.model_id;
    if (initial && !modelId) setModelId(initial);
  }, [models.data, params.model, user, modelId]);

  const selectedModel: Model | undefined = useMemo(
    () => models.data?.find((m) => m.model_id === modelId),
    [models.data, modelId],
  );
  const supports = (k: string) => selectedModel?.supported_settings.includes(k);

  const set = (k: string, v: any) => setSettings((s) => ({ ...s, [k]: v }));

  // Duration/resolution options are per-model (A2E vs the Wan family differ).
  const durationOpts = selectedModel?.duration_options?.length ? selectedModel.duration_options : DURATION;
  const resOpts = selectedModel?.resolution_options?.length ? selectedModel.resolution_options : RES;

  // Estimated A2E cost = per-second rate × duration; compared against live balance.
  const balance = useA2eBalance();
  const durNum = Number(settings.duration || 0);
  const estCost = selectedModel?.credit_costs?.[String(durNum)] ?? (selectedModel?.credit_rate ?? 0) * durNum;
  const fmtCredits = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const insufficient = balance.data?.coins != null && estCost > 0 && balance.data.coins < estCost;

  // When the model changes, coerce duration/resolution onto that model's valid set.
  useEffect(() => {
    if (!selectedModel) return;
    const dOpts = selectedModel.duration_options?.length ? selectedModel.duration_options : DURATION;
    if (!dOpts.includes(Number(settings.duration))) set("duration", dOpts[0]);
    const rOpts = selectedModel.resolution_options ?? [];
    if (rOpts.length && !rOpts.includes(settings.resolution)) {
      set("resolution", rOpts.includes("720p") ? "720p" : rOpts[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedModel?.model_id]);

  const pickImage = async () => {
    const perm = await ImagePicker.getMediaLibraryPermissionsAsync();
    let status = perm.status;
    if (status !== "granted") {
      if (!perm.canAskAgain) {
        toast.error("Photo access is blocked. Enable it in Settings.");
        Linking.openSettings();
        return;
      }
      const req = await ImagePicker.requestMediaLibraryPermissionsAsync();
      status = req.status;
    }
    if (status !== "granted") {
      toast.error("Photo library permission denied");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      quality: 0.8,
    });
    if (!result.canceled) await processImage(result.assets[0].uri);
  };

  const takePhoto = async () => {
    const perm = await ImagePicker.getCameraPermissionsAsync();
    let status = perm.status;
    if (status !== "granted") {
      if (!perm.canAskAgain) {
        toast.error("Camera access is blocked. Enable it in Settings.");
        Linking.openSettings();
        return;
      }
      const req = await ImagePicker.requestCameraPermissionsAsync();
      status = req.status;
    }
    if (status !== "granted") {
      toast.error("Camera permission denied");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ allowsEditing: true, quality: 0.8 });
    if (!result.canceled) await processImage(result.assets[0].uri);
  };

  const processImage = async (uri: string) => {
    try {
      const manip = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: 1024 } }], {
        compress: 0.7,
        format: ImageManipulator.SaveFormat.JPEG,
        base64: true,
      });
      setImageB64(manip.base64 ?? null);
    } catch (e) {
      toast.error("Could not process image");
    }
  };

  const onGenerate = async () => {
    if (!imageB64) return toast.error("Please add an image first");
    if (!prompt.trim()) return toast.error("Please enter a prompt");
    if (!selectedModel) return toast.error("Select a model");

    const filtered: Record<string, any> = {};
    selectedModel.supported_settings.forEach((k) => {
      if (k === "seed") {
        if (settings.seed) filtered.seed = Number(settings.seed);
      } else {
        filtered[k] = settings[k];
      }
    });

    try {
      const gen = await createGen.mutateAsync({
        prompt: prompt.trim(),
        negative_prompt: negative.trim(),
        model: modelId,
        image_base64: imageB64,
        settings: filtered,
      });
      savePrompt.mutate({ text: prompt.trim(), negative_prompt: negative.trim(), is_favourite: false });
      toast.success("Generation queued!");
      router.push(`/generation/${gen.id}`);
    } catch (e) {
      toast.error(apiError(e, "Failed to start generation"));
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={{ paddingTop: insets.top + spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider }}>
        <DisplayText style={{ fontSize: 24 }}>Create Video</DisplayText>
      </View>

      <KeyboardAwareScrollView
        bottomOffset={spacing.xl}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Image zone */}
        <Label>Source image</Label>
        {imageB64 ? (
          <View style={{ borderRadius: radius.lg, overflow: "hidden", marginBottom: spacing.md }}>
            <Image source={{ uri: `data:image/jpeg;base64,${imageB64}` }} style={{ width: "100%", height: 240 }} contentFit="cover" />
            <Pressable testID="remove-image-button" onPress={() => setImageB64(null)} style={{ position: "absolute", top: spacing.sm, right: spacing.sm, width: 34, height: 34, borderRadius: 17, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="close" size={20} color="#fff" />
            </Pressable>
          </View>
        ) : (
          <View style={{ flexDirection: "row", gap: spacing.md, marginBottom: spacing.md }}>
            <Pressable testID="upload-image-button" onPress={pickImage} style={{ flex: 1, height: 130, borderRadius: radius.lg, borderWidth: 1.5, borderStyle: "dashed", borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: colors.surfaceSecondary }}>
              <Ionicons name="image-outline" size={28} color={colors.brandPrimary} />
              <Text style={{ color: colors.onSurface, fontWeight: "600", fontSize: 13 }}>Upload</Text>
            </Pressable>
            <Pressable testID="take-photo-button" onPress={takePhoto} style={{ flex: 1, height: 130, borderRadius: radius.lg, borderWidth: 1.5, borderStyle: "dashed", borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: colors.surfaceSecondary }}>
              <Ionicons name="camera-outline" size={28} color={colors.brandPrimary} />
              <Text style={{ color: colors.onSurface, fontWeight: "600", fontSize: 13 }}>Camera</Text>
            </Pressable>
          </View>
        )}

        {/* Prompt */}
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: spacing.md }}>
          <Label>Prompt</Label>
          <Pressable testID="prompt-history-button" onPress={() => setShowPrompts(true)} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Ionicons name="time-outline" size={15} color={colors.brandPrimary} />
            <Text style={{ color: colors.brandPrimary, fontWeight: "600", fontSize: 13 }}>History</Text>
          </Pressable>
        </View>
        <TextField
          testID="prompt-input"
          placeholder="Describe the motion, mood, and scene..."
          value={prompt}
          onChangeText={setPrompt}
          multiline
          style={{ minHeight: 88, textAlignVertical: "top", paddingVertical: 12 }}
        />
        <View style={{ height: spacing.md }} />
        <Label>Negative prompt (optional)</Label>
        <TextField
          testID="negative-prompt-input"
          placeholder="What to avoid: blur, distortion, artifacts..."
          value={negative}
          onChangeText={setNegative}
          multiline
          style={{ minHeight: 56, textAlignVertical: "top", paddingVertical: 12 }}
        />
        {prompt.trim().length > 0 && (
          <Pressable testID="save-prompt-button" onPress={() => { savePrompt.mutate({ text: prompt.trim(), negative_prompt: negative.trim(), is_favourite: true }); toast.success("Prompt saved to favourites"); }} style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.sm }}>
            <Ionicons name="star-outline" size={16} color={colors.brandPrimary} />
            <Text style={{ color: colors.brandPrimary, fontWeight: "600", fontSize: 13 }}>Save prompt to favourites</Text>
          </Pressable>
        )}

        {/* Model selection */}
        <DisplayText style={{ fontSize: 20, marginTop: spacing.xl, marginBottom: spacing.md }}>Model</DisplayText>
        <View style={{ gap: spacing.md }}>
          {(models.data ?? []).map((m) => (
            <ModelCard key={m.model_id} model={m} selected={m.model_id === modelId} onPress={() => setModelId(m.model_id)} />
          ))}
        </View>

        {/* Settings */}
        <Pressable onPress={() => setShowSettings((v) => !v)} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: spacing.xl, marginBottom: spacing.md }}>
          <DisplayText style={{ fontSize: 20 }}>Generation settings</DisplayText>
          <Ionicons name={showSettings ? "chevron-up" : "chevron-down"} size={20} color={colors.onSurfaceSecondary} />
        </Pressable>

        {showSettings && selectedModel && (
          <View>
            {supports("duration") && (
              <>
                <Label>Duration</Label>
                <Segmented options={durationOpts.map((d) => ({ label: `${d}s`, value: String(d) }))} value={String(settings.duration)} onChange={(v) => set("duration", Number(v))} />
                <View style={{ height: spacing.lg }} />
              </>
            )}
            {supports("resolution") && (
              <>
                <Label>Resolution</Label>
                <Segmented options={resOpts.map((r) => ({ label: r, value: r }))} value={settings.resolution} onChange={(v) => set("resolution", v)} />
                <View style={{ height: spacing.lg }} />
              </>
            )}
            {supports("enhance_prompt") && (
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.lg }}>
                <View style={{ flex: 1, paddingRight: spacing.md }}>
                  <Label>Enhance prompt</Label>
                  <Text style={{ color: colors.onSurfaceTertiary, fontSize: 12, marginTop: -spacing.xs }}>Let A2E automatically enrich your prompt</Text>
                </View>
                <Switch testID="enhance-prompt-switch" value={!!settings.enhance_prompt} onValueChange={(v) => set("enhance_prompt", v)} trackColor={{ true: colors.brandPrimary, false: colors.border }} thumbColor="#fff" />
              </View>
            )}
            {selectedModel?.supports_audio && (
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.lg }}>
                <View style={{ flex: 1, paddingRight: spacing.md }}>
                  <Label>Generate audio</Label>
                  <Text style={{ color: colors.onSurfaceTertiary, fontSize: 12, marginTop: -spacing.xs }}>Add an AI-generated soundtrack (Wan models)</Text>
                </View>
                <Switch testID="audio-switch" value={!!settings.audio} onValueChange={(v) => set("audio", v)} trackColor={{ true: colors.brandPrimary, false: colors.border }} thumbColor="#fff" />
              </View>
            )}
            {supports("aspect_ratio") && (
              <>
                <Label>Aspect ratio</Label>
                <Segmented options={ASPECT.map((a) => ({ label: a, value: a }))} value={settings.aspect_ratio} onChange={(v) => set("aspect_ratio", v)} />
                <View style={{ height: spacing.lg }} />
              </>
            )}
            {supports("motion_strength") && (
              <SliderRow label="Motion strength" value={settings.motion_strength} min={0} max={1} step={0.05} onChange={(v) => set("motion_strength", v)} />
            )}
            {supports("creativity") && (
              <SliderRow label="Creativity" value={settings.creativity} min={0} max={1} step={0.05} onChange={(v) => set("creativity", v)} />
            )}
            {supports("guidance_scale") && (
              <SliderRow label="Guidance scale" value={settings.guidance_scale} min={1} max={15} step={0.5} onChange={(v) => set("guidance_scale", v)} format={(v) => v.toFixed(1)} />
            )}
            {supports("camera_movement") && (
              <>
                <Label>Camera movement</Label>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingRight: spacing.lg }}>
                  {CAMERA.map((c) => (
                    <Chip key={c} label={c.charAt(0).toUpperCase() + c.slice(1)} selected={settings.camera_movement === c} onPress={() => set("camera_movement", c)} testID={`camera-${c}`} />
                  ))}
                </ScrollView>
                <View style={{ height: spacing.lg }} />
              </>
            )}
            {supports("fps") && (
              <>
                <Label>Frame rate (FPS)</Label>
                <Segmented options={FPS.map((f) => ({ label: `${f} fps`, value: f }))} value={String(settings.fps)} onChange={(v) => set("fps", Number(v))} />
                <View style={{ height: spacing.lg }} />
              </>
            )}
            {supports("seed") && (
              <>
                <Label>Seed (optional)</Label>
                <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "center" }}>
                  <View style={{ flex: 1 }}>
                    <TextField testID="seed-input" placeholder="Random" keyboardType="number-pad" value={String(settings.seed)} onChangeText={(v) => set("seed", v.replace(/[^0-9]/g, ""))} />
                  </View>
                  <IconButton icon="dice-outline" onPress={() => set("seed", String(Math.floor(Math.random() * 1000000)))} testID="random-seed-button" />
                </View>
              </>
            )}
          </View>
        )}
      </KeyboardAwareScrollView>

      {/* Sticky Generate CTA */}
      {!kbVisible && (
        <KeyboardStickyView offset={{ closed: 0, opened: 0 }}>
          <View style={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.md, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.divider }}>
            {estCost > 0 && (
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.sm }}>
                <Text style={{ color: colors.onSurfaceSecondary, fontSize: 13 }}>
                  Est. cost{" "}
                  <Text style={{ color: insufficient ? colors.error : colors.brandPrimary, fontWeight: "700" }}>~{fmtCredits(estCost)} credits</Text>
                </Text>
                {balance.data?.coins != null && (
                  <Text style={{ color: insufficient ? colors.error : colors.onSurfaceTertiary, fontSize: 12 }}>
                    Balance: {fmtCredits(balance.data.coins)}
                  </Text>
                )}
              </View>
            )}
            <Button testID="generate-button" title="Generate Video" icon="sparkles" onPress={onGenerate} loading={createGen.isPending} />
          </View>
        </KeyboardStickyView>
      )}

      {/* Prompt history modal */}
      <Modal visible={showPrompts} animationType="slide" transparent onRequestClose={() => setShowPrompts(false)}>
        <Pressable style={{ flex: 1, backgroundColor: colors.scrim }} onPress={() => setShowPrompts(false)} />
        <View style={{ position: "absolute", bottom: 0, left: 0, right: 0, maxHeight: "75%", backgroundColor: colors.surfaceSecondary, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingTop: spacing.md, paddingBottom: insets.bottom + spacing.md }}>
          <View style={{ alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: spacing.md }} />
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: spacing.lg, marginBottom: spacing.sm }}>
            <DisplayText style={{ fontSize: 20 }}>Prompt history</DisplayText>
            <Pressable testID="close-prompts-button" onPress={() => setShowPrompts(false)}><Ionicons name="close" size={24} color={colors.onSurface} /></Pressable>
          </View>
          <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}>
            {(prompts.data ?? []).length === 0 && (
              <Text style={{ color: colors.onSurfaceTertiary, textAlign: "center", paddingVertical: spacing.xl }}>No saved prompts yet.</Text>
            )}
            {(prompts.data ?? []).map((p) => (
              <Pressable key={p.id} testID={`prompt-item-${p.id}`} onPress={() => { setPrompt(p.text); setNegative(p.negative_prompt); setShowPrompts(false); }} style={{ padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border }}>
                <Text numberOfLines={2} style={{ color: colors.onSurface, fontSize: 14 }}>{p.text}</Text>
                <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: spacing.lg, marginTop: spacing.sm }}>
                  <Pressable onPress={() => togglePromptFav.mutate(p.id)} hitSlop={8}>
                    <Ionicons name={p.is_favourite ? "star" : "star-outline"} size={18} color={p.is_favourite ? colors.warning : colors.onSurfaceTertiary} />
                  </Pressable>
                  <Pressable onPress={() => deletePrompt.mutate(p.id)} hitSlop={8}>
                    <Ionicons name="trash-outline" size={18} color={colors.error} />
                  </Pressable>
                </View>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}
