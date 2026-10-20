import { View } from 'react-native'
import { useSettings } from '@/state/hooks'
import type { ThemeMode } from '@/state/services'
import { Icon } from '@/ui/components/Icon'
import { ListItem, Section } from '@/ui/components/ListItem'
import { Page } from '@/ui/components/Page'
import { useTheme } from '@/ui/theme'

const OPTIONS: Array<{ mode: ThemeMode; title: string; subtitle: string; icon: 'phone-portrait' | 'sunny' | 'moon' }> = [
  { mode: 'system', title: 'System default', subtitle: 'Follow your device setting', icon: 'phone-portrait' },
  { mode: 'light', title: 'Light', subtitle: 'Always light', icon: 'sunny' },
  { mode: 'dark', title: 'Dark', subtitle: 'Always dark', icon: 'moon' },
]

export default function Appearance() {
  const t = useTheme()
  const { settings, update } = useSettings()
  return (
    <Page title="Appearance">
      <Section title="Theme">
        {OPTIONS.map(o => (
          <ListItem
            key={o.mode}
            icon={o.icon}
            title={o.title}
            subtitle={o.subtitle}
            onPress={() => update({ theme: o.mode })}
            right={settings.theme === o.mode ? <Icon name="checkmark-circle" size={24} color={t.primary} /> : <View style={{ width: 24 }} />}
          />
        ))}
      </Section>
    </Page>
  )
}
