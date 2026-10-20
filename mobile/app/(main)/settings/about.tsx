import Constants from 'expo-constants'
import { useRouter } from 'expo-router'
import { Linking, View } from 'react-native'
import { IrisMark } from '@/components/IrisMark'
import { UpdateInfoCard } from '@/updates'
import { ListItem, Section } from '@/ui/components/ListItem'
import { Page } from '@/ui/components/Page'
import { Text } from '@/ui/components/Text'
import { useTheme } from '@/ui/theme'

export default function About() {
  const t = useTheme()
  const router = useRouter()
  return (
    <Page title="About">
      <View style={{ alignItems: 'center', gap: 6, paddingVertical: 28 }}>
        <IrisMark size={88} dark={t.isDark} />
        <Text variant="h1">Iris</Text>
        <Text tone="muted">Version {Constants.expoConfig?.version ?? '0.1.0'}</Text>
      </View>
      <View style={{ paddingHorizontal: 20 }}>
        <Text tone="soft" align="center">
          Iris is free software. You can redistribute it and modify it under the terms of the GNU General Public License, version 3.
        </Text>
        <Text variant="small" tone="muted" align="center" style={{ marginTop: 10 }}>
          This program comes with ABSOLUTELY NO WARRANTY. See the GNU GPL v3 for details.
        </Text>
      </View>
      <View style={{ paddingHorizontal: 20, paddingTop: 20 }}>
        <UpdateInfoCard />
      </View>
      <Section>
        <ListItem icon="document-text" title="GNU GPL v3 license" chevron onPress={() => Linking.openURL('https://www.gnu.org/licenses/gpl-3.0.html')} />
        <ListItem icon="logo-github" title="Source code" chevron onPress={() => Linking.openURL('https://github.com/')} />
        {__DEV__ ? <ListItem icon="bug" title="Crypto diagnostics" subtitle="Developer builds only" chevron onPress={() => router.push('/diagnostics')} /> : null}
      </Section>
    </Page>
  )
}
