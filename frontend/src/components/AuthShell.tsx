import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import { StyleSheet, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { DisplayText, AppText } from "@/src/components/ui";
import { radius, spacing, useTheme } from "@/src/theme";

const BG =
  "https://images.unsplash.com/photo-1710438399422-2fca27686bcd?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1MDV8MHwxfHNlYXJjaHwxfHxhYnN0cmFjdCUyMGRhcmslMjBsdXh1cnklMjBiYWNrZ3JvdW5kfGVufDB8fHx8MTc4MzA3MzE1Mnww&ixlib=rb-4.1.0&q=85";

export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <Image source={{ uri: BG }} style={StyleSheet.absoluteFill} contentFit="cover" />
      <LinearGradient
        colors={[
          isDark ? "rgba(10,10,10,0.2)" : "rgba(250,250,250,0.3)",
          isDark ? "rgba(10,10,10,0.85)" : "rgba(250,250,250,0.9)",
          colors.surface,
        ]}
        locations={[0, 0.55, 0.9]}
        style={StyleSheet.absoluteFill}
      />
      <KeyboardAwareScrollView
        bottomOffset={20}
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: "flex-end",
          paddingHorizontal: spacing.xl,
          paddingBottom: insets.bottom + spacing.xl,
          paddingTop: insets.top + spacing["3xl"],
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: radius.md,
            backgroundColor: colors.brandPrimary,
            alignItems: "center",
            justifyContent: "center",
            marginBottom: spacing.lg,
          }}
        >
          <Ionicons name="videocam" size={30} color={colors.onBrandPrimary} />
        </View>
        <DisplayText style={{ fontSize: 34, lineHeight: 40 }}>{title}</DisplayText>
        <AppText style={{ color: colors.onSurfaceSecondary, fontSize: 15, marginTop: 6, marginBottom: spacing.xl }}>
          {subtitle}
        </AppText>
        {children}
      </KeyboardAwareScrollView>
    </View>
  );
}
