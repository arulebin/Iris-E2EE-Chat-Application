import { useLocalSearchParams } from 'expo-router'
import { Conversation } from '@/ui/screens/Conversation'

export default function ChatRoute() {
  const { id } = useLocalSearchParams<{ id: string }>()
  return <Conversation chatId={id} />
}
