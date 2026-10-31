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
  type ConfiguredDomain,
  type AllowedSender,
  type MailAccount,
  type Mailbox,
  type OutboundSendStatus,
  type ResendConnection,
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
  const [connections, setConnections] = useState<ResendConnection[]>([]);
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [domains, setDomains] = useState<ConfiguredDomain[]>([]);
  const [selectedConnectionId, setSelectedConnectionId] = useState("");
  const [selectedDomainId, setSelectedDomainId] = useState("");
  const [selectedMailboxId, setSelectedMailboxId] = useState("");
  const [connectionName, setConnectionName] = useState(
    "Primary Resend account",
  );
  const [apiKey, setApiKey] = useState("");
  const [mailboxName, setMailboxName] = useState("Inbox");
  const [domainName, setDomainName] = useState("");
  const [senderLocalPart, setSenderLocalPart] = useState("support");
  const [showSetup, setShowSetup] = useState(false);
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

  const loadWorkspace = useCallback(async () => {
    const [
      availableSenders,
      availableConnections,
      availableMailboxes,
      availableDomains,
    ] = await Promise.all([
      api.senders(),
      api.connections(),
      api.mailboxes(),
      api.domains(),
    ]);
    setSenders(availableSenders);
    setConnections(availableConnections);
    setMailboxes(availableMailboxes);
    setDomains(availableDomains);
    setFrom((selected) =>
      availableSenders.some((sender) => sender.address === selected)
        ? selected
        : (availableSenders[0]?.address ?? ""),
    );
    setSelectedConnectionId((selected) =>
      availableConnections.some((connection) => connection.id === selected)
        ? selected
        : (availableConnections[0]?.id ?? ""),
    );
    setSelectedMailboxId((selected) =>
      availableMailboxes.some((mailbox) => mailbox.id === selected)
        ? selected
        : (availableMailboxes[0]?.id ?? ""),
    );
    setSelectedDomainId((selected) =>
      availableDomains.some((domain) => domain.id === selected)
        ? selected
        : (availableDomains[0]?.id ?? ""),
    );
  }, []);

  const refreshSession = useCallback(async () => {
    try {
      const current = await api.session();
      setAccount(current);
      if (current) await loadWorkspace();
    } catch (error) {
      setMessage(userMessage(error));
    } finally {
      setReady(true);
    }
  }, [loadWorkspace]);

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
      await loadWorkspace();
      setPassword("");
      setBootstrapToken("");
      setMessage("");
    } catch (error) {
      setMessage(userMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const createConnection = async () => {
    setBusy(true);
    setMessage("");
    try {
      const connection = await api.createConnection({
        name: connectionName,
        apiKey,
      });
      const validation = await api.validateConnection(connection.id);
      setApiKey("");
      await loadWorkspace();
      if (validation !== "connected") {
        setMessage(
          validation === "invalid_credentials"
            ? "Resend rejected this API key. Review the key and add a new connection."
            : "The key was saved, but Resend could not confirm it. Check the key permissions and network, then verify the domain.",
        );
        return;
      }
      setSelectedConnectionId(connection.id);
      setMessage("Resend connection saved securely and validated.");
    } catch (error) {
      setMessage(userMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const replaceConnectionKey = async () => {
    if (!selectedConnectionId) return;
    setBusy(true);
    setMessage("");
    try {
      await api.replaceConnectionKey(selectedConnectionId, apiKey);
      const validation = await api.validateConnection(selectedConnectionId);
      setApiKey("");
      await loadWorkspace();
      setMessage(
        validation === "connected"
          ? "Resend API key updated and validated."
          : validation === "invalid_credentials"
            ? "Resend rejected the replacement key. Enter a valid key and try again."
            : "Key saved, but Resend could not confirm it. Check permissions and network.",
      );
    } catch (error) {
      setMessage(userMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const createMailbox = async () => {
    setBusy(true);
    setMessage("");
    try {
      const mailbox = await api.createMailbox(mailboxName);
      await loadWorkspace();
      setSelectedMailboxId(mailbox.id);
      setMessage("Mailbox created.");
    } catch (error) {
      setMessage(userMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const createDomain = async () => {
    setBusy(true);
    setMessage("");
    try {
      const domain = await api.createDomain(selectedConnectionId, domainName);
      await loadWorkspace();
      setSelectedDomainId(domain.id);
      setDomainName("");
      setMessage(
        "Domain added. Configure it in Resend, then check its verification status here.",
      );
    } catch (error) {
      setMessage(userMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const verifyDomain = async (domainId: string) => {
    setBusy(true);
    setMessage("");
    try {
      const domain = await api.refreshDomain(domainId);
      await loadWorkspace();
      setSelectedDomainId(domain.id);
      setMessage(
        domain.verificationStatus === "verified"
          ? "Resend confirms this domain is verified."
          : `Resend domain status: ${domain.verificationStatus}.`,
      );
    } catch (error) {
      setMessage(userMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const createSender = async () => {
    setBusy(true);
    setMessage("");
    try {
      await api.createAddress(
        selectedDomainId,
        selectedMailboxId,
        senderLocalPart,
      );
      await loadWorkspace();
      setFrom(
        `${senderLocalPart.trim().toLowerCase()}@${domains.find((domain) => domain.id === selectedDomainId)?.name ?? ""}`,
      );
      setMessage("Allowed sender address created.");
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

      {senders.length > 0 && (
        <InlineAction
          label={
            showSetup
              ? "Hide account setup"
              : "Manage Resend account and senders"
          }
          onPress={() => setShowSetup((visible) => !visible)}
        />
      )}
      {(senders.length === 0 || showSetup) && (
        <ThemedView type="backgroundElement" style={styles.setupCard}>
          <ThemedText type="subtitle">Set up a sender</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Add a Resend API key, an existing Resend domain, a mailbox, and an
            allowed address. The key is encrypted by the API and is never shown
            again.
          </ThemedText>

          {connections.length === 0 ? (
            <Field
              label="Connection name"
              value={connectionName}
              onChangeText={setConnectionName}
              placeholder="Primary Resend account"
            />
          ) : (
            <View style={styles.fieldGroup}>
              <ThemedText type="smallBold">Resend connection</ThemedText>
              <View style={styles.senderList}>
                {connections.map((connection) => (
                  <OptionPill
                    key={connection.id}
                    label={connection.name}
                    selected={selectedConnectionId === connection.id}
                    onPress={() => setSelectedConnectionId(connection.id)}
                  />
                ))}
              </View>
            </View>
          )}
          <Field
            label={
              connections.length
                ? "Replace API key (optional)"
                : "Resend API key"
            }
            value={apiKey}
            onChangeText={setApiKey}
            secureTextEntry
            autoCapitalize="none"
            placeholder="re_…"
          />
          <ActionButton
            label={
              connections.length
                ? "Update and verify key"
                : "Save and verify connection"
            }
            busy={busy}
            disabled={
              !apiKey.trim() ||
              (connections.length > 0 && !selectedConnectionId)
            }
            onPress={() =>
              void (connections.length
                ? replaceConnectionKey()
                : createConnection())
            }
          />

          <View style={styles.setupDivider} />
          <ThemedText type="smallBold">Mailbox</ThemedText>
          {mailboxes.length > 0 && (
            <View style={styles.senderList}>
              {mailboxes.map((mailbox) => (
                <OptionPill
                  key={mailbox.id}
                  label={mailbox.name}
                  selected={selectedMailboxId === mailbox.id}
                  onPress={() => setSelectedMailboxId(mailbox.id)}
                />
              ))}
            </View>
          )}
          <View style={styles.inlineFields}>
            <Field
              label="New mailbox name"
              value={mailboxName}
              onChangeText={setMailboxName}
              placeholder="Inbox"
              style={styles.compactInput}
            />
            <ActionButton
              label="Add mailbox"
              busy={busy}
              disabled={!mailboxName.trim()}
              onPress={() => void createMailbox()}
            />
          </View>

          <View style={styles.setupDivider} />
          <ThemedText type="smallBold">Verified domain</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Add a domain already present in your Resend account. Configure its
            DNS in Resend, then refresh verification here.
          </ThemedText>
          {domains.map((domain) => (
            <View key={domain.id} style={styles.domainRow}>
              <OptionPill
                label={`${domain.name} · ${domain.verificationStatus}`}
                selected={selectedDomainId === domain.id}
                onPress={() => setSelectedDomainId(domain.id)}
              />
              <InlineAction
                label="Check"
                onPress={() => void verifyDomain(domain.id)}
              />
            </View>
          ))}
          <View style={styles.inlineFields}>
            <Field
              label="Add domain"
              value={domainName}
              onChangeText={setDomainName}
              placeholder="example.com"
              autoCapitalize="none"
              style={styles.compactInput}
            />
            <ActionButton
              label="Add domain"
              busy={busy}
              disabled={!selectedConnectionId || !domainName.trim()}
              onPress={() => void createDomain()}
            />
          </View>

          {domains.find((domain) => domain.id === selectedDomainId)
            ?.verificationStatus === "verified" &&
            selectedMailboxId && (
              <>
                <View style={styles.setupDivider} />
                <Field
                  label="Allowed sender address"
                  value={senderLocalPart}
                  onChangeText={setSenderLocalPart}
                  placeholder="support"
                  autoCapitalize="none"
                  maxLength={64}
                />
                <ActionButton
                  label="Add sender address"
                  busy={busy}
                  disabled={!senderLocalPart.trim()}
                  onPress={() => void createSender()}
                />
              </>
            )}
        </ThemedView>
      )}

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

function OptionPill(props: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const palette = Colors[useColorScheme() === "dark" ? "dark" : "light"];
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: props.selected }}
      onPress={props.onPress}
      style={[
        styles.senderOption,
        {
          borderColor: props.selected ? palette.text : palette.textSecondary,
        },
      ]}
    >
      <ThemedText type="small">{props.label}</ThemedText>
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
  setupCard: { borderRadius: 20, padding: Spacing.four, gap: Spacing.three },
  setupDivider: {
    height: 1,
    backgroundColor: "#80808044",
    marginVertical: Spacing.one,
  },
  inlineFields: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: Spacing.two,
    flexWrap: "wrap",
  },
  compactInput: { minWidth: 220 },
  domainRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: Spacing.two,
  },
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
