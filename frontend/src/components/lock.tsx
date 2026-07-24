import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { AppState, Modal, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuthStore } from "@/src/store/auth";
import { useLockStore } from "@/src/store/lock";
import { toast } from "@/src/store/toast";
import { spacing, useTheme } from "@/src/theme";

const PIN_LENGTH = 4;
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"];

/** Numeric PIN entry: dots + keypad. Calls onComplete when PIN_LENGTH digits are in. */
function PinPad({ title, subtitle, error, onComplete }: { title: string; subtitle?: string; error?: string; onComplete: (pin: string) => void }) {
  const { colors } = useTheme();
  const [pin, setPin] = useState("");

  // Clear the entry whenever an error is shown (wrong PIN / mismatch).
  useEffect(() => { if (error) setPin(""); }, [error]);

  const press = (k: string) => {
    if (k === "del") { setPin((p) => p.slice(0, -1)); return; }
    if (!k || pin.length >= PIN_LENGTH) return;
    const next = pin + k;
    setPin(next);
    if (next.length === PIN_LENGTH) {
      onComplete(next);
      setTimeout(() => setPin(""), 200);
    }
  };

  return (
    <View style={{ alignItems: "center", gap: spacing.xl, width: "100%" }}>
      <View style={{ alignItems: "center", gap: 6 }}>
        <Ionicons name="lock-closed" size={34} color={colors.brandPrimary} />
        <Text style={{ color: colors.onSurface, fontSize: 20, fontWeight: "700" }}>{title}</Text>
        {!!subtitle && <Text style={{ color: colors.onSurfaceTertiary, fontSize: 13 }}>{subtitle}</Text>}
      </View>

      <View style={{ flexDirection: "row", gap: spacing.md, height: 20 }}>
        {Array.from({ length: PIN_LENGTH }).map((_, i) => (
          <View key={i} style={{ width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: error ? colors.error : colors.brandPrimary, backgroundColor: i < pin.length ? (error ? colors.error : colors.brandPrimary) : "transparent" }} />
        ))}
      </View>
      <Text style={{ color: colors.error, fontSize: 13, height: 18 }}>{error || ""}</Text>

      <View style={{ flexDirection: "row", flexWrap: "wrap", width: 260, justifyContent: "space-between", rowGap: spacing.md }}>
        {KEYS.map((k, i) => (
          <Pressable
            key={i}
            testID={k ? `pin-key-${k}` : undefined}
            onPress={() => press(k)}
            disabled={!k}
            style={{ width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center", backgroundColor: k ? colors.surfaceSecondary : "transparent", borderWidth: k && k !== "del" ? 1 : 0, borderColor: colors.border }}
          >
            {k === "del" ? (
              <Ionicons name="backspace-outline" size={26} color={colors.onSurface} />
            ) : (
              <Text style={{ color: colors.onSurface, fontSize: 26, fontWeight: "600" }}>{k}</Text>
            )}
          </Pressable>
        ))}
      </View>
    </View>
  );
}

/** Full-screen lock overlay shown when a PIN is set and the app is locked. */
export function LockGate() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const locked = useLockStore((s) => s.locked);
  const hydrate = useLockStore((s) => s.hydrate);
  const unlock = useLockStore((s) => s.unlock);
  const lock = useLockStore((s) => s.lock);
  const clearPin = useLockStore((s) => s.clearPin);
  const signOut = useAuthStore((s) => s.signOut);
  const [error, setError] = useState("");

  useEffect(() => { hydrate(); }, [hydrate]);

  // Re-lock whenever the app is sent to the background.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => { if (s === "background") lock(); });
    return () => sub.remove();
  }, [lock]);

  if (!locked) return null;

  return (
    <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.surface, zIndex: 1000, elevation: 1000, paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.lg, paddingHorizontal: spacing.lg, alignItems: "center", justifyContent: "center", gap: spacing.xl }}>
      <PinPad
        title="Enter PIN"
        subtitle="WanStudio is locked"
        error={error}
        onComplete={async (pin) => {
          const ok = await unlock(pin);
          setError(ok ? "" : "Incorrect PIN");
        }}
      />
      <Pressable testID="lock-forgot" onPress={async () => { await clearPin(); signOut(); }} hitSlop={8}>
        <Text style={{ color: colors.onSurfaceTertiary, fontSize: 13 }}>Forgot PIN? Sign out to reset</Text>
      </Pressable>
    </View>
  );
}

/** Modal to set (and confirm) a new PIN. */
export function PinSetupModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const setPin = useLockStore((s) => s.setPin);
  const [first, setFirst] = useState<string | null>(null);
  const [error, setError] = useState("");

  const reset = () => { setFirst(null); setError(""); };
  const close = () => { reset(); onClose(); };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close}>
      <View style={{ flex: 1, backgroundColor: colors.surface, paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.lg, paddingHorizontal: spacing.lg, alignItems: "center", justifyContent: "center", gap: spacing.xl }}>
        <PinPad
          title={first ? "Confirm PIN" : "Set a 4-digit PIN"}
          subtitle={first ? "Enter it again" : "You'll enter this to open the app"}
          error={error}
          onComplete={async (pin) => {
            if (!first) { setFirst(pin); setError(""); }
            else if (pin === first) { await setPin(pin); toast.success("App lock enabled"); close(); }
            else { setFirst(null); setError("PINs didn't match — start again"); }
          }}
        />
        <Pressable testID="pin-setup-cancel" onPress={close} hitSlop={8} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Ionicons name="close" size={18} color={colors.onSurfaceSecondary} />
          <Text style={{ color: colors.onSurfaceSecondary, fontSize: 14, fontWeight: "600" }}>Cancel</Text>
        </Pressable>
      </View>
    </Modal>
  );
}
