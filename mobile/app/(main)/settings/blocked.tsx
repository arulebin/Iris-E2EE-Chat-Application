import { useBlocked, useServices } from '@/state/hooks'
import { Avatar } from '@/ui/components/Avatar'
import { Button } from '@/ui/components/Button'
import { EmptyState } from '@/ui/components/EmptyState'
import { ListItem } from '@/ui/components/ListItem'
import { Page } from '@/ui/components/Page'
import { useToast } from '@/ui/components/Toast'

export default function Blocked() {
  const q = useBlocked()
  const { contacts } = useServices()
  const toast = useToast()
  const rows = q.data ?? []
  return (
    <Page title="Blocked users">
      {rows.length === 0 && !q.loading ? <EmptyState icon="happy-outline" title="No one blocked" body="You haven't blocked anyone." /> : null}
      {rows.map(c => (
        <ListItem
          key={c.id}
          left={<Avatar name={c.displayName} seed={c.id} size={44} />}
          title={c.displayName}
          subtitle={`@${c.username}`}
          right={
            <Button
              small
              variant="secondary"
              title="Unblock"
              onPress={async () => {
                await contacts.unblock(c.id)
                toast.show(`${c.displayName} unblocked`, 'success')
              }}
            />
          }
        />
      ))}
    </Page>
  )
}
