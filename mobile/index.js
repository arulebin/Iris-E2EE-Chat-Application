// App entry. The headless task must be registered at bundle load, before expo-router renders anything:
// Android may start this bundle with no Activity at all to handle a data-only message push
// (com.iris.notify.IrisMessageTaskService), and then only this registration runs.
import { AppRegistry } from 'react-native'

AppRegistry.registerHeadlessTask('IrisMessage', () => require('./src/notify/headless').default)

import 'expo-router/entry'
