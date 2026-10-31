import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  useColorScheme,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Colors, Spacing } from "@/constants/theme";
import {
  createMailApi,
  createIdempotencyKey,
  MailApiError,
  type AllowedSender,
  type MailAccount,
  type OutboundSendStatus,
} from "@/lib/mail-api";

const api = createMailApi(
  process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:3001",
);

export default function HomeScreen() {
  const palette = Colors[useColorScheme() === "dark" ? "dark" : "light"];
  const [account, setAccount] = useState<MailAccount | null>(null);
  const [ready, setReady] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "bootstrap">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [bootstrapToken, setBootstrapToken] = useState("");
  const [senders, setSenders] = useState<AllowedSender[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [send, setSend] = useState<OutboundSendStatus | null>(null);
  const [pendingSend, setPendingSend] = useState<{
    from: string;
    to: string;
    subject: string;
    text: string;
    idempotencyKey: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const refreshSession = useCallback(async () => {
    try {
      const current = await api.session();
      setAccount(current);
      if (current) {
        const available = await api.senders();
        setSenders(available);
        setFrom((selected) =>
          available.some((sender) => sender.address === selected)
            ? selected
            : (available[0]?.address ?? ""),
        );
      }
    } catch (error) {
      setMessage(userMessage(error));
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  useEffect(() => {
    if (!send || (send.status !== "queued" && send.status !== "claimed"))
      return;
    let disposed = false;
    const timer = setTimeout(() => {
      void api
        .status(send.id)
        .then((updated) => {
          if (!disposed) {
            setSend(updated);
            setMessage("");
          }
        })
        .catch((error: unknown) => {
          if (!disposed) {
            if (error instanceof MailApiError && error.status === 401) {
              setAccount(null);
              setSend(null);
              return;
            }
            setMessage(userMessage(error));
            setSend((current) => (current ? { ...current } : current));
          }
        });
    }, 1_500);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [send]);

  const submitAuth = async () => {
    setBusy(true);
    setMessage("");
    try {
      const signedIn =
        authMode === "login"
          ? await api.login({ email, password })
          : await api.bootstrap({
              email,
              organizationName,
              password,
              bootstrapToken,
            });
      setAccount(signedIn);
      const available = await api.senders();
      setSenders(available);
      setFrom(available[0]?.address ?? "");
      setPassword("");
      setBootstrapToken("");
      setMessage("");
    } catch (error) {
      setMessage(userMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const submitSend = async () => {
    setBusy(true);
    setMessage("");
    const payload = pendingSend ?? {
      from,
      to,
      subject,
      text: body,
      idempotencyKey: createIdempotencyKey(),
    };
    try {
      const queued = await api.send(payload);
      setSend(queued);
      setPendingSend(null);
      setTo("");
      setSubject("");
      setBody("");
    } catch (error) {
      setMessage(userMessage(error));
      if (
        !(error instanceof MailApiError) ||
        error.status === 0 ||
        error.status >= 500
      )
        setPendingSend(payload);
    } finally {
      setBusy(false);
    }
  };

  if (!ready) {
    return (
      <ThemedView style={styles.centered}>
        <ActivityIndicator color={palette.text} />
        <ThemedText themeColor="textSecondary">Connecting securely…</ThemedText>
      </ThemedView>
    );
  }

  if (!account) {
    return (
      <PageFrame>
        <View style={styles.authHeader}>
          <BrandMark />
          <ThemedText type="title">Your Resend mailbox</ThemedText>
          <ThemedText themeColor="textSecondary">
            Sign in to your self-hosted email workspace.
          </ThemedText>
        </View>
        {authMode === "bootstrap" && (
          <Field
            label="Workspace name"
            value={organizationName}
            onChangeText={setOrganizationName}
            placeholder="My mailbox"
          />
        )}
        <Field
          label="Email"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          placeholder="you@example.com"
        />
        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          placeholder={
            authMode === "bootstrap"
              ? "At least 15 characters"
              : "Your password"
          }
        />
        {authMode === "bootstrap" && (
          <Field
            label="One-time setup token"
            value={bootstrapToken}
            onChangeText={setBootstrapToken}
            secureTextEntry
            autoCapitalize="none"
            placeholder="Provided by your administrator"
          />
        )}
        <ActionButton
          label={authMode === "login" ? "Sign in" : "Create workspace"}
          busy={busy}
          onPress={() => void submitAuth()}
        />
        <InlineAction
          label={
            authMode === "login"
              ? "First time here? Set up the owner account"
              : "Already have an account? Sign in"
          }
          onPress={() => {
            setMessage("");
            setAuthMode(authMode === "login" ? "bootstrap" : "login");
          }}
        />
        {!!message && <Notice message={message} tone="error" />}
      </PageFrame>
    );
  }

  return (
    <PageFrame>
      <View style={styles.workspaceHeader}>
        <View style={styles.brandRow}>
          <BrandMark />
          <View style={styles.headerCopy}>
            <ThemedText type="title">Compose</ThemedText>
            <ThemedText themeColor="textSecondary">{account.email}</ThemedText>
          </View>
        </View>
        <View style={styles.userBadge}>
          <ThemedText type="smallBold">{account.role.toUpperCase()}</ThemedText>
        </View>
      </View>

      <ThemedView type="backgroundElement" style={styles.composeCard}>
        <ThemedText type="subtitle">New message</ThemedText>
        {senders.length ? (
          <View style={styles.fieldGroup}>
            <ThemedText type="smallBold">From</ThemedText>
            <View style={styles.senderList}>
              {senders.map((sender) => (
                <Pressable
                  key={sender.address}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: from === sender.address }}
                  disabled={Boolean(pendingSend)}
                  onPress={() => setFrom(sender.address)}
                  style={[
                    styles.senderOption,
                    {
                      borderColor:
                        from === sender.address
                          ? palette.text
                          : palette.textSecondary,
                    },
                  ]}
                >
                  <ThemedText type="small">{sender.address}</ThemedText>
                </Pressable>
              ))}
            </View>
          </View>
        ) : (
          <Notice
            message="No verified sender addresses are configured yet. Add an allowed address under a verified domain first."
            tone="info"
          />
        )}
        <Field
          label="To"
          value={to}
          onChangeText={setTo}
          keyboardType="email-address"
          autoCapitalize="none"
          placeholder="recipient@example.com"
          maxLength={320}
          editable={!pendingSend}
        />
        <Field
          label="Subject"
          value={subject}
          onChangeText={setSubject}
          placeholder="Subject"
          maxLength={998}
          editable={!pendingSend}
        />
        <Field
          label="Message"
          value={body}
          onChangeText={setBody}
          placeholder="Write a plain-text message…"
          multiline
          numberOfLines={8}
          style={styles.bodyInput}
          editable={!pendingSend}
          maxLength={100_000}
        />
        <View style={styles.sendRow}>
          <ThemedText type="small" themeColor="textSecondary">
            Plain text · attachments coming later
          </ThemedText>
          <ActionButton
            label={pendingSend ? "Retry same message" : "Queue message"}
            busy={busy}
            disabled={
              !pendingSend &&
              (!from || !to.trim() || !subject.trim() || !body.trim())
            }
            onPress={() => void submitSend()}
          />
        </View>
      </ThemedView>

      {!!send && (
        <ThemedView type="backgroundElement" style={styles.statusCard}>
          <View style={styles.statusHeading}>
            <ThemedText type="subtitle">Delivery status</ThemedText>
            {(send.status === "queued" || send.status === "claimed") && (
              <ActivityIndicator size="small" color={palette.text} />
            )}
          </View>
          <ThemedText type="smallBold">{statusTitle(send)}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {statusDescription(send)}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Send ID: {send.id}
          </ThemedText>
        </ThemedView>
      )}
      {!!message && <Notice message={message} tone="error" />}
      {!!pendingSend && (
        <Notice
          message="The API may have accepted your previous request. Retry this unchanged message with the same idempotency key to check safely."
          tone="info"
        />
      )}
      <ThemedText type="small" themeColor="textSecondary" style={styles.footer}>
        Connected as {account.email} · provider credentials stay on the server
      </ThemedText>
    </PageFrame>
  );
}

function PageFrame({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.page}>{children}</View>
      </ScrollView>
    </SafeAreaView>
  );
}

function BrandMark() {
  return (
    <View style={styles.brandMark}>
      <ThemedText style={styles.brandGlyph}>R</ThemedText>
    </View>
  );
}

function Field(props: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  keyboardType?: "default" | "email-address";
  autoCapitalize?: "none" | "sentences";
  secureTextEntry?: boolean;
  multiline?: boolean;
  numberOfLines?: number;
  style?: object;
  editable?: boolean;
  maxLength?: number;
}) {
  const palette = Colors[useColorScheme() === "dark" ? "dark" : "light"];
  return (
    <View style={styles.fieldGroup}>
      <ThemedText type="smallBold">{props.label}</ThemedText>
      <TextInput
        accessibilityLabel={props.label}
        value={props.value}
        onChangeText={props.onChangeText}
        placeholder={props.placeholder}
        placeholderTextColor={palette.textSecondary}
        keyboardType={props.keyboardType}
        autoCapitalize={props.autoCapitalize ?? "sentences"}
        secureTextEntry={props.secureTextEntry}
        editable={props.editable}
        maxLength={props.maxLength}
        multiline={props.multiline}
        numberOfLines={props.numberOfLines}
        textAlignVertical={props.multiline ? "top" : "center"}
        style={[
          styles.input,
          {
            backgroundColor: palette.background,
            borderColor: palette.textSecondary + "55",
            color: palette.text,
          },
          props.style,
        ]}
      />
    </View>
  );
}

function ActionButton(props: {
  label: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
}) {
  const palette = Colors[useColorScheme() === "dark" ? "dark" : "light"];
  return (
    <Pressable
      accessibilityRole="button"
      disabled={props.busy || props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.actionButton,
        {
          backgroundColor: palette.text,
          opacity: props.disabled || props.busy ? 0.45 : pressed ? 0.78 : 1,
        },
      ]}
    >
      {props.busy ? (
        <ActivityIndicator color={palette.background} size="small" />
      ) : (
        <ThemedText style={[styles.actionText, { color: palette.background }]}>
          {props.label}
        </ThemedText>
      )}
    </Pressable>
  );
}

function InlineAction(props: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={props.onPress}>
      <ThemedText type="link">{props.label}</ThemedText>
    </Pressable>
  );
}

function Notice(props: { message: string; tone: "error" | "info" }) {
  const dark = useColorScheme() === "dark";
  const color =
    props.tone === "error"
      ? dark
        ? "#ffb4ab"
        : "#a52920"
      : dark
        ? "#c5d5ff"
        : "#334b78";
  return (
    <View style={[styles.notice, { borderColor: color + "66" }]}>
      <ThemedText style={{ color }}>{props.message}</ThemedText>
    </View>
  );
}

function statusTitle(send: OutboundSendStatus) {
  if (send.status === "sent") return "Sent";
  if (send.status === "queued") return "Queued";
  if (send.status === "claimed")
    return `Sending · attempt ${send.attemptCount}`;
  if (send.failureCode === "delivery_outcome_unknown")
    return "Delivery outcome unknown";
  if (send.failureCode === "attempts_exhausted")
    return "Delivery stopped after retries";
  return "Provider rejected this message";
}

function statusDescription(send: OutboundSendStatus) {
  if (send.status === "sent")
    return "Resend accepted the message for delivery.";
  if (send.status === "queued")
    return "The worker will send this message shortly.";
  if (send.status === "claimed")
    return "The worker is processing this message.";
  if (send.failureCode === "delivery_outcome_unknown")
    return "Check Resend activity before sending again. Automatic retries stopped to avoid a duplicate.";
  if (send.failureCode === "attempts_exhausted")
    return "Automatic retries stopped. Check Resend activity before composing a replacement.";
  return "Review the configured Resend connection and sender, then correct the issue before composing again.";
}

function userMessage(error: unknown) {
  if (!(error instanceof MailApiError))
    return "Something went wrong. Try again.";
  if (error.code === "NETWORK_UNAVAILABLE")
    return "Cannot reach the mailbox API. Check the server address and connection.";
  if (error.code === "INVALID_CREDENTIALS")
    return "Email or password is incorrect.";
  if (error.code === "BOOTSTRAP_NOT_AUTHORIZED")
    return "The setup token is not valid.";
  if (error.code === "OWNER_ALREADY_BOOTSTRAPPED")
    return "This workspace already has an owner. Sign in instead.";
  if (error.code === "SENDER_NOT_ALLOWED")
    return "That sender is not configured for a verified domain.";
  if (error.code === "INVALID_OUTBOUND_SEND_INPUT")
    return "Check the recipient, subject, and message body.";
  if (error.status === 401) return "Your session expired. Sign in again.";
  if (error.status === 403)
    return "This action is not allowed for your account.";
  return "The request could not be completed. Review your settings and try again.";
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  scrollContent: { flexGrow: 1, padding: Spacing.four },
  page: {
    width: "100%",
    maxWidth: 740,
    alignSelf: "center",
    gap: Spacing.three,
    paddingBottom: Spacing.six,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.three,
  },
  authHeader: {
    gap: Spacing.two,
    alignItems: "flex-start",
    marginBottom: Spacing.two,
  },
  workspaceHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.two,
  },
  brandRow: { flexDirection: "row", alignItems: "center", gap: Spacing.three },
  brandMark: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: "#3b4ce2",
    alignItems: "center",
    justifyContent: "center",
  },
  brandGlyph: { color: "white", fontSize: 23, fontWeight: "800" },
  headerCopy: { gap: Spacing.one },
  userBadge: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#9aa0a6",
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  composeCard: { borderRadius: 20, padding: Spacing.four, gap: Spacing.three },
  statusCard: { borderRadius: 18, padding: Spacing.four, gap: Spacing.two },
  statusHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  fieldGroup: { gap: Spacing.two },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 16,
  },
  bodyInput: { minHeight: 170, paddingTop: Spacing.three },
  senderList: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
  senderOption: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  sendRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.three,
    flexWrap: "wrap",
    marginTop: Spacing.two,
  },
  actionButton: {
    minHeight: 46,
    minWidth: 132,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
  },
  actionText: { fontWeight: "700" },
  notice: { borderWidth: 1, borderRadius: 12, padding: Spacing.three },
  footer: { textAlign: "center", marginTop: Spacing.two },
});
