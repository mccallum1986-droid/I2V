import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useDeleteGeneration, useDeletePrompt, useGenerations, useModels, usePrompts, useToggleGenerationFav, useTogglePromptFav } from "@/src/api/hooks";
import { VideoThumb } from "@/src/components/cards";
import { Chip, DisplayText, EmptyState, Segmented, TextField } from "@/src/components/ui";
import { radius, spacing, useTheme } from "@/src/theme";

export default function Gallery() {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<string>("all"); // all | fav | model id
  const [sort, setSort] = useState<"date" | "model">("date");

  const models = useModels();
  const query = useGenerations({
    search,
    sort,
    favourite: filter === "fav",
    model: filter !== "all" && filter !== "fav" ? filter : "",
  });
  const toggleFav = useToggleGenerationFav();
  const del = useDeleteGeneration();

  const favPrompts = usePrompts(true).data ?? [];
  const togglePromptFav = useTogglePromptFav();
  const deletePrompt = useDeletePrompt();

  const list = query.data ?? [];
  const showFavPrompts = filter === "fav" && favPrompts.length > 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      {/* Sticky header */}
      <View style={{ paddingTop: insets.top + spacing.sm, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.divider }}>
        <View style={{ paddingHorizontal: spacing.lg }}>
          <DisplayText style={{ fontSize: 24, marginBottom: spacing.md }}>Gallery</DisplayText>
          <TextField testID="gallery-search-input" icon="search" placeholder="Search prompts..." value={search} onChangeText={setSearch} returnKeyType="search" />
          <View style={{ height: spacing.md }} />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingHorizontal: spacing.lg }} style={{ height: 56 }}>
          <Chip label="All" selected={filter === "all"} onPress={() => setFilter("all")} testID="filter-all" />
          <Chip label="Favourites" icon="heart" selected={filter === "fav"} onPress={() => setFilter("fav")} testID="filter-fav" />
          {(models.data ?? []).map((m) => (
            <Chip key={m.model_id} label={m.name} selected={filter === m.model_id} onPress={() => setFilter(m.model_id)} testID={`filter-${m.model_id}`} />
          ))}
        </ScrollView>
        <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.md }}>
          <Segmented testID="gallery-sort" options={[{ label: "Newest", value: "date" }, { label: "By model", value: "model" }]} value={sort} onChange={(v) => setSort(v as any)} />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => query.refetch()} tintColor={colors.brandPrimary} />}
      >
        {showFavPrompts && (
          <View style={{ marginBottom: spacing.xl }}>
            <DisplayText style={{ fontSize: 18, marginBottom: spacing.xs }}>Favourite prompts</DisplayText>
            <Text style={{ color: colors.onSurfaceTertiary, fontSize: 12, marginBottom: spacing.sm }}>Long-press a prompt to copy it, or tap Use to load it into Create.</Text>
            {favPrompts.map((p) => (
              <View key={p.id} style={{ backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm }}>
                <Text selectable style={{ color: colors.onSurface, fontSize: 14, lineHeight: 20 }}>{p.text}</Text>
                {!!p.negative_prompt && (
                  <Text selectable style={{ color: colors.onSurfaceTertiary, fontSize: 12, marginTop: 4 }}>Negative: {p.negative_prompt}</Text>
                )}
                <View style={{ flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: spacing.lg, marginTop: spacing.sm }}>
                  <Pressable testID={`use-prompt-${p.id}`} onPress={() => router.push({ pathname: "/(tabs)/create", params: { prompt: p.text, negative: p.negative_prompt } })} style={{ flexDirection: "row", alignItems: "center", gap: 4 }} hitSlop={8}>
                    <Ionicons name="arrow-forward-circle-outline" size={18} color={colors.brandPrimary} />
                    <Text style={{ color: colors.brandPrimary, fontWeight: "600", fontSize: 13 }}>Use</Text>
                  </Pressable>
                  <Pressable onPress={() => togglePromptFav.mutate(p.id)} hitSlop={8}><Ionicons name="star" size={18} color={colors.warning} /></Pressable>
                  <Pressable onPress={() => deletePrompt.mutate(p.id)} hitSlop={8}><Ionicons name="trash-outline" size={18} color={colors.error} /></Pressable>
                </View>
              </View>
            ))}
          </View>
        )}

        {list.length === 0 ? (
          showFavPrompts ? null : (
            <EmptyState icon="images-outline" title="Nothing here yet" subtitle={search ? "No videos match your search." : "Generate a video and it will show up in your gallery."} />
          )
        ) : (
          <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" }}>
            {list.map((g) => (
              <View key={g.id} style={{ width: "48.5%", marginBottom: spacing.md }}>
                <VideoThumb gen={g} height={190} onPress={() => router.push(`/generation/${g.id}`)} onLongPress={() => del.mutate(g.id)} onToggleFav={() => toggleFav.mutate(g.id)} />
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
