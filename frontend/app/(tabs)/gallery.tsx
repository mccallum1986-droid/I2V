import { useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useGenerations, useModels, useToggleGenerationFav } from "@/src/api/hooks";
import { VideoThumb } from "@/src/components/cards";
import { Chip, DisplayText, EmptyState, Segmented, TextField } from "@/src/components/ui";
import { spacing, useTheme } from "@/src/theme";

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

  const list = query.data ?? [];

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
        {list.length === 0 ? (
          <EmptyState icon="images-outline" title="Nothing here yet" subtitle={search ? "No videos match your search." : "Generate a video and it will show up in your gallery."} />
        ) : (
          <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" }}>
            {list.map((g) => (
              <View key={g.id} style={{ width: "48.5%", marginBottom: spacing.md }}>
                <VideoThumb gen={g} height={190} onPress={() => router.push(`/generation/${g.id}`)} onToggleFav={() => toggleFav.mutate(g.id)} />
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
