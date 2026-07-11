import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import * as Haptics from "expo-haptics";
import React from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from "react-native";

import { radius, spacing, useTheme } from "@/src/theme";

// ------------------------------------------------------------- Text
export function AppText(props: React.ComponentProps<typeof Text>) {
  const { colors } = useTheme();
  return (
    <Text {...props} style={[{ color: colors.onSurface }, props.style]}>
      {props.children}
    </Text>
  );
}

export function DisplayText(props: React.ComponentProps<typeof Text>) {
  const { colors } = useTheme();
  return (
    <Text
      {...props}
      style={[
        { color: colors.onSurface, fontWeight: "600", letterSpacing: -0.5 },
        props.style,
      ]}
    >
      {props.children}
    </Text>
  );
}

// ------------------------------------------------------------- Button
type ButtonProps = {
  title: string;
  onPress?: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  loading?: boolean;
  disabled?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  style?: ViewStyle;
  testID?: string;
  size?: "md" | "lg";
};

export function Button({
  title,
  onPress,
  variant = "primary",
  loading,
  disabled,
  icon,
  style,
  testID,
  size = "lg",
}: ButtonProps) {
  const { colors } = useTheme();
  const isDisabled = disabled || loading;

  const bg =
    variant === "primary"
      ? colors.brandPrimary
      : variant === "danger"
        ? colors.error
        : variant === "secondary"
          ? colors.surfaceTertiary
          : "transparent";
  const fg =
    variant === "primary"
      ? colors.onBrandPrimary
      : variant === "danger"
        ? "#FFFFFF"
        : colors.onSurface;

  return (
    <Pressable
      testID={testID}
      onPress={() => {
        if (isDisabled) return;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        onPress?.();
      }}
      disabled={isDisabled}
      style={({ pressed }) => [
        {
          height: size === "lg" ? 54 : 44,
          borderRadius: radius.md,
          backgroundColor: bg,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: spacing.sm,
          paddingHorizontal: spacing.lg,
          opacity: isDisabled ? 0.5 : pressed ? 0.85 : 1,
          borderWidth: variant === "ghost" ? 1 : 0,
          borderColor: colors.border,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {icon && <Ionicons name={icon} size={18} color={fg} />}
          <Text style={{ color: fg, fontWeight: "600", fontSize: 16 }}>
            {title}
          </Text>
        </>
      )}
    </Pressable>
  );
}

// ------------------------------------------------------------- IconButton
export function IconButton({
  icon,
  onPress,
  color,
  bg,
  size = 42,
  testID,
  active,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
  color?: string;
  bg?: string;
  size?: number;
  testID?: string;
  active?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      testID={testID}
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        onPress?.();
      }}
      style={({ pressed }) => ({
        width: size,
        height: size,
        borderRadius: radius.md,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: active ? colors.brandTertiary : bg ?? colors.surfaceTertiary,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Ionicons
        name={icon}
        size={size * 0.46}
        color={active ? colors.brandPrimary : color ?? colors.onSurface}
      />
    </Pressable>
  );
}

// ------------------------------------------------------------- Card
export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: colors.surfaceSecondary,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: colors.border,
          padding: spacing.lg,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

// ------------------------------------------------------------- GlassCard
export function GlassCard({
  children,
  style,
  intensity = 40,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
  intensity?: number;
}) {
  const { colors, isDark } = useTheme();
  if (Platform.OS === "web") {
    return (
      <View style={[styles.glassBase, { backgroundColor: colors.glassTint, borderColor: colors.border }, style]}>
        {children}
      </View>
    );
  }
  return (
    <BlurView
      intensity={intensity}
      tint={isDark ? "dark" : "light"}
      style={[styles.glassBase, { borderColor: colors.border }, style]}
    >
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.glassTint }]} />
      {children}
    </BlurView>
  );
}

