import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";

import { useAuthStore } from "@/src/store/auth";
import { useTheme } from "@/src/theme";

export default function Index() {
  const status = useAuthStore((s) => s.status);
  const { colors } = useTheme();

  if (status === "idle") {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface }}>
        <ActivityIndicator color={colors.brandPrimary} />
      </View>
    );
  }

  return <Redirect href={status === "authed" ? "/(tabs)" : "/(auth)/login"} />;
}
