import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Pressable, Text, View } from "react-native";

import { Generation, Model } from "@/src/api/hooks";
import { StatusPill } from "@/src/components/ui";
import { radius, spacing, useTheme } from "@/src/theme";

export function dataUri(b64?: string | null): string | undefined {
  if (!b64) return undefined;
  return b64.startsWith("data:") ? b64 : `data:image/jpeg;base64,${b64}`;
}

export function timeAgo(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso).getTime();
  const s = Math.floor((Date.now() - d) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function VideoThumb({
  gen,
  onPress,
  onLongPress,
  onToggleFav,
  width,
  height = 200,
}: {
  gen: Generation;
  onPress: () => void;
  onLongPress?: () => void;
  onToggleFav?: () => void;
  width?: number;
  height?: number;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      testID={`video-card-${gen.id}`}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={600}
      style={{
        width,
        height,
        borderRadius: radius.lg,
        overflow: "hidden",
        backgroundColor: colors.surfaceTertiary,
      }}
    >
      <Image source={{ uri: dataUri(gen.thumbnail_base64) }} style={{ flex: 1 }} contentFit="cover" />
      <LinearGradient
        colors={["transparent", "rgba(0,0,0,0.15)", "rgba(0,0,0,0.85)"]}
        locations={[0, 0.5, 1]}
        style={{ position: "absolute", left: 0, right: 0, bottom: 0, top: 0 }}
      />
      <View style={{ position: "absolute", top: spacing.sm, left: spacing.sm, right: spacing.sm, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
        <StatusPill status={gen.status} />
        {onToggleFav && (
          <Pressable
            testID={`fav-toggle-${gen.id}`}
            onPress={(e) => {
              e.stopPropagation?.();
              onToggleFav();
            }}
            hitSlop={8}
            style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: "rgba(0,0,0,0.4)", alignItems: "center", justifyContent: "center" }}
          >
            <Ionicons name={gen.is_favourite ? "heart" : "heart-outline"} size={16} color={gen.is_favourite ? colors.error : "#fff"} />
          </Pressable>
        )}
      </View>
      {gen.status === "completed" && (
        <View style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0, alignItems: "center", justifyContent: "center" }}>
          <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(255,255,255,0.9)", alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="play" size={22} color="#0A0A0A" style={{ marginLeft: 3 }} />
          </View>
        </View>
      )}
      <View style={{ position: "absolute", bottom: spacing.md, left: spacing.md, right: spacing.md }}>
        <Text numberOfLines={1} style={{ color: "#fff", fontSize: 14, fontWeight: "600" }}>
          {gen.prompt}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 3 }}>
          <Text style={{ color: "rgba(255,255,255,0.85)", fontSize: 11, fontWeight: "500" }}>{gen.model_name}</Text>
          <View style={{ width: 3, height: 3, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.6)" }} />
          <Text style={{ color: "rgba(255,255,255,0.7)", fontSize: 11 }}>{timeAgo(gen.created_at)}</Text>
        </View>
      </View>
    </Pressable>
  );
}

function Indicator({ label, value, level }: { label: string; value: string; level: number }) {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ color: colors.onSurfaceTertiary, fontSize: 10, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</Text>
      <Text style={{ color: colors.onSurface, fontSize: 13, fontWeight: "600", marginTop: 2 }}>{value}</Text>
      <View style={{ flexDirection: "row", gap: 3, marginTop: 5 }}>
        {[1, 2, 3].map((i) => (
          <View
            key={i}
            style={{
              flex: 1,
              height: 3,
              borderRadius: 2,
              backgroundColor: i <= level ? colors.brandPrimary : colors.border,
            }}
          />
        ))}
      </View>
    </View>
  );
}

const speedLevel: Record<string, number> = { Fast: 3, Balanced: 2, Slow: 1 };
const qualityLevel: Record<string, number> = { Ultra: 3, High: 2, Standard: 1 };

export function ModelCard({
  model,
  selected,
  onPress,
  compact,
}: {
  model: Model;
  selected?: boolean;
  onPress: () => void;
  compact?: boolean;
}) {
  const { colors } = useTheme();

  if (compact) {
    return (
      <Pressable
        testID={`model-quick-${model.model_id}`}
        onPress={onPress}
        style={{
          width: 150,
          padding: spacing.md,
          borderRadius: radius.lg,
          backgroundColor: colors.surfaceSecondary,
          borderWidth: 1,
          borderColor: colors.border,
          gap: 6,
        }}
      >
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Ionicons name="film-outline" size={20} color={colors.brandPrimary} />
          <View style={{ backgroundColor: colors.brandTertiary, paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill }}>
            <Text style={{ color: colors.onBrandTertiary, fontSize: 9, fontWeight: "700" }}>{model.badge}</Text>
          </View>
        </View>
        <Text style={{ color: colors.onSurface, fontSize: 15, fontWeight: "700", marginTop: 4 }}>{model.name}</Text>
        <Text numberOfLines={2} style={{ color: colors.onSurfaceSecondary, fontSize: 11, lineHeight: 15 }}>
          {model.use_case}
        </Text>
      </Pressable>
    );
  }

  return (
    <Pressable
      testID={`model-card-${model.model_id}`}
      onPress={onPress}
      style={{
        padding: spacing.lg,
        borderRadius: radius.lg,
        backgroundColor: selected ? colors.brandTertiary : colors.surfaceSecondary,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? colors.brandPrimary : colors.border,
        gap: spacing.sm,
      }}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <Text style={{ color: colors.onSurface, fontSize: 17, fontWeight: "700" }}>{model.name}</Text>
          <View style={{ backgroundColor: colors.brandPrimary, paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill }}>
            <Text style={{ color: colors.onBrandPrimary, fontSize: 9, fontWeight: "700" }}>{model.badge}</Text>
          </View>
          {model.requires_vip && (
            <View style={{ backgroundColor: colors.warning, paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill }}>
              <Text style={{ color: "#1A1200", fontSize: 9, fontWeight: "800" }}>VIP</Text>
            </View>
          )}
        </View>
        {selected ? (
          <Ionicons name="checkmark-circle" size={24} color={colors.brandPrimary} />
        ) : (
          <Ionicons name="ellipse-outline" size={24} color={colors.onSurfaceTertiary} />
        )}
      </View>
      <Text style={{ color: colors.onSurfaceSecondary, fontSize: 13, lineHeight: 18 }}>{model.description}</Text>
      <View style={{ flexDirection: "row", gap: spacing.lg, marginTop: spacing.xs }}>
        <Indicator label="Speed" value={model.speed} level={speedLevel[model.speed] ?? 2} />
        <Indicator label="Quality" value={model.quality} level={qualityLevel[model.quality] ?? 2} />
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.xs }}>
        <Ionicons name="bulb-outline" size={13} color={colors.onSurfaceTertiary} />
        <Text style={{ color: colors.onSurfaceTertiary, fontSize: 12, flex: 1 }}>{model.use_case}</Text>
      </View>
    </Pressable>
  );
}
