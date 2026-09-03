import { CchMonitorScreen } from '@/src/screens/cch-monitor-screen';
import { MonitorScreen } from '@/src/screens/monitor-screen';
import { serviceModeState } from '@/src/store/service-mode';

const { useSnapshot } = require('valtio/react');

export default function MonitorRouteScreen() {
  const serviceMode = useSnapshot(serviceModeState);
  return serviceMode.mode === 'cch' ? <CchMonitorScreen /> : <MonitorScreen />;
}
