import { MaterialIcons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { AuthGate } from "@/components/jp/auth-gate";
import {
  AppHeader,
  Card,
  EmptyState,
  Field,
  ListRow,
  Screen,
  SecondaryButton,
  SectionHeader,
} from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import {
  INPUT_STANDARDS,
  MANUAL_FORMS,
  MANUAL_MODULES,
  manualFormById,
  searchManual,
  type ManualForm,
} from "@/lib/jp/manual-content";
import { useT } from "@/lib/i18n";

/**
 * The user manual inside the app. Without a form it shows the contents (by module, with search
 * and the input standards); with ?form=<id> it shows that form's page. Every form has a book
 * icon that opens its page here.
 */
export default function ManualScreen() {
  const params = useLocalSearchParams<{ form?: string; module?: string }>();
  const form = manualFormById(typeof params.form === "string" ? params.form : null);
  const moduleKey = typeof params.module === "string" ? params.module : null;
  return (
    <AuthGate>
      <Screen>{form ? <FormPage form={form} /> : <Contents focusModule={moduleKey} />}</Screen>
    </AuthGate>
  );
}

function Contents({ focusModule }: { focusModule: string | null }) {
  const { t } = useT();
  const colors = useColors();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [standardsOpen, setStandardsOpen] = useState(false);
  const found = query.trim() ? searchManual(query) : null;
  const modules = focusModule
    ? [
        ...MANUAL_MODULES.filter((m) => m.key === focusModule),
        ...MANUAL_MODULES.filter((m) => m.key !== focusModule),
      ]
    : MANUAL_MODULES;
  const open = (id: string) => router.push(`/manual?form=${id}` as never);

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <AppHeader
        eyebrow={t("User manual")}
        title={t("How to use every form")}
        subtitle={t("Step by step, with the standard way to fill each field and a worked example.")}
      />
      <Field
        label={t("Search the manual")}
        value={query}
        onChangeText={setQuery}
        placeholder={t("e.g. purchase order, PIN, advance")}
      />

      {found ? (
        found.length ? (
          <Card>
            {found.map((item) => (
              <ListRow
                key={item.id}
                icon="description"
                title={item.title}
                detail={item.where}
                onPress={() => open(item.id)}
              />
            ))}
          </Card>
        ) : (
          <EmptyState icon="search-off" title="Nothing found" detail="Try another word." />
        )
      ) : (
        <>
          <Card accent="accent">
            <Pressable
              accessibilityRole="button"
              onPress={() => setStandardsOpen((v) => !v)}
              style={styles.rowBetween}
            >
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>
                {t("Input standards for every form")}
              </Text>
              <MaterialIcons
                name={standardsOpen ? "expand-less" : "expand-more"}
                size={22}
                color={colors.primary}
              />
            </Pressable>
            {standardsOpen ? (
              <View style={{ gap: 10, marginTop: 8 }}>
                {INPUT_STANDARDS.map((rule) => (
                  <View key={rule.topic}>
                    <Text style={[styles.label, { color: colors.accent }]}>{rule.topic}</Text>
                    <Text style={[styles.body, { color: colors.foreground }]}>{rule.rule}</Text>
                    <Text style={[styles.small, { color: colors.success }]}>✓ {rule.good}</Text>
                    <Text style={[styles.small, { color: colors.error }]}>✗ {rule.bad}</Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={[styles.small, { color: colors.muted }]}>
                {t("Dates, money, quantities, units, phones, names, codes and reasons.")}
              </Text>
            )}
          </Card>

          {modules.map((mod, index) => (
            <View key={mod.key}>
              <SectionHeader
                title={`${MANUAL_MODULES.indexOf(mod) + 1}. ${mod.title}`}
                caption={mod.intro}
              />
              <Card accent={focusModule === mod.key && index === 0 ? "info" : undefined}>
                {MANUAL_FORMS.filter((item) => item.module === mod.key).map((item) => (
                  <ListRow
                    key={item.id}
                    icon="description"
                    title={item.title}
                    detail={item.purpose}
                    onPress={() => open(item.id)}
                  />
                ))}
              </Card>
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}

function FormPage({ form }: { form: ManualForm }) {
  const { t } = useT();
  const colors = useColors();
  const router = useRouter();
  const index = MANUAL_FORMS.indexOf(form);
  const prev = MANUAL_FORMS[index - 1];
  const next = MANUAL_FORMS[index + 1];
  const mod = MANUAL_MODULES.find((m) => m.key === form.module);

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <AppHeader
        eyebrow={mod?.title ?? t("User manual")}
        title={form.title}
        subtitle={form.purpose}
      />
      <View style={styles.rowWrap}>
        <SecondaryButton
          icon="menu-book"
          label={t("Contents")}
          onPress={() => router.replace(`/manual?module=${form.module}` as never)}
        />
        <SecondaryButton
          icon="open-in-new"
          label={t("Open this screen")}
          onPress={() => router.push(form.route as never)}
        />
      </View>

      <Card>
        <Row label={t("Where to find it")} text={form.where} />
        <Row label={t("Who uses it")} text={form.who} />
      </Card>

      <SectionHeader title={t("Fields and how to fill them")} />
      <Card>
        {form.fields.map((field) => (
          <View key={field.label} style={[styles.field, { borderColor: colors.border }]}>
            <View style={styles.rowBetween}>
              <Text style={[styles.fieldName, { color: colors.foreground }]}>{field.label}</Text>
              {field.required ? (
                <Text style={[styles.badge, { color: colors.error, borderColor: colors.error }]}>
                  {t("Needed")}
                </Text>
              ) : null}
            </View>
            <Text style={[styles.small, { color: colors.muted }]}>{field.standard}</Text>
            {field.example ? (
              <Text style={[styles.small, { color: colors.primary }]}>
                {t("Example")}: {field.example}
              </Text>
            ) : null}
          </View>
        ))}
      </Card>

      <SectionHeader title={t("Worked example")} caption={form.scenario.story} />
      <Card>
        {form.scenario.steps.map((step, i) => (
          <View key={step} style={styles.step}>
            <View style={[styles.stepNo, { backgroundColor: colors.primary }]}>
              <Text style={[styles.stepNoText, { color: colors.background }]}>{i + 1}</Text>
            </View>
            <Text style={[styles.body, { color: colors.foreground, flex: 1 }]}>{step}</Text>
          </View>
        ))}
      </Card>

      {form.ai ? (
        <Card accent="accent">
          <Text style={[styles.label, { color: colors.accent }]}>{t("Fill it with AI")}</Text>
          <Text style={[styles.body, { color: colors.foreground }]}>
            {t("Tap the mic on the form and say:")} “{form.ai}”
          </Text>
        </Card>
      ) : null}

      <View style={styles.twoCol}>
        <Card style={{ flex: 1 }}>
          <Text style={[styles.label, { color: colors.success }]}>{t("Do")}</Text>
          {form.dos.map((line) => (
            <Text key={line} style={[styles.small, { color: colors.foreground }]}>
              ✓ {line}
            </Text>
          ))}
        </Card>
        <Card style={{ flex: 1 }}>
          <Text style={[styles.label, { color: colors.error }]}>{t("Don't")}</Text>
          {form.donts.map((line) => (
            <Text key={line} style={[styles.small, { color: colors.foreground }]}>
              ✗ {line}
            </Text>
          ))}
        </Card>
      </View>

      <Card>
        <Row label={t("After you save")} text={form.after} />
      </Card>

      <View style={styles.rowWrap}>
        {prev ? (
          <SecondaryButton
            icon="chevron-left"
            label={prev.title}
            onPress={() => router.replace(`/manual?form=${prev.id}` as never)}
          />
        ) : null}
        {next ? (
          <SecondaryButton
            icon="chevron-right"
            label={next.title}
            onPress={() => router.replace(`/manual?form=${next.id}` as never)}
          />
        ) : null}
      </View>
    </ScrollView>
  );
}

function Row({ label, text }: { label: string; text: string }) {
  const colors = useColors();
  return (
    <View style={{ marginBottom: 8 }}>
      <Text style={[styles.label, { color: colors.accent }]}>{label}</Text>
      <Text style={[styles.body, { color: colors.foreground }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 48, gap: 12 },
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  rowWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  twoCol: { flexDirection: "row", gap: 10 },
  cardTitle: { fontSize: 15, fontWeight: "800" },
  label: { fontSize: 11, fontWeight: "800", letterSpacing: 0.6, textTransform: "uppercase" },
  body: { fontSize: 14, lineHeight: 20 },
  small: { fontSize: 13, lineHeight: 19, marginTop: 2 },
  field: { paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  fieldName: { fontSize: 14, fontWeight: "800", flex: 1 },
  badge: {
    fontSize: 10,
    fontWeight: "800",
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  step: { flexDirection: "row", gap: 10, marginBottom: 10, alignItems: "flex-start" },
  stepNo: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  stepNoText: { fontSize: 12, fontWeight: "800" },
});
