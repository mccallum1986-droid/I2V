import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { api, apiError } from "@/src/api/client";
import { AuthShell } from "@/src/components/AuthShell";
import { Button, TextField } from "@/src/components/ui";
import { toast } from "@/src/store/toast";
import { spacing, useTheme } from "@/src/theme";

export default function ForgotPassword() {
  const { colors } = useTheme();
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const requestCode = async () => {
    if (!email.trim()) {
      toast.error("Enter your email");
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.post("/auth/password/forgot", { email: email.trim() });
      if (data.reset_code) {
        setCode(data.reset_code);
        toast.info(`Demo reset code: ${data.reset_code}`);
      } else {
        toast.info(data.message);
      }
      setStep(2);
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setLoading(false);
    }
  };

  const resetPassword = async () => {
    if (!code.trim() || newPassword.length < 6) {
      toast.error("Enter the code and a new password (min 6)");
      return;
    }
    setLoading(true);
    try {
      await api.post("/auth/password/reset", { token: code.trim(), new_password: newPassword });
      toast.success("Password reset. Please sign in.");
      router.replace("/(auth)/login");
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="Reset password"
      subtitle={step === 1 ? "We'll send a reset code to your email." : "Enter the code and choose a new password."}
    >
      <View style={{ gap: spacing.md }}>
        {step === 1 ? (
          <>
            <TextField
              testID="forgot-email-input"
              label="Email"
              icon="mail-outline"
              placeholder="you@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              value={email}
              onChangeText={setEmail}
            />
            <Button testID="forgot-request-button" title="Send Reset Code" onPress={requestCode} loading={loading} />
          </>
        ) : (
          <>
            <TextField
              testID="reset-code-input"
              label="Reset code"
              icon="key-outline"
              placeholder="ABC12345"
              autoCapitalize="characters"
              value={code}
              onChangeText={setCode}
            />
            <TextField
              testID="reset-password-input"
              label="New password"
              icon="lock-closed-outline"
              placeholder="Min. 6 characters"
              secureTextEntry
              value={newPassword}
              onChangeText={setNewPassword}
            />
            <Button testID="reset-submit-button" title="Reset Password" onPress={resetPassword} loading={loading} />
          </>
        )}
        <Pressable testID="back-to-login-link" onPress={() => router.replace("/(auth)/login")} style={{ alignSelf: "center", marginTop: spacing.sm }}>
          <Text style={{ color: colors.brandPrimary, fontWeight: "600" }}>Back to sign in</Text>
        </Pressable>
      </View>
    </AuthShell>
  );
}
