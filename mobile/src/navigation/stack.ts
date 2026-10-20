/**
 * Settings of the signed-in `(main)` stack (app/(main)/_layout.tsx). The chat list is always the bottom of
 * this stack: without `initialRouteName`, opening a deep link (a message notification's `iris://chat/<id>`,
 * a call or request notification) on a cold start builds a stack holding ONLY that screen, so the back
 * gesture has nothing to pop and leaves the app instead of returning to the chat list. expo-router inserts
 * `index` under any deep-linked screen of the group.
 */
export const MAIN_STACK_SETTINGS = { initialRouteName: 'index' } as const
