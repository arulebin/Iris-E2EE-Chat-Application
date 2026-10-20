import { useSettings } from '@/state/hooks'
import { ListItem, Section } from '@/ui/components/ListItem'
import { Page } from '@/ui/components/Page'

export default function NotificationSettings() {
  const { settings, update } = useSettings()
  const footer = settings.appLock
    ? 'App lock is on, so notifications only say "New message": never who wrote or what they said.'
    : "Messages are decrypted on this phone. Google's push service only carries the encrypted message, never who sent it or what it says."
  return (
    <Page title="Notifications">
      <Section title="Messages" footer={footer}>
        <ListItem icon="notifications" title="Message notifications" value={settings.notifications} onValueChange={v => update({ notifications: v })} />
        <ListItem
          icon="eye"
          title="Show message preview"
          subtitle={settings.messagePreview ? 'Sender and text in notifications' : 'Notifications only say "New message"'}
          value={settings.messagePreview}
          disabled={!settings.notifications}
          onValueChange={v => update({ messagePreview: v })}
        />
      </Section>
    </Page>
  )
}
