import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useDeleteGeneration, useDeletePrompt, useGenerations, useModels, usePrompts, useSavePrompt, useToggleGenerationFav, useTogglePromptFav } from "@/src/api/hooks";
import { VideoThumb } from "@/src/components/cards";
import { Button, Chip, DisplayText, EmptyState, Segmented, TextField } from "@/src/components/ui";
import { toast } from "@/src/store/toast";
import { radius, spacing, useTheme } from "@/src/theme";

export default function Gallery() {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<string>("all"); // all | fav | model id
  const [view, setView] = useState<"date" | "model" | "prompts">("date");
  const isPrompts = view === "prompts";
  const sort = view === "model" ? "model" : "date";

  const models = useModels();
  const query = useGenerations(
    { search, sort, favourite: filter === "fav", model: filter !== "all" && filter !== "fav" ? filter : "" },
    false,
    !isPrompts, // don't fetch videos while on the Prompts tab
  );
  const toggleFav = useToggleGenerationFav();
  const del = useDeleteGeneration();

  const keptPrompts = usePrompts(true).data ?? [];
  const savePrompt = useSavePrompt();
  const togglePromptFav = useTogglePromptFav();
  const deletePrompt = useDeletePrompt();
  const [newPrompt, setNewPrompt] = useState("");
  const [newNegative, setNewNegative] = useState("");

  const list = query.data ?? [];
  const q = search.trim().toLowerCase();
  const shownPrompts = q ? keptPrompts.filter((p) => p.text.toLowerCase().includes(q)) : keptPrompts;

  const addPrompt = () => {
    if (!newPrompt.trim()) return toast.error("Enter a prompt to save");
    savePrompt.mutate({ text: newPrompt.trim(), negative_prompt: newNegative.trim(), is_favourite: true });
    setNewPrompt("");
    setNewNegative("");
    toast.success("Prompt saved");
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      {/* Sticky header */}
      <View style={{ paddingTop: insets.top + spacing.sm, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.divider }}>
        <View style={{ paddingHorizontal: spacing.lg }}>
          <DisplayText style={{ fontSize: 24, marginBottom: spacing.md }}>Gallery</DisplayText>
          <TextField testID="gallery-search-input" icon="search" placeholder={isPrompts ? "Search saved prompts..." : "Search prompts..."} value={search} onChangeText={setSearch} returnKeyType="search" />
          <View style={{ height: spacing.md }} />
        </View>
        {!isPrompts && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingHorizontal: spacing.lg }} style={{ height: 56 }}>
            <Chip label="All" selected={filter === "all"} onPress={() => setFilter("all")} testID="filter-all" />
            <Chip label="Favourites" icon="heart" selected={filter === "fav"} onPress={() => setFilter("fav")} testID="filter-fav" />
            {(models.data ?? []).map((m) => (
              <Chip key={m.model_id} label={m.name} selected={filter === m.model_id} onPress={() => setFilter(m.model_id)} testID={`filter-${m.model_id}`} />
            ))}
          </ScrollView>
        )}
        <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.md, paddingTop: isPrompts ? spacing.sm : 0 }}>
          <Segmented testID="gallery-view" options={[{ label: "Newest", value: "date" }, { label: "By model", value: "model" }, { label: "Prompts", value: "prompts" }]} value={view} onChange={(v) => setView(v as any)} />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => query.refetch()} tintColor={colors.brandPrimary} />}
      >
        {isPrompts ? (
          <View style={{ gap: spacing.md }}>
            {/* Add a prompt */}
            <View style={{ backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.sm }}>
              <Text style={{ color: colors.onSurface, fontWeight: "700", fontSize: 15 }}>Save a prompt</Text>
              <TextField testID="new-prompt-input" placeholder="Type a prompt to keep..." value={newPrompt} onChangeText={setNewPrompt} multiline style={{ minHeight: 72, textAlignVertical: "top", paddingVertical: 12 }} />
              <TextField testID="new-negative-input" placeholder="Negative prompt (optional)" value={newNegative} onChangeText={setNewNegative} multiline style={{ minHeight: 44, textAlignVertical: "top", paddingVertical: 12 }} />
              <Button testID="save-new-prompt-button" title="Save prompt" icon="add" onPress={addPrompt} loading={savePrompt.isPending} />
            </View>

            {shownPrompts.length === 0 ? (
              <EmptyState icon="bookmark-outline" title={q ? "No matches" : "No saved prompts yet"} subtitle={q ? "No saved prompt matches your search." : "Type a prompt above and save it to build your library."} />
            ) : (
              shownPrompts.map((p) => (
                <View key={p.id} style={{ backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md }}>
                  <Text selectable style={{ color: colors.onSurface, fontSize: 14, lineHeight: 20 }}>{p.text}</Text>
                  {!!p.negative_prompt && (
                    <Text selectable style={{ color: colors.onSurfaceTertiary, fontSize: 12, marginTop: 4 }}>Negative: {p.negative_prompt}</Text>
                  )}
                  <View style={{ flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: spacing.lg, marginTop: spacing.sm }}>
                    <Pressable testID={`use-prompt-${p.id}`} onPress={() => router.push({ pathname: "/(tabs)/create", params: { prompt: p.text, negative: p.negative_prompt } })} style={{ flexDirection: "row", alignItems: "center", gap: 4 }} hitSlop={8}>
                      <Ionicons name="arrow-forward-circle-outline" size={18} color={colors.brandPrimary} />
                      <Text style={{ color: colors.brandPrimary, fontWeight: "600", fontSize: 13 }}>Use</Text>
                    </Pressable>
                    <Pressable onPress={() => deletePrompt.mutate(p.id)} hitSlop={8}><Ionicons name="trash-outline" size={18} color={colors.error} /></Pressable>
                  </View>
                </View>
              ))
            )}
            <Text style={{ color: colors.onSurfaceTertiary, fontSize: 12, textAlign: "center", marginTop: spacing.xs }}>Long-press a prompt to copy it. Tap Use to load it into Create.</Text>
          </View>
        ) : list.length === 0 ? (
          <EmptyState icon="images-outline" title="Nothing here yet" subtitle={search ? "No videos match your search." : "Generate a video and it will show up in your gallery."} />
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