// ------------------------------------------------------------- Chip
export function Chip({
  label,
  selected,
  onPress,
  testID,
  icon,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  testID?: string;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      testID={testID}
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        onPress?.();
      }}
      style={{
        height: 36,
        flexShrink: 0,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: spacing.md,
        borderRadius: radius.pill,
        borderWidth: 1,
        backgroundColor: selected ? colors.brandPrimary : "transparent",
        borderColor: selected ? colors.brandPrimary : colors.border,
      }}
    >
      {icon && (
        <Ionicons
          name={icon}
          size={14}
          color={selected ? colors.onBrandPrimary : colors.onSurfaceSecondary}
        />
      )}
      <Text
        style={{
          fontSize: 13,
          fontWeight: "600",
          color: selected ? colors.onBrandPrimary : colors.onSurfaceSecondary,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

// ------------------------------------------------------------- TextField
type FieldProps = TextInputProps & {
  label?: string;
  error?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  rightIcon?: keyof typeof Ionicons.glyphMap;
  onRightIconPress?: () => void;
  testID?: string;
};

export function TextField({
  label,
  error,
  icon,
  rightIcon,
  onRightIconPress,
  style,
  testID,
  ...rest
}: FieldProps) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      {label && (
        <Text style={{ color: colors.onSurfaceSecondary, fontSize: 13, fontWeight: "600" }}>
          {label}
        </Text>
      )}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          backgroundColor: colors.surfaceTertiary,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: error ? colors.error : colors.border,
          paddingHorizontal: spacing.md,
        }}
      >
        {icon && <Ionicons name={icon} size={18} color={colors.onSurfaceTertiary} />}
        <TextInput
          testID={testID}
          placeholderTextColor={colors.onSurfaceTertiary}
          style={[
            {
              flex: 1,
              color: colors.onSurface,
              fontSize: 16,
              paddingVertical: 14,
              paddingHorizontal: icon ? spacing.sm : 0,
            },
            style,
          ]}
          {...rest}
        />
        {rightIcon && (
          <Pressable onPress={onRightIconPress} hitSlop={10}>
            <Ionicons name={rightIcon} size={20} color={colors.onSurfaceTertiary} />
          </Pressable>
        )}
      </View>
      {!!error && (
        <Text style={{ color: colors.error, fontSize: 12 }}>{error}</Text>
      )}
    </View>
  );
}

// ------------------------------------------------------------- SegmentedControl
export function Segmented({
  options,
  value,
  onChange,
  testID,
}: {
  options: { label: string; value: string }[];
  value: string;
  onChange: (v: string) => void;
  testID?: string;
}) {
  const { colors } = useTheme();
  return (
    <View
      testID={testID}
      style={{
        flexDirection: "row",
        backgroundColor: colors.surfaceTertiary,
        borderRadius: radius.md,
        padding: 4,
        gap: 4,
      }}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              onChange(o.value);
            }}
            style={{
              flex: 1,
              paddingVertical: 9,
              borderRadius: radius.sm + 2,
              alignItems: "center",
              backgroundColor: active ? colors.surfaceSecondary : "transparent",
            }}
          >
            <Text
              style={{
                fontSize: 13,
                fontWeight: "600",
                color: active ? colors.onSurface : colors.onSurfaceTertiary,
              }}
            >
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ------------------------------------------------------------- ProgressBar
export function ProgressBar({ progress }: { progress: number }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        height: 8,
        borderRadius: radius.pill,
        backgroundColor: colors.surfaceTertiary,
        overflow: "hidden",
      }}
    >
      <View
        style={{
          width: `${Math.max(2, Math.min(100, progress))}%`,
          height: "100%",
          backgroundColor: colors.brandPrimary,
          borderRadius: radius.pill,
        }}
      />
    </View>
  );
}

// ------------------------------------------------------------- StatusPill
export function StatusPill({ status }: { status: string }) {
  const { colors } = useTheme();
  const map: Record<string, string> = {
    completed: colors.success,
    processing: colors.info,
    queued: colors.warning,
    failed: colors.error,
    cancelled: colors.onSurfaceTertiary,
  };
  const color = map[status] ?? colors.onSurfaceTertiary;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: radius.pill,
        backgroundColor: color + "22",
      }}
    >
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
      <Text style={{ color, fontSize: 11, fontWeight: "700", textTransform: "capitalize" }}>
        {status}
      </Text>
    </View>
  );
}

// ------------------------------------------------------------- EmptyState
export function EmptyState({
  icon,
  title,
  subtitle,
  action,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ alignItems: "center", paddingVertical: spacing["3xl"], paddingHorizontal: spacing.xl, gap: spacing.sm }}>
      <View
        style={{
          width: 72,
          height: 72,
          borderRadius: radius.lg,
          backgroundColor: colors.brandTertiary,
          alignItems: "center",
          justifyContent: "center",
          marginBottom: spacing.sm,
        }}
      >
        <Ionicons name={icon} size={34} color={colors.brandPrimary} />
      </View>
      <DisplayText style={{ fontSize: 20 }}>{title}</DisplayText>
      {subtitle && (
        <Text style={{ color: colors.onSurfaceSecondary, textAlign: "center", fontSize: 14, lineHeight: 20 }}>
          {subtitle}
        </Text>
      )}
      {action && <View style={{ marginTop: spacing.md }}>{action}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  glassBase: {
    borderRadius: radius.lg,
    borderWidth: 1,
    overflow: "hidden",
  },
});
