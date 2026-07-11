import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useCallback } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  useGenerations,
  useModels,
  useToggleGenerationFav,
} from "@/src/api/hooks";
import { ModelCard, VideoThumb } from "@/src/components/cards";
import { Button, DisplayText, EmptyState } from "@/src/components/ui";
import { useAuthStore } from "@/src/store/auth";
import { brandGradient, radius, spacing, useTheme } from "@/src/theme";

function SectionHeader({ title, actionLabel, onAction }: { title: string; actionLabel?: string; onAction?: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.md }}>
      <DisplayText style={{ fontSize: 20 }}>{title}</DisplayText>
      {actionLabel && (
        <Pressable onPress={onAction}>
          <Text style={{ color: colors.brandPrimary, fontWeight: "600", fontSize: 13 }}>{actionLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}

export default function Home() {
  const { colors, isDark } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);

  const recent = useGenerations({ sort: "date" }, true);
  const favs = useGenerations({ favourite: true });
  const models = useModels();
  const toggleFav = useToggleGenerationFav();

  const onRefresh = useCallback(() => {
    recent.refetch();
    favs.refetch();
    models.refetch();
  }, [recent, favs, models]);

  const recentList = recent.data ?? [];
  const favList = favs.data ?? [];
  const activeCount = recentList.filter((g) => g.status === "queued" || g.status === "processing").length;

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      {/* Sticky header */}
      <View style={{ paddingTop: insets.top + spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.divider, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <View>
          <Text style={{ color: colors.onSurfaceSecondary, fontSize: 13 }}>Welcome back</Text>
          <DisplayText style={{ fontSize: 24 }}>{user?.name?.split(" ")[0] || "Creator"}</DisplayText>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <Pressable testID="home-queue-button" onPress={() => router.push("/queue")} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="layers-outline" size={22} color={colors.onSurface} />
            {activeCount > 0 && (
              <View style={{ position: "absolute", top: 6, right: 6, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center", paddingHorizontal: 3 }}>
                <Text style={{ color: colors.onBrandPrimary, fontSize: 9, fontWeight: "800" }}>{activeCount}</Text>
              </View>
            )}
          </Pressable>
          <Pressable testID="home-avatar" onPress={() => router.push("/(tabs)/settings")} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: colors.onBrandTertiary, fontWeight: "700", fontSize: 17 }}>
              {(user?.name?.[0] || "C").toUpperCase()}
            </Text>
          </Pressable>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={recent.isRefetching} onRefresh={onRefresh} tintColor={colors.brandPrimary} />}
      >
        {/* Hero */}
        <LinearGradient colors={brandGradient(isDark)} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: radius.lg, padding: spacing.xl, marginBottom: spacing.xl, overflow: "hidden" }}>
          <Ionicons name="sparkles" size={26} color={colors.onBrandPrimary} />
          <DisplayText style={{ color: colors.onBrandPrimary, fontSize: 26, marginTop: spacing.sm, lineHeight: 30 }}>
            Turn images into{"\n"}cinematic video
          </DisplayText>
          <Text style={{ color: colors.onBrandPrimary, opacity: 0.85, marginTop: 6, marginBottom: spacing.lg, fontSize: 14 }}>
            Upload a photo, describe the motion, and let AI do the rest.
          </Text>
          <Button
            testID="home-create-button"
            title="Create Video"
            icon="add"
            variant="secondary"
            size="md"
            onPress={() => router.push("/(tabs)/create")}
            style={{ alignSelf: "flex-start", paddingHorizontal: spacing.xl, backgroundColor: isDark ? "rgba(0,0,0,0.25)" : "rgba(255,255,255,0.9)" }}
          />
        </LinearGradient>

        {/* Recent */}
        <SectionHeader title="Recent generations" actionLabel={recentList.length ? "Gallery" : undefined} onAction={() => router.push("/(tabs)/gallery")} />
        {recentList.length === 0 ? (
          <EmptyState
            icon="film-outline"
            title="No videos yet"
            subtitle="Your creations will appear here. Start with your first video."
            action={<Button testID="empty-create-button" title="Create First Video" icon="add" onPress={() => router.push("/(tabs)/create")} />}
          />
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.md, paddingRight: spacing.lg }} style={{ marginHorizontal: -spacing.lg, paddingHorizontal: spacing.lg, marginBottom: spacing.xl }}>
            {recentList.slice(0, 8).map((g) => (
              <VideoThumb key={g.id} gen={g} width={260} height={210} onPress={() => router.push(`/generation/${g.id}`)} onToggleFav={() => toggleFav.mutate(g.id)} />
            ))}
          </ScrollView>
        )}

        {/* Favourites */}
        {favList.length > 0 && (
          <>
            <SectionHeader title="Favourites" />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.md, paddingRight: spacing.lg }} style={{ marginHorizontal: -spacing.lg, paddingHorizontal: spacing.lg, marginBottom: spacing.xl }}>
              {favList.slice(0, 8).map((g) => (
                <VideoThumb key={g.id} gen={g} width={200} height={200} onPress={() => router.push(`/generation/${g.id}`)} onToggleFav={() => toggleFav.mutate(g.id)} />
              ))}
            </ScrollView>
          </>
        )}

        {/* Models */}
        <SectionHeader title="AI Models" />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.md, paddingRight: spacing.lg }} style={{ marginHorizontal: -spacing.lg, paddingHorizontal: spacing.lg }}>
          {(models.data ?? []).map((m) => (
            <ModelCard key={m.model_id} model={m} compact onPress={() => router.push({ pathname: "/(tabs)/create", params: { model: m.model_id } })} />
          ))}
        </ScrollView>
      </ScrollView>
    </View>
  );
}
