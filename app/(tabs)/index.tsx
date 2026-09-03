import { Redirect } from 'expo-router';

import { adminConfigState, hasAuthenticatedAdminSession } from '@/src/store/admin-config';
import { cchConfigState, hasCchAdminSession } from '@/src/store/cch-config';
import { serviceModeState } from '@/src/store/service-mode';

const { useSnapshot } = require('valtio/react');

export default function IndexScreen() {
  const config = useSnapshot(adminConfigState);
  const cchConfig = useSnapshot(cchConfigState);
  const serviceMode = useSnapshot(serviceModeState);
  const hasAccount = serviceMode.mode === 'cch'
    ? hasCchAdminSession(cchConfig)
    : hasAuthenticatedAdminSession(config);

  return <Redirect href={hasAccount ? '/monitor' : '/settings'} />;
}
