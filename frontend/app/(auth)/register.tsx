import { Link, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { api, apiError } from "@/src/api/client";
import { AuthShell } from "@/src/components/AuthShell";
import { Button, TextField } from "@/src/components/ui";
import { useAuthStore } from "@/src/store/auth";
import { toast } from "@/src/store/toast";
import { spacing, useTheme } from "@/src/theme";

export default function Register() {
  const { colors } = useTheme();
  const router = useRouter();
  const signIn = useAuthStore((s) => s.signIn);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [secure, setSecure] = useState(true);
  const [loading, setLoading] = useState(false);

  const onRegister = async () => {
    if (!name.trim() || !email.trim() || password.length < 6) {
      toast.error("Fill all fields (password min 6 chars)");
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.post("/auth/register", {
        name: name.trim(),
        email: email.trim(),
        password,
      });
      await signIn(data.access_token, data.user);
      router.replace("/(tabs)");
    } catch (e) {
      toast.error(apiError(e, "Registration failed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell title="Create account" subtitle="Start generating cinematic AI videos.">
      <View style={{ gap: spacing.md }}>
        <TextField
          testID="register-name-input"
          label="Full name"
          icon="person-outline"
          placeholder="Ada Lovelace"
          value={name}
          onChangeText={setName}
        />
        <TextField
          testID="register-email-input"
          label="Email"
          icon="mail-outline"
          placeholder="you@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
          value={email}
          onChangeText={setEmail}
        />
        <TextField
          testID="register-password-input"
          label="Password"
          icon="lock-closed-outline"
          placeholder="Min. 6 characters"
          secureTextEntry={secure}
          rightIcon={secure ? "eye-outline" : "eye-off-outline"}
          onRightIconPress={() => setSecure((s) => !s)}
          value={password}
          onChangeText={setPassword}
        />
        <Button testID="register-submit-button" title="Create Account" onPress={onRegister} loading={loading} style={{ marginTop: spacing.sm }} />
        <View style={{ flexDirection: "row", justifyContent: "center", marginTop: spacing.md, gap: 4 }}>
          <Text style={{ color: colors.onSurfaceSecondary }}>Already have an account?</Text>
          <Link href="/(auth)/login" asChild>
            <Pressable testID="go-to-login-link">
              <Text style={{ color: colors.brandPrimary, fontWeight: "700" }}>Sign in</Text>
            </Pressable>
          </Link>
        </View>
      </View>
    </AuthShell>
  );
}
