import { Link, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { api, apiError } from "@/src/api/client";
import { AuthShell } from "@/src/components/AuthShell";
import { Button, TextField } from "@/src/components/ui";
import { useAuthStore } from "@/src/store/auth";
import { toast } from "@/src/store/toast";
import { spacing, useTheme } from "@/src/theme";

export default function Login() {
  const { colors } = useTheme();
  const router = useRouter();
  const signIn = useAuthStore((s) => s.signIn);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [secure, setSecure] = useState(true);
  const [loading, setLoading] = useState(false);

  const onLogin = async () => {
    if (!email.trim() || !password) {
      toast.error("Enter your email and password");
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.post("/auth/login", { email: email.trim(), password });
      await signIn(data.access_token, data.user);
      router.replace("/(tabs)");
    } catch (e) {
      toast.error(apiError(e, "Login failed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell title="Welcome back" subtitle="Sign in to your AI video studio.">
      <View style={{ gap: spacing.md }}>
        <TextField
          testID="login-email-input"
          label="Email"
          icon="mail-outline"
          placeholder="you@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
          value={email}
          onChangeText={setEmail}
        />
        <TextField
          testID="login-password-input"
          label="Password"
          icon="lock-closed-outline"
          placeholder="••••••••"
          secureTextEntry={secure}
          rightIcon={secure ? "eye-outline" : "eye-off-outline"}
          onRightIconPress={() => setSecure((s) => !s)}
          value={password}
          onChangeText={setPassword}
        />
        <Link href="/(auth)/forgot-password" asChild>
          <Pressable testID="forgot-password-link" style={{ alignSelf: "flex-end" }}>
            <Text style={{ color: colors.brandPrimary, fontWeight: "600", fontSize: 13 }}>
              Forgot password?
            </Text>
          </Pressable>
        </Link>
        <Button testID="login-submit-button" title="Sign In" onPress={onLogin} loading={loading} style={{ marginTop: spacing.sm }} />
        <View style={{ flexDirection: "row", justifyContent: "center", marginTop: spacing.md, gap: 4 }}>
          <Text style={{ color: colors.onSurfaceSecondary }}>New here?</Text>
          <Link href="/(auth)/register" asChild>
            <Pressable testID="go-to-register-link">
              <Text style={{ color: colors.brandPrimary, fontWeight: "700" }}>Create an account</Text>
            </Pressable>
          </Link>
        </View>
      </View>
    </AuthShell>
  );
}
