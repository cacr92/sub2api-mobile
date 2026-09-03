import { AccountsListScreen } from '@/src/screens/accounts-list-screen';
import { CchProvidersScreen } from '@/src/screens/cch-providers-screen';
import { serviceModeState } from '@/src/store/service-mode';

const { useSnapshot } = require('valtio/react');

export default function AccountsRouteScreen() {
  const serviceMode = useSnapshot(serviceModeState);
  return serviceMode.mode === 'cch' ? <CchProvidersScreen /> : <AccountsListScreen safeAreaEdges={['top', 'bottom']} />;
}
