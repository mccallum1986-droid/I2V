import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { Redirect, useRouter } from "expo-router";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  useCancelGeneration,
  useGenerations,
  useRetryGeneration,
} from "@/src/api/hooks";
import { dataUri } from "@/src/components/cards";
import { DisplayText, EmptyState, IconButton, ProgressBar, StatusPill } from "@/src/components/ui";
import { useAuthStore } from "@/src/store/auth";
import { toast } from "@/src/store/toast";
import { radius, spacing, useTheme } from "@/src/theme";

export default function Queue() {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const authStatus = useAuthStore((s) => s.status);

  const query = useGenerations({ sort: "date" }, true, authStatus === "authed");
  const cancel = useCancelGeneration();
  const retry = useRetryGeneration();

  if (authStatus === "guest") return <Redirect href="/(auth)/login" />;

  const all = query.data ?? [];
  const jobs = all.filter((g) => ["queued", "processing", "failed", "cancelled"].includes(g.status));
  const anyActive = all.some((g) => g.status === "queued" || g.status === "processing");

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={{ paddingTop: insets.top + spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider }}>
        <Pressable testID="queue-back-button" onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <DisplayText style={{ fontSize: 24 }}>Generation queue</DisplayText>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"], gap: spacing.md }}
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => query.refetch()} tintColor={colors.brandPrimary} />}
      >
        {jobs.length === 0 ? (
          <EmptyState icon="layers-outline" title="Queue is empty" subtitle="Active and failed generations will appear here." />
        ) : (
          jobs.map((g) => {
            const active = g.status === "queued" || g.status === "processing";
            return (
              <Pressable key={g.id} testID={`queue-item-${g.id}`} onPress={() => router.push(`/generation/${g.id}`)} style={{ flexDirection: "row", gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border }}>
                <Image source={{ uri: dataUri(g.thumbnail_base64) }} style={{ width: 60, height: 60, borderRadius: radius.md }} contentFit="cover" />
                <View style={{ flex: 1, gap: 6, justifyContent: "center" }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <Text numberOfLines={1} style={{ color: colors.onSurface, fontWeight: "600", flex: 1, marginRight: spacing.sm }}>{g.prompt}</Text>
                    <StatusPill status={g.status} />
                  </View>
                  {active ? (
                    <>
                      <ProgressBar progress={g.progress} />
                      <Text style={{ color: colors.onSurfaceTertiary, fontSize: 11 }}>{g.stage} · {Math.round(g.progress)}%</Text>
                    </>
                  ) : (
                    <Text style={{ color: colors.onSurfaceTertiary, fontSize: 12 }}>{g.model_name}</Text>
                  )}
                </View>
                <View style={{ justifyContent: "center" }}>
                  {active ? (
                    <IconButton icon="close" testID={`cancel-${g.id}`} onPress={() => cancel.mutate(g.id)} />
                  ) : (
                    <IconButton icon="refresh" testID={`retry-${g.id}`} onPress={() => { retry.mutate(g.id); toast.info("Retrying..."); }} />
                  )}
                </View>
              </Pressable>
            );
          })
        )}
        {anyActive && <Text style={{ color: colors.onSurfaceTertiary, fontSize: 12, textAlign: "center" }}>Auto-refreshing…</Text>}
      </ScrollView>
    </View>
  );
}
