import { getRuntime } from '@/state/real'

/**
 * The "IrisMessage" headless JS task (registered in mobile/index.js, started by
 * com.iris.notify.IrisMessageTaskService). Runs for data-only message pushes and for the Reply / Mark as
 * read notification actions, whether the app is in the foreground, in the background, or was killed:
 * Android starts the JS runtime for it if needed, and when the app is alive this shares its runtime
 * (stores, Signal client, the per-device lock), so a push and the live socket never decrypt the same
 * envelope twice.
 */
export default async function irisMessageTask(data: unknown): Promise<void> {
  if (process.env.EXPO_PUBLIC_MOCK === '1') return
  await getRuntime({ headless: true }).handleTask(data)
}
