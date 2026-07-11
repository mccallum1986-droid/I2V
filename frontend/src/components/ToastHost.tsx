import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { FadeInDown, FadeOutUp } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useToastStore } from "@/src/store/toast";
import { radius, spacing, useTheme } from "@/src/theme";

export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts);
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const iconFor = { success: "checkmark-circle", error: "alert-circle", info: "information-circle" } as const;
  const colorFor = { success: colors.success, error: colors.error, info: colors.info };

  return (
    <View pointerEvents="none" style={[styles.wrap, { top: insets.top + spacing.sm }]}>
      {toasts.map((t) => (
        <Animated.View
          key={t.id}
          entering={FadeInDown}
          exiting={FadeOutUp}
          testID={`toast-${t.type}`}
          style={[
            styles.toast,
            { backgroundColor: colors.surfaceSecondary, borderColor: colors.border },
          ]}
        >
          <Ionicons name={iconFor[t.type]} size={20} color={colorFor[t.type]} />
          <Text style={{ color: colors.onSurface, flex: 1, fontSize: 14, fontWeight: "500" }}>
            {t.message}
          </Text>
        </Animated.View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    zIndex: 9999,
    gap: spacing.sm,
  },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
});
