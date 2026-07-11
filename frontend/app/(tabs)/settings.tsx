import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Modal, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, apiError } from "@/src/api/client";
import { useModels, useProviderConfig, useSetProviderKey } from "@/src/api/hooks";
import { Button, Card, DisplayText, Segmented, TextField } from "@/src/components/ui";
import { useAuthStore } from "@/src/store/auth";
import { toast } from "@/src/store/toast";
import { radius, spacing, ThemeMode, useTheme } from "@/src/theme";

function Row({ icon, title, subtitle, right, onPress, testID }: { icon: keyof typeof Ionicons.glyphMap; title: string; subtitle?: string; right?: React.ReactNode; onPress?: () => void; testID?: string }) {
  const { colors } = useTheme();
  return (
    <Pressable testID={testID} onPress={onPress} disabled={!onPress} style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md }}>
      <View style={{ width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" }}>
        <Ionicons name={icon} size={20} color={colors.brandPrimary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.onSurface, fontSize: 15, fontWeight: "600" }}>{title}</Text>
        {subtitle && <Text style={{ color: colors.onSurfaceTertiary, fontSize: 12, marginTop: 1 }}>{subtitle}</Text>}
      </View>
      {right}
    </Pressable>
  );
}

export default function Settings() {
  const { colors, mode, setMode } = useTheme();
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const signOut = useAuthStore((s) => s.signOut);
  const models = useModels();
  const providerCfg = useProviderConfig();
  const setProviderKey = useSetProviderKey();

  const settings = user?.settings ?? {};
  const [editName, setEditName] = useState(false);
  const [name, setName] = useState(user?.name ?? "");
  const [saving, setSaving] = useState(false);
  const [falKey, setFalKey] = useState("");
  const [savingKey, setSavingKey] = useState(false);

  const cfg = providerCfg.data;
  const isLive = cfg?.mode === "live";
  const envManaged = cfg?.key_source === "env";

  const saveFalKey = async () => {
    const value = falKey.trim();
    if (!value) return;
    setSavingKey(true);
    try {
      await setProviderKey.mutateAsync(value);
      setFalKey("");
      toast.success("API key saved — live mode on");
    } catch (e) {
      toast.error(apiError(e, "Couldn't save key"));
    }
    setSavingKey(false);
  };

  const clearFalKey = async () => {
    setSavingKey(true);
    try {
      await setProviderKey.mutateAsync("");
      toast.success("Reverted to mock mode");
    } catch (e) {
      toast.error(apiError(e, "Couldn't clear key"));
    }
    setSavingKey(false);
  };

  const patchProfile = async (payload: any) => {
    try {
      const { data } = await api.put("/auth/profile", payload);
      await setUser(data);
      return true;
    } catch (e) {
      toast.error(apiError(e, "Update failed"));
      return false;
    }
  };

  const saveName = async () => {
    if (!name.trim()) return toast.error("Name can't be empty");
    setSaving(true);
    const ok = await patchProfile({ name: name.trim() });
    setSaving(false);
    if (ok) {
      toast.success("Profile updated");
      setEditName(false);
    }
  };

  const setDefaultModel = (model_id: string) =>
    patchProfile({ settings: { ...settings, default_model: model_id } }).then((ok) => ok && toast.success("Default model saved"));

  const toggleNotifications = (v: boolean) =>
    patchProfile({ settings: { ...settings, notifications: v } });

  const onThemeChange = (m: string) => {
    setMode(m as ThemeMode);
    patchProfile({ settings: { ...settings, theme: m } });
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={{ paddingTop: insets.top + spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider }}>
        <DisplayText style={{ fontSize: 24 }}>Settings</DisplayText>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"], gap: spacing.lg }} showsVerticalScrollIndicator={false}>
        {/* Profile */}
        <Card>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
            <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ color: colors.onBrandPrimary, fontSize: 22, fontWeight: "700" }}>{(user?.name?.[0] || "C").toUpperCase()}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.onSurface, fontSize: 18, fontWeight: "700" }}>{user?.name}</Text>
              <Text style={{ color: colors.onSurfaceTertiary, fontSize: 13 }}>{user?.email}</Text>
            </View>
            <Pressable testID="edit-name-button" onPress={() => { setName(user?.name ?? ""); setEditName(true); }}>
              <Ionicons name="create-outline" size={22} color={colors.brandPrimary} />
            </Pressable>
          </View>
        </Card>

        {/* Appearance */}
        <View>
          <Text style={{ color: colors.onSurfaceTertiary, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: spacing.sm, marginLeft: spacing.xs }}>Appearance</Text>
          <Card>
            <Text style={{ color: colors.onSurface, fontSize: 15, fontWeight: "600", marginBottom: spacing.sm }}>Theme</Text>
            <Segmented testID="theme-segmented" options={[{ label: "Light", value: "light" }, { label: "Dark", value: "dark" }, { label: "System", value: "system" }]} value={mode} onChange={onThemeChange} />
          </Card>
        </View>

        {/* Default model */}
        <View>
          <Text style={{ color: colors.onSurfaceTertiary, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: spacing.sm, marginLeft: spacing.xs }}>Defaults</Text>
          <Card>
            <Text style={{ color: colors.onSurface, fontSize: 15, fontWeight: "600", marginBottom: spacing.sm }}>Default model</Text>
            <View style={{ gap: spacing.sm }}>
              {(models.data ?? []).map((m) => {
                const active = (settings.default_model ?? "") === m.model_id;
                return (
                  <Pressable key={m.model_id} testID={`default-model-${m.model_id}`} onPress={() => setDefaultModel(m.model_id)} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: active ? colors.brandPrimary : colors.border, backgroundColor: active ? colors.brandTertiary : "transparent" }}>
                    <Text style={{ color: colors.onSurface, fontWeight: "600" }}>{m.name}</Text>
                    <Ionicons name={active ? "radio-button-on" : "radio-button-off"} size={20} color={active ? colors.brandPrimary : colors.onSurfaceTertiary} />
                  </Pressable>
                );
              })}
            </View>
          </Card>
        </View>

        {/* AI Engine */}
        <View>
          <Text style={{ color: colors.onSurfaceTertiary, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: spacing.sm, marginLeft: spacing.xs }}>AI Engine</Text>
          <Card style={{ gap: spacing.md }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: isLive ? colors.success : colors.warning }} />
              <Text style={{ color: colors.onSurface, fontSize: 15, fontWeight: "700" }}>
                {isLive ? "Live — fal.ai" : "Mock mode"}
              </Text>
              {isLive && cfg?.key_masked && (
                <Text style={{ color: colors.onSurfaceTertiary, fontSize: 12 }}>{cfg.key_masked}</Text>
              )}
            </View>
            <Text style={{ color: colors.onSurfaceSecondary, fontSize: 13, lineHeight: 19 }}>
              {isLive
                ? "Generating real videos via fal.ai. You're billed per clip by fal.ai — lower resolutions cost less."
                : "Using free sample clips (no charges). Paste a fal.ai API key below to generate real videos."}
            </Text>

            {envManaged ? (
              <Text style={{ color: colors.onSurfaceTertiary, fontSize: 12 }}>
                Key is set on the server (FAL_KEY). Manage it in your host&apos;s environment variables.
              </Text>
            ) : (
              <>
                <TextField
                  testID="fal-key-input"
                  value={falKey}
                  onChangeText={setFalKey}
                  placeholder="fal.ai API key"
                  icon="key-outline"
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <Button
                  testID="save-fal-key-button"
                  title={isLive ? "Update key" : "Save key & go live"}
                  onPress={saveFalKey}
                  loading={savingKey}
                  disabled={!falKey.trim()}
                />
                {isLive && (
                  <Button
                    testID="clear-fal-key-button"
                    title="Revert to mock mode"
                    variant="secondary"
                    onPress={clearFalKey}
                    loading={savingKey}
                  />
                )}
              </>
            )}
          </Card>
        </View>

        {/* Preferences */}
        <View>
          <Text style={{ color: colors.onSurfaceTertiary, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: spacing.sm, marginLeft: spacing.xs }}>Preferences</Text>
          <Card style={{ paddingVertical: spacing.xs }}>
            <Row
              icon="notifications-outline"
              title="Completion alerts"
              subtitle="Get notified when a video is ready"
              right={<Switch testID="notifications-switch" value={settings.notifications ?? true} onValueChange={(v) => { toggleNotifications(v); }} trackColor={{ true: colors.brandPrimary, false: colors.border }} thumbColor="#fff" />}
            />
          </Card>
        </View>

        <Button testID="sign-out-button" title="Sign Out" variant="danger" icon="log-out-outline" onPress={signOut} />
        <Text style={{ color: colors.onSurfaceTertiary, fontSize: 11, textAlign: "center" }}>WanStudio · {isLive ? "Live generation (fal.ai)" : "Mock generation mode"}</Text>
      </ScrollView>

      {/* Edit name modal */}
      <Modal visible={editName} transparent animationType="fade" onRequestClose={() => setEditName(false)}>
        <Pressable style={{ flex: 1, backgroundColor: colors.scrim, justifyContent: "center", padding: spacing.xl }} onPress={() => setEditName(false)}>
          <Pressable style={{ backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.xl, gap: spacing.md }} onPress={() => {}}>
            <DisplayText style={{ fontSize: 20 }}>Edit name</DisplayText>
            <TextField testID="edit-name-input" value={name} onChangeText={setName} placeholder="Your name" autoFocus />
            <Button testID="save-name-button" title="Save" onPress={saveName} loading={saving} />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
