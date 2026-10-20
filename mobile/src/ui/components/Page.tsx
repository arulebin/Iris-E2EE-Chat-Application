import type { ReactNode } from 'react'
import { ScrollView } from 'react-native'
import { Header } from './Header'
import { Screen } from './Screen'

/** Standard settings-style page: header with back button plus scrolling content. */
export function Page({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <Screen edges={['top', 'bottom']}>
      <Header title={title} right={right} />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
    </Screen>
  )
}
