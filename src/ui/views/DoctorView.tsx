import { Box, Text } from "ink";
import { Panel, StatusLine } from "../components/index.tsx";
import type { DoctorModel } from "../models.ts";
import type { Theme } from "../theme.ts";

export function DoctorView({ model, theme }: { model: DoctorModel; theme: Theme }) {
  return (
    <Box flexDirection="column">
      <Panel theme={theme} title="doctor">
        {model.checks.map((check) => (
          <StatusLine
            key={check.name}
            theme={theme}
            tone={check.tone}
            label={check.name.padEnd(22)}
            detail={check.detail}
          />
        ))}
      </Panel>
      <Text color={theme.useColor ? (model.ok ? theme.colors.ok : theme.colors.fail) : undefined}>
        {model.ok
          ? `${theme.symbols.ok} all checks passed`
          : `${theme.symbols.fail} one or more checks failed`}
      </Text>
    </Box>
  );
}
