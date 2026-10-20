import * as Clipboard from 'expo-clipboard'
import { useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import type { BackupFrequency } from '@/state/services'
import { radius, useTheme } from '../theme'
import { Button } from './Button'
import { Icon } from './Icon'
import { Text } from './Text'
import { useToast } from './Toast'

export function fmtBytes(b?: number): string {
  if (!b) return ''
  if (b >= 1_000_000) return `${(b / 1_000_000).toFixed(1)} MB`
  return `${Math.max(1, Math.round(b / 1000))} KB`
}

/** "Today, 13:05" / "Yesterday, 09:12" / "12 Oct, 18:40". */
export function fmtBackupTime(ts: number, now = Date.now()): string {
  const d = new Date(ts)
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((day(new Date(now)) - day(d)) / 86_400_000)
  if (diff === 0) return `Today, ${time}`
  if (diff === 1) return `Yesterday, ${time}`
  return `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric' })}, ${time}`
}

export type FrequencyChoice = BackupFrequency | 'off'

const LABELS: Record<FrequencyChoice, { title: string; subtitle: string }> = {
  daily: { title: 'Daily', subtitle: 'Recommended' },
  weekly: { title: 'Weekly', subtitle: 'Once a week' },
  manual: { title: 'Only when I tap "Back up"', subtitle: 'No automatic backups' },
  off: { title: 'Off', subtitle: "Don't back up my chats" },
}

/** Radio list of backup schedules. */
export function FrequencyPicker({ value, options, onChange, disabled }: {
  value: FrequencyChoice
  options: FrequencyChoice[]
  onChange: (v: FrequencyChoice) => void
  disabled?: boolean
}) {
  const t = useTheme()
  return (
    <View accessibilityRole="radiogroup">
      {options.map(o => {
        const on = o === value
        return (
          <Pressable
            key={o}
            disabled={disabled}
            onPress={() => onChange(o)}
            accessibilityRole="radio"
            accessibilityState={{ checked: on, disabled }}
            style={({ pressed }) => [styles.option, { opacity: disabled ? 0.5 : 1, backgroundColor: pressed ? t.surfaceAlt : 'transparent' }]}
          >
            <View style={[styles.radio, { borderColor: on ? t.primary : t.muted }]}>{on ? <View style={[styles.dot, { backgroundColor: t.primary }]} /> : null}</View>
            <View style={{ flex: 1 }}>
              <Text weight="semibold">{LABELS[o].title}</Text>
              <Text variant="small" tone="muted">
                {LABELS[o].subtitle}
              </Text>
            </View>
          </Pressable>
        )
      })}
    </View>
  )
}

/** The recovery key, shown once, with copy and an explicit "I saved it". */
export function RecoveryKeyView({ recoveryKey, onDone, doneTitle = 'I have saved it' }: { recoveryKey: string; onDone: () => void; doneTitle?: string }) {
  const t = useTheme()
  const toast = useToast()
  const [saved, setSaved] = useState(false)
  return (
    <View style={{ gap: 16 }}>
      <View style={[styles.keyBox, { backgroundColor: t.surfaceAlt, borderColor: t.hairline }]}>
        <Text weight="bold" selectable align="center" style={styles.key} accessibilityLabel={`Recovery key ${recoveryKey}`}>
          {recoveryKey}
        </Text>
      </View>
      <Text tone="muted" variant="small">
        Write it down or keep it in your password manager. It is shown only once. Without it, your backup cannot be opened, not even by Iris, so you would lose your messages if you change or reinstall your phone.
      </Text>
      <Button
        title="Copy key"
        variant="secondary"
        icon="copy"
        onPress={() => Clipboard.setStringAsync(recoveryKey).then(() => toast.show('Copied. Paste it somewhere safe.', 'success'))}
      />
      <Pressable
        onPress={() => setSaved(v => !v)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: saved }}
        style={styles.check}
      >
        <Icon name={saved ? 'checkbox' : 'square-outline'} size={22} color={saved ? t.primary : t.muted} />
        <Text style={{ flex: 1 }}>I saved my recovery key somewhere safe</Text>
      </Pressable>
      <Button title={doneTitle} disabled={!saved} onPress={onDone} />
    </View>
  )
}

const styles = StyleSheet.create({
  option: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 12, minHeight: 56 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 11, height: 11, borderRadius: 6 },
  keyBox: { padding: 18, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  key: { letterSpacing: 1.5, lineHeight: 26, fontSize: 17 },
  check: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
})
