import { Redirect } from 'expo-router'

/**
 * Deep-link target for call notifications (`iris://call/...`). The call UI itself is
 * <CallOverlay/> mounted at the root, so there is nothing to render here: just land
 * on the app's home route and let the overlay (already showing the ringing call) take over.
 */
export default function CallDeepLink() {
  return <Redirect href="/" />
}
